import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Integração "configurada" para que o download da mídia seja tentado — a rede é simulada abaixo.
process.env.WHATSAPP_TOKEN = 'token-de-teste';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-id-midia-teste';

// Import dinâmico: o `import` estático seria içado e env.js leria as variáveis antes das linhas acima.
const { buildApp } = await import('../src/app.js');
const { prisma } = await import('../src/db.js');
const { env } = await import('../src/env.js');
const { createFixtures, login, auth } = await import('./helpers.js');
type Fixtures = Awaited<ReturnType<typeof createFixtures>>;

let app: FastifyInstance;
let fx: Fixtures;
let gestorToken: string;
let solicitanteToken: string;
let categoriaTriagem: { id: string };

/** Mídias "hospedadas" na Meta simulada: id → conteúdo + tipo informado pela Graph API. */
const MEDIA: Record<string, { body: Buffer; mime: string }> = {
  'midia-foto': { body: Buffer.from('jpeg-falso'), mime: 'image/jpeg' },
  'midia-voz': { body: Buffer.from('ogg-falso'), mime: 'audio/ogg; codecs=opus' },
  'midia-doc': { body: Buffer.from('%PDF-falso'), mime: 'application/pdf' },
  'midia-foto-2': { body: Buffer.from('jpeg-falso-2'), mime: 'image/jpeg' },
};
const sentTexts: string[] = [];

function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith('/messages')) {
    sentTexts.push(JSON.parse(String(init?.body)).text.body);
    return Promise.resolve(new Response('{}', { status: 200 }));
  }
  const graph = url.match(/graph\.facebook\.com\/v[\d.]+\/([^/?]+)$/);
  if (graph) {
    const m = MEDIA[decodeURIComponent(graph[1])];
    if (!m) return Promise.resolve(new Response('{"error":"not found"}', { status: 404 }));
    return Promise.resolve(Response.json({ url: `https://lookaside.teste/${graph[1]}`, mime_type: m.mime, file_size: m.body.length }));
  }
  const cdn = url.match(/lookaside\.teste\/(.+)$/);
  if (cdn) return Promise.resolve(new Response(MEDIA[decodeURIComponent(cdn[1])].body, { status: 200 }));
  return Promise.reject(new Error(`fetch inesperado nos testes: ${url}`));
}

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  fx = await createFixtures();
  app = await buildApp();
  gestorToken = await login(app, fx.users.gestor.email);
  solicitanteToken = await login(app, fx.users.solicitante.email);
  const existing = await prisma.category.findFirst({ where: { name: 'Mídia WhatsApp (teste)' } });
  categoriaTriagem = existing
    ? await prisma.category.update({ where: { id: existing.id }, data: { active: true } })
    : await prisma.category.create({
        data: { name: 'Mídia WhatsApp (teste)', slaPolicyId: fx.slaPolicyId, triageKeywords: ['tela-quebrada-midia'] },
      });
});

afterAll(async () => {
  await prisma.category.update({ where: { id: categoriaTriagem.id }, data: { active: false } });
  vi.unstubAllGlobals();
  await app.close();
  await prisma.$disconnect();
});

function post(from: string, message: Record<string, unknown>) {
  return app.inject({
    method: 'POST', url: '/api/integrations/whatsapp/webhook',
    payload: {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: env.whatsappPhoneId },
        contacts: [{ profile: { name: 'Contato Mídia' } }],
        messages: [{ from, ...message }],
      } }] }],
    },
  });
}

describe('Mídia recebida pelo WhatsApp', () => {
  it('foto com legenda abre o chamado com a foto anexada', async () => {
    const phone = '5531944440001';
    const res = await post(phone, { type: 'image', image: { id: 'midia-foto', mime_type: 'image/jpeg', caption: 'tela-quebrada-midia no caixa 2' } });
    expect(res.statusCode).toBe(200);

    const ticket = await prisma.ticket.findFirstOrThrow({ where: { channel: 'WHATSAPP', contactPhone: phone }, include: { attachments: true } });
    expect(ticket.categoryId).toBe(categoriaTriagem.id); // triagem por palavra-chave usa a legenda
    expect(ticket.description).toContain('[Foto]');
    expect(ticket.description).toContain('tela-quebrada-midia no caixa 2');
    expect(ticket.attachments).toHaveLength(1);
    const [att] = ticket.attachments;
    expect(att.mimeType).toBe('image/jpeg');
    expect(att.filename).toMatch(/^whatsapp-foto-\d{8}-\d{6}\.jpg$/);
    expect(fs.readFileSync(path.join(env.uploadDir, att.storedName)).toString()).toBe('jpeg-falso');
  });

  it('áudio de voz e documento no chamado aberto viram comentários com anexo', async () => {
    const phone = '5531944440002';
    await post(phone, { type: 'text', text: { body: 'tela-quebrada-midia do notebook' } });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { channel: 'WHATSAPP', contactPhone: phone } });

    await post(phone, { type: 'audio', audio: { id: 'midia-voz', mime_type: 'audio/ogg; codecs=opus', voice: true } });
    await post(phone, { type: 'document', document: { id: 'midia-doc', mime_type: 'application/pdf', filename: 'orcamento.pdf' } });

    const comments = await prisma.ticketComment.findMany({ where: { ticketId: ticket.id }, include: { attachments: true }, orderBy: { createdAt: 'asc' } });
    expect(comments).toHaveLength(2);
    expect(comments[0].body).toContain('[Mensagem de voz]');
    expect(comments[0].attachments[0].mimeType).toBe('audio/ogg'); // parâmetro de codec removido
    expect(comments[0].attachments[0].ticketId).toBe(ticket.id);
    expect(comments[1].body).toContain('[Documento: orcamento.pdf]');
    expect(comments[1].attachments[0].filename).toBe('orcamento.pdf');
  });

  it('falha no download não perde a mensagem: comentário avisa para pedir reenvio', async () => {
    const phone = '5531944440003';
    await post(phone, { type: 'text', text: { body: 'tela-quebrada-midia de novo' } });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { channel: 'WHATSAPP', contactPhone: phone } });

    await post(phone, { type: 'video', video: { id: 'midia-que-nao-existe', mime_type: 'video/mp4' } });
    const comment = await prisma.ticketComment.findFirstOrThrow({ where: { ticketId: ticket.id }, include: { attachments: true } });
    expect(comment.body).toContain('Vídeo — não foi possível baixar');
    expect(comment.attachments).toHaveLength(0);
  });

  it('foto enviada enquanto o menu espera resposta fica guardada e vai para o chamado', async () => {
    const phone = '5531944440004';
    await post(phone, { type: 'text', text: { body: 'Preciso de ajuda, mando foto' } });
    expect(await prisma.whatsAppPendingTriage.findUnique({ where: { phone } })).toBeTruthy();

    sentTexts.length = 0;
    await post(phone, { type: 'image', image: { id: 'midia-foto-2', mime_type: 'image/jpeg' } });
    const pending = await prisma.whatsAppPendingTriage.findUniqueOrThrow({ where: { phone } });
    expect(pending.attachmentIds).toHaveLength(1); // ainda esperando — não abriu na categoria padrão
    expect(sentTexts.at(-1)).toContain('responda só com o número');
    expect(await prisma.ticket.findFirst({ where: { channel: 'WHATSAPP', contactPhone: phone } })).toBeNull();

    // Mídia sem vínculo (aguardando o menu) só a TI enxerga
    const orphan = pending.attachmentIds[0];
    const soli = await app.inject({ method: 'GET', url: `/api/attachments/${orphan}/download`, headers: auth(solicitanteToken) });
    expect(soli.statusCode).toBe(403);

    const options = pending.options as unknown as { n: number; categoryId: string }[];
    const chosen = options.find((o) => o.categoryId === categoriaTriagem.id)!;
    await post(phone, { type: 'text', text: { body: String(chosen.n) } });

    const ticket = await prisma.ticket.findFirstOrThrow({ where: { channel: 'WHATSAPP', contactPhone: phone }, include: { attachments: true } });
    expect(ticket.attachments.map((a) => a.id)).toEqual([orphan]);
    expect(ticket.description).toContain('[Foto]');
  });
});

describe('Download de anexos de comentário', () => {
  it('respeita a visibilidade do chamado e envia nosniff', async () => {
    const phone = '5531944440005';
    await post(phone, { type: 'text', text: { body: 'tela-quebrada-midia na loja' } });
    await post(phone, { type: 'image', image: { id: 'midia-foto', mime_type: 'image/jpeg' } });
    const att = await prisma.attachment.findFirstOrThrow({ where: { ticket: { contactPhone: phone }, commentId: { not: null } } });

    // Solicitante qualquer não é dono do chamado → antes baixava qualquer anexo de comentário
    const soli = await app.inject({ method: 'GET', url: `/api/attachments/${att.id}/download`, headers: auth(solicitanteToken) });
    expect(soli.statusCode).toBe(403);

    const gestor = await app.inject({ method: 'GET', url: `/api/attachments/${att.id}/download`, headers: auth(gestorToken) });
    expect(gestor.statusCode).toBe(200);
    expect(gestor.headers['x-content-type-options']).toBe('nosniff');
    expect(gestor.headers['content-type']).toContain('image/jpeg');
  });

  it('anexo de comentário interno não é entregue ao solicitante do chamado', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/tickets', headers: auth(solicitanteToken),
      payload: { title: 'Chamado anexo interno', description: 'teste', categoryId: fx.categoryId, impact: 'UMA_PESSOA', urgency: 'PARCIALMENTE_PREJUDICADA' },
    });
    const ticketId = created.json().id;
    const internal = await prisma.ticketComment.create({ data: { ticketId, authorId: fx.users.gestor.id, body: 'nota interna', isInternal: true } });
    fs.mkdirSync(env.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(env.uploadDir, `interno-${internal.id}.txt`), 'segredo');
    const att = await prisma.attachment.create({
      data: { filename: 'interno.txt', storedName: `interno-${internal.id}.txt`, mimeType: 'text/plain', size: 7, uploadedById: fx.users.gestor.id, commentId: internal.id },
    });

    const soli = await app.inject({ method: 'GET', url: `/api/attachments/${att.id}/download`, headers: auth(solicitanteToken) });
    expect(soli.statusCode).toBe(403);
    const gestor = await app.inject({ method: 'GET', url: `/api/attachments/${att.id}/download`, headers: auth(gestorToken) });
    expect(gestor.statusCode).toBe(200);
  });
});

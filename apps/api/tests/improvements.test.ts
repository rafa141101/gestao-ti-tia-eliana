import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { env } from '../src/env.js';
import { createFixtures, login, auth, type Fixtures } from './helpers.js';

let app: FastifyInstance;
let fx: Fixtures;
let gestorToken: string;
let solicitanteToken: string;

beforeAll(async () => {
  fx = await createFixtures();
  app = await buildApp();
  gestorToken = await login(app, fx.users.gestor.email);
  solicitanteToken = await login(app, fx.users.solicitante.email);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Distribuição automática (round-robin)', () => {
  it('alterna os chamados entre os membros da fila', async () => {
    const queue = await prisma.queue.create({ data: { name: 'Fila RR', assignmentMode: 'ROUND_ROBIN' } });
    await prisma.queueMember.createMany({
      data: [
        { queueId: queue.id, userId: fx.users.tecnico.id },
        { queueId: queue.id, userId: fx.users.tecnico2.id },
      ],
    });
    const category = await prisma.category.create({ data: { name: 'Categoria RR', defaultQueueId: queue.id, slaPolicyId: fx.slaPolicyId } });

    const assignees: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST', url: '/api/tickets', headers: auth(solicitanteToken),
        payload: { title: `RR ${i}`, description: 'teste rodízio', categoryId: category.id, impact: 'UMA_PESSOA', urgency: 'PARCIALMENTE_PREJUDICADA' },
      });
      expect(res.statusCode).toBe(201);
      const t = await prisma.ticket.findUnique({ where: { id: res.json().id } });
      expect(t?.status).toBe('ATRIBUIDO');
      assignees.push(t!.assigneeId!);
    }
    // Alterna entre os dois membros
    expect(assignees[0]).not.toBe(assignees[1]);
    expect(assignees[0]).toBe(assignees[2]);
    expect(assignees[1]).toBe(assignees[3]);
  });
});

describe('Busca global', () => {
  it('encontra chamados e respeita permissões (solicitante não vê inventário)', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/tickets', headers: auth(gestorToken),
      payload: { title: 'Busca alvo xyzbusca', description: 'para busca global', categoryId: fx.categoryId, impact: 'UMA_PESSOA', urgency: 'EXISTE_ALTERNATIVA' },
    });
    expect(created.statusCode).toBe(201);

    const gestorSearch = await app.inject({ method: 'GET', url: '/api/search?q=xyzbusca', headers: auth(gestorToken) });
    expect(gestorSearch.json().tickets.length).toBeGreaterThan(0);

    const soliSearch = await app.inject({ method: 'GET', url: '/api/search?q=xyzbusca', headers: auth(solicitanteToken) });
    expect(soliSearch.json().tickets).toHaveLength(0); // não é o solicitante do chamado
    expect(soliSearch.json().assets).toHaveLength(0);  // sem permissão de inventário
  });
});

describe('Webhook WhatsApp', () => {
  const webhookPayload = (from: string, text: string) => ({
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: env.whatsappPhoneId },
          contacts: [{ profile: { name: 'Renata da Loja' } }],
          messages: [{ from, type: 'text', text: { body: text } }],
        },
      }],
    }],
  });

  it('verificação GET exige token correto', async () => {
    const bad = await app.inject({ method: 'GET', url: '/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123' });
    expect(bad.statusCode).toBe(403);
    const ok = await app.inject({ method: 'GET', url: '/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=gestao-ti-verify&hub.challenge=desafio42' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('desafio42');
  });

  it('mensagem nova abre chamado; mesma janela de 24h vira resposta no mesmo chamado', async () => {
    const phone = '5531988887777';
    const first = await app.inject({
      method: 'POST', url: '/api/integrations/whatsapp/webhook',
      payload: webhookPayload(phone, 'A impressora do balcão parou de funcionar'),
    });
    expect(first.statusCode).toBe(200);

    const ticket = await prisma.ticket.findFirst({
      where: { channel: 'WHATSAPP', contactPhone: phone },
      orderBy: { createdAt: 'desc' },
    });
    expect(ticket).toBeTruthy();
    expect(ticket!.title).toContain('[WhatsApp]');
    expect(ticket!.number).toMatch(/^TI-\d{4}-\d{6}$/);

    // Segunda mensagem do mesmo número → comentário no mesmo chamado, sem novo ticket
    const before = await prisma.ticket.count({ where: { channel: 'WHATSAPP', contactPhone: phone } });
    await app.inject({
      method: 'POST', url: '/api/integrations/whatsapp/webhook',
      payload: webhookPayload(phone, 'Ah, e a luz vermelha está piscando'),
    });
    const after = await prisma.ticket.count({ where: { channel: 'WHATSAPP', contactPhone: phone } });
    expect(after).toBe(before);

    const comments = await prisma.ticketComment.count({ where: { ticketId: ticket!.id } });
    expect(comments).toBe(1);
  });

  it('mensagem do cliente num chamado resolvido reabre o chamado; em chamado fechado abre outro', async () => {
    const phone = '5531955550001';
    const post = (text: string) => app.inject({ method: 'POST', url: '/api/integrations/whatsapp/webhook', payload: webhookPayload(phone, text) });
    await post('Meu monitor não liga');
    const t1 = await prisma.ticket.findFirstOrThrow({ where: { channel: 'WHATSAPP', contactPhone: phone } });

    await prisma.ticket.update({ where: { id: t1.id }, data: { status: 'RESOLVIDO', resolvedAt: new Date() } });
    await post('Continua sem ligar');
    const reopened = await prisma.ticket.findUniqueOrThrow({ where: { id: t1.id } });
    expect(reopened.status).toBe('EM_ATENDIMENTO');
    expect(reopened.reopenedCount).toBe(1);

    await prisma.ticket.update({ where: { id: t1.id }, data: { status: 'FECHADO', closedAt: new Date() } });
    await post('Voltou o problema');
    const all = await prisma.ticket.count({ where: { channel: 'WHATSAPP', contactPhone: phone } });
    expect(all).toBe(2);
  });

  it('ignora mensagem destinada a outro número da conta Business (não abre chamado)', async () => {
    const phone = '5531977776666';
    const payload = {
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: 'outro-numero-nao-e-o-de-ti' },
            contacts: [{ profile: { name: 'Cliente do Comercial' } }],
            messages: [{ from: phone, type: 'text', text: { body: 'Quanto custa o produto X?' } }],
          },
        }],
      }],
    };
    const res = await app.inject({ method: 'POST', url: '/api/integrations/whatsapp/webhook', payload });
    expect(res.statusCode).toBe(200);

    const ticket = await prisma.ticket.findFirst({ where: { channel: 'WHATSAPP', contactPhone: phone } });
    expect(ticket).toBeNull();
  });
});

describe('Triagem automática do WhatsApp (palavra-chave + menu)', () => {
  let categoriaTriagem: { id: string; name: string };

  beforeAll(async () => {
    const existing = await prisma.category.findFirst({ where: { name: 'Servidor de Triagem (teste)' } });
    categoriaTriagem = existing
      ? await prisma.category.update({ where: { id: existing.id }, data: { active: true } })
      : await prisma.category.create({
          data: { name: 'Servidor de Triagem (teste)', slaPolicyId: fx.slaPolicyId, triageKeywords: ['servidor-triagem-teste', 'servidor caiu triagem'] },
        });
  });

  afterAll(async () => {
    await prisma.category.update({ where: { id: categoriaTriagem.id }, data: { active: false } });
  });

  const send = (phone: string, text: string) => app.inject({
    method: 'POST', url: '/api/integrations/whatsapp/webhook',
    payload: {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: env.whatsappPhoneId },
        contacts: [{ profile: { name: 'Testador Triagem' } }],
        messages: [{ from: phone, type: 'text', text: { body: text } }],
      } }] }],
    },
  });

  it('palavra-chave bate: chamado nasce direto na categoria, sem menu', async () => {
    const phone = '5531966660001';
    const res = await send(phone, 'o servidor-triagem-teste está com problema');
    expect(res.statusCode).toBe(200);

    const ticket = await prisma.ticket.findFirst({ where: { channel: 'WHATSAPP', contactPhone: phone } });
    expect(ticket).toBeTruthy();
    expect(ticket!.categoryId).toBe(categoriaTriagem.id);

    const pending = await prisma.whatsAppPendingTriage.findUnique({ where: { phone } });
    expect(pending).toBeNull();
  });

  it('palavra de urgência eleva a urgência/prioridade do chamado', async () => {
    const phone = '5531966660002';
    await send(phone, 'servidor-triagem-teste parou tudo, urgente');

    const ticket = await prisma.ticket.findFirst({ where: { channel: 'WHATSAPP', contactPhone: phone } });
    expect(ticket!.urgency).toBe('ATIVIDADE_BLOQUEADA');
  });

  it('sem palavra-chave: manda menu e espera a escolha antes de criar o chamado', async () => {
    const phone = '5531966660003';
    const first = await send(phone, 'Preciso de ajuda com uma coisa aqui');
    expect(first.statusCode).toBe(200);

    // Ainda não deve ter criado chamado — está esperando a escolha do menu.
    const noTicketYet = await prisma.ticket.findFirst({ where: { channel: 'WHATSAPP', contactPhone: phone } });
    expect(noTicketYet).toBeNull();

    const pending = await prisma.whatsAppPendingTriage.findUnique({ where: { phone } });
    expect(pending).toBeTruthy();
    const options = pending!.options as unknown as { n: number; categoryId: string; label: string }[];
    const chosen = options.find((o) => o.categoryId === categoriaTriagem.id);
    expect(chosen).toBeTruthy();

    // Responde com o número da opção certa.
    const second = await send(phone, String(chosen!.n));
    expect(second.statusCode).toBe(200);

    const ticket = await prisma.ticket.findFirst({ where: { channel: 'WHATSAPP', contactPhone: phone } });
    expect(ticket).toBeTruthy();
    expect(ticket!.categoryId).toBe(categoriaTriagem.id);
    expect(ticket!.description).toContain('Preciso de ajuda com uma coisa aqui');

    const pendingAfter = await prisma.whatsAppPendingTriage.findUnique({ where: { phone } });
    expect(pendingAfter).toBeNull();
  });

  it('resposta inválida ao menu: cai na categoria padrão em vez de travar', async () => {
    const phone = '5531966660004';
    await send(phone, 'Outra dúvida qualquer sem palavra-chave conhecida');
    const pending = await prisma.whatsAppPendingTriage.findUnique({ where: { phone } });
    expect(pending).toBeTruthy();

    await send(phone, 'não entendi o menu, pode me ligar?');

    const ticket = await prisma.ticket.findFirst({ where: { channel: 'WHATSAPP', contactPhone: phone } });
    expect(ticket).toBeTruthy();
    expect(ticket!.categoryId).not.toBe(categoriaTriagem.id);

    const pendingAfter = await prisma.whatsAppPendingTriage.findUnique({ where: { phone } });
    expect(pendingAfter).toBeNull();
  });
});

describe('Auditoria automática (mutação sem audit explícito)', () => {
  it('gera registro AUTO_* para rota que não audita', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/tickets', headers: auth(gestorToken),
      payload: { title: 'Chamado p/ watcher', description: 'auto-audit', categoryId: fx.categoryId, impact: 'UMA_PESSOA', urgency: 'EXISTE_ALTERNATIVA' },
    });
    const ticketId = created.json().id as string;

    // POST /watchers não chama audit() — a extensão deve cobrir
    const res = await app.inject({
      method: 'POST', url: `/api/tickets/${ticketId}/watchers`, headers: auth(gestorToken),
      payload: { userId: fx.users.tecnico.id },
    });
    expect(res.statusCode).toBe(200);

    // O flush é assíncrono no onResponse — aguarda um instante
    await new Promise((r) => setTimeout(r, 300));
    const log = await prisma.auditLog.findFirst({
      where: { entity: 'ticket_watchers', action: { startsWith: 'AUTO_' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).toBeTruthy();
    expect(log!.origin).toBe('auto');
    expect(log!.userId).toBe(fx.users.gestor.id);
  });

  it('não duplica auditoria quando a rota já auditou explicitamente', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/tickets', headers: auth(gestorToken),
      payload: { title: 'Sem duplicar auditoria', description: 'teste dedup', categoryId: fx.categoryId, impact: 'UMA_PESSOA', urgency: 'EXISTE_ALTERNATIVA' },
    });
    const ticketId = created.json().id as string;
    await new Promise((r) => setTimeout(r, 300));
    // Escopado ao chamado criado nesta chamada — testes de outros arquivos rodam em
    // paralelo e também criam/alteram chamados, então uma contagem global aqui seria instável.
    const autoLogs = await prisma.auditLog.count({ where: { entity: 'tickets', entityId: ticketId, action: { startsWith: 'AUTO_' } } });
    expect(autoLogs).toBe(0);
  });
});

describe('Rate limit', () => {
  it('cabeçalhos de limite presentes nas respostas', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });
});

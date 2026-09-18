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

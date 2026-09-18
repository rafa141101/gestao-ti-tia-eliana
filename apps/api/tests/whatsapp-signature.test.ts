import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.WHATSAPP_APP_SECRET = 'segredo-de-teste-app-secret';

// Import dinâmico: `import` estático é içado para o topo do módulo em ESM e rodaria
// antes da linha acima, fazendo env.js ler WHATSAPP_APP_SECRET vazio.
const { buildApp } = await import('../src/app.js');
const { prisma } = await import('../src/db.js');
const { createFixtures } = await import('./helpers.js');

let app: FastifyInstance;

const APP_SECRET = 'segredo-de-teste-app-secret';

function sign(rawBody: string): string {
  return `sha256=${crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
}

const webhookPayload = (from: string, text: string) => ({
  entry: [{
    changes: [{
      value: {
        contacts: [{ profile: { name: 'Renata da Loja' } }],
        messages: [{ from, type: 'text', text: { body: text } }],
      },
    }],
  }],
});

beforeAll(async () => {
  await createFixtures();
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Webhook WhatsApp — validação de assinatura (WHATSAPP_APP_SECRET definido)', () => {
  it('recusa requisição sem assinatura', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/integrations/whatsapp/webhook',
      payload: webhookPayload('5531999990001', 'sem assinatura'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('recusa requisição com assinatura inválida', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/integrations/whatsapp/webhook',
      payload: webhookPayload('5531999990002', 'assinatura errada'),
      headers: { 'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('aceita requisição com assinatura correta', async () => {
    const body = JSON.stringify(webhookPayload('5531999990003', 'assinatura correta'));
    const res = await app.inject({
      method: 'POST', url: '/api/integrations/whatsapp/webhook',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });
    expect(res.statusCode).toBe(200);

    const ticket = await prisma.ticket.findFirst({ where: { channel: 'WHATSAPP', contactPhone: '5531999990003' } });
    expect(ticket).toBeTruthy();
  });
});

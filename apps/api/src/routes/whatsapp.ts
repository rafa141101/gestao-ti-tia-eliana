import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { env } from '../env.js';
import { processIncomingWhatsApp, whatsappConfigured } from '../integrations/whatsapp.js';

/** Confere a assinatura HMAC-SHA256 que a Meta envia em cada chamada ao webhook. */
function validSignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', env.whatsappAppSecret).update(rawBody).digest('hex');
  const received = header.slice('sha256='.length);
  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(received, 'hex');
  return expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

interface WebhookMessage {
  from?: string;
  type?: string;
  text?: { body?: string };
}
interface WebhookBody {
  entry?: {
    changes?: {
      value?: {
        messages?: WebhookMessage[];
        contacts?: { profile?: { name?: string } }[];
      };
    }[];
  }[];
}

/**
 * Webhook da Meta Cloud API.
 * GET  → verificação do endpoint (hub.challenge).
 * POST → recebimento de mensagens; sempre responde 200 rápido (exigência da Meta).
 */
export async function whatsappRoutes(app: FastifyInstance) {
  // Guarda o corpo bruto (só neste plugin) para poder validar a assinatura antes de confiar no JSON.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get('/webhook', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === env.whatsappVerifyToken) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ error: 'Token de verificação inválido.' });
  });

  app.post('/webhook', async (req, reply) => {
    if (env.whatsappAppSecret) {
      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
      if (!validSignature(rawBody, req.headers['x-hub-signature-256'] as string | undefined)) {
        req.log.warn('[whatsapp] assinatura do webhook inválida — requisição descartada');
        return reply.code(401).send({ error: 'Assinatura inválida.' });
      }
    }
    const body = req.body as WebhookBody;
    try {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          const profileName = value?.contacts?.[0]?.profile?.name;
          for (const message of value?.messages ?? []) {
            if (message.type === 'text' && message.from && message.text?.body) {
              await processIncomingWhatsApp(message.from, message.text.body, profileName);
            }
          }
        }
      }
    } catch (err) {
      // Nunca devolver erro à Meta (evita re-entregas em loop); loga para investigação
      req.log.error({ err }, '[whatsapp] falha ao processar webhook');
    }
    return reply.send({ received: true });
  });

  /** Status da integração (usado na tela de Configurações). */
  app.get('/status', { preHandler: [app.authenticate] }, async () => ({
    configured: whatsappConfigured(),
    verifyTokenDefined: Boolean(env.whatsappVerifyToken),
    signatureValidationEnabled: Boolean(env.whatsappAppSecret),
    webhookPath: '/api/integrations/whatsapp/webhook',
  }));
}

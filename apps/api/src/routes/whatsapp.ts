import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { processIncomingWhatsApp, whatsappConfigured } from '../integrations/whatsapp.js';

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
  app.get('/webhook', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === env.whatsappVerifyToken) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ error: 'Token de verificação inválido.' });
  });

  app.post('/webhook', async (req, reply) => {
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
    webhookPath: '/api/integrations/whatsapp/webhook',
  }));
}

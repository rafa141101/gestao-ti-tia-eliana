import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './env.js';
import { registerAuth } from './plugins/auth.js';
import { AppError } from './lib/errors.js';
import { requestContext, newRequestContext } from './lib/context.js';
import { rawPrisma } from './db.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { structureRoutes } from './routes/structure.js';
import { categoryRoutes } from './routes/categories.js';
import { ticketRoutes } from './routes/tickets.js';
import { worklogRoutes } from './routes/worklogs.js';
import { attachmentRoutes } from './routes/attachments.js';
import { projectRoutes } from './routes/projects.js';
import { routineRoutes } from './routes/routines.js';
import { assetRoutes } from './routes/assets.js';
import { movementRoutes } from './routes/movements.js';
import { maintenanceRoutes } from './routes/maintenance.js';
import { thirdPartyRoutes } from './routes/third-parties.js';
import { notificationRoutes } from './routes/notifications.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { reportRoutes } from './routes/reports.js';
import { auditRoutes } from './routes/audit.js';
import { settingsRoutes } from './routes/settings.js';
import { publicRoutes } from './routes/public.js';
import { searchRoutes } from './routes/search.js';
import { whatsappRoutes } from './routes/whatsapp.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.nodeEnv === 'test' ? 'silent' : 'info' },
    trustProxy: true,
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwt, { secret: env.jwtSecret, sign: { expiresIn: env.jwtExpiresIn } });
  await app.register(multipart, { limits: { fileSize: env.uploadMaxBytes, files: 5 } });
  // Proteção global contra abuso/força bruta (login tem limite mais rígido na rota)
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: 'Muitas requisições. Aguarde um instante e tente novamente.' }),
  });

  registerAuth(app);

  // Contexto por requisição: usuário/IP para auditoria + coleta de mutações
  app.addHook('onRequest', (req, _reply, done) => {
    requestContext.run(newRequestContext(req.ip, req.headers['user-agent'] as string | undefined), done);
  });

  // Auditoria automática: grava o que a rota não auditou explicitamente
  app.addHook('onResponse', (_req, _reply, done) => {
    const ctx = requestContext.getStore();
    if (ctx && ctx.mutations.length > 0) {
      const pending = ctx.mutations.filter(
        (m) => !ctx.audited.has(`${m.table}:${m.entityId ?? 'many'}`) && !ctx.audited.has(`${m.table}:many`),
      );
      for (const m of pending) {
        rawPrisma.auditLog.create({
          data: {
            userId: ctx.userId ?? null,
            action: m.action,
            entity: m.table,
            entityId: m.entityId,
            after: m.payload === null || m.payload === undefined ? undefined : (m.payload as never),
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
            origin: 'auto',
          },
        }).catch((err: unknown) => console.error('[audit-auto] falha:', err));
      }
    }
    done();
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const msg = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.code(400).send({ error: `Dados inválidos — ${msg}` });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    if ((err as { statusCode?: number }).statusCode === 413) {
      return reply.code(413).send({ error: 'Arquivo excede o tamanho máximo permitido.' });
    }
    // Erros do próprio Fastify (payload inválido, content-length, etc.) mantêm o código original
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (err as Error).message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'Erro interno do servidor.' });
  });

  app.get('/api/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(structureRoutes, { prefix: '/api/structure' });
  await app.register(categoryRoutes, { prefix: '/api/catalog' });
  await app.register(ticketRoutes, { prefix: '/api/tickets' });
  await app.register(worklogRoutes, { prefix: '/api/worklogs' });
  await app.register(attachmentRoutes, { prefix: '/api/attachments' });
  await app.register(projectRoutes, { prefix: '/api/projects' });
  await app.register(routineRoutes, { prefix: '/api/routines' });
  await app.register(assetRoutes, { prefix: '/api/assets' });
  await app.register(movementRoutes, { prefix: '/api/movements' });
  await app.register(maintenanceRoutes, { prefix: '/api/maintenance' });
  await app.register(thirdPartyRoutes, { prefix: '/api/third-parties' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(reportRoutes, { prefix: '/api/reports' });
  await app.register(auditRoutes, { prefix: '/api/audit' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(publicRoutes, { prefix: '/api/public' });
  await app.register(searchRoutes, { prefix: '/api/search' });
  await app.register(whatsappRoutes, { prefix: '/api/integrations/whatsapp' });

  return app;
}

import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.authUser.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { userId: req.authUser.id, readAt: null } }),
    ]);
    return { items, unreadCount };
  });

  app.post('/:id/read', async (req) => {
    const { id } = req.params as { id: string };
    await prisma.notification.updateMany({
      where: { id, userId: req.authUser.id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });

  app.post('/read-all', async (req) => {
    await prisma.notification.updateMany({
      where: { userId: req.authUser.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
}

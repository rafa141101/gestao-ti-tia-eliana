import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export async function auditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('audit.view'));

  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Number(q.pageSize ?? 50));
    const where = {
      entity: q.entity,
      userId: q.userId,
      action: q.action ? { contains: q.action, mode: 'insensitive' as const } : undefined,
      entityId: q.entityId,
      createdAt: q.from || q.to ? {
        gte: q.from ? new Date(q.from) : undefined,
        lte: q.to ? new Date(`${q.to}T23:59:59`) : undefined,
      } : undefined,
    };
    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  });
}

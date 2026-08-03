import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';

const schema = z.object({
  name: z.string().min(2),
  serviceType: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('').transform(() => null)),
  phone: z.string().nullable().optional(),
  contract: z.string().nullable().optional(),
  slaInfo: z.string().nullable().optional(),
  serviceHours: z.string().nullable().optional(),
  systems: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export async function thirdPartyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async () => {
    return prisma.thirdParty.findMany({
      where: { active: true },
      include: { _count: { select: { tickets: { where: { status: { notIn: ['FECHADO', 'CANCELADO'] } } } } } },
      orderBy: { name: 'asc' },
    });
  });

  app.post('/', { preHandler: [app.requirePermission('thirdparties.manage')] }, async (req, reply) => {
    const data = schema.parse(req.body);
    const tp = await prisma.thirdParty.create({ data });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'third_parties', entityId: tp.id, req, after: { name: tp.name } });
    return reply.code(201).send(tp);
  });

  app.patch('/:id', { preHandler: [app.requirePermission('thirdparties.manage')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = schema.partial().parse(req.body);
    const before = await prisma.thirdParty.findUnique({ where: { id } });
    if (!before) throw new AppError('Terceiro não encontrado.', 404);
    const after = await prisma.thirdParty.update({ where: { id }, data });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'third_parties', entityId: id, req, before: { name: before.name }, after: data });
    return after;
  });
}

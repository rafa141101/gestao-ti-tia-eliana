import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';

const nameSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  active: z.boolean().optional(),
});

/** Unidades, setores, organizações e filas. Leitura para autenticados; escrita exige admin.structure. */
export async function structureRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/all', async () => {
    const [organizations, units, departments, queues] = await Promise.all([
      prisma.organization.findMany({ orderBy: { name: 'asc' } }),
      prisma.unit.findMany({ orderBy: { name: 'asc' } }),
      prisma.department.findMany({ orderBy: { name: 'asc' } }),
      prisma.queue.findMany({ orderBy: { name: 'asc' } }),
    ]);
    return { organizations, units, departments, queues };
  });

  // ---- Unidades ----
  app.post('/units', { preHandler: [app.requirePermission('admin.structure')] }, async (req, reply) => {
    const data = nameSchema.parse(req.body);
    const org = await prisma.organization.findFirst({ where: { active: true } });
    if (!org) throw new AppError('Nenhuma organização cadastrada.', 400);
    const unit = await prisma.unit.create({ data: { name: data.name, code: data.code, organizationId: org.id } });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'units', entityId: unit.id, req, after: data });
    return reply.code(201).send(unit);
  });

  app.patch('/units/:id', { preHandler: [app.requirePermission('admin.structure')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = nameSchema.partial().parse(req.body);
    const before = await prisma.unit.findUnique({ where: { id } });
    if (!before) throw new AppError('Unidade não encontrada.', 404);
    const after = await prisma.unit.update({ where: { id }, data });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'units', entityId: id, req, before, after });
    return after;
  });

  // ---- Setores ----
  app.post('/departments', { preHandler: [app.requirePermission('admin.structure')] }, async (req, reply) => {
    const data = nameSchema.extend({ unitId: z.string().uuid().nullable().optional() }).parse(req.body);
    const dep = await prisma.department.create({ data: { name: data.name, unitId: data.unitId ?? null } });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'departments', entityId: dep.id, req, after: data });
    return reply.code(201).send(dep);
  });

  app.patch('/departments/:id', { preHandler: [app.requirePermission('admin.structure')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = nameSchema.extend({ unitId: z.string().uuid().nullable().optional() }).partial().parse(req.body);
    const before = await prisma.department.findUnique({ where: { id } });
    if (!before) throw new AppError('Setor não encontrado.', 404);
    const after = await prisma.department.update({ where: { id }, data });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'departments', entityId: id, req, before, after });
    return after;
  });

  // ---- Filas ----
  app.post('/queues', { preHandler: [app.requirePermission('admin.structure')] }, async (req, reply) => {
    const data = z.object({ name: z.string().min(2), description: z.string().optional() }).parse(req.body);
    const queue = await prisma.queue.create({ data });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'queues', entityId: queue.id, req, after: data });
    return reply.code(201).send(queue);
  });

  app.patch('/queues/:id', { preHandler: [app.requirePermission('admin.structure')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = z.object({
      name: z.string().min(2).optional(),
      description: z.string().optional(),
      active: z.boolean().optional(),
      assignmentMode: z.enum(['MANUAL', 'ROUND_ROBIN']).optional(),
    }).parse(req.body);
    const before = await prisma.queue.findUnique({ where: { id } });
    if (!before) throw new AppError('Fila não encontrada.', 404);
    const after = await prisma.queue.update({ where: { id }, data });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'queues', entityId: id, req, before, after });
    return after;
  });

  /** Membros da fila (usados no rodízio de distribuição automática). */
  app.get('/queues/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    return prisma.queueMember.findMany({
      where: { queueId: id },
      include: { user: { select: { id: true, name: true, role: true, active: true } } },
    });
  });

  app.put('/queues/:id/members', { preHandler: [app.requirePermission('admin.structure')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { userIds } = z.object({ userIds: z.array(z.string().uuid()) }).parse(req.body);
    const queue = await prisma.queue.findUnique({ where: { id } });
    if (!queue) throw new AppError('Fila não encontrada.', 404);
    await prisma.$transaction([
      prisma.queueMember.deleteMany({ where: { queueId: id } }),
      prisma.queueMember.createMany({ data: userIds.map((userId) => ({ queueId: id, userId })) }),
    ]);
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'queue_members', entityId: id, req, after: { userIds } });
    return { ok: true };
  });

  // ---- Organizações ----
  app.patch('/organizations/:id', { preHandler: [app.requirePermission('admin.settings')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = z.object({ name: z.string().min(2).optional(), tradeName: z.string().optional() }).parse(req.body);
    const before = await prisma.organization.findUnique({ where: { id } });
    if (!before) throw new AppError('Organização não encontrada.', 404);
    const after = await prisma.organization.update({ where: { id }, data });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'organizations', entityId: id, req, before, after });
    return after;
  });
}

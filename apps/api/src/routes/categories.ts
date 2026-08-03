import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { PRIORITIES, SLA_MODES } from '@gestao-ti/shared';

const categorySchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  defaultQueueId: z.string().uuid().nullable().optional(),
  defaultPriority: z.enum(PRIORITIES).nullable().optional(),
  slaPolicyId: z.string().uuid().nullable().optional(),
  formSchema: z.array(z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(['text', 'textarea', 'select', 'boolean', 'number']),
    options: z.array(z.string()).optional(),
    required: z.boolean().optional(),
  })).nullable().optional(),
  responseTemplate: z.string().nullable().optional(),
  requiresApproval: z.boolean().optional(),
  active: z.boolean().optional(),
});

const slaPolicySchema = z.object({
  name: z.string().min(2),
  mode: z.enum(SLA_MODES).optional(),
  businessStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  businessEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  workdays: z.string().optional(),
  firstResponseP1: z.number().int().positive().optional(),
  firstResponseP2: z.number().int().positive().optional(),
  firstResponseP3: z.number().int().positive().optional(),
  firstResponseP4: z.number().int().positive().optional(),
  resolutionP1: z.number().int().positive().optional(),
  resolutionP2: z.number().int().positive().optional(),
  resolutionP3: z.number().int().positive().optional(),
  resolutionP4: z.number().int().positive().optional(),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** Catálogo: categorias, subcategorias, políticas de SLA e feriados. */
export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/categories', async () => {
    return prisma.category.findMany({
      where: { active: true },
      include: { subcategories: { where: { active: true } }, slaPolicy: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  });

  app.post('/categories', { preHandler: [app.requirePermission('admin.structure')] }, async (req, reply) => {
    const data = categorySchema.parse(req.body);
    const cat = await prisma.category.create({ data: { ...data, formSchema: data.formSchema ?? undefined } });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'categories', entityId: cat.id, req, after: data });
    return reply.code(201).send(cat);
  });

  app.patch('/categories/:id', { preHandler: [app.requirePermission('admin.structure')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = categorySchema.partial().parse(req.body);
    const before = await prisma.category.findUnique({ where: { id } });
    if (!before) throw new AppError('Categoria não encontrada.', 404);
    const after = await prisma.category.update({ where: { id }, data: { ...data, formSchema: data.formSchema ?? undefined } });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'categories', entityId: id, req, before: { name: before.name }, after: data });
    return after;
  });

  app.post('/categories/:id/subcategories', { preHandler: [app.requirePermission('admin.structure')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = z.object({ name: z.string().min(2) }).parse(req.body);
    const sub = await prisma.subcategory.create({ data: { categoryId: id, name: data.name } });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'subcategories', entityId: sub.id, req, after: data });
    return reply.code(201).send(sub);
  });

  app.patch('/subcategories/:id', { preHandler: [app.requirePermission('admin.structure')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = z.object({ name: z.string().min(2).optional(), active: z.boolean().optional() }).parse(req.body);
    const after = await prisma.subcategory.update({ where: { id }, data });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'subcategories', entityId: id, req, after: data });
    return after;
  });

  // ---- Políticas de SLA ----
  app.get('/sla-policies', async () => {
    return prisma.slaPolicy.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  });

  app.post('/sla-policies', { preHandler: [app.requirePermission('admin.structure')] }, async (req, reply) => {
    const data = slaPolicySchema.parse(req.body);
    const policy = await prisma.slaPolicy.create({ data });
    if (data.isDefault) {
      await prisma.slaPolicy.updateMany({ where: { id: { not: policy.id } }, data: { isDefault: false } });
    }
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'sla_policies', entityId: policy.id, req, after: data });
    return reply.code(201).send(policy);
  });

  app.patch('/sla-policies/:id', { preHandler: [app.requirePermission('admin.structure')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = slaPolicySchema.partial().parse(req.body);
    const before = await prisma.slaPolicy.findUnique({ where: { id } });
    if (!before) throw new AppError('Política de SLA não encontrada.', 404);
    // Alterações de SLA não são retroativas: chamados existentes mantêm seus prazos.
    const after = await prisma.slaPolicy.update({ where: { id }, data });
    if (data.isDefault) {
      await prisma.slaPolicy.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    }
    await audit({ userId: req.authUser.id, action: 'ALTERACAO_SLA', entity: 'sla_policies', entityId: id, req, before, after });
    return after;
  });

  // ---- Feriados ----
  app.get('/holidays', async () => prisma.holiday.findMany({ orderBy: { date: 'asc' } }));

  app.post('/holidays', { preHandler: [app.requirePermission('admin.structure')] }, async (req, reply) => {
    const data = z.object({ date: z.string(), name: z.string().min(2) }).parse(req.body);
    const holiday = await prisma.holiday.create({ data: { date: new Date(data.date), name: data.name } });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'holidays', entityId: holiday.id, req, after: data });
    return reply.code(201).send(holiday);
  });

  app.delete('/holidays/:id', { preHandler: [app.requirePermission('admin.structure')] }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.holiday.delete({ where: { id } });
    await audit({ userId: req.authUser.id, action: 'EXCLUSAO', entity: 'holidays', entityId: id, req });
    return { ok: true };
  });
}

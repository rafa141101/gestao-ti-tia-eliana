import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { MAINTENANCE_TYPES } from '@gestao-ti/shared';

const schema = z.object({
  assetId: z.string().uuid(),
  ticketId: z.string().uuid().nullable().optional(),
  type: z.enum(MAINTENANCE_TYPES),
  description: z.string().min(3),
  diagnosis: z.string().nullable().optional(),
  serviceDone: z.string().nullable().optional(),
  responsibleId: z.string().uuid().nullable().optional(),
  thirdPartyId: z.string().uuid().nullable().optional(),
  date: z.string().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  partsUsed: z.string().nullable().optional(),
  cost: z.number().nonnegative().nullable().optional(),
  result: z.string().nullable().optional(),
  operational: z.boolean().nullable().optional(),
  nextMaintenanceAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function maintenanceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('inventory.view'));

  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return prisma.maintenanceRecord.findMany({
      where: {
        assetId: q.assetId,
        type: q.type as never,
      },
      include: {
        asset: { select: { id: true, code: true, description: true } },
        responsible: { select: { id: true, name: true } },
        thirdParty: { select: { id: true, name: true } },
        ticket: { select: { id: true, number: true } },
      },
      orderBy: { date: 'desc' },
      take: 300,
    });
  });

  app.post('/', { preHandler: [app.requirePermission('inventory.manage')] }, async (req, reply) => {
    const data = schema.parse(req.body);
    const asset = await prisma.asset.findUnique({ where: { id: data.assetId } });
    if (!asset) throw new AppError('Ativo não encontrado.', 404);

    const record = await prisma.$transaction(async (tx) => {
      const r = await tx.maintenanceRecord.create({
        data: {
          ...data,
          date: data.date ? new Date(data.date) : new Date(),
          nextMaintenanceAt: data.nextMaintenanceAt ? new Date(data.nextMaintenanceAt) : null,
          responsibleId: data.responsibleId ?? req.authUser.id,
          createdById: req.authUser.id,
        },
      });
      if (data.nextMaintenanceAt) {
        await tx.asset.update({ where: { id: data.assetId }, data: { nextMaintenanceAt: new Date(data.nextMaintenanceAt) } });
      }
      return r;
    });
    await audit({ userId: req.authUser.id, action: 'MANUTENCAO', entity: 'maintenance_records', entityId: record.id, req, after: { assetCode: asset.code, type: data.type } });
    return reply.code(201).send(record);
  });

  app.patch('/:id', { preHandler: [app.requirePermission('inventory.manage')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = schema.partial().omit({ assetId: true }).parse(req.body);
    const before = await prisma.maintenanceRecord.findUnique({ where: { id } });
    if (!before) throw new AppError('Manutenção não encontrada.', 404);
    const after = await prisma.maintenanceRecord.update({
      where: { id },
      data: {
        ...data,
        date: data.date ? new Date(data.date) : undefined,
        nextMaintenanceAt: data.nextMaintenanceAt !== undefined ? (data.nextMaintenanceAt ? new Date(data.nextMaintenanceAt) : null) : undefined,
      },
    });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'maintenance_records', entityId: id, req, before: { result: before.result }, after: data });
    return after;
  });
}

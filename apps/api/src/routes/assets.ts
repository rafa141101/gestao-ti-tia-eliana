import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { nextAssetCode, generatePublicId } from '../lib/numbers.js';
import { ASSET_STATUSES, ASSET_KINDS, COMPONENT_STATUSES, CRITICALITIES } from '@gestao-ti/shared';
import type { Prisma } from '@prisma/client';

const assetSchema = z.object({
  patrimonyCode: z.string().nullable().optional(),
  categoryId: z.string().uuid(),
  family: z.string().nullable().optional(),
  kind: z.enum(ASSET_KINDS).optional(),
  description: z.string().min(2),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  unitId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  location: z.string().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  custodianId: z.string().uuid().nullable().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  criticality: z.enum(CRITICALITIES).optional(),
  purchaseDate: z.string().nullable().optional(),
  purchaseValue: z.number().nonnegative().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  warrantyStart: z.string().nullable().optional(),
  warrantyEnd: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
  mac: z.string().nullable().optional(),
  os: z.string().nullable().optional(),
  hostname: z.string().nullable().optional(),
  specs: z.record(z.unknown()).nullable().optional(),
  quantity: z.number().int().positive().optional(),
  minStock: z.number().int().nonnegative().nullable().optional(),
  nextMaintenanceAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const componentSchema = z.object({
  type: z.string().min(2),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  capacity: z.string().nullable().optional(),
  installedAt: z.string().nullable().optional(),
  warrantyEnd: z.string().nullable().optional(),
  supplier: z.string().nullable().optional(),
  cost: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
});

function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v ? new Date(v) : null;
}

export async function assetRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('inventory.view'));

  app.get('/categories', async () => {
    return prisma.assetCategory.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  });

  app.post('/categories', { preHandler: [app.requirePermission('admin.structure')] }, async (req, reply) => {
    const { name } = z.object({ name: z.string().min(2) }).parse(req.body);
    const cat = await prisma.assetCategory.create({ data: { name } });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'asset_categories', entityId: cat.id, req, after: { name } });
    return reply.code(201).send(cat);
  });

  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: Prisma.AssetWhereInput = {
      active: true,
      status: q.status ? { in: q.status.split(',') as never } : undefined,
      categoryId: q.categoryId,
      unitId: q.unitId,
      kind: q.kind as never,
      OR: q.search ? [
        { code: { contains: q.search, mode: 'insensitive' } },
        { patrimonyCode: { contains: q.search, mode: 'insensitive' } },
        { description: { contains: q.search, mode: 'insensitive' } },
        { serialNumber: { contains: q.search, mode: 'insensitive' } },
        { hostname: { contains: q.search, mode: 'insensitive' } },
      ] : undefined,
    };
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Number(q.pageSize ?? 25));
    const [total, items] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where,
        include: {
          category: { select: { name: true } },
          unit: { select: { name: true } },
          department: { select: { name: true } },
          user: { select: { id: true, name: true } },
        },
        orderBy: { code: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  });

  /** Visão de estoque de reserva. */
  app.get('/reserve', async () => {
    const reserve = await prisma.asset.findMany({
      where: { active: true, status: { in: ['RESERVA', 'DISPONIVEL', 'EM_MANUTENCAO', 'AGUARDANDO_PECA'] } },
      include: { category: { select: { name: true } }, unit: { select: { name: true } } },
      orderBy: [{ categoryId: 'asc' }, { code: 'asc' }],
    });
    const byCategory: Record<string, { category: string; disponivel: number; reserva: number; manutencao: number; aguardandoPeca: number }> = {};
    for (const a of reserve) {
      const key = a.category.name;
      byCategory[key] ??= { category: key, disponivel: 0, reserva: 0, manutencao: 0, aguardandoPeca: 0 };
      if (a.status === 'DISPONIVEL') byCategory[key].disponivel += a.quantity;
      if (a.status === 'RESERVA') byCategory[key].reserva += a.quantity;
      if (a.status === 'EM_MANUTENCAO') byCategory[key].manutencao += a.quantity;
      if (a.status === 'AGUARDANDO_PECA') byCategory[key].aguardandoPeca += a.quantity;
    }
    return { summary: Object.values(byCategory), items: reserve };
  });

  app.post('/', { preHandler: [app.requirePermission('inventory.register')] }, async (req, reply) => {
    const data = assetSchema.parse(req.body);
    const now = new Date();
    const asset = await prisma.$transaction(async (tx) => {
      const code = await nextAssetCode(tx, now);
      // publicId único (re-tenta em caso de colisão improvável)
      let publicId = generatePublicId();
      for (let i = 0; i < 5; i++) {
        const clash = await tx.asset.findUnique({ where: { publicId } });
        if (!clash) break;
        publicId = generatePublicId();
      }
      return tx.asset.create({
        data: {
          ...data,
          code,
          publicId,
          specs: (data.specs ?? undefined) as Prisma.InputJsonValue | undefined,
          purchaseDate: toDate(data.purchaseDate),
          warrantyStart: toDate(data.warrantyStart),
          warrantyEnd: toDate(data.warrantyEnd),
          nextMaintenanceAt: toDate(data.nextMaintenanceAt),
          createdById: req.authUser.id,
        },
      });
    });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'assets', entityId: asset.id, req, after: { code: asset.code, description: asset.description } });
    return reply.code(201).send(asset);
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const asset = await prisma.asset.findUnique({
      where: { id },
      include: {
        category: true,
        unit: true,
        department: true,
        user: { select: { id: true, name: true } },
        custodian: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        components: { orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] },
        movements: {
          include: {
            fromUnit: { select: { name: true } }, toUnit: { select: { name: true } },
            requestedBy: { select: { name: true } }, receivedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        maintenances: {
          include: { responsible: { select: { name: true } }, thirdParty: { select: { name: true } } },
          orderBy: { date: 'desc' },
        },
        tickets: { select: { id: true, number: true, title: true, status: true, openedAt: true }, orderBy: { openedAt: 'desc' }, take: 20 },
        attachments: true,
      },
    });
    if (!asset) throw new AppError('Ativo não encontrado.', 404);
    return asset;
  });

  app.patch('/:id', { preHandler: [app.requirePermission('inventory.register')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = assetSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    const before = await prisma.asset.findUnique({ where: { id } });
    if (!before) throw new AppError('Ativo não encontrado.', 404);

    // Localização/unidade não muda por edição direta: exige movimentação (regra 21.12)
    if ((data.unitId !== undefined && data.unitId !== before.unitId) ||
        (data.departmentId !== undefined && data.departmentId !== before.departmentId)) {
      throw new AppError('Unidade/setor de um ativo só mudam por movimentação registrada.', 400);
    }

    const after = await prisma.asset.update({
      where: { id },
      data: {
        ...data,
        unitId: undefined,
        departmentId: undefined,
        specs: (data.specs ?? undefined) as Prisma.InputJsonValue | undefined,
        purchaseDate: toDate(data.purchaseDate),
        warrantyStart: toDate(data.warrantyStart),
        warrantyEnd: toDate(data.warrantyEnd),
        nextMaintenanceAt: toDate(data.nextMaintenanceAt),
      },
    });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'assets', entityId: id, req, before: { status: before.status, description: before.description }, after: data });
    return after;
  });

  // ---- Componentes ----
  app.post('/:id/components', { preHandler: [app.requirePermission('inventory.register')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = componentSchema.parse(req.body);
    const comp = await prisma.assetComponent.create({
      data: {
        ...data,
        assetId: id,
        installedAt: toDate(data.installedAt) ?? new Date(),
        warrantyEnd: toDate(data.warrantyEnd),
      },
    });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'asset_components', entityId: comp.id, req, after: { type: comp.type, assetId: id } });
    return reply.code(201).send(comp);
  });

  /** Substituição/retirada de componente — o histórico permanece (regra 21.13). */
  app.post('/components/:compId/remove', { preHandler: [app.requirePermission('inventory.register')] }, async (req) => {
    const { compId } = req.params as { compId: string };
    const { destination, notes } = z.object({
      destination: z.enum(COMPONENT_STATUSES).refine((s) => s !== 'INSTALADO', 'Escolha um destino válido'),
      notes: z.string().optional(),
    }).parse(req.body);
    const comp = await prisma.assetComponent.findUnique({ where: { id: compId } });
    if (!comp) throw new AppError('Componente não encontrado.', 404);
    if (comp.status !== 'INSTALADO') throw new AppError('Componente já removido.', 400);
    const updated = await prisma.assetComponent.update({
      where: { id: compId },
      data: { status: destination, removedAt: new Date(), notes: notes ?? comp.notes },
    });
    await audit({ userId: req.authUser.id, action: 'REMOCAO_COMPONENTE', entity: 'asset_components', entityId: compId, req, before: { status: 'INSTALADO' }, after: { status: destination } });
    return updated;
  });

  app.patch('/components/:compId', { preHandler: [app.requirePermission('inventory.register')] }, async (req) => {
    const { compId } = req.params as { compId: string };
    const data = componentSchema.partial().parse(req.body);
    const updated = await prisma.assetComponent.update({
      where: { id: compId },
      data: { ...data, installedAt: toDate(data.installedAt), warrantyEnd: toDate(data.warrantyEnd) },
    });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'asset_components', entityId: compId, req, after: data });
    return updated;
  });
}

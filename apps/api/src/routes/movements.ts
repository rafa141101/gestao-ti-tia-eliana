import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { notifyRoles } from '../lib/notify.js';
import { MOVEMENT_TYPES, MOVEMENT_STATUSES, MOVEMENT_STATUS_TRANSITIONS, type MovementStatus, type MovementType } from '@gestao-ti/shared';

const createSchema = z.object({
  assetId: z.string().uuid(),
  type: z.enum(MOVEMENT_TYPES),
  toUnitId: z.string().uuid().nullable().optional(),
  toDepartmentId: z.string().uuid().nullable().optional(),
  toUserId: z.string().uuid().nullable().optional(),
  reason: z.string().min(3, 'Informe o motivo da movimentação'),
  notes: z.string().optional(),
});

/** Status do ativo durante/depois da movimentação, conforme o tipo. */
function assetStatusAfter(type: MovementType): string | null {
  switch (type) {
    case 'ENVIO_MANUTENCAO': return 'EM_MANUTENCAO';
    case 'RETORNO_MANUTENCAO': return 'DISPONIVEL';
    case 'EMPRESTIMO': return 'EMPRESTADO';
    case 'DEVOLUCAO': return 'DISPONIVEL';
    case 'ENVIO_DESCARTE': return 'AGUARDANDO_DESCARTE';
    case 'RETIRADA_RESERVA': return 'EM_USO';
    case 'RETORNO_RESERVA': return 'RESERVA';
    default: return null; // transferências mantêm o status
  }
}

export async function movementRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('inventory.view'));

  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return prisma.assetMovement.findMany({
      where: {
        status: q.status ? { in: q.status.split(',') as MovementStatus[] } : undefined,
        assetId: q.assetId,
        pending: undefined,
        ...(q.pending === 'true' ? { status: { notIn: ['CONFIRMADA', 'CANCELADA', 'RETORNADA'] } } : {}),
      } as never,
      include: {
        asset: { select: { id: true, code: true, description: true } },
        fromUnit: { select: { name: true } }, toUnit: { select: { name: true } },
        fromDepartment: { select: { name: true } }, toDepartment: { select: { name: true } },
        requestedBy: { select: { id: true, name: true } },
        sentBy: { select: { name: true } }, receivedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  });

  app.post('/', { preHandler: [app.requirePermission('inventory.manage')] }, async (req, reply) => {
    const data = createSchema.parse(req.body);
    const asset = await prisma.asset.findUnique({ where: { id: data.assetId } });
    if (!asset || !asset.active) throw new AppError('Ativo não encontrado.', 404);
    if (asset.status === 'DESCARTADO') throw new AppError('Ativo descartado não pode ser movimentado.', 400);

    const openMovement = await prisma.assetMovement.findFirst({
      where: { assetId: data.assetId, status: { notIn: ['CONFIRMADA', 'CANCELADA', 'RETORNADA'] } },
    });
    if (openMovement) throw new AppError('Este ativo já tem uma movimentação em andamento.', 409);

    const movement = await prisma.$transaction(async (tx) => {
      const m = await tx.assetMovement.create({
        data: {
          assetId: data.assetId,
          type: data.type,
          fromUnitId: asset.unitId,
          fromDepartmentId: asset.departmentId,
          fromUserId: asset.userId,
          toUnitId: data.toUnitId ?? null,
          toDepartmentId: data.toDepartmentId ?? null,
          toUserId: data.toUserId ?? null,
          requestedById: req.authUser.id,
          reason: data.reason,
          notes: data.notes,
        },
      });
      await tx.asset.update({ where: { id: asset.id }, data: { status: 'EM_TRANSFERENCIA' } });
      return m;
    });
    await audit({ userId: req.authUser.id, action: 'MOVIMENTACAO', entity: 'asset_movements', entityId: movement.id, req, after: { assetCode: asset.code, type: data.type, reason: data.reason } });
    await notifyRoles(['GESTOR_TI'], 'movimentacao_pendente', `Movimentação solicitada: ${asset.code}`, data.reason, 'asset_movements', movement.id);
    return reply.code(201).send(movement);
  });

  /** Avança/cancela a movimentação seguindo o fluxo Solicitada → ... → Confirmada. */
  app.post('/:id/status', { preHandler: [app.requirePermission('inventory.manage')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { status, equipmentCondition, notes } = z.object({
      status: z.enum(MOVEMENT_STATUSES),
      equipmentCondition: z.string().optional(),
      notes: z.string().optional(),
    }).parse(req.body);

    const movement = await prisma.assetMovement.findUnique({ where: { id }, include: { asset: true } });
    if (!movement) throw new AppError('Movimentação não encontrada.', 404);
    const from = movement.status as MovementStatus;
    if (!MOVEMENT_STATUS_TRANSITIONS[from].includes(status)) {
      throw new AppError(`Transição inválida: ${from} → ${status}.`, 400);
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.assetMovement.update({
        where: { id },
        data: {
          status,
          equipmentCondition: equipmentCondition ?? movement.equipmentCondition,
          notes: notes ?? movement.notes,
          sentById: status === 'RETIRADA' || status === 'EM_TRANSPORTE' ? req.authUser.id : movement.sentById,
          receivedById: status === 'RECEBIDA' ? req.authUser.id : movement.receivedById,
          confirmedAt: status === 'CONFIRMADA' ? now : movement.confirmedAt,
        },
      });

      // Confirmada: aplica destino no ativo (única forma de mudar localização — regra 21.12)
      if (status === 'CONFIRMADA') {
        const newStatus = assetStatusAfter(movement.type as MovementType);
        await tx.asset.update({
          where: { id: movement.assetId },
          data: {
            unitId: movement.toUnitId ?? movement.asset.unitId,
            departmentId: movement.toDepartmentId ?? movement.asset.departmentId,
            userId: movement.type === 'TROCA_USUARIO' || movement.toUserId ? movement.toUserId : movement.asset.userId,
            status: (newStatus ?? (movement.asset.userId || movement.toUserId ? 'EM_USO' : movement.asset.status === 'EM_TRANSFERENCIA' ? 'EM_USO' : movement.asset.status)) as never,
          },
        });
      }
      // Cancelada/retornada: ativo volta ao estado/local de origem
      if (status === 'CANCELADA' || status === 'RETORNADA') {
        await tx.asset.update({
          where: { id: movement.assetId },
          data: { status: (movement.fromUserId ? 'EM_USO' : 'DISPONIVEL') as never },
        });
      }
    });

    await audit({
      userId: req.authUser.id, action: `MOVIMENTACAO_${status}`, entity: 'asset_movements', entityId: id, req,
      before: { status: from }, after: { status },
    });
    return { ok: true };
  });
}

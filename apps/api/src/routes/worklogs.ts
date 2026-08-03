import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { WORKLOG_TYPES, hasPermission, DEFAULT_SETTINGS } from '@gestao-ti/shared';
import type { Prisma } from '@prisma/client';

async function wipLimit(): Promise<number> {
  const s = await prisma.systemSetting.findUnique({ where: { key: 'wipLimit' } });
  return typeof s?.value === 'number' ? s.value : DEFAULT_SETTINGS.wipLimit;
}

const startSchema = z.object({
  type: z.enum(WORKLOG_TYPES),
  ticketId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  routineExecutionId: z.string().uuid().optional(),
  maintenanceId: z.string().uuid().optional(),
  description: z.string().optional(),
});

const manualSchema = startSchema.extend({
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  description: z.string().min(3, 'Descreva o que foi feito'),
  result: z.string().optional(),
  nextStep: z.string().optional(),
});

function minutesBetween(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 60_000));
}

export async function worklogRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Atividade em andamento do usuário atual. */
  app.get('/running', async (req) => {
    return prisma.worklog.findFirst({
      where: { userId: req.authUser.id, endedAt: null, active: true },
      include: {
        ticket: { select: { id: true, number: true, title: true, priority: true } },
        task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
        routineExecution: { select: { id: true, routine: { select: { name: true } } } },
        maintenance: { select: { id: true, description: true } },
      },
    });
  });

  /** Lista de apontamentos (gestor vê todos; técnico vê os seus). */
  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const u = req.authUser;
    const canSeeAll = hasPermission(u.role, 'tickets.manage') || hasPermission(u.role, 'audit.view');
    const where: Prisma.WorklogWhereInput = {
      userId: canSeeAll ? q.userId : u.id,
      ticketId: q.ticketId,
      startedAt: q.from || q.to ? {
        gte: q.from ? new Date(q.from) : undefined,
        lte: q.to ? new Date(q.to) : undefined,
      } : undefined,
      active: q.includeVoided === 'true' ? undefined : true,
    };
    return prisma.worklog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        ticket: { select: { id: true, number: true, title: true } },
        task: { select: { id: true, title: true, project: { select: { name: true } } } },
        routineExecution: { select: { routine: { select: { name: true } } } },
      },
      orderBy: { startedAt: 'desc' },
      take: 500,
    });
  });

  /**
   * Inicia uma atividade. Regras:
   * - Encerra automaticamente a atividade anterior em aberto (registrando interrupção).
   * - Limite de chamados simultâneos "Em atendimento" por técnico (P1 fura o limite).
   */
  app.post('/start', { preHandler: [app.requirePermission('tickets.work')] }, async (req, reply) => {
    const data = startSchema.parse(req.body);
    const u = req.authUser;
    const now = new Date();

    if (!data.ticketId && !data.taskId && !data.routineExecutionId && !data.maintenanceId) {
      throw new AppError('Vincule a atividade a um chamado, tarefa, rotina ou manutenção.', 400);
    }

    // Encerra atividade anterior em aberto (interrupção auditada)
    const running = await prisma.worklog.findFirst({ where: { userId: u.id, endedAt: null, active: true } });
    if (running) {
      await prisma.worklog.update({
        where: { id: running.id },
        data: { endedAt: now, durationMinutes: minutesBetween(running.startedAt, now), result: 'Interrompido por nova atividade' },
      });
      if (running.ticketId && running.ticketId !== data.ticketId) {
        await prisma.ticketEvent.create({
          data: { ticketId: running.ticketId, userId: u.id, type: 'INTERRUPCAO', comment: 'Atendimento interrompido por outra atividade' },
        });
      }
    }

    // WIP e status do chamado
    if (data.ticketId) {
      const ticket = await prisma.ticket.findUnique({ where: { id: data.ticketId } });
      if (!ticket) throw new AppError('Chamado não encontrado.', 404);
      if (['FECHADO', 'CANCELADO'].includes(ticket.status)) {
        throw new AppError('Não é possível trabalhar em chamado fechado/cancelado.', 400);
      }

      const activeCount = await prisma.ticket.count({
        where: { assigneeId: u.id, status: 'EM_ATENDIMENTO', id: { not: data.ticketId } },
      });
      const limit = await wipLimit();
      if (activeCount >= limit && ticket.priority !== 'P1') {
        throw new AppError(
          `Você já tem ${activeCount} chamado(s) em atendimento (limite: ${limit}). Pause ou conclua um antes de iniciar outro. Chamados P1 podem interromper.`,
          400,
        );
      }

      const updates: Prisma.TicketUpdateInput = {};
      if (!ticket.assigneeId) {
        updates.assignee = { connect: { id: u.id } };
        updates.assignedAt = ticket.assignedAt ?? now;
      }
      if (ticket.status !== 'EM_ATENDIMENTO') {
        updates.status = 'EM_ATENDIMENTO';
        if (!ticket.startedAt) updates.startedAt = now;
        // Retomada de pausa de SLA, se aplicável
        if (ticket.slaPausedAt) {
          const pausedMin = Math.round((now.getTime() - ticket.slaPausedAt.getTime()) / 60_000);
          updates.slaPausedMinutes = ticket.slaPausedMinutes + pausedMin;
          updates.slaPausedAt = null;
          if (ticket.resolutionDueAt) updates.resolutionDueAt = new Date(ticket.resolutionDueAt.getTime() + pausedMin * 60_000);
        }
        await prisma.ticketEvent.create({
          data: { ticketId: ticket.id, userId: u.id, type: 'STATUS', fromValue: ticket.status, toValue: 'EM_ATENDIMENTO', comment: 'Início de atendimento' },
        });
      }
      if (Object.keys(updates).length > 0) {
        await prisma.ticket.update({ where: { id: ticket.id }, data: updates });
      }
    }

    const worklog = await prisma.worklog.create({
      data: {
        userId: u.id,
        type: data.type,
        ticketId: data.ticketId ?? null,
        taskId: data.taskId ?? null,
        routineExecutionId: data.routineExecutionId ?? null,
        maintenanceId: data.maintenanceId ?? null,
        description: data.description ?? null,
        startedAt: now,
      },
    });
    return reply.code(201).send(worklog);
  });

  /** Conclui/pausa a atividade em andamento. */
  app.post('/:id/stop', { preHandler: [app.requirePermission('tickets.work')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { result, nextStep, description } = z.object({
      result: z.string().optional(),
      nextStep: z.string().optional(),
      description: z.string().optional(),
    }).parse(req.body ?? {});

    const worklog = await prisma.worklog.findUnique({ where: { id } });
    if (!worklog || worklog.userId !== req.authUser.id) throw new AppError('Apontamento não encontrado.', 404);
    if (worklog.endedAt) throw new AppError('Este apontamento já foi encerrado.', 400);

    const now = new Date();
    return prisma.worklog.update({
      where: { id },
      data: {
        endedAt: now,
        durationMinutes: minutesBetween(worklog.startedAt, now),
        result: result ?? null,
        nextStep: nextStep ?? null,
        description: description ?? worklog.description,
      },
    });
  });

  /** Apontamento manual (trabalho já realizado — ex.: resolvido por WhatsApp e registrado depois). */
  app.post('/', { preHandler: [app.requirePermission('tickets.work')] }, async (req, reply) => {
    const data = manualSchema.parse(req.body);
    const startedAt = new Date(data.startedAt);
    const endedAt = new Date(data.endedAt);
    if (endedAt <= startedAt) throw new AppError('A hora final deve ser depois da inicial.', 400);
    if (!data.ticketId && !data.taskId && !data.routineExecutionId && !data.maintenanceId) {
      throw new AppError('Vincule o apontamento a um chamado, tarefa, rotina ou manutenção.', 400);
    }
    const worklog = await prisma.worklog.create({
      data: {
        userId: req.authUser.id,
        type: data.type,
        ticketId: data.ticketId ?? null,
        taskId: data.taskId ?? null,
        routineExecutionId: data.routineExecutionId ?? null,
        maintenanceId: data.maintenanceId ?? null,
        description: data.description,
        result: data.result ?? null,
        nextStep: data.nextStep ?? null,
        startedAt,
        endedAt,
        durationMinutes: minutesBetween(startedAt, endedAt),
        isManual: true,
      },
    });
    await audit({ userId: req.authUser.id, action: 'APONTAMENTO_MANUAL', entity: 'ticket_worklogs', entityId: worklog.id, req, after: { durationMinutes: worklog.durationMinutes } });
    return reply.code(201).send(worklog);
  });

  /** Edição de apontamento — nunca silenciosa: exige justificativa e gera auditoria. */
  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const data = z.object({
      startedAt: z.string().datetime().optional(),
      endedAt: z.string().datetime().optional(),
      type: z.enum(WORKLOG_TYPES).optional(),
      description: z.string().optional(),
      result: z.string().optional(),
      editJustification: z.string().min(5, 'Justifique a alteração do apontamento'),
    }).parse(req.body);

    const worklog = await prisma.worklog.findUnique({ where: { id } });
    if (!worklog) throw new AppError('Apontamento não encontrado.', 404);
    const u = req.authUser;
    const canEditOthers = hasPermission(u.role, 'worklogs.edit');
    if (worklog.userId !== u.id && !canEditOthers) throw new AppError('Sem permissão para editar este apontamento.', 403);

    const startedAt = data.startedAt ? new Date(data.startedAt) : worklog.startedAt;
    const endedAt = data.endedAt ? new Date(data.endedAt) : worklog.endedAt;

    const before = { startedAt: worklog.startedAt, endedAt: worklog.endedAt, durationMinutes: worklog.durationMinutes, type: worklog.type };
    const updated = await prisma.worklog.update({
      where: { id },
      data: {
        startedAt,
        endedAt,
        durationMinutes: endedAt ? minutesBetween(startedAt, endedAt) : null,
        type: data.type,
        description: data.description,
        result: data.result,
        editJustification: data.editJustification,
        editedById: u.id,
        editedAt: new Date(),
      },
    });
    await audit({
      userId: u.id, action: 'ALTERACAO_TEMPO', entity: 'ticket_worklogs', entityId: id, req,
      before, after: { startedAt: updated.startedAt, endedAt: updated.endedAt, durationMinutes: updated.durationMinutes },
      justification: data.editJustification,
    });
    return updated;
  });

  /** Estorno (nunca exclui): marca inativo com justificativa. Somente gestão. */
  app.post('/:id/void', { preHandler: [app.requirePermission('worklogs.edit')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { justification } = z.object({ justification: z.string().min(5) }).parse(req.body);
    const worklog = await prisma.worklog.findUnique({ where: { id } });
    if (!worklog) throw new AppError('Apontamento não encontrado.', 404);
    await prisma.worklog.update({ where: { id }, data: { active: false, editJustification: justification, editedById: req.authUser.id, editedAt: new Date() } });
    await audit({ userId: req.authUser.id, action: 'ESTORNO_TEMPO', entity: 'ticket_worklogs', entityId: id, req, justification });
    return { ok: true };
  });
}

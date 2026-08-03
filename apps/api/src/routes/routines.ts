import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { ROUTINE_FREQUENCIES, CRITICALITIES } from '@gestao-ti/shared';
import type { Prisma } from '@prisma/client';

const routineSchema = z.object({
  name: z.string().min(3),
  description: z.string().optional(),
  frequency: z.enum(ROUTINE_FREQUENCIES),
  intervalDays: z.number().int().positive().nullable().optional(),
  assigneeId: z.string().uuid(),
  substituteId: z.string().uuid().nullable().optional(),
  unitId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  checklist: z.array(z.object({ id: z.string(), label: z.string() })).nullable().optional(),
  requiresEvidence: z.boolean().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  criticality: z.enum(CRITICALITIES).optional(),
  nextRunAt: z.string(),
  toleranceHours: z.number().int().nonnegative().optional(),
  instructions: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

/** Calcula a próxima execução a partir da frequência. */
export function nextRun(from: Date, frequency: string, intervalDays?: number | null): Date {
  const d = new Date(from);
  switch (frequency) {
    case 'DIARIA': d.setDate(d.getDate() + 1); break;
    case 'SEMANAL': d.setDate(d.getDate() + 7); break;
    case 'QUINZENAL': d.setDate(d.getDate() + 14); break;
    case 'MENSAL': d.setMonth(d.getMonth() + 1); break;
    case 'TRIMESTRAL': d.setMonth(d.getMonth() + 3); break;
    case 'ANUAL': d.setFullYear(d.getFullYear() + 1); break;
    default: d.setDate(d.getDate() + (intervalDays ?? 30));
  }
  return d;
}

export async function routineRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return prisma.routine.findMany({
      where: { active: q.includeInactive === 'true' ? undefined : true },
      include: {
        assignee: { select: { id: true, name: true } },
        substitute: { select: { id: true, name: true } },
        unit: { select: { name: true } },
        executions: { orderBy: { scheduledFor: 'desc' }, take: 1 },
      },
      orderBy: { nextRunAt: 'asc' },
    });
  });

  app.post('/', { preHandler: [app.requirePermission('routines.manage')] }, async (req, reply) => {
    const data = routineSchema.parse(req.body);
    const routine = await prisma.routine.create({
      data: {
        ...data,
        checklist: (data.checklist ?? undefined) as Prisma.InputJsonValue | undefined,
        nextRunAt: new Date(data.nextRunAt),
      },
    });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'routines', entityId: routine.id, req, after: { name: routine.name, frequency: routine.frequency } });
    return reply.code(201).send(routine);
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const routine = await prisma.routine.findUnique({
      where: { id },
      include: {
        assignee: { select: { id: true, name: true } },
        substitute: { select: { id: true, name: true } },
        unit: true, department: true,
        executions: {
          include: { executedBy: { select: { id: true, name: true } }, attachments: true },
          orderBy: { scheduledFor: 'desc' },
          take: 50,
        },
      },
    });
    if (!routine) throw new AppError('Rotina não encontrada.', 404);
    return routine;
  });

  app.patch('/:id', { preHandler: [app.requirePermission('routines.manage')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = routineSchema.partial().parse(req.body);
    const before = await prisma.routine.findUnique({ where: { id } });
    if (!before) throw new AppError('Rotina não encontrada.', 404);
    // Editar a rotina NÃO altera execuções passadas (histórico preservado).
    const after = await prisma.routine.update({
      where: { id },
      data: {
        ...data,
        checklist: (data.checklist ?? undefined) as Prisma.InputJsonValue | undefined,
        nextRunAt: data.nextRunAt ? new Date(data.nextRunAt) : undefined,
      },
    });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'routines', entityId: id, req, before: { name: before.name }, after: data });
    return after;
  });

  // ---- Execuções ----

  /** Gera manualmente a execução pendente (também gerada pelo agendador). */
  app.post('/:id/generate-execution', { preHandler: [app.requirePermission('routines.execute')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const routine = await prisma.routine.findUnique({ where: { id } });
    if (!routine || !routine.active) throw new AppError('Rotina não encontrada ou inativa.', 404);
    const existing = await prisma.routineExecution.findFirst({
      where: { routineId: id, status: { in: ['PENDENTE', 'EM_EXECUCAO', 'ATRASADA'] } },
    });
    if (existing) return reply.send(existing);
    const exec = await prisma.routineExecution.create({
      data: { routineId: id, scheduledFor: routine.nextRunAt },
    });
    return reply.code(201).send(exec);
  });

  app.post('/executions/:execId/start', { preHandler: [app.requirePermission('routines.execute')] }, async (req) => {
    const { execId } = req.params as { execId: string };
    const exec = await prisma.routineExecution.findUnique({ where: { id: execId } });
    if (!exec) throw new AppError('Execução não encontrada.', 404);
    if (exec.status === 'CONCLUIDA') throw new AppError('Execução já concluída.', 400);
    return prisma.routineExecution.update({
      where: { id: execId },
      data: { status: 'EM_EXECUCAO', executedById: req.authUser.id, startedAt: exec.startedAt ?? new Date() },
    });
  });

  app.post('/executions/:execId/complete', { preHandler: [app.requirePermission('routines.execute')] }, async (req) => {
    const { execId } = req.params as { execId: string };
    const { checklistResults, notes, skip, skipReason } = z.object({
      checklistResults: z.array(z.object({ id: z.string(), label: z.string(), done: z.boolean(), note: z.string().optional() })).optional(),
      notes: z.string().optional(),
      skip: z.boolean().optional(),
      skipReason: z.string().optional(),
    }).parse(req.body ?? {});

    const exec = await prisma.routineExecution.findUnique({ where: { id: execId }, include: { routine: true } });
    if (!exec) throw new AppError('Execução não encontrada.', 404);
    if (exec.status === 'CONCLUIDA' || exec.status === 'PULADA') throw new AppError('Execução já encerrada.', 400);
    if (skip && !skipReason) throw new AppError('Justifique por que a rotina foi pulada.', 400);

    if (exec.routine.requiresEvidence && !skip) {
      const evidence = await prisma.attachment.count({ where: { routineExecutionId: execId } });
      if (evidence === 0) throw new AppError('Esta rotina exige evidência anexada antes de concluir.', 400);
    }

    const now = new Date();
    const [updated] = await prisma.$transaction([
      prisma.routineExecution.update({
        where: { id: execId },
        data: {
          status: skip ? 'PULADA' : 'CONCLUIDA',
          executedById: exec.executedById ?? req.authUser.id,
          completedAt: now,
          checklistResults: (checklistResults ?? undefined) as Prisma.InputJsonValue | undefined,
          notes: skip ? `PULADA: ${skipReason}` : notes ?? null,
        },
      }),
      prisma.routine.update({
        where: { id: exec.routineId },
        data: { nextRunAt: nextRun(exec.scheduledFor, exec.routine.frequency, exec.routine.intervalDays) },
      }),
    ]);
    await audit({
      userId: req.authUser.id, action: skip ? 'ROTINA_PULADA' : 'ROTINA_CONCLUIDA',
      entity: 'routine_executions', entityId: execId, req, justification: skipReason,
    });
    return updated;
  });
}

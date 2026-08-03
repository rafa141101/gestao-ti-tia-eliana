import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { notifyUser, notifyRoles } from '../lib/notify.js';
import { addSlaMinutes, slaMinutesFor } from '../lib/sla.js';
import { nextTicketNumber } from '../lib/numbers.js';
import { sendWhatsAppText } from '../integrations/whatsapp.js';
import {
  CHANNELS, IMPACTS, URGENCIES, PRIORITIES, TICKET_STATUSES, TICKET_STATUS_TRANSITIONS,
  SLA_PAUSED_STATUSES, computePriority, hasPermission,
  type TicketStatus, type Priority,
} from '@gestao-ti/shared';
import type { AuthUser } from '../plugins/auth.js';
import type { Prisma } from '@prisma/client';

// ---------- Helpers ----------

/** Filtro de visibilidade de chamados conforme o perfil (aplicado sempre no servidor). */
export function ticketScopeFor(u: AuthUser): Prisma.TicketWhereInput {
  if (hasPermission(u.role, 'tickets.view.all')) return {};
  if (hasPermission(u.role, 'tickets.view.department')) {
    return {
      OR: [
        { requesterId: u.id },
        ...(u.departmentId ? [{ departmentId: u.departmentId }] : []),
        { watchers: { some: { userId: u.id } } },
      ],
    };
  }
  return { OR: [{ requesterId: u.id }, { watchers: { some: { userId: u.id } } }] };
}

async function defaultSlaPolicy(categoryId: string) {
  const category = await prisma.category.findUnique({ where: { id: categoryId }, include: { slaPolicy: true } });
  if (category?.slaPolicy?.active) return category.slaPolicy;
  return prisma.slaPolicy.findFirst({ where: { isDefault: true, active: true } });
}

async function holidays() {
  return (await prisma.holiday.findMany()).map((h) => h.date);
}

const LISTAGEM_SELECT = {
  id: true, number: true, title: true, status: true, priority: true, channel: true,
  openedAt: true, firstResponseDueAt: true, resolutionDueAt: true, firstResponseAt: true,
  resolvedAt: true, closedAt: true, updatedAt: true, reopenedCount: true, scheduledFor: true,
  requester: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  queue: { select: { id: true, name: true } },
  thirdParty: { select: { id: true, name: true } },
} satisfies Prisma.TicketSelect;

const createSchema = z.object({
  title: z.string().min(3, 'Título muito curto'),
  description: z.string().min(3, 'Descreva o problema'),
  categoryId: z.string().uuid(),
  subcategoryId: z.string().uuid().nullable().optional(),
  impact: z.enum(IMPACTS),
  urgency: z.enum(URGENCIES),
  channel: z.enum(CHANNELS).optional(),
  unitId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  requesterId: z.string().uuid().optional(),
  assetId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  formResponses: z.record(z.unknown()).nullable().optional(),
  tags: z.array(z.string()).optional(),
  infoOwnerArea: z.string().nullable().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  comment: z.string().optional(),
  justification: z.string().optional(),
  resolutionNotes: z.string().optional(),
  cancelReason: z.string().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
});

/**
 * Aplica uma transição de status com todas as regras de negócio:
 * validação de transição, pausa/retomada de SLA, timestamps, eventos e notificações.
 */
export async function applyStatusChange(
  ticketId: string,
  to: TicketStatus,
  actor: AuthUser,
  opts: { comment?: string; justification?: string; resolutionNotes?: string; cancelReason?: string; scheduledFor?: string | null } = {},
) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AppError('Chamado não encontrado.', 404);
  const from = ticket.status as TicketStatus;

  if (from === to) throw new AppError('O chamado já está neste status.', 400);
  if (!TICKET_STATUS_TRANSITIONS[from].includes(to)) {
    throw new AppError(`Transição inválida: ${from} → ${to}.`, 400);
  }

  const now = new Date();
  const isReopen = (from === 'RESOLVIDO' || from === 'FECHADO') && to === 'EM_ATENDIMENTO';
  if (isReopen && !opts.justification && !opts.comment) {
    throw new AppError('Informe o motivo da reabertura.', 400);
  }
  if (to === 'CANCELADO' && !opts.cancelReason && !opts.justification) {
    throw new AppError('Informe o motivo do cancelamento.', 400);
  }
  if (to === 'RESOLVIDO' && !opts.resolutionNotes && !ticket.resolutionNotes) {
    throw new AppError('Registre a solução aplicada antes de resolver o chamado.', 400);
  }

  const data: Prisma.TicketUpdateInput = { status: to };

  // Pausa/retomada de SLA
  const wasPaused = SLA_PAUSED_STATUSES.includes(from);
  const willPause = SLA_PAUSED_STATUSES.includes(to);
  if (!wasPaused && willPause) {
    data.slaPausedAt = now;
  } else if (wasPaused && !willPause && ticket.slaPausedAt) {
    const pausedMin = Math.round((now.getTime() - ticket.slaPausedAt.getTime()) / 60_000);
    data.slaPausedMinutes = ticket.slaPausedMinutes + pausedMin;
    data.slaPausedAt = null;
    // Prorroga os prazos pelo tempo pausado (tempo corrido — aproximação documentada)
    if (ticket.resolutionDueAt) data.resolutionDueAt = new Date(ticket.resolutionDueAt.getTime() + pausedMin * 60_000);
    if (ticket.firstResponseDueAt && !ticket.firstResponseAt) {
      data.firstResponseDueAt = new Date(ticket.firstResponseDueAt.getTime() + pausedMin * 60_000);
    }
  }

  if (to === 'TRIAGEM' && !ticket.triagedAt) data.triagedAt = now;
  if (to === 'EM_ATENDIMENTO' && !ticket.startedAt) data.startedAt = now;
  if (to === 'AGENDADO' && opts.scheduledFor) data.scheduledFor = new Date(opts.scheduledFor);
  if (to === 'RESOLVIDO') {
    data.resolvedAt = now;
    if (opts.resolutionNotes) data.resolutionNotes = opts.resolutionNotes;
  }
  if (to === 'FECHADO') data.closedAt = now;
  if (to === 'CANCELADO') data.cancelReason = opts.cancelReason ?? opts.justification;
  if (isReopen) {
    data.reopenedCount = ticket.reopenedCount + 1;
    data.resolvedAt = null;
    data.closedAt = null;
  }

  const eventType = isReopen ? 'REABERTURA'
    : to === 'RESOLVIDO' ? 'RESOLUCAO'
    : to === 'FECHADO' ? 'FECHAMENTO'
    : to === 'CANCELADO' ? 'CANCELAMENTO'
    : 'STATUS';

  const [updated] = await prisma.$transaction([
    prisma.ticket.update({ where: { id: ticketId }, data }),
    prisma.ticketEvent.create({
      data: {
        ticketId, userId: actor.id, type: eventType,
        fromValue: from, toValue: to,
        comment: opts.comment ?? null,
        justification: opts.justification ?? opts.cancelReason ?? null,
      },
    }),
  ]);

  await audit({
    userId: actor.id, action: `TICKET_${eventType}`, entity: 'tickets', entityId: ticketId,
    before: { status: from }, after: { status: to }, justification: opts.justification,
  });

  // Notificações
  if (to === 'RESOLVIDO') {
    await notifyUser(ticket.requesterId, 'chamado_resolvido', `Chamado ${ticket.number} resolvido`,
      'Confirme a resolução ou reabra o chamado. Sem manifestação, ele será fechado automaticamente.', 'tickets', ticketId);
    if (ticket.channel === 'WHATSAPP') {
      const requester = await prisma.user.findUnique({ where: { id: ticket.requesterId }, select: { phone: true } });
      void sendWhatsAppText(
        ticket.contactPhone ?? requester?.phone,
        `Seu chamado *${ticket.number}* foi marcado como resolvido pela TI.` +
        (opts.resolutionNotes ? `\nSolução: ${opts.resolutionNotes}` : '') +
        '\nSe o problema persistir, responda esta mensagem que reabrimos o atendimento.',
      );
    }
  }
  if (isReopen && ticket.assigneeId) {
    await notifyUser(ticket.assigneeId, 'chamado_reaberto', `Chamado ${ticket.number} foi reaberto`, opts.justification ?? opts.comment ?? undefined, 'tickets', ticketId);
  }
  return updated;
}

// ---------- Rotas ----------

export async function ticketRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Lista com filtros
  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const scope = ticketScopeFor(req.authUser);
    const where: Prisma.TicketWhereInput = {
      AND: [
        scope,
        q.status ? { status: { in: q.status.split(',') as TicketStatus[] } } : {},
        q.open === 'true' ? { status: { notIn: ['FECHADO', 'CANCELADO'] } } : {},
        q.priority ? { priority: { in: q.priority.split(',') as Priority[] } } : {},
        q.assigneeId === 'none' ? { assigneeId: null } : q.assigneeId ? { assigneeId: q.assigneeId } : {},
        q.requesterId ? { requesterId: q.requesterId } : {},
        q.unitId ? { unitId: q.unitId } : {},
        q.categoryId ? { categoryId: q.categoryId } : {},
        q.queueId ? { queueId: q.queueId } : {},
        q.thirdPartyId ? { thirdPartyId: q.thirdPartyId } : {},
        q.assetId ? { assetId: q.assetId } : {},
        q.projectId ? { projectId: q.projectId } : {},
        q.search ? {
          OR: [
            { number: { contains: q.search, mode: 'insensitive' } },
            { title: { contains: q.search, mode: 'insensitive' } },
            { description: { contains: q.search, mode: 'insensitive' } },
          ],
        } : {},
        q.slaVencido === 'true' ? {
          status: { notIn: ['RESOLVIDO', 'FECHADO', 'CANCELADO'] },
          resolutionDueAt: { lt: new Date() },
        } : {},
      ],
    };
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Number(q.pageSize ?? 25));
    const [total, items] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        select: LISTAGEM_SELECT,
        orderBy: q.orderBy === 'priority'
          ? [{ priority: 'asc' }, { openedAt: 'asc' }]
          : { openedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  });

  // Criação
  app.post('/', { preHandler: [app.requirePermission('tickets.create')] }, async (req, reply) => {
    const data = createSchema.parse(req.body);
    const u = req.authUser;

    // Solicitante comum abre para si; técnico/gestor pode abrir em nome de outro
    let requesterId = u.id;
    if (data.requesterId && data.requesterId !== u.id) {
      if (!hasPermission(u.role, 'tickets.work')) {
        throw new AppError('Você não pode abrir chamados em nome de outra pessoa.', 403);
      }
      requesterId = data.requesterId;
    }

    const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!category || !category.active) throw new AppError('Categoria inválida.', 400);

    const calculated = computePriority(data.impact, data.urgency);
    const policy = await defaultSlaPolicy(data.categoryId);
    const now = new Date();
    const hs = policy ? await holidays() : [];

    const requester = await prisma.user.findUnique({ where: { id: requesterId }, select: { unitId: true, departmentId: true } });

    const ticket = await prisma.$transaction(async (tx) => {
      const number = await nextTicketNumber(tx, now);

      // Distribuição automática (rodízio) quando a fila da categoria está em ROUND_ROBIN
      let autoAssigneeId: string | null = null;
      if (category.defaultQueueId) {
        const queue = await tx.queue.findUnique({
          where: { id: category.defaultQueueId },
          include: { members: { include: { user: { select: { id: true, active: true } } }, orderBy: { userId: 'asc' } } },
        });
        if (queue?.assignmentMode === 'ROUND_ROBIN') {
          const members = queue.members.filter((m) => m.user.active).map((m) => m.user.id);
          if (members.length > 0) {
            const lastIdx = members.indexOf(queue.lastAssignedUserId ?? '');
            autoAssigneeId = members[(lastIdx + 1) % members.length];
            await tx.queue.update({ where: { id: queue.id }, data: { lastAssignedUserId: autoAssigneeId } });
          }
        }
      }

      const t = await tx.ticket.create({
        data: {
          number,
          title: data.title,
          description: data.description,
          requesterId,
          unitId: data.unitId ?? requester?.unitId ?? null,
          departmentId: data.departmentId ?? requester?.departmentId ?? null,
          categoryId: data.categoryId,
          subcategoryId: data.subcategoryId ?? null,
          channel: data.channel ?? 'PORTAL',
          impact: data.impact,
          urgency: data.urgency,
          calculatedPriority: calculated,
          priority: calculated,
          assigneeId: autoAssigneeId,
          assignedAt: autoAssigneeId ? now : null,
          status: autoAssigneeId ? 'ATRIBUIDO' : 'NOVO',
          queueId: category.defaultQueueId ?? null,
          assetId: data.assetId ?? null,
          projectId: data.projectId ?? null,
          formResponses: (data.formResponses ?? undefined) as Prisma.InputJsonValue | undefined,
          tags: data.tags ?? [],
          infoOwnerArea: data.infoOwnerArea ?? null,
          scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null,
          slaPolicyId: policy?.id ?? null,
          firstResponseDueAt: policy ? addSlaMinutes(now, slaMinutesFor(policy, calculated).firstResponse, policy, hs) : null,
          resolutionDueAt: policy ? addSlaMinutes(now, slaMinutesFor(policy, calculated).resolution, policy, hs) : null,
        },
      });
      await tx.ticketEvent.create({
        data: { ticketId: t.id, userId: u.id, type: 'CRIACAO', toValue: 'NOVO', comment: `Canal: ${data.channel ?? 'PORTAL'}` },
      });
      if (autoAssigneeId) {
        await tx.ticketEvent.create({
          data: { ticketId: t.id, type: 'ATRIBUICAO', toValue: 'auto', comment: 'Distribuição automática da fila (rodízio)' },
        });
      }
      return t;
    });
    if (ticket.assigneeId && ticket.assigneeId !== u.id) {
      await notifyUser(ticket.assigneeId, 'chamado_atribuido', `Chamado ${ticket.number} atribuído a você (rodízio da fila)`, ticket.title, 'tickets', ticket.id);
    }

    await audit({ userId: u.id, action: 'CRIACAO', entity: 'tickets', entityId: ticket.id, req, after: { number: ticket.number, title: ticket.title, priority: ticket.priority } });
    await notifyRoles(['GESTOR_TI'], 'chamado_criado', `Novo chamado ${ticket.number} (${ticket.priority})`, ticket.title, 'tickets', ticket.id);
    if (ticket.priority === 'P1') {
      await notifyRoles(['TECNICO', 'ADMIN', 'OWNER'], 'chamado_p1', `⚠ P1 aberto: ${ticket.number}`, ticket.title, 'tickets', ticket.id);
    }
    return reply.code(201).send({ id: ticket.id, number: ticket.number, priority: ticket.priority });
  });

  // Detalhe
  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const u = req.authUser;
    const canViewInternal = hasPermission(u.role, 'tickets.work') || hasPermission(u.role, 'audit.view');
    const ticket = await prisma.ticket.findFirst({
      where: { AND: [{ id }, ticketScopeFor(u)] },
      include: {
        requester: { select: { id: true, name: true, email: true, phone: true } },
        assignee: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
        unit: true, department: true,
        category: { select: { id: true, name: true, formSchema: true, responseTemplate: true } },
        subcategory: true, queue: true, slaPolicy: true,
        asset: { select: { id: true, code: true, description: true } },
        project: { select: { id: true, name: true } },
        thirdParty: { select: { id: true, name: true } },
        comments: {
          where: canViewInternal ? {} : { isInternal: false },
          include: { author: { select: { id: true, name: true, role: true } }, attachments: true },
          orderBy: { createdAt: 'asc' },
        },
        events: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
        attachments: { where: { commentId: null } },
        worklogs: {
          where: { active: true },
          include: { user: { select: { id: true, name: true } } },
          orderBy: { startedAt: 'asc' },
        },
        watchers: { include: { user: { select: { id: true, name: true } } } },
        relations: { include: { relatedTicket: { select: { id: true, number: true, title: true, status: true } } } },
        relatedBy: { include: { ticket: { select: { id: true, number: true, title: true, status: true } } } },
        maintenances: { select: { id: true, type: true, date: true, description: true } },
      },
    });
    if (!ticket) throw new AppError('Chamado não encontrado ou sem acesso.', 404);

    // Tempo trabalhado total (min)
    const workedMinutes = ticket.worklogs.reduce((acc, w) => acc + (w.durationMinutes ?? 0), 0);
    return { ...ticket, workedMinutes };
  });

  // Edição de campos gerais
  app.patch('/:id', { preHandler: [app.requirePermission('tickets.work')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = z.object({
      title: z.string().min(3).optional(),
      description: z.string().min(3).optional(),
      categoryId: z.string().uuid().optional(),
      subcategoryId: z.string().uuid().nullable().optional(),
      unitId: z.string().uuid().nullable().optional(),
      departmentId: z.string().uuid().nullable().optional(),
      assetId: z.string().uuid().nullable().optional(),
      projectId: z.string().uuid().nullable().optional(),
      thirdPartyId: z.string().uuid().nullable().optional(),
      externalTicketNumber: z.string().nullable().optional(),
      vendorForecastAt: z.string().datetime().nullable().optional(),
      vendorLastReplyAt: z.string().datetime().nullable().optional(),
      tags: z.array(z.string()).optional(),
      nextStep: z.string().nullable().optional(),
      returnForecast: z.string().datetime().nullable().optional(),
      infoOwnerArea: z.string().nullable().optional(),
      approverId: z.string().uuid().nullable().optional(),
    }).parse(req.body);

    const before = await prisma.ticket.findUnique({ where: { id } });
    if (!before) throw new AppError('Chamado não encontrado.', 404);

    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        ...data,
        vendorForecastAt: data.vendorForecastAt !== undefined ? (data.vendorForecastAt ? new Date(data.vendorForecastAt) : null) : undefined,
        vendorLastReplyAt: data.vendorLastReplyAt !== undefined ? (data.vendorLastReplyAt ? new Date(data.vendorLastReplyAt) : null) : undefined,
        returnForecast: data.returnForecast !== undefined ? (data.returnForecast ? new Date(data.returnForecast) : null) : undefined,
      },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: id, userId: req.authUser.id, type: 'EDICAO', comment: `Campos alterados: ${Object.keys(data).join(', ')}` },
    });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'tickets', entityId: id, req, before: { title: before.title }, after: data });
    return updated;
  });

  // Mudança de status
  app.post('/:id/status', { preHandler: [app.requirePermission('tickets.work')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = statusSchema.parse(req.body);
    return applyStatusChange(id, body.status, req.authUser, body);
  });

  // Atribuição
  app.post('/:id/assign', { preHandler: [app.requirePermission('tickets.work')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { assigneeId, queueId, comment } = z.object({
      assigneeId: z.string().uuid().nullable(),
      queueId: z.string().uuid().nullable().optional(),
      comment: z.string().optional(),
    }).parse(req.body);

    const ticket = await prisma.ticket.findUnique({ where: { id }, include: { assignee: { select: { name: true } } } });
    if (!ticket) throw new AppError('Chamado não encontrado.', 404);

    // Técnico sem tickets.manage só pode assumir para si
    if (!hasPermission(req.authUser.role, 'tickets.manage') && assigneeId !== req.authUser.id) {
      throw new AppError('Você só pode assumir o chamado para si. A distribuição é feita pelo Gestor de TI.', 403);
    }

    const newAssignee = assigneeId ? await prisma.user.findUnique({ where: { id: assigneeId }, select: { name: true } }) : null;
    const data: Prisma.TicketUpdateInput = {
      assignee: assigneeId ? { connect: { id: assigneeId } } : { disconnect: true },
      assignedAt: assigneeId ? (ticket.assignedAt ?? new Date()) : ticket.assignedAt,
    };
    if (queueId !== undefined) data.queue = queueId ? { connect: { id: queueId } } : { disconnect: true };
    if (assigneeId && (ticket.status === 'NOVO' || ticket.status === 'TRIAGEM')) data.status = 'ATRIBUIDO';

    await prisma.$transaction([
      prisma.ticket.update({ where: { id }, data }),
      prisma.ticketEvent.create({
        data: {
          ticketId: id, userId: req.authUser.id, type: 'ATRIBUICAO',
          fromValue: ticket.assignee?.name ?? null, toValue: newAssignee?.name ?? 'Sem responsável', comment,
        },
      }),
    ]);
    await audit({ userId: req.authUser.id, action: 'ALTERACAO_RESPONSAVEL', entity: 'tickets', entityId: id, req, before: { assigneeId: ticket.assigneeId }, after: { assigneeId } });
    if (assigneeId && assigneeId !== req.authUser.id) {
      await notifyUser(assigneeId, 'chamado_atribuido', `Chamado ${ticket.number} atribuído a você`, ticket.title, 'tickets', id);
    }
    return { ok: true };
  });

  // Alteração de prioridade (validação do gestor, sempre justificada)
  app.post('/:id/priority', { preHandler: [app.requirePermission('tickets.manage')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { priority, justification } = z.object({
      priority: z.enum(PRIORITIES),
      justification: z.string().min(5, 'Justifique a alteração de prioridade'),
    }).parse(req.body);

    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new AppError('Chamado não encontrado.', 404);
    if (ticket.priority === priority) throw new AppError('O chamado já está nesta prioridade.', 400);

    // Recalcula prazos de SLA a partir da abertura com a nova prioridade
    const policy = ticket.slaPolicyId ? await prisma.slaPolicy.findUnique({ where: { id: ticket.slaPolicyId } }) : null;
    const hs = policy ? await holidays() : [];
    const pausedMs = ticket.slaPausedMinutes * 60_000;

    await prisma.$transaction([
      prisma.ticket.update({
        where: { id },
        data: {
          priority,
          priorityJustification: justification,
          firstResponseDueAt: policy && !ticket.firstResponseAt
            ? new Date(addSlaMinutes(ticket.openedAt, slaMinutesFor(policy, priority).firstResponse, policy, hs).getTime() + pausedMs)
            : undefined,
          resolutionDueAt: policy
            ? new Date(addSlaMinutes(ticket.openedAt, slaMinutesFor(policy, priority).resolution, policy, hs).getTime() + pausedMs)
            : undefined,
        },
      }),
      prisma.ticketEvent.create({
        data: { ticketId: id, userId: req.authUser.id, type: 'PRIORIDADE', fromValue: ticket.priority, toValue: priority, justification },
      }),
    ]);
    await audit({ userId: req.authUser.id, action: 'ALTERACAO_PRIORIDADE', entity: 'tickets', entityId: id, req, before: { priority: ticket.priority }, after: { priority }, justification });
    return { ok: true };
  });

  // Comentários (públicos e internos)
  app.post('/:id/comments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { body, isInternal } = z.object({
      body: z.string().min(1, 'Comentário vazio'),
      isInternal: z.boolean().optional(),
    }).parse(req.body);
    const u = req.authUser;

    const ticket = await prisma.ticket.findFirst({ where: { AND: [{ id }, ticketScopeFor(u)] } });
    if (!ticket) throw new AppError('Chamado não encontrado ou sem acesso.', 404);

    const isTech = hasPermission(u.role, 'tickets.work');
    if (isInternal && !isTech) throw new AppError('Apenas a equipe de TI pode criar comentários internos.', 403);

    const comment = await prisma.ticketComment.create({
      data: { ticketId: id, authorId: u.id, body, isInternal: isInternal ?? false },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    // Primeira resposta pública da equipe marca o SLA de resposta
    if (isTech && !isInternal && !ticket.firstResponseAt && u.id !== ticket.requesterId) {
      await prisma.$transaction([
        prisma.ticket.update({ where: { id }, data: { firstResponseAt: new Date() } }),
        prisma.ticketEvent.create({ data: { ticketId: id, userId: u.id, type: 'PRIMEIRA_RESPOSTA' } }),
      ]);
    }

    // Notificações: solicitante (se resposta pública da equipe) / responsável (se resposta do solicitante)
    if (!isInternal) {
      if (u.id !== ticket.requesterId) {
        await notifyUser(ticket.requesterId, 'chamado_resposta', `Resposta no chamado ${ticket.number}`, body.slice(0, 120), 'tickets', id);
        // Chamado veio do WhatsApp: resposta pública da TI é entregue na conversa (janela de serviço, sem custo)
        if (ticket.channel === 'WHATSAPP') {
          const requester = await prisma.user.findUnique({ where: { id: ticket.requesterId }, select: { phone: true } });
          void sendWhatsAppText(ticket.contactPhone ?? requester?.phone, `*${ticket.number}* — ${u.name}:\n${body}`);
        }
      } else if (ticket.assigneeId) {
        await notifyUser(ticket.assigneeId, 'chamado_resposta', `${u.name} respondeu o chamado ${ticket.number}`, body.slice(0, 120), 'tickets', id);
      }
      // Menções simples: @Nome Sobrenome
      const mentions = body.match(/@([\p{L}]+(?: [\p{L}]+)?)/gu) ?? [];
      for (const m of mentions) {
        const mentioned = await prisma.user.findFirst({ where: { name: { startsWith: m.slice(1), mode: 'insensitive' }, active: true } });
        if (mentioned && mentioned.id !== u.id) {
          await notifyUser(mentioned.id, 'mencao', `${u.name} mencionou você no chamado ${ticket.number}`, body.slice(0, 120), 'tickets', id);
        }
      }
    }
    return reply.code(201).send(comment);
  });

  // Confirmação de resolução pelo solicitante
  app.post('/:id/confirm-resolution', async (req) => {
    const { id } = req.params as { id: string };
    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new AppError('Chamado não encontrado.', 404);
    if (ticket.requesterId !== req.authUser.id && !hasPermission(req.authUser.role, 'tickets.manage')) {
      throw new AppError('Apenas o solicitante pode confirmar a resolução.', 403);
    }
    if (ticket.status !== 'RESOLVIDO') throw new AppError('O chamado não está resolvido.', 400);
    return applyStatusChange(id, 'FECHADO', req.authUser, { comment: 'Resolução confirmada pelo solicitante' });
  });

  // Reabertura (solicitante ou equipe, com motivo)
  app.post('/:id/reopen', async (req) => {
    const { id } = req.params as { id: string };
    const { reason } = z.object({ reason: z.string().min(5, 'Descreva o motivo da reabertura') }).parse(req.body);
    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new AppError('Chamado não encontrado.', 404);
    const u = req.authUser;
    if (ticket.requesterId !== u.id && !hasPermission(u.role, 'tickets.work')) {
      throw new AppError('Você não pode reabrir este chamado.', 403);
    }
    if (ticket.status !== 'RESOLVIDO' && ticket.status !== 'FECHADO') {
      throw new AppError('Apenas chamados resolvidos ou fechados podem ser reabertos.', 400);
    }
    return applyStatusChange(id, 'EM_ATENDIMENTO', u, { justification: reason });
  });

  // Avaliação do atendimento
  app.post('/:id/rate', async (req) => {
    const { id } = req.params as { id: string };
    const { rating, comment } = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().optional() }).parse(req.body);
    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new AppError('Chamado não encontrado.', 404);
    if (ticket.requesterId !== req.authUser.id) throw new AppError('Apenas o solicitante pode avaliar.', 403);
    if (ticket.status !== 'RESOLVIDO' && ticket.status !== 'FECHADO') throw new AppError('Avalie após a resolução.', 400);
    await prisma.ticket.update({ where: { id }, data: { rating, ratingComment: comment } });
    await audit({ userId: req.authUser.id, action: 'AVALIACAO', entity: 'tickets', entityId: id, req, after: { rating } });
    return { ok: true };
  });

  // Vínculos entre chamados
  app.post('/:id/relations', { preHandler: [app.requirePermission('tickets.work')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { relatedTicketNumber, relation } = z.object({
      relatedTicketNumber: z.string(),
      relation: z.enum(['RELACIONADO', 'PAI', 'FILHO', 'DUPLICADO']).optional(),
    }).parse(req.body);
    const related = await prisma.ticket.findUnique({ where: { number: relatedTicketNumber } });
    if (!related) throw new AppError(`Chamado ${relatedTicketNumber} não encontrado.`, 404);
    if (related.id === id) throw new AppError('Um chamado não pode ser vinculado a si mesmo.', 400);
    const rel = await prisma.ticketRelation.create({
      data: { ticketId: id, relatedTicketId: related.id, relation: relation ?? 'RELACIONADO' },
    });
    await prisma.ticketEvent.create({
      data: { ticketId: id, userId: req.authUser.id, type: 'VINCULO', toValue: related.number },
    });
    return reply.code(201).send(rel);
  });

  // Observadores
  app.post('/:id/watchers', { preHandler: [app.requirePermission('tickets.work')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    await prisma.ticketWatcher.upsert({
      where: { ticketId_userId: { ticketId: id, userId } },
      create: { ticketId: id, userId },
      update: {},
    });
    return { ok: true };
  });
}

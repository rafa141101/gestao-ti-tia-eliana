import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { OPEN_TICKET_STATUSES } from '@gestao-ti/shared';

const OPEN = [...OPEN_TICKET_STATUSES];

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Meu Trabalho — "o que eu preciso fazer agora?" */
  app.get('/my-work', async (req) => {
    const uid = req.authUser.id;
    const now = new Date();
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

    const [running, myTickets, myTasks, myRoutines, overdueTickets, waiting, unreadCount, scheduled] = await Promise.all([
      prisma.worklog.findFirst({
        where: { userId: uid, endedAt: null, active: true },
        include: {
          ticket: { select: { id: true, number: true, title: true, priority: true } },
          task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
          routineExecution: { select: { id: true, routine: { select: { name: true } } } },
          maintenance: { select: { id: true, description: true } },
        },
      }),
      prisma.ticket.findMany({
        where: { assigneeId: uid, status: { in: OPEN as never } },
        select: {
          id: true, number: true, title: true, status: true, priority: true,
          resolutionDueAt: true, firstResponseDueAt: true, firstResponseAt: true, openedAt: true,
          requester: { select: { name: true } }, unit: { select: { name: true } },
        },
        orderBy: [{ priority: 'asc' }, { openedAt: 'asc' }],
      }),
      prisma.projectTask.findMany({
        where: { assigneeId: uid, status: { in: ['A_FAZER', 'EM_ANDAMENTO', 'BLOQUEADA'] }, active: true },
        include: { project: { select: { id: true, name: true } } },
        orderBy: [{ dueDate: 'asc' }],
        take: 20,
      }),
      prisma.routineExecution.findMany({
        where: {
          status: { in: ['PENDENTE', 'EM_EXECUCAO', 'ATRASADA'] },
          routine: { OR: [{ assigneeId: uid }, { substituteId: uid }], active: true },
        },
        include: { routine: { select: { id: true, name: true, estimatedMinutes: true, criticality: true, checklist: true, requiresEvidence: true } } },
        orderBy: { scheduledFor: 'asc' },
      }),
      prisma.ticket.count({
        where: { assigneeId: uid, status: { in: OPEN as never }, resolutionDueAt: { lt: now } },
      }),
      prisma.ticket.findMany({
        where: { assigneeId: uid, status: { in: ['AGUARDANDO_SOLICITANTE', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_APROVACAO'] } },
        select: { id: true, number: true, title: true, status: true, returnForecast: true, updatedAt: true },
      }),
      prisma.notification.count({ where: { userId: uid, readAt: null } }),
      prisma.ticket.findMany({
        where: { assigneeId: uid, status: 'AGENDADO', scheduledFor: { lte: endOfDay } },
        select: { id: true, number: true, title: true, scheduledFor: true },
      }),
    ]);

    return { running, myTickets, myTasks, myRoutines, overdueCount: overdueTickets, waiting, unreadCount, scheduled };
  });

  /** Dashboard operacional — Gestor de TI. */
  app.get('/operational', { preHandler: [app.requirePermission('dashboard.operational')] }, async () => {
    const now = new Date();
    const stale = new Date(now.getTime() - 24 * 3600_000);

    const [openByStatus, unassigned, p1, slaBreached, slaWarning, stalled, byTech, waitingThird, waitingRequester, lateProjects, lateRoutines, latePreventives, criticalAssets] = await Promise.all([
      prisma.ticket.groupBy({ by: ['status'], where: { status: { in: OPEN as never } }, _count: true }),
      prisma.ticket.findMany({
        where: { assigneeId: null, status: { in: OPEN as never } },
        select: { id: true, number: true, title: true, priority: true, openedAt: true, unit: { select: { name: true } } },
        orderBy: [{ priority: 'asc' }, { openedAt: 'asc' }], take: 30,
      }),
      prisma.ticket.findMany({
        where: { priority: 'P1', status: { in: OPEN as never } },
        select: { id: true, number: true, title: true, status: true, openedAt: true, assignee: { select: { name: true } } },
      }),
      prisma.ticket.findMany({
        where: { status: { in: OPEN as never }, resolutionDueAt: { lt: now } },
        select: { id: true, number: true, title: true, priority: true, resolutionDueAt: true, assignee: { select: { name: true } } },
        orderBy: { resolutionDueAt: 'asc' }, take: 30,
      }),
      prisma.ticket.count({
        where: { status: { in: OPEN as never }, resolutionDueAt: { gte: now, lte: new Date(now.getTime() + 4 * 3600_000) } },
      }),
      prisma.ticket.findMany({
        where: { status: { in: OPEN as never }, updatedAt: { lt: stale } },
        select: { id: true, number: true, title: true, status: true, updatedAt: true, assignee: { select: { name: true } } },
        orderBy: { updatedAt: 'asc' }, take: 30,
      }),
      prisma.ticket.groupBy({ by: ['assigneeId'], where: { status: { in: OPEN as never }, assigneeId: { not: null } }, _count: true }),
      prisma.ticket.count({ where: { status: 'AGUARDANDO_TERCEIRO' } }),
      prisma.ticket.count({ where: { status: 'AGUARDANDO_SOLICITANTE' } }),
      prisma.project.findMany({
        where: { active: true, status: { in: ['EM_EXECUCAO', 'PLANEJADO', 'APROVADO', 'BLOQUEADO'] }, dueDate: { lt: now } },
        select: { id: true, name: true, status: true, dueDate: true, owner: { select: { name: true } } },
      }),
      prisma.routineExecution.findMany({
        where: { status: { in: ['PENDENTE', 'ATRASADA', 'EM_EXECUCAO'] }, scheduledFor: { lt: now } },
        include: { routine: { select: { id: true, name: true, assignee: { select: { name: true } } } } },
        take: 30,
      }),
      prisma.asset.findMany({
        where: { active: true, nextMaintenanceAt: { lt: now }, status: { notIn: ['DESCARTADO', 'INATIVO'] } },
        select: { id: true, code: true, description: true, nextMaintenanceAt: true },
        take: 20,
      }),
      prisma.asset.findMany({
        where: { active: true, criticality: 'ALTA', status: { in: ['EM_MANUTENCAO', 'AGUARDANDO_PECA', 'EXTRAVIADO'] } },
        select: { id: true, code: true, description: true, status: true },
      }),
    ]);

    const techIds = byTech.map((t) => t.assigneeId).filter(Boolean) as string[];
    const techs = techIds.length ? await prisma.user.findMany({ where: { id: { in: techIds } }, select: { id: true, name: true } }) : [];
    const workload = byTech.map((t) => ({
      userId: t.assigneeId,
      name: techs.find((u) => u.id === t.assigneeId)?.name ?? '—',
      openTickets: t._count,
    })).sort((a, b) => b.openTickets - a.openTickets);

    return {
      openByStatus, unassigned, p1, slaBreached, slaWarningCount: slaWarning, stalled,
      workload, waitingThird, waitingRequester, lateProjects, lateRoutines, latePreventives, criticalAssets,
    };
  });

  /** Dashboard da diretoria. */
  app.get('/direction', { preHandler: [app.requirePermission('dashboard.direction')] }, async () => {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 3600_000);

    const [nowWorking, openTotal, unassignedCount, inProgress, slaBreachedCount, p1Count, waitingRequester, waitingThird, lateTasks, lateRoutinesCount,
      opened30, closed30, backlogOldest, firstResponseTimes, resolutionTimes, reopened30, byTechClosed, worklogByType, worklogByTech, hoursByCategory, hoursByUnit, topAssets, topDepartments, withinSla] = await Promise.all([
      prisma.worklog.findMany({
        where: { endedAt: null, active: true },
        include: {
          user: { select: { id: true, name: true } },
          ticket: { select: { id: true, number: true, title: true, priority: true, unit: { select: { name: true } }, status: true } },
          task: { select: { title: true, project: { select: { name: true } } } },
          routineExecution: { select: { routine: { select: { name: true } } } },
          maintenance: { select: { description: true } },
        },
        orderBy: { startedAt: 'asc' },
      }),
      prisma.ticket.count({ where: { status: { in: OPEN as never } } }),
      prisma.ticket.count({ where: { status: { in: OPEN as never }, assigneeId: null } }),
      prisma.ticket.count({ where: { status: 'EM_ATENDIMENTO' } }),
      prisma.ticket.count({ where: { status: { in: OPEN as never }, resolutionDueAt: { lt: now } } }),
      prisma.ticket.count({ where: { status: { in: OPEN as never }, priority: 'P1' } }),
      prisma.ticket.count({ where: { status: 'AGUARDANDO_SOLICITANTE' } }),
      prisma.ticket.count({ where: { status: 'AGUARDANDO_TERCEIRO' } }),
      prisma.projectTask.count({ where: { active: true, status: { in: ['A_FAZER', 'EM_ANDAMENTO'] }, dueDate: { lt: now } } }),
      prisma.routineExecution.count({ where: { status: { in: ['PENDENTE', 'ATRASADA'] }, scheduledFor: { lt: now } } }),
      prisma.ticket.count({ where: { openedAt: { gte: d30 } } }),
      prisma.ticket.count({ where: { OR: [{ closedAt: { gte: d30 } }, { resolvedAt: { gte: d30 } }] } }),
      prisma.ticket.findFirst({ where: { status: { in: OPEN as never } }, orderBy: { openedAt: 'asc' }, select: { openedAt: true } }),
      prisma.ticket.findMany({
        where: { firstResponseAt: { not: null }, openedAt: { gte: d30 } },
        select: { openedAt: true, firstResponseAt: true },
      }),
      prisma.ticket.findMany({
        where: { resolvedAt: { not: null, gte: d30 } },
        select: { openedAt: true, resolvedAt: true, slaPausedMinutes: true },
      }),
      prisma.ticket.count({ where: { reopenedCount: { gt: 0 }, resolvedAt: { gte: d30 } } }),
      prisma.ticket.groupBy({ by: ['assigneeId'], where: { resolvedAt: { gte: d30 }, assigneeId: { not: null } }, _count: true }),
      prisma.worklog.groupBy({ by: ['type'], where: { startedAt: { gte: d30 }, active: true }, _sum: { durationMinutes: true } }),
      prisma.worklog.groupBy({ by: ['userId'], where: { startedAt: { gte: d30 }, active: true }, _sum: { durationMinutes: true } }),
      prisma.$queryRaw<{ name: string; minutes: number }[]>`
        SELECT c.name, COALESCE(SUM(w."durationMinutes"), 0)::int AS minutes
        FROM ticket_worklogs w
        JOIN tickets t ON t.id = w."ticketId"
        JOIN categories c ON c.id = t."categoryId"
        WHERE w."startedAt" >= ${d30} AND w.active = true
        GROUP BY c.name ORDER BY minutes DESC LIMIT 10`,
      prisma.$queryRaw<{ name: string; minutes: number }[]>`
        SELECT u.name, COALESCE(SUM(w."durationMinutes"), 0)::int AS minutes
        FROM ticket_worklogs w
        JOIN tickets t ON t.id = w."ticketId"
        JOIN units u ON u.id = t."unitId"
        WHERE w."startedAt" >= ${d30} AND w.active = true
        GROUP BY u.name ORDER BY minutes DESC LIMIT 10`,
      prisma.$queryRaw<{ code: string; description: string; count: number }[]>`
        SELECT a.code, a.description, COUNT(t.id)::int AS count
        FROM tickets t JOIN assets a ON a.id = t."assetId"
        WHERE t."openedAt" >= ${d30}
        GROUP BY a.code, a.description ORDER BY count DESC LIMIT 10`,
      prisma.$queryRaw<{ name: string; count: number }[]>`
        SELECT d.name, COUNT(t.id)::int AS count
        FROM tickets t JOIN departments d ON d.id = t."departmentId"
        WHERE t."openedAt" >= ${d30}
        GROUP BY d.name ORDER BY count DESC LIMIT 10`,
      prisma.ticket.count({
        where: { resolvedAt: { not: null, gte: d30 }, resolutionDueAt: { not: null } },
      }).then(async (totalResolved) => {
        const onTime = await prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM tickets
          WHERE "resolvedAt" IS NOT NULL AND "resolvedAt" >= ${d30}
            AND "resolutionDueAt" IS NOT NULL AND "resolvedAt" <= "resolutionDueAt"`;
        return { totalResolved, onTime: onTime[0]?.count ?? 0 };
      }),
    ]);

    const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
    const avgFirstResponseMin = avg(firstResponseTimes.map((t) => (t.firstResponseAt!.getTime() - t.openedAt.getTime()) / 60_000));
    const avgResolutionMin = avg(resolutionTimes.map((t) => (t.resolvedAt!.getTime() - t.openedAt.getTime()) / 60_000 - t.slaPausedMinutes));

    const techIds = byTechClosed.map((t) => t.assigneeId).filter(Boolean) as string[];
    const userIds = [...new Set([...techIds, ...worklogByTech.map((w) => w.userId)])];
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? '—';

    return {
      now: nowWorking,
      operational: {
        openTotal, unassignedCount, inProgress, slaBreachedCount, p1Count,
        waitingRequester, waitingThird, lateTasks, lateRoutinesCount,
      },
      distribution: worklogByType.map((w) => ({ type: w.type, minutes: w._sum.durationMinutes ?? 0 })),
      managerial: {
        opened30, closed30,
        backlogAgeDays: backlogOldest ? Math.round((now.getTime() - backlogOldest.openedAt.getTime()) / 86_400_000) : 0,
        avgFirstResponseMin, avgResolutionMin,
        slaCompliance: withinSla.totalResolved > 0 ? Math.round((withinSla.onTime / withinSla.totalResolved) * 100) : null,
        reopenRate: closed30 > 0 ? Math.round((reopened30 / closed30) * 100) : 0,
        ticketsByTech: byTechClosed.map((t) => ({ name: nameOf(t.assigneeId), count: t._count })),
        hoursByTech: worklogByTech.map((w) => ({ name: nameOf(w.userId), minutes: w._sum.durationMinutes ?? 0 })),
        hoursByCategory, hoursByUnit, topAssets, topDepartments,
      },
    };
  });
}

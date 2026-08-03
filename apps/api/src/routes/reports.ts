import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { hasPermission } from '@gestao-ti/shared';

/** Gera CSV compatível com Excel pt-BR (separador ; e BOM UTF-8). */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '﻿';
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toLocaleString('pt-BR');
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(';'), ...rows.map((r) => headers.map((h) => esc(r[h])).join(';'))];
  return '﻿' + lines.join('\r\n');
}

function range(q: Record<string, string | undefined>) {
  const from = q.from ? new Date(q.from) : new Date(Date.now() - 30 * 24 * 3600_000);
  const to = q.to ? new Date(`${q.to}T23:59:59`) : new Date();
  return { from, to };
}

export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('reports.view'));

  /** Indicadores agregados por período. */
  app.get('/summary', async (req) => {
    const { from, to } = range(req.query as Record<string, string | undefined>);
    const [byStatus, byPriority, byCategory, byUnit, byChannel, byTech, byDepartment, worklogByType, reopened, total, resolved] = await Promise.all([
      prisma.ticket.groupBy({ by: ['status'], where: { openedAt: { gte: from, lte: to } }, _count: true }),
      prisma.ticket.groupBy({ by: ['priority'], where: { openedAt: { gte: from, lte: to } }, _count: true }),
      prisma.$queryRaw<{ name: string; count: number }[]>`
        SELECT c.name, COUNT(*)::int AS count FROM tickets t JOIN categories c ON c.id = t."categoryId"
        WHERE t."openedAt" BETWEEN ${from} AND ${to} GROUP BY c.name ORDER BY count DESC`,
      prisma.$queryRaw<{ name: string; count: number }[]>`
        SELECT u.name, COUNT(*)::int AS count FROM tickets t JOIN units u ON u.id = t."unitId"
        WHERE t."openedAt" BETWEEN ${from} AND ${to} GROUP BY u.name ORDER BY count DESC`,
      prisma.ticket.groupBy({ by: ['channel'], where: { openedAt: { gte: from, lte: to } }, _count: true }),
      prisma.$queryRaw<{ name: string; count: number }[]>`
        SELECT u.name, COUNT(*)::int AS count FROM tickets t JOIN users u ON u.id = t."assigneeId"
        WHERE t."openedAt" BETWEEN ${from} AND ${to} GROUP BY u.name ORDER BY count DESC`,
      prisma.$queryRaw<{ name: string; count: number }[]>`
        SELECT d.name, COUNT(*)::int AS count FROM tickets t JOIN departments d ON d.id = t."departmentId"
        WHERE t."openedAt" BETWEEN ${from} AND ${to} GROUP BY d.name ORDER BY count DESC`,
      prisma.worklog.groupBy({ by: ['type'], where: { startedAt: { gte: from, lte: to }, active: true }, _sum: { durationMinutes: true } }),
      prisma.ticket.count({ where: { openedAt: { gte: from, lte: to }, reopenedCount: { gt: 0 } } }),
      prisma.ticket.count({ where: { openedAt: { gte: from, lte: to } } }),
      prisma.$queryRaw<{ ontime: number; late: number }[]>`
        SELECT
          COUNT(*) FILTER (WHERE "resolvedAt" <= "resolutionDueAt")::int AS ontime,
          COUNT(*) FILTER (WHERE "resolvedAt" > "resolutionDueAt")::int AS late
        FROM tickets WHERE "resolvedAt" BETWEEN ${from} AND ${to} AND "resolutionDueAt" IS NOT NULL`,
    ]);
    const [warranty, preventives, pendingMovements] = await Promise.all([
      prisma.asset.findMany({
        where: { active: true, warrantyEnd: { gte: new Date(), lte: new Date(Date.now() + 60 * 24 * 3600_000) } },
        select: { code: true, description: true, warrantyEnd: true },
        orderBy: { warrantyEnd: 'asc' },
      }),
      prisma.asset.count({ where: { active: true, nextMaintenanceAt: { lt: new Date() }, status: { notIn: ['DESCARTADO', 'INATIVO'] } } }),
      prisma.assetMovement.count({ where: { status: { notIn: ['CONFIRMADA', 'CANCELADA', 'RETORNADA'] } } }),
    ]);
    return {
      period: { from, to },
      byStatus, byPriority, byCategory, byUnit, byChannel, byTech, byDepartment,
      worklogByType: worklogByType.map((w) => ({ type: w.type, minutes: w._sum.durationMinutes ?? 0 })),
      reopened, total,
      sla: resolved[0] ?? { ontime: 0, late: 0 },
      warrantyExpiring: warranty, preventivesLate: preventives, pendingMovements,
    };
  });

  /** Exportação CSV — a diretoria consegue retirar os dados sem depender do desenvolvedor. */
  app.get('/export/:entity', { preHandler: [app.requirePermission('export.data')] }, async (req, reply) => {
    const { entity } = req.params as { entity: string };
    const q = req.query as Record<string, string | undefined>;
    const { from, to } = range(q);
    let rows: Record<string, unknown>[] = [];

    switch (entity) {
      case 'tickets': {
        const data = await prisma.ticket.findMany({
          where: { openedAt: { gte: from, lte: to } },
          include: {
            requester: { select: { name: true } }, assignee: { select: { name: true } },
            unit: { select: { name: true } }, department: { select: { name: true } },
            category: { select: { name: true } },
          },
          orderBy: { openedAt: 'asc' },
        });
        rows = data.map((t) => ({
          numero: t.number, titulo: t.title, status: t.status, prioridade: t.priority,
          prioridade_calculada: t.calculatedPriority, canal: t.channel,
          solicitante: t.requester.name, tecnico: t.assignee?.name ?? '',
          unidade: t.unit?.name ?? '', setor: t.department?.name ?? '', categoria: t.category.name,
          aberto_em: t.openedAt, primeira_resposta: t.firstResponseAt, resolvido_em: t.resolvedAt,
          fechado_em: t.closedAt, prazo_solucao: t.resolutionDueAt, reaberturas: t.reopenedCount,
          minutos_sla_pausado: t.slaPausedMinutes, avaliacao: t.rating ?? '',
        }));
        break;
      }
      case 'worklogs': {
        const data = await prisma.worklog.findMany({
          where: { startedAt: { gte: from, lte: to } },
          include: { user: { select: { name: true } }, ticket: { select: { number: true } }, task: { select: { title: true } } },
          orderBy: { startedAt: 'asc' },
        });
        rows = data.map((w) => ({
          tecnico: w.user.name, tipo: w.type, chamado: w.ticket?.number ?? '', tarefa: w.task?.title ?? '',
          inicio: w.startedAt, fim: w.endedAt, minutos: w.durationMinutes ?? '', manual: w.isManual ? 'sim' : 'não',
          descricao: w.description ?? '', ativo: w.active ? 'sim' : 'estornado',
          editado_por: w.editedById ? 'sim' : '', justificativa_edicao: w.editJustification ?? '',
        }));
        break;
      }
      case 'projects': {
        const data = await prisma.project.findMany({ include: { owner: { select: { name: true } } } });
        rows = data.map((p) => ({
          nome: p.name, status: p.status, prioridade: p.priority, responsavel: p.owner?.name ?? '',
          inicio: p.startDate, prazo: p.dueDate, percentual: p.percentComplete, horas_previstas: p.estimatedHours ?? '',
        }));
        break;
      }
      case 'tasks': {
        const data = await prisma.projectTask.findMany({
          include: { project: { select: { name: true } }, assignee: { select: { name: true } } },
        });
        rows = data.map((t) => ({
          projeto: t.project.name, tarefa: t.title, status: t.status,
          responsavel: t.assignee?.name ?? '', prazo: t.dueDate, ativa: t.active ? 'sim' : 'não',
        }));
        break;
      }
      case 'routines': {
        const data = await prisma.routineExecution.findMany({
          where: { scheduledFor: { gte: from, lte: to } },
          include: { routine: { select: { name: true, frequency: true } }, executedBy: { select: { name: true } } },
        });
        rows = data.map((e) => ({
          rotina: e.routine.name, frequencia: e.routine.frequency, prevista_para: e.scheduledFor,
          status: e.status, executada_por: e.executedBy?.name ?? '', concluida_em: e.completedAt,
        }));
        break;
      }
      case 'assets': {
        const data = await prisma.asset.findMany({
          where: { active: true },
          include: { category: { select: { name: true } }, unit: { select: { name: true } }, department: { select: { name: true } }, user: { select: { name: true } } },
        });
        rows = data.map((a) => ({
          codigo: a.code, patrimonio: a.patrimonyCode ?? '', descricao: a.description, categoria: a.category.name,
          tipo: a.kind, marca: a.brand ?? '', modelo: a.model ?? '', serie: a.serialNumber ?? '',
          unidade: a.unit?.name ?? '', setor: a.department?.name ?? '', local: a.location ?? '',
          usuario: a.user?.name ?? '', status: a.status, valor: a.purchaseValue?.toString() ?? '',
          garantia_fim: a.warrantyEnd, hostname: a.hostname ?? '', ip: a.ip ?? '',
        }));
        break;
      }
      case 'components': {
        const data = await prisma.assetComponent.findMany({ include: { asset: { select: { code: true } } } });
        rows = data.map((c) => ({
          ativo: c.asset.code, tipo: c.type, marca: c.brand ?? '', modelo: c.model ?? '', capacidade: c.capacity ?? '',
          serie: c.serialNumber ?? '', status: c.status, instalado_em: c.installedAt, removido_em: c.removedAt,
          garantia_fim: c.warrantyEnd, custo: c.cost?.toString() ?? '',
        }));
        break;
      }
      case 'movements': {
        const data = await prisma.assetMovement.findMany({
          where: { createdAt: { gte: from, lte: to } },
          include: {
            asset: { select: { code: true } }, fromUnit: { select: { name: true } }, toUnit: { select: { name: true } },
            requestedBy: { select: { name: true } }, receivedBy: { select: { name: true } },
          },
        });
        rows = data.map((m) => ({
          ativo: m.asset.code, tipo: m.type, status: m.status,
          origem: m.fromUnit?.name ?? '', destino: m.toUnit?.name ?? '',
          solicitado_por: m.requestedBy.name, recebido_por: m.receivedBy?.name ?? '',
          motivo: m.reason ?? '', criado_em: m.createdAt, confirmado_em: m.confirmedAt,
        }));
        break;
      }
      case 'maintenance': {
        const data = await prisma.maintenanceRecord.findMany({
          where: { date: { gte: from, lte: to } },
          include: { asset: { select: { code: true } }, responsible: { select: { name: true } }, thirdParty: { select: { name: true } } },
        });
        rows = data.map((m) => ({
          ativo: m.asset.code, tipo: m.type, descricao: m.description, responsavel: m.responsible?.name ?? '',
          terceiro: m.thirdParty?.name ?? '', data: m.date, minutos: m.durationMinutes ?? '',
          custo: m.cost?.toString() ?? '', resultado: m.result ?? '', operacional: m.operational == null ? '' : m.operational ? 'sim' : 'não',
        }));
        break;
      }
      case 'third-parties': {
        const data = await prisma.thirdParty.findMany();
        rows = data.map((t) => ({
          nome: t.name, servico: t.serviceType ?? '', contato: t.contactName ?? '', email: t.email ?? '',
          telefone: t.phone ?? '', contrato: t.contract ?? '', sla: t.slaInfo ?? '', ativo: t.active ? 'sim' : 'não',
        }));
        break;
      }
      case 'audit': {
        if (!hasPermission(req.authUser.role, 'audit.view')) {
          throw new AppError('Exportação de auditoria exige perfil com acesso à auditoria.', 403);
        }
        const data = await prisma.auditLog.findMany({
          where: { createdAt: { gte: from, lte: to } },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
          take: 10000,
        });
        rows = data.map((l) => ({
          data: l.createdAt, usuario: l.user?.name ?? 'sistema', acao: l.action, entidade: l.entity,
          registro: l.entityId ?? '', justificativa: l.justification ?? '', ip: l.ip ?? '',
        }));
        break;
      }
      default:
        throw new AppError(`Entidade de exportação desconhecida: ${entity}`, 400);
    }

    await audit({ userId: req.authUser.id, action: 'EXPORTACAO', entity, req, after: { linhas: rows.length, de: from, ate: to } });
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${entity}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(toCsv(rows));
  });
}

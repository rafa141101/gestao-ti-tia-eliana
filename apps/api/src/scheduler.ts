import { prisma } from './db.js';
import { notifyUser, notifyRoles } from './lib/notify.js';
import { DEFAULT_SETTINGS, OPEN_TICKET_STATUSES } from '@gestao-ti/shared';

const INTERVAL_MS = 5 * 60_000;

/** Evita notificações repetidas: só notifica se não houve igual nas últimas 24h. */
async function alreadyNotified(type: string, entityId: string): Promise<boolean> {
  const existing = await prisma.notification.findFirst({
    where: { type, entityId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
  });
  return !!existing;
}

/**
 * Fechamento automático de chamados resolvidos sem manifestação do solicitante.
 * Set-based: um único comando fecha, registra evento, notifica e audita em lote.
 */
async function autoCloseResolved(): Promise<void> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'autoCloseHours' } });
  const hours = typeof setting?.value === 'number' ? setting.value : DEFAULT_SETTINGS.autoCloseHours;
  const comment = `Fechado automaticamente após ${hours}h sem manifestação do solicitante`;

  await prisma.$executeRaw`
    WITH closed AS (
      UPDATE tickets
      SET status = 'FECHADO'::"TicketStatus", "closedAt" = now(), "updatedAt" = now()
      WHERE status = 'RESOLVIDO'::"TicketStatus"
        AND "resolvedAt" < now() - make_interval(hours => ${hours}::int)
      RETURNING id, number, "requesterId"
    ), ev AS (
      INSERT INTO ticket_events (id, "ticketId", type, "fromValue", "toValue", comment)
      SELECT gen_random_uuid(), id, 'FECHAMENTO'::"TicketEventType", 'RESOLVIDO', 'FECHADO', ${comment}
      FROM closed RETURNING 1
    ), notif AS (
      INSERT INTO notifications (id, "userId", type, title, body, entity, "entityId")
      SELECT gen_random_uuid(), "requesterId", 'chamado_fechado',
             'Chamado ' || number || ' fechado automaticamente',
             'O prazo de confirmação expirou. Se o problema persistir, você pode reabri-lo.',
             'tickets', id
      FROM closed RETURNING 1
    )
    INSERT INTO audit_logs (id, action, entity, "entityId", origin)
    SELECT gen_random_uuid(), 'FECHAMENTO_AUTOMATICO', 'tickets', id, 'scheduler'
    FROM closed`;
}

/**
 * Gera execuções pendentes de rotinas (set-based, com avanço do ponteiro no
 * mesmo comando) e marca as atrasadas conforme a tolerância.
 */
async function generateRoutineExecutions(): Promise<void> {
  const created = await prisma.$queryRaw<{ execId: string; name: string; assigneeId: string; substituteId: string | null }[]>`
    WITH due AS (
      SELECT r.id, r.name, r."assigneeId", r."substituteId", r."nextRunAt", r.frequency, r."intervalDays"
      FROM routines r
      WHERE r.active AND r."nextRunAt" <= now()
        AND NOT EXISTS (
          SELECT 1 FROM routine_executions e
          WHERE e."routineId" = r.id AND e.status::text IN ('PENDENTE', 'EM_EXECUCAO', 'ATRASADA')
        )
    ), ins AS (
      INSERT INTO routine_executions (id, "routineId", "scheduledFor")
      SELECT gen_random_uuid(), id, "nextRunAt" FROM due
      ON CONFLICT ("routineId", "scheduledFor") DO NOTHING
      RETURNING id, "routineId"
    ), upd AS (
      UPDATE routines r SET
        "nextRunAt" = CASE r.frequency::text
          WHEN 'DIARIA' THEN r."nextRunAt" + interval '1 day'
          WHEN 'SEMANAL' THEN r."nextRunAt" + interval '7 days'
          WHEN 'QUINZENAL' THEN r."nextRunAt" + interval '14 days'
          WHEN 'MENSAL' THEN r."nextRunAt" + interval '1 month'
          WHEN 'TRIMESTRAL' THEN r."nextRunAt" + interval '3 months'
          WHEN 'ANUAL' THEN r."nextRunAt" + interval '1 year'
          ELSE r."nextRunAt" + make_interval(days => COALESCE(r."intervalDays", 30))
        END,
        "updatedAt" = now()
      FROM ins WHERE r.id = ins."routineId"
      RETURNING r.id
    )
    SELECT ins.id AS "execId", d.name, d."assigneeId", d."substituteId"
    FROM ins JOIN due d ON d.id = ins."routineId"`;

  for (const e of created) {
    await notifyUser(e.assigneeId, 'rotina_gerada', `Rotina pendente: ${e.name}`, undefined, 'routine_executions', e.execId);
    if (e.substituteId) await notifyUser(e.substituteId, 'rotina_gerada', `Rotina pendente (substituto): ${e.name}`, undefined, 'routine_executions', e.execId);
  }

  // Marca atrasadas conforme tolerância (set-based) e notifica sem repetição
  const late = await prisma.$queryRaw<{ id: string; name: string; assigneeId: string }[]>`
    UPDATE routine_executions re
    SET status = 'ATRASADA'::"RoutineExecStatus"
    FROM routines r
    WHERE r.id = re."routineId"
      AND re.status = 'PENDENTE'::"RoutineExecStatus"
      AND re."scheduledFor" + make_interval(hours => r."toleranceHours") < now()
    RETURNING re.id, r.name, r."assigneeId"`;
  for (const e of late) {
    if (!(await alreadyNotified('rotina_vencida', e.id))) {
      await notifyUser(e.assigneeId, 'rotina_vencida', `Rotina atrasada: ${e.name}`, undefined, 'routine_executions', e.id);
    }
  }
}

/** Alertas de SLA vencendo/vencido. */
async function slaAlerts(): Promise<void> {
  const now = new Date();
  const soon = new Date(now.getTime() + 60 * 60_000);

  const expiring = await prisma.ticket.findMany({
    where: {
      status: { in: OPEN_TICKET_STATUSES as never },
      slaPausedAt: null,
      resolutionDueAt: { gte: now, lte: soon },
      assigneeId: { not: null },
    },
    select: { id: true, number: true, assigneeId: true },
  });
  for (const t of expiring) {
    if (await alreadyNotified('sla_vencendo', t.id)) continue;
    await notifyUser(t.assigneeId!, 'sla_vencendo', `SLA do chamado ${t.number} vence em menos de 1h`, undefined, 'tickets', t.id);
  }

  const breached = await prisma.ticket.findMany({
    where: { status: { in: OPEN_TICKET_STATUSES as never }, slaPausedAt: null, resolutionDueAt: { lt: now } },
    select: { id: true, number: true, assigneeId: true },
  });
  for (const t of breached) {
    if (await alreadyNotified('sla_vencido', t.id)) continue;
    if (t.assigneeId) await notifyUser(t.assigneeId, 'sla_vencido', `SLA vencido: ${t.number}`, undefined, 'tickets', t.id);
    await notifyRoles(['GESTOR_TI'], 'sla_vencido', `SLA vencido: ${t.number}`, undefined, 'tickets', t.id);
  }
}

/** Garantias vencendo em 30 dias. */
async function warrantyAlerts(): Promise<void> {
  const soon = new Date(Date.now() + 30 * 24 * 3600_000);
  const assets = await prisma.asset.findMany({
    where: { active: true, warrantyEnd: { gte: new Date(), lte: soon } },
    select: { id: true, code: true, description: true, warrantyEnd: true },
  });
  for (const a of assets) {
    if (await alreadyNotified('garantia_vencendo', a.id)) continue;
    await notifyRoles(['GESTOR_TI'], 'garantia_vencendo', `Garantia de ${a.code} vence em ${a.warrantyEnd!.toLocaleDateString('pt-BR')}`, a.description, 'assets', a.id);
  }
}

async function tick(): Promise<void> {
  try { await autoCloseResolved(); } catch (e) { console.error('[scheduler] autoClose:', e); }
  try { await generateRoutineExecutions(); } catch (e) { console.error('[scheduler] rotinas:', e); }
  try { await slaAlerts(); } catch (e) { console.error('[scheduler] sla:', e); }
  try { await warrantyAlerts(); } catch (e) { console.error('[scheduler] garantias:', e); }
}

export function startScheduler(): void {
  setTimeout(tick, 10_000);
  setInterval(tick, INTERVAL_MS);
  console.log('[scheduler] agendador interno iniciado (intervalo de 5 min)');
}

// Exportado para testes
export const _internal = { autoCloseResolved, generateRoutineExecutions, slaAlerts };

import type { Priority } from '@gestao-ti/shared';

export interface SlaPolicyLike {
  mode: 'CORRIDO' | 'COMERCIAL';
  businessStart: string; // "08:00"
  businessEnd: string;   // "18:00"
  workdays: string;      // "1,2,3,4,5" (1=segunda ... 7=domingo)
  firstResponseP1: number;
  firstResponseP2: number;
  firstResponseP3: number;
  firstResponseP4: number;
  resolutionP1: number;
  resolutionP2: number;
  resolutionP3: number;
  resolutionP4: number;
}

export function slaMinutesFor(policy: SlaPolicyLike, priority: Priority) {
  return {
    firstResponse: policy[`firstResponse${priority}` as keyof SlaPolicyLike] as number,
    resolution: policy[`resolution${priority}` as keyof SlaPolicyLike] as number,
  };
}

function parseHM(s: string): { h: number; m: number } {
  const [h, m] = s.split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

/** Dia da semana ISO: 1=segunda ... 7=domingo (horário local do servidor). */
function isoWeekday(d: Date): number {
  const wd = d.getDay(); // 0=domingo
  return wd === 0 ? 7 : wd;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Soma minutos a uma data respeitando a política de SLA.
 * CORRIDO: soma direta. COMERCIAL: só conta dentro do horário comercial,
 * em dias úteis, pulando feriados. O servidor deve rodar com TZ=America/Sao_Paulo.
 */
export function addSlaMinutes(
  start: Date,
  minutes: number,
  policy: SlaPolicyLike,
  holidays: Date[] = [],
): Date {
  if (policy.mode === 'CORRIDO') {
    return new Date(start.getTime() + minutes * 60_000);
  }

  const workdaySet = new Set(policy.workdays.split(',').map((s) => Number(s.trim())).filter(Boolean));
  const holidaySet = new Set(holidays.map((h) => dateKey(new Date(h))));
  const { h: sh, m: sm } = parseHM(policy.businessStart);
  const { h: eh, m: em } = parseHM(policy.businessEnd);

  const isWorkday = (d: Date) => workdaySet.has(isoWeekday(d)) && !holidaySet.has(dateKey(d));

  let cursor = new Date(start.getTime());
  let remaining = minutes;
  let guard = 0;

  while (guard++ < 3660) {
    const dayStart = new Date(cursor);
    dayStart.setHours(sh, sm, 0, 0);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(eh, em, 0, 0);

    if (!isWorkday(cursor) || cursor >= dayEnd) {
      // próximo dia, no início do expediente
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(sh, sm, 0, 0);
      continue;
    }
    if (cursor < dayStart) cursor = dayStart;

    const availableMin = (dayEnd.getTime() - cursor.getTime()) / 60_000;
    if (remaining <= availableMin) {
      return new Date(cursor.getTime() + remaining * 60_000);
    }
    remaining -= availableMin;
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(sh, sm, 0, 0);
  }
  // fallback de segurança (não deve acontecer com políticas válidas)
  return new Date(start.getTime() + minutes * 60_000);
}

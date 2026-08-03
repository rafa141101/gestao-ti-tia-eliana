/** Formatação de datas e horas em pt-BR (America/Sao_Paulo assumido no ambiente). */

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('pt-BR');
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtMinutes(min: number | null | undefined): string {
  if (min == null || isNaN(min)) return '—';
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.round(Math.abs(min) % 60);
  if (h === 0) return `${m}min`;
  return `${h}h${m > 0 ? ` ${m}min` : ''}`;
}

export function fmtHours(min: number | null | undefined): string {
  if (min == null) return '—';
  return `${(min / 60).toFixed(1).replace('.', ',')}h`;
}

/** Tempo relativo: "há 3h", "em 2d". */
export function fmtRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const diffMs = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const min = Math.round(abs / 60_000);
  const label = min < 60 ? `${min}min` : min < 60 * 24 ? `${Math.round(min / 60)}h` : `${Math.round(min / (60 * 24))}d`;
  return diffMs < 0 ? `há ${label}` : `em ${label}`;
}

/** Situação de um prazo de SLA. */
export function slaState(dueAt: string | null | undefined, doneAt?: string | null): 'ok' | 'warning' | 'breached' | 'done' | 'none' {
  if (!dueAt) return 'none';
  if (doneAt) return new Date(doneAt) <= new Date(dueAt) ? 'done' : 'breached';
  const diff = new Date(dueAt).getTime() - Date.now();
  if (diff < 0) return 'breached';
  if (diff < 2 * 3600_000) return 'warning';
  return 'ok';
}

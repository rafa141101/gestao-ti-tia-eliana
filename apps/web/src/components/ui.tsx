import type { ReactNode } from 'react';
import { X, Inbox } from 'lucide-react';
import {
  TICKET_STATUS_LABELS, PRIORITY_LABELS, PROJECT_STATUS_LABELS, TASK_STATUS_LABELS,
  ASSET_STATUS_LABELS, MOVEMENT_STATUS_LABELS, ROUTINE_EXEC_STATUS_LABELS,
  type TicketStatus, type Priority,
} from '@gestao-ti/shared';

// ---------- Badges ----------

const ticketStatusColor: Record<string, string> = {
  NOVO: 'bg-blue-100 text-blue-800 border-blue-200',
  TRIAGEM: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  ATRIBUIDO: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  EM_ATENDIMENTO: 'bg-amber-100 text-amber-800 border-amber-200',
  AGUARDANDO_SOLICITANTE: 'bg-slate-100 text-slate-600 border-slate-200',
  AGUARDANDO_TERCEIRO: 'bg-purple-100 text-purple-800 border-purple-200',
  AGUARDANDO_APROVACAO: 'bg-orange-100 text-orange-700 border-orange-200',
  AGENDADO: 'bg-teal-100 text-teal-800 border-teal-200',
  PAUSADO_DEPENDENCIA: 'bg-slate-200 text-slate-700 border-slate-300',
  RESOLVIDO: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  FECHADO: 'bg-slate-100 text-slate-500 border-slate-200',
  CANCELADO: 'bg-red-50 text-red-500 border-red-100',
};

export function TicketStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${ticketStatusColor[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {TICKET_STATUS_LABELS[status as TicketStatus] ?? status}
    </span>
  );
}

const priorityColor: Record<Priority, string> = {
  P1: 'bg-red-600 text-white',
  P2: 'bg-orange-500 text-white',
  P3: 'bg-blue-500 text-white',
  P4: 'bg-slate-400 text-white',
};

export function PriorityBadge({ priority, title }: { priority: string; title?: string }) {
  return (
    <span title={title ?? PRIORITY_LABELS[priority as Priority]} className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold ${priorityColor[priority as Priority] ?? 'bg-slate-300'}`}>
      {priority}
    </span>
  );
}

export function GenericBadge({ value, labels, tone = 'slate' }: { value: string; labels?: Record<string, string>; tone?: string }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    green: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    red: 'bg-red-100 text-red-700 border-red-200',
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
    purple: 'bg-purple-100 text-purple-800 border-purple-200',
  };
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {labels?.[value] ?? value}
    </span>
  );
}

export function ProjectStatusBadge({ status }: { status: string }) {
  const tone = status === 'CONCLUIDO' ? 'green' : status === 'BLOQUEADO' || status === 'CANCELADO' ? 'red' : status === 'EM_EXECUCAO' ? 'amber' : 'blue';
  return <GenericBadge value={status} labels={PROJECT_STATUS_LABELS} tone={tone} />;
}

export function TaskStatusBadge({ status }: { status: string }) {
  const tone = status === 'CONCLUIDA' ? 'green' : status === 'BLOQUEADA' ? 'red' : status === 'EM_ANDAMENTO' ? 'amber' : 'slate';
  return <GenericBadge value={status} labels={TASK_STATUS_LABELS} tone={tone} />;
}

export function AssetStatusBadge({ status }: { status: string }) {
  const tone = status === 'EM_USO' ? 'green' : ['EM_MANUTENCAO', 'AGUARDANDO_PECA', 'EXTRAVIADO'].includes(status) ? 'red'
    : ['RESERVA', 'DISPONIVEL'].includes(status) ? 'blue' : ['EM_TRANSFERENCIA', 'EMPRESTADO'].includes(status) ? 'amber' : 'slate';
  return <GenericBadge value={status} labels={ASSET_STATUS_LABELS} tone={tone} />;
}

export function MovementStatusBadge({ status }: { status: string }) {
  const tone = status === 'CONFIRMADA' ? 'green' : status === 'CANCELADA' ? 'red' : ['RECEBIDA', 'EM_TRANSPORTE'].includes(status) ? 'amber' : 'blue';
  return <GenericBadge value={status} labels={MOVEMENT_STATUS_LABELS} tone={tone} />;
}

export function RoutineExecBadge({ status }: { status: string }) {
  const tone = status === 'CONCLUIDA' ? 'green' : status === 'ATRASADA' ? 'red' : status === 'EM_EXECUCAO' ? 'amber' : 'slate';
  return <GenericBadge value={status} labels={ROUTINE_EXEC_STATUS_LABELS} tone={tone} />;
}

export function SlaBadge({ state, label }: { state: 'ok' | 'warning' | 'breached' | 'done' | 'none'; label: string }) {
  const cls = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-300',
    breached: 'bg-red-50 text-red-700 border-red-300 font-semibold',
    done: 'bg-slate-50 text-slate-500 border-slate-200',
    none: 'bg-slate-50 text-slate-400 border-slate-200',
  }[state];
  const prefix = { ok: 'No prazo', warning: 'Vencendo', breached: 'SLA vencido', done: 'Cumprido', none: 'Sem SLA' }[state];
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-xs ${cls}`}>
      {prefix}{label ? ` · ${label}` : ''}
    </span>
  );
}

// ---------- Estruturais ----------

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
    </div>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <Inbox className="mb-3 h-10 w-10 text-slate-300" />
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh]" onClick={onClose}>
      <div className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} p-5`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="label">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <p className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{msg}</p>;
}

export function StatCard({ label, value, tone = 'default', onClick }: { label: string; value: ReactNode; tone?: 'default' | 'danger' | 'warning' | 'success'; onClick?: () => void }) {
  const toneCls = {
    default: 'text-slate-900',
    danger: 'text-red-600',
    warning: 'text-amber-600',
    success: 'text-emerald-600',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`card p-4 text-left ${onClick ? 'transition hover:border-brand-300 hover:shadow' : 'cursor-default'}`}
    >
      <p className={`text-2xl font-bold ${toneCls}`}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500">{label}</p>
    </button>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-sm text-slate-500">
      <span>{total} registro{total === 1 ? '' : 's'}</span>
      <div className="flex items-center gap-2">
        <button className="btn-secondary !py-1" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</button>
        <span>{page} / {pages}</span>
        <button className="btn-secondary !py-1" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima</button>
      </div>
    </div>
  );
}

/** Barra horizontal simples para dashboards (sem lib de gráficos). */
export function BarList({ items, unit }: { items: { label: string; value: number; hint?: string }[]; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2">
      {items.length === 0 && <p className="text-xs text-slate-400">Sem dados no período.</p>}
      {items.map((i) => (
        <div key={i.label}>
          <div className="mb-0.5 flex justify-between text-xs">
            <span className="truncate font-medium text-slate-600">{i.label}</span>
            <span className="text-slate-500">{i.hint ?? `${i.value}${unit ?? ''}`}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

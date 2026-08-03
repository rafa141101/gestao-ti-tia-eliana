import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtRelative, fmtDate } from '../lib/format';
import { PageHeader, Spinner, ErrorText, StatCard, PriorityBadge, TicketStatusBadge, EmptyState, AssetStatusBadge } from '../components/ui';
import { TICKET_STATUS_LABELS } from '@gestao-ti/shared';

export default function DashboardOperacional() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-operational'],
    queryFn: () => api.get<Record<string, any>>('/api/dashboard/operational'),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;
  if (!data) return null;

  return (
    <div>
      <PageHeader title="Painel Operacional" subtitle="Fila, SLA e pendências — clique em qualquer item para abrir." />

      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(data.openByStatus as { status: string; _count: number }[]).map((s) => (
          <StatCard key={s.status} label={TICKET_STATUS_LABELS[s.status as never] ?? s.status} value={s._count} onClick={() => navigate(`/chamados?status=${s.status}`)} />
        ))}
        <StatCard label="SLA vencendo (4h)" value={data.slaWarningCount} tone={data.slaWarningCount > 0 ? 'warning' : 'default'} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={`P1 abertos (${data.p1.length})`} tone={data.p1.length > 0 ? 'danger' : undefined}>
          {data.p1.length === 0 ? <EmptyState title="Nenhum P1 aberto 🎉" /> : (
            <ul className="divide-y divide-slate-50">
              {data.p1.map((t: any) => (
                <li key={t.id} className="flex items-center gap-2 px-4 py-2 hover:bg-red-50/50">
                  <PriorityBadge priority="P1" />
                  <Link to={`/chamados/${t.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-600">{t.number} · {t.title}</Link>
                  <TicketStatusBadge status={t.status} />
                  <span className="text-xs text-slate-400">{t.assignee?.name ?? 'sem téc.'}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`SLA vencido (${data.slaBreached.length})`} tone={data.slaBreached.length > 0 ? 'danger' : undefined}>
          {data.slaBreached.length === 0 ? <EmptyState title="Nenhum SLA vencido" /> : (
            <ul className="divide-y divide-slate-50">
              {data.slaBreached.map((t: any) => (
                <li key={t.id} className="flex items-center gap-2 px-4 py-2">
                  <PriorityBadge priority={t.priority} />
                  <Link to={`/chamados/${t.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-brand-600">{t.number} · {t.title}</Link>
                  <span className="text-xs font-medium text-red-600">venceu {fmtRelative(t.resolutionDueAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Sem responsável (${data.unassigned.length})`}>
          {data.unassigned.length === 0 ? <EmptyState title="Todos os chamados têm responsável" /> : (
            <ul className="divide-y divide-slate-50">
              {data.unassigned.map((t: any) => (
                <li key={t.id} className="flex items-center gap-2 px-4 py-2">
                  <PriorityBadge priority={t.priority} />
                  <Link to={`/chamados/${t.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-brand-600">{t.number} · {t.title}</Link>
                  <span className="text-xs text-slate-400">{t.unit?.name ?? '—'} · {fmtRelative(t.openedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Carga por técnico (chamados abertos)">
          {data.workload.length === 0 ? <EmptyState title="Nenhum chamado atribuído" /> : (
            <ul className="divide-y divide-slate-50">
              {data.workload.map((w: any) => (
                <li key={w.userId} className="flex items-center justify-between px-4 py-2">
                  <span className="text-sm font-medium">{w.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${w.openTickets > 4 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                    {w.openTickets} aberto{w.openTickets === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Parados há mais de 24h (${data.stalled.length})`}>
          {data.stalled.length === 0 ? <EmptyState title="Nada parado" /> : (
            <ul className="divide-y divide-slate-50">
              {data.stalled.map((t: any) => (
                <li key={t.id} className="flex items-center gap-2 px-4 py-2">
                  <TicketStatusBadge status={t.status} />
                  <Link to={`/chamados/${t.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-brand-600">{t.number} · {t.title}</Link>
                  <span className="text-xs text-slate-400">{fmtRelative(t.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Projetos atrasados (${data.lateProjects.length})`}>
          {data.lateProjects.length === 0 ? <EmptyState title="Projetos em dia" /> : (
            <ul className="divide-y divide-slate-50">
              {data.lateProjects.map((p: any) => (
                <li key={p.id} className="flex items-center gap-2 px-4 py-2">
                  <Link to={`/projetos/${p.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-brand-600">{p.name}</Link>
                  <span className="text-xs text-red-600">prazo {fmtDate(p.dueDate)}</span>
                  <span className="text-xs text-slate-400">{p.owner?.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Rotinas vencidas (${data.lateRoutines.length})`}>
          {data.lateRoutines.length === 0 ? <EmptyState title="Rotinas em dia" /> : (
            <ul className="divide-y divide-slate-50">
              {data.lateRoutines.map((e: any) => (
                <li key={e.id} className="flex items-center gap-2 px-4 py-2">
                  <Link to="/rotinas" className="min-w-0 flex-1 truncate text-sm hover:text-brand-600">{e.routine.name}</Link>
                  <span className="text-xs text-red-600">prevista {fmtRelative(e.scheduledFor)}</span>
                  <span className="text-xs text-slate-400">{e.routine.assignee?.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Preventivas vencidas e equipamentos críticos (${data.latePreventives.length + data.criticalAssets.length})`}>
          {data.latePreventives.length + data.criticalAssets.length === 0 ? <EmptyState title="Tudo em dia" /> : (
            <ul className="divide-y divide-slate-50">
              {data.latePreventives.map((a: any) => (
                <li key={a.id} className="flex items-center gap-2 px-4 py-2">
                  <Link to={`/inventario/${a.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-brand-600">{a.code} — {a.description}</Link>
                  <span className="text-xs text-amber-600">preventiva {fmtRelative(a.nextMaintenanceAt)}</span>
                </li>
              ))}
              {data.criticalAssets.map((a: any) => (
                <li key={a.id} className="flex items-center gap-2 px-4 py-2">
                  <Link to={`/inventario/${a.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-brand-600">{a.code} — {a.description}</Link>
                  <AssetStatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, tone, children }: { title: string; tone?: 'danger'; children: React.ReactNode }) {
  return (
    <section className={`card ${tone === 'danger' ? 'border-red-200' : ''}`}>
      <h2 className={`border-b px-4 py-3 text-sm font-bold ${tone === 'danger' ? 'border-red-100 text-red-700' : 'border-slate-100'}`}>{title}</h2>
      {children}
    </section>
  );
}

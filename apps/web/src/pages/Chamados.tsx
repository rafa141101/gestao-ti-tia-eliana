import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, List, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, fmtRelative, slaState } from '../lib/format';
import { PageHeader, Spinner, EmptyState, TicketStatusBadge, PriorityBadge, SlaBadge, Pagination, ErrorText } from '../components/ui';
import { Kanban } from '../components/Kanban';
import {
  TICKET_STATUS_LABELS, TICKET_STATUS_TRANSITIONS, PRIORITIES, PRIORITY_LABELS,
  type TicketStatus,
} from '@gestao-ti/shared';

interface TicketRow {
  id: string; number: string; title: string; status: string; priority: string; channel: string;
  openedAt: string; resolutionDueAt: string | null; firstResponseAt: string | null; resolvedAt: string | null; updatedAt: string;
  requester: { name: string }; assignee?: { id: string; name: string } | null;
  unit?: { name: string } | null; category: { name: string }; queue?: { name: string } | null;
  thirdParty?: { name: string } | null;
}

const KANBAN_COLUMNS: TicketStatus[] = ['NOVO', 'TRIAGEM', 'ATRIBUIDO', 'EM_ATENDIMENTO', 'AGUARDANDO_SOLICITANTE', 'AGUARDANDO_TERCEIRO', 'RESOLVIDO'];

export default function Chamados() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'lista' | 'kanban'>((params.get('view') as 'kanban') ?? 'lista');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [priority, setPriority] = useState(params.get('priority') ?? '');
  const [assignee, setAssignee] = useState(params.get('assigneeId') ?? '');

  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (status) query.set('status', status);
  else if (view === 'kanban') query.set('open', 'true');
  if (priority) query.set('priority', priority);
  if (assignee) query.set('assigneeId', assignee);
  query.set('page', String(view === 'kanban' ? 1 : page));
  query.set('pageSize', view === 'kanban' ? '100' : '25');
  query.set('orderBy', 'priority');

  const { data, isLoading, error } = useQuery({
    queryKey: ['tickets', query.toString()],
    queryFn: () => api.get<{ total: number; page: number; pageSize: number; items: TicketRow[] }>(`/api/tickets?${query}`),
  });

  const { data: users } = useQuery({
    queryKey: ['user-options'],
    queryFn: () => api.get<{ id: string; name: string; role: string }[]>('/api/users/options'),
  });

  const moveTicket = useMutation({
    mutationFn: ({ id, to }: { id: string; to: TicketStatus }) =>
      api.post(`/api/tickets/${id}/status`, { status: to, comment: 'Movido pelo Kanban' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  });

  function applyFilters(next: Record<string, string>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    setParams(p, { replace: true });
    setPage(1);
  }

  const techs = (users ?? []).filter((u) => ['TECNICO', 'GESTOR_TI', 'ADMIN'].includes(u.role));

  return (
    <div>
      <PageHeader title="Chamados" actions={
        <>
          <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
            <button className={`rounded-md px-2.5 py-1.5 text-sm ${view === 'lista' ? 'bg-slate-800 text-white' : 'text-slate-500'}`} onClick={() => { setView('lista'); applyFilters({ view: '' }); }} title="Lista">
              <List className="h-4 w-4" />
            </button>
            <button className={`rounded-md px-2.5 py-1.5 text-sm ${view === 'kanban' ? 'bg-slate-800 text-white' : 'text-slate-500'}`} onClick={() => { setView('kanban'); applyFilters({ view: 'kanban' }); }} title="Kanban">
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          <Link to="/chamados/novo" className="btn-primary"><Plus className="h-4 w-4" /> Novo chamado</Link>
        </>
      } />

      {/* Filtros */}
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-48 flex-1">
          <label className="label">Busca</label>
          <input className="input" placeholder="Número, título ou descrição…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters({ search })} />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input w-44" value={status} onChange={(e) => { setStatus(e.target.value); applyFilters({ status: e.target.value }); }}>
            <option value="">Todos (abertos e fechados)</option>
            {Object.entries(TICKET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Prioridade</label>
          <select className="input w-36" value={priority} onChange={(e) => { setPriority(e.target.value); applyFilters({ priority: e.target.value }); }}>
            <option value="">Todas</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </div>
        {can('tickets.view.all') && (
          <div>
            <label className="label">Técnico</label>
            <select className="input w-44" value={assignee} onChange={(e) => { setAssignee(e.target.value); applyFilters({ assigneeId: e.target.value }); }}>
              <option value="">Todos</option>
              <option value="none">Sem responsável</option>
              {techs.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
        <button className="btn-secondary" onClick={() => applyFilters({ search })}>Filtrar</button>
      </div>

      {isLoading && <Spinner />}
      <ErrorText error={error ?? moveTicket.error} />

      {!isLoading && data && view === 'lista' && (
        <div className="card overflow-x-auto">
          {data.items.length === 0 ? <EmptyState title="Nenhum chamado encontrado" subtitle="Ajuste os filtros ou abra um novo chamado." /> : (
            <>
              <table className="w-full min-w-[900px]">
                <thead className="border-b border-slate-100 bg-slate-50/60">
                  <tr>
                    <th className="th">Chamado</th>
                    <th className="th">Status</th>
                    <th className="th">Prior.</th>
                    <th className="th">Solicitante</th>
                    <th className="th">Técnico</th>
                    <th className="th">Unidade</th>
                    <th className="th">SLA solução</th>
                    <th className="th">Aberto em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.items.map((t) => (
                    <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/chamados/${t.id}`)}>
                      <td className="td">
                        <p className="font-medium text-slate-800">{t.number}</p>
                        <p className="max-w-72 truncate text-xs text-slate-500">{t.title}</p>
                      </td>
                      <td className="td"><TicketStatusBadge status={t.status} /></td>
                      <td className="td"><PriorityBadge priority={t.priority} /></td>
                      <td className="td text-slate-600">{t.requester.name}</td>
                      <td className="td text-slate-600">{t.assignee?.name ?? <span className="text-red-400">Sem responsável</span>}</td>
                      <td className="td text-slate-500">{t.unit?.name ?? '—'}</td>
                      <td className="td"><SlaBadge state={slaState(t.resolutionDueAt, t.resolvedAt)} label={t.resolutionDueAt && !t.resolvedAt ? fmtRelative(t.resolutionDueAt) : ''} /></td>
                      <td className="td text-xs text-slate-500">{fmtDateTime(t.openedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
            </>
          )}
        </div>
      )}

      {!isLoading && data && view === 'kanban' && (
        <Kanban
          columns={KANBAN_COLUMNS.map((s) => ({ key: s, title: TICKET_STATUS_LABELS[s], items: data.items.filter((t) => t.status === s) }))}
          getId={(t) => t.id}
          canDrop={(t, to) => can('tickets.work') && TICKET_STATUS_TRANSITIONS[t.status as TicketStatus]?.includes(to as TicketStatus)}
          onDrop={(t, to) => moveTicket.mutate({ id: t.id, to: to as TicketStatus })}
          renderCard={(t) => (
            <div className="card cursor-pointer p-3 hover:border-brand-300" onClick={() => navigate(`/chamados/${t.id}`)}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">{t.number}</span>
                <PriorityBadge priority={t.priority} />
              </div>
              <p className="line-clamp-2 text-sm font-medium text-slate-800">{t.title}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-400">
                <span className="truncate">{t.assignee?.name ?? 'Sem responsável'}</span>
                <SlaBadge state={slaState(t.resolutionDueAt, t.resolvedAt)} label="" />
              </div>
              <p className="mt-1 text-[10px] text-slate-400">Parado {fmtRelative(t.updatedAt)} · {t.unit?.name ?? '—'}</p>
            </div>
          )}
        />
      )}
    </div>
  );
}

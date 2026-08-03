import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { PageHeader, Spinner, ErrorText, Pagination, EmptyState } from '../components/ui';

export default function Auditoria() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = new URLSearchParams({ page: String(page), pageSize: '50' });
  if (entity) query.set('entity', entity);
  if (action) query.set('action', action);

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', query.toString()],
    queryFn: () => api.get<{ total: number; page: number; pageSize: number; items: any[] }>(`/api/audit?${query}`),
  });

  return (
    <div>
      <PageHeader title="Auditoria" subtitle="Registro imutável de todas as ações — protegido no nível do banco de dados." />

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div>
          <label className="label">Entidade</label>
          <select className="input w-48" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}>
            <option value="">Todas</option>
            {['tickets', 'ticket_worklogs', 'users', 'assets', 'asset_movements', 'asset_components', 'maintenance_records', 'routines', 'routine_executions', 'projects', 'project_tasks', 'sla_policies', 'categories', 'system_settings', 'auth'].map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Ação (contém)</label>
          <input className="input w-48" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="LOGIN, EDICAO, EXPORTACAO…" />
        </div>
      </div>

      {isLoading && <Spinner />}
      <ErrorText error={error} />

      {data && (
        <div className="card overflow-x-auto">
          {data.items.length === 0 ? <EmptyState title="Nenhum registro de auditoria" /> : (
            <>
              <table className="w-full min-w-[800px]">
                <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
                  <th className="th">Data</th><th className="th">Usuário</th><th className="th">Ação</th>
                  <th className="th">Entidade</th><th className="th">Justificativa</th><th className="th">IP</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {data.items.map((l) => (
                    <>
                      <tr key={l.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                        <td className="td whitespace-nowrap text-xs">{fmtDateTime(l.createdAt)}</td>
                        <td className="td text-xs">{l.user?.name ?? 'sistema'}</td>
                        <td className="td"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium">{l.action}</span></td>
                        <td className="td text-xs text-slate-500">{l.entity}{l.entityId ? ` (${String(l.entityId).slice(0, 8)}…)` : ''}</td>
                        <td className="td max-w-52 truncate text-xs italic text-slate-500">{l.justification ?? ''}</td>
                        <td className="td text-xs text-slate-400">{l.ip ?? ''}</td>
                      </tr>
                      {expanded === l.id && (l.before || l.after) && (
                        <tr key={`${l.id}-detail`}>
                          <td colSpan={6} className="bg-slate-50 px-4 py-2">
                            <div className="grid gap-3 text-xs sm:grid-cols-2">
                              {l.before != null && <div><p className="mb-1 font-bold text-slate-500">Valor anterior</p><pre className="overflow-x-auto rounded bg-white p-2 text-[11px]">{JSON.stringify(l.before, null, 2)}</pre></div>}
                              {l.after != null && <div><p className="mb-1 font-bold text-slate-500">Valor novo</p><pre className="overflow-x-auto rounded bg-white p-2 text-[11px]">{JSON.stringify(l.after, null, 2)}</pre></div>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

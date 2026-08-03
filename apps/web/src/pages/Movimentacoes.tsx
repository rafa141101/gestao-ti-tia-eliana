import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { PageHeader, Spinner, ErrorText, MovementStatusBadge, EmptyState } from '../components/ui';
import { MOVEMENT_TYPE_LABELS, MOVEMENT_STATUS_TRANSITIONS, MOVEMENT_STATUS_LABELS, type MovementStatus } from '@gestao-ti/shared';

export default function Movimentacoes() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [onlyPending, setOnlyPending] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ['movements', onlyPending],
    queryFn: () => api.get<any[]>(`/api/movements${onlyPending ? '?pending=true' : ''}`),
  });

  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/api/movements/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['movements'] }); qc.invalidateQueries({ queryKey: ['assets'] }); },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;

  return (
    <div>
      <PageHeader title="Movimentações de equipamentos" subtitle="Nenhum equipamento muda de lugar sem registro. A localização só muda na confirmação." actions={
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          Somente pendentes
        </label>
      } />
      <ErrorText error={advance.error} />

      <div className="card overflow-x-auto">
        {(data ?? []).length === 0 ? <EmptyState title="Nenhuma movimentação encontrada" /> : (
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
              <th className="th">Ativo</th><th className="th">Tipo</th><th className="th">Origem → Destino</th>
              <th className="th">Motivo</th><th className="th">Solicitado por</th><th className="th">Data</th><th className="th">Status</th><th className="th" />
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {(data ?? []).map((m) => {
                const nexts = can('inventory.manage') ? (MOVEMENT_STATUS_TRANSITIONS[m.status as MovementStatus] ?? []) : [];
                return (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="td">
                      <Link className="font-medium text-brand-600 hover:underline" to={`/inventario/${m.asset.id}`}>{m.asset.code}</Link>
                      <p className="max-w-44 truncate text-xs text-slate-400">{m.asset.description}</p>
                    </td>
                    <td className="td text-xs">{MOVEMENT_TYPE_LABELS[m.type as never] ?? m.type}</td>
                    <td className="td text-xs">{m.fromUnit?.name ?? '—'} → {m.toUnit?.name ?? '—'}</td>
                    <td className="td max-w-52 truncate text-xs text-slate-500" title={m.reason}>{m.reason ?? '—'}</td>
                    <td className="td text-xs">{m.requestedBy.name}</td>
                    <td className="td text-xs">{fmtDateTime(m.createdAt)}</td>
                    <td className="td"><MovementStatusBadge status={m.status} /></td>
                    <td className="td text-right">
                      {nexts.length > 0 && (
                        <select className="input !w-auto !py-1 text-xs" value="" onChange={(e) => e.target.value && advance.mutate({ id: m.id, status: e.target.value })}>
                          <option value="">Avançar…</option>
                          {nexts.map((s) => <option key={s} value={s}>{MOVEMENT_STATUS_LABELS[s]}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

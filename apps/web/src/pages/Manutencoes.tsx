import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fmtDate, fmtMinutes } from '../lib/format';
import { PageHeader, Spinner, ErrorText, GenericBadge, EmptyState } from '../components/ui';
import { MAINTENANCE_TYPE_LABELS } from '@gestao-ti/shared';

export default function Manutencoes() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['maintenance'],
    queryFn: () => api.get<any[]>('/api/maintenance'),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;

  return (
    <div>
      <PageHeader title="Manutenções" subtitle="Preventivas, corretivas, limpezas e inspeções — registre pela página do ativo." />
      <div className="card overflow-x-auto">
        {(data ?? []).length === 0 ? <EmptyState title="Nenhuma manutenção registrada" /> : (
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
              <th className="th">Ativo</th><th className="th">Tipo</th><th className="th">Descrição</th>
              <th className="th">Responsável</th><th className="th">Data</th><th className="th">Duração</th><th className="th">Custo</th><th className="th">Operacional</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {(data ?? []).map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="td">
                    <Link className="font-medium text-brand-600 hover:underline" to={`/inventario/${m.asset.id}`}>{m.asset.code}</Link>
                    <p className="max-w-44 truncate text-xs text-slate-400">{m.asset.description}</p>
                  </td>
                  <td className="td"><GenericBadge value={m.type} labels={MAINTENANCE_TYPE_LABELS} tone={m.type === 'PREVENTIVA' ? 'blue' : 'amber'} /></td>
                  <td className="td max-w-64 truncate text-xs" title={m.description}>{m.description}</td>
                  <td className="td text-xs">{m.responsible?.name ?? m.thirdParty?.name ?? '—'}</td>
                  <td className="td text-xs">{fmtDate(m.date)}</td>
                  <td className="td text-xs">{fmtMinutes(m.durationMinutes)}</td>
                  <td className="td text-xs">{m.cost ? `R$ ${Number(m.cost).toLocaleString('pt-BR')}` : '—'}</td>
                  <td className="td text-xs">{m.operational == null ? '—' : m.operational ? '✅ Sim' : '❌ Não'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

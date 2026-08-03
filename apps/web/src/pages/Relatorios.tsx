import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtHours } from '../lib/format';
import { PageHeader, Spinner, ErrorText, BarList } from '../components/ui';
import { TICKET_STATUS_LABELS, PRIORITY_LABELS, CHANNEL_LABELS, WORKLOG_TYPE_LABELS } from '@gestao-ti/shared';

const EXPORTS = [
  { key: 'tickets', label: 'Chamados' },
  { key: 'worklogs', label: 'Tempos trabalhados' },
  { key: 'projects', label: 'Projetos' },
  { key: 'tasks', label: 'Tarefas' },
  { key: 'routines', label: 'Execuções de rotinas' },
  { key: 'assets', label: 'Equipamentos' },
  { key: 'components', label: 'Componentes' },
  { key: 'movements', label: 'Movimentações' },
  { key: 'maintenance', label: 'Manutenções' },
  { key: 'third-parties', label: 'Terceiros' },
  { key: 'audit', label: 'Auditoria' },
];

export default function Relatorios() {
  const { can } = useAuth();
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading, error } = useQuery({
    queryKey: ['report-summary', from, to],
    queryFn: () => api.get<Record<string, any>>(`/api/reports/summary?from=${from}&to=${to}`),
  });

  return (
    <div>
      <PageHeader title="Relatórios e indicadores" subtitle="Análises por período e exportação em CSV." />

      <div className="card mb-5 flex flex-wrap items-end gap-3 p-3">
        <div><label className="label">De</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">Até</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        {can('export.data') && (
          <div className="ml-auto">
            <label className="label">Exportar CSV</label>
            <select className="input w-56" value="" onChange={(e) => {
              if (e.target.value) downloadFile(`/api/reports/export/${e.target.value}?from=${from}&to=${to}`, `${e.target.value}.csv`);
            }}>
              <option value="">Escolha os dados…</option>
              {EXPORTS.filter((x) => x.key !== 'audit' || can('audit.view')).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </div>
        )}
      </div>

      {isLoading && <Spinner />}
      <ErrorText error={error} />

      {data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-bold">Chamados no período: {data.total} · Reabertos: {data.reopened} · SLA: {data.sla.ontime} no prazo / {data.sla.late} fora</h2>
            <BarList items={(data.byStatus as any[]).map((s) => ({ label: TICKET_STATUS_LABELS[s.status as never] ?? s.status, value: s._count }))} />
          </section>
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-bold">Por prioridade</h2>
            <BarList items={(data.byPriority as any[]).map((s) => ({ label: PRIORITY_LABELS[s.priority as never] ?? s.priority, value: s._count }))} />
            <h2 className="mb-3 mt-5 text-sm font-bold">Por canal de origem</h2>
            <BarList items={(data.byChannel as any[]).map((s) => ({ label: CHANNEL_LABELS[s.channel as never] ?? s.channel, value: s._count }))} />
          </section>
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-bold">Por categoria</h2>
            <BarList items={(data.byCategory as any[]).map((s) => ({ label: s.name, value: s.count }))} />
            <h2 className="mb-3 mt-5 text-sm font-bold">Por unidade</h2>
            <BarList items={(data.byUnit as any[]).map((s) => ({ label: s.name, value: s.count }))} />
            <h2 className="mb-3 mt-5 text-sm font-bold">Por setor solicitante</h2>
            <BarList items={(data.byDepartment as any[]).map((s) => ({ label: s.name, value: s.count }))} />
          </section>
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-bold">Por técnico</h2>
            <BarList items={(data.byTech as any[]).map((s) => ({ label: s.name, value: s.count }))} />
            <h2 className="mb-3 mt-5 text-sm font-bold">Horas por tipo de atividade</h2>
            <BarList items={(data.worklogByType as any[]).sort((a, b) => b.minutes - a.minutes).map((s) => ({ label: WORKLOG_TYPE_LABELS[s.type as never] ?? s.type, value: s.minutes, hint: fmtHours(s.minutes) }))} />
          </section>
          <section className="card p-4 lg:col-span-2">
            <h2 className="mb-3 text-sm font-bold">Atenção do inventário</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-2xl font-bold text-amber-600">{data.preventivesLate}</p>
                <p className="text-xs text-slate-500">Preventivas vencidas</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{data.pendingMovements}</p>
                <p className="text-xs text-slate-500">Movimentações pendentes</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{(data.warrantyExpiring as any[]).length}</p>
                <p className="text-xs text-slate-500">Garantias vencendo em 60 dias</p>
              </div>
            </div>
            {(data.warrantyExpiring as any[]).length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {(data.warrantyExpiring as any[]).map((a) => (
                  <li key={a.code} className="flex justify-between text-slate-600">
                    <span>{a.code} — {a.description}</span>
                    <span className="text-xs text-amber-600">garantia até {fmtDate(a.warrantyEnd)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

void Download;

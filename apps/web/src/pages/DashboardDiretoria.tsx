import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtMinutes, fmtRelative, fmtHours } from '../lib/format';
import { PageHeader, Spinner, ErrorText, StatCard, PriorityBadge, TicketStatusBadge, BarList, EmptyState } from '../components/ui';
import { WORKLOG_TYPE_LABELS } from '@gestao-ti/shared';

export default function DashboardDiretoria() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-direction'],
    queryFn: () => api.get<Record<string, any>>('/api/dashboard/direction'),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;
  if (!data) return null;

  const op = data.operational;

  return (
    <div>
      <PageHeader title="Visão da Diretoria" subtitle="Quem está trabalhando, em quê, e o que precisa de atenção — atualizado a cada minuto." />

      {/* Bloco AGORA */}
      <section className="card mb-5">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-bold">Agora — quem está trabalhando</h2>
        {data.now.length === 0 ? (
          <EmptyState title="Nenhuma atividade em andamento neste momento" subtitle="As atividades aparecem aqui quando um técnico inicia um atendimento, tarefa ou rotina." />
        ) : (
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <th className="th">Técnico</th>
                <th className="th">Atividade</th>
                <th className="th">Tipo</th>
                <th className="th">Desde</th>
                <th className="th">Prioridade</th>
                <th className="th">Unidade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.now.map((w: any) => (
                <tr key={w.id} className={w.ticket ? 'cursor-pointer hover:bg-slate-50' : ''} onClick={() => w.ticket && navigate(`/chamados/${w.ticket.id}`)}>
                  <td className="td font-medium">{w.user.name}</td>
                  <td className="td">
                    {w.ticket ? `${w.ticket.number} — ${w.ticket.title}`
                      : w.task ? `${w.task.project?.name}: ${w.task.title}`
                      : w.routineExecution ? `Rotina: ${w.routineExecution.routine.name}`
                      : w.maintenance ? `Manutenção: ${w.maintenance.description}` : '—'}
                  </td>
                  <td className="td text-xs text-slate-500">{WORKLOG_TYPE_LABELS[w.type as never] ?? w.type}</td>
                  <td className="td text-xs">{fmtRelative(w.startedAt)}</td>
                  <td className="td">{w.ticket ? <PriorityBadge priority={w.ticket.priority} /> : '—'}</td>
                  <td className="td text-xs text-slate-500">{w.ticket?.unit?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Bloco operacional */}
      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Chamados abertos" value={op.openTotal} onClick={() => navigate('/chamados')} />
        <StatCard label="Sem responsável" value={op.unassignedCount} tone={op.unassignedCount > 0 ? 'warning' : 'default'} onClick={() => navigate('/chamados?assigneeId=none')} />
        <StatCard label="Em atendimento" value={op.inProgress} onClick={() => navigate('/chamados?status=EM_ATENDIMENTO')} />
        <StatCard label="SLA vencido" value={op.slaBreachedCount} tone={op.slaBreachedCount > 0 ? 'danger' : 'success'} />
        <StatCard label="P1 abertos" value={op.p1Count} tone={op.p1Count > 0 ? 'danger' : 'success'} onClick={() => navigate('/chamados?priority=P1')} />
        <StatCard label="Aguardando solicitante" value={op.waitingRequester} onClick={() => navigate('/chamados?status=AGUARDANDO_SOLICITANTE')} />
        <StatCard label="Aguardando terceiro" value={op.waitingThird} onClick={() => navigate('/chamados?status=AGUARDANDO_TERCEIRO')} />
        <StatCard label="Tarefas vencidas" value={op.lateTasks} tone={op.lateTasks > 0 ? 'warning' : 'default'} onClick={() => navigate('/projetos')} />
        <StatCard label="Rotinas atrasadas" value={op.lateRoutinesCount} tone={op.lateRoutinesCount > 0 ? 'warning' : 'default'} onClick={() => navigate('/rotinas')} />
        <StatCard label="Backlog (idade)" value={`${data.managerial.backlogAgeDays}d`} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Distribuição do trabalho */}
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-bold">Distribuição do trabalho (30 dias)</h2>
          <BarList items={(data.distribution as { type: string; minutes: number }[])
            .sort((a, b) => b.minutes - a.minutes)
            .map((d) => ({ label: WORKLOG_TYPE_LABELS[d.type as never] ?? d.type, value: d.minutes, hint: fmtHours(d.minutes) }))} />
        </section>

        {/* Indicadores gerenciais */}
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-bold">Indicadores (30 dias)</h2>
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
            <div><p className="text-xl font-bold">{data.managerial.opened30}</p><p className="text-xs text-slate-500">Entradas</p></div>
            <div><p className="text-xl font-bold">{data.managerial.closed30}</p><p className="text-xs text-slate-500">Saídas</p></div>
            <div><p className="text-xl font-bold">{data.managerial.slaCompliance != null ? `${data.managerial.slaCompliance}%` : '—'}</p><p className="text-xs text-slate-500">Dentro do SLA</p></div>
            <div><p className="text-xl font-bold">{fmtMinutes(data.managerial.avgFirstResponseMin)}</p><p className="text-xs text-slate-500">1ª resposta média</p></div>
            <div><p className="text-xl font-bold">{fmtMinutes(data.managerial.avgResolutionMin)}</p><p className="text-xs text-slate-500">Solução média</p></div>
            <div><p className="text-xl font-bold">{data.managerial.reopenRate}%</p><p className="text-xs text-slate-500">Reabertura</p></div>
          </div>
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            Números de chamados fechados não medem desempenho sozinhos: considere horas, complexidade e projetos em <Link className="text-brand-600 hover:underline" to="/relatorios">Relatórios</Link>.
          </p>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-bold">Horas por técnico (30 dias)</h2>
          <BarList items={(data.managerial.hoursByTech as { name: string; minutes: number }[]).sort((a, b) => b.minutes - a.minutes).map((t) => ({ label: t.name, value: t.minutes, hint: fmtHours(t.minutes) }))} />
          <h2 className="mb-3 mt-5 text-sm font-bold">Chamados resolvidos por técnico</h2>
          <BarList items={(data.managerial.ticketsByTech as { name: string; count: number }[]).map((t) => ({ label: t.name, value: t.count }))} />
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-bold">Horas por categoria (30 dias)</h2>
          <BarList items={(data.managerial.hoursByCategory as { name: string; minutes: number }[]).map((c) => ({ label: c.name, value: c.minutes, hint: fmtHours(c.minutes) }))} />
          <h2 className="mb-3 mt-5 text-sm font-bold">Equipamentos com mais chamados</h2>
          <BarList items={(data.managerial.topAssets as { code: string; description: string; count: number }[]).map((a) => ({ label: `${a.code} ${a.description}`, value: a.count }))} />
          <h2 className="mb-3 mt-5 text-sm font-bold">Setores que mais solicitam</h2>
          <BarList items={(data.managerial.topDepartments as { name: string; count: number }[]).map((d) => ({ label: d.name, value: d.count }))} />
        </section>
      </div>
    </div>
  );
}

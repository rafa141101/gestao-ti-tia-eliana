import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Play, Square, AlertTriangle, CalendarClock, Hourglass } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDateTime, fmtRelative, slaState } from '../lib/format';
import { PageHeader, Spinner, EmptyState, TicketStatusBadge, PriorityBadge, TaskStatusBadge, RoutineExecBadge, SlaBadge, StatCard, ErrorText, Modal, Field } from '../components/ui';
import { WORKLOG_TYPE_LABELS, WORKLOG_TYPES } from '@gestao-ti/shared';
import { useState } from 'react';

interface MyWork {
  running: {
    id: string; startedAt: string; type: string;
    ticket?: { id: string; number: string; title: string; priority: string } | null;
    task?: { id: string; title: string; project?: { id: string; name: string } } | null;
    routineExecution?: { id: string; routine: { name: string } } | null;
  } | null;
  myTickets: { id: string; number: string; title: string; status: string; priority: string; resolutionDueAt: string | null; firstResponseAt: string | null; firstResponseDueAt: string | null; openedAt: string; requester: { name: string }; unit?: { name: string } | null }[];
  myTasks: { id: string; title: string; status: string; dueDate: string | null; project: { id: string; name: string } }[];
  myRoutines: { id: string; scheduledFor: string; status: string; routine: { id: string; name: string; estimatedMinutes?: number; criticality: string } }[];
  overdueCount: number;
  waiting: { id: string; number: string; title: string; status: string; returnForecast: string | null; updatedAt: string }[];
  scheduled: { id: string; number: string; title: string; scheduledFor: string | null }[];
  unreadCount: number;
}

export default function MeuTrabalho() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [stopModal, setStopModal] = useState(false);
  const [result, setResult] = useState('');
  const [nextStep, setNextStep] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['my-work'],
    queryFn: () => api.get<MyWork>('/api/dashboard/my-work'),
    refetchInterval: 60_000,
  });

  const startWork = useMutation({
    mutationFn: (input: { ticketId?: string; taskId?: string; routineExecutionId?: string; type: string }) =>
      api.post('/api/worklogs/start', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-work'] });
      qc.invalidateQueries({ queryKey: ['running-worklog'] });
    },
  });

  const stopWork = useMutation({
    mutationFn: () => api.post(`/api/worklogs/${data?.running?.id}/stop`, { result, nextStep }),
    onSuccess: () => {
      setStopModal(false);
      setResult(''); setNextStep('');
      qc.invalidateQueries({ queryKey: ['my-work'] });
      qc.invalidateQueries({ queryKey: ['running-worklog'] });
    },
  });

  const startRoutine = useMutation({
    mutationFn: async (execId: string) => {
      await api.post(`/api/routines/executions/${execId}/start`);
      return api.post('/api/worklogs/start', { routineExecutionId: execId, type: 'ACOMPANHAMENTO' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-work'] }),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;
  if (!data) return null;

  const runningLabel = data.running?.ticket
    ? `${data.running.ticket.number} — ${data.running.ticket.title}`
    : data.running?.task
      ? `${data.running.task.project?.name}: ${data.running.task.title}`
      : data.running?.routineExecution?.routine.name ?? null;

  return (
    <div>
      <PageHeader title="Meu Trabalho" subtitle="O que eu preciso fazer agora?" actions={
        <Link to="/chamados/novo" className="btn-primary">Abrir chamado</Link>
      } />

      {/* Atividade atual */}
      <div className={`card mb-5 p-4 ${data.running ? 'border-emerald-300 bg-emerald-50/50' : ''}`}>
        {data.running ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-emerald-600">Atividade em andamento · {WORKLOG_TYPE_LABELS[data.running.type as never] ?? data.running.type}</p>
              <p className="mt-0.5 font-medium">{runningLabel}</p>
              <p className="text-xs text-slate-500">Iniciada {fmtRelative(data.running.startedAt)} ({fmtDateTime(data.running.startedAt)})</p>
            </div>
            <button className="btn-secondary" onClick={() => setStopModal(true)}>
              <Square className="h-4 w-4" /> Concluir / pausar
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Nenhuma atividade em andamento. Inicie um chamado, tarefa ou rotina abaixo — o tempo é registrado automaticamente.</p>
        )}
      </div>

      {/* Indicadores rápidos */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Chamados atribuídos a mim" value={data.myTickets.length} />
        <StatCard label="Com SLA vencido" value={data.overdueCount} tone={data.overdueCount > 0 ? 'danger' : 'default'} />
        <StatCard label="Rotinas pendentes" value={data.myRoutines.length} tone={data.myRoutines.some((r) => r.status === 'ATRASADA') ? 'warning' : 'default'} />
        <StatCard label="Aguardando retorno" value={data.waiting.length} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* Chamados */}
        <section className="card">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-bold">Meus chamados</h2>
          {data.myTickets.length === 0 ? <EmptyState title="Nenhum chamado atribuído a você" /> : (
            <ul className="divide-y divide-slate-50">
              {data.myTickets.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <PriorityBadge priority={t.priority} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/chamados/${t.id}`} className="block truncate text-sm font-medium text-slate-800 hover:text-brand-600">
                      {t.number} · {t.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                      <TicketStatusBadge status={t.status} />
                      <span>{t.requester.name}</span>
                      {t.unit && <span>· {t.unit.name}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <SlaBadge state={slaState(t.resolutionDueAt)} label={t.resolutionDueAt ? fmtRelative(t.resolutionDueAt) : ''} />
                    <button
                      className="btn-primary !px-2 !py-1 text-xs"
                      onClick={() => startWork.mutate({ ticketId: t.id, type: 'ATENDIMENTO_REMOTO' })}
                      disabled={startWork.isPending || data.running?.ticket?.id === t.id}
                    >
                      <Play className="h-3 w-3" /> Iniciar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {startWork.error != null && <div className="px-4 pb-3"><ErrorText error={startWork.error} /></div>}
        </section>

        <div className="space-y-5">
          {/* Rotinas do dia */}
          <section className="card">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-bold">Rotinas pendentes</h2>
            {data.myRoutines.length === 0 ? <EmptyState title="Nenhuma rotina pendente" /> : (
              <ul className="divide-y divide-slate-50">
                {data.myRoutines.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link to="/rotinas" className="block truncate text-sm font-medium hover:text-brand-600">{r.routine.name}</Link>
                      <p className="text-xs text-slate-400">Prevista para {fmtDateTime(r.scheduledFor)}</p>
                    </div>
                    <RoutineExecBadge status={r.status} />
                    {r.status !== 'EM_EXECUCAO' && (
                      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => startRoutine.mutate(r.id)} disabled={startRoutine.isPending}>
                        <Play className="h-3 w-3" /> Executar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Tarefas de projeto */}
          <section className="card">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-bold">Minhas tarefas de projeto</h2>
            {data.myTasks.length === 0 ? <EmptyState title="Nenhuma tarefa aberta" /> : (
              <ul className="divide-y divide-slate-50">
                {data.myTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link to={`/projetos/${t.project.id}`} className="block truncate text-sm font-medium hover:text-brand-600">{t.title}</Link>
                      <p className="text-xs text-slate-400">{t.project.name}{t.dueDate ? ` · prazo ${fmtRelative(t.dueDate)}` : ''}</p>
                    </div>
                    <TaskStatusBadge status={t.status} />
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      onClick={() => startWork.mutate({ taskId: t.id, type: 'DESENVOLVIMENTO' })}
                      disabled={startWork.isPending}
                    >
                      <Play className="h-3 w-3" /> Iniciar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Aguardando retorno / agendados */}
          {(data.waiting.length > 0 || data.scheduled.length > 0) && (
            <section className="card p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Hourglass className="h-4 w-4 text-slate-400" /> Aguardando retorno / agendados</h2>
              <ul className="space-y-1.5">
                {data.waiting.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link to={`/chamados/${t.id}`} className="truncate hover:text-brand-600">{t.number} · {t.title}</Link>
                    <span className="shrink-0 text-xs text-slate-400">
                      {t.returnForecast ? <><CalendarClock className="mr-1 inline h-3 w-3" />retorno {fmtRelative(t.returnForecast)}</> : `parado ${fmtRelative(t.updatedAt)}`}
                    </span>
                  </li>
                ))}
                {data.scheduled.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link to={`/chamados/${t.id}`} className="truncate hover:text-brand-600">{t.number} · {t.title}</Link>
                    <span className="shrink-0 text-xs text-teal-600"><AlertTriangle className="mr-1 inline h-3 w-3" />agendado {t.scheduledFor ? fmtRelative(t.scheduledFor) : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {stopModal && (
        <Modal title="Concluir / pausar atividade" onClose={() => setStopModal(false)}>
          <div className="space-y-3">
            <Field label="O que foi feito / resultado">
              <textarea className="input" rows={3} value={result} onChange={(e) => setResult(e.target.value)} placeholder="Ex.: sensor limpo, teste de impressão OK" />
            </Field>
            <Field label="Próximo passo (se houver)">
              <input className="input" value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="Ex.: devolver impressora para a expedição" />
            </Field>
            <ErrorText error={stopWork.error} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setStopModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={() => stopWork.mutate()} disabled={stopWork.isPending}>Encerrar apontamento</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Tipos usados apenas para inferência nas opções de worklog
void WORKLOG_TYPES;

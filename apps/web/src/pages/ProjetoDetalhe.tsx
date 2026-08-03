import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtHours } from '../lib/format';
import { PageHeader, Spinner, ErrorText, ProjectStatusBadge, PriorityBadge, TaskStatusBadge, Modal, Field, EmptyState } from '../components/ui';
import { Kanban } from '../components/Kanban';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, TASK_STATUSES, TASK_STATUS_LABELS } from '@gestao-ti/shared';

export default function ProjetoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['project', id] }); qc.invalidateQueries({ queryKey: ['projects'] }); };

  const [taskModal, setTaskModal] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [view, setView] = useState<'kanban' | 'lista'>('kanban');

  const { data: p, isLoading, error } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get<Record<string, any>>(`/api/projects/${id}`),
  });
  const { data: users } = useQuery({
    queryKey: ['user-options'],
    queryFn: () => api.get<{ id: string; name: string; role: string }[]>('/api/users/options'),
  });

  const updateProject = useMutation({
    mutationFn: (input: Record<string, unknown>) => api.patch(`/api/projects/${id}`, input),
    onSuccess: invalidate,
  });
  const createTask = useMutation({
    mutationFn: () => api.post(`/api/projects/${id}/tasks`, { title: taskTitle, assigneeId: taskAssignee || null, dueDate: taskDue || null }),
    onSuccess: () => { setTaskModal(false); setTaskTitle(''); invalidate(); },
  });
  const moveTask = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) => api.patch(`/api/projects/tasks/${taskId}`, { status }),
    onSuccess: invalidate,
  });
  const startWork = useMutation({
    mutationFn: (taskId: string) => api.post('/api/worklogs/start', { taskId, type: 'DESENVOLVIMENTO' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['running-worklog'] }),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;
  if (!p) return null;

  const canManage = can('projects.manage');

  return (
    <div>
      <PageHeader title={p.name} subtitle={p.objective ?? undefined} actions={
        <>
          {canManage && (
            <select className="input w-44" value={p.status} onChange={(e) => updateProject.mutate({ status: e.target.value })}>
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}
            </select>
          )}
          <button className="btn-primary" onClick={() => setTaskModal(true)}><Plus className="h-4 w-4" /> Tarefa</button>
        </>
      } />
      <ErrorText error={updateProject.error ?? moveTask.error ?? startWork.error} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="card p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Status</p><ProjectStatusBadge status={p.status} /></div>
        <div className="card p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Prioridade</p><PriorityBadge priority={p.priority} /></div>
        <div className="card p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Responsável</p><p className="text-sm">{p.owner?.name ?? '—'}</p></div>
        <div className="card p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Horas</p><p className="text-sm">{fmtHours(p.workedMinutes)}{p.estimatedHours ? ` / ${p.estimatedHours}h prev.` : ''}</p></div>
        <div className="card p-3">
          <p className="text-[10px] font-bold uppercase text-slate-400">% concluído</p>
          {canManage ? (
            <input type="number" min={0} max={100} className="input !py-1" defaultValue={p.percentComplete}
              onBlur={(e) => Number(e.target.value) !== p.percentComplete && updateProject.mutate({ percentComplete: Number(e.target.value) })} />
          ) : <p className="text-sm">{p.percentComplete}%</p>}
        </div>
      </div>

      {(p.blocks || p.risks || p.dependencies || p.infoOwnerArea) && (
        <div className="card mb-5 grid gap-3 p-4 text-sm sm:grid-cols-2">
          {p.blocks && <p><span className="font-semibold text-red-600">Bloqueios:</span> {p.blocks}</p>}
          {p.risks && <p><span className="font-semibold text-amber-600">Riscos:</span> {p.risks}</p>}
          {p.dependencies && <p><span className="font-semibold">Dependências:</span> {p.dependencies}</p>}
          {p.infoOwnerArea && <p><span className="font-semibold">Área responsável pela informação:</span> {p.infoOwnerArea}</p>}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold">Tarefas ({p.tasks.length})</h2>
        <div className="flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
          <button className={`rounded-md px-2.5 py-1 ${view === 'kanban' ? 'bg-slate-800 text-white' : 'text-slate-500'}`} onClick={() => setView('kanban')}>Kanban</button>
          <button className={`rounded-md px-2.5 py-1 ${view === 'lista' ? 'bg-slate-800 text-white' : 'text-slate-500'}`} onClick={() => setView('lista')}>Lista</button>
        </div>
      </div>

      {p.tasks.length === 0 ? <div className="card"><EmptyState title="Nenhuma tarefa ainda" subtitle="Crie a primeira tarefa do projeto." /></div> : view === 'kanban' ? (
        <Kanban
          columns={TASK_STATUSES.map((s) => ({ key: s, title: TASK_STATUS_LABELS[s], items: p.tasks.filter((t: any) => t.status === s) }))}
          getId={(t: any) => t.id}
          onDrop={(t: any, to) => moveTask.mutate({ taskId: t.id, status: to })}
          renderCard={(t: any) => (
            <div className="card p-3">
              <p className="text-sm font-medium">{t.title}</p>
              <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                <span>{t.assignee?.name ?? 'Sem responsável'}</span>
                <span>{fmtHours(t.workedMinutes)}</span>
              </div>
              {t.dueDate && <p className="mt-0.5 text-[10px] text-slate-400">Prazo: {fmtDate(t.dueDate)}</p>}
              {t.status !== 'CONCLUIDA' && t.status !== 'CANCELADA' && can('tickets.work') && (
                <button className="btn-secondary mt-2 !px-2 !py-1 text-xs" onClick={() => startWork.mutate(t.id)}>
                  <Play className="h-3 w-3" /> Iniciar
                </button>
              )}
            </div>
          )}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
              <th className="th">Tarefa</th><th className="th">Status</th><th className="th">Responsável</th><th className="th">Prazo</th><th className="th">Horas</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {p.tasks.map((t: any) => (
                <tr key={t.id}>
                  <td className="td font-medium">{t.title}</td>
                  <td className="td"><TaskStatusBadge status={t.status} /></td>
                  <td className="td text-slate-600">{t.assignee?.name ?? '—'}</td>
                  <td className="td text-xs">{fmtDate(t.dueDate)}</td>
                  <td className="td text-xs">{fmtHours(t.workedMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {p.tickets.length > 0 && (
        <section className="card mt-5 p-4">
          <h2 className="mb-2 text-sm font-bold">Chamados vinculados</h2>
          <ul className="space-y-1 text-sm">
            {p.tickets.map((t: any) => (
              <li key={t.id}><Link className="text-brand-600 hover:underline" to={`/chamados/${t.id}`}>{t.number} — {t.title}</Link></li>
            ))}
          </ul>
        </section>
      )}

      {taskModal && (
        <Modal title="Nova tarefa" onClose={() => setTaskModal(false)}>
          <div className="space-y-3">
            <Field label="Título" required><input className="input" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Responsável">
                <select className="input" value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)}>
                  <option value="">—</option>
                  {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Prazo"><input type="date" className="input" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} /></Field>
            </div>
            <ErrorText error={createTask.error} />
            <div className="flex justify-end">
              <button className="btn-primary" disabled={createTask.isPending || taskTitle.length < 2} onClick={() => createTask.mutate()}>Criar tarefa</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtHours } from '../lib/format';
import { PageHeader, Spinner, ErrorText, ProjectStatusBadge, PriorityBadge, EmptyState, Modal, Field } from '../components/ui';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, PRIORITIES, PRIORITY_LABELS } from '@gestao-ti/shared';

export default function Projetos() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [createModal, setCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [priority, setPriority] = useState('P4');
  const [dueDate, setDueDate] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<any[]>('/api/projects'),
  });

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/projects', { name, objective, priority, dueDate: dueDate || null }),
    onSuccess: (res) => { setCreateModal(false); qc.invalidateQueries({ queryKey: ['projects'] }); navigate(`/projetos/${res.id}`); },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;

  const grouped = PROJECT_STATUSES.map((s) => ({ status: s, items: (data ?? []).filter((p) => p.status === s) })).filter((g) => g.items.length > 0);

  return (
    <div>
      <PageHeader title="Projetos e desenvolvimentos" subtitle="Nem todo trabalho da TI é chamado — projetos têm etapas, tarefas e horas." actions={
        can('projects.manage') && <button className="btn-primary" onClick={() => setCreateModal(true)}><Plus className="h-4 w-4" /> Novo projeto</button>
      } />

      {(data ?? []).length === 0 && <div className="card"><EmptyState title="Nenhum projeto cadastrado" /></div>}

      {grouped.map((g) => (
        <section key={g.status} className="mb-5">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{PROJECT_STATUS_LABELS[g.status]} ({g.items.length})</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {g.items.map((p) => (
              <Link key={p.id} to={`/projetos/${p.id}`} className="card p-4 transition hover:border-brand-300 hover:shadow">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <ProjectStatusBadge status={p.status} />
                  <PriorityBadge priority={p.priority} />
                </div>
                <p className="font-semibold text-slate-800">{p.name}</p>
                {p.objective && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{p.objective}</p>}
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>{p.percentComplete}% concluído</span>
                    <span>{p._count.tasks} tarefa{p._count.tasks === 1 ? '' : 's'}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${p.percentComplete}%` }} />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                  <span>{p.owner?.name ?? 'Sem responsável'}</span>
                  <span>
                    {fmtHours(p.workedMinutes)}{p.estimatedHours ? ` / ${p.estimatedHours}h` : ''}
                    {p.dueDate && <> · prazo {fmtDate(p.dueDate)}</>}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {createModal && (
        <Modal title="Novo projeto" onClose={() => setCreateModal(false)}>
          <div className="space-y-3">
            <Field label="Nome" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Objetivo"><textarea className="input" rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prioridade">
                <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                </select>
              </Field>
              <Field label="Prazo"><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
            </div>
            <ErrorText error={create.error} />
            <div className="flex justify-end">
              <button className="btn-primary" disabled={create.isPending || name.length < 3} onClick={() => create.mutate()}>Criar projeto</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

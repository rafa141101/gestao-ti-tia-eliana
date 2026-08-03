import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader, Spinner, ErrorText, Modal, Field } from '../../components/ui';

type Kind = 'units' | 'departments' | 'queues';

export default function Estrutura() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['structure'] });
  const [modal, setModal] = useState<null | { kind: Kind; id?: string }>(null);
  const [name, setName] = useState('');
  const [unitId, setUnitId] = useState('');
  const [assignmentMode, setAssignmentMode] = useState('MANUAL');
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['structure'],
    queryFn: () => api.get<{ organizations: any[]; units: any[]; departments: any[]; queues: any[] }>('/api/structure/all'),
  });
  const { data: users } = useQuery({
    queryKey: ['user-options'],
    queryFn: () => api.get<{ id: string; name: string; role: string }[]>('/api/users/options'),
  });
  const techs = (users ?? []).filter((u) => ['TECNICO', 'GESTOR_TI', 'ADMIN'].includes(u.role));

  const save = useMutation({
    mutationFn: async () => {
      if (!modal) throw new Error('sem modal');
      const body = modal.kind === 'departments' ? { name, unitId: unitId || null }
        : modal.kind === 'queues' ? { name, assignmentMode }
        : { name };
      const saved = modal.id
        ? await api.patch<{ id: string }>(`/api/structure/${modal.kind}/${modal.id}`, body)
        : await api.post<{ id: string }>(`/api/structure/${modal.kind}`, body);
      if (modal.kind === 'queues') {
        const queueId = modal.id ?? saved.id;
        await api.put(`/api/structure/queues/${queueId}/members`, { userIds: memberIds });
      }
      return saved;
    },
    onSuccess: () => { setModal(null); setName(''); setUnitId(''); setAssignmentMode('MANUAL'); setMemberIds([]); invalidate(); },
  });

  async function openQueueEdit(queue: any) {
    setName(queue.name);
    setAssignmentMode(queue.assignmentMode ?? 'MANUAL');
    const members = await api.get<{ userId: string }[]>(`/api/structure/queues/${queue.id}/members`).catch(() => []);
    setMemberIds(members.map((m) => m.userId));
    setModal({ kind: 'queues', id: queue.id });
  }
  const toggle = useMutation({
    mutationFn: ({ kind, id, active }: { kind: Kind; id: string; active: boolean }) =>
      api.patch(`/api/structure/${kind}/${id}`, { active }),
    onSuccess: invalidate,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;

  const sections: { kind: Kind; title: string; items: any[]; subtitle?: (i: any) => string }[] = [
    { kind: 'units', title: 'Unidades', items: data?.units ?? [] },
    { kind: 'departments', title: 'Setores', items: data?.departments ?? [], subtitle: (d) => data?.units.find((u) => u.id === d.unitId)?.name ?? '' },
    { kind: 'queues', title: 'Filas de atendimento', items: data?.queues ?? [], subtitle: (q) => `${q.assignmentMode === 'ROUND_ROBIN' ? 'Distribuição automática (rodízio)' : 'Distribuição manual'}${q.description ? ` · ${q.description}` : ''}` },
  ];

  return (
    <div>
      <PageHeader title="Unidades, setores e filas" subtitle={`Organização: ${data?.organizations[0]?.name ?? '—'}`} />
      <ErrorText error={toggle.error} />
      <div className="grid gap-5 lg:grid-cols-3">
        {sections.map((s) => (
          <section key={s.kind} className="card">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold">{s.title}</h2>
              <button className="btn-secondary !py-1 text-xs" onClick={() => { setName(''); setUnitId(''); setModal({ kind: s.kind }); }}>
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </button>
            </div>
            <ul className="divide-y divide-slate-50">
              {s.items.map((i) => (
                <li key={i.id} className={`flex items-center justify-between px-4 py-2 text-sm ${i.active === false ? 'opacity-50' : ''}`}>
                  <div>
                    <p className="font-medium">{i.name}</p>
                    {s.subtitle?.(i) && <p className="text-xs text-slate-400">{s.subtitle(i)}</p>}
                  </div>
                  <div className="space-x-2 text-xs">
                    <button className="text-brand-600 hover:underline" onClick={() => {
                      if (s.kind === 'queues') { void openQueueEdit(i); return; }
                      setName(i.name); setUnitId(i.unitId ?? ''); setModal({ kind: s.kind, id: i.id });
                    }}>Editar</button>
                    <button className={i.active === false ? 'text-emerald-600 hover:underline' : 'text-red-500 hover:underline'}
                      onClick={() => toggle.mutate({ kind: s.kind, id: i.id, active: i.active === false })}>
                      {i.active === false ? 'Reativar' : 'Inativar'}
                    </button>
                  </div>
                </li>
              ))}
              {s.items.length === 0 && <li className="px-4 py-4 text-xs text-slate-400">Nenhum registro.</li>}
            </ul>
          </section>
        ))}
      </div>

      {modal && (
        <Modal title={`${modal.id ? 'Editar' : 'Adicionar'} — ${sections.find((s) => s.kind === modal.kind)?.title}`} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Field label="Nome" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            {modal.kind === 'departments' && (
              <Field label="Unidade">
                <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  <option value="">—</option>
                  {(data?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
            )}
            {modal.kind === 'queues' && (
              <>
                <Field label="Distribuição de chamados">
                  <select className="input" value={assignmentMode} onChange={(e) => setAssignmentMode(e.target.value)}>
                    <option value="MANUAL">Manual (gestor distribui)</option>
                    <option value="ROUND_ROBIN">Automática — rodízio entre os membros</option>
                  </select>
                </Field>
                <Field label="Membros da fila (participam do rodízio)">
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                    {techs.map((u) => (
                      <label key={u.id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={memberIds.includes(u.id)}
                          onChange={(e) => setMemberIds((ids) => e.target.checked ? [...ids, u.id] : ids.filter((x) => x !== u.id))}
                        />
                        {u.name}
                      </label>
                    ))}
                    {techs.length === 0 && <p className="text-xs text-slate-400">Nenhum técnico cadastrado.</p>}
                  </div>
                </Field>
              </>
            )}
            <ErrorText error={save.error} />
            <div className="flex justify-end">
              <button className="btn-primary" disabled={save.isPending || name.length < 2} onClick={() => save.mutate()}>Salvar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

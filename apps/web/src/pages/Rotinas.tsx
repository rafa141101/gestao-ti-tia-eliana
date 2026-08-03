import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, CheckCircle2, Paperclip } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, fmtRelative } from '../lib/format';
import { PageHeader, Spinner, ErrorText, RoutineExecBadge, GenericBadge, Modal, Field, EmptyState } from '../components/ui';
import { ROUTINE_FREQUENCIES, ROUTINE_FREQUENCY_LABELS, CRITICALITY_LABELS } from '@gestao-ti/shared';

interface ChecklistItem { id: string; label: string; done?: boolean; note?: string }

export default function Rotinas() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['routines'] }); qc.invalidateQueries({ queryKey: ['my-work'] }); };

  const [createModal, setCreateModal] = useState(false);
  const [execModal, setExecModal] = useState<{ execId: string; routine: any } | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [notes, setNotes] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['routines'],
    queryFn: () => api.get<any[]>('/api/routines'),
  });
  const { data: users } = useQuery({
    queryKey: ['user-options'],
    queryFn: () => api.get<{ id: string; name: string; role: string }[]>('/api/users/options'),
  });

  // Form da nova rotina
  const [form, setForm] = useState({ name: '', description: '', frequency: 'DIARIA', assigneeId: '', nextRunAt: '', estimatedMinutes: '', criticality: 'MEDIA', instructions: '', checklistText: '', requiresEvidence: false });

  const create = useMutation({
    mutationFn: () => api.post('/api/routines', {
      name: form.name,
      description: form.description || undefined,
      frequency: form.frequency,
      assigneeId: form.assigneeId,
      nextRunAt: new Date(form.nextRunAt).toISOString(),
      estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null,
      criticality: form.criticality,
      instructions: form.instructions || null,
      requiresEvidence: form.requiresEvidence,
      checklist: form.checklistText.trim()
        ? form.checklistText.split('\n').filter(Boolean).map((l, i) => ({ id: `c${i + 1}`, label: l.trim() }))
        : null,
    }),
    onSuccess: () => { setCreateModal(false); invalidate(); },
  });

  const generateExec = useMutation({
    mutationFn: (routineId: string) => api.post<{ id: string }>(`/api/routines/${routineId}/generate-execution`),
    onSuccess: invalidate,
  });
  const startExec = useMutation({
    mutationFn: (execId: string) => api.post(`/api/routines/executions/${execId}/start`),
    onSuccess: invalidate,
  });
  const completeExec = useMutation({
    mutationFn: () => api.post(`/api/routines/executions/${execModal!.execId}/complete`, {
      checklistResults: checklist.length ? checklist.map((c) => ({ ...c, done: c.done ?? false })) : undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => { setExecModal(null); setNotes(''); invalidate(); },
  });

  async function uploadEvidence(file: File) {
    const fd = new FormData();
    fd.append('routineExecutionId', execModal!.execId);
    fd.append('file', file);
    await api.post('/api/attachments', fd);
  }

  function openExecution(routine: any) {
    const lastExec = routine.executions[0];
    if (lastExec && ['PENDENTE', 'EM_EXECUCAO', 'ATRASADA'].includes(lastExec.status)) {
      setChecklist(((routine.checklist as ChecklistItem[]) ?? []).map((c) => ({ ...c, done: false })));
      setExecModal({ execId: lastExec.id, routine });
      if (lastExec.status !== 'EM_EXECUCAO') startExec.mutate(lastExec.id);
    } else {
      generateExec.mutate(routine.id, {
        onSuccess: (exec) => {
          setChecklist(((routine.checklist as ChecklistItem[]) ?? []).map((c) => ({ ...c, done: false })));
          setExecModal({ execId: exec.id, routine });
          startExec.mutate(exec.id);
        },
      });
    }
  }

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;

  return (
    <div>
      <PageHeader title="Rotinas recorrentes" subtitle="Backups, conferências, limpezas e verificações — cada execução fica registrada." actions={
        can('routines.manage') && <button className="btn-primary" onClick={() => setCreateModal(true)}><Plus className="h-4 w-4" /> Nova rotina</button>
      } />
      <ErrorText error={generateExec.error ?? startExec.error} />

      {(data ?? []).length === 0 ? <div className="card"><EmptyState title="Nenhuma rotina cadastrada" /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
              <th className="th">Rotina</th><th className="th">Frequência</th><th className="th">Responsável</th>
              <th className="th">Criticidade</th><th className="th">Próxima execução</th><th className="th">Última execução</th><th className="th" />
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {(data ?? []).map((r) => {
                const last = r.executions[0];
                const pendingExec = last && ['PENDENTE', 'EM_EXECUCAO', 'ATRASADA'].includes(last.status);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="td">
                      <p className="font-medium">{r.name}</p>
                      {r.description && <p className="max-w-80 truncate text-xs text-slate-400">{r.description}</p>}
                    </td>
                    <td className="td text-xs">{ROUTINE_FREQUENCY_LABELS[r.frequency as never] ?? r.frequency}</td>
                    <td className="td text-xs">{r.assignee.name}{r.substitute ? ` (subst.: ${r.substitute.name})` : ''}</td>
                    <td className="td"><GenericBadge value={r.criticality} labels={CRITICALITY_LABELS} tone={r.criticality === 'ALTA' ? 'red' : r.criticality === 'MEDIA' ? 'amber' : 'slate'} /></td>
                    <td className="td text-xs">{fmtDateTime(r.nextRunAt)} <span className="text-slate-400">({fmtRelative(r.nextRunAt)})</span></td>
                    <td className="td">{last ? <RoutineExecBadge status={last.status} /> : <span className="text-xs text-slate-400">—</span>}</td>
                    <td className="td text-right">
                      {can('routines.execute') && (
                        <button className="btn-primary !px-2.5 !py-1 text-xs" onClick={() => openExecution(r)}>
                          <Play className="h-3 w-3" /> {pendingExec ? 'Executar pendente' : 'Executar agora'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Execução */}
      {execModal && (
        <Modal title={`Executar: ${execModal.routine.name}`} onClose={() => setExecModal(null)} wide>
          <div className="space-y-3">
            {execModal.routine.instructions && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{execModal.routine.instructions}</div>
            )}
            {checklist.length > 0 && (
              <div className="space-y-1.5">
                <p className="label">Checklist</p>
                {checklist.map((c, i) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <input type="checkbox" checked={c.done ?? false} onChange={(e) => setChecklist((list) => list.map((x, j) => j === i ? { ...x, done: e.target.checked } : x))} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
            <Field label="Observações">
              <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {execModal.routine.requiresEvidence && (
              <label className="flex cursor-pointer items-center gap-1.5 text-sm text-brand-600 hover:underline">
                <Paperclip className="h-4 w-4" /> Anexar evidência (obrigatório)
                <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadEvidence(e.target.files[0])} />
              </label>
            )}
            <ErrorText error={completeExec.error} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setExecModal(null)}>Continuar depois</button>
              <button className="btn-primary" disabled={completeExec.isPending} onClick={() => completeExec.mutate()}>
                <CheckCircle2 className="h-4 w-4" /> Concluir execução
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Nova rotina */}
      {createModal && (
        <Modal title="Nova rotina" onClose={() => setCreateModal(false)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Responsável" required>
              <select className="input" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                <option value="">Selecione…</option>
                {(users ?? []).filter((u) => ['TECNICO', 'GESTOR_TI', 'ADMIN'].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Frequência" required>
              <select className="input" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                {ROUTINE_FREQUENCIES.map((f) => <option key={f} value={f}>{ROUTINE_FREQUENCY_LABELS[f]}</option>)}
              </select>
            </Field>
            <Field label="Primeira execução" required>
              <input type="datetime-local" className="input" value={form.nextRunAt} onChange={(e) => setForm({ ...form, nextRunAt: e.target.value })} />
            </Field>
            <Field label="Duração estimada (min)"><input type="number" className="input" value={form.estimatedMinutes} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })} /></Field>
            <Field label="Criticidade">
              <select className="input" value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })}>
                <option value="BAIXA">Baixa</option><option value="MEDIA">Média</option><option value="ALTA">Alta</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Descrição"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Instruções"><textarea className="input" rows={2} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Checklist (um item por linha)">
                <textarea className="input" rows={3} value={form.checklistText} onChange={(e) => setForm({ ...form, checklistText: e.target.value })} placeholder={'Backup do Linear subiu\nEspaço do NAS acima de 20%'} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.requiresEvidence} onChange={(e) => setForm({ ...form, requiresEvidence: e.target.checked })} />
              Exigir evidência anexada para concluir
            </label>
          </div>
          <ErrorText error={create.error} />
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" disabled={create.isPending || !form.name || !form.assigneeId || !form.nextRunAt} onClick={() => create.mutate()}>Criar rotina</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

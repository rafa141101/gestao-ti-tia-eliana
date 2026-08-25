import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, CheckCircle2, Paperclip, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, fmtRelative } from '../lib/format';
import { PageHeader, Spinner, ErrorText, RoutineExecBadge, GenericBadge, Modal, Field, EmptyState } from '../components/ui';
import { ROUTINE_FREQUENCIES, ROUTINE_FREQUENCY_LABELS, CRITICALITY_LABELS } from '@gestao-ti/shared';

interface ChecklistItem { id: string; label: string; done?: boolean; note?: string }

const emptyForm = { name: '', description: '', frequency: 'DIARIA', assigneeId: '', substituteId: '', nextRunAt: '', estimatedMinutes: '', criticality: 'MEDIA', instructions: '', checklistText: '', requiresEvidence: false };

/** Converte "2026-08-27T20:35:00.000Z" para o formato aceito por <input type="datetime-local"> */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Rotinas() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['routines'] }); qc.invalidateQueries({ queryKey: ['my-work'] }); };

  // 'new' = criando; objeto da rotina = editando; null = fechado
  const [formModal, setFormModal] = useState<'new' | any | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [execModal, setExecModal] = useState<{ execId: string; routine: any } | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [notes, setNotes] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['routines', showInactive],
    queryFn: () => api.get<any[]>(`/api/routines${showInactive ? '?includeInactive=true' : ''}`),
  });
  const { data: users } = useQuery({
    queryKey: ['user-options'],
    queryFn: () => api.get<{ id: string; name: string; role: string }[]>('/api/users/options'),
  });

  const [form, setForm] = useState(emptyForm);
  const isEditing = formModal && formModal !== 'new';

  // Lista de responsáveis para o formulário: técnicos/gestores ativos, mais o
  // responsável/substituto atuais da rotina mesmo que tenham sido inativados
  // depois (para não "sumir" a atribuição existente na tela de edição).
  const activeTechs = (users ?? []).filter((u) => ['TECNICO', 'GESTOR_TI', 'ADMIN'].includes(u.role));
  const assigneeOptions = (() => {
    if (!isEditing) return activeTechs;
    const extras: { id: string; name: string }[] = [];
    const r = formModal as any;
    if (r.assignee && !activeTechs.some((u) => u.id === r.assignee.id)) {
      extras.push({ id: r.assignee.id, name: `${r.assignee.name} (inativo)` });
    }
    if (r.substitute && !activeTechs.some((u) => u.id === r.substitute.id)) {
      extras.push({ id: r.substitute.id, name: `${r.substitute.name} (inativo)` });
    }
    return [...activeTechs, ...extras];
  })();

  function openCreate() {
    setForm(emptyForm);
    setFormModal('new');
  }

  function openEdit(r: any) {
    setForm({
      name: r.name,
      description: r.description ?? '',
      frequency: r.frequency,
      assigneeId: r.assigneeId,
      substituteId: r.substituteId ?? '',
      nextRunAt: toLocalInput(r.nextRunAt),
      estimatedMinutes: r.estimatedMinutes != null ? String(r.estimatedMinutes) : '',
      criticality: r.criticality,
      instructions: r.instructions ?? '',
      checklistText: ((r.checklist as ChecklistItem[]) ?? []).map((c) => c.label).join('\n'),
      requiresEvidence: r.requiresEvidence,
    });
    setFormModal(r);
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        frequency: form.frequency,
        assigneeId: form.assigneeId,
        substituteId: form.substituteId || null,
        nextRunAt: new Date(form.nextRunAt).toISOString(),
        estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null,
        criticality: form.criticality,
        instructions: form.instructions || null,
        requiresEvidence: form.requiresEvidence,
        checklist: form.checklistText.trim()
          ? form.checklistText.split('\n').filter(Boolean).map((l, i) => ({ id: `c${i + 1}`, label: l.trim() }))
          : null,
      };
      return isEditing ? api.patch(`/api/routines/${formModal.id}`, payload) : api.post('/api/routines', payload);
    },
    onSuccess: () => { setFormModal(null); invalidate(); },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/api/routines/${id}`, { active }),
    onSuccess: invalidate,
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
        <>
          {can('routines.manage') && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Mostrar inativas
            </label>
          )}
          {can('routines.manage') && <button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Nova rotina</button>}
        </>
      } />
      <ErrorText error={generateExec.error ?? startExec.error ?? toggleActive.error} />

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
                  <tr key={r.id} className={`hover:bg-slate-50 ${r.active === false ? 'opacity-50' : ''}`}>
                    <td className="td">
                      <p className="font-medium">{r.name}{r.active === false && <span className="ml-1.5 text-xs font-normal text-slate-400">(inativa)</span>}</p>
                      {r.description && <p className="max-w-80 truncate text-xs text-slate-400">{r.description}</p>}
                    </td>
                    <td className="td text-xs">{ROUTINE_FREQUENCY_LABELS[r.frequency as never] ?? r.frequency}</td>
                    <td className="td text-xs">{r.assignee.name}{r.substitute ? ` (subst.: ${r.substitute.name})` : ''}</td>
                    <td className="td"><GenericBadge value={r.criticality} labels={CRITICALITY_LABELS} tone={r.criticality === 'ALTA' ? 'red' : r.criticality === 'MEDIA' ? 'amber' : 'slate'} /></td>
                    <td className="td text-xs">{fmtDateTime(r.nextRunAt)} <span className="text-slate-400">({fmtRelative(r.nextRunAt)})</span></td>
                    <td className="td">{last ? <RoutineExecBadge status={last.status} /> : <span className="text-xs text-slate-400">—</span>}</td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        {can('routines.execute') && r.active !== false && (
                          <button className="btn-primary !px-2.5 !py-1 text-xs" onClick={() => openExecution(r)}>
                            <Play className="h-3 w-3" /> {pendingExec ? 'Executar pendente' : 'Executar agora'}
                          </button>
                        )}
                        {can('routines.manage') && (
                          <>
                            <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Editar" onClick={() => openEdit(r)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              className={`text-xs ${r.active === false ? 'text-emerald-600 hover:underline' : 'text-red-500 hover:underline'}`}
                              onClick={() => toggleActive.mutate({ id: r.id, active: r.active === false })}
                            >
                              {r.active === false ? 'Reativar' : 'Inativar'}
                            </button>
                          </>
                        )}
                      </div>
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

      {/* Nova rotina / edição */}
      {formModal && (
        <Modal title={isEditing ? `Editar rotina: ${formModal.name}` : 'Nova rotina'} onClose={() => setFormModal(null)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Responsável" required>
              <select className="input" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                <option value="">Selecione…</option>
                {assigneeOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Substituto (opcional)">
              <select className="input" value={form.substituteId} onChange={(e) => setForm({ ...form, substituteId: e.target.value })}>
                <option value="">—</option>
                {assigneeOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
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
          <ErrorText error={save.error} />
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" disabled={save.isPending || !form.name || !form.assigneeId || !form.nextRunAt} onClick={() => save.mutate()}>
              {isEditing ? 'Salvar alterações' : 'Criar rotina'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

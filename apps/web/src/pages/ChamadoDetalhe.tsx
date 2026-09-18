import { useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Play, Square, Download, Lock, Star } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, fmtMinutes, fmtRelative, slaState } from '../lib/format';
import { PageHeader, Spinner, ErrorText, TicketStatusBadge, PriorityBadge, SlaBadge, Modal, Field, EmptyState } from '../components/ui';
import {
  TICKET_STATUS_LABELS, TICKET_STATUS_TRANSITIONS, TICKET_EVENT_LABELS, PRIORITIES, PRIORITY_LABELS,
  IMPACT_LABELS, URGENCY_LABELS, CHANNEL_LABELS, WORKLOG_TYPE_LABELS, WORKLOG_TYPES,
  type TicketStatus,
} from '@gestao-ti/shared';

export default function ChamadoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket', id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['my-work'] });
    qc.invalidateQueries({ queryKey: ['running-worklog'] });
  };

  const { data: t, isLoading, error } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get<Record<string, any>>(`/api/tickets/${id}`),
    // Mensagens do WhatsApp e ações de outras pessoas aparecem sem precisar de F5
    refetchInterval: 8_000,
  });

  const [comment, setComment] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [statusModal, setStatusModal] = useState<TicketStatus | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [assignModal, setAssignModal] = useState(false);
  const [priorityModal, setPriorityModal] = useState(false);
  const [manualModal, setManualModal] = useState(false);
  const [reopenModal, setReopenModal] = useState(false);
  const [rateValue, setRateValue] = useState(0);
  const [stopModal, setStopModal] = useState(false);
  const [stopResult, setStopResult] = useState('');
  const [alsoResolve, setAlsoResolve] = useState(false);
  const [stopNextStep, setStopNextStep] = useState('');

  const { data: running } = useQuery({
    queryKey: ['running-worklog'],
    queryFn: () => api.get<{ id: string; ticket?: { id: string } | null } | null>('/api/worklogs/running'),
    enabled: can('tickets.work'),
  });
  const runningHere = running?.ticket?.id === id;

  const { data: users } = useQuery({
    queryKey: ['user-options'],
    queryFn: () => api.get<{ id: string; name: string; role: string }[]>('/api/users/options'),
    enabled: can('tickets.work') || t?.requesterId === user?.id,
  });
  const { data: thirdParties } = useQuery({
    queryKey: ['third-parties'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/api/third-parties'),
    enabled: can('tickets.work'),
  });

  const addComment = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/comments`, { body: comment, isInternal }),
    onSuccess: () => { setComment(''); invalidate(); },
  });
  const changeStatus = useMutation({
    mutationFn: (input: { status: TicketStatus; resolutionNotes?: string; cancelReason?: string; justification?: string; comment?: string }) =>
      api.post(`/api/tickets/${id}/status`, input),
    onSuccess: () => { setStatusModal(null); setStatusNote(''); invalidate(); },
  });
  const assign = useMutation({
    mutationFn: (assigneeId: string | null) => api.post(`/api/tickets/${id}/assign`, { assigneeId }),
    onSuccess: () => { setAssignModal(false); invalidate(); },
  });
  const changePriority = useMutation({
    mutationFn: (input: { priority: string; justification: string }) => api.post(`/api/tickets/${id}/priority`, input),
    onSuccess: () => { setPriorityModal(false); invalidate(); },
  });
  const startWork = useMutation({
    mutationFn: () => api.post('/api/worklogs/start', { ticketId: id, type: 'ATENDIMENTO_REMOTO' }),
    onSuccess: invalidate,
  });
  const stopWork = useMutation({
    mutationFn: async () => {
      await api.post(`/api/worklogs/${running?.id}/stop`, { result: stopResult, nextStep: stopNextStep });
      if (alsoResolve) await api.post(`/api/tickets/${id}/status`, { status: 'RESOLVIDO', resolutionNotes: stopResult });
    },
    onSuccess: () => { setStopModal(false); setStopResult(''); setStopNextStep(''); setAlsoResolve(false); invalidate(); },
  });
  const confirmResolution = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/confirm-resolution`),
    onSuccess: invalidate,
  });
  const reopen = useMutation({
    mutationFn: (reason: string) => api.post(`/api/tickets/${id}/reopen`, { reason }),
    onSuccess: () => { setReopenModal(false); invalidate(); },
  });
  const rate = useMutation({
    mutationFn: (rating: number) => api.post(`/api/tickets/${id}/rate`, { rating }),
    onSuccess: invalidate,
  });
  const linkThirdParty = useMutation({
    mutationFn: (input: { thirdPartyId: string | null; externalTicketNumber?: string }) => api.patch(`/api/tickets/${id}`, input),
    onSuccess: invalidate,
  });
  const addManualWorklog = useMutation({
    mutationFn: (input: Record<string, unknown>) => api.post('/api/worklogs', { ...input, ticketId: id }),
    onSuccess: () => { setManualModal(false); invalidate(); },
  });
  const addWatcher = useMutation({
    mutationFn: (userId: string) => api.post(`/api/tickets/${id}/watchers`, { userId }),
    onSuccess: invalidate,
  });
  const removeWatcher = useMutation({
    mutationFn: (userId: string) => api.del(`/api/tickets/${id}/watchers/${userId}`),
    onSuccess: invalidate,
  });

  async function uploadAttachment(file: File) {
    const fd = new FormData();
    fd.append('ticketId', id!);
    fd.append('file', file);
    await api.post('/api/attachments', fd);
    invalidate();
  }

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;
  if (!t) return null;

  const isTech = can('tickets.work');
  const isRequester = user?.id === t.requesterId;
  const canManageWatchers = isTech || isRequester;
  const transitions = (TICKET_STATUS_TRANSITIONS[t.status as TicketStatus] ?? []).filter((s) => isTech);

  // Linha do tempo unificada (eventos + comentários) em ordem cronológica
  const timeline = [
    ...t.events.map((e: any) => ({ kind: 'event' as const, at: e.createdAt, data: e })),
    ...t.comments.map((c: any) => ({ kind: 'comment' as const, at: c.createdAt, data: c })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div>
      <PageHeader
        title={`${t.number} — ${t.title}`}
        subtitle={`Aberto por ${t.requester.name} ${fmtRelative(t.openedAt)} via ${CHANNEL_LABELS[t.channel as never] ?? t.channel}`}
        actions={
          <>
            {isTech && t.status !== 'FECHADO' && t.status !== 'CANCELADO' && (
              runningHere ? (
                <button className="btn-secondary" onClick={() => setStopModal(true)}>
                  <Square className="h-4 w-4" /> Finalizar atendimento
                </button>
              ) : (
                <button className="btn-primary" onClick={() => startWork.mutate()} disabled={startWork.isPending || !!running}>
                  <Play className="h-4 w-4" /> Iniciar atendimento
                </button>
              )
            )}
            {(isRequester || can('tickets.manage')) && t.status === 'RESOLVIDO' && (
              <>
                <button className="btn-primary" onClick={() => confirmResolution.mutate()}>Confirmar resolução</button>
                <button className="btn-secondary" onClick={() => setReopenModal(true)}>Reabrir</button>
              </>
            )}
            {(isRequester || isTech) && t.status === 'FECHADO' && (
              <button className="btn-secondary" onClick={() => setReopenModal(true)}>Reabrir chamado</button>
            )}
          </>
        }
      />
      <ErrorText error={startWork.error ?? stopWork.error ?? changeStatus.error ?? confirmResolution.error} />
      {isTech && running && !runningHere && t.status !== 'FECHADO' && t.status !== 'CANCELADO' && (
        <p className="mb-3 text-xs text-amber-600">Você já tem um apontamento em andamento em outro item — finalize-o em Meu Trabalho antes de iniciar este.</p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Coluna principal */}
        <div className="space-y-5 lg:col-span-2">
          <div className="card p-4">
            <p className="whitespace-pre-wrap text-sm text-slate-700">{t.description}</p>
            {t.formResponses && (
              <div className="mt-3 grid gap-1.5 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
                {Object.entries(t.formResponses as Record<string, unknown>).map(([k, v]) => {
                  const field = (t.category.formSchema as any[])?.find((f) => f.id === k);
                  return (
                    <p key={k} className="text-xs">
                      <span className="font-semibold text-slate-500">{field?.label ?? k}:</span>{' '}
                      <span className="text-slate-700">{typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v)}</span>
                    </p>
                  );
                })}
              </div>
            )}
            {t.resolutionNotes && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-bold uppercase text-emerald-700">Solução registrada</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">{t.resolutionNotes}</p>
              </div>
            )}
            {t.cancelReason && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <span className="font-semibold">Motivo do cancelamento:</span> {t.cancelReason}
              </div>
            )}
          </div>

          {/* Linha do tempo */}
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-bold">Histórico</h2>
            <div className="space-y-3">
              {timeline.length === 0 && <EmptyState title="Sem interações ainda" />}
              {timeline.map((item, i) =>
                item.kind === 'comment' ? (
                  <div key={`c${i}`} className={`rounded-lg border p-3 ${item.data.isInternal ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                    <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">{item.data.author.name}</span>
                      {item.data.isInternal && <span className="flex items-center gap-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"><Lock className="h-3 w-3" />Interno</span>}
                      <span>{fmtDateTime(item.at)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{item.data.body}</p>
                    {item.data.attachments?.map((a: any) => (
                      <button key={a.id} className="mt-1 flex items-center gap-1 text-xs text-brand-600 hover:underline" onClick={() => downloadFile(`/api/attachments/${a.id}/download`, a.filename)}>
                        <Paperclip className="h-3 w-3" />{a.filename}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div key={`e${i}`} className="flex items-center gap-2 pl-1 text-xs text-slate-500">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                    <span className="font-medium text-slate-600">{TICKET_EVENT_LABELS[item.data.type as never] ?? item.data.type}</span>
                    {item.data.fromValue && item.data.toValue && (
                      <span>{TICKET_STATUS_LABELS[item.data.fromValue as never] ?? item.data.fromValue} → {TICKET_STATUS_LABELS[item.data.toValue as never] ?? item.data.toValue}</span>
                    )}
                    {!item.data.fromValue && item.data.toValue && <span>{TICKET_STATUS_LABELS[item.data.toValue as never] ?? item.data.toValue}</span>}
                    {item.data.justification && <span className="italic">— {item.data.justification}</span>}
                    {item.data.comment && <span className="italic">— {item.data.comment}</span>}
                    <span className="ml-auto shrink-0">{item.data.user?.name ?? 'sistema'} · {fmtDateTime(item.at)}</span>
                  </div>
                ),
              )}
            </div>

            {/* Nova resposta */}
            {(isTech || isRequester) && t.status !== 'CANCELADO' && (
              <form className="mt-4 border-t border-slate-100 pt-3" onSubmit={(e: FormEvent) => { e.preventDefault(); addComment.mutate(); }}>
                <textarea className="input" rows={3} placeholder={isInternal ? 'Comentário interno (invisível ao solicitante)…' : 'Escreva uma resposta…'} value={comment} onChange={(e) => setComment(e.target.value)} required />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    {isTech && (
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                        <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                        Comentário interno
                      </label>
                    )}
                    <label className="flex cursor-pointer items-center gap-1 text-xs text-brand-600 hover:underline">
                      <Paperclip className="h-3.5 w-3.5" /> Anexar arquivo
                      <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAttachment(e.target.files[0])} />
                    </label>
                  </div>
                  <button type="submit" className="btn-primary" disabled={addComment.isPending || !comment.trim()}>Responder</button>
                </div>
                <ErrorText error={addComment.error} />
              </form>
            )}
          </div>

          {/* Apontamentos */}
          {isTech && (
            <div className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold">Tempo trabalhado — total {fmtMinutes(t.workedMinutes)}</h2>
                <button className="btn-secondary !py-1 text-xs" onClick={() => setManualModal(true)}>Registrar trabalho manual</button>
              </div>
              {t.worklogs.length === 0 ? <p className="text-xs text-slate-400">Nenhum apontamento ainda.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="py-1.5">Técnico</th><th>Tipo</th><th>Início</th><th>Duração</th><th>Descrição</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {t.worklogs.map((w: any) => (
                      <tr key={w.id}>
                        <td className="py-1.5">{w.user.name}</td>
                        <td className="text-xs">{WORKLOG_TYPE_LABELS[w.type as never] ?? w.type}</td>
                        <td className="text-xs">{fmtDateTime(w.startedAt)}</td>
                        <td className="text-xs">{w.endedAt ? fmtMinutes(w.durationMinutes) : <span className="text-emerald-600">em andamento</span>}{w.editedAt && <span title={w.editJustification} className="ml-1 text-amber-500">✎</span>}</td>
                        <td className="max-w-48 truncate text-xs text-slate-500">{w.description ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Lateral */}
        <div className="space-y-4">
          <div className="card space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <TicketStatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
            </div>
            {t.priorityJustification && <p className="text-xs italic text-slate-500">Prioridade ajustada: {t.priorityJustification}</p>}
            {isTech && transitions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {transitions.map((s) => (
                  <button key={s} className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setStatusModal(s)}>
                    → {TICKET_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
            <hr className="border-slate-100" />
            <Info label="SLA 1ª resposta">
              <SlaBadge state={slaState(t.firstResponseDueAt, t.firstResponseAt)} label={t.firstResponseAt ? '' : t.firstResponseDueAt ? fmtRelative(t.firstResponseDueAt) : ''} />
            </Info>
            <Info label="SLA solução">
              <SlaBadge state={slaState(t.resolutionDueAt, t.resolvedAt)} label={t.resolvedAt ? '' : t.resolutionDueAt ? fmtRelative(t.resolutionDueAt) : ''} />
            </Info>
            {t.slaPausedMinutes > 0 && <Info label="SLA pausado por">{fmtMinutes(t.slaPausedMinutes)}</Info>}
            <hr className="border-slate-100" />
            <Info label="Técnico responsável">
              <div className="flex items-center justify-between gap-2">
                <span>{t.assignee?.name ?? <span className="text-red-500">Sem responsável</span>}</span>
                {isTech && <button className="text-xs text-brand-600 hover:underline" onClick={() => setAssignModal(true)}>alterar</button>}
              </div>
            </Info>
            {isTech && (
              <Info label="Prioridade">
                <button className="text-xs text-brand-600 hover:underline" onClick={() => setPriorityModal(true)} disabled={!can('tickets.manage')}>
                  {can('tickets.manage') ? 'revalidar prioridade' : PRIORITY_LABELS[t.priority as never]}
                </button>
              </Info>
            )}
            <Info label="Categoria">{t.category.name}{t.subcategory ? ` / ${t.subcategory.name}` : ''}</Info>
            <Info label="Impacto">{IMPACT_LABELS[t.impact as never]}</Info>
            <Info label="Urgência">{URGENCY_LABELS[t.urgency as never]}</Info>
            <Info label="Unidade / setor">{t.unit?.name ?? '—'}{t.department ? ` / ${t.department.name}` : ''}</Info>
            <Info label="Fila">{t.queue?.name ?? '—'}</Info>
            {t.asset && <Info label="Equipamento"><Link className="text-brand-600 hover:underline" to={`/inventario/${t.asset.id}`}>{t.asset.code} — {t.asset.description}</Link></Info>}
            {t.project && <Info label="Projeto"><Link className="text-brand-600 hover:underline" to={`/projetos/${t.project.id}`}>{t.project.name}</Link></Info>}
            {t.infoOwnerArea && <Info label="Área responsável pela informação">{t.infoOwnerArea}</Info>}
            {t.rating && <Info label="Avaliação">{'★'.repeat(t.rating)}{'☆'.repeat(5 - t.rating)}</Info>}
          </div>

          {/* Terceiro */}
          {isTech && (
            <div className="card space-y-2 p-4 text-sm">
              <p className="text-xs font-bold uppercase text-slate-400">Terceiro / fornecedor</p>
              <select className="input" value={t.thirdPartyId ?? ''} onChange={(e) => linkThirdParty.mutate({ thirdPartyId: e.target.value || null })}>
                <option value="">Nenhum</option>
                {(thirdParties ?? []).map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
              </select>
              {t.thirdPartyId && (
                <input
                  className="input" placeholder="Nº do ticket externo"
                  defaultValue={t.externalTicketNumber ?? ''}
                  onBlur={(e) => e.target.value !== (t.externalTicketNumber ?? '') && linkThirdParty.mutate({ thirdPartyId: t.thirdPartyId, externalTicketNumber: e.target.value })}
                />
              )}
            </div>
          )}

          {/* Vínculos */}
          {(t.relations.length > 0 || t.relatedBy.length > 0) && (
            <div className="card p-4 text-sm">
              <p className="mb-2 text-xs font-bold uppercase text-slate-400">Chamados relacionados</p>
              <ul className="space-y-1">
                {t.relations.map((r: any) => (
                  <li key={r.id}><Link className="text-brand-600 hover:underline" to={`/chamados/${r.relatedTicket.id}`}>{r.relatedTicket.number} — {r.relatedTicket.title}</Link></li>
                ))}
                {t.relatedBy.map((r: any) => (
                  <li key={r.id}><Link className="text-brand-600 hover:underline" to={`/chamados/${r.ticket.id}`}>{r.ticket.number} — {r.ticket.title}</Link></li>
                ))}
              </ul>
            </div>
          )}

          {/* Observadores */}
          {(canManageWatchers || (t.watchers?.length ?? 0) > 0) && (
            <div className="card space-y-2 p-4 text-sm">
              <p className="text-xs font-bold uppercase text-slate-400">Avisar quando for atendido</p>
              {(t.watchers?.length ?? 0) === 0 && <p className="text-xs text-slate-400">Ninguém adicionado ainda.</p>}
              <ul className="space-y-1">
                {(t.watchers ?? []).map((w: any) => (
                  <li key={w.userId} className="flex items-center justify-between gap-2">
                    <span>{w.user.name}</span>
                    {canManageWatchers && (
                      <button className="text-xs text-red-500 hover:underline" onClick={() => removeWatcher.mutate(w.userId)}>remover</button>
                    )}
                  </li>
                ))}
              </ul>
              {canManageWatchers && (
                <select
                  className="input"
                  value=""
                  onChange={(e) => { if (e.target.value) addWatcher.mutate(e.target.value); }}
                >
                  <option value="">+ Adicionar pessoa…</option>
                  {(users ?? [])
                    .filter((u) => u.id !== t.requesterId && !(t.watchers ?? []).some((w: any) => w.userId === u.id))
                    .map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
            </div>
          )}

          {/* Avaliação */}
          {isRequester && (t.status === 'RESOLVIDO' || t.status === 'FECHADO') && !t.rating && (
            <div className="card p-4">
              <p className="mb-2 text-xs font-bold uppercase text-slate-400">Avalie o atendimento</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => { setRateValue(n); rate.mutate(n); }} className="p-0.5">
                    <Star className={`h-6 w-6 ${n <= rateValue ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modais */}
      {statusModal && (
        <Modal title={`Mudar status para: ${TICKET_STATUS_LABELS[statusModal]}`} onClose={() => setStatusModal(null)}>
          <div className="space-y-3">
            <Field label={statusModal === 'RESOLVIDO' ? 'Solução aplicada (obrigatório)' : statusModal === 'CANCELADO' ? 'Motivo do cancelamento (obrigatório)' : 'Comentário / justificativa'}>
              <textarea className="input" rows={3} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
            </Field>
            <ErrorText error={changeStatus.error} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setStatusModal(null)}>Cancelar</button>
              <button className="btn-primary" disabled={changeStatus.isPending} onClick={() => changeStatus.mutate({
                status: statusModal,
                resolutionNotes: statusModal === 'RESOLVIDO' ? statusNote : undefined,
                cancelReason: statusModal === 'CANCELADO' ? statusNote : undefined,
                justification: ['RESOLVIDO', 'CANCELADO'].includes(statusModal) ? undefined : statusNote || undefined,
                comment: statusNote || undefined,
              })}>Confirmar</button>
            </div>
          </div>
        </Modal>
      )}

      {assignModal && (
        <Modal title="Atribuir responsável" onClose={() => setAssignModal(false)}>
          <div className="space-y-2">
            <button className="btn-secondary w-full justify-start" onClick={() => assign.mutate(user!.id)}>Assumir para mim</button>
            {can('tickets.manage') && (users ?? []).filter((u) => ['TECNICO', 'GESTOR_TI', 'ADMIN'].includes(u.role)).map((u) => (
              <button key={u.id} className="btn-secondary w-full justify-start" onClick={() => assign.mutate(u.id)}>{u.name}</button>
            ))}
            {can('tickets.manage') && <button className="btn-secondary w-full justify-start text-red-600" onClick={() => assign.mutate(null)}>Remover responsável</button>}
            <ErrorText error={assign.error} />
          </div>
        </Modal>
      )}

      {priorityModal && (
        <Modal title="Revalidar prioridade" onClose={() => setPriorityModal(false)}>
          <PriorityForm current={t.priority} onSubmit={(p, j) => changePriority.mutate({ priority: p, justification: j })} error={changePriority.error} busy={changePriority.isPending} />
        </Modal>
      )}

      {reopenModal && (
        <Modal title="Reabrir chamado" onClose={() => setReopenModal(false)}>
          <ReopenForm onSubmit={(reason) => reopen.mutate(reason)} error={reopen.error} busy={reopen.isPending} />
        </Modal>
      )}

      {stopModal && (
        <Modal title="Finalizar atendimento" onClose={() => setStopModal(false)}>
          <div className="space-y-3">
            <Field label="O que foi feito / resultado">
              <textarea className="input" rows={3} value={stopResult} onChange={(e) => setStopResult(e.target.value)} placeholder="Ex.: sensor limpo, teste de impressão OK" />
            </Field>
            <Field label="Próximo passo (se houver)">
              <input className="input" value={stopNextStep} onChange={(e) => setStopNextStep(e.target.value)} placeholder="Ex.: devolver impressora para a expedição" />
            </Field>
            {(TICKET_STATUS_TRANSITIONS[t.status as TicketStatus] ?? []).includes('RESOLVIDO') && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={alsoResolve} onChange={(e) => setAlsoResolve(e.target.checked)} />
                Também marcar o chamado como <b>resolvido</b> (o resultado acima vira a solução)
              </label>
            )}
            <ErrorText error={stopWork.error} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setStopModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={() => stopWork.mutate()} disabled={stopWork.isPending || (alsoResolve && !stopResult.trim())}>Finalizar</button>
            </div>
          </div>
        </Modal>
      )}

      {manualModal && (
        <Modal title="Registrar trabalho manual" onClose={() => setManualModal(false)}>
          <ManualWorklogForm onSubmit={(input) => addManualWorklog.mutate(input)} error={addManualWorklog.error} busy={addManualWorklog.isPending} />
        </Modal>
      )}
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="text-sm text-slate-700">{children}</div>
    </div>
  );
}

function PriorityForm({ current, onSubmit, error, busy }: { current: string; onSubmit: (p: string, j: string) => void; error: unknown; busy: boolean }) {
  const [priority, setPriority] = useState(current);
  const [justification, setJustification] = useState('');
  return (
    <div className="space-y-3">
      <Field label="Nova prioridade" required>
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </select>
      </Field>
      <Field label="Justificativa (obrigatória — fica no histórico)" required>
        <textarea className="input" rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy || justification.length < 5 || priority === current} onClick={() => onSubmit(priority, justification)}>Alterar prioridade</button>
      </div>
    </div>
  );
}

function ReopenForm({ onSubmit, error, busy }: { onSubmit: (reason: string) => void; error: unknown; busy: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3">
      <Field label="Motivo da reabertura (obrigatório)" required>
        <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: o problema voltou a acontecer hoje de manhã" />
      </Field>
      <ErrorText error={error} />
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy || reason.length < 5} onClick={() => onSubmit(reason)}>Reabrir</button>
      </div>
    </div>
  );
}

function ManualWorklogForm({ onSubmit, error, busy }: { onSubmit: (input: Record<string, unknown>) => void; error: unknown; busy: boolean }) {
  const [type, setType] = useState('ATENDIMENTO_REMOTO');
  const [description, setDescription] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Use para registrar trabalho já realizado (ex.: resolvido por WhatsApp e registrado depois).</p>
      <Field label="Tipo de atividade" required>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {WORKLOG_TYPES.map((t) => <option key={t} value={t}>{WORKLOG_TYPE_LABELS[t]}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Início" required><input type="datetime-local" className="input" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} /></Field>
        <Field label="Fim" required><input type="datetime-local" className="input" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} /></Field>
      </div>
      <Field label="O que foi feito" required>
        <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy || !startedAt || !endedAt || description.length < 3}
          onClick={() => onSubmit({ type, description, startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString() })}>
          Registrar
        </button>
      </div>
    </div>
  );
}

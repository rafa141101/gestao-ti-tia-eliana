import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Field, ErrorText, PriorityBadge } from '../components/ui';
import {
  IMPACTS, IMPACT_LABELS, URGENCIES, URGENCY_LABELS, CHANNELS, CHANNEL_LABELS,
  computePriority, PRIORITY_LABELS, type Impact, type Urgency,
} from '@gestao-ti/shared';

interface FormFieldDef { id: string; label: string; type: 'text' | 'textarea' | 'select' | 'boolean' | 'number'; options?: string[]; required?: boolean }
interface CategoryOpt { id: string; name: string; formSchema?: FormFieldDef[] | null; subcategories: { id: string; name: string }[] }

export default function NovoChamado() {
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [impact, setImpact] = useState<Impact>('UMA_PESSOA');
  const [urgency, setUrgency] = useState<Urgency>('PARCIALMENTE_PREJUDICADA');
  const [channel, setChannel] = useState('PORTAL');
  const [unitId, setUnitId] = useState(user?.unitId ?? '');
  const [requesterId, setRequesterId] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [assetId, setAssetId] = useState('');
  const [formResponses, setFormResponses] = useState<Record<string, unknown>>({});

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoryOpt[]>('/api/catalog/categories'),
  });
  const { data: structure } = useQuery({
    queryKey: ['structure'],
    queryFn: () => api.get<{ units: { id: string; name: string }[] }>('/api/structure/all'),
  });
  const { data: users } = useQuery({
    queryKey: ['user-options'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/api/users/options'),
    enabled: can('tickets.work'),
  });
  const { data: assets } = useQuery({
    queryKey: ['asset-search', assetSearch],
    queryFn: () => api.get<{ items: { id: string; code: string; description: string }[] }>(`/api/assets?search=${encodeURIComponent(assetSearch)}&pageSize=8`),
    enabled: can('inventory.view') && assetSearch.length >= 2,
  });

  const selectedCategory = categories?.find((c) => c.id === categoryId);
  const priority = useMemo(() => computePriority(impact, urgency), [impact, urgency]);

  const create = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>('/api/tickets', {
      title, description, categoryId,
      subcategoryId: subcategoryId || null,
      impact, urgency,
      channel,
      unitId: unitId || null,
      requesterId: requesterId || undefined,
      assetId: assetId || null,
      formResponses: Object.keys(formResponses).length ? formResponses : null,
    }),
    onSuccess: (res) => navigate(`/chamados/${res.id}`),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Abrir chamado" subtitle="Descreva o problema ou a necessidade. A prioridade final é validada pela TI." />
      <form onSubmit={onSubmit} className="card space-y-4 p-5">
        <Field label="Título" required>
          <input className="input" required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Impressora da expedição não imprime" />
        </Field>
        <Field label="Descrição" required>
          <textarea className="input" required minLength={3} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que está acontecendo? Desde quando? O que você já tentou?" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria" required>
            <select className="input" required value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(''); setFormResponses({}); }}>
              <option value="">Selecione…</option>
              {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Subcategoria">
            <select className="input" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} disabled={!selectedCategory?.subcategories.length}>
              <option value="">—</option>
              {(selectedCategory?.subcategories ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>

        {/* Formulário condicional da categoria */}
        {selectedCategory?.formSchema && selectedCategory.formSchema.length > 0 && (
          <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-3">
            <p className="mb-2 text-xs font-bold uppercase text-brand-700">Informações de {selectedCategory.name}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedCategory.formSchema.map((f) => (
                <Field key={f.id} label={f.label} required={f.required}>
                  {f.type === 'select' ? (
                    <select className="input" required={f.required} value={(formResponses[f.id] as string) ?? ''} onChange={(e) => setFormResponses((r) => ({ ...r, [f.id]: e.target.value }))}>
                      <option value="">—</option>
                      {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'boolean' ? (
                    <select className="input" value={formResponses[f.id] === true ? 'sim' : formResponses[f.id] === false ? 'nao' : ''} onChange={(e) => setFormResponses((r) => ({ ...r, [f.id]: e.target.value === '' ? undefined : e.target.value === 'sim' }))}>
                      <option value="">—</option>
                      <option value="sim">Sim</option>
                      <option value="nao">Não</option>
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea className="input" rows={2} required={f.required} value={(formResponses[f.id] as string) ?? ''} onChange={(e) => setFormResponses((r) => ({ ...r, [f.id]: e.target.value }))} />
                  ) : (
                    <input className="input" type={f.type === 'number' ? 'number' : 'text'} required={f.required} value={(formResponses[f.id] as string) ?? ''} onChange={(e) => setFormResponses((r) => ({ ...r, [f.id]: f.type === 'number' ? Number(e.target.value) : e.target.value }))} />
                  )}
                </Field>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quantas pessoas são afetadas? (impacto)" required>
            <select className="input" value={impact} onChange={(e) => setImpact(e.target.value as Impact)}>
              {IMPACTS.map((i) => <option key={i} value={i}>{IMPACT_LABELS[i]}</option>)}
            </select>
          </Field>
          <Field label="Qual a situação da atividade? (urgência)" required>
            <select className="input" value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)}>
              {URGENCIES.map((u) => <option key={u} value={u}>{URGENCY_LABELS[u]}</option>)}
            </select>
          </Field>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Prioridade sugerida:</span>
          <PriorityBadge priority={priority} />
          <span className="text-xs text-slate-400">{PRIORITY_LABELS[priority]} — a TI pode revalidar com justificativa</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Unidade">
            <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">—</option>
              {(structure?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          {can('tickets.work') && (
            <Field label="Canal de origem">
              <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
              </select>
            </Field>
          )}
        </div>

        {can('tickets.work') && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Abrir em nome de (solicitante)">
              <select className="input" value={requesterId} onChange={(e) => setRequesterId(e.target.value)}>
                <option value="">Eu mesmo</option>
                {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Equipamento relacionado">
              <input className="input" placeholder="Busque por código ou descrição…" value={assetSearch} onChange={(e) => { setAssetSearch(e.target.value); setAssetId(''); }} />
              {assetSearch.length >= 2 && !assetId && (
                <div className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow">
                  {(assets?.items ?? []).map((a) => (
                    <button type="button" key={a.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => { setAssetId(a.id); setAssetSearch(`${a.code} — ${a.description}`); }}>
                      {a.code} — {a.description}
                    </button>
                  ))}
                  {(assets?.items ?? []).length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Nada encontrado</p>}
                </div>
              )}
            </Field>
          </div>
        )}

        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={create.isPending}>{create.isPending ? 'Abrindo…' : 'Abrir chamado'}</button>
        </div>
      </form>
    </div>
  );
}

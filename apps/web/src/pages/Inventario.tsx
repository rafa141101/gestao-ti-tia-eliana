import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Warehouse } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Spinner, ErrorText, AssetStatusBadge, Pagination, EmptyState, Modal, Field, GenericBadge } from '../components/ui';
import { ASSET_STATUSES, ASSET_STATUS_LABELS, ASSET_KINDS, ASSET_KIND_LABELS } from '@gestao-ti/shared';

export default function Inventario() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showReserve, setShowReserve] = useState(false);
  const [createModal, setCreateModal] = useState(false);

  const query = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search) query.set('search', search);
  if (status) query.set('status', status);
  if (categoryId) query.set('categoryId', categoryId);

  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', query.toString()],
    queryFn: () => api.get<{ total: number; page: number; pageSize: number; items: any[] }>(`/api/assets?${query}`),
  });
  const { data: categories } = useQuery({
    queryKey: ['asset-categories'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/api/assets/categories'),
  });
  const { data: reserve } = useQuery({
    queryKey: ['asset-reserve'],
    queryFn: () => api.get<{ summary: any[]; items: any[] }>('/api/assets/reserve'),
    enabled: showReserve,
  });
  const { data: structure } = useQuery({
    queryKey: ['structure'],
    queryFn: () => api.get<{ units: { id: string; name: string }[] }>('/api/structure/all'),
  });

  const [form, setForm] = useState({ description: '', categoryId: '', kind: 'ATIVO_INDIVIDUAL', brand: '', model: '', serialNumber: '', patrimonyCode: '', unitId: '', status: 'DISPONIVEL', quantity: '1' });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/assets', {
      description: form.description, categoryId: form.categoryId, kind: form.kind,
      brand: form.brand || null, model: form.model || null, serialNumber: form.serialNumber || null,
      patrimonyCode: form.patrimonyCode || null, unitId: form.unitId || null, status: form.status,
      quantity: Number(form.quantity) || 1,
    }),
    onSuccess: (res) => { setCreateModal(false); qc.invalidateQueries({ queryKey: ['assets'] }); navigate(`/inventario/${res.id}`); },
  });

  return (
    <div>
      <PageHeader title="Inventário de TI" subtitle="Equipamentos, componentes e estoque de reserva." actions={
        <>
          <button className="btn-secondary" onClick={() => setShowReserve((v) => !v)}><Warehouse className="h-4 w-4" /> Reserva</button>
          {can('inventory.register') && <button className="btn-primary" onClick={() => setCreateModal(true)}><Plus className="h-4 w-4" /> Cadastrar ativo</button>}
        </>
      } />

      {showReserve && reserve && (
        <div className="card mb-4 p-4">
          <h2 className="mb-2 text-sm font-bold">Estoque de reserva por categoria</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {reserve.summary.map((s: any) => (
              <div key={s.category} className="rounded-lg border border-slate-200 p-2 text-center">
                <p className="text-xs font-semibold text-slate-500">{s.category}</p>
                <p className="text-sm"><span className="font-bold text-blue-600">{s.reserva + s.disponivel}</span> disp./reserva · <span className="text-red-500">{s.manutencao + s.aguardandoPeca}</span> manut.</p>
              </div>
            ))}
            {reserve.summary.length === 0 && <p className="col-span-full text-xs text-slate-400">Nenhum item em reserva.</p>}
          </div>
        </div>
      )}

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-48 flex-1">
          <label className="label">Busca</label>
          <input className="input" placeholder="Código, patrimônio, descrição, série, hostname…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Todos</option>
            {ASSET_STATUSES.map((s) => <option key={s} value={s}>{ASSET_STATUS_LABELS[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Categoria</label>
          <select className="input w-44" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
            <option value="">Todas</option>
            {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {isLoading && <Spinner />}
      <ErrorText error={error} />

      {data && (
        <div className="card overflow-x-auto">
          {data.items.length === 0 ? <EmptyState title="Nenhum ativo encontrado" /> : (
            <>
              <table className="w-full min-w-[860px]">
                <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
                  <th className="th">Código</th><th className="th">Descrição</th><th className="th">Categoria</th>
                  <th className="th">Tipo</th><th className="th">Unidade</th><th className="th">Usuário</th><th className="th">Status</th><th className="th">Qtd</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {data.items.map((a) => (
                    <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/inventario/${a.id}`)}>
                      <td className="td">
                        <p className="font-medium">{a.code}</p>
                        {a.patrimonyCode && <p className="text-[10px] text-slate-400">Patr.: {a.patrimonyCode}</p>}
                      </td>
                      <td className="td">
                        <p className="max-w-64 truncate">{a.description}</p>
                        {(a.brand || a.model) && <p className="text-[10px] text-slate-400">{[a.brand, a.model].filter(Boolean).join(' ')}</p>}
                      </td>
                      <td className="td text-xs text-slate-500">{a.category.name}</td>
                      <td className="td"><GenericBadge value={a.kind} labels={ASSET_KIND_LABELS} tone={a.kind === 'ATIVO_INDIVIDUAL' ? 'slate' : 'purple'} /></td>
                      <td className="td text-xs text-slate-500">{a.unit?.name ?? '—'}</td>
                      <td className="td text-xs text-slate-500">{a.user?.name ?? '—'}</td>
                      <td className="td"><AssetStatusBadge status={a.status} /></td>
                      <td className="td text-xs">{a.quantity > 1 ? a.quantity : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
            </>
          )}
        </div>
      )}

      {createModal && (
        <Modal title="Cadastrar ativo" onClose={() => setCreateModal(false)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Descrição" required><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex.: Computador do caixa 2 — Loja BH" /></Field>
            </div>
            <Field label="Categoria" required>
              <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">Selecione…</option>
                {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Classificação">
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {ASSET_KINDS.map((k) => <option key={k} value={k}>{ASSET_KIND_LABELS[k]}</option>)}
              </select>
            </Field>
            <Field label="Marca"><input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
            <Field label="Modelo"><input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
            <Field label="Nº de série"><input className="input" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></Field>
            <Field label="Patrimônio físico (plaquinha)"><input className="input" value={form.patrimonyCode} onChange={(e) => setForm({ ...form, patrimonyCode: e.target.value })} /></Field>
            <Field label="Unidade">
              <select className="input" value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
                <option value="">—</option>
                {(structure?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Status inicial">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {ASSET_STATUSES.map((s) => <option key={s} value={s}>{ASSET_STATUS_LABELS[s]}</option>)}
              </select>
            </Field>
            {(form.kind === 'CONSUMIVEL' || form.kind === 'KIT') && (
              <Field label="Quantidade"><input type="number" min={1} className="input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
            )}
          </div>
          <ErrorText error={create.error} />
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" disabled={create.isPending || !form.description || !form.categoryId} onClick={() => create.mutate()}>Cadastrar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

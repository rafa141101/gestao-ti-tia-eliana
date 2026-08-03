import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader, Spinner, ErrorText, Modal, Field } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import { SLA_MODE_LABELS } from '@gestao-ti/shared';

export default function CategoriasSla() {
  const qc = useQueryClient();
  const [catModal, setCatModal] = useState<null | { id?: string }>(null);
  const [subModal, setSubModal] = useState<string | null>(null);
  const [slaModal, setSlaModal] = useState<null | { id?: string }>(null);
  const [holidayModal, setHolidayModal] = useState(false);

  const { data: categories, isLoading } = useQuery({ queryKey: ['categories'], queryFn: () => api.get<any[]>('/api/catalog/categories') });
  const { data: slaPolicies } = useQuery({ queryKey: ['sla-policies'], queryFn: () => api.get<any[]>('/api/catalog/sla-policies') });
  const { data: holidays } = useQuery({ queryKey: ['holidays'], queryFn: () => api.get<any[]>('/api/catalog/holidays') });

  const [catForm, setCatForm] = useState({ name: '', description: '', slaPolicyId: '' });
  const [subName, setSubName] = useState('');
  const [slaForm, setSlaForm] = useState({
    name: '', mode: 'COMERCIAL', businessStart: '08:00', businessEnd: '18:00', workdays: '1,2,3,4,5',
    firstResponseP1: 10, firstResponseP2: 30, firstResponseP3: 240, firstResponseP4: 600,
    resolutionP1: 240, resolutionP2: 480, resolutionP3: 2400, resolutionP4: 12000, isDefault: false,
  });
  const [holidayForm, setHolidayForm] = useState({ date: '', name: '' });

  const saveCat = useMutation({
    mutationFn: () => catModal?.id
      ? api.patch(`/api/catalog/categories/${catModal.id}`, { name: catForm.name, description: catForm.description || undefined, slaPolicyId: catForm.slaPolicyId || null })
      : api.post('/api/catalog/categories', { name: catForm.name, description: catForm.description || undefined, slaPolicyId: catForm.slaPolicyId || null }),
    onSuccess: () => { setCatModal(null); qc.invalidateQueries({ queryKey: ['categories'] }); },
  });
  const saveSub = useMutation({
    mutationFn: () => api.post(`/api/catalog/categories/${subModal}/subcategories`, { name: subName }),
    onSuccess: () => { setSubModal(null); setSubName(''); qc.invalidateQueries({ queryKey: ['categories'] }); },
  });
  const saveSla = useMutation({
    mutationFn: () => slaModal?.id
      ? api.patch(`/api/catalog/sla-policies/${slaModal.id}`, slaForm)
      : api.post('/api/catalog/sla-policies', slaForm),
    onSuccess: () => { setSlaModal(null); qc.invalidateQueries({ queryKey: ['sla-policies'] }); },
  });
  const saveHoliday = useMutation({
    mutationFn: () => api.post('/api/catalog/holidays', holidayForm),
    onSuccess: () => { setHolidayModal(false); setHolidayForm({ date: '', name: '' }); qc.invalidateQueries({ queryKey: ['holidays'] }); },
  });

  if (isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Categorias e políticas de SLA" subtitle="Alterações de SLA valem apenas para chamados novos — nunca são retroativas." />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold">Categorias de chamado</h2>
            <button className="btn-secondary !py-1 text-xs" onClick={() => { setCatForm({ name: '', description: '', slaPolicyId: '' }); setCatModal({}); }}>
              <Plus className="h-3.5 w-3.5" /> Categoria
            </button>
          </div>
          <ul className="divide-y divide-slate-50">
            {(categories ?? []).map((c) => (
              <li key={c.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{c.name}{c.formSchema && <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">formulário</span>}</p>
                  <div className="space-x-2 text-xs">
                    <button className="text-brand-600 hover:underline" onClick={() => { setCatForm({ name: c.name, description: c.description ?? '', slaPolicyId: c.slaPolicyId ?? '' }); setCatModal({ id: c.id }); }}>Editar</button>
                    <button className="text-slate-500 hover:underline" onClick={() => setSubModal(c.id)}>+ subcategoria</button>
                  </div>
                </div>
                <p className="text-xs text-slate-400">
                  SLA: {c.slaPolicy?.name ?? 'padrão'}
                  {c.subcategories.length > 0 && ` · Sub: ${c.subcategories.map((s: any) => s.name).join(', ')}`}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-5">
          <section className="card">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold">Políticas de SLA</h2>
              <button className="btn-secondary !py-1 text-xs" onClick={() => setSlaModal({})}><Plus className="h-3.5 w-3.5" /> Política</button>
            </div>
            <ul className="divide-y divide-slate-50">
              {(slaPolicies ?? []).map((p) => (
                <li key={p.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{p.name} {p.isDefault && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">padrão</span>}</p>
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => { setSlaForm({ ...p }); setSlaModal({ id: p.id }); }}>Editar</button>
                  </div>
                  <p className="text-xs text-slate-400">
                    {SLA_MODE_LABELS[p.mode as never]} · 1ª resposta P1 {p.firstResponseP1}min / P2 {p.firstResponseP2}min / P3 {p.firstResponseP3}min / P4 {p.firstResponseP4}min
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold">Feriados (pausam SLA comercial)</h2>
              <button className="btn-secondary !py-1 text-xs" onClick={() => setHolidayModal(true)}><Plus className="h-3.5 w-3.5" /> Feriado</button>
            </div>
            <ul className="divide-y divide-slate-50">
              {(holidays ?? []).map((h) => (
                <li key={h.id} className="flex justify-between px-4 py-2 text-sm">
                  <span>{h.name}</span><span className="text-xs text-slate-400">{fmtDate(h.date)}</span>
                </li>
              ))}
              {(holidays ?? []).length === 0 && <li className="px-4 py-3 text-xs text-slate-400">Nenhum feriado cadastrado.</li>}
            </ul>
          </section>
        </div>
      </div>

      {catModal && (
        <Modal title={catModal.id ? 'Editar categoria' : 'Nova categoria'} onClose={() => setCatModal(null)}>
          <div className="space-y-3">
            <Field label="Nome" required><input className="input" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} /></Field>
            <Field label="Descrição"><input className="input" value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} /></Field>
            <Field label="Política de SLA">
              <select className="input" value={catForm.slaPolicyId} onChange={(e) => setCatForm({ ...catForm, slaPolicyId: e.target.value })}>
                <option value="">Usar padrão</option>
                {(slaPolicies ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <ErrorText error={saveCat.error} />
            <div className="flex justify-end"><button className="btn-primary" disabled={saveCat.isPending || catForm.name.length < 2} onClick={() => saveCat.mutate()}>Salvar</button></div>
          </div>
        </Modal>
      )}

      {subModal && (
        <Modal title="Nova subcategoria" onClose={() => setSubModal(null)}>
          <div className="space-y-3">
            <Field label="Nome" required><input className="input" value={subName} onChange={(e) => setSubName(e.target.value)} /></Field>
            <ErrorText error={saveSub.error} />
            <div className="flex justify-end"><button className="btn-primary" disabled={saveSub.isPending || subName.length < 2} onClick={() => saveSub.mutate()}>Salvar</button></div>
          </div>
        </Modal>
      )}

      {slaModal && (
        <Modal title={slaModal.id ? 'Editar política de SLA' : 'Nova política de SLA'} onClose={() => setSlaModal(null)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" required><input className="input" value={slaForm.name} onChange={(e) => setSlaForm({ ...slaForm, name: e.target.value })} /></Field>
            <Field label="Modo">
              <select className="input" value={slaForm.mode} onChange={(e) => setSlaForm({ ...slaForm, mode: e.target.value })}>
                <option value="COMERCIAL">Horário comercial</option>
                <option value="CORRIDO">Tempo corrido</option>
              </select>
            </Field>
            {slaForm.mode === 'COMERCIAL' && (
              <>
                <Field label="Início do expediente"><input className="input" value={slaForm.businessStart} onChange={(e) => setSlaForm({ ...slaForm, businessStart: e.target.value })} placeholder="08:00" /></Field>
                <Field label="Fim do expediente"><input className="input" value={slaForm.businessEnd} onChange={(e) => setSlaForm({ ...slaForm, businessEnd: e.target.value })} placeholder="18:00" /></Field>
                <div className="sm:col-span-2">
                  <Field label="Dias úteis (1=seg … 7=dom, separados por vírgula)"><input className="input" value={slaForm.workdays} onChange={(e) => setSlaForm({ ...slaForm, workdays: e.target.value })} /></Field>
                </div>
              </>
            )}
            {(['P1', 'P2', 'P3', 'P4'] as const).map((p) => (
              <div key={p} className="grid grid-cols-2 gap-2">
                <Field label={`1ª resposta ${p} (min)`}>
                  <input type="number" className="input" value={(slaForm as any)[`firstResponse${p}`]} onChange={(e) => setSlaForm({ ...slaForm, [`firstResponse${p}`]: Number(e.target.value) })} />
                </Field>
                <Field label={`Solução ${p} (min)`}>
                  <input type="number" className="input" value={(slaForm as any)[`resolution${p}`]} onChange={(e) => setSlaForm({ ...slaForm, [`resolution${p}`]: Number(e.target.value) })} />
                </Field>
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={slaForm.isDefault} onChange={(e) => setSlaForm({ ...slaForm, isDefault: e.target.checked })} />
              Política padrão do sistema
            </label>
          </div>
          <ErrorText error={saveSla.error} />
          <div className="mt-4 flex justify-end"><button className="btn-primary" disabled={saveSla.isPending || slaForm.name.length < 2} onClick={() => saveSla.mutate()}>Salvar</button></div>
        </Modal>
      )}

      {holidayModal && (
        <Modal title="Novo feriado" onClose={() => setHolidayModal(false)}>
          <div className="space-y-3">
            <Field label="Data" required><input type="date" className="input" value={holidayForm.date} onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })} /></Field>
            <Field label="Nome" required><input className="input" value={holidayForm.name} onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })} /></Field>
            <ErrorText error={saveHoliday.error} />
            <div className="flex justify-end"><button className="btn-primary" disabled={saveHoliday.isPending || !holidayForm.date || holidayForm.name.length < 2} onClick={() => saveHoliday.mutate()}>Salvar</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

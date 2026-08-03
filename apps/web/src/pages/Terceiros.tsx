import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader, Spinner, ErrorText, Modal, Field, EmptyState } from '../components/ui';

export default function Terceiros() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [modal, setModal] = useState<null | { id?: string }>(null);
  const [form, setForm] = useState({ name: '', serviceType: '', contactName: '', email: '', phone: '', slaInfo: '', serviceHours: '', systems: '', notes: '' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['third-parties'],
    queryFn: () => api.get<any[]>('/api/third-parties'),
  });

  const save = useMutation({
    mutationFn: () => modal?.id
      ? api.patch(`/api/third-parties/${modal.id}`, form)
      : api.post('/api/third-parties', form),
    onSuccess: () => { setModal(null); qc.invalidateQueries({ queryKey: ['third-parties'] }); },
  });

  function openEdit(tp?: any) {
    setForm({
      name: tp?.name ?? '', serviceType: tp?.serviceType ?? '', contactName: tp?.contactName ?? '',
      email: tp?.email ?? '', phone: tp?.phone ?? '', slaInfo: tp?.slaInfo ?? '',
      serviceHours: tp?.serviceHours ?? '', systems: tp?.systems ?? '', notes: tp?.notes ?? '',
    });
    setModal({ id: tp?.id });
  }

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;

  return (
    <div>
      <PageHeader title="Terceiros e fornecedores" subtitle="ERP, TEF, catracas, internet, assistências — com chamados vinculados." actions={
        can('thirdparties.manage') && <button className="btn-primary" onClick={() => openEdit()}><Plus className="h-4 w-4" /> Novo terceiro</button>
      } />

      {(data ?? []).length === 0 ? <div className="card"><EmptyState title="Nenhum terceiro cadastrado" /></div> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(data ?? []).map((tp) => (
            <div key={tp.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{tp.name}</p>
                  <p className="text-xs text-slate-500">{tp.serviceType ?? '—'}</p>
                </div>
                {tp._count.tickets > 0 && (
                  <Link to={`/chamados?thirdPartyId=${tp.id}`} className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 hover:bg-purple-200">
                    {tp._count.tickets} chamado{tp._count.tickets === 1 ? '' : 's'} aberto{tp._count.tickets === 1 ? '' : 's'}
                  </Link>
                )}
              </div>
              <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                {tp.contactName && <p>Contato: {tp.contactName}</p>}
                {tp.phone && <p>Tel.: {tp.phone}</p>}
                {tp.email && <p>{tp.email}</p>}
                {tp.slaInfo && <p>SLA: {tp.slaInfo}</p>}
                {tp.serviceHours && <p>Horário: {tp.serviceHours}</p>}
                {tp.systems && <p>Atende: {tp.systems}</p>}
              </div>
              {can('thirdparties.manage') && (
                <button className="mt-2 text-xs text-brand-600 hover:underline" onClick={() => openEdit(tp)}>Editar</button>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={modal.id ? 'Editar terceiro' : 'Novo terceiro'} onClose={() => setModal(null)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Empresa" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Tipo de serviço"><input className="input" value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} placeholder="ERP, TEF, Internet…" /></Field>
            <Field label="Contato"><input className="input" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
            <Field label="Telefone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="E-mail"><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Horário de atendimento"><input className="input" value={form.serviceHours} onChange={(e) => setForm({ ...form, serviceHours: e.target.value })} /></Field>
            <Field label="SLA contratado"><input className="input" value={form.slaInfo} onChange={(e) => setForm({ ...form, slaInfo: e.target.value })} /></Field>
            <Field label="Sistemas/equipamentos atendidos"><input className="input" value={form.systems} onChange={(e) => setForm({ ...form, systems: e.target.value })} /></Field>
            <div className="sm:col-span-2">
              <Field label="Observações"><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
          </div>
          <ErrorText error={save.error} />
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" disabled={save.isPending || form.name.length < 2} onClick={() => save.mutate()}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

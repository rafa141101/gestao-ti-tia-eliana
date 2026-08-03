import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime } from '../../lib/format';
import { PageHeader, Spinner, ErrorText, Modal, Field, GenericBadge, EmptyState } from '../../components/ui';
import { ROLES, ROLE_LABELS } from '@gestao-ti/shared';

export default function Usuarios() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modal, setModal] = useState<null | { id?: string }>(null);
  const [pwdModal, setPwdModal] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'SOLICITANTE', phone: '', unitId: '', departmentId: '' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['users', includeInactive],
    queryFn: () => api.get<any[]>(`/api/users?includeInactive=${includeInactive}`),
  });
  const { data: structure } = useQuery({
    queryKey: ['structure'],
    queryFn: () => api.get<{ units: { id: string; name: string }[]; departments: { id: string; name: string }[] }>('/api/structure/all'),
  });

  const save = useMutation({
    mutationFn: () => modal?.id
      ? api.patch(`/api/users/${modal.id}`, {
          name: form.name, email: form.email, role: form.role, phone: form.phone || undefined,
          unitId: form.unitId || null, departmentId: form.departmentId || null,
        })
      : api.post('/api/users', {
          name: form.name, email: form.email, password: form.password, role: form.role,
          phone: form.phone || undefined, unitId: form.unitId || null, departmentId: form.departmentId || null,
        }),
    onSuccess: () => { setModal(null); invalidate(); },
  });
  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/api/users/${id}`, { active }),
    onSuccess: invalidate,
  });
  const resetPwd = useMutation({
    mutationFn: () => api.post(`/api/users/${pwdModal}/reset-password`, { newPassword: newPwd }),
    onSuccess: () => { setPwdModal(null); setNewPwd(''); },
  });

  function openEdit(u?: any) {
    setForm({
      name: u?.name ?? '', email: u?.email ?? '', password: '', role: u?.role ?? 'SOLICITANTE',
      phone: u?.phone ?? '', unitId: u?.unitId ?? '', departmentId: u?.departmentId ?? '',
    });
    setModal({ id: u?.id });
  }

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;

  return (
    <div>
      <PageHeader title="Usuários" subtitle="Usuários nunca são apagados — apenas inativados. Owners só podem ser alterados por outro Owner." actions={
        <>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            Mostrar inativos
          </label>
          <button className="btn-primary" onClick={() => openEdit()}><Plus className="h-4 w-4" /> Novo usuário</button>
        </>
      } />
      <ErrorText error={toggleActive.error} />

      <div className="card overflow-x-auto">
        {(data ?? []).length === 0 ? <EmptyState title="Nenhum usuário" /> : (
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
              <th className="th">Nome</th><th className="th">E-mail</th><th className="th">Perfil</th>
              <th className="th">Unidade / setor</th><th className="th">Último acesso</th><th className="th">Situação</th><th className="th" />
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {(data ?? []).map((u) => (
                <tr key={u.id} className={u.active ? '' : 'opacity-50'}>
                  <td className="td font-medium">
                    {u.name}
                    {u.isProtected && <ShieldCheck className="ml-1 inline h-3.5 w-3.5 text-brand-600" aria-label="Protegido (Owner)" />}
                  </td>
                  <td className="td text-xs">{u.email}</td>
                  <td className="td"><GenericBadge value={u.role} labels={ROLE_LABELS} tone={u.role === 'OWNER' ? 'purple' : u.role === 'GESTOR_TI' || u.role === 'ADMIN' ? 'blue' : 'slate'} /></td>
                  <td className="td text-xs text-slate-500">{u.unit?.name ?? '—'}{u.department ? ` / ${u.department.name}` : ''}</td>
                  <td className="td text-xs text-slate-400">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'nunca'}</td>
                  <td className="td text-xs">{u.active ? <span className="text-emerald-600">Ativo</span> : <span className="text-red-500">Inativo</span>}</td>
                  <td className="td space-x-2 whitespace-nowrap text-right text-xs">
                    <button className="text-brand-600 hover:underline" onClick={() => openEdit(u)}>Editar</button>
                    <button className="text-slate-500 hover:underline" onClick={() => setPwdModal(u.id)} title="Redefinir senha"><KeyRound className="inline h-3.5 w-3.5" /></button>
                    {u.id !== me?.id && (
                      <button className={u.active ? 'text-red-500 hover:underline' : 'text-emerald-600 hover:underline'}
                        onClick={() => toggleActive.mutate({ id: u.id, active: !u.active })}>
                        {u.active ? 'Inativar' : 'Reativar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <Modal title={modal.id ? 'Editar usuário' : 'Novo usuário'} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Field label="Nome" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="E-mail" required><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            {!modal.id && <Field label="Senha inicial (mín. 8 caracteres)" required><input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>}
            <Field label="Perfil" required>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unidade">
                <select className="input" value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
                  <option value="">—</option>
                  {(structure?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Setor">
                <select className="input" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">—</option>
                  {(structure?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Telefone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <ErrorText error={save.error} />
            <div className="flex justify-end">
              <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Salvar</button>
            </div>
          </div>
        </Modal>
      )}

      {pwdModal && (
        <Modal title="Redefinir senha" onClose={() => setPwdModal(null)}>
          <div className="space-y-3">
            <Field label="Nova senha (mín. 8 caracteres)" required>
              <input type="password" className="input" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
            </Field>
            <ErrorText error={resetPwd.error} />
            <div className="flex justify-end">
              <button className="btn-primary" disabled={resetPwd.isPending || newPwd.length < 8} onClick={() => resetPwd.mutate()}>Redefinir</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

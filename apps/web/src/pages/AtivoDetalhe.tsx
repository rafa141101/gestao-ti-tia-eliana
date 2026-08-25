import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Plus, Printer, TruckIcon, Wrench, Upload, Download } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtMinutes } from '../lib/format';
import { PageHeader, Spinner, ErrorText, AssetStatusBadge, MovementStatusBadge, GenericBadge, Modal, Field, TicketStatusBadge } from '../components/ui';
import {
  MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS, MAINTENANCE_TYPES, MAINTENANCE_TYPE_LABELS,
  COMPONENT_STATUS_LABELS, ASSET_KIND_LABELS, CRITICALITY_LABELS,
} from '@gestao-ti/shared';

export default function AtivoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['asset', id] });

  const [qrModal, setQrModal] = useState(false);
  const [compModal, setCompModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [movModal, setMovModal] = useState(false);
  const [maintModal, setMaintModal] = useState(false);

  const { data: a, isLoading, error } = useQuery({
    queryKey: ['asset', id],
    queryFn: () => api.get<Record<string, any>>(`/api/assets/${id}`),
  });
  const { data: structure } = useQuery({
    queryKey: ['structure'],
    queryFn: () => api.get<{ units: { id: string; name: string }[]; departments: { id: string; name: string }[] }>('/api/structure/all'),
  });

  const [comp, setComp] = useState({ type: '', brand: '', model: '', capacity: '', serialNumber: '', cost: '' });
  const addComponent = useMutation({
    mutationFn: () => api.post(`/api/assets/${id}/components`, {
      type: comp.type, brand: comp.brand || null, model: comp.model || null,
      capacity: comp.capacity || null, serialNumber: comp.serialNumber || null,
      cost: comp.cost ? Number(comp.cost) : null,
    }),
    onSuccess: () => { setCompModal(false); setComp({ type: '', brand: '', model: '', capacity: '', serialNumber: '', cost: '' }); invalidate(); },
  });
  const [importFile, setImportFile] = useState<File | null>(null);
  const importComponents = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', importFile!);
      return api.post<{ created: number; rowErrors: { row: number; message: string }[] }>(`/api/assets/${id}/components/import`, fd);
    },
    onSuccess: () => invalidate(),
  });
  const removeComponent = useMutation({
    mutationFn: ({ compId, destination }: { compId: string; destination: string }) =>
      api.post(`/api/assets/components/${compId}/remove`, { destination }),
    onSuccess: invalidate,
  });

  const [mov, setMov] = useState({ type: 'TRANSFERENCIA_UNIDADE', toUnitId: '', reason: '' });
  const createMovement = useMutation({
    mutationFn: () => api.post('/api/movements', { assetId: id, type: mov.type, toUnitId: mov.toUnitId || null, reason: mov.reason }),
    onSuccess: () => { setMovModal(false); invalidate(); },
  });

  const [maint, setMaint] = useState({ type: 'CORRETIVA', description: '', diagnosis: '', cost: '', durationMinutes: '', nextMaintenanceAt: '', operational: '' });
  const createMaintenance = useMutation({
    mutationFn: () => api.post('/api/maintenance', {
      assetId: id, type: maint.type, description: maint.description,
      diagnosis: maint.diagnosis || null,
      cost: maint.cost ? Number(maint.cost) : null,
      durationMinutes: maint.durationMinutes ? Number(maint.durationMinutes) : null,
      nextMaintenanceAt: maint.nextMaintenanceAt ? new Date(maint.nextMaintenanceAt).toISOString() : null,
      operational: maint.operational === '' ? null : maint.operational === 'sim',
    }),
    onSuccess: () => { setMaintModal(false); invalidate(); },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;
  if (!a) return null;

  const qrUrl = `${window.location.origin}/qr/${a.publicId}`;
  const canManage = can('inventory.manage');

  return (
    <div>
      <PageHeader title={`${a.code} — ${a.description}`} subtitle={`${a.category.name}${a.patrimonyCode ? ` · Patrimônio ${a.patrimonyCode}` : ''}`} actions={
        <>
          <button className="btn-secondary" onClick={() => setQrModal(true)}><Printer className="h-4 w-4" /> QR Code</button>
          {canManage && <button className="btn-secondary" onClick={() => setMovModal(true)}><TruckIcon className="h-4 w-4" /> Movimentar</button>}
          {canManage && <button className="btn-primary" onClick={() => setMaintModal(true)}><Wrench className="h-4 w-4" /> Registrar manutenção</button>}
        </>
      } />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4">
          <div className="card space-y-2.5 p-4 text-sm">
            <div className="flex items-center justify-between">
              <AssetStatusBadge status={a.status} />
              <GenericBadge value={a.kind} labels={ASSET_KIND_LABELS} tone="purple" />
            </div>
            <Row k="Marca / modelo" v={[a.brand, a.model].filter(Boolean).join(' ') || '—'} />
            <Row k="Nº de série" v={a.serialNumber ?? '—'} />
            <Row k="Unidade / setor" v={`${a.unit?.name ?? '—'}${a.department ? ` / ${a.department.name}` : ''}`} />
            <Row k="Localização" v={a.location ?? '—'} />
            <Row k="Usuário responsável" v={a.user?.name ?? '—'} />
            <Row k="Responsável patrimonial" v={a.custodian?.name ?? '—'} />
            <Row k="Criticidade" v={CRITICALITY_LABELS[a.criticality as never] ?? a.criticality} />
            {a.quantity > 1 && <Row k="Quantidade" v={`${a.quantity}${a.minStock != null ? ` (mín.: ${a.minStock})` : ''}`} />}
            <hr className="border-slate-100" />
            <Row k="Compra" v={`${fmtDate(a.purchaseDate)}${a.purchaseValue ? ` · R$ ${Number(a.purchaseValue).toLocaleString('pt-BR')}` : ''}`} />
            <Row k="Fornecedor" v={a.supplier?.name ?? '—'} />
            <Row k="Nota fiscal" v={a.invoiceNumber ?? '—'} />
            <Row k="Garantia" v={a.warrantyEnd ? `até ${fmtDate(a.warrantyEnd)}` : '—'} />
            <Row k="Próxima manutenção" v={fmtDate(a.nextMaintenanceAt)} />
            {(a.hostname || a.ip || a.mac || a.os) && <hr className="border-slate-100" />}
            {a.hostname && <Row k="Hostname" v={a.hostname} />}
            {a.ip && <Row k="IP" v={a.ip} />}
            {a.mac && <Row k="MAC" v={a.mac} />}
            {a.os && <Row k="Sistema operacional" v={a.os} />}
            {a.notes && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{a.notes}</p>}
          </div>

          {a.tickets.length > 0 && (
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-bold">Chamados deste equipamento</h2>
              <ul className="space-y-1.5 text-sm">
                {a.tickets.map((t: any) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <Link className="truncate text-brand-600 hover:underline" to={`/chamados/${t.id}`}>{t.number} — {t.title}</Link>
                    <TicketStatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-5 lg:col-span-2">
          {/* Componentes */}
          <section className="card">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold">Componentes</h2>
              {can('inventory.register') && (
                <div className="flex gap-2">
                  <button className="btn-secondary !py-1 text-xs" onClick={() => { setImportFile(null); importComponents.reset(); setImportModal(true); }}>
                    <Upload className="h-3.5 w-3.5" /> Importar
                  </button>
                  <button className="btn-secondary !py-1 text-xs" onClick={() => setCompModal(true)}><Plus className="h-3.5 w-3.5" /> Componente</button>
                </div>
              )}
            </div>
            {a.components.length === 0 ? <p className="px-4 py-4 text-xs text-slate-400">Nenhum componente cadastrado.</p> : (
              <table className="w-full">
                <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
                  <th className="th">Tipo</th><th className="th">Detalhes</th><th className="th">Instalado</th><th className="th">Status</th><th className="th" />
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {a.components.map((c: any) => (
                    <tr key={c.id} className={c.status !== 'INSTALADO' ? 'opacity-50' : ''}>
                      <td className="td font-medium">{c.type}</td>
                      <td className="td text-xs text-slate-500">{[c.brand, c.model, c.capacity].filter(Boolean).join(' ')}{c.serialNumber ? ` · SN ${c.serialNumber}` : ''}</td>
                      <td className="td text-xs">{fmtDate(c.installedAt)}{c.removedAt ? ` → removido ${fmtDate(c.removedAt)}` : ''}</td>
                      <td className="td"><GenericBadge value={c.status} labels={COMPONENT_STATUS_LABELS} tone={c.status === 'INSTALADO' ? 'green' : 'slate'} /></td>
                      <td className="td text-right">
                        {c.status === 'INSTALADO' && can('inventory.register') && (
                          <select className="input !w-auto !py-1 text-xs" value="" onChange={(e) => e.target.value && removeComponent.mutate({ compId: c.id, destination: e.target.value })}>
                            <option value="">Remover…</option>
                            <option value="ESTOQUE">Para estoque</option>
                            <option value="REMOVIDO">Removido</option>
                            <option value="DESCARTADO">Descartado</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Movimentações */}
          <section className="card">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-bold">Movimentações</h2>
            {a.movements.length === 0 ? <p className="px-4 py-4 text-xs text-slate-400">Nenhuma movimentação registrada.</p> : (
              <table className="w-full">
                <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
                  <th className="th">Tipo</th><th className="th">Origem → Destino</th><th className="th">Solicitante</th><th className="th">Data</th><th className="th">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {a.movements.map((m: any) => (
                    <tr key={m.id}>
                      <td className="td text-xs">{MOVEMENT_TYPE_LABELS[m.type as never] ?? m.type}</td>
                      <td className="td text-xs">{m.fromUnit?.name ?? '—'} → {m.toUnit?.name ?? '—'}</td>
                      <td className="td text-xs">{m.requestedBy.name}</td>
                      <td className="td text-xs">{fmtDateTime(m.createdAt)}</td>
                      <td className="td"><MovementStatusBadge status={m.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Manutenções */}
          <section className="card">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-bold">Histórico de manutenções</h2>
            {a.maintenances.length === 0 ? <p className="px-4 py-4 text-xs text-slate-400">Nenhuma manutenção registrada.</p> : (
              <table className="w-full">
                <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
                  <th className="th">Tipo</th><th className="th">Descrição</th><th className="th">Responsável</th><th className="th">Data</th><th className="th">Duração</th><th className="th">Custo</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {a.maintenances.map((m: any) => (
                    <tr key={m.id}>
                      <td className="td"><GenericBadge value={m.type} labels={MAINTENANCE_TYPE_LABELS} tone={m.type === 'PREVENTIVA' ? 'blue' : 'amber'} /></td>
                      <td className="td max-w-56 truncate text-xs" title={m.description}>{m.description}</td>
                      <td className="td text-xs">{m.responsible?.name ?? m.thirdParty?.name ?? '—'}</td>
                      <td className="td text-xs">{fmtDate(m.date)}</td>
                      <td className="td text-xs">{fmtMinutes(m.durationMinutes)}</td>
                      <td className="td text-xs">{m.cost ? `R$ ${Number(m.cost).toLocaleString('pt-BR')}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>

      {/* Modais */}
      {qrModal && (
        <Modal title={`QR Code — ${a.code}`} onClose={() => setQrModal(false)}>
          <div className="flex flex-col items-center gap-3 py-2 print:py-8">
            <QRCodeSVG value={qrUrl} size={200} />
            <p className="text-lg font-bold">{a.code}</p>
            <p className="text-sm text-slate-500">{a.description}</p>
            <p className="break-all text-xs text-slate-400">{qrUrl}</p>
            <button className="btn-primary print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir etiqueta</button>
          </div>
        </Modal>
      )}

      {compModal && (
        <Modal title="Adicionar componente" onClose={() => setCompModal(false)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo" required><input className="input" value={comp.type} onChange={(e) => setComp({ ...comp, type: e.target.value })} placeholder="Memória RAM, SSD, Fonte…" /></Field>
            <Field label="Capacidade"><input className="input" value={comp.capacity} onChange={(e) => setComp({ ...comp, capacity: e.target.value })} placeholder="8GB, 240GB…" /></Field>
            <Field label="Marca"><input className="input" value={comp.brand} onChange={(e) => setComp({ ...comp, brand: e.target.value })} /></Field>
            <Field label="Modelo"><input className="input" value={comp.model} onChange={(e) => setComp({ ...comp, model: e.target.value })} /></Field>
            <Field label="Nº de série"><input className="input" value={comp.serialNumber} onChange={(e) => setComp({ ...comp, serialNumber: e.target.value })} /></Field>
            <Field label="Custo (R$)"><input type="number" className="input" value={comp.cost} onChange={(e) => setComp({ ...comp, cost: e.target.value })} /></Field>
          </div>
          <ErrorText error={addComponent.error} />
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" disabled={addComponent.isPending || comp.type.length < 2} onClick={() => addComponent.mutate()}>Adicionar</button>
          </div>
        </Modal>
      )}

      {importModal && (
        <Modal title={`Importar componentes — ${a.code}`} onClose={() => setImportModal(false)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Baixe o modelo, preencha uma linha por componente e envie de volta aqui. A coluna <strong>Tipo</strong> é obrigatória; as demais são opcionais.
            </p>
            <button
              type="button"
              className="btn-secondary w-full justify-center"
              onClick={() => downloadFile('/api/assets/components/import-template', 'modelo-componentes.xlsx')}
            >
              <Download className="h-4 w-4" /> Baixar modelo (.xlsx)
            </button>

            <Field label="Planilha preenchida (.xlsx)" required>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="input"
                onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); importComponents.reset(); }}
              />
            </Field>

            <ErrorText error={importComponents.error} />

            {importComponents.data && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-medium text-emerald-700">{importComponents.data.created} componente(s) importado(s) com sucesso.</p>
                {importComponents.data.rowErrors.length > 0 && (
                  <div className="mt-2">
                    <p className="font-medium text-red-600">{importComponents.data.rowErrors.length} linha(s) com problema (não importadas):</p>
                    <ul className="mt-1 list-inside list-disc text-xs text-red-600">
                      {importComponents.data.rowErrors.map((e, i) => (
                        <li key={i}>Linha {e.row}: {e.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setImportModal(false)}>
                {importComponents.data ? 'Fechar' : 'Cancelar'}
              </button>
              <button
                className="btn-primary"
                disabled={!importFile || importComponents.isPending}
                onClick={() => importComponents.mutate()}
              >
                {importComponents.isPending ? 'Importando…' : 'Importar'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {movModal && (
        <Modal title={`Movimentar ${a.code}`} onClose={() => setMovModal(false)}>
          <div className="space-y-3">
            <Field label="Tipo de movimentação" required>
              <select className="input" value={mov.type} onChange={(e) => setMov({ ...mov, type: e.target.value })}>
                {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Unidade de destino">
              <select className="input" value={mov.toUnitId} onChange={(e) => setMov({ ...mov, toUnitId: e.target.value })}>
                <option value="">— (mesma unidade)</option>
                {(structure?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Motivo" required>
              <textarea className="input" rows={2} value={mov.reason} onChange={(e) => setMov({ ...mov, reason: e.target.value })} />
            </Field>
            <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">A movimentação segue o fluxo: Solicitada → Retirada → Em transporte → Recebida → <b>Confirmada</b>. A localização do ativo só muda na confirmação do destino.</p>
            <ErrorText error={createMovement.error} />
            <div className="flex justify-end">
              <button className="btn-primary" disabled={createMovement.isPending || mov.reason.length < 3} onClick={() => createMovement.mutate()}>Registrar movimentação</button>
            </div>
          </div>
        </Modal>
      )}

      {maintModal && (
        <Modal title={`Manutenção — ${a.code}`} onClose={() => setMaintModal(false)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo" required>
              <select className="input" value={maint.type} onChange={(e) => setMaint({ ...maint, type: e.target.value })}>
                {MAINTENANCE_TYPES.map((t) => <option key={t} value={t}>{MAINTENANCE_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Duração (min)"><input type="number" className="input" value={maint.durationMinutes} onChange={(e) => setMaint({ ...maint, durationMinutes: e.target.value })} /></Field>
            <div className="sm:col-span-2">
              <Field label="Serviço executado / descrição" required>
                <textarea className="input" rows={2} value={maint.description} onChange={(e) => setMaint({ ...maint, description: e.target.value })} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Diagnóstico"><textarea className="input" rows={2} value={maint.diagnosis} onChange={(e) => setMaint({ ...maint, diagnosis: e.target.value })} /></Field>
            </div>
            <Field label="Custo (R$)"><input type="number" className="input" value={maint.cost} onChange={(e) => setMaint({ ...maint, cost: e.target.value })} /></Field>
            <Field label="Equipamento voltou a operar?">
              <select className="input" value={maint.operational} onChange={(e) => setMaint({ ...maint, operational: e.target.value })}>
                <option value="">—</option><option value="sim">Sim</option><option value="nao">Não</option>
              </select>
            </Field>
            <Field label="Próxima manutenção prevista"><input type="date" className="input" value={maint.nextMaintenanceAt} onChange={(e) => setMaint({ ...maint, nextMaintenanceAt: e.target.value })} /></Field>
          </div>
          <ErrorText error={createMaintenance.error} />
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" disabled={createMaintenance.isPending || maint.description.length < 3} onClick={() => createMaintenance.mutate()}>Registrar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs font-semibold text-slate-400">{k}</span>
      <span className="text-right text-sm text-slate-700">{v}</span>
    </div>
  );
}

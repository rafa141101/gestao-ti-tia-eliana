import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ErrorText, Spinner, AssetStatusBadge } from '../components/ui';

/** Página pública do QR Code — sem login, sem dados sensíveis. */
export default function QrPublico() {
  const { publicId } = useParams<{ publicId: string }>();
  const [reporterName, setReporterName] = useState('');
  const [description, setDescription] = useState('');

  const { data: asset, isLoading, error } = useQuery({
    queryKey: ['qr-asset', publicId],
    queryFn: () => fetch(`/api/public/assets/${publicId}`).then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).error ?? 'Equipamento não encontrado');
      return r.json();
    }),
  });

  const report = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/public/assets/${publicId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reporterName, description }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? 'Falha ao abrir chamado');
      return r.json() as Promise<{ number: string }>;
    },
  });

  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-100 p-4 pt-10">
      <div className="w-full max-w-md">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 font-bold text-white">TI</div>
          <h1 className="font-bold text-slate-800">Gestão TI — Tia Eliana</h1>
        </div>

        {isLoading && <Spinner />}
        <ErrorText error={error} />

        {asset && (
          <div className="card space-y-3 p-5">
            <div className="flex items-center justify-between">
              <p className="text-lg font-bold">{asset.code}</p>
              <AssetStatusBadge status={asset.status} />
            </div>
            <p className="text-sm text-slate-700">{asset.description}</p>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p><span className="font-semibold">Categoria:</span> {asset.category.name}</p>
              {asset.patrimonyCode && <p><span className="font-semibold">Patrimônio:</span> {asset.patrimonyCode}</p>}
              {asset.brand && <p><span className="font-semibold">Marca:</span> {asset.brand} {asset.model ?? ''}</p>}
              {asset.unit && <p><span className="font-semibold">Unidade:</span> {asset.unit.name}</p>}
            </div>

            {report.data ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-center">
                <p className="font-bold text-emerald-700">Chamado aberto!</p>
                <p className="mt-1 text-2xl font-bold text-emerald-800">{report.data.number}</p>
                <p className="mt-1 text-xs text-emerald-600">A equipe de TI foi notificada e vai atender conforme a prioridade.</p>
              </div>
            ) : (
              <form className="space-y-3 border-t border-slate-100 pt-3" onSubmit={(e: FormEvent) => { e.preventDefault(); report.mutate(); }}>
                <p className="text-sm font-semibold text-slate-700">Relatar problema neste equipamento</p>
                <input className="input" required minLength={2} placeholder="Seu nome" value={reporterName} onChange={(e) => setReporterName(e.target.value)} />
                <textarea className="input" required minLength={5} rows={3} placeholder="O que está acontecendo?" value={description} onChange={(e) => setDescription(e.target.value)} />
                <ErrorText error={report.error} />
                <button type="submit" className="btn-primary w-full justify-center" disabled={report.isPending}>
                  {report.isPending ? 'Abrindo…' : 'Abrir chamado'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

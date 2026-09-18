import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader, Spinner, ErrorText, Field } from '../../components/ui';

export default function Configuracoes() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Record<string, unknown>>('/api/settings'),
  });

  const [appName, setAppName] = useState('');
  const [autoCloseHours, setAutoCloseHours] = useState(48);
  const [wipLimit, setWipLimit] = useState(2);

  useEffect(() => {
    if (data) {
      setAppName(String(data.appName ?? ''));
      setAutoCloseHours(Number(data.autoCloseHours ?? 48));
      setWipLimit(Number(data.wipLimit ?? 2));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.patch('/api/settings', { appName, autoCloseHours, wipLimit }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['public-settings'] }); },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Configurações do sistema" subtitle="Toda alteração fica registrada na auditoria." />
      <div className="card space-y-4 p-5">
        <Field label="Nome do sistema (exibido no login e no topo)">
          <input className="input" value={appName} onChange={(e) => setAppName(e.target.value)} />
        </Field>
        <Field label="Fechamento automático de chamados resolvidos (horas sem manifestação)">
          <input type="number" min={1} className="input" value={autoCloseHours} onChange={(e) => setAutoCloseHours(Number(e.target.value))} />
        </Field>
        <Field label="Limite de chamados simultâneos em atendimento por técnico (P1 fura o limite)">
          <input type="number" min={1} className="input" value={wipLimit} onChange={(e) => setWipLimit(Number(e.target.value))} />
        </Field>
        <ErrorText error={save.error} />
        <div className="flex justify-end">
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isSuccess && !save.isPending ? 'Salvo ✓' : 'Salvar configurações'}
          </button>
        </div>
      </div>

      <WhatsAppCard />
    </div>
  );
}

function WhatsAppCard() {
  const { data } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => api.get<{ configured: boolean; webhookPath: string; signatureValidationEnabled: boolean }>('/api/integrations/whatsapp/status'),
  });
  return (
    <div className="card mt-5 p-5">
      <div className="mb-2 flex items-center gap-2">
        <MessageCircle className="h-5 w-5 text-emerald-600" />
        <h2 className="text-sm font-bold">Integração WhatsApp (API oficial da Meta)</h2>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${data?.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {data?.configured ? 'Ativa' : 'Inativa'}
        </span>
      </div>
      {data?.configured ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            Mensagens recebidas viram chamados (canal WhatsApp); mensagens do mesmo número em até 24h entram no mesmo chamado.
            Respostas públicas da TI e a resolução são enviadas de volta na conversa — dentro da janela de serviço, sem custo.
          </p>
          <p className="text-xs text-slate-500">
            Validação de assinatura do webhook (X-Hub-Signature-256):{' '}
            <span className={data.signatureValidationEnabled ? 'font-semibold text-emerald-600' : 'font-semibold text-amber-600'}>
              {data.signatureValidationEnabled ? 'ativa' : 'desativada — defina WHATSAPP_APP_SECRET'}
            </span>
          </p>
        </div>
      ) : (
        <div className="space-y-1.5 text-sm text-slate-600">
          <p>Para ativar, defina no <code className="rounded bg-slate-100 px-1">.env</code> e reinicie a API:</p>
          <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">{`WHATSAPP_TOKEN=            # token permanente do app Meta
WHATSAPP_PHONE_NUMBER_ID=  # ID do número no WhatsApp Business
WHATSAPP_VERIFY_TOKEN=     # valor livre, o mesmo usado no painel da Meta
WHATSAPP_APP_SECRET=       # Configurações do app → Básico → Chave secreta`}</pre>
          <p>Depois cadastre o webhook no painel da Meta apontando para <code className="rounded bg-slate-100 px-1">{data?.webhookPath ?? '/api/integrations/whatsapp/webhook'}</code> (exige URL pública com HTTPS).</p>
        </div>
      )}
    </div>
  );
}

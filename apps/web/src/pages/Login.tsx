import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { ErrorText } from '../components/ui';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const { data: pub } = useQuery({
    queryKey: ['public-settings'],
    queryFn: () => api.get<{ appName: string }>('/api/settings/public'),
  });

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-xl font-bold text-white">TI</div>
          <h1 className="text-xl font-bold text-white">{pub?.appName ?? 'Gestão TI'}</h1>
          <p className="mt-1 text-sm text-slate-400">Chamados, trabalho da equipe e inventário</p>
        </div>
        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="email">E-mail</label>
            <input id="email" type="email" required autoFocus className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@tiaeliana.com.br" />
          </div>
          <div>
            <label className="label" htmlFor="password">Senha</label>
            <input id="password" type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <ErrorText error={error} />
          <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">Problemas para entrar? Procure o Gestor de TI ou a Diretoria.</p>
      </div>
    </div>
  );
}

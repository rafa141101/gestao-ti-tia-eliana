import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import './index.css';

const Login = lazy(() => import('./pages/Login'));
const QrPublico = lazy(() => import('./pages/QrPublico'));
const MeuTrabalho = lazy(() => import('./pages/MeuTrabalho'));
const DashboardDiretoria = lazy(() => import('./pages/DashboardDiretoria'));
const DashboardOperacional = lazy(() => import('./pages/DashboardOperacional'));
const Chamados = lazy(() => import('./pages/Chamados'));
const NovoChamado = lazy(() => import('./pages/NovoChamado'));
const ChamadoDetalhe = lazy(() => import('./pages/ChamadoDetalhe'));
const Projetos = lazy(() => import('./pages/Projetos'));
const ProjetoDetalhe = lazy(() => import('./pages/ProjetoDetalhe'));
const Rotinas = lazy(() => import('./pages/Rotinas'));
const Inventario = lazy(() => import('./pages/Inventario'));
const AtivoDetalhe = lazy(() => import('./pages/AtivoDetalhe'));
const Movimentacoes = lazy(() => import('./pages/Movimentacoes'));
const Manutencoes = lazy(() => import('./pages/Manutencoes'));
const Terceiros = lazy(() => import('./pages/Terceiros'));
const Relatorios = lazy(() => import('./pages/Relatorios'));
const Auditoria = lazy(() => import('./pages/Auditoria'));
const Usuarios = lazy(() => import('./pages/admin/Usuarios'));
const Perfis = lazy(() => import('./pages/admin/Perfis'));
const Estrutura = lazy(() => import('./pages/admin/Estrutura'));
const CategoriasSla = lazy(() => import('./pages/admin/CategoriasSla'));
const Configuracoes = lazy(() => import('./pages/admin/Configuracoes'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Home() {
  const { can } = useAuth();
  if (can('tickets.work')) return <Navigate to="/meu-trabalho" replace />;
  if (can('dashboard.direction')) return <Navigate to="/diretoria" replace />;
  return <Navigate to="/chamados" replace />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/qr/:publicId" element={<QrPublico />} />
              <Route element={<Protected><Layout /></Protected>}>
                <Route path="/" element={<Home />} />
                <Route path="/meu-trabalho" element={<MeuTrabalho />} />
                <Route path="/diretoria" element={<DashboardDiretoria />} />
                <Route path="/operacional" element={<DashboardOperacional />} />
                <Route path="/chamados" element={<Chamados />} />
                <Route path="/chamados/novo" element={<NovoChamado />} />
                <Route path="/chamados/:id" element={<ChamadoDetalhe />} />
                <Route path="/projetos" element={<Projetos />} />
                <Route path="/projetos/:id" element={<ProjetoDetalhe />} />
                <Route path="/rotinas" element={<Rotinas />} />
                <Route path="/inventario" element={<Inventario />} />
                <Route path="/inventario/:id" element={<AtivoDetalhe />} />
                <Route path="/movimentacoes" element={<Movimentacoes />} />
                <Route path="/manutencoes" element={<Manutencoes />} />
                <Route path="/terceiros" element={<Terceiros />} />
                <Route path="/relatorios" element={<Relatorios />} />
                <Route path="/auditoria" element={<Auditoria />} />
                <Route path="/admin/usuarios" element={<Usuarios />} />
                <Route path="/admin/perfis" element={<Perfis />} />
                <Route path="/admin/estrutura" element={<Estrutura />} />
                <Route path="/admin/categorias" element={<CategoriasSla />} />
                <Route path="/admin/configuracoes" element={<Configuracoes />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

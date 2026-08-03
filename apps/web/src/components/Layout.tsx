import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, Briefcase, Ticket, FolderKanban, RefreshCw, Boxes, TruckIcon,
  Wrench, Building2, BarChart3, ScrollText, Users, Settings, LogOut, Bell, Menu,
  ChevronDown, CircleDot, Shield, ListTree, Timer, Search,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { fmtRelative } from '../lib/format';
import { TicketStatusBadge, PriorityBadge, AssetStatusBadge, ProjectStatusBadge } from './ui';

interface SearchResults {
  tickets: { id: string; number: string; title: string; status: string; priority: string }[];
  assets: { id: string; code: string; description: string; status: string }[];
  projects: { id: string; name: string; status: string }[];
}

/** Busca global: chamados, ativos e projetos num único campo. */
function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.get<SearchResults>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { setResults(r); setOpen(true); })
        .catch(() => setResults(null));
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q]);

  function go(path: string) {
    setOpen(false);
    setQ('');
    navigate(path);
  }

  const empty = results && results.tickets.length + results.assets.length + results.projects.length === 0;

  return (
    <div className="relative hidden md:block">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
      <input
        className="input w-72 !pl-8"
        placeholder="Buscar chamado, ativo ou projeto…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results && setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      />
      {open && results && (
        <div className="absolute left-0 z-40 mt-1 w-96 rounded-xl border border-slate-200 bg-white shadow-lg" onMouseLeave={() => setOpen(false)}>
          {empty && <p className="px-3 py-4 text-center text-xs text-slate-400">Nada encontrado para “{q}”.</p>}
          {results.tickets.length > 0 && (
            <div className="border-b border-slate-50 py-1">
              <p className="px-3 py-1 text-[10px] font-bold uppercase text-slate-400">Chamados</p>
              {results.tickets.map((t) => (
                <button key={t.id} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => go(`/chamados/${t.id}`)}>
                  <PriorityBadge priority={t.priority} />
                  <span className="min-w-0 flex-1 truncate">{t.number} · {t.title}</span>
                  <TicketStatusBadge status={t.status} />
                </button>
              ))}
            </div>
          )}
          {results.assets.length > 0 && (
            <div className="border-b border-slate-50 py-1">
              <p className="px-3 py-1 text-[10px] font-bold uppercase text-slate-400">Inventário</p>
              {results.assets.map((a) => (
                <button key={a.id} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => go(`/inventario/${a.id}`)}>
                  <span className="min-w-0 flex-1 truncate">{a.code} — {a.description}</span>
                  <AssetStatusBadge status={a.status} />
                </button>
              ))}
            </div>
          )}
          {results.projects.length > 0 && (
            <div className="py-1">
              <p className="px-3 py-1 text-[10px] font-bold uppercase text-slate-400">Projetos</p>
              {results.projects.map((p) => (
                <button key={p.id} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => go(`/projetos/${p.id}`)}>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <ProjectStatusBadge status={p.status} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface RunningWorklog {
  id: string;
  startedAt: string;
  ticket?: { id: string; number: string; title: string } | null;
  task?: { id: string; title: string; project?: { id: string; name: string } } | null;
  routineExecution?: { id: string; routine: { name: string } } | null;
  maintenance?: { id: string; description: string } | null;
}

function runningLabel(w: RunningWorklog): string {
  if (w.ticket) return w.ticket.number;
  if (w.task) return w.task.title;
  if (w.routineExecution) return w.routineExecution.routine.name;
  if (w.maintenance) return 'Manutenção';
  return 'Atividade';
}

export default function Layout() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const { data: notif } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: { id: string; title: string; body?: string; readAt: string | null; entity?: string; entityId?: string; createdAt: string }[]; unreadCount: number }>('/api/notifications'),
    refetchInterval: 60_000,
  });

  const { data: running } = useQuery({
    queryKey: ['running-worklog'],
    queryFn: () => api.get<RunningWorklog | null>('/api/worklogs/running'),
    refetchInterval: 60_000,
    enabled: can('tickets.work'),
  });

  const nav = [
    { to: '/meu-trabalho', label: 'Meu Trabalho', icon: Briefcase, show: can('tickets.work') },
    { to: '/diretoria', label: 'Visão da Diretoria', icon: LayoutDashboard, show: can('dashboard.direction') },
    { to: '/operacional', label: 'Painel Operacional', icon: Timer, show: can('dashboard.operational') },
    { to: '/chamados', label: 'Chamados', icon: Ticket, show: true },
    { to: '/projetos', label: 'Projetos', icon: FolderKanban, show: can('projects.view') },
    { to: '/rotinas', label: 'Rotinas', icon: RefreshCw, show: can('routines.execute') || can('routines.manage') },
    { to: '/inventario', label: 'Inventário', icon: Boxes, show: can('inventory.view') },
    { to: '/movimentacoes', label: 'Movimentações', icon: TruckIcon, show: can('inventory.view') },
    { to: '/manutencoes', label: 'Manutenções', icon: Wrench, show: can('inventory.view') },
    { to: '/terceiros', label: 'Terceiros', icon: Building2, show: can('tickets.work') || can('thirdparties.manage') },
    { to: '/relatorios', label: 'Relatórios', icon: BarChart3, show: can('reports.view') },
    { to: '/auditoria', label: 'Auditoria', icon: ScrollText, show: can('audit.view') },
  ].filter((n) => n.show);

  const adminNav = [
    { to: '/admin/usuarios', label: 'Usuários', icon: Users, show: can('admin.users') },
    { to: '/admin/perfis', label: 'Perfis e permissões', icon: Shield, show: can('admin.users') },
    { to: '/admin/estrutura', label: 'Unidades e setores', icon: ListTree, show: can('admin.structure') },
    { to: '/admin/categorias', label: 'Categorias e SLA', icon: ListTree, show: can('admin.structure') },
    { to: '/admin/configuracoes', label: 'Configurações', icon: Settings, show: can('admin.settings') },
  ].filter((n) => n.show);

  async function markAllRead() {
    await api.post('/api/notifications/read-all');
    qc.invalidateQueries({ queryKey: ['notifications'] });
  }

  function openNotification(n: { id: string; entity?: string; entityId?: string }) {
    api.post(`/api/notifications/${n.id}/read`).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
    setNotifOpen(false);
    if (n.entity === 'tickets' && n.entityId) navigate(`/chamados/${n.entityId}`);
    if (n.entity === 'routine_executions') navigate('/rotinas');
    if (n.entity === 'assets' && n.entityId) navigate(`/inventario/${n.entityId}`);
    if (n.entity === 'asset_movements') navigate('/movimentacoes');
  }

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
    }`;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — fixa, sempre visível no desktop; sobrepõe como painel no mobile */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col transform bg-slate-900 transition-transform lg:relative lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-14 items-center gap-2 border-b border-slate-700/60 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">TI</div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-white">Gestão TI</p>
            <p className="text-[10px] text-slate-400">Tia Eliana</p>
          </div>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-3">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} className={linkCls} onClick={() => setSidebarOpen(false)}>
              <n.icon className="h-4 w-4 shrink-0" /> {n.label}
            </NavLink>
          ))}
          {adminNav.length > 0 && (
            <>
              <p className="mt-4 mb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Administração</p>
              {adminNav.map((n) => (
                <NavLink key={n.to} to={n.to} className={linkCls} onClick={() => setSidebarOpen(false)}>
                  <n.icon className="h-4 w-4 shrink-0" /> {n.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
      </aside>
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main — coluna própria; só o <main> abaixo rola, cabeçalho e sidebar ficam fixos */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
          <div className="flex items-center gap-3">
            <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu">
              <Menu className="h-5 w-5" />
            </button>
            <GlobalSearch />
            {running && (
              <button
                onClick={() => running.ticket ? navigate(`/chamados/${running.ticket.id}`) : navigate('/meu-trabalho')}
                className="flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                title={`Atividade iniciada ${fmtRelative(running.startedAt)}`}
              >
                <CircleDot className="h-3.5 w-3.5 animate-pulse" />
                Trabalhando em: {runningLabel(running)}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={() => setNotifOpen((v) => !v)} aria-label="Notificações">
                <Bell className="h-5 w-5" />
                {(notif?.unreadCount ?? 0) > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {notif!.unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-1 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <p className="text-sm font-semibold">Notificações</p>
                    <button className="text-xs text-brand-600 hover:underline" onClick={markAllRead}>Marcar todas como lidas</button>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {(notif?.items ?? []).length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">Sem notificações.</p>}
                    {(notif?.items ?? []).map((n) => (
                      <button key={n.id} onClick={() => openNotification(n)} className={`block w-full border-b border-slate-50 px-3 py-2 text-left hover:bg-slate-50 ${n.readAt ? 'opacity-60' : ''}`}>
                        <p className="text-xs font-medium text-slate-800">{n.title}</p>
                        {n.body && <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{n.body}</p>}
                        <p className="mt-0.5 text-[10px] text-slate-400">{fmtRelative(n.createdAt)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="group relative">
              <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                  {user?.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                </div>
                <span className="hidden text-sm font-medium sm:block">{user?.name.split(' ')[0]}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>
              <div className="invisible absolute right-0 z-30 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100">
                <p className="px-3 py-2 text-xs text-slate-500">{user?.email}</p>
                <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                  <LogOut className="h-4 w-4" /> Sair
                </button>
              </div>
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { PageHeader } from '../../components/ui';
import { ROLES, ROLE_LABELS, PERMISSIONS, ROLE_PERMISSIONS } from '@gestao-ti/shared';
import { Check, Minus } from 'lucide-react';

const PERMISSION_LABELS: Record<string, string> = {
  'tickets.create': 'Abrir chamados',
  'tickets.view.own': 'Ver os próprios chamados',
  'tickets.view.department': 'Ver chamados do setor',
  'tickets.view.all': 'Ver todos os chamados',
  'tickets.work': 'Atender chamados e registrar tempo',
  'tickets.manage': 'Distribuir, priorizar e cancelar chamados',
  'worklogs.edit': 'Editar/estornar apontamentos (auditado)',
  'projects.view': 'Ver projetos',
  'projects.manage': 'Criar e gerenciar projetos',
  'routines.execute': 'Executar rotinas',
  'routines.manage': 'Criar e gerenciar rotinas',
  'inventory.view': 'Ver inventário',
  'inventory.register': 'Cadastrar e conferir equipamentos',
  'inventory.manage': 'Movimentar e registrar manutenções',
  'thirdparties.manage': 'Gerenciar terceiros',
  'dashboard.operational': 'Painel operacional',
  'dashboard.direction': 'Visão da diretoria',
  'reports.view': 'Relatórios',
  'export.data': 'Exportar dados',
  'audit.view': 'Consultar auditoria',
  'admin.users': 'Administrar usuários',
  'admin.structure': 'Administrar unidades, setores, categorias e SLA',
  'admin.settings': 'Configurações do sistema',
};

export default function Perfis() {
  return (
    <div>
      <PageHeader title="Perfis e permissões" subtitle="Matriz definida em código e aplicada no servidor. Regras adicionais: Owner não pode ser rebaixado pela TI; o último Owner ativo nunca pode ser removido." />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[980px]">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              <th className="th">Permissão</th>
              {ROLES.map((r) => <th key={r} className="th text-center">{ROLE_LABELS[r].replace(' (Owner)', '')}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {PERMISSIONS.map((p) => (
              <tr key={p}>
                <td className="td text-xs font-medium">{PERMISSION_LABELS[p] ?? p}<p className="text-[10px] text-slate-400">{p}</p></td>
                {ROLES.map((r) => (
                  <td key={r} className="td text-center">
                    {ROLE_PERMISSIONS[r].includes(p)
                      ? <Check className="mx-auto h-4 w-4 text-emerald-600" />
                      : <Minus className="mx-auto h-3.5 w-3.5 text-slate-200" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

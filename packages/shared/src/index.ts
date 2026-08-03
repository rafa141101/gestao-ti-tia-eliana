// ============================================================
// Gestão TI — Tia Eliana — Domínio compartilhado (API + Web)
// ============================================================

// ---------- Perfis ----------
export const ROLES = [
  'OWNER',
  'ADMIN',
  'GESTOR_TI',
  'TECNICO',
  'SOLICITANTE',
  'GESTOR_SETOR',
  'AUDITOR',
  'INVENTARIANTE',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Diretoria (Owner)',
  ADMIN: 'Administrador',
  GESTOR_TI: 'Gestor de TI',
  TECNICO: 'Técnico',
  SOLICITANTE: 'Solicitante',
  GESTOR_SETOR: 'Gestor de setor',
  AUDITOR: 'Auditor',
  INVENTARIANTE: 'Inventariante',
};

// ---------- Permissões ----------
export const PERMISSIONS = [
  'tickets.create',          // abrir chamados
  'tickets.view.own',        // ver os próprios chamados
  'tickets.view.department', // ver chamados do seu setor
  'tickets.view.all',        // ver todos os chamados
  'tickets.work',            // atender, responder, registrar tempo
  'tickets.manage',          // distribuir, priorizar, cancelar, editar SLA do chamado
  'worklogs.edit',           // editar apontamentos (com justificativa/auditoria)
  'projects.view',
  'projects.manage',
  'routines.execute',
  'routines.manage',
  'inventory.view',
  'inventory.register',      // cadastrar/conferir equipamentos
  'inventory.manage',        // movimentar, manutenção, descarte
  'thirdparties.manage',
  'dashboard.operational',
  'dashboard.direction',
  'reports.view',
  'export.data',
  'audit.view',
  'admin.users',
  'admin.structure',         // unidades, setores, categorias, SLA, filas
  'admin.settings',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

/**
 * Matriz de permissões por perfil.
 * OWNER tem tudo. ADMIN tem tudo exceto o que só a diretoria pode
 * (as restrições de Owner — não excluir histórico, não rebaixar Owner —
 * são regras de negócio aplicadas no servidor, além desta matriz).
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL,
  GESTOR_TI: [
    'tickets.create', 'tickets.view.own', 'tickets.view.all', 'tickets.work', 'tickets.manage',
    'worklogs.edit',
    'projects.view', 'projects.manage',
    'routines.execute', 'routines.manage',
    'inventory.view', 'inventory.register', 'inventory.manage',
    'thirdparties.manage',
    'dashboard.operational', 'reports.view', 'export.data',
  ],
  TECNICO: [
    'tickets.create', 'tickets.view.own', 'tickets.view.all', 'tickets.work',
    'projects.view',
    'routines.execute',
    'inventory.view', 'inventory.register', 'inventory.manage',
    'dashboard.operational',
  ],
  SOLICITANTE: ['tickets.create', 'tickets.view.own'],
  GESTOR_SETOR: ['tickets.create', 'tickets.view.own', 'tickets.view.department', 'reports.view', 'inventory.view'],
  AUDITOR: [
    'tickets.view.all', 'projects.view', 'inventory.view',
    'reports.view', 'audit.view', 'dashboard.direction', 'dashboard.operational', 'export.data',
  ],
  INVENTARIANTE: ['tickets.create', 'tickets.view.own', 'inventory.view', 'inventory.register'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// ---------- Status de chamado ----------
export const TICKET_STATUSES = [
  'NOVO', 'TRIAGEM', 'ATRIBUIDO', 'EM_ATENDIMENTO',
  'AGUARDANDO_SOLICITANTE', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_APROVACAO',
  'AGENDADO', 'PAUSADO_DEPENDENCIA',
  'RESOLVIDO', 'FECHADO', 'CANCELADO',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  NOVO: 'Novo',
  TRIAGEM: 'Triagem',
  ATRIBUIDO: 'Atribuído',
  EM_ATENDIMENTO: 'Em atendimento',
  AGUARDANDO_SOLICITANTE: 'Aguardando solicitante',
  AGUARDANDO_TERCEIRO: 'Aguardando terceiro',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  AGENDADO: 'Agendado',
  PAUSADO_DEPENDENCIA: 'Pausado por dependência',
  RESOLVIDO: 'Resolvido',
  FECHADO: 'Fechado',
  CANCELADO: 'Cancelado',
};

/** Status em que o cronômetro de SLA fica pausado. */
export const SLA_PAUSED_STATUSES: TicketStatus[] = [
  'AGUARDANDO_SOLICITANTE', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_APROVACAO', 'PAUSADO_DEPENDENCIA', 'AGENDADO',
];

/** Status considerados "abertos" (backlog). */
export const OPEN_TICKET_STATUSES: TicketStatus[] = [
  'NOVO', 'TRIAGEM', 'ATRIBUIDO', 'EM_ATENDIMENTO',
  'AGUARDANDO_SOLICITANTE', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_APROVACAO', 'AGENDADO', 'PAUSADO_DEPENDENCIA',
];

/** Transições de status permitidas (validadas no servidor e no Kanban). */
export const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NOVO: ['TRIAGEM', 'ATRIBUIDO', 'EM_ATENDIMENTO', 'CANCELADO'],
  TRIAGEM: ['ATRIBUIDO', 'EM_ATENDIMENTO', 'AGUARDANDO_APROVACAO', 'AGENDADO', 'CANCELADO'],
  ATRIBUIDO: ['EM_ATENDIMENTO', 'TRIAGEM', 'AGENDADO', 'CANCELADO'],
  EM_ATENDIMENTO: ['AGUARDANDO_SOLICITANTE', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_APROVACAO', 'PAUSADO_DEPENDENCIA', 'AGENDADO', 'RESOLVIDO', 'ATRIBUIDO', 'CANCELADO'],
  AGUARDANDO_SOLICITANTE: ['EM_ATENDIMENTO', 'RESOLVIDO', 'FECHADO', 'CANCELADO'],
  AGUARDANDO_TERCEIRO: ['EM_ATENDIMENTO', 'RESOLVIDO', 'CANCELADO'],
  AGUARDANDO_APROVACAO: ['EM_ATENDIMENTO', 'ATRIBUIDO', 'CANCELADO'],
  AGENDADO: ['EM_ATENDIMENTO', 'ATRIBUIDO', 'CANCELADO'],
  PAUSADO_DEPENDENCIA: ['EM_ATENDIMENTO', 'CANCELADO'],
  RESOLVIDO: ['FECHADO', 'EM_ATENDIMENTO'], // EM_ATENDIMENTO = reabertura
  FECHADO: ['EM_ATENDIMENTO'],              // reabertura controlada
  CANCELADO: [],
};

// ---------- Prioridade ----------
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  P1: 'P1 — Crítica',
  P2: 'P2 — Alta',
  P3: 'P3 — Normal',
  P4: 'P4 — Planejada',
};

export const IMPACTS = [
  'UMA_PESSOA', 'ALGUMAS_PESSOAS', 'UM_SETOR', 'UMA_UNIDADE', 'VARIAS_UNIDADES', 'TODA_EMPRESA',
] as const;
export type Impact = (typeof IMPACTS)[number];

export const IMPACT_LABELS: Record<Impact, string> = {
  UMA_PESSOA: 'Uma pessoa',
  ALGUMAS_PESSOAS: 'Algumas pessoas',
  UM_SETOR: 'Um setor',
  UMA_UNIDADE: 'Uma unidade',
  VARIAS_UNIDADES: 'Várias unidades',
  TODA_EMPRESA: 'Toda a empresa',
};

export const URGENCIES = [
  'EXISTE_ALTERNATIVA', 'PARCIALMENTE_PREJUDICADA', 'ATIVIDADE_BLOQUEADA', 'OPERACAO_PARADA', 'RISCO_IMEDIATO',
] as const;
export type Urgency = (typeof URGENCIES)[number];

export const URGENCY_LABELS: Record<Urgency, string> = {
  EXISTE_ALTERNATIVA: 'Existe alternativa',
  PARCIALMENTE_PREJUDICADA: 'Atividade parcialmente prejudicada',
  ATIVIDADE_BLOQUEADA: 'Atividade bloqueada',
  OPERACAO_PARADA: 'Produção/vendas/faturamento/expedição parados',
  RISCO_IMEDIATO: 'Risco de perda financeira ou operacional imediata',
};

/**
 * Matriz impacto × urgência → prioridade calculada.
 * Linhas: urgência (da menor para a maior). Colunas: impacto (do menor para o maior).
 */
const PRIORITY_MATRIX: Record<Urgency, Record<Impact, Priority>> = {
  EXISTE_ALTERNATIVA: {
    UMA_PESSOA: 'P4', ALGUMAS_PESSOAS: 'P4', UM_SETOR: 'P3',
    UMA_UNIDADE: 'P3', VARIAS_UNIDADES: 'P3', TODA_EMPRESA: 'P2',
  },
  PARCIALMENTE_PREJUDICADA: {
    UMA_PESSOA: 'P3', ALGUMAS_PESSOAS: 'P3', UM_SETOR: 'P3',
    UMA_UNIDADE: 'P2', VARIAS_UNIDADES: 'P2', TODA_EMPRESA: 'P2',
  },
  ATIVIDADE_BLOQUEADA: {
    UMA_PESSOA: 'P3', ALGUMAS_PESSOAS: 'P2', UM_SETOR: 'P2',
    UMA_UNIDADE: 'P1', VARIAS_UNIDADES: 'P1', TODA_EMPRESA: 'P1',
  },
  OPERACAO_PARADA: {
    UMA_PESSOA: 'P2', ALGUMAS_PESSOAS: 'P2', UM_SETOR: 'P1',
    UMA_UNIDADE: 'P1', VARIAS_UNIDADES: 'P1', TODA_EMPRESA: 'P1',
  },
  RISCO_IMEDIATO: {
    UMA_PESSOA: 'P2', ALGUMAS_PESSOAS: 'P1', UM_SETOR: 'P1',
    UMA_UNIDADE: 'P1', VARIAS_UNIDADES: 'P1', TODA_EMPRESA: 'P1',
  },
};

export function computePriority(impact: Impact, urgency: Urgency): Priority {
  return PRIORITY_MATRIX[urgency][impact];
}

// ---------- Canais ----------
export const CHANNELS = [
  'PORTAL', 'WHATSAPP', 'EMAIL', 'TELEFONE', 'PRESENCIAL', 'SISTEMA', 'QR_CODE', 'MONITORAMENTO', 'TECNICO',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  PORTAL: 'Portal',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  TELEFONE: 'Telefone',
  PRESENCIAL: 'Presencial',
  SISTEMA: 'Sistema',
  QR_CODE: 'QR Code',
  MONITORAMENTO: 'Monitoramento',
  TECNICO: 'Aberto pelo técnico',
};

// ---------- Tipos de trabalho (apontamento) ----------
export const WORKLOG_TYPES = [
  'ATENDIMENTO_REMOTO', 'ATENDIMENTO_PRESENCIAL', 'DIAGNOSTICO', 'MANUTENCAO', 'CONFIGURACAO',
  'DESENVOLVIMENTO', 'ANALISE', 'REUNIAO', 'DESLOCAMENTO', 'CONTATO_TERCEIRO',
  'DOCUMENTACAO', 'TREINAMENTO', 'TESTE', 'ACOMPANHAMENTO',
] as const;
export type WorklogType = (typeof WORKLOG_TYPES)[number];

export const WORKLOG_TYPE_LABELS: Record<WorklogType, string> = {
  ATENDIMENTO_REMOTO: 'Atendimento remoto',
  ATENDIMENTO_PRESENCIAL: 'Atendimento presencial',
  DIAGNOSTICO: 'Diagnóstico',
  MANUTENCAO: 'Manutenção',
  CONFIGURACAO: 'Configuração',
  DESENVOLVIMENTO: 'Desenvolvimento',
  ANALISE: 'Análise',
  REUNIAO: 'Reunião',
  DESLOCAMENTO: 'Deslocamento',
  CONTATO_TERCEIRO: 'Contato com terceiro',
  DOCUMENTACAO: 'Documentação',
  TREINAMENTO: 'Treinamento',
  TESTE: 'Teste',
  ACOMPANHAMENTO: 'Acompanhamento',
};

// ---------- Projetos ----------
export const PROJECT_STATUSES = [
  'PROPOSTO', 'EM_ANALISE', 'APROVADO', 'PLANEJADO', 'EM_EXECUCAO', 'EM_HOMOLOGACAO', 'BLOQUEADO', 'CONCLUIDO', 'CANCELADO',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PROPOSTO: 'Proposto',
  EM_ANALISE: 'Em análise',
  APROVADO: 'Aprovado',
  PLANEJADO: 'Planejado',
  EM_EXECUCAO: 'Em execução',
  EM_HOMOLOGACAO: 'Em homologação',
  BLOQUEADO: 'Bloqueado',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
};

export const TASK_STATUSES = ['A_FAZER', 'EM_ANDAMENTO', 'BLOQUEADA', 'CONCLUIDA', 'CANCELADA'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  A_FAZER: 'A fazer',
  EM_ANDAMENTO: 'Em andamento',
  BLOQUEADA: 'Bloqueada',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

// ---------- Rotinas ----------
export const ROUTINE_FREQUENCIES = [
  'DIARIA', 'SEMANAL', 'QUINZENAL', 'MENSAL', 'TRIMESTRAL', 'ANUAL', 'PERSONALIZADA',
] as const;
export type RoutineFrequency = (typeof ROUTINE_FREQUENCIES)[number];

export const ROUTINE_FREQUENCY_LABELS: Record<RoutineFrequency, string> = {
  DIARIA: 'Diária',
  SEMANAL: 'Semanal',
  QUINZENAL: 'Quinzenal',
  MENSAL: 'Mensal',
  TRIMESTRAL: 'Trimestral',
  ANUAL: 'Anual',
  PERSONALIZADA: 'Personalizada',
};

export const ROUTINE_EXEC_STATUSES = ['PENDENTE', 'EM_EXECUCAO', 'CONCLUIDA', 'ATRASADA', 'PULADA'] as const;
export type RoutineExecStatus = (typeof ROUTINE_EXEC_STATUSES)[number];

export const ROUTINE_EXEC_STATUS_LABELS: Record<RoutineExecStatus, string> = {
  PENDENTE: 'Pendente',
  EM_EXECUCAO: 'Em execução',
  CONCLUIDA: 'Concluída',
  ATRASADA: 'Atrasada',
  PULADA: 'Pulada (justificada)',
};

export const CRITICALITIES = ['BAIXA', 'MEDIA', 'ALTA'] as const;
export type Criticality = (typeof CRITICALITIES)[number];
export const CRITICALITY_LABELS: Record<Criticality, string> = { BAIXA: 'Baixa', MEDIA: 'Média', ALTA: 'Alta' };

// ---------- Inventário ----------
export const ASSET_STATUSES = [
  'EM_USO', 'DISPONIVEL', 'RESERVA', 'EMPRESTADO', 'EM_MANUTENCAO', 'AGUARDANDO_PECA',
  'EM_TRANSFERENCIA', 'AGUARDANDO_DESCARTE', 'DESCARTADO', 'EXTRAVIADO', 'INATIVO',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  EM_USO: 'Em uso',
  DISPONIVEL: 'Disponível',
  RESERVA: 'Reserva',
  EMPRESTADO: 'Emprestado',
  EM_MANUTENCAO: 'Em manutenção',
  AGUARDANDO_PECA: 'Aguardando peça',
  EM_TRANSFERENCIA: 'Em transferência',
  AGUARDANDO_DESCARTE: 'Aguardando descarte',
  DESCARTADO: 'Descartado',
  EXTRAVIADO: 'Extraviado',
  INATIVO: 'Inativo',
};

export const ASSET_KINDS = ['ATIVO_INDIVIDUAL', 'COMPONENTE', 'CONSUMIVEL', 'KIT'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  ATIVO_INDIVIDUAL: 'Ativo individual',
  COMPONENTE: 'Componente',
  CONSUMIVEL: 'Consumível',
  KIT: 'Kit',
};

export const COMPONENT_STATUSES = ['INSTALADO', 'REMOVIDO', 'ESTOQUE', 'DESCARTADO'] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];
export const COMPONENT_STATUS_LABELS: Record<ComponentStatus, string> = {
  INSTALADO: 'Instalado',
  REMOVIDO: 'Removido',
  ESTOQUE: 'Em estoque',
  DESCARTADO: 'Descartado',
};

export const MOVEMENT_TYPES = [
  'TRANSFERENCIA_UNIDADE', 'TRANSFERENCIA_SETOR', 'TROCA_USUARIO', 'ENVIO_MANUTENCAO', 'RETORNO_MANUTENCAO',
  'EMPRESTIMO', 'DEVOLUCAO', 'ENVIO_DESCARTE', 'RETIRADA_RESERVA', 'RETORNO_RESERVA',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  TRANSFERENCIA_UNIDADE: 'Transferência entre unidades',
  TRANSFERENCIA_SETOR: 'Transferência entre setores',
  TROCA_USUARIO: 'Troca de usuário',
  ENVIO_MANUTENCAO: 'Envio para manutenção',
  RETORNO_MANUTENCAO: 'Retorno de manutenção',
  EMPRESTIMO: 'Empréstimo',
  DEVOLUCAO: 'Devolução',
  ENVIO_DESCARTE: 'Envio para descarte',
  RETIRADA_RESERVA: 'Retirada de reserva',
  RETORNO_RESERVA: 'Retorno à reserva',
};

export const MOVEMENT_STATUSES = [
  'SOLICITADA', 'SEPARADA', 'RETIRADA', 'EM_TRANSPORTE', 'RECEBIDA', 'CONFIRMADA', 'CANCELADA', 'RETORNADA',
] as const;
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number];

export const MOVEMENT_STATUS_LABELS: Record<MovementStatus, string> = {
  SOLICITADA: 'Solicitada',
  SEPARADA: 'Separada',
  RETIRADA: 'Retirada',
  EM_TRANSPORTE: 'Em transporte',
  RECEBIDA: 'Recebida',
  CONFIRMADA: 'Confirmada',
  CANCELADA: 'Cancelada',
  RETORNADA: 'Retornada',
};

export const MOVEMENT_STATUS_TRANSITIONS: Record<MovementStatus, MovementStatus[]> = {
  SOLICITADA: ['SEPARADA', 'RETIRADA', 'CANCELADA'],
  SEPARADA: ['RETIRADA', 'CANCELADA'],
  RETIRADA: ['EM_TRANSPORTE', 'RECEBIDA', 'CANCELADA'],
  EM_TRANSPORTE: ['RECEBIDA', 'RETORNADA'],
  RECEBIDA: ['CONFIRMADA', 'RETORNADA'],
  CONFIRMADA: [],
  CANCELADA: [],
  RETORNADA: [],
};

export const MAINTENANCE_TYPES = [
  'PREVENTIVA', 'CORRETIVA', 'LIMPEZA', 'INSPECAO', 'ATUALIZACAO', 'SUBSTITUICAO', 'CONFIGURACAO', 'REVISAO', 'TESTE', 'INSTALACAO',
] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];

export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  PREVENTIVA: 'Preventiva',
  CORRETIVA: 'Corretiva',
  LIMPEZA: 'Limpeza',
  INSPECAO: 'Inspeção',
  ATUALIZACAO: 'Atualização',
  SUBSTITUICAO: 'Substituição',
  CONFIGURACAO: 'Configuração',
  REVISAO: 'Revisão',
  TESTE: 'Teste',
  INSTALACAO: 'Instalação',
};

// ---------- SLA ----------
export const SLA_MODES = ['CORRIDO', 'COMERCIAL'] as const;
export type SlaMode = (typeof SLA_MODES)[number];
export const SLA_MODE_LABELS: Record<SlaMode, string> = { CORRIDO: 'Tempo corrido', COMERCIAL: 'Horário comercial' };

// ---------- Eventos de chamado ----------
export const TICKET_EVENT_TYPES = [
  'CRIACAO', 'STATUS', 'PRIORIDADE', 'ATRIBUICAO', 'FILA', 'PRIMEIRA_RESPOSTA', 'RESOLUCAO',
  'REABERTURA', 'FECHAMENTO', 'CANCELAMENTO', 'VINCULO', 'SLA', 'INTERRUPCAO', 'EDICAO',
] as const;
export type TicketEventType = (typeof TICKET_EVENT_TYPES)[number];

export const TICKET_EVENT_LABELS: Record<TicketEventType, string> = {
  CRIACAO: 'Criação',
  STATUS: 'Mudança de status',
  PRIORIDADE: 'Alteração de prioridade',
  ATRIBUICAO: 'Atribuição',
  FILA: 'Mudança de fila',
  PRIMEIRA_RESPOSTA: 'Primeira resposta',
  RESOLUCAO: 'Resolução',
  REABERTURA: 'Reabertura',
  FECHAMENTO: 'Fechamento',
  CANCELAMENTO: 'Cancelamento',
  VINCULO: 'Vínculo',
  SLA: 'SLA',
  INTERRUPCAO: 'Interrupção',
  EDICAO: 'Edição',
};

// ---------- Config padrão ----------
export const DEFAULT_SETTINGS = {
  appName: 'Gestão TI — Tia Eliana',
  autoCloseHours: 48,
  wipLimit: 2,
  timezone: 'America/Sao_Paulo',
} as const;

// ---------- Helpers ----------
export function formatMinutes(min: number | null | undefined): string {
  if (min == null || isNaN(min)) return '—';
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.round(Math.abs(min) % 60);
  const sign = min < 0 ? '-' : '';
  if (h === 0) return `${sign}${m}min`;
  return `${sign}${h}h${m > 0 ? ` ${m}min` : ''}`;
}

export function ticketNumberFor(year: number, seq: number): string {
  return `TI-${year}-${String(seq).padStart(6, '0')}`;
}

export function assetCodeFor(year: number, seq: number): string {
  return `ATI-${year}-${String(seq).padStart(6, '0')}`;
}

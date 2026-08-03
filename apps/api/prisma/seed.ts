/**
 * Seed do Gestão TI — Tia Eliana.
 * Cria estrutura, usuários (senha padrão: Mudar@123), catálogo, SLA,
 * chamados, projetos, rotinas, inventário e movimentações fictícias
 * demonstrando todos os estados importantes do sistema.
 *
 * Idempotência: se já houver organização criada, o seed é abortado.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { nextTicketNumber, nextAssetCode, generatePublicId } from '../src/lib/numbers.js';

const prisma = new PrismaClient();
const SENHA_PADRAO = 'Mudar@123';

function ago(hours: number): Date {
  return new Date(Date.now() - hours * 3600_000);
}
function ahead(hours: number): Date {
  return new Date(Date.now() + hours * 3600_000);
}

async function main() {
  const existing = await prisma.organization.findFirst();
  if (existing) {
    console.log('Seed já executado (organização existente). Abortando sem alterações.');
    return;
  }
  const hash = await bcrypt.hash(SENHA_PADRAO, 10);

  // ---------- Estrutura ----------
  const org = await prisma.organization.create({ data: { name: 'Tia Eliana', tradeName: 'Tia Eliana Alimentos' } });
  const [escritorio, industria, lojaSM, lojaBH, logisticaBH] = await Promise.all([
    prisma.unit.create({ data: { organizationId: org.id, name: 'Escritório', code: 'ESC' } }),
    prisma.unit.create({ data: { organizationId: org.id, name: 'Indústria', code: 'IND' } }),
    prisma.unit.create({ data: { organizationId: org.id, name: 'Loja Santa Maria', code: 'LSM' } }),
    prisma.unit.create({ data: { organizationId: org.id, name: 'Loja BH', code: 'LBH' } }),
    prisma.unit.create({ data: { organizationId: org.id, name: 'Logística BH', code: 'LOG' } }),
  ]);
  const [ti, comercial, televendas, expedicao, fiscal] = await Promise.all([
    prisma.department.create({ data: { name: 'TI', unitId: escritorio.id } }),
    prisma.department.create({ data: { name: 'Comercial', unitId: escritorio.id } }),
    prisma.department.create({ data: { name: 'Televendas', unitId: escritorio.id } }),
    prisma.department.create({ data: { name: 'Expedição', unitId: logisticaBH.id } }),
    prisma.department.create({ data: { name: 'Fiscal', unitId: escritorio.id } }),
  ]);

  // ---------- Usuários ----------
  const mk = (name: string, email: string, role: string, unitId: string, departmentId?: string, isProtected = false) =>
    prisma.user.create({
      data: { name, email, passwordHash: hash, role: role as never, unitId, departmentId: departmentId ?? null, isProtected },
    });

  const diretoria = await mk('Maria Diretora', 'diretoria@tiaeliana.com.br', 'OWNER', escritorio.id, undefined, true);
  const admin = await mk('Alberto Admin', 'admin@tiaeliana.com.br', 'ADMIN', escritorio.id, ti.id);
  const gestorTi = await mk('Fábio Gestor', 'gestor.ti@tiaeliana.com.br', 'GESTOR_TI', escritorio.id, ti.id);
  const tecnico1 = await mk('Rafael Técnico', 'tecnico1@tiaeliana.com.br', 'TECNICO', escritorio.id, ti.id);
  const tecnico2 = await mk('Felipe Técnico', 'tecnico2@tiaeliana.com.br', 'TECNICO', industria.id, ti.id);
  const solicitante = await mk('Renata Solicitante', 'solicitante@tiaeliana.com.br', 'SOLICITANTE', lojaSM.id);
  const gestorSetor = await mk('Gisele Gestora Comercial', 'gestor.setor@tiaeliana.com.br', 'GESTOR_SETOR', escritorio.id, comercial.id);
  const auditor = await mk('Augusto Auditor', 'auditor@tiaeliana.com.br', 'AUDITOR', escritorio.id);
  const inventariante = await mk('Ivan Inventariante', 'inventariante@tiaeliana.com.br', 'INVENTARIANTE', industria.id, ti.id);
  const qrUser = await prisma.user.create({
    data: { name: 'Portal QR Code', email: 'qr@gestao-ti.local', passwordHash: await bcrypt.hash(generatePublicId(24), 10), role: 'SOLICITANTE', active: true },
  });

  // ---------- Filas ----------
  const [filaSuporte, filaDev, filaInfra] = await Promise.all([
    prisma.queue.create({ data: { name: 'Suporte N1', description: 'Atendimento geral e lojas' } }),
    prisma.queue.create({ data: { name: 'Desenvolvimento', description: 'Relatórios, integrações e sistemas' } }),
    prisma.queue.create({ data: { name: 'Infraestrutura', description: 'Rede, servidores e equipamentos' } }),
  ]);

  // ---------- SLA ----------
  const slaPadrao = await prisma.slaPolicy.create({
    data: {
      name: 'SLA Padrão (horário comercial)', mode: 'COMERCIAL', businessStart: '08:00', businessEnd: '18:00',
      workdays: '1,2,3,4,5,6',
      firstResponseP1: 10, firstResponseP2: 30, firstResponseP3: 240, firstResponseP4: 600,
      resolutionP1: 240, resolutionP2: 480, resolutionP3: 2400, resolutionP4: 12000,
      isDefault: true,
    },
  });
  const slaCritico = await prisma.slaPolicy.create({
    data: {
      name: 'SLA Crítico Lojas (tempo corrido)', mode: 'CORRIDO',
      firstResponseP1: 10, firstResponseP2: 30, firstResponseP3: 240, firstResponseP4: 600,
      resolutionP1: 120, resolutionP2: 360, resolutionP3: 1440, resolutionP4: 7200,
    },
  });

  // ---------- Categorias de chamado ----------
  const cat = (name: string, extra: Record<string, unknown> = {}) =>
    prisma.category.create({ data: { name, slaPolicyId: slaPadrao.id, defaultQueueId: filaSuporte.id, ...extra } as never });

  const catAcesso = await cat('Acesso e permissões');
  const catSenha = await cat('Usuário e senha');
  const catComputador = await cat('Computador / Notebook');
  const catImpressora = await cat('Impressora', {
    formSchema: [
      { id: 'qual_impressora', label: 'Qual impressora?', type: 'text', required: true },
      { id: 'imprime_branco', label: 'Imprime em branco?', type: 'boolean' },
      { id: 'offline', label: 'Está offline?', type: 'boolean' },
      { id: 'erro', label: 'Mensagem de erro apresentada', type: 'text' },
      { id: 'alternativa', label: 'Existe outra impressora disponível?', type: 'boolean' },
      { id: 'afetados', label: 'Quantas pessoas foram afetadas?', type: 'number' },
    ],
  });
  const catRede = await cat('Rede / Internet / Wi-Fi', { defaultQueueId: filaInfra.id });
  const catErp = await cat('ERP (Linear)');
  const catPdv = await cat('PDV', {
    slaPolicyId: slaCritico.id,
    formSchema: [
      { id: 'qual_loja', label: 'Qual loja?', type: 'select', options: ['Loja Santa Maria', 'Loja BH'], required: true },
      { id: 'qual_caixa', label: 'Qual caixa?', type: 'text' },
      { id: 'todos_pdvs', label: 'Apenas um PDV ou todos?', type: 'select', options: ['Apenas um', 'Todos'] },
      { id: 'internet_ok', label: 'A internet funciona?', type: 'boolean' },
      { id: 'tef_ok', label: 'O TEF funciona?', type: 'boolean' },
      { id: 'mensagem', label: 'Mensagem apresentada na tela', type: 'text' },
      { id: 'alternativa_venda', label: 'Existe alternativa de venda?', type: 'boolean' },
    ],
  });
  const catTef = await cat('TEF / Pagamentos', { slaPolicyId: slaCritico.id });
  const catEmail = await cat('E-mail');
  const catEtiqueta = await cat('Etiquetas e cadastro de produto');
  const catRelatorio = await cat('Relatórios e consultas', { defaultQueueId: filaDev.id });
  const catDev = await cat('Desenvolvimento / Automação', { defaultQueueId: filaDev.id });
  const catMovimentacao = await cat('Movimentação de equipamento');
  const catEquipamento = await cat('Equipamento com problema');
  const catBackup = await cat('Backup / Servidor', { defaultQueueId: filaInfra.id });
  await cat('Outro');

  await prisma.subcategory.createMany({
    data: [
      { categoryId: catErp.id, name: 'Erro no sistema' },
      { categoryId: catErp.id, name: 'Cadastro / liberação' },
      { categoryId: catErp.id, name: 'Integração' },
      { categoryId: catComputador.id, name: 'Lentidão' },
      { categoryId: catComputador.id, name: 'Não liga' },
      { categoryId: catRede.id, name: 'Sem internet' },
      { categoryId: catRede.id, name: 'Wi-Fi instável' },
    ],
  });

  // ---------- Terceiros ----------
  const [linear, conect, catracaForn, provedor] = await Promise.all([
    prisma.thirdParty.create({ data: { name: 'Linear Sistemas', serviceType: 'ERP', contactName: 'Suporte Linear', email: 'suporte@linearsistemas.com.br', phone: '(31) 3000-0001', slaInfo: 'Atendimento 8h-18h úteis', systems: 'ERP, PDV, retaguarda' } }),
    prisma.thirdParty.create({ data: { name: 'Conect TEF', serviceType: 'TEF / Pagamentos', phone: '(11) 4000-0002', serviceHours: '24/7 para lojas' } }),
    prisma.thirdParty.create({ data: { name: 'CatrakFort', serviceType: 'Catracas e acesso', phone: '(31) 3000-0003' } }),
    prisma.thirdParty.create({ data: { name: 'NetVale Telecom', serviceType: 'Internet / Link dedicado', phone: '0800 000 0004', serviceHours: '24/7' } }),
  ]);

  // ---------- Categorias de ativos ----------
  const assetCatNames = ['Computador', 'Notebook', 'Monitor', 'Impressora', 'Servidor', 'Roteador', 'Switch', 'Access Point', 'Nobreak', 'Tablet', 'Celular', 'Coletor', 'Equipamento de PDV', 'Leitor', 'Catraca', 'Câmera', 'Gravador', 'Periférico', 'Outro'];
  const assetCats: Record<string, string> = {};
  for (const name of assetCatNames) {
    const c = await prisma.assetCategory.create({ data: { name } });
    assetCats[name] = c.id;
  }

  // ---------- Ativos ----------
  async function mkAsset(data: {
    category: string; description: string; unitId?: string; departmentId?: string;
    status?: string; kind?: string; brand?: string; model?: string; serialNumber?: string;
    userId?: string; patrimonyCode?: string; location?: string; hostname?: string; ip?: string;
    warrantyEnd?: Date; purchaseValue?: number; quantity?: number; minStock?: number;
    nextMaintenanceAt?: Date; criticality?: string; supplierId?: string; notes?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const code = await nextAssetCode(tx);
      return tx.asset.create({
        data: {
          code,
          publicId: generatePublicId(),
          categoryId: assetCats[data.category],
          description: data.description,
          unitId: data.unitId ?? null,
          departmentId: data.departmentId ?? null,
          status: (data.status ?? 'EM_USO') as never,
          kind: (data.kind ?? 'ATIVO_INDIVIDUAL') as never,
          brand: data.brand, model: data.model, serialNumber: data.serialNumber,
          userId: data.userId ?? null,
          patrimonyCode: data.patrimonyCode, location: data.location,
          hostname: data.hostname, ip: data.ip,
          warrantyEnd: data.warrantyEnd, purchaseValue: data.purchaseValue,
          quantity: data.quantity ?? 1, minStock: data.minStock,
          nextMaintenanceAt: data.nextMaintenanceAt,
          criticality: (data.criticality ?? 'MEDIA') as never,
          supplierId: data.supplierId ?? null,
          notes: data.notes,
          createdById: inventariante.id,
        },
      });
    });
  }

  const pcCorredor = await mkAsset({
    category: 'Computador', description: 'Computador do corredor da produção', unitId: industria.id,
    brand: 'Dell', model: 'OptiPlex 3090', serialNumber: 'DL3090-4451', patrimonyCode: 'TE-0101',
    hostname: 'IND-CORREDOR01', ip: '192.168.10.45', status: 'EM_USO', criticality: 'ALTA',
    nextMaintenanceAt: ago(72), notes: 'Acumula muita farinha — limpeza quinzenal obrigatória',
  });
  const pcRenata = await mkAsset({
    category: 'Computador', description: 'Computador do caixa 1 — Loja Santa Maria', unitId: lojaSM.id,
    brand: 'Lenovo', model: 'ThinkCentre M70', serialNumber: 'LN-M70-8812', patrimonyCode: 'TE-0102',
    hostname: 'LSM-CAIXA01', userId: solicitante.id, criticality: 'ALTA',
  });
  const impressoraLog = await mkAsset({
    category: 'Impressora', description: 'Impressora térmica Argox 420 — Logística BH', unitId: logisticaBH.id,
    departmentId: expedicao.id, brand: 'Argox', model: 'OS-2140', serialNumber: 'AGX-2140-021', patrimonyCode: 'TE-0103',
    status: 'EM_MANUTENCAO', criticality: 'ALTA',
  });
  const pdvSM = await mkAsset({
    category: 'Equipamento de PDV', description: 'PDV 02 — Loja Santa Maria', unitId: lojaSM.id,
    brand: 'Bematech', model: 'SB-9090', serialNumber: 'BM-9090-777', patrimonyCode: 'TE-0104', criticality: 'ALTA',
  });
  const roteadorBH = await mkAsset({
    category: 'Roteador', description: 'Roteador principal — Loja BH', unitId: lojaBH.id,
    brand: 'MikroTik', model: 'RB4011', serialNumber: 'MT-4011-303', patrimonyCode: 'TE-0105',
    ip: '192.168.20.1', criticality: 'ALTA', warrantyEnd: ahead(20 * 24),
  });
  const nobreakInd = await mkAsset({
    category: 'Nobreak', description: 'Nobreak do rack — Indústria', unitId: industria.id,
    brand: 'SMS', model: 'Manager III 2200', serialNumber: 'SMS-2200-115', patrimonyCode: 'TE-0106',
    nextMaintenanceAt: ahead(30 * 24), criticality: 'ALTA',
  });
  const monitorReserva = await mkAsset({
    category: 'Monitor', description: 'Monitor 22" — reserva', unitId: escritorio.id,
    brand: 'AOC', model: '22B1H', serialNumber: 'AOC-22-556', status: 'RESERVA', location: 'Sala do rack — bancada',
  });
  const notebookReserva = await mkAsset({
    category: 'Notebook', description: 'Notebook reserva — sala de reunião', unitId: escritorio.id,
    brand: 'Acer', model: 'Aspire 5', serialNumber: 'AC-A5-901', status: 'RESERVA',
    warrantyEnd: ahead(200 * 24), location: 'Sala de reunião',
  });
  await mkAsset({
    category: 'Periférico', description: 'Kit teclado + mouse USB', unitId: escritorio.id,
    kind: 'KIT', status: 'DISPONIVEL', quantity: 6, minStock: 2, location: 'Armário TI',
    notes: 'Kits sem patrimônio individual — controle por quantidade',
  });
  await mkAsset({
    category: 'Servidor', description: 'Servidor de arquivos + NAS', unitId: escritorio.id,
    brand: 'Dell', model: 'PowerEdge T150', serialNumber: 'DL-T150-001', patrimonyCode: 'TE-0100',
    hostname: 'SRV-ARQUIVOS', ip: '192.168.1.10', criticality: 'ALTA', nextMaintenanceAt: ahead(15 * 24),
  });
  const impressoraSM = await mkAsset({
    category: 'Impressora', description: 'Impressora fiscal — Loja Santa Maria', unitId: lojaSM.id,
    brand: 'Epson', model: 'TM-T20X', serialNumber: 'EP-T20-431', patrimonyCode: 'TE-0107', criticality: 'ALTA',
  });
  await mkAsset({
    category: 'Catraca', description: 'Catraca de acesso — Indústria', unitId: industria.id,
    brand: 'CatrakFort', model: 'CF-300', serialNumber: 'CF300-071', patrimonyCode: 'TE-0108',
    supplierId: catracaForn.id, criticality: 'MEDIA',
  });

  // Componentes do computador do corredor
  await prisma.assetComponent.createMany({
    data: [
      { assetId: pcCorredor.id, type: 'Memória RAM', brand: 'Kingston', model: 'DDR4 2666', capacity: '8GB', status: 'INSTALADO', installedAt: ago(24 * 200) },
      { assetId: pcCorredor.id, type: 'SSD', brand: 'Kingston', model: 'A400', capacity: '240GB', status: 'INSTALADO', installedAt: ago(24 * 90), warrantyEnd: ahead(24 * 300) },
      { assetId: pcCorredor.id, type: 'Fonte', brand: 'Dell', model: 'Original 260W', status: 'REMOVIDO', installedAt: ago(24 * 700), removedAt: ago(24 * 90), notes: 'Substituída por queima — resíduo de farinha' },
      { assetId: pcCorredor.id, type: 'Fonte', brand: 'C3Tech', model: 'PS-200V4', status: 'INSTALADO', installedAt: ago(24 * 90) },
    ],
  });

  // ---------- Chamados ----------
  async function mkTicket(data: {
    title: string; description: string; requesterId: string; categoryId: string; subcategoryId?: string;
    unitId?: string; departmentId?: string; channel?: string; impact: string; urgency: string; priority: string;
    status?: string; assigneeId?: string; queueId?: string; assetId?: string; projectId?: string;
    thirdPartyId?: string; externalTicketNumber?: string; openedAt: Date; slaPolicyId?: string;
    firstResponseAt?: Date; startedAt?: Date; resolvedAt?: Date; closedAt?: Date; resolutionNotes?: string;
    reopenedCount?: number; rating?: number; formResponses?: Record<string, unknown>; tags?: string[];
    infoOwnerArea?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const number = await nextTicketNumber(tx, data.openedAt);
      const policyId = data.slaPolicyId ?? slaPadrao.id;
      const policy = policyId === slaCritico.id ? slaCritico : slaPadrao;
      const frMin = { P1: policy.firstResponseP1, P2: policy.firstResponseP2, P3: policy.firstResponseP3, P4: policy.firstResponseP4 }[data.priority] ?? 240;
      const resMin = { P1: policy.resolutionP1, P2: policy.resolutionP2, P3: policy.resolutionP3, P4: policy.resolutionP4 }[data.priority] ?? 2400;
      const t = await tx.ticket.create({
        data: {
          number,
          title: data.title,
          description: data.description,
          requesterId: data.requesterId,
          categoryId: data.categoryId,
          subcategoryId: data.subcategoryId ?? null,
          unitId: data.unitId ?? null,
          departmentId: data.departmentId ?? null,
          channel: (data.channel ?? 'PORTAL') as never,
          impact: data.impact as never,
          urgency: data.urgency as never,
          calculatedPriority: data.priority as never,
          priority: data.priority as never,
          status: (data.status ?? 'NOVO') as never,
          assigneeId: data.assigneeId ?? null,
          assignedAt: data.assigneeId ? data.openedAt : null,
          queueId: data.queueId ?? filaSuporte.id,
          assetId: data.assetId ?? null,
          projectId: data.projectId ?? null,
          thirdPartyId: data.thirdPartyId ?? null,
          externalTicketNumber: data.externalTicketNumber,
          openedAt: data.openedAt,
          slaPolicyId: policyId,
          firstResponseDueAt: new Date(data.openedAt.getTime() + frMin * 60_000),
          resolutionDueAt: new Date(data.openedAt.getTime() + resMin * 60_000),
          firstResponseAt: data.firstResponseAt ?? null,
          startedAt: data.startedAt ?? null,
          resolvedAt: data.resolvedAt ?? null,
          closedAt: data.closedAt ?? null,
          resolutionNotes: data.resolutionNotes,
          reopenedCount: data.reopenedCount ?? 0,
          rating: data.rating ?? null,
          formResponses: (data.formResponses ?? undefined) as never,
          tags: data.tags ?? [],
          infoOwnerArea: data.infoOwnerArea,
          createdAt: data.openedAt,
        },
      });
      await tx.ticketEvent.create({
        data: { ticketId: t.id, userId: data.requesterId, type: 'CRIACAO', toValue: 'NOVO', createdAt: data.openedAt },
      });
      return t;
    });
  }

  // 1. Impressora parada — em atendimento (Felipe)
  const chImpressora = await mkTicket({
    title: 'Impressora da logística não imprime etiquetas',
    description: 'A Argox 420 da expedição parou de imprimir. Fica piscando a luz vermelha. Os pedidos estão saindo sem etiqueta.',
    requesterId: gestorSetor.id, categoryId: catImpressora.id, unitId: logisticaBH.id, departmentId: expedicao.id,
    channel: 'WHATSAPP', impact: 'UM_SETOR', urgency: 'ATIVIDADE_BLOQUEADA', priority: 'P2',
    status: 'EM_ATENDIMENTO', assigneeId: tecnico2.id, assetId: impressoraLog.id,
    openedAt: ago(5), firstResponseAt: ago(4.6), startedAt: ago(4),
    formResponses: { qual_impressora: 'Argox da expedição', offline: false, erro: 'Luz vermelha piscando', alternativa: false, afetados: 4 },
  });
  await prisma.ticketEvent.createMany({
    data: [
      { ticketId: chImpressora.id, userId: gestorTi.id, type: 'ATRIBUICAO', toValue: 'Felipe Técnico', createdAt: ago(4.5) },
      { ticketId: chImpressora.id, userId: tecnico2.id, type: 'STATUS', fromValue: 'ATRIBUIDO', toValue: 'EM_ATENDIMENTO', createdAt: ago(4) },
    ],
  });
  await prisma.ticketComment.createMany({
    data: [
      { ticketId: chImpressora.id, authorId: tecnico2.id, body: 'Recebido. Estou indo até a expedição verificar.', isInternal: false, createdAt: ago(4.6) },
      { ticketId: chImpressora.id, authorId: tecnico2.id, body: 'Sensor de etiqueta sujo. Vou levar para limpeza na bancada.', isInternal: true, createdAt: ago(3.5) },
    ],
  });
  await prisma.worklog.create({
    data: { userId: tecnico2.id, ticketId: chImpressora.id, type: 'DIAGNOSTICO', description: 'Verificação no local — sensor de etiqueta sujo', startedAt: ago(4), endedAt: ago(3.4), durationMinutes: 36 },
  });
  await prisma.worklog.create({
    data: { userId: tecnico2.id, ticketId: chImpressora.id, type: 'MANUTENCAO', description: 'Limpeza do sensor e teste de impressão', startedAt: ago(1), endedAt: null },
  });

  // 2. PDV sem comunicação — P1 resolvido (aguardando confirmação)
  const chPdv = await mkTicket({
    title: 'PDV 02 sem comunicação com o servidor',
    description: 'O caixa 02 não passa venda. Mensagem: "sem comunicação com retaguarda". Cliente na fila.',
    requesterId: solicitante.id, categoryId: catPdv.id, unitId: lojaSM.id,
    channel: 'TELEFONE', impact: 'UM_SETOR', urgency: 'OPERACAO_PARADA', priority: 'P1',
    status: 'RESOLVIDO', assigneeId: tecnico1.id, assetId: pdvSM.id, slaPolicyId: slaCritico.id,
    openedAt: ago(26), firstResponseAt: ago(25.9), startedAt: ago(25.8), resolvedAt: ago(24),
    resolutionNotes: 'Cabo de rede do PDV estava mal encaixado no switch. Reconectado e venda testada com sucesso.',
    formResponses: { qual_loja: 'Loja Santa Maria', qual_caixa: '02', todos_pdvs: 'Apenas um', internet_ok: true, tef_ok: true, mensagem: 'Sem comunicação com retaguarda', alternativa_venda: true },
  });
  await prisma.ticketEvent.createMany({
    data: [
      { ticketId: chPdv.id, userId: gestorTi.id, type: 'ATRIBUICAO', toValue: 'Rafael Técnico', createdAt: ago(25.95) },
      { ticketId: chPdv.id, userId: tecnico1.id, type: 'PRIMEIRA_RESPOSTA', createdAt: ago(25.9) },
      { ticketId: chPdv.id, userId: tecnico1.id, type: 'STATUS', fromValue: 'ATRIBUIDO', toValue: 'EM_ATENDIMENTO', createdAt: ago(25.8) },
      { ticketId: chPdv.id, userId: tecnico1.id, type: 'RESOLUCAO', fromValue: 'EM_ATENDIMENTO', toValue: 'RESOLVIDO', createdAt: ago(24) },
    ],
  });
  await prisma.ticketComment.create({
    data: { ticketId: chPdv.id, authorId: tecnico1.id, body: 'Acessando remotamente o PDV agora. Se não resolver em 10 min, vou até a loja.', isInternal: false, createdAt: ago(25.9) },
  });
  await prisma.worklog.create({
    data: { userId: tecnico1.id, ticketId: chPdv.id, type: 'ATENDIMENTO_REMOTO', description: 'Diagnóstico remoto + orientação para reconectar cabo', startedAt: ago(25.8), endedAt: ago(24), durationMinutes: 108, result: 'PDV voltou a operar' },
  });

  // 3. Alteração de acesso — novo
  await mkTicket({
    title: 'Liberar acesso da nova vendedora ao módulo de pedidos',
    description: 'Contratamos a Juliana para o televendas. Precisa de usuário no ERP com perfil de vendas.',
    requesterId: gestorSetor.id, categoryId: catAcesso.id, unitId: escritorio.id, departmentId: televendas.id,
    channel: 'PORTAL', impact: 'UMA_PESSOA', urgency: 'PARCIALMENTE_PREJUDICADA', priority: 'P3',
    status: 'NOVO', openedAt: ago(2), infoOwnerArea: 'Comercial define o perfil de acesso',
  });

  // 4. Integração com erro — aguardando terceiro (Linear)
  const chIntegracao = await mkTicket({
    title: 'Integração de vendas do e-commerce com erro desde ontem',
    description: 'As vendas do site não estão baixando estoque no ERP. Erro de timeout no conector.',
    requesterId: gestorSetor.id, categoryId: catErp.id, unitId: escritorio.id, departmentId: comercial.id,
    channel: 'EMAIL', impact: 'UM_SETOR', urgency: 'PARCIALMENTE_PREJUDICADA', priority: 'P3',
    status: 'AGUARDANDO_TERCEIRO', assigneeId: tecnico1.id, queueId: filaDev.id,
    thirdPartyId: linear.id, externalTicketNumber: 'LIN-88412',
    openedAt: ago(30), firstResponseAt: ago(29), startedAt: ago(28),
  });
  await prisma.ticket.update({ where: { id: chIntegracao.id }, data: { slaPausedAt: ago(20), vendorForecastAt: ahead(24), vendorLastReplyAt: ago(6) } });
  await prisma.ticketEvent.createMany({
    data: [
      { ticketId: chIntegracao.id, userId: tecnico1.id, type: 'STATUS', fromValue: 'EM_ATENDIMENTO', toValue: 'AGUARDANDO_TERCEIRO', comment: 'Ticket aberto na Linear: LIN-88412', createdAt: ago(20) },
    ],
  });
  await prisma.worklog.create({
    data: { userId: tecnico1.id, ticketId: chIntegracao.id, type: 'CONTATO_TERCEIRO', description: 'Abertura e acompanhamento do ticket na Linear', startedAt: ago(21), endedAt: ago(20), durationMinutes: 60 },
  });

  // 5. Relatório solicitado — planejado, atribuído
  await mkTicket({
    title: 'Relatório de vendas por curva ABC para o comercial',
    description: 'Gisele precisa de um relatório mensal de curva ABC por loja para reunião de compras.',
    requesterId: gestorSetor.id, categoryId: catRelatorio.id, unitId: escritorio.id, departmentId: comercial.id,
    channel: 'PRESENCIAL', impact: 'ALGUMAS_PESSOAS', urgency: 'EXISTE_ALTERNATIVA', priority: 'P4',
    status: 'ATRIBUIDO', assigneeId: tecnico1.id, queueId: filaDev.id,
    openedAt: ago(50), infoOwnerArea: 'Comercial define os critérios do relatório',
  });

  // 6. Computador lento — aguardando solicitante
  const chLento = await mkTicket({
    title: 'Computador do caixa 1 muito lento',
    description: 'Demora para abrir o sistema e trava durante a venda.',
    requesterId: solicitante.id, categoryId: catComputador.id, unitId: lojaSM.id,
    channel: 'WHATSAPP', impact: 'UMA_PESSOA', urgency: 'PARCIALMENTE_PREJUDICADA', priority: 'P3',
    status: 'AGUARDANDO_SOLICITANTE', assigneeId: tecnico1.id, assetId: pcRenata.id,
    openedAt: ago(72), firstResponseAt: ago(70), startedAt: ago(69),
  });
  await prisma.ticket.update({ where: { id: chLento.id }, data: { slaPausedAt: ago(48), returnForecast: ahead(24) } });
  await prisma.ticketComment.create({
    data: { ticketId: chLento.id, authorId: tecnico1.id, body: 'Renata, fiz uma limpeza remota. Consegue testar hoje e me confirmar se melhorou?', isInternal: false, createdAt: ago(48) },
  });

  // 7. Chamado fechado com avaliação (histórico completo)
  await mkTicket({
    title: 'Trocar toner da impressora do escritório',
    description: 'Impressora do financeiro sem toner.',
    requesterId: gestorSetor.id, categoryId: catImpressora.id, unitId: escritorio.id, departmentId: fiscal.id,
    channel: 'PORTAL', impact: 'ALGUMAS_PESSOAS', urgency: 'EXISTE_ALTERNATIVA', priority: 'P4',
    status: 'FECHADO', assigneeId: tecnico1.id,
    openedAt: ago(24 * 7), firstResponseAt: ago(24 * 7 - 2), startedAt: ago(24 * 7 - 3),
    resolvedAt: ago(24 * 6), closedAt: ago(24 * 4),
    resolutionNotes: 'Toner substituído. Deixado um reserva no armário do financeiro.',
    rating: 5,
  });

  // 8. Chamado reaberto
  const chReaberto = await mkTicket({
    title: 'Wi-Fi da loja BH caindo toda tarde',
    description: 'Entre 14h e 16h o Wi-Fi fica instável e o coletor perde conexão.',
    requesterId: solicitante.id, categoryId: catRede.id, unitId: lojaBH.id,
    channel: 'PORTAL', impact: 'UM_SETOR', urgency: 'PARCIALMENTE_PREJUDICADA', priority: 'P3',
    status: 'EM_ATENDIMENTO', assigneeId: tecnico2.id, assetId: roteadorBH.id, queueId: filaInfra.id,
    openedAt: ago(24 * 5), firstResponseAt: ago(24 * 5 - 1), startedAt: ago(24 * 5 - 2),
    reopenedCount: 1,
  });
  await prisma.ticketEvent.createMany({
    data: [
      { ticketId: chReaberto.id, userId: tecnico2.id, type: 'RESOLUCAO', fromValue: 'EM_ATENDIMENTO', toValue: 'RESOLVIDO', createdAt: ago(24 * 3) },
      { ticketId: chReaberto.id, userId: solicitante.id, type: 'REABERTURA', fromValue: 'RESOLVIDO', toValue: 'EM_ATENDIMENTO', justification: 'Voltou a cair hoje às 15h', createdAt: ago(24 * 2) },
    ],
  });

  // 9. Chamado cancelado (exemplo de estado)
  const chCancelado = await mkTicket({
    title: 'Instalar segunda tela no televendas',
    description: 'Pedido de segunda tela para as meninas do televendas.',
    requesterId: gestorSetor.id, categoryId: catEquipamento.id, unitId: escritorio.id, departmentId: televendas.id,
    channel: 'PRESENCIAL', impact: 'ALGUMAS_PESSOAS', urgency: 'EXISTE_ALTERNATIVA', priority: 'P4',
    status: 'CANCELADO', openedAt: ago(24 * 10),
  });
  await prisma.ticket.update({ where: { id: chCancelado.id }, data: { cancelReason: 'Virou o projeto "Telas duplas no televendas" — tratado como projeto, não chamado.' } });

  // ---------- Projetos ----------
  const projCrm = await prisma.project.create({
    data: {
      name: 'CRM de atendimento ao cliente', objective: 'Centralizar o atendimento de WhatsApp das lojas e televendas',
      justification: 'Hoje o atendimento é disperso em números pessoais; sem métricas.',
      status: 'EM_EXECUCAO', priority: 'P2', ownerId: tecnico1.id, requesterId: diretoria.id, sponsorId: diretoria.id,
      startDate: ago(24 * 40), dueDate: ahead(24 * 30), percentComplete: 55, estimatedHours: 200,
      infoOwnerArea: 'Comercial define regras de atendimento; TI executa',
    },
  });
  await prisma.projectMember.createMany({
    data: [
      { projectId: projCrm.id, userId: tecnico1.id, roleInProject: 'Desenvolvedor' },
      { projectId: projCrm.id, userId: gestorTi.id, roleInProject: 'Acompanhamento' },
    ],
  });
  const taskCrm1 = await prisma.projectTask.create({
    data: { projectId: projCrm.id, title: 'Integração com API do WhatsApp', status: 'EM_ANDAMENTO', assigneeId: tecnico1.id, dueDate: ahead(24 * 7), estimatedHours: 40, sortOrder: 1 },
  });
  await prisma.projectTask.createMany({
    data: [
      { projectId: projCrm.id, title: 'Tela de fila de atendimento', status: 'CONCLUIDA', assigneeId: tecnico1.id, sortOrder: 2 },
      { projectId: projCrm.id, title: 'Relatório de atendimentos por vendedora', status: 'A_FAZER', assigneeId: tecnico1.id, dueDate: ahead(24 * 14), sortOrder: 3 },
      { projectId: projCrm.id, title: 'Homologação com o televendas', status: 'A_FAZER', dueDate: ahead(24 * 21), sortOrder: 4 },
    ],
  });
  await prisma.worklog.create({
    data: { userId: tecnico1.id, taskId: taskCrm1.id, type: 'DESENVOLVIMENTO', description: 'Implementação do webhook de mensagens', startedAt: ago(30), endedAt: ago(26), durationMinutes: 240 },
  });

  const projEtiquetas = await prisma.project.create({
    data: {
      name: 'Sistema de etiquetas de produtos', objective: 'Refazer o gerador de etiquetas fora do Clarisoft',
      status: 'EM_HOMOLOGACAO', priority: 'P3', ownerId: tecnico1.id, requesterId: gestorSetor.id,
      startDate: ago(24 * 60), dueDate: ago(24 * 2), percentComplete: 90, estimatedHours: 80,
    },
  });
  await prisma.projectTask.createMany({
    data: [
      { projectId: projEtiquetas.id, title: 'Migrar base de etiquetas do Clarisoft', status: 'CONCLUIDA', assigneeId: tecnico1.id, sortOrder: 1 },
      { projectId: projEtiquetas.id, title: 'Testes com a indústria', status: 'EM_ANDAMENTO', assigneeId: tecnico2.id, dueDate: ago(24), sortOrder: 2 },
    ],
  });
  await prisma.project.create({
    data: {
      name: 'Telas de promoção nas lojas', objective: 'TV nas lojas exibindo promoções do mês no lugar de panfletos',
      status: 'PROPOSTO', priority: 'P4', ownerId: gestorTi.id, requesterId: diretoria.id,
    },
  });

  // ---------- Rotinas ----------
  const rotBackup = await prisma.routine.create({
    data: {
      name: 'Verificar backups (Linear, Demander, NAS)', description: 'Conferir se os backups noturnos subiram: XML das notas, dumps do Linear e queries do Demander.',
      frequency: 'DIARIA', assigneeId: tecnico1.id, substituteId: tecnico2.id, unitId: escritorio.id, departmentId: ti.id,
      checklist: [
        { id: 'c1', label: 'Backup do Linear subiu para o NAS' },
        { id: 'c2', label: 'XMLs de notas da meia-noite presentes' },
        { id: 'c3', label: 'Queries do Demander copiadas' },
        { id: 'c4', label: 'Espaço livre do NAS acima de 20%' },
      ],
      requiresEvidence: false, estimatedMinutes: 15, criticality: 'ALTA',
      nextRunAt: ahead(20), toleranceHours: 6,
      instructions: 'Conferir e-mails de confirmação e acessar o NAS. Se algum backup falhou, abrir chamado P2 imediatamente.',
    },
  });
  // Execução VENCIDA da rotina de backup (cenário pedido no escopo)
  await prisma.routineExecution.create({
    data: { routineId: rotBackup.id, scheduledFor: ago(30), status: 'ATRASADA' },
  });
  // Execução concluída anterior
  await prisma.routineExecution.create({
    data: {
      routineId: rotBackup.id, scheduledFor: ago(54), status: 'CONCLUIDA', executedById: tecnico1.id,
      startedAt: ago(53.8), completedAt: ago(53.5),
      checklistResults: [
        { id: 'c1', label: 'Backup do Linear subiu para o NAS', done: true },
        { id: 'c2', label: 'XMLs de notas da meia-noite presentes', done: true },
        { id: 'c3', label: 'Queries do Demander copiadas', done: true },
        { id: 'c4', label: 'Espaço livre do NAS acima de 20%', done: true },
      ],
    },
  });

  const rotReproc = await prisma.routine.create({
    data: {
      name: 'Reprocessamento de vendas (Rosana)', description: 'Reprocessar as vendas da semana conforme solicitação padrão do financeiro.',
      frequency: 'SEMANAL', assigneeId: tecnico1.id, unitId: escritorio.id, criticality: 'MEDIA',
      nextRunAt: ahead(24 * 3), toleranceHours: 24, estimatedMinutes: 30,
    },
  });
  await prisma.routineExecution.create({
    data: { routineId: rotReproc.id, scheduledFor: ago(24 * 4), status: 'CONCLUIDA', executedById: tecnico1.id, completedAt: ago(24 * 4 - 1) },
  });
  await prisma.routine.create({
    data: {
      name: 'Limpeza do computador do corredor (farinha)', description: 'Limpeza preventiva do computador exposto à farinha na produção.',
      frequency: 'QUINZENAL', assigneeId: tecnico2.id, unitId: industria.id, criticality: 'ALTA',
      nextRunAt: ahead(24 * 2), toleranceHours: 48, estimatedMinutes: 40, requiresEvidence: true,
      instructions: 'Desligar, abrir lateral, aspirar com cuidado, verificar coolers. Anexar foto antes/depois.',
    },
  });
  await prisma.routine.create({
    data: {
      name: 'Relatório mensal do Copilot', description: 'Emitir e enviar o relatório mensal de uso do Copilot.',
      frequency: 'MENSAL', assigneeId: tecnico2.id, criticality: 'BAIXA',
      nextRunAt: ahead(24 * 12), toleranceHours: 72, estimatedMinutes: 20,
    },
  });
  await prisma.routine.create({
    data: {
      name: 'Revisar nobreaks e reserva de equipamentos', description: 'Testar nobreaks e conferir estado do estoque de reserva.',
      frequency: 'MENSAL', assigneeId: tecnico2.id, substituteId: tecnico1.id, criticality: 'MEDIA',
      nextRunAt: ahead(24 * 20), toleranceHours: 96, estimatedMinutes: 60,
    },
  });

  // ---------- Movimentações ----------
  await prisma.assetMovement.create({
    data: {
      assetId: monitorReserva.id, type: 'RETIRADA_RESERVA', status: 'SOLICITADA',
      fromUnitId: escritorio.id, toUnitId: lojaBH.id,
      requestedById: tecnico2.id, reason: 'Monitor do caixa 3 da Loja BH com listras na tela',
    },
  });
  const movConcluida = await prisma.assetMovement.create({
    data: {
      assetId: notebookReserva.id, type: 'EMPRESTIMO', status: 'CONFIRMADA',
      fromUnitId: escritorio.id, toUnitId: escritorio.id,
      requestedById: gestorTi.id, sentById: tecnico1.id, receivedById: gestorSetor.id,
      reason: 'Empréstimo para apresentação do comercial', confirmedAt: ago(24 * 3),
      equipmentCondition: 'Bom estado, carregador incluído', createdAt: ago(24 * 4),
    },
  });
  await prisma.asset.update({ where: { id: notebookReserva.id }, data: { status: 'EMPRESTADO' } });
  // A impressora da logística foi enviada para manutenção
  await prisma.assetMovement.create({
    data: {
      assetId: impressoraLog.id, type: 'ENVIO_MANUTENCAO', status: 'RECEBIDA',
      fromUnitId: logisticaBH.id, toUnitId: escritorio.id,
      requestedById: tecnico2.id, sentById: tecnico2.id, receivedById: tecnico1.id,
      reason: 'Sensor de etiqueta sujo — limpeza na bancada da TI', createdAt: ago(3),
    },
  });

  // ---------- Manutenções ----------
  await prisma.maintenanceRecord.create({
    data: {
      assetId: pcCorredor.id, type: 'LIMPEZA', description: 'Limpeza completa por acúmulo de farinha',
      diagnosis: 'Coolers e fonte com resíduo de farinha', serviceDone: 'Aspiração interna, troca de pasta térmica',
      responsibleId: tecnico2.id, date: ago(24 * 15), durationMinutes: 45, result: 'Temperatura normalizada',
      operational: true, nextMaintenanceAt: ago(72), createdById: tecnico2.id,
    },
  });
  await prisma.maintenanceRecord.create({
    data: {
      assetId: impressoraLog.id, ticketId: chImpressora.id, type: 'CORRETIVA',
      description: 'Limpeza do sensor de etiquetas', diagnosis: 'Sensor obstruído por resíduo de cola',
      responsibleId: tecnico2.id, date: ago(1), durationMinutes: 30, operational: null,
      createdById: tecnico2.id,
    },
  });
  await prisma.maintenanceRecord.create({
    data: {
      assetId: nobreakInd.id, type: 'PREVENTIVA', description: 'Teste de autonomia da bateria',
      responsibleId: tecnico2.id, date: ago(24 * 30), durationMinutes: 25, result: 'Autonomia de 18 min — dentro do esperado',
      operational: true, nextMaintenanceAt: ahead(24 * 30), createdById: tecnico2.id,
    },
  });
  await prisma.maintenanceRecord.create({
    data: {
      assetId: impressoraSM.id, type: 'INSPECAO', description: 'Verificação da guilhotina',
      responsibleId: tecnico1.id, date: ago(24 * 8), durationMinutes: 15, operational: true, createdById: tecnico1.id,
    },
  });

  // ---------- Configurações ----------
  await prisma.systemSetting.createMany({
    data: [
      { key: 'appName', value: 'Gestão TI — Tia Eliana' },
      { key: 'autoCloseHours', value: 48 },
      { key: 'wipLimit', value: 2 },
    ],
  });

  // ---------- Notificações de exemplo ----------
  await prisma.notification.createMany({
    data: [
      { userId: gestorTi.id, type: 'rotina_vencida', title: 'Rotina atrasada: Verificar backups', entity: 'routines', entityId: rotBackup.id },
      { userId: tecnico1.id, type: 'chamado_atribuido', title: 'Chamado atribuído: relatório curva ABC', entity: 'tickets' },
      { userId: diretoria.id, type: 'info', title: 'Bem-vinda ao Gestão TI', body: 'Use o dashboard da diretoria para acompanhar a equipe.' },
    ],
  });

  console.log('Seed concluído com sucesso.');
  console.log('--- Contas criadas (senha padrão: %s) ---', SENHA_PADRAO);
  console.log('Owner/Diretoria:  diretoria@tiaeliana.com.br');
  console.log('Administrador:    admin@tiaeliana.com.br');
  console.log('Gestor de TI:     gestor.ti@tiaeliana.com.br');
  console.log('Técnico 1:        tecnico1@tiaeliana.com.br');
  console.log('Técnico 2:        tecnico2@tiaeliana.com.br');
  console.log('Solicitante:      solicitante@tiaeliana.com.br');
  console.log('Gestor de setor:  gestor.setor@tiaeliana.com.br');
  console.log('Auditor:          auditor@tiaeliana.com.br');
  console.log('Inventariante:    inventariante@tiaeliana.com.br');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

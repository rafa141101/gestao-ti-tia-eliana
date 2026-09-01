import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { nextAssetCode, generatePublicId } from '../lib/numbers.js';
import { ASSET_STATUSES, ASSET_KINDS, COMPONENT_STATUSES, CRITICALITIES } from '@gestao-ti/shared';
import type { Prisma } from '@prisma/client';

/** Colunas do modelo de planilha de importação de componentes (nessa ordem). */
const IMPORT_COLUMNS = ['Tipo', 'Marca', 'Modelo', 'Nº de série', 'Capacidade', 'Fornecedor', 'Custo (R$)', 'Observações'] as const;
const IMPORT_EXAMPLE_ROW = ['Memória RAM', 'Kingston', 'DDR4 2666', '', '8GB', '', '', 'Trocada em 2026'];

interface ImportRow {
  type: string; brand?: string; model?: string; serialNumber?: string;
  capacity?: string; supplier?: string; cost?: number; notes?: string;
}

function parseImportSheet(buffer: Buffer): { rows: ImportRow[]; rowErrors: { row: number; message: string }[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const rows: ImportRow[] = [];
  const rowErrors: { row: number; message: string }[] = [];

  raw.forEach((r, i) => {
    const rowNumber = i + 2; // +1 cabeçalho, +1 índice baseado em 1
    const type = String(r['Tipo'] ?? '').trim();
    if (!type) {
      // Linha totalmente vazia é ignorada silenciosamente (planilha com linhas em branco no fim)
      const hasAnyValue = Object.values(r).some((v) => String(v ?? '').trim() !== '');
      if (hasAnyValue) rowErrors.push({ row: rowNumber, message: 'Coluna "Tipo" é obrigatória.' });
      return;
    }
    const costRaw = String(r['Custo (R$)'] ?? '').trim().replace(',', '.');
    const cost = costRaw ? Number(costRaw) : undefined;
    if (costRaw && Number.isNaN(cost)) {
      rowErrors.push({ row: rowNumber, message: `Custo inválido: "${r['Custo (R$)']}".` });
      return;
    }
    rows.push({
      type,
      brand: String(r['Marca'] ?? '').trim() || undefined,
      model: String(r['Modelo'] ?? '').trim() || undefined,
      serialNumber: String(r['Nº de série'] ?? '').trim() || undefined,
      capacity: String(r['Capacidade'] ?? '').trim() || undefined,
      supplier: String(r['Fornecedor'] ?? '').trim() || undefined,
      cost,
      notes: String(r['Observações'] ?? '').trim() || undefined,
    });
  });

  return { rows, rowErrors };
}

const assetSchema = z.object({
  patrimonyCode: z.string().nullable().optional(),
  categoryId: z.string().uuid(),
  family: z.string().nullable().optional(),
  kind: z.enum(ASSET_KINDS).optional(),
  description: z.string().min(2),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  unitId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  location: z.string().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  custodianId: z.string().uuid().nullable().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  criticality: z.enum(CRITICALITIES).optional(),
  purchaseDate: z.string().nullable().optional(),
  purchaseValue: z.number().nonnegative().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  warrantyStart: z.string().nullable().optional(),
  warrantyEnd: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
  mac: z.string().nullable().optional(),
  os: z.string().nullable().optional(),
  hostname: z.string().nullable().optional(),
  specs: z.record(z.unknown()).nullable().optional(),
  quantity: z.number().int().positive().optional(),
  minStock: z.number().int().nonnegative().nullable().optional(),
  nextMaintenanceAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const componentSchema = z.object({
  type: z.string().min(2),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  capacity: z.string().nullable().optional(),
  installedAt: z.string().nullable().optional(),
  warrantyEnd: z.string().nullable().optional(),
  supplier: z.string().nullable().optional(),
  cost: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
});

function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v ? new Date(v) : null;
}

export async function assetRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('inventory.view'));

  app.get('/categories', async () => {
    return prisma.assetCategory.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  });

  app.post('/categories', { preHandler: [app.requirePermission('admin.structure')] }, async (req, reply) => {
    const { name } = z.object({ name: z.string().min(2) }).parse(req.body);
    const cat = await prisma.assetCategory.create({ data: { name } });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'asset_categories', entityId: cat.id, req, after: { name } });
    return reply.code(201).send(cat);
  });

  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: Prisma.AssetWhereInput = {
      active: true,
      status: q.status ? { in: q.status.split(',') as never } : undefined,
      categoryId: q.categoryId,
      unitId: q.unitId,
      kind: q.kind as never,
      OR: q.search ? [
        { code: { contains: q.search, mode: 'insensitive' } },
        { patrimonyCode: { contains: q.search, mode: 'insensitive' } },
        { description: { contains: q.search, mode: 'insensitive' } },
        { serialNumber: { contains: q.search, mode: 'insensitive' } },
        { hostname: { contains: q.search, mode: 'insensitive' } },
      ] : undefined,
    };
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Number(q.pageSize ?? 25));
    const [total, items] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where,
        include: {
          category: { select: { name: true } },
          unit: { select: { name: true } },
          department: { select: { name: true } },
          user: { select: { id: true, name: true } },
        },
        orderBy: { code: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  });

  /** Visão de estoque de reserva. */
  /** Equipamentos vistos na rede que ainda não estão no inventário. */
  app.get('/network-discoveries', async (req) => {
    const { includeIgnored } = req.query as { includeIgnored?: string };
    return prisma.networkDiscovery.findMany({
      where: includeIgnored === 'true' ? {} : { ignored: false },
      orderBy: { lastSeen: 'desc' },
      take: 300,
    });
  });

  app.patch('/network-discoveries/:id', { preHandler: [app.requirePermission('inventory.register')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = z.object({ ignored: z.boolean().optional(), notes: z.string().nullable().optional() }).parse(req.body);
    const updated = await prisma.networkDiscovery.update({ where: { id }, data });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'network_discoveries', entityId: id, req, after: data });
    return updated;
  });

  /**
   * Vincula um ativo descoberto pelo agente a um cadastro já existente:
   * transfere a coleta (hostname, serial, MAC, specs, softwares) para o
   * cadastro correto e inativa o duplicado. Evita cadastro em dobro quando
   * o agente não conseguiu casar sozinho.
   */
  app.post('/:id/link-discovered', { preHandler: [app.requirePermission('inventory.register')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { targetAssetId } = z.object({ targetAssetId: z.string().uuid() }).parse(req.body);
    if (id === targetAssetId) throw new AppError('Selecione um ativo diferente.', 400);

    const [discovered, target] = await Promise.all([
      prisma.asset.findUnique({ where: { id }, include: { softwares: true } }),
      prisma.asset.findUnique({ where: { id: targetAssetId } }),
    ]);
    if (!discovered) throw new AppError('Ativo descoberto não encontrado.', 404);
    if (!target) throw new AppError('Ativo de destino não encontrado.', 404);
    if (!discovered.discoveredByAgent) {
      throw new AppError('Só ativos descobertos pelo agente podem ser vinculados desta forma.', 400);
    }

    await prisma.$transaction(async (tx) => {
      // Passa a coleta para o cadastro correto
      await tx.asset.update({
        where: { id: targetAssetId },
        data: {
          hostname: discovered.hostname,
          ip: discovered.ip,
          mac: discovered.mac,
          os: discovered.os,
          specs: (discovered.specs ?? undefined) as Prisma.InputJsonValue | undefined,
          lastSeenAt: discovered.lastSeenAt,
          agentVersion: discovered.agentVersion,
          serialNumber: target.serialNumber ?? discovered.serialNumber,
          brand: target.brand ?? discovered.brand,
          model: target.model ?? discovered.model,
        },
      });
      // Move a lista de programas instalados
      await tx.assetSoftware.deleteMany({ where: { assetId: targetAssetId } });
      if (discovered.softwares.length > 0) {
        await tx.assetSoftware.createMany({
          data: discovered.softwares.map((s) => ({
            assetId: targetAssetId,
            name: s.name,
            version: s.version,
            publisher: s.publisher,
            installedAt: s.installedAt,
            collectedAt: s.collectedAt,
          })),
          skipDuplicates: true,
        });
      }
      // A lista de programas foi transferida — não deixa cópia no duplicado
      await tx.assetSoftware.deleteMany({ where: { assetId: id } });
      // Inativa o duplicado (nunca apaga — mantém rastro)
      await tx.asset.update({
        where: { id },
        data: {
          active: false,
          status: 'INATIVO',
          notes: `${discovered.notes ?? ''}\nVinculado ao cadastro ${target.code} em ${new Date().toLocaleString('pt-BR')}.`.trim(),
        },
      });
    });

    await audit({
      userId: req.authUser.id, action: 'VINCULO_DESCOBERTO', entity: 'assets', entityId: targetAssetId, req,
      before: { descoberto: discovered.code }, after: { vinculadoA: target.code },
    });
    return { ok: true, targetCode: target.code };
  });

  /** Máquinas com coleta automática: online, sem contato recente e nunca vistas. */
  app.get('/agent-status', async () => {
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    const [online, semContato, semAgente] = await Promise.all([
      prisma.asset.findMany({
        where: { active: true, lastSeenAt: { gte: cutoff } },
        select: { id: true, code: true, description: true, hostname: true, ip: true, lastSeenAt: true, specs: true },
        orderBy: { lastSeenAt: 'desc' },
      }),
      prisma.asset.findMany({
        where: { active: true, lastSeenAt: { not: null, lt: cutoff } },
        select: { id: true, code: true, description: true, hostname: true, ip: true, lastSeenAt: true },
        orderBy: { lastSeenAt: 'asc' },
      }),
      prisma.asset.count({
        where: { active: true, lastSeenAt: null, category: { name: { in: ['Computador', 'Notebook', 'Servidor'] } } },
      }),
    ]);
    return { online, semContato, semAgente };
  });

  app.get('/reserve', async () => {
    const reserve = await prisma.asset.findMany({
      where: { active: true, status: { in: ['RESERVA', 'DISPONIVEL', 'EM_MANUTENCAO', 'AGUARDANDO_PECA'] } },
      include: { category: { select: { name: true } }, unit: { select: { name: true } } },
      orderBy: [{ categoryId: 'asc' }, { code: 'asc' }],
    });
    const byCategory: Record<string, { category: string; disponivel: number; reserva: number; manutencao: number; aguardandoPeca: number }> = {};
    for (const a of reserve) {
      const key = a.category.name;
      byCategory[key] ??= { category: key, disponivel: 0, reserva: 0, manutencao: 0, aguardandoPeca: 0 };
      if (a.status === 'DISPONIVEL') byCategory[key].disponivel += a.quantity;
      if (a.status === 'RESERVA') byCategory[key].reserva += a.quantity;
      if (a.status === 'EM_MANUTENCAO') byCategory[key].manutencao += a.quantity;
      if (a.status === 'AGUARDANDO_PECA') byCategory[key].aguardandoPeca += a.quantity;
    }
    return { summary: Object.values(byCategory), items: reserve };
  });

  app.post('/', { preHandler: [app.requirePermission('inventory.register')] }, async (req, reply) => {
    const data = assetSchema.parse(req.body);
    const now = new Date();
    const asset = await prisma.$transaction(async (tx) => {
      const code = await nextAssetCode(tx, now);
      // publicId único (re-tenta em caso de colisão improvável)
      let publicId = generatePublicId();
      for (let i = 0; i < 5; i++) {
        const clash = await tx.asset.findUnique({ where: { publicId } });
        if (!clash) break;
        publicId = generatePublicId();
      }
      return tx.asset.create({
        data: {
          ...data,
          code,
          publicId,
          specs: (data.specs ?? undefined) as Prisma.InputJsonValue | undefined,
          purchaseDate: toDate(data.purchaseDate),
          warrantyStart: toDate(data.warrantyStart),
          warrantyEnd: toDate(data.warrantyEnd),
          nextMaintenanceAt: toDate(data.nextMaintenanceAt),
          createdById: req.authUser.id,
        },
      });
    });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'assets', entityId: asset.id, req, after: { code: asset.code, description: asset.description } });
    return reply.code(201).send(asset);
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const asset = await prisma.asset.findUnique({
      where: { id },
      include: {
        category: true,
        unit: true,
        department: true,
        user: { select: { id: true, name: true } },
        custodian: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        components: { orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] },
        movements: {
          include: {
            fromUnit: { select: { name: true } }, toUnit: { select: { name: true } },
            requestedBy: { select: { name: true } }, receivedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        maintenances: {
          include: { responsible: { select: { name: true } }, thirdParty: { select: { name: true } } },
          orderBy: { date: 'desc' },
        },
        tickets: { select: { id: true, number: true, title: true, status: true, openedAt: true }, orderBy: { openedAt: 'desc' }, take: 20 },
        attachments: true,
        softwares: { orderBy: { name: 'asc' } },
      },
    });
    if (!asset) throw new AppError('Ativo não encontrado.', 404);
    return asset;
  });

  app.patch('/:id', { preHandler: [app.requirePermission('inventory.register')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = assetSchema.partial().extend({
      active: z.boolean().optional(),
      /// Marcar como conferido após revisar uma descoberta do agente
      discoveredByAgent: z.boolean().optional(),
    }).parse(req.body);
    const before = await prisma.asset.findUnique({ where: { id } });
    if (!before) throw new AppError('Ativo não encontrado.', 404);

    // Localização/unidade não muda por edição direta: exige movimentação (regra 21.12)
    if ((data.unitId !== undefined && data.unitId !== before.unitId) ||
        (data.departmentId !== undefined && data.departmentId !== before.departmentId)) {
      throw new AppError('Unidade/setor de um ativo só mudam por movimentação registrada.', 400);
    }

    const after = await prisma.asset.update({
      where: { id },
      data: {
        ...data,
        unitId: undefined,
        departmentId: undefined,
        specs: (data.specs ?? undefined) as Prisma.InputJsonValue | undefined,
        purchaseDate: toDate(data.purchaseDate),
        warrantyStart: toDate(data.warrantyStart),
        warrantyEnd: toDate(data.warrantyEnd),
        nextMaintenanceAt: toDate(data.nextMaintenanceAt),
      },
    });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'assets', entityId: id, req, before: { status: before.status, description: before.description }, after: data });
    return after;
  });

  // ---- Componentes ----
  app.post('/:id/components', { preHandler: [app.requirePermission('inventory.register')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = componentSchema.parse(req.body);
    const comp = await prisma.assetComponent.create({
      data: {
        ...data,
        assetId: id,
        installedAt: toDate(data.installedAt) ?? new Date(),
        warrantyEnd: toDate(data.warrantyEnd),
      },
    });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'asset_components', entityId: comp.id, req, after: { type: comp.type, assetId: id } });
    return reply.code(201).send(comp);
  });

  /** Modelo de planilha (.xlsx) para importação em lote de componentes. */
  app.get('/components/import-template', async (_req, reply) => {
    const ws = XLSX.utils.aoa_to_sheet([[...IMPORT_COLUMNS], IMPORT_EXAMPLE_ROW]);
    ws['!cols'] = IMPORT_COLUMNS.map((c) => ({ wch: Math.max(14, c.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Componentes');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="modelo-componentes.xlsx"');
    return reply.send(buffer);
  });

  /** Importação em lote de componentes de um ativo a partir da planilha modelo. */
  app.post('/:id/components/import', { preHandler: [app.requirePermission('inventory.register')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = await prisma.asset.findUnique({ where: { id }, select: { id: true, code: true } });
    if (!asset) throw new AppError('Ativo não encontrado.', 404);

    const parts = req.parts();
    let buffer: Buffer | null = null;
    let filename = '';
    for await (const part of parts) {
      if (part.type === 'file') {
        const allowed = [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ];
        if (!allowed.includes(part.mimetype)) {
          part.file.resume();
          throw new AppError('Envie um arquivo .xlsx (modelo baixado na tela).', 400);
        }
        filename = part.filename ?? 'planilha.xlsx';
        buffer = await part.toBuffer();
      }
    }
    if (!buffer) throw new AppError('Nenhum arquivo enviado.', 400);

    let rows: ImportRow[];
    let rowErrors: { row: number; message: string }[];
    try {
      ({ rows, rowErrors } = parseImportSheet(buffer));
    } catch {
      throw new AppError('Não foi possível ler a planilha. Confirme que é o arquivo .xlsx do modelo.', 400);
    }
    if (rows.length === 0 && rowErrors.length === 0) {
      throw new AppError('A planilha não tem nenhuma linha preenchida.', 400);
    }
    if (rows.length > 500) {
      throw new AppError('Máximo de 500 componentes por importação.', 400);
    }

    const created = await prisma.$transaction(
      rows.map((r) =>
        prisma.assetComponent.create({
          data: {
            assetId: id,
            type: r.type,
            brand: r.brand ?? null,
            model: r.model ?? null,
            serialNumber: r.serialNumber ?? null,
            capacity: r.capacity ?? null,
            supplier: r.supplier ?? null,
            cost: r.cost ?? null,
            notes: r.notes ?? null,
            installedAt: new Date(),
          },
        }),
      ),
    );

    await audit({
      userId: req.authUser.id, action: 'IMPORTACAO_COMPONENTES', entity: 'assets', entityId: id, req,
      after: { assetCode: asset.code, arquivo: filename, criados: created.length, linhasComErro: rowErrors.length },
    });

    return reply.code(201).send({ created: created.length, rowErrors });
  });

  /** Substituição/retirada de componente — o histórico permanece (regra 21.13). */
  app.post('/components/:compId/remove', { preHandler: [app.requirePermission('inventory.register')] }, async (req) => {
    const { compId } = req.params as { compId: string };
    const { destination, notes } = z.object({
      destination: z.enum(COMPONENT_STATUSES).refine((s) => s !== 'INSTALADO', 'Escolha um destino válido'),
      notes: z.string().optional(),
    }).parse(req.body);
    const comp = await prisma.assetComponent.findUnique({ where: { id: compId } });
    if (!comp) throw new AppError('Componente não encontrado.', 404);
    if (comp.status !== 'INSTALADO') throw new AppError('Componente já removido.', 400);
    const updated = await prisma.assetComponent.update({
      where: { id: compId },
      data: { status: destination, removedAt: new Date(), notes: notes ?? comp.notes },
    });
    await audit({ userId: req.authUser.id, action: 'REMOCAO_COMPONENTE', entity: 'asset_components', entityId: compId, req, before: { status: 'INSTALADO' }, after: { status: destination } });
    return updated;
  });

  app.patch('/components/:compId', { preHandler: [app.requirePermission('inventory.register')] }, async (req) => {
    const { compId } = req.params as { compId: string };
    const data = componentSchema.partial().parse(req.body);
    const updated = await prisma.assetComponent.update({
      where: { id: compId },
      data: { ...data, installedAt: toDate(data.installedAt), warrantyEnd: toDate(data.warrantyEnd) },
    });
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'asset_components', entityId: compId, req, after: data });
    return updated;
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AppError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notifyRoles } from '../lib/notify.js';
import { nextTicketNumber } from '../lib/numbers.js';
import { addSlaMinutes, slaMinutesFor } from '../lib/sla.js';
import { computePriority } from '@gestao-ti/shared';

/**
 * Rotas públicas do QR Code — SEM autenticação, portanto expõem apenas
 * identificação básica do equipamento (nunca IP, MAC, senhas ou responsáveis).
 * Rate limit simples em memória por IP.
 */
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimit(ip: string, max = 30): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

export async function publicRoutes(app: FastifyInstance) {
  /** Identificação básica do ativo pelo publicId do QR. */
  app.get('/assets/:publicId', async (req) => {
    if (!rateLimit(req.ip)) throw new AppError('Muitas requisições. Aguarde um instante.', 429);
    const { publicId } = req.params as { publicId: string };
    const asset = await prisma.asset.findUnique({
      where: { publicId },
      select: {
        publicId: true, code: true, patrimonyCode: true, description: true,
        brand: true, model: true, status: true,
        category: { select: { name: true } },
        unit: { select: { name: true } },
        department: { select: { name: true } },
      },
    });
    if (!asset || !asset) throw new AppError('Equipamento não encontrado.', 404);
    return asset;
  });

  /** Abertura de chamado via QR Code (sem login — identifica o solicitante pelo nome informado). */
  app.post('/assets/:publicId/report', async (req, reply) => {
    if (!rateLimit(req.ip, 10)) throw new AppError('Muitas requisições. Aguarde um instante.', 429);
    const { publicId } = req.params as { publicId: string };
    const { reporterName, description } = z.object({
      reporterName: z.string().min(2, 'Informe seu nome'),
      description: z.string().min(5, 'Descreva o problema'),
    }).parse(req.body);

    const asset = await prisma.asset.findUnique({ where: { publicId }, include: { unit: true, department: true } });
    if (!asset) throw new AppError('Equipamento não encontrado.', 404);

    // Chamados via QR entram em nome do usuário de sistema "Portal QR"
    const systemUser = await prisma.user.findFirst({ where: { email: 'qr@gestao-ti.local' } });
    if (!systemUser) throw new AppError('Usuário de sistema do QR não configurado. Contate a TI.', 500);

    const category = await prisma.category.findFirst({ where: { active: true, name: { contains: 'equipamento', mode: 'insensitive' } } })
      ?? await prisma.category.findFirst({ where: { active: true } });
    if (!category) throw new AppError('Nenhuma categoria configurada.', 500);

    const impact = 'UMA_PESSOA' as const;
    const urgency = 'PARCIALMENTE_PREJUDICADA' as const;
    const priority = computePriority(impact, urgency);
    const policy = await prisma.slaPolicy.findFirst({ where: { isDefault: true, active: true } });
    const now = new Date();
    const holidays = policy ? (await prisma.holiday.findMany()).map((h) => h.date) : [];

    const ticket = await prisma.$transaction(async (tx) => {
      const number = await nextTicketNumber(tx, now);
      const t = await tx.ticket.create({
        data: {
          number,
          title: `[QR] Problema em ${asset.code} — ${asset.description}`,
          description: `Relato via QR Code por: ${reporterName}\n\n${description}`,
          requesterId: systemUser.id,
          unitId: asset.unitId,
          departmentId: asset.departmentId,
          categoryId: category.id,
          channel: 'QR_CODE',
          impact,
          urgency,
          calculatedPriority: priority,
          priority,
          assetId: asset.id,
          slaPolicyId: policy?.id ?? null,
          firstResponseDueAt: policy ? addSlaMinutes(now, slaMinutesFor(policy, priority).firstResponse, policy, holidays) : null,
          resolutionDueAt: policy ? addSlaMinutes(now, slaMinutesFor(policy, priority).resolution, policy, holidays) : null,
        },
      });
      await tx.ticketEvent.create({
        data: { ticketId: t.id, type: 'CRIACAO', toValue: 'NOVO', comment: `Aberto via QR Code por ${reporterName}` },
      });
      return t;
    });

    await audit({ action: 'CRIACAO_QR', entity: 'tickets', entityId: ticket.id, req, after: { number: ticket.number, reporterName } });
    await notifyRoles(['GESTOR_TI', 'TECNICO'], 'chamado_criado', `Chamado via QR: ${ticket.number}`, `${asset.code}: ${description.slice(0, 100)}`, 'tickets', ticket.id);
    return reply.code(201).send({ number: ticket.number });
  });
}

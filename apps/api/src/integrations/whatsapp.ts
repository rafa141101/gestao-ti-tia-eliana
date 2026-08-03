import { env } from '../env.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { notifyUser, notifyRoles } from '../lib/notify.js';
import { nextTicketNumber } from '../lib/numbers.js';
import { generatePublicId } from '../lib/numbers.js';
import { addSlaMinutes, slaMinutesFor } from '../lib/sla.js';
import { computePriority } from '@gestao-ti/shared';
import bcrypt from 'bcryptjs';

/**
 * Integração com a API oficial do WhatsApp (Meta Cloud API).
 *
 * Custo: conversas iniciadas pelo usuário abrem uma janela de atendimento de
 * 24h em que respostas de texto são GRATUITAS (conversas de serviço). Como a
 * TI só responde a quem chamou, a operação não gera cobrança — apenas
 * mensagens de template iniciadas pela empresa custariam.
 *
 * Sem WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID a integração fica inativa:
 * nenhuma chamada externa é feita (requisito do MVP de rodar offline).
 */

export function whatsappConfigured(): boolean {
  return Boolean(env.whatsappToken && env.whatsappPhoneId);
}

function digitsOf(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

/** Compara telefones pelo sufixo (ignora DDI/9 extra). */
function samePhone(a: string, b: string): boolean {
  const da = digitsOf(a);
  const db = digitsOf(b);
  if (da.length < 8 || db.length < 8) return false;
  return da.slice(-8) === db.slice(-8);
}

/** Envia texto pela janela de serviço. Nunca lança — falha vira log. */
export async function sendWhatsAppText(to: string | null | undefined, body: string): Promise<void> {
  if (!whatsappConfigured()) return;
  const digits = digitsOf(to);
  if (digits.length < 10) return;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${env.whatsappPhoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: digits,
        type: 'text',
        text: { body: body.slice(0, 4000) },
      }),
    });
    if (!res.ok) {
      console.error('[whatsapp] envio falhou:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[whatsapp] erro de envio:', err);
  }
}

async function whatsappSystemUser() {
  const existing = await prisma.user.findFirst({ where: { email: 'whatsapp@gestao-ti.local' } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      name: 'Canal WhatsApp',
      email: 'whatsapp@gestao-ti.local',
      passwordHash: await bcrypt.hash(generatePublicId(24), 10),
      role: 'SOLICITANTE',
    },
  });
}

async function categoryForWhatsApp() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'whatsappCategoryId' } });
  if (typeof setting?.value === 'string') {
    const byId = await prisma.category.findFirst({ where: { id: setting.value, active: true } });
    if (byId) return byId;
  }
  return (
    (await prisma.category.findFirst({ where: { active: true, name: { contains: 'outro', mode: 'insensitive' } } })) ??
    (await prisma.category.findFirst({ where: { active: true } }))
  );
}

/**
 * Processa uma mensagem recebida.
 * Regra da janela (definida na reunião): mensagem de um número com chamado
 * WhatsApp aberto e movimentado nas últimas 24h entra como resposta no mesmo
 * chamado; caso contrário abre chamado novo e responde com o número.
 */
export async function processIncomingWhatsApp(from: string, text: string, profileName?: string): Promise<void> {
  const phone = digitsOf(from);
  if (!phone || !text.trim()) return;

  // Usuário cadastrado com este telefone?
  const candidates = await prisma.user.findMany({
    where: { active: true, phone: { not: null } },
    select: { id: true, name: true, phone: true, unitId: true, departmentId: true },
  });
  const matched = candidates.find((u) => samePhone(u.phone!, phone));

  // Conversa em andamento (mesma janela de 24h)?
  const windowStart = new Date(Date.now() - 24 * 3600_000);
  const openTicket = await prisma.ticket.findFirst({
    where: {
      channel: 'WHATSAPP',
      status: { notIn: ['FECHADO', 'CANCELADO'] },
      updatedAt: { gte: windowStart },
      OR: [
        { contactPhone: phone },
        ...(matched ? [{ requesterId: matched.id }] : []),
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (openTicket) {
    const author = matched ?? (await whatsappSystemUser());
    await prisma.ticketComment.create({
      data: {
        ticketId: openTicket.id,
        authorId: author.id,
        body: matched ? text : `[${profileName ?? phone}] ${text}`,
        isInternal: false,
      },
    });
    await prisma.ticket.update({ where: { id: openTicket.id }, data: { updatedAt: new Date() } });
    if (openTicket.assigneeId) {
      await notifyUser(openTicket.assigneeId, 'chamado_resposta', `WhatsApp: nova mensagem no ${openTicket.number}`, text.slice(0, 120), 'tickets', openTicket.id);
    }
    await audit({ action: 'WHATSAPP_MENSAGEM', entity: 'tickets', entityId: openTicket.id, origin: 'whatsapp', after: { from: phone } });
    return;
  }

  // Chamado novo
  const requester = matched ?? (await whatsappSystemUser());
  const category = await categoryForWhatsApp();
  if (!category) {
    console.error('[whatsapp] nenhuma categoria ativa para abrir chamado');
    return;
  }
  const impact = 'UMA_PESSOA' as const;
  const urgency = 'PARCIALMENTE_PREJUDICADA' as const;
  const priority = computePriority(impact, urgency);
  const policy = await prisma.slaPolicy.findFirst({ where: { isDefault: true, active: true } });
  const holidays = policy ? (await prisma.holiday.findMany()).map((h) => h.date) : [];
  const now = new Date();

  const firstLine = text.trim().split('\n')[0].slice(0, 70);
  const ticket = await prisma.$transaction(async (tx) => {
    const number = await nextTicketNumber(tx, now);
    const t = await tx.ticket.create({
      data: {
        number,
        title: `[WhatsApp] ${firstLine}`,
        description: `Mensagem recebida pelo WhatsApp de ${profileName ?? 'contato'} (${phone}):\n\n${text}`,
        requesterId: requester.id,
        unitId: matched?.unitId ?? null,
        departmentId: matched?.departmentId ?? null,
        categoryId: category.id,
        channel: 'WHATSAPP',
        impact,
        urgency,
        calculatedPriority: priority,
        priority,
        contactPhone: phone,
        queueId: category.defaultQueueId ?? null,
        slaPolicyId: policy?.id ?? null,
        firstResponseDueAt: policy ? addSlaMinutes(now, slaMinutesFor(policy, priority).firstResponse, policy, holidays) : null,
        resolutionDueAt: policy ? addSlaMinutes(now, slaMinutesFor(policy, priority).resolution, policy, holidays) : null,
      },
    });
    await tx.ticketEvent.create({
      data: { ticketId: t.id, type: 'CRIACAO', toValue: 'NOVO', comment: `Recebido pelo WhatsApp (${phone})` },
    });
    return t;
  });

  await audit({ action: 'CRIACAO_WHATSAPP', entity: 'tickets', entityId: ticket.id, origin: 'whatsapp', after: { number: ticket.number, from: phone } });
  await notifyRoles(['GESTOR_TI', 'TECNICO'], 'chamado_criado', `Chamado via WhatsApp: ${ticket.number}`, firstLine, 'tickets', ticket.id);
  await sendWhatsAppText(
    phone,
    `Olá${matched ? `, ${matched.name.split(' ')[0]}` : ''}! Seu chamado *${ticket.number}* foi registrado na TI. ` +
    'Você receberá retorno por aqui. Para acrescentar informações, é só responder esta conversa.',
  );
}

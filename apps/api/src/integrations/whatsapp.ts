import { env } from '../env.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { notifyUser, notifyRoles } from '../lib/notify.js';
import { nextTicketNumber } from '../lib/numbers.js';
import { generatePublicId } from '../lib/numbers.js';
import { addSlaMinutes, slaMinutesFor } from '../lib/sla.js';
import { computePriority, type Urgency } from '@gestao-ti/shared';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

/** Remove acentos e caixa para comparação de palavra-chave tolerante. */
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Palavras que indicam urgência alta, independente da categoria — lista fixa
 * (não configurável pelo admin, ao contrário das palavras-chave de categoria).
 */
const URGENT_KEYWORDS = [
  'urgente', 'urgencia', 'parou', 'parado', 'parada', 'nao funciona', 'nao consigo',
  'ninguem consegue', 'loja toda', 'sistema caiu', 'caiu o sistema', 'sem internet',
  'nao vende', 'nao consegue vender', 'travou tudo', 'parou tudo',
];

function urgencyFor(text: string): Urgency {
  const norm = normalize(text);
  return URGENT_KEYWORDS.some((k) => norm.includes(k)) ? 'ATIVIDADE_BLOQUEADA' : 'PARCIALMENTE_PREJUDICADA';
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

// ---------- Mídia recebida (fotos, áudios, vídeos, documentos) ----------

export type IncomingMediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker';

export interface IncomingMedia {
  kind: IncomingMediaKind;
  /** id da mídia na Meta — o arquivo precisa ser baixado em seguida (a URL expira em minutos) */
  id: string;
  mimeType?: string;
  filename?: string;
  /** áudio gravado no próprio WhatsApp (mensagem de voz) */
  voice?: boolean;
}

const MEDIA_LABELS: Record<IncomingMediaKind, string> = {
  image: 'Foto', audio: 'Áudio', video: 'Vídeo', document: 'Documento', sticker: 'Figurinha',
};

function mediaLabel(media: IncomingMedia): string {
  if (media.kind === 'audio' && media.voice) return 'Mensagem de voz';
  if (media.kind === 'document' && media.filename) return `Documento: ${media.filename}`;
  return MEDIA_LABELS[media.kind];
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/amr': '.amr',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp',
  'application/pdf': '.pdf',
};

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Baixa a mídia da Meta e grava em UPLOAD_DIR, criando um anexo ainda sem
 * vínculo (quem chama liga ao chamado/comentário). Fluxo da Cloud API:
 * GET /{media-id} devolve uma URL temporária, que também exige o token.
 * Nunca lança — retorna null se não deu para baixar (integração inativa,
 * arquivo grande demais, erro de rede).
 */
async function saveIncomingMedia(media: IncomingMedia, uploaderId: string): Promise<string | null> {
  if (!whatsappConfigured()) return null;
  const headers = { Authorization: `Bearer ${env.whatsappToken}` };
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(media.id)}`, { headers });
    if (!metaRes.ok) {
      console.error('[whatsapp] consulta da mídia falhou:', metaRes.status, await metaRes.text());
      return null;
    }
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!meta.url) return null;
    if (meta.file_size && meta.file_size > env.whatsappMediaMaxBytes) {
      console.error(`[whatsapp] mídia ${media.id} ignorada: ${meta.file_size} bytes acima do limite`);
      return null;
    }

    const fileRes = await fetch(meta.url, { headers });
    if (!fileRes.ok) {
      console.error('[whatsapp] download da mídia falhou:', fileRes.status);
      return null;
    }
    const data = Buffer.from(await fileRes.arrayBuffer());
    if (data.length > env.whatsappMediaMaxBytes) {
      console.error(`[whatsapp] mídia ${media.id} ignorada: ${data.length} bytes acima do limite`);
      return null;
    }

    // "audio/ogg; codecs=opus" → "audio/ogg"
    const mimeType = (meta.mime_type ?? media.mimeType ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const original = media.filename ? path.basename(media.filename).slice(0, 200) : '';
    const ext = (original ? path.extname(original) : EXT_BY_MIME[mimeType] ?? '').slice(0, 10);
    const filename = original || `whatsapp-${MEDIA_LABELS[media.kind].toLowerCase()}-${stamp(new Date())}${ext}`;
    const storedName = `${crypto.randomUUID()}${ext}`;

    fs.mkdirSync(env.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(env.uploadDir, storedName), data);

    const att = await prisma.attachment.create({
      data: { filename, storedName, mimeType, size: data.length, uploadedById: uploaderId },
    });
    return att.id;
  } catch (err) {
    console.error('[whatsapp] erro ao baixar mídia:', err);
    return null;
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

async function defaultCategoryForWhatsApp() {
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

/** Categorias configuradas para triagem automática (têm ao menos uma palavra-chave). */
async function categoriesForTriage() {
  return prisma.category.findMany({
    where: { active: true, triageKeywords: { isEmpty: false } },
    orderBy: { name: 'asc' },
  });
}

/** Acha a primeira categoria cuja palavra-chave aparece no texto. */
function matchCategoryByKeyword<T extends { triageKeywords: string[] }>(text: string, categories: T[]): T | null {
  const norm = normalize(text);
  return categories.find((c) => c.triageKeywords.some((k) => norm.includes(normalize(k)))) ?? null;
}

interface MenuOption { n: number; categoryId: string; label: string }

function buildMenu(categories: { id: string; name: string }[]): { text: string; options: MenuOption[] } {
  const options: MenuOption[] = categories.map((c, i) => ({ n: i + 1, categoryId: c.id, label: c.name }));
  const lines = options.map((o) => `${o.n}) ${o.label}`).join('\n');
  return {
    text: `Para agilizar seu atendimento, escolha o assunto abaixo (responda só com o número):\n\n${lines}`,
    options,
  };
}

interface NewTicketInput {
  phone: string;
  matched: { id: string; name: string; unitId: string | null; departmentId: string | null } | null | undefined;
  profileName?: string;
  messageText: string;
  category: { id: string; defaultQueueId: string | null };
  /** anexos já baixados (sem vínculo) que passam a pertencer ao chamado */
  attachmentIds?: string[];
}

/** Cria o chamado a partir de uma mensagem já triada (categoria já decidida). */
async function createTicketFromWhatsApp({ phone, matched, profileName, messageText, category, attachmentIds = [] }: NewTicketInput) {
  const requester = matched ?? (await whatsappSystemUser());
  const impact = 'UMA_PESSOA' as const;
  const urgency = urgencyFor(messageText);
  const priority = computePriority(impact, urgency);
  const policy = await prisma.slaPolicy.findFirst({ where: { isDefault: true, active: true } });
  const holidays = policy ? (await prisma.holiday.findMany()).map((h) => h.date) : [];
  const now = new Date();

  const firstLine = messageText.trim().split('\n')[0].slice(0, 70);
  const ticket = await prisma.$transaction(async (tx) => {
    const number = await nextTicketNumber(tx, now);
    const t = await tx.ticket.create({
      data: {
        number,
        title: `[WhatsApp] ${firstLine}`,
        description: `Mensagem recebida pelo WhatsApp de ${profileName ?? 'contato'} (${phone}):\n\n${messageText}`,
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
    if (attachmentIds.length) {
      await tx.attachment.updateMany({ where: { id: { in: attachmentIds } }, data: { ticketId: t.id } });
    }
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

/**
 * Processa uma mensagem recebida.
 * Regra da janela (definida na reunião): mensagem de um número com chamado
 * WhatsApp aberto e movimentado nas últimas 24h entra como resposta no mesmo
 * chamado; caso contrário abre chamado novo e responde com o número.
 *
 * Triagem automática: mensagem nova é comparada às palavras-chave das
 * categorias (configuráveis em Categorias e SLA). Se bater, o chamado já
 * nasce na categoria certa. Se não bater e existir alguma categoria
 * configurada, manda um menu numerado e espera a escolha antes de criar o
 * chamado; sem categoria configurada nenhuma, mantém o comportamento antigo
 * (categoria padrão direto).
 */
export async function processIncomingWhatsApp(
  from: string,
  caption: string,
  profileName?: string,
  media?: IncomingMedia,
): Promise<void> {
  const phone = digitsOf(from);
  if (!phone || (!caption.trim() && !media)) return;

  // Usuário cadastrado com este telefone?
  const candidates = await prisma.user.findMany({
    where: { active: true, phone: { not: null } },
    select: { id: true, name: true, phone: true, unitId: true, departmentId: true },
  });
  const matched = candidates.find((u) => samePhone(u.phone!, phone));

  // Mídia: baixa já (a URL da Meta expira) e descreve no texto, para o técnico saber o que
  // chegou mesmo se o download falhar. A legenda, quando houver, vale como texto da mensagem.
  const attachmentIds: string[] = [];
  let text = caption.trim();
  if (media) {
    const uploader = matched ?? (await whatsappSystemUser());
    const attachmentId = await saveIncomingMedia(media, uploader.id);
    if (attachmentId) attachmentIds.push(attachmentId);
    const tag = attachmentId
      ? `[${mediaLabel(media)}]`
      : `[${mediaLabel(media)} — não foi possível baixar o arquivo; peça para reenviar]`;
    text = text ? `${tag}\n${text}` : tag;
  }

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
    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: openTicket.id,
        authorId: author.id,
        body: matched ? text : `[${profileName ?? phone}] ${text}`,
        isInternal: false,
      },
    });
    if (attachmentIds.length) {
      await prisma.attachment.updateMany({
        where: { id: { in: attachmentIds } },
        data: { ticketId: openTicket.id, commentId: comment.id },
      });
    }
    // Cliente respondeu num chamado já resolvido: o problema voltou — reabre (a mensagem de
    // resolução enviada a ele promete exatamente isso).
    if (openTicket.status === 'RESOLVIDO') {
      await prisma.$transaction([
        prisma.ticket.update({
          where: { id: openTicket.id },
          data: { status: 'EM_ATENDIMENTO', resolvedAt: null, closedAt: null, reopenedCount: openTicket.reopenedCount + 1, updatedAt: new Date() },
        }),
        prisma.ticketEvent.create({
          data: {
            ticketId: openTicket.id, type: 'REABERTURA', fromValue: 'RESOLVIDO', toValue: 'EM_ATENDIMENTO',
            justification: 'Cliente respondeu pelo WhatsApp após a resolução',
          },
        }),
      ]);
    } else {
      await prisma.ticket.update({ where: { id: openTicket.id }, data: { updatedAt: new Date() } });
    }
    if (openTicket.assigneeId) {
      await notifyUser(openTicket.assigneeId, 'chamado_resposta', `WhatsApp: nova mensagem no ${openTicket.number}`, text.slice(0, 120), 'tickets', openTicket.id);
    }
    await audit({ action: 'WHATSAPP_MENSAGEM', entity: 'tickets', entityId: openTicket.id, origin: 'whatsapp', after: { from: phone } });
    return;
  }

  // Resposta a um menu de triagem pendente?
  const pending = await prisma.whatsAppPendingTriage.findUnique({ where: { phone } });
  // Arquivo enviado enquanto o menu espera resposta: guarda junto e lembra de escolher o assunto
  // (não dá para tratar foto/áudio como "resposta inválida" e abrir na categoria padrão).
  if (pending && media) {
    const options = pending.options as unknown as MenuOption[];
    await prisma.whatsAppPendingTriage.update({
      where: { phone },
      data: {
        firstMessage: `${pending.firstMessage}\n${text}`,
        attachmentIds: [...pending.attachmentIds, ...attachmentIds],
      },
    });
    await sendWhatsAppText(
      phone,
      `Recebemos o arquivo. Para concluir a abertura do chamado, responda só com o número do assunto:\n\n${options.map((o) => `${o.n}) ${o.label}`).join('\n')}`,
    );
    return;
  }
  if (pending) {
    await prisma.whatsAppPendingTriage.delete({ where: { phone } });
    const options = pending.options as unknown as MenuOption[];
    const chosenN = Number(text.trim().match(/\d+/)?.[0]);
    const chosen = options.find((o) => o.n === chosenN);
    const category = chosen
      ? await prisma.category.findFirst({ where: { id: chosen.categoryId, active: true } })
      : null;
    const finalCategory = category ?? (await defaultCategoryForWhatsApp());
    if (!finalCategory) {
      console.error('[whatsapp] nenhuma categoria ativa para abrir chamado');
      return;
    }
    await createTicketFromWhatsApp({
      phone, matched, profileName,
      messageText: pending.firstMessage,
      category: finalCategory,
      attachmentIds: pending.attachmentIds,
    });
    return;
  }

  // Chamado novo — tenta triagem automática por palavra-chave.
  const triageCategories = await categoriesForTriage();
  const keywordMatch = matchCategoryByKeyword(caption, triageCategories);
  if (keywordMatch) {
    await createTicketFromWhatsApp({ phone, matched, profileName, messageText: text, category: keywordMatch, attachmentIds });
    return;
  }

  // Nenhuma palavra-chave bateu: se existe categoria configurada, manda o menu e espera.
  if (triageCategories.length > 0) {
    const menu = buildMenu(triageCategories);
    await prisma.whatsAppPendingTriage.create({
      data: { phone, firstMessage: text, profileName, options: menu.options as unknown as object, attachmentIds },
    });
    await sendWhatsAppText(phone, menu.text);
    return;
  }

  // Nenhuma categoria configurada para triagem: comportamento padrão de sempre.
  const category = await defaultCategoryForWhatsApp();
  if (!category) {
    console.error('[whatsapp] nenhuma categoria ativa para abrir chamado');
    return;
  }
  await createTicketFromWhatsApp({ phone, matched, profileName, messageText: text, category, attachmentIds });
}

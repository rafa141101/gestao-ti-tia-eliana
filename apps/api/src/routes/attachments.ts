import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { ticketScopeFor } from './tickets.js';
import { hasPermission } from '@gestao-ti/shared';

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/msword',
  'application/zip', 'application/x-zip-compressed',
]);

const PARENT_FIELDS = ['ticketId', 'commentId', 'taskId', 'assetId', 'maintenanceId', 'movementId', 'routineExecutionId'] as const;

export async function attachmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Upload multipart. Campos: file + um campo de vínculo (ticketId, assetId...). */
  app.post('/', async (req, reply) => {
    const parts = req.parts();
    let fileInfo: { filename: string; mimeType: string; storedName: string; size: number } | null = null;
    const fields: Record<string, string> = {};

    fs.mkdirSync(env.uploadDir, { recursive: true });

    for await (const part of parts) {
      if (part.type === 'file') {
        if (!ALLOWED_MIME.has(part.mimetype)) {
          part.file.resume();
          throw new AppError(`Tipo de arquivo não permitido: ${part.mimetype}`, 400);
        }
        const ext = path.extname(part.filename ?? '').slice(0, 10);
        const storedName = `${crypto.randomUUID()}${ext}`;
        const dest = path.join(env.uploadDir, storedName);
        await pipeline(part.file, fs.createWriteStream(dest));
        const size = fs.statSync(dest).size;
        fileInfo = { filename: part.filename ?? 'arquivo', mimeType: part.mimetype, storedName, size };
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    if (!fileInfo) throw new AppError('Nenhum arquivo enviado.', 400);
    const parent = PARENT_FIELDS.find((f) => fields[f]);
    if (!parent) throw new AppError('Informe a que registro o anexo pertence.', 400);

    const attachment = await prisma.attachment.create({
      data: {
        filename: fileInfo.filename,
        storedName: fileInfo.storedName,
        mimeType: fileInfo.mimeType,
        size: fileInfo.size,
        uploadedById: req.authUser.id,
        [parent]: fields[parent],
      },
    });
    await audit({ userId: req.authUser.id, action: 'UPLOAD_ANEXO', entity: 'attachments', entityId: attachment.id, req, after: { filename: fileInfo.filename, parent, parentId: fields[parent] } });
    return reply.code(201).send(attachment);
  });

  /** Download protegido: valida acesso ao chamado dono do anexo antes de servir. */
  app.get('/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const att = await prisma.attachment.findUnique({ where: { id } });
    if (!att) throw new AppError('Anexo não encontrado.', 404);

    const u = req.authUser;
    const isTech = hasPermission(u.role, 'tickets.work') || hasPermission(u.role, 'audit.view');

    // Anexos de chamados (direto ou via comentário) respeitam a visibilidade do chamado;
    // anexo de comentário interno só para a TI, como o próprio comentário.
    const comment = att.commentId
      ? await prisma.ticketComment.findUnique({ where: { id: att.commentId }, select: { ticketId: true, isInternal: true } })
      : null;
    const ticketId = att.ticketId ?? comment?.ticketId;
    if (ticketId) {
      const ok = await prisma.ticket.findFirst({ where: { AND: [{ id: ticketId }, ticketScopeFor(u)] }, select: { id: true } });
      if (!ok) throw new AppError('Sem acesso a este anexo.', 403);
    }
    if (comment?.isInternal && !isTech) throw new AppError('Sem acesso a este anexo.', 403);
    // Sem vínculo nenhum = mídia do WhatsApp aguardando a escolha do menu — só a TI enxerga
    if (!PARENT_FIELDS.some((f) => att[f]) && !isTech) throw new AppError('Sem acesso a este anexo.', 403);

    const filePath = path.join(env.uploadDir, att.storedName);
    if (!fs.existsSync(filePath)) throw new AppError('Arquivo não encontrado no armazenamento.', 404);

    // Arquivos vindos de fora (WhatsApp) podem ter qualquer tipo: nunca deixar o navegador "adivinhar"
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Type', att.mimeType);
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(att.filename)}"`);
    return reply.send(fs.createReadStream(filePath));
  });
}

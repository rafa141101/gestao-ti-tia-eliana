import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { requestContext } from './context.js';

interface AuditInput {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  justification?: string | null;
  req?: FastifyRequest;
  origin?: string;
}

/** Grava um registro de auditoria imutável. Nunca lança para não quebrar o fluxo principal. */
export async function audit(input: AuditInput): Promise<void> {
  // Marca no contexto que esta entidade já foi auditada explicitamente —
  // evita o registro automático duplicado no fim da requisição.
  const ctx = requestContext.getStore();
  if (ctx) {
    ctx.audited.add(`${input.entity}:${input.entityId ?? 'many'}`);
    if (input.entityId) ctx.audited.add(`${input.entity}:many`);
  }
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        before: input.before === undefined ? undefined : JSON.parse(JSON.stringify(input.before)),
        after: input.after === undefined ? undefined : JSON.parse(JSON.stringify(input.after)),
        justification: input.justification ?? null,
        ip: input.req?.ip ?? null,
        userAgent: (input.req?.headers['user-agent'] as string | undefined) ?? null,
        origin: input.origin ?? 'api',
      },
    });
  } catch (err) {
    // Auditoria nunca deve derrubar a operação; loga no stderr para investigação.
    console.error('[audit] falha ao gravar log de auditoria:', err);
  }
}

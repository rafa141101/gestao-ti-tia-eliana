import { AsyncLocalStorage } from 'node:async_hooks';

export interface PendingMutation {
  table: string;
  entityId: string | null;
  action: 'AUTO_CRIACAO' | 'AUTO_EDICAO' | 'AUTO_EXCLUSAO';
  payload: unknown;
}

/**
 * Contexto por requisição (AsyncLocalStorage):
 * - identifica o usuário/IP para auditoria;
 * - coleta todas as mutações do Prisma na requisição;
 * - marca o que já foi auditado explicitamente pelas rotas.
 * No fim da requisição, mutações sem auditoria explícita geram um
 * registro automático — nenhuma rota consegue "esquecer" de auditar.
 */
export interface RequestContext {
  userId?: string;
  ip?: string;
  userAgent?: string;
  audited: Set<string>;
  mutations: PendingMutation[];
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function newRequestContext(ip?: string, userAgent?: string): RequestContext {
  return { ip, userAgent, audited: new Set(), mutations: [] };
}

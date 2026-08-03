import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Permission, Role } from '@gestao-ti/shared';
import { hasPermission } from '@gestao-ti/shared';
import { prisma } from '../db.js';
import { requestContext } from '../lib/context.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  unitId: string | null;
  departmentId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (perm: Permission) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('authUser', null as unknown as AuthUser);

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Sessão inválida ou expirada. Entre novamente.' });
    }
    const userId = req.user.sub;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, unitId: true, departmentId: true, active: true },
    });
    if (!user || !user.active) {
      return reply.code(401).send({ error: 'Usuário inativo ou inexistente.' });
    }
    req.authUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as Role,
      unitId: user.unitId,
      departmentId: user.departmentId,
    };
    const ctx = requestContext.getStore();
    if (ctx) ctx.userId = user.id;
  });

  app.decorate('requirePermission', (perm: Permission) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.authUser) {
        return reply.code(401).send({ error: 'Não autenticado.' });
      }
      if (!hasPermission(req.authUser.role, perm)) {
        return reply.code(403).send({ error: 'Sem permissão para esta ação.' });
      }
    };
  });
}

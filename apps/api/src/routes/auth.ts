import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { ROLE_PERMISSIONS, type Role } from '@gestao-ti/shared';

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'A nova senha deve ter no mínimo 8 caracteres'),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', {
    config: { rateLimit: { max: env.nodeEnv === 'test' ? 1000 : 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

    if (!user || !user.active) {
      await audit({ action: 'LOGIN_FAIL', entity: 'auth', entityId: email, req, after: { reason: 'usuario_inexistente_ou_inativo' } });
      throw new AppError('E-mail ou senha incorretos.', 401);
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await audit({ userId: user.id, action: 'LOGIN_FAIL', entity: 'auth', entityId: user.id, req });
      throw new AppError('E-mail ou senha incorretos.', 401);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await audit({ userId: user.id, action: 'LOGIN', entity: 'auth', entityId: user.id, req });

    const token = app.jwt.sign({ sub: user.id });
    return reply.send({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        unitId: user.unitId,
        departmentId: user.departmentId,
        permissions: ROLE_PERMISSIONS[user.role as Role],
      },
    });
  });

  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    const u = req.authUser;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      unitId: u.unitId,
      departmentId: u.departmentId,
      permissions: ROLE_PERMISSIONS[u.role],
    };
  });

  app.post('/change-password', { preHandler: [app.authenticate] }, async (req) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.authUser.id } });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new AppError('Senha atual incorreta.', 400);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    await audit({ userId: user.id, action: 'ALTERACAO_SENHA', entity: 'users', entityId: user.id, req });
    return { ok: true };
  });
}

import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { ROLES } from '@gestao-ti/shared';

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres'),
  role: z.enum(ROLES),
  phone: z.string().optional(),
  unitId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
});

const updateSchema = createSchema.partial().omit({ password: true }).extend({
  active: z.boolean().optional(),
});

/**
 * Regras de governança (seção 5 do escopo):
 * - Usuários OWNER (isProtected) não podem ser rebaixados/inativados por quem não é OWNER.
 * - O último OWNER ativo nunca pode ser inativado ou rebaixado (recuperação administrativa).
 * - Apenas OWNER pode criar ou promover usuários para OWNER/ADMIN.
 * - Usuários nunca são apagados: apenas inativados.
 */
export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Lista básica para seleção (atribuição, membros, etc.) — qualquer autenticado
  app.get('/options', async () => {
    return prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, role: true, unitId: true, departmentId: true },
      orderBy: { name: 'asc' },
    });
  });

  app.get('/', { preHandler: [app.requirePermission('admin.users')] }, async (req) => {
    const { includeInactive } = req.query as { includeInactive?: string };
    return prisma.user.findMany({
      where: includeInactive === 'true' ? {} : { active: true },
      select: {
        id: true, name: true, email: true, role: true, phone: true, active: true, isProtected: true,
        unitId: true, departmentId: true, lastLoginAt: true, createdAt: true,
        unit: { select: { name: true } }, department: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });
  });

  app.post('/', { preHandler: [app.requirePermission('admin.users')] }, async (req, reply) => {
    const data = createSchema.parse(req.body);
    if ((data.role === 'OWNER' || data.role === 'ADMIN') && req.authUser.role !== 'OWNER') {
      throw new AppError('Apenas a Diretoria (Owner) pode criar usuários Owner ou Administrador.', 403);
    }
    const exists = await prisma.user.findUnique({ where: { email: data.email.toLowerCase().trim() } });
    if (exists) throw new AppError('Já existe um usuário com este e-mail.', 409);

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase().trim(),
        passwordHash: await bcrypt.hash(data.password, 10),
        role: data.role,
        phone: data.phone,
        unitId: data.unitId ?? null,
        departmentId: data.departmentId ?? null,
        isProtected: data.role === 'OWNER',
      },
    });
    await audit({
      userId: req.authUser.id, action: 'CRIACAO', entity: 'users', entityId: user.id, req,
      after: { name: user.name, email: user.email, role: user.role },
    });
    return reply.code(201).send({ id: user.id });
  });

  app.patch('/:id', { preHandler: [app.requirePermission('admin.users')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = updateSchema.parse(req.body);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError('Usuário não encontrado.', 404);

    const actorIsOwner = req.authUser.role === 'OWNER';

    // Proteção do Owner
    if ((target.role === 'OWNER' || target.isProtected) && !actorIsOwner) {
      throw new AppError('Usuários da Diretoria (Owner) só podem ser alterados por outro Owner.', 403);
    }
    if ((data.role === 'OWNER' || data.role === 'ADMIN') && !actorIsOwner) {
      throw new AppError('Apenas a Diretoria (Owner) pode promover para Owner ou Administrador.', 403);
    }

    // Último Owner ativo nunca pode ser inativado/rebaixado
    const demoting = data.role !== undefined && data.role !== 'OWNER' && target.role === 'OWNER';
    const deactivating = data.active === false && target.active;
    if ((demoting || deactivating) && target.role === 'OWNER') {
      const owners = await prisma.user.count({ where: { role: 'OWNER', active: true, id: { not: id } } });
      if (owners === 0) {
        throw new AppError('Não é possível remover o último Owner ativo do sistema.', 400);
      }
    }

    const before = { name: target.name, email: target.email, role: target.role, active: target.active, unitId: target.unitId, departmentId: target.departmentId };
    const updated = await prisma.user.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email?.toLowerCase().trim(),
        role: data.role,
        phone: data.phone,
        unitId: data.unitId,
        departmentId: data.departmentId,
        active: data.active,
        isProtected: data.role === undefined ? undefined : data.role === 'OWNER',
      },
    });
    await audit({
      userId: req.authUser.id, action: 'EDICAO', entity: 'users', entityId: id, req,
      before, after: { name: updated.name, email: updated.email, role: updated.role, active: updated.active, unitId: updated.unitId, departmentId: updated.departmentId },
    });
    return { ok: true };
  });

  app.post('/:id/reset-password', { preHandler: [app.requirePermission('admin.users')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { newPassword } = z.object({ newPassword: z.string().min(8) }).parse(req.body);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError('Usuário não encontrado.', 404);
    if ((target.role === 'OWNER' || target.isProtected) && req.authUser.role !== 'OWNER') {
      throw new AppError('A senha de um Owner só pode ser redefinida por outro Owner.', 403);
    }
    await prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), failedLogins: 0, lockedUntil: null },
    });
    await audit({ userId: req.authUser.id, action: 'RESET_SENHA', entity: 'users', entityId: id, req });
    return { ok: true };
  });
}

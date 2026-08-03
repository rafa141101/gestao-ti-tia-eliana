import { prisma } from '../db.js';
import type { Role } from '@gestao-ti/shared';

export async function notifyUser(
  userId: string,
  type: string,
  title: string,
  body?: string,
  entity?: string,
  entityId?: string,
): Promise<void> {
  try {
    await prisma.notification.create({
      data: { userId, type, title, body: body ?? null, entity: entity ?? null, entityId: entityId ?? null },
    });
  } catch (err) {
    console.error('[notify] falha ao criar notificação:', err);
  }
}

export async function notifyRoles(
  roles: Role[],
  type: string,
  title: string,
  body?: string,
  entity?: string,
  entityId?: string,
): Promise<void> {
  const users = await prisma.user.findMany({ where: { role: { in: roles as never[] }, active: true }, select: { id: true } });
  await Promise.all(users.map((u) => notifyUser(u.id, type, title, body, entity, entityId)));
}

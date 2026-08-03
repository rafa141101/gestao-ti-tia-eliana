import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { DEFAULT_SETTINGS } from '@gestao-ti/shared';

const EDITABLE_KEYS = ['appName', 'autoCloseHours', 'wipLimit', 'whatsappCategoryId'] as const;

export async function settingsRoutes(app: FastifyInstance) {
  /** Configurações públicas (nome do sistema na tela de login). */
  app.get('/public', async () => {
    const appName = await prisma.systemSetting.findUnique({ where: { key: 'appName' } });
    return { appName: (appName?.value as string) ?? DEFAULT_SETTINGS.appName };
  });

  app.get('/', { preHandler: [app.authenticate] }, async () => {
    const rows = await prisma.systemSetting.findMany();
    const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) settings[r.key] = r.value;
    return settings;
  });

  app.patch('/', { preHandler: [app.authenticate, app.requirePermission('admin.settings')] }, async (req) => {
    const body = z.record(z.unknown()).parse(req.body);
    for (const key of Object.keys(body)) {
      if (!EDITABLE_KEYS.includes(key as never)) continue;
      const before = await prisma.systemSetting.findUnique({ where: { key } });
      await prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: body[key] as never },
        update: { value: body[key] as never },
      });
      await audit({
        userId: req.authUser.id, action: 'CONFIGURACAO', entity: 'system_settings', entityId: key, req,
        before: before ? { value: before.value } : undefined, after: { value: body[key] },
      });
    }
    return { ok: true };
  });
}

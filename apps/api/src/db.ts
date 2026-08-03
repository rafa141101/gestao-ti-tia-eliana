import { PrismaClient } from '@prisma/client';
import { requestContext } from './lib/context.js';

const base = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/** Modelos monitorados pela auditoria automática (nome do modelo → nome da tabela). */
const AUDITED_TABLES: Record<string, string> = {
  User: 'users',
  Ticket: 'tickets',
  Worklog: 'ticket_worklogs',
  TicketWatcher: 'ticket_watchers',
  TicketRelation: 'ticket_relations',
  Attachment: 'attachments',
  ThirdParty: 'third_parties',
  Project: 'projects',
  ProjectMember: 'project_members',
  ProjectTask: 'project_tasks',
  Routine: 'routines',
  RoutineExecution: 'routine_executions',
  Asset: 'assets',
  AssetCategory: 'asset_categories',
  AssetComponent: 'asset_components',
  AssetMovement: 'asset_movements',
  MaintenanceRecord: 'maintenance_records',
  Queue: 'queues',
  QueueMember: 'queue_members',
  Category: 'categories',
  Subcategory: 'subcategories',
  SlaPolicy: 'sla_policies',
  Holiday: 'holidays',
  Unit: 'units',
  Department: 'departments',
  Organization: 'organizations',
  SystemSetting: 'system_settings',
};

const ACTION_BY_OP: Record<string, 'AUTO_CRIACAO' | 'AUTO_EDICAO' | 'AUTO_EXCLUSAO'> = {
  create: 'AUTO_CRIACAO',
  createMany: 'AUTO_CRIACAO',
  update: 'AUTO_EDICAO',
  updateMany: 'AUTO_EDICAO',
  upsert: 'AUTO_EDICAO',
  delete: 'AUTO_EXCLUSAO',
  deleteMany: 'AUTO_EXCLUSAO',
};

/** Remove valores sensíveis do payload auditado. */
function sanitize(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value, (key, v) =>
      /password|senha|token|secret/i.test(key) ? '[REDACTED]' : v,
    ));
  } catch {
    return undefined;
  }
}

/**
 * Extensão do Prisma: registra toda mutação de modelos auditados no contexto
 * da requisição. O flush (app.ts, onResponse) grava auditoria automática para
 * o que a rota não auditou explicitamente. Fora de requisição (scheduler,
 * seed, testes diretos) nada é coletado — esses fluxos auditam por conta própria.
 */
export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);
        const action = ACTION_BY_OP[operation];
        const table = model ? AUDITED_TABLES[model] : undefined;
        const ctx = requestContext.getStore();
        if (action && table && ctx) {
          const anyResult = result as { id?: unknown } | null;
          const anyArgs = args as { where?: { id?: unknown }; data?: unknown };
          const id = anyResult?.id ?? anyArgs.where?.id ?? null;
          ctx.mutations.push({
            table,
            entityId: typeof id === 'string' ? id : null,
            action,
            payload: sanitize(anyArgs.data ?? anyArgs.where ?? null),
          });
        }
        return result;
      },
    },
  },
});

/** Cliente sem extensão — usado pelo flush de auditoria para evitar recursão. */
export const rawPrisma = base;

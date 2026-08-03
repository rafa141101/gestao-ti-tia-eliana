import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { notifyUser } from '../lib/notify.js';
import { PROJECT_STATUSES, TASK_STATUSES, PRIORITIES } from '@gestao-ti/shared';

const projectSchema = z.object({
  name: z.string().min(3),
  objective: z.string().optional(),
  justification: z.string().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  requesterId: z.string().uuid().nullable().optional(),
  sponsorId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  percentComplete: z.number().int().min(0).max(100).optional(),
  estimatedHours: z.number().nonnegative().nullable().optional(),
  blocks: z.string().nullable().optional(),
  risks: z.string().nullable().optional(),
  dependencies: z.string().nullable().optional(),
  infoOwnerArea: z.string().nullable().optional(),
});

const taskSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  estimatedHours: z.number().nonnegative().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v ? new Date(v) : null;
}

export async function projectRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requirePermission('projects.view'));

  app.get('/', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const projects = await prisma.project.findMany({
      where: {
        active: true,
        status: q.status ? { in: q.status.split(',') as never } : undefined,
      },
      include: {
        owner: { select: { id: true, name: true } },
        requester: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true } } } },
        _count: { select: { tasks: { where: { active: true } } } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    });
    // horas realizadas por projeto
    const hours = await prisma.worklog.groupBy({
      by: ['taskId'],
      where: { taskId: { not: null }, active: true },
      _sum: { durationMinutes: true },
    });
    const taskIds = hours.map((h) => h.taskId as string);
    const tasks = taskIds.length
      ? await prisma.projectTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, projectId: true } })
      : [];
    const byProject: Record<string, number> = {};
    for (const h of hours) {
      const t = tasks.find((x) => x.id === h.taskId);
      if (t) byProject[t.projectId] = (byProject[t.projectId] ?? 0) + (h._sum.durationMinutes ?? 0);
    }
    return projects.map((p) => ({ ...p, workedMinutes: byProject[p.id] ?? 0 }));
  });

  app.post('/', { preHandler: [app.requirePermission('projects.manage')] }, async (req, reply) => {
    const data = projectSchema.parse(req.body);
    const project = await prisma.project.create({
      data: {
        ...data,
        startDate: toDate(data.startDate),
        dueDate: toDate(data.dueDate),
        ownerId: data.ownerId ?? req.authUser.id,
      },
    });
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'projects', entityId: project.id, req, after: { name: project.name } });
    return reply.code(201).send(project);
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true } },
        requester: { select: { id: true, name: true } },
        sponsor: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true, role: true } } } },
        tasks: {
          where: { active: true },
          include: {
            assignee: { select: { id: true, name: true } },
            worklogs: { where: { active: true }, select: { durationMinutes: true } },
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        tickets: { select: { id: true, number: true, title: true, status: true } },
      },
    });
    if (!project) throw new AppError('Projeto não encontrado.', 404);
    const tasks = project.tasks.map((t) => ({
      ...t,
      workedMinutes: t.worklogs.reduce((a, w) => a + (w.durationMinutes ?? 0), 0),
      worklogs: undefined,
    }));
    const workedMinutes = tasks.reduce((a, t) => a + t.workedMinutes, 0);
    return { ...project, tasks, workedMinutes };
  });

  app.patch('/:id', { preHandler: [app.requirePermission('projects.manage')] }, async (req) => {
    const { id } = req.params as { id: string };
    const data = projectSchema.partial().parse(req.body);
    const before = await prisma.project.findUnique({ where: { id } });
    if (!before) throw new AppError('Projeto não encontrado.', 404);
    const after = await prisma.project.update({
      where: { id },
      data: { ...data, startDate: toDate(data.startDate), dueDate: toDate(data.dueDate) },
    });
    await audit({
      userId: req.authUser.id, action: 'EDICAO', entity: 'projects', entityId: id, req,
      before: { status: before.status, percentComplete: before.percentComplete }, after: data,
    });
    return after;
  });

  app.post('/:id/members', { preHandler: [app.requirePermission('projects.manage')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { userId, roleInProject } = z.object({ userId: z.string().uuid(), roleInProject: z.string().optional() }).parse(req.body);
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId } },
      create: { projectId: id, userId, roleInProject },
      update: { roleInProject },
    });
    return { ok: true };
  });

  app.delete('/:id/members/:userId', { preHandler: [app.requirePermission('projects.manage')] }, async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    await prisma.projectMember.delete({ where: { projectId_userId: { projectId: id, userId } } });
    return { ok: true };
  });

  // ---- Tarefas ----
  app.post('/:id/tasks', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = taskSchema.parse(req.body);
    const task = await prisma.projectTask.create({
      data: { ...data, projectId: id, dueDate: toDate(data.dueDate) },
    });
    if (task.assigneeId && task.assigneeId !== req.authUser.id) {
      await notifyUser(task.assigneeId, 'tarefa_atribuida', `Nova tarefa: ${task.title}`, undefined, 'project_tasks', task.id);
    }
    await audit({ userId: req.authUser.id, action: 'CRIACAO', entity: 'project_tasks', entityId: task.id, req, after: { title: task.title } });
    return reply.code(201).send(task);
  });

  app.patch('/tasks/:taskId', async (req) => {
    const { taskId } = req.params as { taskId: string };
    const data = taskSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    const before = await prisma.projectTask.findUnique({ where: { id: taskId } });
    if (!before) throw new AppError('Tarefa não encontrada.', 404);
    const after = await prisma.projectTask.update({
      where: { id: taskId },
      data: { ...data, dueDate: toDate(data.dueDate) },
    });
    if (data.assigneeId && data.assigneeId !== before.assigneeId && data.assigneeId !== req.authUser.id) {
      await notifyUser(data.assigneeId, 'tarefa_atribuida', `Tarefa atribuída: ${after.title}`, undefined, 'project_tasks', taskId);
    }
    await audit({ userId: req.authUser.id, action: 'EDICAO', entity: 'project_tasks', entityId: taskId, req, before: { status: before.status }, after: data });
    return after;
  });
}

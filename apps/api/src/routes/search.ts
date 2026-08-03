import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { hasPermission } from '@gestao-ti/shared';
import { ticketScopeFor } from './tickets.js';

/** Busca global: chamados, ativos e projetos num único campo (respeitando permissões). */
export async function searchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const { q } = req.query as { q?: string };
    const term = (q ?? '').trim();
    if (term.length < 2) return { tickets: [], assets: [], projects: [] };
    const u = req.authUser;

    const [tickets, assets, projects] = await Promise.all([
      prisma.ticket.findMany({
        where: {
          AND: [
            ticketScopeFor(u),
            {
              OR: [
                { number: { contains: term, mode: 'insensitive' } },
                { title: { contains: term, mode: 'insensitive' } },
              ],
            },
          ],
        },
        select: { id: true, number: true, title: true, status: true, priority: true },
        orderBy: { openedAt: 'desc' },
        take: 5,
      }),
      hasPermission(u.role, 'inventory.view')
        ? prisma.asset.findMany({
            where: {
              active: true,
              OR: [
                { code: { contains: term, mode: 'insensitive' } },
                { patrimonyCode: { contains: term, mode: 'insensitive' } },
                { description: { contains: term, mode: 'insensitive' } },
                { serialNumber: { contains: term, mode: 'insensitive' } },
                { hostname: { contains: term, mode: 'insensitive' } },
              ],
            },
            select: { id: true, code: true, description: true, status: true },
            take: 5,
          })
        : Promise.resolve([]),
      hasPermission(u.role, 'projects.view')
        ? prisma.project.findMany({
            where: { active: true, name: { contains: term, mode: 'insensitive' } },
            select: { id: true, name: true, status: true },
            take: 5,
          })
        : Promise.resolve([]),
    ]);

    return { tickets, assets, projects };
  });
}

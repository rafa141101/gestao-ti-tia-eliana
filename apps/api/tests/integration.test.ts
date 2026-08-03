import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createFixtures, login, auth, type Fixtures } from './helpers.js';
import { _internal } from '../src/scheduler.js';

let app: FastifyInstance;
let fx: Fixtures;
let tokens: Record<string, string>;

beforeAll(async () => {
  fx = await createFixtures();
  app = await buildApp();
  tokens = {
    owner: await login(app, fx.users.owner.email),
    admin: await login(app, fx.users.admin.email),
    gestor: await login(app, fx.users.gestor.email),
    tecnico: await login(app, fx.users.tecnico.email),
    solicitante: await login(app, fx.users.solicitante.email),
  };
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function novoChamado(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Chamado de teste',
    description: 'Descrição de teste do problema',
    categoryId: fx.categoryId,
    impact: 'UMA_PESSOA',
    urgency: 'PARCIALMENTE_PREJUDICADA',
    ...overrides,
  };
}

describe('Autenticação', () => {
  it('rejeita senha errada e audita a falha', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: fx.users.owner.email, password: 'errada123' } });
    expect(res.statusCode).toBe(401);
    const log = await prisma.auditLog.findFirst({ where: { action: 'LOGIN_FAIL' }, orderBy: { createdAt: 'desc' } });
    expect(log).toBeTruthy();
  });

  it('bloqueia acesso sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tickets' });
    expect(res.statusCode).toBe(401);
  });
});

describe('Criação de chamado e numeração concorrente', () => {
  it('cria chamado com número legível e SLA calculado', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.solicitante), payload: novoChamado() });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.number).toMatch(/^TI-\d{4}-\d{6}$/);
    expect(body.priority).toBe('P3');
    const t = await prisma.ticket.findUnique({ where: { id: body.id } });
    expect(t?.resolutionDueAt).toBeTruthy();
    expect(t?.firstResponseDueAt).toBeTruthy();
  });

  it('não gera números duplicados com 15 criações em paralelo', async () => {
    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.tecnico), payload: novoChamado() }),
      ),
    );
    const numbers = results.map((r) => r.json().number);
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    expect(new Set(numbers).size).toBe(15);
  });
});

describe('Permissões e visibilidade', () => {
  it('solicitante vê apenas os próprios chamados', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tickets?pageSize=100', headers: auth(tokens.solicitante) });
    const items = res.json().items as { requester: { id: string } }[];
    expect(items.length).toBeGreaterThan(0);
    // todos do próprio solicitante
    const all = await prisma.ticket.count();
    expect(items.length).toBeLessThan(all);
  });

  it('solicitante não pode mudar status nem exportar', async () => {
    const t = await prisma.ticket.findFirst();
    const s = await app.inject({ method: 'POST', url: `/api/tickets/${t!.id}/status`, headers: auth(tokens.solicitante), payload: { status: 'EM_ATENDIMENTO' } });
    expect(s.statusCode).toBe(403);
    const e = await app.inject({ method: 'GET', url: '/api/reports/export/tickets', headers: auth(tokens.solicitante) });
    expect(e.statusCode).toBe(403);
  });

  it('técnico não altera prioridade; gestor altera com justificativa obrigatória', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.solicitante), payload: novoChamado() });
    const id = created.json().id;

    const tec = await app.inject({ method: 'POST', url: `/api/tickets/${id}/priority`, headers: auth(tokens.tecnico), payload: { priority: 'P1', justification: 'teste de permissão' } });
    expect(tec.statusCode).toBe(403);

    const semJust = await app.inject({ method: 'POST', url: `/api/tickets/${id}/priority`, headers: auth(tokens.gestor), payload: { priority: 'P1', justification: '' } });
    expect(semJust.statusCode).toBe(400);

    const ok = await app.inject({ method: 'POST', url: `/api/tickets/${id}/priority`, headers: auth(tokens.gestor), payload: { priority: 'P1', justification: 'Loja parada confirmada por telefone' } });
    expect(ok.statusCode).toBe(200);

    const events = await prisma.ticketEvent.findMany({ where: { ticketId: id, type: 'PRIORIDADE' } });
    expect(events).toHaveLength(1);
    expect(events[0].fromValue).toBe('P3');
    expect(events[0].toValue).toBe('P1');
  });
});

describe('Proteção do Owner (governança)', () => {
  it('gestor de TI não acessa administração de usuários', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users', headers: auth(tokens.gestor) });
    expect(res.statusCode).toBe(403);
  });

  it('admin não pode rebaixar nem inativar um Owner', async () => {
    const demote = await app.inject({ method: 'PATCH', url: `/api/users/${fx.users.owner.id}`, headers: auth(tokens.admin), payload: { role: 'SOLICITANTE' } });
    expect(demote.statusCode).toBe(403);
    const deactivate = await app.inject({ method: 'PATCH', url: `/api/users/${fx.users.owner.id}`, headers: auth(tokens.admin), payload: { active: false } });
    expect(deactivate.statusCode).toBe(403);
  });

  it('nem o próprio Owner pode remover o último Owner ativo', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/users/${fx.users.owner.id}`, headers: auth(tokens.owner), payload: { active: false } });
    expect(res.statusCode).toBe(400);
  });

  it('apenas Owner cria usuários ADMIN/OWNER', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/users', headers: auth(tokens.admin),
      payload: { name: 'Novo Admin', email: 'novo.admin@teste.local', password: 'Senha@123', role: 'ADMIN' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Fluxo de resolução e reabertura', () => {
  it('resolver exige solução; reabrir exige motivo e conta reabertura', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.solicitante), payload: novoChamado() });
    const id = created.json().id;

    await app.inject({ method: 'POST', url: `/api/tickets/${id}/status`, headers: auth(tokens.tecnico), payload: { status: 'EM_ATENDIMENTO' } });

    const semSolucao = await app.inject({ method: 'POST', url: `/api/tickets/${id}/status`, headers: auth(tokens.tecnico), payload: { status: 'RESOLVIDO' } });
    expect(semSolucao.statusCode).toBe(400);

    const ok = await app.inject({ method: 'POST', url: `/api/tickets/${id}/status`, headers: auth(tokens.tecnico), payload: { status: 'RESOLVIDO', resolutionNotes: 'Cabo reconectado' } });
    expect(ok.statusCode).toBe(200);

    const semMotivo = await app.inject({ method: 'POST', url: `/api/tickets/${id}/reopen`, headers: auth(tokens.solicitante), payload: { reason: 'x' } });
    expect(semMotivo.statusCode).toBe(400);

    const reopened = await app.inject({ method: 'POST', url: `/api/tickets/${id}/reopen`, headers: auth(tokens.solicitante), payload: { reason: 'Problema voltou hoje cedo' } });
    expect(reopened.statusCode).toBe(200);

    const t = await prisma.ticket.findUnique({ where: { id } });
    expect(t?.status).toBe('EM_ATENDIMENTO');
    expect(t?.reopenedCount).toBe(1);
    const reopenEvent = await prisma.ticketEvent.findFirst({ where: { ticketId: id, type: 'REABERTURA' } });
    expect(reopenEvent?.justification).toContain('voltou');
  });

  it('transição inválida é rejeitada', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.solicitante), payload: novoChamado() });
    const id = created.json().id;
    const res = await app.inject({ method: 'POST', url: `/api/tickets/${id}/status`, headers: auth(tokens.tecnico), payload: { status: 'FECHADO' } });
    expect(res.statusCode).toBe(400);
  });

  it('status de espera pausa o SLA', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.solicitante), payload: novoChamado() });
    const id = created.json().id;
    await app.inject({ method: 'POST', url: `/api/tickets/${id}/status`, headers: auth(tokens.tecnico), payload: { status: 'EM_ATENDIMENTO' } });
    await app.inject({ method: 'POST', url: `/api/tickets/${id}/status`, headers: auth(tokens.tecnico), payload: { status: 'AGUARDANDO_SOLICITANTE' } });
    const paused = await prisma.ticket.findUnique({ where: { id } });
    expect(paused?.slaPausedAt).toBeTruthy();
    await app.inject({ method: 'POST', url: `/api/tickets/${id}/status`, headers: auth(tokens.tecnico), payload: { status: 'EM_ATENDIMENTO' } });
    const resumed = await prisma.ticket.findUnique({ where: { id } });
    expect(resumed?.slaPausedAt).toBeNull();
  });
});

describe('Apontamento de tempo', () => {
  it('registro manual, edição só com justificativa (auditada)', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.tecnico), payload: novoChamado() });
    const ticketId = created.json().id;

    const manual = await app.inject({
      method: 'POST', url: '/api/worklogs', headers: auth(tokens.tecnico),
      payload: {
        type: 'ATENDIMENTO_REMOTO', ticketId, description: 'Resolvido por WhatsApp e registrado depois',
        startedAt: new Date(Date.now() - 3600_000).toISOString(), endedAt: new Date().toISOString(),
      },
    });
    expect(manual.statusCode).toBe(201);
    const worklogId = manual.json().id;
    expect(manual.json().durationMinutes).toBe(60);

    const semJust = await app.inject({ method: 'PATCH', url: `/api/worklogs/${worklogId}`, headers: auth(tokens.tecnico), payload: { description: 'mudou' } });
    expect(semJust.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PATCH', url: `/api/worklogs/${worklogId}`, headers: auth(tokens.tecnico),
      payload: { description: 'Ajuste de descrição', editJustification: 'Descrição estava incompleta' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().editedById).toBe(fx.users.tecnico.id);

    const log = await prisma.auditLog.findFirst({ where: { action: 'ALTERACAO_TEMPO', entityId: worklogId } });
    expect(log?.justification).toContain('incompleta');
  });

  it('limite de WIP bloqueia terceiro chamado simultâneo (P1 fura)', async () => {
    // tecnico2 sem chamados: inicia dois
    const t1 = (await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.solicitante), payload: novoChamado() })).json();
    const t2 = (await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.solicitante), payload: novoChamado() })).json();
    const t3 = (await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.solicitante), payload: novoChamado() })).json();
    const p1 = (await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.solicitante), payload: novoChamado({ impact: 'UM_SETOR', urgency: 'OPERACAO_PARADA' }) })).json();
    expect(p1.priority).toBe('P1');

    const tok = await login(app, fx.users.tecnico2.email);
    // Assume e trabalha nos dois primeiros (worklog start muda status para EM_ATENDIMENTO)
    for (const t of [t1, t2]) {
      await app.inject({ method: 'POST', url: `/api/tickets/${t.id}/assign`, headers: auth(tok), payload: { assigneeId: fx.users.tecnico2.id } });
      const start = await app.inject({ method: 'POST', url: '/api/worklogs/start', headers: auth(tok), payload: { ticketId: t.id, type: 'ATENDIMENTO_REMOTO' } });
      expect(start.statusCode).toBe(201);
    }
    // Terceiro chamado comum: bloqueado pelo WIP
    await app.inject({ method: 'POST', url: `/api/tickets/${t3.id}/assign`, headers: auth(tok), payload: { assigneeId: fx.users.tecnico2.id } });
    const blocked = await app.inject({ method: 'POST', url: '/api/worklogs/start', headers: auth(tok), payload: { ticketId: t3.id, type: 'ATENDIMENTO_REMOTO' } });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toContain('limite');
    // P1 fura o limite
    const p1start = await app.inject({ method: 'POST', url: '/api/worklogs/start', headers: auth(tok), payload: { ticketId: p1.id, type: 'ATENDIMENTO_REMOTO' } });
    expect(p1start.statusCode).toBe(201);
  });
});

describe('Fechamento automático', () => {
  it('fecha chamado resolvido há mais tempo que o configurado', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(tokens.solicitante), payload: novoChamado() });
    const id = created.json().id;
    await app.inject({ method: 'POST', url: `/api/tickets/${id}/status`, headers: auth(tokens.tecnico), payload: { status: 'EM_ATENDIMENTO' } });
    await app.inject({ method: 'POST', url: `/api/tickets/${id}/status`, headers: auth(tokens.tecnico), payload: { status: 'RESOLVIDO', resolutionNotes: 'ok' } });
    // Simula 50h atrás
    await prisma.ticket.update({ where: { id }, data: { resolvedAt: new Date(Date.now() - 50 * 3600_000) } });

    await _internal.autoCloseResolved();

    const t = await prisma.ticket.findUnique({ where: { id } });
    expect(t?.status).toBe('FECHADO');
    const evt = await prisma.ticketEvent.findFirst({ where: { ticketId: id, type: 'FECHAMENTO' } });
    expect(evt?.comment).toContain('automaticamente');
  });
});

describe('Rotinas', () => {
  it('gera execução quando vence e avança o ponteiro', async () => {
    const routine = await prisma.routine.create({
      data: {
        name: 'Rotina Teste Diária', frequency: 'DIARIA', assigneeId: fx.users.tecnico.id,
        nextRunAt: new Date(Date.now() - 3600_000),
      },
    });
    await _internal.generateRoutineExecutions();
    const execs = await prisma.routineExecution.findMany({ where: { routineId: routine.id } });
    expect(execs).toHaveLength(1);
    const updated = await prisma.routine.findUnique({ where: { id: routine.id } });
    expect(updated!.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    // Não duplica na segunda varredura
    await _internal.generateRoutineExecutions();
    expect(await prisma.routineExecution.count({ where: { routineId: routine.id } })).toBe(1);
  });
});

describe('Inventário e movimentação', () => {
  it('gera código ATI, exige movimentação para mudar unidade e confirma destino', async () => {
    const otherUnit = await prisma.unit.create({ data: { organizationId: fx.orgId, name: 'Outra Unidade' } });
    const created = await app.inject({
      method: 'POST', url: '/api/assets', headers: auth(tokens.tecnico),
      payload: { description: 'Computador de teste', categoryId: fx.assetCategoryId, unitId: fx.unitId },
    });
    expect(created.statusCode).toBe(201);
    const asset = created.json();
    expect(asset.code).toMatch(/^ATI-\d{4}-\d{6}$/);
    expect(asset.publicId).toHaveLength(8);

    // Edição direta de unidade é bloqueada
    const directEdit = await app.inject({ method: 'PATCH', url: `/api/assets/${asset.id}`, headers: auth(tokens.tecnico), payload: { unitId: otherUnit.id } });
    expect(directEdit.statusCode).toBe(400);

    // Movimentação com fluxo
    const mov = await app.inject({
      method: 'POST', url: '/api/movements', headers: auth(tokens.tecnico),
      payload: { assetId: asset.id, type: 'TRANSFERENCIA_UNIDADE', toUnitId: otherUnit.id, reason: 'Transferência de teste' },
    });
    expect(mov.statusCode).toBe(201);
    const movId = mov.json().id;

    // Transição inválida
    const invalid = await app.inject({ method: 'POST', url: `/api/movements/${movId}/status`, headers: auth(tokens.tecnico), payload: { status: 'CONFIRMADA' } });
    expect(invalid.statusCode).toBe(400);

    for (const status of ['RETIRADA', 'RECEBIDA', 'CONFIRMADA']) {
      const r = await app.inject({ method: 'POST', url: `/api/movements/${movId}/status`, headers: auth(tokens.tecnico), payload: { status } });
      expect(r.statusCode).toBe(200);
    }
    const after = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(after?.unitId).toBe(otherUnit.id);
  });

  it('histórico de componente substituído permanece', async () => {
    const asset = (await app.inject({
      method: 'POST', url: '/api/assets', headers: auth(tokens.tecnico),
      payload: { description: 'PC com componentes', categoryId: fx.assetCategoryId, unitId: fx.unitId },
    })).json();
    const comp = (await app.inject({
      method: 'POST', url: `/api/assets/${asset.id}/components`, headers: auth(tokens.tecnico),
      payload: { type: 'Memória RAM', capacity: '8GB' },
    })).json();
    const removed = await app.inject({
      method: 'POST', url: `/api/assets/components/${comp.id}/remove`, headers: auth(tokens.tecnico),
      payload: { destination: 'ESTOQUE' },
    });
    expect(removed.statusCode).toBe(200);
    const kept = await prisma.assetComponent.findUnique({ where: { id: comp.id } });
    expect(kept?.status).toBe('ESTOQUE');
    expect(kept?.removedAt).toBeTruthy();
  });
});

describe('Imutabilidade no banco (triggers)', () => {
  it('impede UPDATE e DELETE em audit_logs', async () => {
    const log = await prisma.auditLog.findFirst();
    await expect(prisma.$executeRaw`UPDATE audit_logs SET action = 'HACK' WHERE id = ${log!.id}`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM audit_logs WHERE id = ${log!.id}`).rejects.toThrow();
  });

  it('impede DELETE físico de chamados e apontamentos', async () => {
    const t = await prisma.ticket.findFirst();
    await expect(prisma.$executeRaw`DELETE FROM tickets WHERE id = ${t!.id}`).rejects.toThrow();
    const w = await prisma.worklog.findFirst();
    if (w) await expect(prisma.$executeRaw`DELETE FROM ticket_worklogs WHERE id = ${w.id}`).rejects.toThrow();
  });
});

describe('Exportação autorizada', () => {
  it('owner exporta CSV e a exportação é auditada', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/export/tickets', headers: auth(tokens.owner) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('numero');
    const log = await prisma.auditLog.findFirst({ where: { action: 'EXPORTACAO' }, orderBy: { createdAt: 'desc' } });
    expect(log).toBeTruthy();
  });
});

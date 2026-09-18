import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';

export const SENHA = 'Teste@123';

export interface Fixtures {
  orgId: string;
  unitId: string;
  departmentId: string;
  categoryId: string;
  slaPolicyId: string;
  assetCategoryId: string;
  users: Record<'owner' | 'admin' | 'gestor' | 'tecnico' | 'tecnico2' | 'solicitante', { id: string; email: string }>;
}

/**
 * Cria estrutura mínima + usuários de cada perfil relevante (idempotente entre arquivos de teste).
 * Vitest roda arquivos de teste em paralelo, então isso é envolvido num advisory lock do Postgres
 * (escopo de transação) para serializar as chamadas concorrentes — sem o lock, dois arquivos podem
 * ver "não existe" ao mesmo tempo e colidir na criação (unique constraint em users.email).
 */
export async function createFixtures(): Promise<Fixtures> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727271)`;

    const existing = await tx.user.findUnique({ where: { email: 'owner@teste.local' } });
    if (existing) {
      const [org, unit, dept, sla, category, assetCategory, users] = await Promise.all([
        tx.organization.findFirstOrThrow(),
        tx.unit.findFirstOrThrow({ where: { name: 'Unidade Teste' } }),
        tx.department.findFirstOrThrow({ where: { name: 'Setor Teste' } }),
        tx.slaPolicy.findFirstOrThrow({ where: { name: 'SLA Teste' } }),
        tx.category.findFirstOrThrow({ where: { name: 'Categoria Teste' } }),
        tx.assetCategory.findFirstOrThrow({ where: { name: 'Computador' } }),
        tx.user.findMany({ where: { email: { endsWith: '@teste.local' } } }),
      ]);
      const byEmail = (email: string) => {
        const u = users.find((x) => x.email === email)!;
        return { id: u.id, email: u.email };
      };
      return {
        orgId: org.id, unitId: unit.id, departmentId: dept.id,
        categoryId: category.id, slaPolicyId: sla.id, assetCategoryId: assetCategory.id,
        users: {
          owner: byEmail('owner@teste.local'),
          admin: byEmail('admin@teste.local'),
          gestor: byEmail('gestor@teste.local'),
          tecnico: byEmail('tecnico@teste.local'),
          tecnico2: byEmail('tecnico2@teste.local'),
          solicitante: byEmail('solicitante@teste.local'),
        },
      };
    }
    const hash = await bcrypt.hash(SENHA, 4);
    const org = await tx.organization.create({ data: { name: 'Empresa Teste' } });
    const unit = await tx.unit.create({ data: { organizationId: org.id, name: 'Unidade Teste' } });
    const dept = await tx.department.create({ data: { unitId: unit.id, name: 'Setor Teste' } });
    const sla = await tx.slaPolicy.create({
      data: { name: 'SLA Teste', mode: 'CORRIDO', isDefault: true },
    });
    const category = await tx.category.create({ data: { name: 'Categoria Teste', slaPolicyId: sla.id } });
    const assetCategory = await tx.assetCategory.create({ data: { name: 'Computador' } });

    const mk = (name: string, email: string, role: string, isProtected = false) =>
      tx.user.create({
        data: { name, email, passwordHash: hash, role: role as never, unitId: unit.id, departmentId: dept.id, isProtected },
      });

    const owner = await mk('Owner Teste', 'owner@teste.local', 'OWNER', true);
    const admin = await mk('Admin Teste', 'admin@teste.local', 'ADMIN');
    const gestor = await mk('Gestor Teste', 'gestor@teste.local', 'GESTOR_TI');
    const tecnico = await mk('Tecnico Teste', 'tecnico@teste.local', 'TECNICO');
    const tecnico2 = await mk('Tecnico Dois', 'tecnico2@teste.local', 'TECNICO');
    const solicitante = await mk('Solicitante Teste', 'solicitante@teste.local', 'SOLICITANTE');

    return {
      orgId: org.id,
      unitId: unit.id,
      departmentId: dept.id,
      categoryId: category.id,
      slaPolicyId: sla.id,
      assetCategoryId: assetCategory.id,
      users: {
        owner: { id: owner.id, email: owner.email },
        admin: { id: admin.id, email: admin.email },
        gestor: { id: gestor.id, email: gestor.email },
        tecnico: { id: tecnico.id, email: tecnico.email },
        tecnico2: { id: tecnico2.id, email: tecnico2.email },
        solicitante: { id: solicitante.id, email: solicitante.email },
      },
    };
  }, { timeout: 20_000 });
}

export async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: SENHA },
  });
  if (res.statusCode !== 200) throw new Error(`login falhou para ${email}: ${res.body}`);
  return res.json().token as string;
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

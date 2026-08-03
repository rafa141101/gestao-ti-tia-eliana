import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const TEST_DB = process.env.TEST_DATABASE_URL
  ?? 'postgresql://gestao:gestao-ti-dev-2026@localhost:5433/gestao_ti_test?schema=public';

const cwd = fileURLToPath(new URL('..', import.meta.url));

/**
 * Prepara o banco de TESTE (gestao_ti_test) do zero:
 * 1. `migrate deploy` cria o banco caso não exista;
 * 2. o schema `public` é recriado (somente no banco de teste);
 * 3. as migrations são aplicadas no schema limpo.
 * Nunca aponta para o banco de desenvolvimento/produção.
 */
export default async function setup() {
  if (!/test/i.test(TEST_DB)) {
    throw new Error('TEST_DATABASE_URL deve apontar para um banco de teste (nome contendo "test").');
  }
  const env = { ...process.env, DATABASE_URL: TEST_DB };

  execSync('npx prisma migrate deploy', { env, stdio: 'inherit', cwd });

  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  await prisma.$disconnect();

  execSync('npx prisma migrate deploy', { env, stdio: 'inherit', cwd });
}

import type { PrismaClient } from '@prisma/client';
import { ticketNumberFor, assetCodeFor } from '@gestao-ti/shared';

/** Tipo estrutural mínimo — aceita tanto o cliente base quanto o estendido (auto-auditoria). */
type Tx = Pick<PrismaClient, '$executeRaw' | '$queryRaw'>;

/**
 * Próximo número sequencial por escopo/ano.
 * Usa INSERT ... ON CONFLICT + SELECT ... FOR UPDATE: seguro em concorrência,
 * nunca gera duplicidade (padrão herdado do Manutrixia).
 */
export async function nextSequence(tx: Tx, scope: 'TICKET' | 'ASSET', year: number): Promise<number> {
  await tx.$executeRaw`INSERT INTO counters (scope, year, next) VALUES (${scope}, ${year}, 1) ON CONFLICT (scope, year) DO NOTHING`;
  const rows = await tx.$queryRaw<{ next: number }[]>`SELECT next FROM counters WHERE scope = ${scope} AND year = ${year} FOR UPDATE`;
  const n = Number(rows[0].next);
  await tx.$executeRaw`UPDATE counters SET next = next + 1 WHERE scope = ${scope} AND year = ${year}`;
  return n;
}

export async function nextTicketNumber(tx: Tx, now = new Date()): Promise<string> {
  const year = now.getFullYear();
  const seq = await nextSequence(tx, 'TICKET', year);
  return ticketNumberFor(year, seq);
}

export async function nextAssetCode(tx: Tx, now = new Date()): Promise<string> {
  const year = now.getFullYear();
  const seq = await nextSequence(tx, 'ASSET', year);
  return assetCodeFor(year, seq);
}

/** Identificador público curto para QR Code — sem caracteres ambíguos (I, O, 0, 1). */
export function generatePublicId(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

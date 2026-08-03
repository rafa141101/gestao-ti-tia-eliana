/**
 * Importação única do levantamento manual de inventário da Indústria
 * (planilha Registros-dispositivos-industria.xlsx, convertida para JSON
 * em prisma/import-industria.json). Idempotente: pula quem já tem o
 * mesmo patrimonyCode cadastrado, então pode ser rodado de novo com
 * segurança se a planilha for atualizada.
 *
 * Uso: docker compose exec api npx tsx prisma/import-industria.ts
 */
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextAssetCode, generatePublicId } from '../src/lib/numbers.js';

const prisma = new PrismaClient();
const dataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'import-industria.json');

interface ComputerRow {
  numero: number; local: string; ip: string | null; modo_ip: string | null; tipo: string;
  processador: string | null; ram: string | null; armazenamento_tipo: string | null;
  armazenamento_qtd: string | null; alimentacao: string | null; chaveada: string | null;
  monitor_numero: number | string | null; usuario: string | null;
}
interface MonitorRow {
  numero: number; local: string; dispositivo: number | string | null; tamanho: string | null;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as { computers: ComputerRow[]; monitors: MonitorRow[] };

  const industria = await prisma.unit.findFirst({ where: { name: 'Indústria' } });
  if (!industria) throw new Error('Unidade "Indústria" não encontrada — rode o seed antes de importar.');

  const catComputador = await prisma.assetCategory.findFirst({ where: { name: 'Computador' } });
  const catNotebook = await prisma.assetCategory.findFirst({ where: { name: 'Notebook' } });
  const catMonitor = await prisma.assetCategory.findFirst({ where: { name: 'Monitor' } });
  if (!catComputador || !catNotebook || !catMonitor) {
    throw new Error('Categorias de ativo (Computador/Notebook/Monitor) não encontradas — rode o seed antes de importar.');
  }

  const importer = await prisma.user.findFirst({ where: { email: 'inventariante@tiaeliana.com.br' } })
    ?? await prisma.user.findFirst({ where: { role: 'OWNER' } });

  let createdComputers = 0;
  let skippedComputers = 0;
  const patrimonyToAssetId = new Map<string, string>();

  for (const row of raw.computers) {
    const patrimonyCode = String(row.numero);
    const existing = await prisma.asset.findFirst({ where: { patrimonyCode } });
    if (existing) {
      skippedComputers++;
      patrimonyToAssetId.set(patrimonyCode, existing.id);
      continue;
    }

    const category = row.tipo === 'Notebook' ? catNotebook : catComputador;
    const specs: Record<string, unknown> = {
      processador: row.processador ?? undefined,
      ram: row.ram ?? undefined,
      armazenamento: [row.armazenamento_tipo, row.armazenamento_qtd].filter(Boolean).join(' '),
      alimentacao: row.alimentacao ?? undefined,
      modoIp: row.modo_ip ?? undefined,
      chaveada: row.chaveada ?? undefined,
    };
    const notesParts: string[] = [];
    if (row.usuario && row.usuario !== '-') notesParts.push(`Usuário principal informado no levantamento: ${row.usuario}`);
    notesParts.push('Importado do levantamento manual (Registros-dispositivos-industria.xlsx).');

    const asset = await prisma.$transaction(async (tx) => {
      const code = await nextAssetCode(tx);
      return tx.asset.create({
        data: {
          code,
          publicId: generatePublicId(),
          patrimonyCode,
          categoryId: category.id,
          kind: 'ATIVO_INDIVIDUAL',
          description: `${row.tipo} — ${row.local}`,
          unitId: industria.id,
          location: row.local,
          ip: row.ip && row.ip !== '-' ? row.ip : null,
          status: 'EM_USO',
          specs: specs as never,
          notes: notesParts.join(' '),
          createdById: importer?.id,
        },
      });
    });
    patrimonyToAssetId.set(patrimonyCode, asset.id);
    createdComputers++;
  }

  let createdMonitors = 0;
  let skippedMonitors = 0;

  for (const row of raw.monitors) {
    const patrimonyCode = String(row.numero);
    const existing = await prisma.asset.findFirst({ where: { patrimonyCode } });
    if (existing) {
      skippedMonitors++;
      continue;
    }
    const linkedComputerId = row.dispositivo && row.dispositivo !== '-' ? patrimonyToAssetId.get(String(row.dispositivo)) : undefined;
    const linkedComputer = linkedComputerId ? await prisma.asset.findUnique({ where: { id: linkedComputerId }, select: { code: true } }) : null;

    await prisma.$transaction(async (tx) => {
      const code = await nextAssetCode(tx);
      await tx.asset.create({
        data: {
          code,
          publicId: generatePublicId(),
          patrimonyCode,
          categoryId: catMonitor.id,
          kind: 'ATIVO_INDIVIDUAL',
          description: `Monitor ${row.tamanho ?? ''} — ${row.local}`.trim(),
          unitId: industria.id,
          location: row.local,
          status: 'EM_USO',
          specs: { tamanho: row.tamanho ?? undefined } as never,
          notes: [
            linkedComputer ? `Vinculado ao equipamento ${linkedComputer.code} (patrimônio ${row.dispositivo}).` : null,
            'Importado do levantamento manual (Registros-dispositivos-industria.xlsx).',
          ].filter(Boolean).join(' '),
          createdById: importer?.id,
        },
      });
    });
    createdMonitors++;
  }

  console.log(`Computadores: ${createdComputers} criados, ${skippedComputers} já existiam.`);
  console.log(`Monitores: ${createdMonitors} criados, ${skippedMonitors} já existiam.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

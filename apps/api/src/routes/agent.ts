import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { nextAssetCode, generatePublicId } from '../lib/numbers.js';
import type { Prisma } from '@prisma/client';

/**
 * Agente de inventário — coleta automática de hardware/software das máquinas.
 *
 * Coleta APENAS dados do equipamento (configuração, software instalado, saúde
 * do disco, antivírus). Não coleta uso de aplicações, telas, teclado, sites
 * nem qualquer comportamento de quem usa a máquina — isso é uma decisão
 * separada, que exige política e comunicação prévia aos funcionários (LGPD).
 *
 * Autenticação por token compartilhado (AGENT_TOKEN), não por login de usuário:
 * o agente roda como tarefa agendada, sem alguém logado. Sem o token definido
 * no .env, a coleta fica desligada e nenhuma rota aqui aceita dados.
 */

const softwareSchema = z.object({
  name: z.string().min(1).max(300),
  version: z.string().max(100).nullish(),
  publisher: z.string().max(200).nullish(),
  installedAt: z.string().nullish(),
});

const reportSchema = z.object({
  agentVersion: z.string().max(20),
  hostname: z.string().min(1).max(120),
  serialNumber: z.string().max(120).nullish(),
  mac: z.string().max(50).nullish(),
  ip: z.string().max(60).nullish(),
  os: z.string().max(200).nullish(),
  manufacturer: z.string().max(120).nullish(),
  model: z.string().max(120).nullish(),
  /// Configuração coletada (processador, memória, discos, antivírus, BIOS…)
  specs: z.record(z.unknown()).optional(),
  softwares: z.array(softwareSchema).max(1000).optional(),
});

type ReportBody = z.infer<typeof reportSchema>;

/** Normaliza MAC para comparação (só hex, maiúsculo). */
function normalizeMac(mac: string | null | undefined): string | null {
  if (!mac) return null;
  const clean = mac.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return clean.length === 12 ? clean : null;
}

/**
 * Muitas placas-mãe (principalmente de PCs montados) devolvem um texto genérico
 * no lugar do número de série. Se aceitos, TODAS essas máquinas casariam entre
 * si como se fossem o mesmo equipamento — foi o que aconteceu no teste com
 * "None". Só serial de verdade é aceito como identificador.
 */
const SERIAIS_INVALIDOS = new Set([
  'none', 'null', 'n/a', 'na', 'default string', 'to be filled by o.e.m.',
  'system serial number', 'chassis serial number', 'not applicable',
  'not specified', 'unknown', 'invalid', 'oem', 'serial', '0', '00000000',
  '000000000000', '123456789', 'x', 'xxxxxxx',
]);

function serialUtil(serial: string | null | undefined): string | null {
  const s = serial?.trim();
  if (!s || s.length < 4) return null;
  if (SERIAIS_INVALIDOS.has(s.toLowerCase())) return null;
  // Sequências de um caractere só ("0000000", "-------")
  if (/^(.)\1+$/.test(s)) return null;
  return s;
}

/**
 * Encontra o ativo correspondente à máquina que reportou, em cascata:
 * número de série → hostname → MAC. Todos são identificadores estáveis.
 *
 * IP DE PROPÓSITO NÃO CASA AUTOMATICAMENTE: com DHCP o endereço troca de dono
 * (aconteceu no primeiro teste — o IP de um equipamento da planilha já
 * pertencia a outra máquina, e o casamento sobrescreveu o cadastro errado).
 * Quando só o IP bate, a máquina entra como descoberta com uma sugestão de
 * vínculo para o inventariante confirmar; depois disso o serial/hostname fica
 * gravado e o casamento passa a ser automático e confiável.
 */
async function matchAsset(body: ReportBody) {
  const serial = serialUtil(body.serialNumber);
  if (serial) {
    const bySerial = await prisma.asset.findFirst({ where: { serialNumber: serial, active: true } });
    if (bySerial) return { asset: bySerial, matchedBy: 'serialNumber' as const, suggestion: null };
  }

  const byHostname = await prisma.asset.findFirst({
    where: { hostname: { equals: body.hostname, mode: 'insensitive' }, active: true },
  });
  if (byHostname) return { asset: byHostname, matchedBy: 'hostname' as const, suggestion: null };

  const mac = normalizeMac(body.mac);
  if (mac) {
    // MAC pode estar gravado com separadores diferentes — compara normalizado
    const candidates = await prisma.asset.findMany({
      where: { mac: { not: null }, active: true },
      select: { id: true, mac: true },
    });
    const hit = candidates.find((c) => normalizeMac(c.mac) === mac);
    if (hit) {
      const asset = await prisma.asset.findUnique({ where: { id: hit.id } });
      if (asset) return { asset, matchedBy: 'mac' as const, suggestion: null };
    }
  }

  // Só o IP bate: vira sugestão para conferência humana, nunca vínculo automático
  let suggestion: { id: string; code: string; description: string } | null = null;
  if (body.ip) {
    const byIp = await prisma.asset.findFirst({
      where: { ip: body.ip, active: true },
      select: { id: true, code: true, description: true },
    });
    if (byIp) suggestion = byIp;
  }

  return { asset: null, matchedBy: null, suggestion };
}

export async function agentRoutes(app: FastifyInstance) {
  /** Autenticação do agente por token compartilhado. */
  async function requireAgentToken(req: FastifyRequest, reply: FastifyReply) {
    if (!env.agentToken) {
      return reply.code(503).send({ error: 'Coleta automática desativada (AGENT_TOKEN não configurado).' });
    }
    const header = req.headers['x-agent-token'];
    if (header !== env.agentToken) {
      return reply.code(401).send({ error: 'Token do agente inválido.' });
    }
  }

  /** Recebe a coleta de uma máquina. Cria o ativo se ainda não existir. */
  app.post('/report', {
    preHandler: [requireAgentToken],
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = reportSchema.parse(req.body);
    const now = new Date();

    const { asset, matchedBy, suggestion } = await matchAsset(body);

    // Dados que o agente é fonte da verdade — sempre atualizados na coleta
    const collected = {
      hostname: body.hostname,
      ip: body.ip ?? undefined,
      mac: body.mac ?? undefined,
      os: body.os ?? undefined,
      lastSeenAt: now,
      agentVersion: body.agentVersion,
      specs: (body.specs ?? undefined) as Prisma.InputJsonValue | undefined,
    };

    let assetId: string;
    let created = false;

    if (asset) {
      assetId = asset.id;
      await prisma.asset.update({
        where: { id: asset.id },
        data: {
          ...collected,
          // Só preenche se estiver vazio — não sobrescreve o que a TI cadastrou à mão
          serialNumber: asset.serialNumber ?? serialUtil(body.serialNumber) ?? undefined,
          brand: asset.brand ?? body.manufacturer ?? undefined,
          model: asset.model ?? body.model ?? undefined,
        },
      });
    } else {
      // Máquina desconhecida: cadastra para o inventariante conferir depois
      const category =
        (await prisma.assetCategory.findFirst({ where: { name: 'Computador', active: true } })) ??
        (await prisma.assetCategory.findFirst({ where: { active: true } }));
      if (!category) throw new AppError('Nenhuma categoria de ativo cadastrada.', 500);

      const newAsset = await prisma.$transaction(async (tx) => {
        const code = await nextAssetCode(tx, now);
        return tx.asset.create({
          data: {
            code,
            publicId: generatePublicId(),
            categoryId: category.id,
            description: `${body.manufacturer ?? 'Equipamento'} ${body.model ?? ''}`.trim() || body.hostname,
            serialNumber: serialUtil(body.serialNumber),
            brand: body.manufacturer ?? null,
            model: body.model ?? null,
            status: 'EM_USO',
            discoveredByAgent: true,
            notes: suggestion
              ? `Descoberto pelo agente. ATENÇÃO: o IP ${body.ip} está cadastrado em ${suggestion.code} (${suggestion.description}). ` +
                'Confira se é o mesmo equipamento — se for, use "Vincular a ativo existente"; se não, o IP do outro cadastro está desatualizado.'
              : 'Descoberto automaticamente pelo agente de inventário — confira e complete o cadastro.',
            ...collected,
          },
        });
      });
      assetId = newAsset.id;
      created = true;
      await audit({
        action: 'DESCOBERTA_AGENTE', entity: 'assets', entityId: assetId, origin: 'agent',
        after: { code: newAsset.code, hostname: body.hostname, ip: body.ip, sugestao: suggestion?.code ?? null },
      });
    }

    // Software instalado: substitui o retrato anterior por completo
    if (body.softwares) {
      const seen = new Set<string>();
      const rows = body.softwares
        .filter((s) => {
          const key = `${s.name}|${s.version ?? ''}`;
          if (seen.has(key)) return false; // planilha do Windows repete entradas
          seen.add(key);
          return true;
        })
        .map((s) => ({
          assetId,
          name: s.name,
          version: s.version ?? null,
          publisher: s.publisher ?? null,
          installedAt: s.installedAt ? new Date(s.installedAt) : null,
          collectedAt: now,
        }))
        .filter((s) => !s.installedAt || !Number.isNaN(s.installedAt.getTime()));

      await prisma.$transaction([
        prisma.assetSoftware.deleteMany({ where: { assetId } }),
        prisma.assetSoftware.createMany({ data: rows, skipDuplicates: true }),
      ]);
    }

    // Máquina reportou: se estava pendente na descoberta de rede, sai da lista
    if (body.ip) {
      await prisma.networkDiscovery.deleteMany({ where: { ip: body.ip } });
    }

    return reply.send({ ok: true, assetId, created, matchedBy, suggestion: suggestion?.code ?? null });
  });

  /** Recebe a varredura de rede (executada por uma máquina com o agente). */
  app.post('/network-scan', {
    preHandler: [requireAgentToken],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { hosts } = z.object({
      hosts: z.array(z.object({
        ip: z.string().max(60),
        mac: z.string().max(50).nullish(),
        hostname: z.string().max(120).nullish(),
        vendor: z.string().max(120).nullish(),
      })).max(1024),
    }).parse(req.body);

    const now = new Date();
    let novos = 0;

    for (const host of hosts) {
      const mac = normalizeMac(host.mac);
      // Já está no inventário? Então não é "descoberta"
      const known = await prisma.asset.findFirst({
        where: {
          active: true,
          OR: [
            { ip: host.ip },
            ...(host.hostname ? [{ hostname: { equals: host.hostname, mode: 'insensitive' as const } }] : []),
          ],
        },
        select: { id: true },
      });
      if (known) continue;

      const existing = await prisma.networkDiscovery.findFirst({
        where: { ip: host.ip, mac: mac ?? null },
      });
      if (existing) {
        await prisma.networkDiscovery.update({
          where: { id: existing.id },
          data: { lastSeen: now, hostname: host.hostname ?? existing.hostname, vendor: host.vendor ?? existing.vendor },
        });
      } else {
        await prisma.networkDiscovery.create({
          data: { ip: host.ip, mac, hostname: host.hostname ?? null, vendor: host.vendor ?? null, firstSeen: now, lastSeen: now },
        });
        novos++;
      }
    }

    return reply.send({ ok: true, recebidos: hosts.length, novos });
  });

  /** Status da coleta — usado na tela de Configurações. */
  app.get('/status', { preHandler: [app.authenticate] }, async () => {
    const [comAgente, online, descobertos, pendentesRede] = await Promise.all([
      prisma.asset.count({ where: { active: true, lastSeenAt: { not: null } } }),
      prisma.asset.count({ where: { active: true, lastSeenAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
      prisma.asset.count({ where: { active: true, discoveredByAgent: true } }),
      prisma.networkDiscovery.count({ where: { ignored: false } }),
    ]);
    return {
      configured: Boolean(env.agentToken),
      comAgente,
      online,
      descobertos,
      pendentesRede,
      endpoint: '/api/agent/report',
    };
  });
}

# Estratégia de migração futura — Gestão TI Tia Eliana

O sistema nasceu independente **de propósito**, para validação. Este documento explica os caminhos possíveis depois da validação, sem retrabalho.

## 1. Continuar independente (caminho padrão)

Nada a fazer. O compose roda em qualquer máquina da rede interna com Docker; backups via scripts. Recomendações se continuar: mover para um servidor dedicado, agendar `backup.sh` (Task Scheduler/cron) e versionar o repositório no GitHub privado.

## 2. Incorporar ao Mão na Roda

- O frontend é uma SPA React isolada; pode virar um módulo/rota do Mão na Roda mantendo a API própria (`/api` proxied), ou ter as telas migradas gradualmente.
- O domínio (enums, matriz de prioridade/permissões, rótulos) está isolado em `packages/shared` — publicável como pacote interno e importável pelo Mão na Roda.
- A API é REST stateless com JWT; basta o Mão na Roda emitir/aceitar o mesmo token (ver §4).

## 3. Migrar o banco para infraestrutura online (ex.: Supabase)

- O schema é PostgreSQL puro (enums nativos, triggers, FKs). `pg_dump`/`pg_restore` levam tudo — os scripts `export-db.sh`/`backup.sh` já geram o artefato.
- Passos: criar projeto Postgres online → `pg_restore` → apontar `DATABASE_URL` da API → manter a API onde está (ou movê-la junto).
- Se for Supabase: as triggers de imutabilidade funcionam sem mudança; RLS é opcional porque a autorização é feita na API (se o acesso direto ao banco for exposto, aí sim replicar as regras como policies — o padrão de `has_role` do Manutrixia serve de referência).

## 4. Compartilhar usuários/empresas com outro sistema (SSO)

- A autenticação é um módulo pequeno (`routes/auth.ts` + `plugins/auth.ts`). Para SSO:
  1. manter a tabela `users` como espelho local (perfil/permissões continuam aqui);
  2. substituir o login local por validação do token do provedor (Supabase Auth, Keycloak, etc.), mapeando `sub`/e-mail → usuário local;
  3. `organizations/units/departments` já seguem o formato do Manutrixia (companies) — a unificação é um de-para direto.

## 5. Migrar o inventário para o Manutrixia

O modelo foi desenhado espelhando os conceitos do Manutrixia (máquinas ⇄ ativos, categorias com contador, QR public_id, eventos):

| Gestão TI | Manutrixia |
| --- | --- |
| assets | machines |
| asset_categories | machine_categories |
| asset_components | machine_parts / machine_specs |
| maintenance_records | work_orders (concluídas) |
| asset_movements | (novo lá — levar o conceito) |
| publicId (QR) | public_id (QR) |

A exportação CSV de `assets`/`components`/`maintenance` já sai no formato tabular para importação; para migração fiel, um script SQL de de-para é simples porque ambos são Postgres.

## 6. Reutilizar a lógica em outra aplicação

- `packages/shared` não tem dependências — funciona em qualquer projeto TS (front ou back).
- Padrões reutilizáveis já isolados: numeração concorrente (`lib/numbers.ts`), SLA comercial (`lib/sla.ts`), auditoria (`lib/audit.ts`), fluxo de status validado (maps de transição no shared).

## O que NÃO fazer

- Não criar dependência do Manutrixia em runtime — a referência foi conceitual.
- Não expor o Postgres diretamente na rede sem RLS/policies.
- Não integrar WhatsApp/e-mail direto no core: criar camada de integração (o campo `channel` e as notificações internas já preveem isso).

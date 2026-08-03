# Gestão TI — Tia Eliana

Sistema interno de gestão da equipe de TI: **chamados e atendimentos**, **trabalho diário da equipe**, **projetos**, **rotinas recorrentes**, **inventário de equipamentos**, **manutenções**, **movimentações**, **indicadores gerenciais** e **auditoria completa** — com governança pela diretoria.

O nome do sistema é configurável em **Administração → Configurações**.

## Visão geral

| Camada | Tecnologia |
| --- | --- |
| Frontend | React 18 + Vite + TypeScript + Tailwind (pt-BR, responsivo) |
| API | Node.js 22 + Fastify 5 + TypeScript + Zod |
| Banco | PostgreSQL 16 + Prisma (migrations versionadas) |
| Infra | Docker Compose (db + api + web/nginx), anexos em volume local |
| Monorepo | npm workspaces: `apps/api`, `apps/web`, `packages/shared` |

Documentação completa em [`docs/`](docs/): [arquitetura](docs/architecture.md) · [regras de negócio](docs/business-rules.md) · [permissões](docs/permissions.md) · [modelo de dados](docs/data-model.md) · [manual da diretoria](docs/owner-manual.md) · [migração](docs/migration-strategy.md) · [RUNBOOK](docs/RUNBOOK.md) · [SECURITY](docs/SECURITY.md) · **[implantar numa VM nova](docs/VM_SETUP.md)** · **[ativar o WhatsApp](docs/WHATSAPP_SETUP.md)**.

## Implantação em produção (VM dedicada)

Para colocar o sistema numa VM própria (fora desta máquina de desenvolvimento), **não precisa do código-fonte nem compilar nada** — as imagens Docker já estão publicadas (privadas) em `ghcr.io/rafa141101/gestao-ti-tia-eliana-{api,web}`. É só instalar Docker na VM e usar o [`docker-compose.production.yml`](docker-compose.production.yml) + [`.env.production.example`](.env.production.example).

Passo a passo completo, incluindo autenticação no registro de imagens: **[docs/VM_SETUP.md](docs/VM_SETUP.md)**.
Código-fonte versionado em: https://github.com/rafa141101/gestao-ti-tia-eliana (privado).

Destaques além do escopo básico: busca global (chamados/ativos/projetos), **distribuição automática de chamados por rodízio** (fila em modo round-robin), **auditoria automática** de qualquer mutação não auditada explicitamente, rate-limit global e **integração WhatsApp via API oficial da Meta** (opcional — mensagens viram chamados; respostas da TI voltam na conversa dentro da janela de serviço de 24h, sem custo).

## Requisitos

- Docker + Docker Compose (produção interna) **ou** Node.js ≥ 20 + PostgreSQL 16 (desenvolvimento)
- Não depende de internet nem de serviços em nuvem

## Instalação com Docker (recomendada)

```bash
# 1. Configure as variáveis (troque as senhas!)
cp .env.example .env

# 2. Suba tudo (na primeira vez o build demora alguns minutos)
docker compose up -d --build

# 3. Popule os dados iniciais (uma única vez)
docker compose exec api npx prisma db seed
```

Acesse **http://localhost:8090** (porta configurável via `WEB_PORT`).

> **Windows + pasta com acento:** o BuildKit do Docker falha se o caminho do projeto tiver acentos (ex.: `Gestão TI`) — e junções/symlinks não resolvem, pois o Docker canonicaliza o caminho real. Para (re)construir as imagens, copie o projeto para um caminho sem acento e rode o build de lá (os containers e volumes ficam no Docker, independentes da pasta):
> ```powershell
> robocopy "C:\Users\SEU_USUARIO\Gestão TI" C:\temp\gestao-ti-build /E /XD node_modules dist uploads backups .git
> cd C:\temp\gestao-ti-build; docker compose up -d --build
> ```
> Depois do build, os comandos de operação (`docker compose ps/logs/exec/stop`) funcionam de qualquer pasta usando `-p gestao-ti-tia-eliana`.

### Contas do seed (senha: `Mudar@123` — troque no primeiro acesso)

| Perfil | E-mail |
| --- | --- |
| Owner/Diretoria | `diretoria@tiaeliana.com.br` |
| Administrador | `admin@tiaeliana.com.br` |
| Gestor de TI | `gestor.ti@tiaeliana.com.br` |
| Técnico 1 / 2 | `tecnico1@…` / `tecnico2@tiaeliana.com.br` |
| Solicitante | `solicitante@tiaeliana.com.br` |
| Gestor de setor | `gestor.setor@tiaeliana.com.br` |
| Auditor | `auditor@tiaeliana.com.br` |
| Inventariante | `inventariante@tiaeliana.com.br` |

## Desenvolvimento local

```bash
npm install
docker run --name gestao-ti-db-dev -e POSTGRES_USER=gestao -e POSTGRES_PASSWORD=gestao-ti-dev-2026 \
  -e POSTGRES_DB=gestao_ti -p 5433:5432 -d postgres:16-alpine

npm run build:shared        # compila o pacote de domínio
cp .env.example apps/api/.env   # ajuste DATABASE_URL se necessário
npm run db:migrate          # aplica migrations
npm run db:seed             # dados iniciais
npm run dev:api             # API em http://localhost:3001
npm run dev:web             # Web em http://localhost:5173 (proxy para a API)
```

## Variáveis de ambiente

Ver [`.env.example`](.env.example). As críticas:

- `POSTGRES_PASSWORD` — senha do banco (obrigatória no compose)
- `JWT_SECRET` — segredo das sessões (gere um valor longo e aleatório)
- `UPLOAD_MAX_MB` — limite de upload de anexos
- `WEB_PORT` / `POSTGRES_PORT` — portas expostas no host

## Migrations e seed

```bash
docker compose exec api npx prisma migrate deploy   # aplicar migrations pendentes
docker compose exec api npx prisma db seed          # seed (aborta se já houver dados)
```

## Backup e restauração

```bash
./scripts/backup.sh                 # gera backups/gestao-ti_DATA.dump + anexos .tar.gz
./scripts/restore.sh backups/arquivo.dump [anexos.tar.gz]   # SUBSTITUI os dados atuais
./scripts/export-db.sh              # dump SQL legível para conferência/migração
```

**Um backup só é válido depois de testado.** Teste a restauração periodicamente em um ambiente separado:

```bash
# em outra máquina/pasta, com o compose rodando limpo:
./scripts/restore.sh caminho/do/backup.dump
# entre no sistema e confira chamados, inventário e auditoria
```

No Windows, execute os scripts pelo Git Bash (instalado junto com o Git).

## Testes

```bash
npm test        # 35 testes: prioridade, SLA, numeração concorrente, permissões,
                # proteção do Owner, reabertura, tempo auditado, imutabilidade, rotinas…
```

Os testes usam um banco descartável `gestao_ti_test` (criado automaticamente no PostgreSQL de desenvolvimento).

## Atualização do sistema

```bash
git pull                            # (quando versionado em git)
docker compose up -d --build        # rebuild + sobe
docker compose exec api npx prisma migrate deploy
```

## Estrutura de pastas

```
gestao-ti/
├── apps/
│   ├── api/          # Fastify + Prisma (rotas, regras, scheduler, testes)
│   └── web/          # React + Vite (24 telas)
├── packages/
│   └── shared/       # enums, rótulos pt-BR, matriz de permissões e prioridade
├── docker/           # Dockerfiles + nginx
├── scripts/          # backup, restore, export
├── docs/             # documentação obrigatória
├── docker-compose.yml
└── .env.example
```

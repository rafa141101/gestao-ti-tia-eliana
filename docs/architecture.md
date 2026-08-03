# Arquitetura — Gestão TI Tia Eliana

## Decisões principais

| Decisão | Escolha | Justificativa |
| --- | --- | --- |
| Formato | Monorepo npm workspaces | Um repositório, domínio compartilhado (`packages/shared`) entre API e Web sem duplicação |
| Backend | Fastify 5 + TypeScript | Leve, rápido, validação com Zod, fácil de operar localmente |
| ORM | **Prisma** | Migrations versionadas em SQL, type-safety de ponta a ponta, `migrate deploy` simples no Docker. Drizzle foi considerado; Prisma venceu pela maturidade das migrations e familiaridade (o Manutrixia usa Postgres com padrões equivalentes) |
| Banco | PostgreSQL 16 | Constraints reais, triggers de imutabilidade, `SELECT ... FOR UPDATE` para numeração concorrente |
| Frontend | React 18 + Vite + Tailwind | Padrão do ecossistema da empresa (Manutrixia é React/Vite); build estático servido por nginx |
| Autenticação | JWT próprio + bcryptjs | Sem dependência de serviço externo (requisito: rodar offline na rede interna) |
| Anexos | Diretório local em volume Docker | Simples de operar e de fazer backup; MinIO seria complexidade desnecessária no MVP |
| Notificações | Internas (tabela + sino no topo) | E-mail/WhatsApp ficam para camada de integração futura |
| Agendador | `setInterval` no processo da API (5 min) | Fechamento automático, geração de rotinas, alertas de SLA/garantia. Simples e suficiente para 1 instância; se houver réplicas, mover para worker dedicado |

## Componentes

```
[Navegador] ──> [nginx :8080] ──/api──> [Fastify :3001] ──> [PostgreSQL :5432]
                    │                        │
                    └─ SPA React             └─ /data/uploads (volume)
```

- **nginx** serve o build do React e faz proxy de `/api` para a API — um único ponto de entrada.
- **API** valida payloads (Zod), aplica permissões no servidor (matriz em `packages/shared`), grava auditoria e roda o agendador interno.
- **PostgreSQL** guarda tudo; triggers impedem UPDATE/DELETE em `audit_logs`/`ticket_events` e DELETE físico em chamados, apontamentos, movimentações, manutenções e execuções de rotina.

## Fluxos críticos

### Numeração (TI-AAAA-NNNNNN / ATI-AAAA-NNNNNN)
Tabela `counters (scope, year, next)` com `INSERT ... ON CONFLICT DO NOTHING` + `SELECT ... FOR UPDATE` dentro da transação de criação — padrão herdado do Manutrixia, testado com 15 criações paralelas sem duplicidade.

### SLA
- Política por categoria (fallback: política padrão). Modos **corrido** e **comercial** (expediente, dias úteis, feriados).
- Prazos calculados na abertura (`firstResponseDueAt`, `resolutionDueAt`).
- Status de espera (aguardando solicitante/terceiro/aprovação, pausado, agendado) **pausam o SLA**: registra-se `slaPausedAt`; ao retomar, o tempo pausado acumula em `slaPausedMinutes` e os prazos são prorrogados pelo tempo pausado (em tempo corrido — aproximação documentada; medição separada de espera por solicitante × terceiro sai dos eventos).
- Alteração de prioridade recalcula prazos a partir da abertura e mantém a pausa acumulada.
- Alterações em políticas de SLA **não são retroativas**.

### Auditoria
`audit_logs` recebe ação, entidade, valores antes/depois, justificativa, IP e user-agent. Protegido por trigger no banco — nem a API consegue alterar/apagar. Login, falha de login, exportação, alteração de tempo/prioridade/SLA/permissão, movimentação e configuração são sempre auditados.

### QR Code
Cada ativo tem `publicId` de 8 caracteres sem ambiguidade (sem I/O/0/1). A página pública `/qr/:publicId` mostra apenas identificação básica (nunca IP/MAC/usuário) e permite relatar problema (vira chamado canal QR_CODE em nome do usuário de sistema "Portal QR"), com rate-limit por IP.

## Segurança

- Hash de senha bcrypt (custo 10); bloqueio após 5 falhas (15 min); sessões JWT com expiração (8h).
- Autorização **sempre no servidor** (preHandlers por permissão + regras de escopo por perfil).
- Validação de entrada com Zod em todas as rotas; Prisma parametriza SQL (sem injection).
- Upload: whitelist de MIME, limite de tamanho, nome aleatório em disco, download autenticado que respeita a visibilidade do chamado.
- Segredos apenas em `.env`; a API recusa subir em produção com `JWT_SECRET` de desenvolvimento.
- Cofre de senhas de equipamentos ficou **fora do MVP** por decisão de segurança; o campo `specs` do ativo não deve receber senhas. A arquitetura prevê um módulo futuro com criptografia dedicada e trilha de visualização.

## Integração futura

Ver [migration-strategy.md](migration-strategy.md). Resumo: domínio isolado em `packages/shared` (reutilizável), API REST documentável, banco PostgreSQL padrão (dump/restore levam tudo), autenticação substituível por SSO/Supabase Auth mantendo a tabela `users`.

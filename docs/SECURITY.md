# SECURITY — Segurança do Gestão TI

## Controles implementados

| Área | Controle |
| --- | --- |
| Senhas | bcrypt (custo 10); mínimo 8 caracteres; bloqueio de 15 min após 5 falhas |
| Sessões | JWT com expiração de 8h; segredo obrigatório via `.env`; API recusa subir em produção com segredo de desenvolvimento |
| Força bruta / abuso | Rate-limit global 300 req/min por IP; login 10/min; página pública de QR com limite próprio |
| Autorização | Matriz de permissões aplicada no servidor em todas as rotas + regras de escopo (solicitante só vê os próprios chamados; anexos respeitam a visibilidade do chamado) |
| Governança | Owner não pode ser alterado por não-Owner; último Owner ativo é irremovível |
| Entrada | Validação Zod em todas as rotas; SQL sempre parametrizado (Prisma) |
| Upload | Whitelist de MIME, limite de tamanho, nome aleatório em disco, download autenticado |
| Auditoria | Registro explícito nas ações de negócio **+ auditoria automática** de qualquer mutação sem registro explícito (extensão do ORM por requisição — rota nova não consegue "esquecer") |
| Imutabilidade | Triggers no PostgreSQL impedem UPDATE/DELETE em `audit_logs`/`ticket_events` e DELETE físico em chamados, tempos, movimentações, manutenções e execuções |
| Dados sensíveis | Página pública do QR não expõe IP/MAC/usuário; payloads auditados têm campos `password/token/secret` redigidos |
| Segredos | Apenas em `.env` (fora do versionamento) |

## Modelo de ameaça (rede interna)

O sistema foi desenhado para rodar **na rede interna**, sem exposição à internet. Nesse cenário, os riscos principais são uso indevido por usuários internos (mitigado por permissões + auditoria imutável) e perda de dados (mitigado por backups testados).

## Antes de expor à internet (ex.: webhook do WhatsApp)

A ativação do WhatsApp exige uma URL pública com HTTPS. Recomendações:

1. **Exponha apenas o caminho do webhook** (`/api/integrations/whatsapp/webhook`) através de túnel/proxy reverso (Cloudflare Tunnel, nginx com TLS) — não a aplicação inteira.
2. **Pendência conhecida:** o webhook ainda não valida a assinatura `X-Hub-Signature-256` da Meta (exige captura do corpo bruto). Até implementar, o risco é limitado a criação de chamados falsos por quem descobrir a URL — mitigado pelo rate-limit e pela URL não adivinhável do túnel. Implementar validação com `WHATSAPP_APP_SECRET` antes de uso prolongado.
3. Use HTTPS obrigatório e mantenha o restante da aplicação acessível apenas na rede interna/VPN.

## Decisões registradas

- **Cofre de senhas de equipamentos: fora do MVP.** Não armazene senhas nos campos livres/`specs` dos ativos. Módulo futuro com criptografia dedicada, acesso restrito e trilha de visualização.
- E-mail de recuperação de senha não existe (sem dependência de SMTP): a recuperação é administrativa (outro Owner) — procedimento no [owner-manual.md](owner-manual.md).
- `npm audit` deve ser rodado a cada atualização de dependências.

## Resposta a incidentes

1. Suspeita de conta comprometida → inativar o usuário (Usuários → Inativar) e redefinir a senha; sessões JWT expiram em 8h — para corte imediato, troque o `JWT_SECRET` e reinicie a API (desloga todos).
2. Verificar a auditoria (`/auditoria`) filtrando pelo usuário/IP — os registros são imutáveis.
3. Restaurar dados a partir do último backup íntegro se necessário (RUNBOOK).

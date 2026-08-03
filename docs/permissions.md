# Matriz de permissões — Gestão TI Tia Eliana

A matriz é definida em código (`packages/shared/src/index.ts`, `ROLE_PERMISSIONS`) e aplicada **no servidor** em todas as rotas. A tela **Administração → Perfis e permissões** exibe esta matriz dentro do sistema.

## Perfis

| Perfil | Papel |
| --- | --- |
| **OWNER** (Diretoria) | Dona administrativa do sistema. Acesso total. Não pode ser removida/rebaixada pela TI; o último Owner ativo jamais pode ser inativado. |
| **ADMIN** | Administra cadastros e configurações, mas não mexe em Owners, não apaga histórico/auditoria (impossível por design) e não edita SLA retroativamente (impossível por design). |
| **GESTOR_TI** | Distribui chamados, valida prioridades (com justificativa), gerencia projetos/rotinas/inventário/terceiros, revisa apontamentos. Sem administração de usuários. |
| **TECNICO** | Atende chamados, registra tempo/diagnóstico, executa rotinas e manutenções, movimenta equipamentos, participa de projetos. |
| **SOLICITANTE** | Abre e acompanha os próprios chamados, responde, anexa, confirma resolução, reabre e avalia. |
| **GESTOR_SETOR** | Tudo do solicitante + visão dos chamados/equipamentos/indicadores do seu setor. |
| **AUDITOR** | Somente leitura: históricos, relatórios, inventário, SLAs, logs, movimentações, dashboards, exportação. |
| **INVENTARIANTE** | Cadastra e confere equipamentos; sem configurações administrativas. |

## Matriz

✔ = permitido. Regras de escopo adicionais aplicam-se por cima da matriz (ex.: "ver os próprios chamados" filtra por solicitante/observador).

| Permissão | OWNER | ADMIN | GESTOR_TI | TECNICO | SOLICITANTE | GESTOR_SETOR | AUDITOR | INVENTARIANTE |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| tickets.create | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ |
| tickets.view.own | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ |
| tickets.view.department | ✔ | ✔ | — | — | — | ✔ | — | — |
| tickets.view.all | ✔ | ✔ | ✔ | ✔ | — | — | ✔ | — |
| tickets.work | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| tickets.manage | ✔ | ✔ | ✔ | — | — | — | — | — |
| worklogs.edit | ✔ | ✔ | ✔ | — | — | — | — | — |
| projects.view | ✔ | ✔ | ✔ | ✔ | — | — | ✔ | — |
| projects.manage | ✔ | ✔ | ✔ | — | — | — | — | — |
| routines.execute | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| routines.manage | ✔ | ✔ | ✔ | — | — | — | — | — |
| inventory.view | ✔ | ✔ | ✔ | ✔ | — | ✔ | ✔ | ✔ |
| inventory.register | ✔ | ✔ | ✔ | ✔ | — | — | — | ✔ |
| inventory.manage | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| thirdparties.manage | ✔ | ✔ | ✔ | — | — | — | — | — |
| dashboard.operational | ✔ | ✔ | ✔ | ✔ | — | — | ✔ | — |
| dashboard.direction | ✔ | ✔ | — | — | — | — | ✔ | — |
| reports.view | ✔ | ✔ | ✔ | — | — | ✔ | ✔ | — |
| export.data | ✔ | ✔ | ✔ | — | — | — | ✔ | — |
| audit.view | ✔ | ✔ | — | — | — | — | ✔ | — |
| admin.users | ✔ | ✔ | — | — | — | — | — | — |
| admin.structure | ✔ | ✔ | — | — | — | — | — | — |
| admin.settings | ✔ | ✔ | — | — | — | — | — | — |

## Regras acima da matriz (aplicadas no servidor)

1. Somente **OWNER** cria/promove usuários OWNER ou ADMIN.
2. Usuário OWNER (protegido) só pode ser alterado por outro OWNER — inclusive redefinição de senha.
3. O **último OWNER ativo** não pode ser inativado nem rebaixado, nem por ele mesmo.
4. Técnico sem `tickets.manage` só atribui chamado **para si** ("assumir").
5. Solicitante confirma resolução/reabre/avalia apenas os próprios chamados.
6. Comentários internos exigem `tickets.work` (invisíveis ao solicitante em qualquer consulta).
7. Exportar auditoria exige `export.data` **e** `audit.view`.
8. Edição de apontamento alheio exige `worklogs.edit`; a própria edição sempre exige justificativa.
9. Anexos de chamados respeitam a visibilidade do chamado no download.

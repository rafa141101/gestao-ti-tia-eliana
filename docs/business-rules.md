# Regras de negócio — Gestão TI Tia Eliana

## Chamados

1. **Toda demanda vira registro**: chamado, tarefa de projeto ou rotina. Atendimentos por WhatsApp/telefone/presencial devem ser registrados mesmo depois de resolvidos (canal de origem + apontamento manual).
2. Numeração legível `TI-AAAA-NNNNNN`, sequencial por ano, sem duplicidade mesmo em concorrência.
3. **Prioridade** = matriz impacto × urgência calculada pelo sistema. O solicitante informa impacto e urgência; não define a prioridade final. O Gestor de TI pode revalidar **somente com justificativa**, e a prioridade original permanece no histórico (`calculatedPriority` + evento).
4. **Status**: Novo → Triagem → Atribuído → Em atendimento → Resolvido → Fechado, com estados auxiliares (Aguardando solicitante/terceiro/aprovação, Agendado, Pausado por dependência, Cancelado). Transições inválidas são rejeitadas no servidor e no Kanban.
5. Toda mudança de status gera evento imutável com usuário, data, valores e justificativa.
6. **Resolver exige registrar a solução.** Cancelar exige motivo.
7. **Reabertura**: solicitante ou TI podem reabrir chamado resolvido/fechado com motivo obrigatório; conta no indicador de reabertura e volta para o técnico anterior (notificado).
8. **Fechamento automático**: chamado resolvido sem manifestação do solicitante fecha após 48h (configurável). O solicitante é notificado e ainda pode reabrir.
9. Comentários internos nunca são visíveis ao solicitante.
10. Primeira resposta pública da equipe marca o SLA de primeira resposta.
11. Chamados **nunca são apagados** (trigger no banco impede DELETE). Cancelamento é o caminho.
12. Chamados de terceiros guardam fornecedor, nº do ticket externo, previsão e último retorno; tempo aguardando terceiro é medido separadamente (status + eventos).
13. Campo **área responsável pela informação** identifica quem decide o conteúdo (ex.: fiscal define NCM; TI apenas executa).

### Distribuição automática (rodízio)

- Fila em modo **round-robin** com membros definidos: chamado novo da categoria já nasce **Atribuído** ao próximo técnico do rodízio (evento "Distribuição automática da fila" + notificação). Fila em modo manual mantém o fluxo de triagem pelo gestor.

### Canal WhatsApp (integração oficial opcional)

- Mensagem recebida vira chamado (canal WhatsApp) e o remetente recebe o número do chamado na conversa.
- Mensagem do mesmo número com chamado WhatsApp aberto e movimentado nas **últimas 24h** entra como resposta no mesmo chamado (regra da reunião).
- Respostas públicas da TI e a resolução são enviadas de volta na conversa (janela de serviço de 24h — sem custo na API oficial).
- Número cadastrado no telefone de um usuário → chamado nasce em nome dele; número desconhecido → usuário de sistema "Canal WhatsApp" com telefone registrado no chamado.

## SLA

14. Medido pelo sistema, nunca preenchido à mão. Prazos de primeira resposta e de solução separados.
15. Padrão inicial: P1 10min / P2 30min / P3 4h úteis / P4 1 dia útil (primeira resposta) — configurável por política.
16. Políticas por categoria; modos corrido e comercial (expediente, dias úteis, feriados).
17. Status de espera pausam o SLA; a retomada prorroga os prazos pelo tempo pausado.
18. Alterações de política **não são retroativas**.

## Tempo trabalhado

19. Iniciar atividade encerra automaticamente a anterior (registrando interrupção no chamado interrompido).
20. **Limite de WIP**: no máximo 2 chamados simultâneos "Em atendimento" por técnico (configurável). **P1 fura o limite.**
21. Apontamento manual permitido (trabalho já realizado), sempre marcado como manual.
22. **Nenhuma edição silenciosa**: alterar um apontamento exige justificativa, grava quem editou/quando e vai para a auditoria. Estorno lógico no lugar de exclusão (trigger impede DELETE).

## Rotinas

23. Cada execução é um registro individual; editar a rotina não altera execuções passadas.
24. Execuções são geradas pelo agendador quando vencem; atraso além da tolerância marca ATRASADA e notifica.
25. Rotina pode exigir evidência anexada para concluir; pular execução exige justificativa.

## Projetos

26. Projetos têm solicitante, patrocinador, responsável, %, horas previstas × realizadas (via apontamentos nas tarefas), bloqueios/riscos/dependências.
27. Tarefas aceitam apontamento de tempo e aparecem no Meu Trabalho do responsável.

## Inventário

28. Código automático `ATI-AAAA-NNNNNN` + `publicId` para QR. Plaqueta física existente vai em `patrimonyCode`.
29. **Equipamento não muda de unidade/setor por edição** — somente por movimentação registrada e confirmada no destino (fluxo Solicitada → … → Confirmada; cancelada/retornada devolve o estado).
30. Um ativo só tem uma movimentação em andamento por vez.
31. Componentes substituídos **permanecem no histórico** (removedAt + status; nunca apagados).
32. Mouse/teclado e similares podem ser cadastrados como **kit/consumível** com quantidade e estoque mínimo — sem patrimônio individual.
33. Manutenções registram diagnóstico, serviço, custo, peças, resultado e programam a próxima preventiva (alimenta alertas).
34. Ativo descartado não pode ser movimentado; descarte passa por AGUARDANDO_DESCARTE → DESCARTADO com movimentação.

## Governança e auditoria

35. **Owner (Diretoria)**: não pode ser rebaixado/inativado por ninguém que não seja Owner; o **último Owner ativo jamais pode ser removido** (recuperação administrativa garantida). Apenas Owner cria/promove Owner e Admin.
36. Usuários nunca são apagados — apenas inativados (histórico preservado).
37. Logs de auditoria são imutáveis por trigger no banco; nenhum perfil apaga auditoria.
38. Exportação de dados (CSV) disponível para quem tem a permissão — a diretoria retira os dados sem depender do desenvolvedor. Toda exportação é auditada.
39. Indicadores não avaliam desempenho apenas por chamados fechados — horas por tipo/técnico/categoria ficam lado a lado nos dashboards.

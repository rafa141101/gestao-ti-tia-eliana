-- ============================================================
-- Reset pré-lançamento: remove todos os dados fictícios/de teste
-- (seed + verificações manuais) mantendo estrutura, usuários,
-- terceiros reais, rotinas (como modelo) e os 39 ativos importados
-- da planilha real (ATI-2026-000013 em diante).
--
-- As travas de imutabilidade (triggers) protegem o sistema depois
-- que o uso real começar; aqui são desligadas só durante esta
-- transação única de reset e religadas ao final.
-- ============================================================

BEGIN;

ALTER TABLE tickets DISABLE TRIGGER tickets_no_delete;
ALTER TABLE ticket_comments DISABLE TRIGGER ticket_comments_no_delete;
ALTER TABLE ticket_worklogs DISABLE TRIGGER ticket_worklogs_no_delete;
ALTER TABLE asset_movements DISABLE TRIGGER asset_movements_no_delete;
ALTER TABLE maintenance_records DISABLE TRIGGER maintenance_records_no_delete;
ALTER TABLE routine_executions DISABLE TRIGGER routine_executions_no_delete;
ALTER TABLE ticket_events DISABLE TRIGGER ticket_events_immutable;

-- Chamados e tudo que depende deles (todos os 14 atuais são fictícios/teste)
DELETE FROM attachments;
DELETE FROM ticket_watchers;
DELETE FROM ticket_relations;
DELETE FROM ticket_comments;
DELETE FROM ticket_events;
DELETE FROM ticket_worklogs;
DELETE FROM tickets;

-- Projetos fictícios (todos os 3 atuais)
DELETE FROM project_tasks;
DELETE FROM project_members;
DELETE FROM projects;

-- Execuções de rotina fictícias (mantém as 5 rotinas como modelo)
DELETE FROM routine_executions;

-- Movimentações e manutenções fictícias (todas as atuais)
DELETE FROM asset_movements;
DELETE FROM maintenance_records;
DELETE FROM asset_components WHERE "assetId" IN (SELECT id FROM assets WHERE code <= 'ATI-2026-000012');

-- Ativos fictícios do seed (ATI-000001 a 000012) — mantém os reais (000013+)
DELETE FROM assets WHERE code <= 'ATI-2026-000012';

-- Notificações de teste
DELETE FROM notifications;

-- Reinicia a numeração de chamados: o próximo será TI-2026-000001
UPDATE counters SET next = 1 WHERE scope = 'TICKET' AND year = 2026;

-- Reagenda as rotinas mantidas para a partir de agora (evita ficarem "atrasadas" no primeiro dia real)
UPDATE routines SET "nextRunAt" = CASE frequency
  WHEN 'DIARIA' THEN now() + interval '1 day'
  WHEN 'SEMANAL' THEN now() + interval '7 days'
  WHEN 'QUINZENAL' THEN now() + interval '14 days'
  WHEN 'MENSAL' THEN now() + interval '30 days'
  WHEN 'TRIMESTRAL' THEN now() + interval '90 days'
  WHEN 'ANUAL' THEN now() + interval '365 days'
  ELSE now() + make_interval(days => COALESCE("intervalDays", 30))
END;

ALTER TABLE tickets ENABLE TRIGGER tickets_no_delete;
ALTER TABLE ticket_comments ENABLE TRIGGER ticket_comments_no_delete;
ALTER TABLE ticket_worklogs ENABLE TRIGGER ticket_worklogs_no_delete;
ALTER TABLE asset_movements ENABLE TRIGGER asset_movements_no_delete;
ALTER TABLE maintenance_records ENABLE TRIGGER maintenance_records_no_delete;
ALTER TABLE routine_executions ENABLE TRIGGER routine_executions_no_delete;
ALTER TABLE ticket_events ENABLE TRIGGER ticket_events_immutable;

COMMIT;

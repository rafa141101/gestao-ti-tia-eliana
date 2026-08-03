-- ============================================================
-- Proteções de imutabilidade no nível do banco de dados.
-- Nenhum usuário da aplicação consegue alterar ou apagar
-- auditoria, e registros operacionais não podem ser apagados
-- fisicamente (regras 13 e 21 do escopo).
-- ============================================================

CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Operação % proibida na tabela %: registros são imutáveis (use cancelamento/estorno).', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Auditoria: nem UPDATE nem DELETE
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Histórico de eventos de chamados: imutável
CREATE TRIGGER ticket_events_immutable
  BEFORE UPDATE OR DELETE ON ticket_events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Registros que não podem ser apagados fisicamente (apenas DELETE bloqueado)
CREATE TRIGGER tickets_no_delete
  BEFORE DELETE ON tickets
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER ticket_comments_no_delete
  BEFORE DELETE ON ticket_comments
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER ticket_worklogs_no_delete
  BEFORE DELETE ON ticket_worklogs
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER asset_movements_no_delete
  BEFORE DELETE ON asset_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER maintenance_records_no_delete
  BEFORE DELETE ON maintenance_records
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER routine_executions_no_delete
  BEFORE DELETE ON routine_executions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

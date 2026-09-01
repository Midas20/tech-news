-- 0019: clearing an override is a change, and has to leave a trace.
--
-- Removing a row from app_settings means "stop overriding this; let the
-- environment show through again". That is a real configuration change -- it can
-- triple a poll interval or switch classification off -- so it belongs in the
-- history exactly as much as setting a value does. Without this, the one action
-- that reverts behaviour is the one action the audit trail cannot see.
--
-- JSON null (not SQL NULL) records it: the column stays NOT NULL, and a reader
-- can tell "set to nothing" from "no row".

CREATE OR REPLACE FUNCTION record_setting_clear() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  INSERT INTO app_settings_history (key, old_value, new_value, changed_by)
  VALUES (OLD.key, OLD.value, 'null'::jsonb, OLD.updated_by);
  RETURN OLD;
END
$fn$;

DROP TRIGGER IF EXISTS app_settings_cleared ON app_settings;
CREATE TRIGGER app_settings_cleared
  BEFORE DELETE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION record_setting_clear();

GRANT DELETE ON app_settings TO newstrack_app, newstrack_worker;

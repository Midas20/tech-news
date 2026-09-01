-- 0017: operator settings.
--
-- Configuration arrives from the environment (src/config.ts) and the environment
-- is the right place for it: a Worker has no other way to be told anything at
-- start-up. But an operator cannot edit a Worker secret to answer "is this
-- polling too hard", and a knob you cannot reach is not a knob.
--
-- So this table is an OVERLAY, not a replacement. A key present here wins over
-- the environment; a key absent falls through to it. That ordering is what keeps
-- a settings page honest: everything it shows is either a value someone chose
-- here, or the environment value it would otherwise use, and the page says which.

CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

-- Settings changes explain later behaviour, so they are kept the way stories are:
-- superseded, never deleted. "Collection went quiet on the 14th" is unanswerable
-- without the row saying the interval was tripled on the 14th.
CREATE TABLE IF NOT EXISTS app_settings_history (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL,
  old_value   jsonb,
  new_value   jsonb NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  text
);

CREATE INDEX IF NOT EXISTS app_settings_history_key_idx
  ON app_settings_history (key, changed_at DESC);

CREATE OR REPLACE FUNCTION record_setting_change() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.value IS NOT DISTINCT FROM NEW.value THEN
    RETURN NEW;                       -- a save that changed nothing is not history
  END IF;
  INSERT INTO app_settings_history (key, old_value, new_value, changed_by)
  VALUES (NEW.key,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.value ELSE NULL END,
          NEW.value, NEW.updated_by);
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS app_settings_history_t ON app_settings;
CREATE TRIGGER app_settings_history_t
  BEFORE INSERT OR UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION record_setting_change();

DROP TRIGGER IF EXISTS app_settings_updated ON app_settings;
CREATE TRIGGER app_settings_updated BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Settings are global rather than tenant-scoped, so they sit in the same class as
-- sources and stacks: readable by the app role, and writable by it because the
-- settings page is the only surface that writes them and runs as that role.
GRANT SELECT, INSERT, UPDATE ON app_settings TO newstrack_app, newstrack_worker;
GRANT SELECT ON app_settings_history TO newstrack_app, newstrack_worker;
GRANT USAGE, SELECT ON SEQUENCE app_settings_history_id_seq TO newstrack_app, newstrack_worker;

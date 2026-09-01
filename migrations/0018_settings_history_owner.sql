-- 0018: let the settings trigger write history without granting the app role
-- write access to the history table.
--
-- The app role saves settings, and the trigger on app_settings writes the audit
-- row -- but a trigger runs as the CALLER, so that write was denied. Granting
-- INSERT on app_settings_history would fix it and would also mean the settings
-- page could forge or backdate history directly, which defeats the point of
-- keeping it.
--
-- SECURITY DEFINER is the narrower fix: the function runs as its owner, so
-- history can only ever be written as a side effect of a real settings change.
-- The search_path is pinned because a SECURITY DEFINER function that resolves
-- names through the caller's search_path is a privilege escalation.

CREATE OR REPLACE FUNCTION record_setting_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
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

REVOKE INSERT, UPDATE, DELETE ON app_settings_history FROM newstrack_app;

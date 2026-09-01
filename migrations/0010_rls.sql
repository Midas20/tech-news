-- 0010: row-level security.
--
-- Tenant isolation is enforced here, not by application WHERE clauses. One
-- forgotten filter in application code is a cross-tenant data leak; RLS makes
-- that structurally impossible. The connection sets app.tenant_id and every
-- tenant-scoped table filters on it.

ALTER TABLE tenants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views    ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_state   ENABLE ROW LEVEL SECURITY;

-- FORCE applies the policy to the table owner too. Without it, a migration run or
-- an admin connection silently sees everything and the isolation is theatre.
ALTER TABLE tenants        FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_users   FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_secrets FORCE ROW LEVEL SECURITY;
ALTER TABLE channels       FORCE ROW LEVEL SECURITY;
ALTER TABLE users          FORCE ROW LEVEL SECURITY;
ALTER TABLE deliveries     FORCE ROW LEVEL SECURITY;
ALTER TABLE delivery_feedback FORCE ROW LEVEL SECURITY;
ALTER TABLE analyses       FORCE ROW LEVEL SECURITY;
ALTER TABLE saved_views    FORCE ROW LEVEL SECURITY;
ALTER TABLE saved_items    FORCE ROW LEVEL SECURITY;
ALTER TABLE thread_state   FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_users','channels','users','deliveries',
                           'delivery_feedback','analyses','saved_views',
                           'saved_items','thread_state']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant())
         WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $do$;

-- Bot tokens are workspace-wide credentials. The app role gets no GRANT at all,
-- so RLS is the second line here, not the first.
DROP POLICY IF EXISTS secrets_worker_only ON tenant_secrets;
CREATE POLICY secrets_worker_only ON tenant_secrets
  TO newstrack_worker
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Global tables carry no tenant column and are deliberately readable by both
-- roles. They contain public web data only.
GRANT USAGE ON SCHEMA public TO newstrack_worker, newstrack_app;

GRANT SELECT ON sources, stacks, stories, story_members, story_keys,
                coverage_snapshots, engagement_snapshots, tools, tool_signals,
                platforms, platform_facts, platform_signals, fetch_log,
                stack_alias_lookup, quality_agreement
  TO newstrack_app;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO newstrack_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO newstrack_worker;

GRANT SELECT, INSERT, UPDATE ON channels, users, saved_views, saved_items,
                                 analyses, delivery_feedback, thread_state
  TO newstrack_app;
GRANT SELECT ON tenants, tenant_users, deliveries TO newstrack_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO newstrack_app;

REVOKE ALL ON tenant_secrets FROM newstrack_app;
REVOKE ALL ON provider_budgets, llm_cache, jobs, source_budgets FROM newstrack_app;

-- Anything added later defaults to worker-writable, app-invisible until granted.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO newstrack_worker;

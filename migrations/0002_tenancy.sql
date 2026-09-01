-- 0002: tenancy. The tenant boundary is the Slack workspace.

CREATE TABLE IF NOT EXISTS tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_team_id  text NOT NULL UNIQUE,
  name           text NOT NULL,
  plan           text NOT NULL DEFAULT 'free',
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','suspended','uninstalled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_users (
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  slack_user_id  text NOT NULL,
  role           text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, slack_user_id)
);

-- Bot tokens are workspace-wide credentials. They live in their own table so the
-- app role can be denied it outright (spec 7.2) -- RLS alone is not the guard here,
-- the absence of a GRANT is.
CREATE TABLE IF NOT EXISTS tenant_secrets (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id),
  bot_token_enc    bytea NOT NULL,
  bot_user_id      text,
  scopes           text[] NOT NULL DEFAULT '{}',
  key_version      int  NOT NULL DEFAULT 1,
  installed_by     text,
  installed_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz
);

CREATE TABLE IF NOT EXISTS channels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  slack_channel_id  text NOT NULL,
  name              text,
  default_fields    text[] NOT NULL DEFAULT '{}',
  digest_time       time   NOT NULL DEFAULT '08:00',
  tz                text   NOT NULL DEFAULT 'UTC',
  quiet_hours       int4range,
  tier_routing      jsonb  NOT NULL DEFAULT '{}'::jsonb,  -- {"critical":"channel","notable":"dm"}
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slack_channel_id)
);

CREATE TABLE IF NOT EXISTS users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  slack_user_id    text NOT NULL,
  channel_id       uuid REFERENCES channels(id),
  fields           text[] NOT NULL DEFAULT '{}',   -- stack slugs, closed vocabulary
  keywords         text[] NOT NULL DEFAULT '{}',
  excluded_terms   text[] NOT NULL DEFAULT '{}',
  volume_tier      volume_tier   NOT NULL DEFAULT 'notable',
  delivery_mode    delivery_mode NOT NULL DEFAULT 'hybrid',
  digest_time      time,          -- NULL: inherit from channel
  tz               text,          -- NULL: inherit from channel
  lang_preference  content_lang NOT NULL DEFAULT 'en',
  field_thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"rust": 6} per-field importance floor
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slack_user_id)
);

CREATE INDEX IF NOT EXISTS users_tenant_idx   ON users (tenant_id);
CREATE INDEX IF NOT EXISTS users_fields_idx   ON users USING gin (fields);
CREATE INDEX IF NOT EXISTS channels_tenant_idx ON channels (tenant_id);

CREATE TRIGGER tenants_updated  BEFORE UPDATE ON tenants  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER channels_updated BEFORE UPDATE ON channels FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

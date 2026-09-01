-- 0007: delivery log and per-user artefacts.
--
-- deliveries is the recovery mechanism. "Has this user seen this story" is a row,
-- not session memory: a restart mid-cycle resumes exactly where it stopped and
-- never double-sends.

CREATE TABLE IF NOT EXISTS deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  story_id      uuid NOT NULL,
  user_id       uuid REFERENCES users(id),
  channel_id    uuid REFERENCES channels(id),
  tier          delivery_tier NOT NULL,
  reason_line   text,             -- the "why you are getting this" line the user reads
  slack_ts      text,
  digest_id     uuid,             -- groups a digest post's stories
  delivered_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, story_id, user_id, tier)
);

CREATE INDEX IF NOT EXISTS deliveries_user_idx   ON deliveries (user_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS deliveries_story_idx  ON deliveries (story_id);
CREATE INDEX IF NOT EXISTS deliveries_tenant_idx ON deliveries (tenant_id, delivered_at DESC);

-- Implicit signal: reactions and clicks tune the profile over time (spec 5.5).
CREATE TABLE IF NOT EXISTS delivery_feedback (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  delivery_id  uuid NOT NULL REFERENCES deliveries(id),
  user_id      uuid REFERENCES users(id),
  kind         text NOT NULL CHECK (kind IN ('reaction','click','save','mute','thread_reply')),
  value        text,
  observed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivery_feedback_user_idx ON delivery_feedback (user_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS analyses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  story_ids     uuid[] NOT NULL DEFAULT '{}',
  content       text NOT NULL,
  requested_by  text,
  slack_ts      text,
  channel_id    uuid REFERENCES channels(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analyses_tenant_idx ON analyses (tenant_id, created_at DESC);

-- A saved view is a stored filter object, identical in shape to the URL state the
-- UI serializes (spec 6.6). One filter representation, three consumers.
CREATE TABLE IF NOT EXISTS saved_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  name        text NOT NULL,
  filter_json jsonb NOT NULL,
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS saved_items (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id   uuid NOT NULL REFERENCES users(id),
  story_id  uuid NOT NULL,
  note      text,
  saved_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, story_id)
);

-- Thread state for the Slack agent. Replay is capped at ~20 messages; older turns
-- are summarized into this row so long threads do not get expensive quietly.
CREATE TABLE IF NOT EXISTS thread_state (
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  channel_id    uuid NOT NULL REFERENCES channels(id),
  thread_ts     text NOT NULL,
  summary       text,
  last_seen_ts  text,
  message_count int NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, channel_id, thread_ts)
);

CREATE TRIGGER saved_views_updated BEFORE UPDATE ON saved_views FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER deliveries_no_delete BEFORE DELETE ON deliveries FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();

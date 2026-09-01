-- 0003: source registry (global -- collected once, served to every tenant).

CREATE TABLE IF NOT EXISTS sources (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  url                   text NOT NULL,
  feed_url              text,          -- resolved from link rel=alternate, never hardcoded blindly
  feed_kind             text NOT NULL DEFAULT 'rss'
                        CHECK (feed_kind IN ('rss','atom','jsonfeed','api','imap','html')),
  roles                 source_role[] NOT NULL DEFAULT '{CONTENT}',
  lang                  content_lang,
  country               text,          -- ISO-3166 alpha-2; NULL when genuinely unknown
  trust_weight          numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (trust_weight BETWEEN 0 AND 1),
  weight_content        numeric(3,2) NOT NULL DEFAULT 1.00 CHECK (weight_content BETWEEN 0 AND 1),
  never_canonical       boolean NOT NULL DEFAULT false,
  fields                text[] NOT NULL DEFAULT '{}',
  poll_interval_seconds int NOT NULL DEFAULT 3600 CHECK (poll_interval_seconds >= 60),
  politeness_seconds    int NOT NULL DEFAULT 2,
  requires_secret       text,          -- env var name; source is skipped when unset
  shard                 int NOT NULL DEFAULT 0,

  last_etag             text,
  last_modified         text,
  last_fetch_at         timestamptz,
  last_success_at       timestamptz,
  next_fetch_at         timestamptz NOT NULL DEFAULT now(),
  last_error            text,
  consecutive_failures  int NOT NULL DEFAULT 0,
  health                source_health NOT NULL DEFAULT 'healthy',

  curated               boolean NOT NULL DEFAULT false,
  notes                 text,
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- A COVERAGE-only outlet may never be a canonical link, and anything that can be
  -- canonical must carry real content weight. These two flags must agree.
  CONSTRAINT coverage_only_is_never_canonical
    CHECK (NOT (never_canonical AND weight_content > 0.5))
);

CREATE UNIQUE INDEX IF NOT EXISTS sources_feed_url_key ON sources (feed_url) WHERE feed_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sources_url_key      ON sources (url);
CREATE INDEX IF NOT EXISTS sources_due_idx    ON sources (next_fetch_at)
  WHERE health <> 'dead' AND health <> 'paused';
CREATE INDEX IF NOT EXISTS sources_shard_idx  ON sources (shard, next_fetch_at);
CREATE INDEX IF NOT EXISTS sources_roles_idx  ON sources USING gin (roles);

CREATE TRIGGER sources_updated BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Candidate domains found in outbound links (spec 2.4). A domain seen 3+ times in
-- 30 days and absent from sources becomes a candidate; a weekly model pass promotes
-- it with curated=false.
CREATE TABLE IF NOT EXISTS source_candidates (
  domain             text PRIMARY KEY,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  mention_count      int NOT NULL DEFAULT 1,
  sample_urls        text[] NOT NULL DEFAULT '{}',
  referring_sources  uuid[] NOT NULL DEFAULT '{}',
  evaluated_at       timestamptz,
  verdict            text CHECK (verdict IN ('promoted','rejected','deferred')),
  verdict_reason     text,
  promoted_source_id uuid REFERENCES sources(id)
);

CREATE INDEX IF NOT EXISTS source_candidates_pending_idx
  ON source_candidates (mention_count DESC) WHERE evaluated_at IS NULL;

-- Per-source fetch budget, mirroring provider_budgets. Observed, never hardcoded.
CREATE TABLE IF NOT EXISTS source_budgets (
  source_id       uuid PRIMARY KEY REFERENCES sources(id),
  quota           int,
  window_start    timestamptz NOT NULL DEFAULT now(),
  window_seconds  int NOT NULL DEFAULT 3600,
  spent           int NOT NULL DEFAULT 0,
  last_429_at     timestamptz
);

-- One row per fetch attempt. This is the table you read during the Phase 1
-- observation week to find dead feeds, encoding surprises and volume shocks.
CREATE TABLE IF NOT EXISTS fetch_log (
  id            bigserial PRIMARY KEY,
  source_id     uuid NOT NULL REFERENCES sources(id),
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  status        int,
  duration_ms   int,
  bytes         int,
  items_seen    int NOT NULL DEFAULT 0,
  items_kept    int NOT NULL DEFAULT 0,
  not_modified  boolean NOT NULL DEFAULT false,
  error         text,
  drop_reasons  jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS fetch_log_source_idx ON fetch_log (source_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS fetch_log_recent_idx ON fetch_log (fetched_at DESC);

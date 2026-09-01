-- 0014: the backward direction.
--
-- Collection has two directions and they are not the same job. Forward is
-- continuous, latency-sensitive and cheap per item. Backward is a bounded,
-- resumable walk through history that must never compete with it -- which is why
-- it has its own cursor table, its own runner, and priority 9 on every job it
-- enqueues.
--
-- RSS has no past tense: a feed returns its last 20-50 items and nothing older.
-- So the backfill only targets sources that genuinely expose history --
-- Hacker News via Algolia, GitHub releases via the REST API, arXiv via its
-- query API -- and the registry records which those are rather than pretending
-- every source can be walked backwards.

CREATE TABLE IF NOT EXISTS backfill_state (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,              -- 'hn' | 'github_releases' | 'arxiv'
  target        text NOT NULL,              -- repo slug, category, or '*'
  source_id     uuid REFERENCES sources(id),

  -- Opaque to everything except the provider that wrote it: a unix timestamp
  -- for HN, a page number for GitHub, an offset for arXiv.
  cursor        text,
  oldest_seen   timestamptz,
  newest_seen   timestamptz,

  items_seen    int NOT NULL DEFAULT 0,
  items_stored  int NOT NULL DEFAULT 0,
  requests      int NOT NULL DEFAULT 0,

  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','complete','exhausted','failed')),
  last_error    text,
  started_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, target)
);

CREATE INDEX IF NOT EXISTS backfill_state_open_idx ON backfill_state (provider, updated_at)
  WHERE status IN ('pending','running');

CREATE TRIGGER backfill_state_updated BEFORE UPDATE ON backfill_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which sources can be walked backwards at all, and how deep. Everything else
-- is honestly marked as having no history rather than being retried forever.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS backfill_provider text;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS backfill_depth text;

UPDATE sources SET backfill_provider = 'hn', backfill_depth = 'full'
 WHERE name IN ('Hacker News', 'Show HN');

UPDATE sources SET backfill_provider = 'github_releases', backfill_depth = 'full'
 WHERE kind = 'releases';

UPDATE sources SET backfill_provider = 'arxiv', backfill_depth = 'full'
 WHERE name ILIKE 'arxiv%';

-- Everything else: the feed window is the whole of its history.
UPDATE sources SET backfill_depth = 'feed_window'
 WHERE backfill_provider IS NULL AND backfill_depth IS NULL;

CREATE INDEX IF NOT EXISTS sources_backfill_idx ON sources (backfill_provider)
  WHERE backfill_provider IS NOT NULL;

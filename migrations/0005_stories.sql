-- 0005: stories. Partitioned monthly (spec 1.9). ~1.5 KB per row: links and
-- derived metadata only, never article bodies.
--
-- A story is created in Phase 1 for every item that survives the ingest gates.
-- Phase 2 clustering never deletes: the losing row of a duplicate pair gets
-- superseded_by set to the winner, and gains a story_members row. Every read
-- path filters superseded_by IS NULL.

CREATE TABLE IF NOT EXISTS stories (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  canonical_url     text NOT NULL,
  url_hash          bytea NOT NULL,            -- sha256 of canonical_url
  title_original    text NOT NULL,
  title_en          text,                      -- filled at ingest for non-en (dedup layer 3)
  title_hash_en     bytea,                     -- hash of normalized title_en
  summary_en        text,                      -- ~400 chars, system-generated; survives link rot
  author            text,
  source_id         uuid NOT NULL REFERENCES sources(id),
  country           text,                      -- inherited from source; NULL if unknown
  stacks            text[] NOT NULL DEFAULT '{}',
  lang              content_lang NOT NULL,
  published_at      timestamptz,               -- from the feed; nullable, sometimes wrong
  collected_at      timestamptz NOT NULL DEFAULT now(),   -- our observation; NEVER null
  first_seen_at     timestamptz NOT NULL DEFAULT now(),

  importance        smallint CHECK (importance BETWEEN 0 AND 10),
  importance_by     text,                      -- which model tier scored it
  novelty           numeric(4,3),
  niche             numeric(4,3),
  depth             numeric(4,3),
  coverage_count    int NOT NULL DEFAULT 1,    -- denormalized current value

  content_hash      bytea NOT NULL,
  simhash           bigint,
  simhash_bands     int[] NOT NULL DEFAULT '{}',
  word_count        int,
  outbound_domains  text[] NOT NULL DEFAULT '{}',

  collection_mode   collection_mode NOT NULL DEFAULT 'live',
  classifier_version text,
  classified_at     timestamptz,
  is_tech           boolean,
  superseded_by     uuid,
  supersede_reason  text,

  search_vector     tsvector GENERATED ALWAYS AS (
                      setweight(to_tsvector('simple', coalesce(title_en, title_original)), 'A') ||
                      setweight(to_tsvector('simple', coalesce(summary_en, '')), 'B')
                    ) STORED,

  PRIMARY KEY (id, collected_at)
) PARTITION BY RANGE (collected_at);

CREATE INDEX IF NOT EXISTS stories_collected_idx  ON stories (collected_at DESC);
CREATE INDEX IF NOT EXISTS stories_live_idx       ON stories (collected_at DESC) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS stories_stacks_idx     ON stories USING gin (stacks);
CREATE INDEX IF NOT EXISTS stories_bands_idx      ON stories USING gin (simhash_bands);
CREATE INDEX IF NOT EXISTS stories_search_idx     ON stories USING gin (search_vector);
CREATE INDEX IF NOT EXISTS stories_source_idx     ON stories (source_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS stories_importance_idx ON stories (importance DESC, collected_at DESC)
  WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS stories_unclassified_idx ON stories (collected_at)
  WHERE classified_at IS NULL AND superseded_by IS NULL;

-- Global identity map. A unique index on a partitioned table must contain the
-- partition key, so cross-month uniqueness of canonical_url and content_hash
-- lives here instead. Small, unpartitioned, and the hot path for layer-1 dedup.
CREATE TABLE IF NOT EXISTS story_keys (
  key_hash      bytea PRIMARY KEY,
  key_kind      text  NOT NULL CHECK (key_kind IN ('url','content','title_en')),
  story_id      uuid  NOT NULL,
  collected_at  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS story_keys_story_idx ON story_keys (story_id);

-- Other outlets carrying the same story. Grows 5-8x faster than stories.
CREATE TABLE IF NOT EXISTS story_members (
  id            bigserial,
  story_id      uuid NOT NULL,
  source_id     uuid NOT NULL REFERENCES sources(id),
  url           text NOT NULL,
  title         text,
  member_story_id uuid,        -- the superseded story row, when the member came from one
  match_layer   smallint NOT NULL CHECK (match_layer BETWEEN 1 AND 4),
  seen_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, seen_at)
) PARTITION BY RANGE (seen_at);

CREATE INDEX IF NOT EXISTS story_members_story_idx  ON story_members (story_id, seen_at);
CREATE INDEX IF NOT EXISTS story_members_source_idx ON story_members (source_id, seen_at);
CREATE UNIQUE INDEX IF NOT EXISTS story_members_unique ON story_members (story_id, source_id, url, seen_at);

CREATE TRIGGER stories_no_delete       BEFORE DELETE ON stories       FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER story_members_no_delete BEFORE DELETE ON story_members FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();

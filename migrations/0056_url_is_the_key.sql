-- The URL is the story's identity, and now the database says so.
--
-- It always was: deduplication, coverage, membership and the story record all
-- key on the canonical URL. But nothing enforced it. `stories` is PRIMARY KEY
-- (id, collected_at) -- a surrogate uuid plus the partition key -- and there
-- was no index on `canonical_url` or `url_hash` at all. Not a unique one. Not
-- any one.
--
-- Two things followed from that.
--
--   THE LOOKUP WAS A SEQUENTIAL SCAN. Every poll asks "which of these URLs do
--   we already hold" and every poll read the whole table to answer.
--
--   THE CHECK WAS A RACE. Ingest reads, decides the URL is unknown, then
--   inserts. Two polls doing that at once both read "unknown" and both insert.
--   Measured: 70 duplicate rows over 1,272 -- GitLab releases stored 30 rows at
--   15 addresses, the .NET blog 14 at 7. Exactly twice each, which is what a
--   lost race looks like.
--
-- WHY A SEPARATE TABLE. A unique index on a partitioned table must contain the
-- partition key, so UNIQUE (url_hash, collected_at) is the most Postgres will
-- accept -- and it permits the same URL in two different months, which is
-- precisely the case that matters. `story_urls` is not partitioned, so its
-- primary key is a real one: one row per URL, for the whole archive, for ever.
--
-- It is written in the same transaction as the story, so an insert that loses
-- the race now fails on the constraint instead of quietly producing a second
-- copy.

CREATE TABLE IF NOT EXISTS story_urls (
  url_hash     bytea PRIMARY KEY,
  story_id     uuid        NOT NULL,
  collected_at timestamptz NOT NULL,
  first_seen   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE story_urls IS
  'One row per canonical URL, for the whole archive. The real uniqueness '
  'constraint on a story: `stories` is partitioned and cannot carry one.';

-- Backfill. Where the same URL is already held more than once the earliest row
-- wins -- it is the one other rows were deduplicated against, so it is the one
-- with the members and the coverage attached.
INSERT INTO story_urls (url_hash, story_id, collected_at, first_seen)
SELECT DISTINCT ON (url_hash) url_hash, id, collected_at, first_seen_at
  FROM stories
 ORDER BY url_hash, first_seen_at, collected_at
ON CONFLICT (url_hash) DO NOTHING;

-- The lookup every poll makes, which had no index behind it.
CREATE INDEX IF NOT EXISTS stories_url_hash ON stories (url_hash);

-- Finding the losers of a past race, and anything that slips through later.
CREATE INDEX IF NOT EXISTS story_urls_story ON story_urls (story_id);

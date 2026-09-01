-- 0013: what KIND of thing a source produces.
--
-- Roles describe how a source is treated by the pipeline (CONTENT, PRIMARY,
-- COVERAGE...). They do not describe what a reader sees, and the reader needs
-- that distinction badly: 205 of the seeded sources are GitHub release feeds,
-- and a project cutting five release candidates in an afternoon will bury a
-- day of actual news under "v4.2.0-rc4".
--
-- So kind is a READING axis, sitting beside roles rather than replacing them.
-- Nothing is hidden by it -- the reader defaults to news and offers releases as
-- its own stream, both reachable from the URL.

DO $$ BEGIN
  CREATE TYPE source_kind AS ENUM ('news', 'releases', 'community', 'status', 'research');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE sources ADD COLUMN IF NOT EXISTS kind source_kind NOT NULL DEFAULT 'news';

-- Backfill from what the seeder already recorded.
UPDATE sources SET kind = 'releases'
 WHERE notes = 'derived from stacks.repo_url' OR name LIKE '% releases';

UPDATE sources SET kind = 'community'
 WHERE 'DISCOVERY' = ANY(roles) AND kind = 'news';

UPDATE sources SET kind = 'status'
 WHERE 'EXPERIENCE' = ANY(roles) AND (name ILIKE '%status%' OR name ILIKE '%health%');

UPDATE sources SET kind = 'research'
 WHERE name ILIKE 'arxiv%';

CREATE INDEX IF NOT EXISTS sources_kind_idx ON sources (kind);

-- A prerelease is not news. Marked at the story level so the reader can rank it
-- down without a second lookup, and so the flag survives into the archive.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS is_prerelease boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS stories_release_noise_idx ON stories (collected_at DESC)
  WHERE superseded_by IS NULL AND NOT is_prerelease;

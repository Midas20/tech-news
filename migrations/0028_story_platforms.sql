-- 0028: which earning platforms a story is about.
--
-- Companies got a text[] and a tagging pass; platforms were matched with a regex
-- at read time, which is fine for one platform's page and hopeless as a filter --
-- it cannot be indexed, so every platform facet would scan the archive.
--
-- Same shape as `companies`, for the same reasons: a GIN-indexed array of slugs
-- written once by a cheap pass, and a progress marker so "examined and found
-- nothing" is a recorded result rather than work repeated forever.

ALTER TABLE stories ADD COLUMN IF NOT EXISTS platforms text[] NOT NULL DEFAULT '{}';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS platforms_tagged_at timestamptz;

CREATE INDEX IF NOT EXISTS stories_platforms_idx ON stories USING gin (platforms);
CREATE INDEX IF NOT EXISTS stories_platforms_untagged_idx
  ON stories (collected_at DESC) WHERE platforms_tagged_at IS NULL;

-- Read paths need the channel to group by, and the app role cannot see platforms
-- without a grant.
GRANT SELECT ON platforms, platform_facts TO newstrack_app;

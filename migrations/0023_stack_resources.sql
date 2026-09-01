-- 0023: where to learn a technology.
--
-- `stacks.docs_url` held one link for 24 of 707 entries, which answers neither
-- of the two questions someone actually has: "where is the reference" and "where
-- do I start". Those are different documents with different audiences, and the
-- best starting point is frequently not the vendor's -- The Rust Book, Go by
-- Example and MDN are all better than the thing they document.
--
-- So resources are rows, not columns: many per stack, each with a kind, and each
-- carrying the result of having been FETCHED. Nothing is displayed on the
-- strength of a plausible URL pattern. A link that 404s is worse than no link,
-- because a reader has to click it to find out.

CREATE TABLE IF NOT EXISTS stack_resources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stack_slug    text NOT NULL REFERENCES stacks(slug) ON UPDATE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('official', 'tutorial', 'learning', 'reference', 'community')),
  title         text NOT NULL,
  url           text NOT NULL,
  -- Who publishes it, so the reader can weigh it: 'official' means the project.
  provider      text NOT NULL DEFAULT 'official',
  -- Everything here must be readable without paying. A course with a paywall
  -- after lesson two is not a free learning platform.
  free          boolean NOT NULL DEFAULT true,
  -- 'curated' was written by a person; 'derived' came from a URL pattern and is
  -- only ever stored after it has answered.
  origin        text NOT NULL DEFAULT 'curated' CHECK (origin IN ('curated', 'derived')),
  sort_order    int NOT NULL DEFAULT 100,
  http_status   int,
  verified_at   timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stack_slug, url)
);

CREATE INDEX IF NOT EXISTS stack_resources_slug_idx
  ON stack_resources (stack_slug, kind, sort_order);
-- The verification pass takes the least recently checked first.
CREATE INDEX IF NOT EXISTS stack_resources_unverified_idx
  ON stack_resources (verified_at NULLS FIRST);

GRANT SELECT ON stack_resources TO newstrack_app;
GRANT SELECT, INSERT, UPDATE ON stack_resources TO newstrack_worker;

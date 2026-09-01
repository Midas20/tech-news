-- 0048: how widely a technology is actually used.
--
-- A technology page led with "Story volume, by month published" -- a histogram
-- of how often THIS ARCHIVE mentioned the thing. For C++ that is nine years of
-- empty buckets and one spike at the right-hand end, because the archive is two
-- months old and C++ is forty. The chart measured the observer, not the subject.
--
-- What a reader wants from a technology page is how big it is, and the honest
-- available answer is how many public projects carry its GitHub topic:
--
--   rust 119,298 · postgresql 113,068 · cpp 101,630 · kubernetes 51,355
--   openai 42,981 · astro 12,821 · llama-cpp 2,511
--
-- The slugs land on GitHub topics directly, which is not luck: a large part of
-- this vocabulary was imported FROM GitHub topics.
--
-- WHAT THIS IS NOT
--
-- It is not a count of developers. Nobody has one -- not GitHub, not Stack
-- Overflow, not libraries.io -- and a column called `developers` holding a
-- number that is really something else is the exact failure this schema refuses
-- elsewhere (see the note in 0008 about a plausible wrong URL). Projects are
-- projects. `stars` is interest in one repository, which is a different thing
-- again, and is stored under its own name.
--
-- Every row carries `measured_at` and `source`, because an adoption number
-- without a date is a rumour.

CREATE TABLE IF NOT EXISTS stack_adoption (
  stack_id     uuid PRIMARY KEY REFERENCES stacks(id) ON DELETE CASCADE,
  -- Public repositories carrying this technology's GitHub topic.
  projects     integer     CHECK (projects IS NULL OR projects >= 0),
  -- Stars on the technology's OWN repository, where repo_url names one.
  stars        integer     CHECK (stars IS NULL OR stars >= 0),
  -- NULL means "not measured yet", never "zero". The distinction matters: a
  -- topic nobody uses and a topic nobody has asked about look identical in a
  -- column that defaults to 0, and only one of them is a fact.
  measured_at  timestamptz,
  -- Set when the last attempt failed, so a permanent 404 stops being retried at
  -- the same rate as a transient one. Cleared on success.
  failed_at    timestamptz,
  failures     integer NOT NULL DEFAULT 0,
  note         text,
  source       text NOT NULL DEFAULT 'github',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The refresh job takes the least recently measured slice, so this is the index
-- it reads. NULLS FIRST: never-measured rows go before stale ones.
CREATE INDEX IF NOT EXISTS stack_adoption_due_idx
  ON stack_adoption (measured_at ASC NULLS FIRST);

-- "The biggest things in this category" is the comparison the page draws.
CREATE INDEX IF NOT EXISTS stack_adoption_projects_idx
  ON stack_adoption (projects DESC NULLS LAST);

DROP TRIGGER IF EXISTS stack_adoption_updated ON stack_adoption;
CREATE TRIGGER stack_adoption_updated BEFORE UPDATE ON stack_adoption
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT ON stack_adoption TO newstrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON stack_adoption TO newstrack_worker;

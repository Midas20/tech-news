-- Evidence this archive did not collect, so a reading is not bounded by it.
--
-- Asked for on 2026-09-09: "I want to you research all news that related to the
-- target news when you generate report, This mans when you make report, don't
-- be limited to db's past news, I want to know trend of the tech, not summary
-- of the news."
--
-- Two tables because there are two different kinds of outside evidence and they
-- fail in different ways.
--
-- WHY THIS IS NOT A CONTRADICTION OF "never count our own stories". That rule
-- exists because an archive count answers "how many of these did WE catch",
-- which is a fact about a feed list wearing the clothes of a market finding.
-- Everything here is measured by somebody else, published under its own name,
-- and true whether or not this repository is running. It is the same argument
-- `stack_adoption` already makes for GitHub topic counts, extended from a
-- census to a SERIES -- because a snapshot cannot express a trend and a trend is
-- what was asked for.
--
-- WHY IT MATTERS MORE THAN IT LOOKS. The pairing rule in analysis/strategy.ts
-- discards any claim about change that cannot cite an earlier story, which is
-- correct and which silently caps the reading at the depth of our own
-- collection. This archive began collecting on 2026-09-08. A dated download
-- series reaching back six months gives a claim a real earlier end that our
-- own stories cannot, and it is MORE checkable than they are: anybody can
-- re-run the same query against the same public API and get the same answer.

-- One row per package per day, from the registry that publishes it.
--
-- Deliberately a series and not a rollup. A mean over a window is a statistic
-- somebody chose, and the choice belongs to the module that reads this, not to
-- the store -- 0048 stored `stack_adoption` as a single overwritten snapshot
-- and that decision is why nothing in this system could show a trend.
CREATE TABLE IF NOT EXISTS adoption_series (
  registry   text NOT NULL,               -- npm | pypi | crates
  package    text NOT NULL,
  day        date NOT NULL,
  downloads  bigint NOT NULL,
  -- Which technology this was fetched for. Nullable because a package can be
  -- resolved before the taxonomy has a row, and the series is still true.
  slug       text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (registry, package, day)
);

CREATE INDEX IF NOT EXISTS adoption_series_slug ON adoption_series (slug, day DESC);

-- What a technology is called on a package registry, and whether it is there.
--
-- `missing` is a real answer and is recorded as one. Without it, a slug with no
-- npm package is looked up on every report for ever, and the absence of a
-- python package for "kubernetes" is a fact worth learning once.
CREATE TABLE IF NOT EXISTS adoption_lookup (
  slug        text PRIMARY KEY,
  registry    text,                       -- NULL once every registry has been tried
  package     text,
  missing     boolean NOT NULL DEFAULT false,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  note        text
);

-- Stories about our subjects that this archive never collected.
--
-- NOT stories, and never joined to `stories`. These are pointers into somebody
-- else's index, kept so the reading can say "here is what was being written
-- about this in April" when our own archive holds nothing from April. They
-- carry no body and are never summarised: a citation to a headline and a date
-- is honest, and an extracted body we did not fetch would not be.
CREATE TABLE IF NOT EXISTS outside_coverage (
  id           bigserial PRIMARY KEY,
  subject      text NOT NULL,             -- the stack slug the search was for
  source       text NOT NULL,             -- 'hn' today; the API that answered
  external_id  text NOT NULL,             -- that API's id, for dedup
  title        text NOT NULL,
  url          text,
  host         text,
  published_at timestamptz NOT NULL,
  -- Whatever the source publishes as attention. Points on Hacker News. NOT
  -- comparable across sources and never to be summed with anything of ours.
  score        integer,
  found_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS outside_coverage_subject
  ON outside_coverage (subject, published_at DESC);

-- The reader may see these, so the app role reads them. Only the worker writes.
ALTER TABLE adoption_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE adoption_lookup ENABLE ROW LEVEL SECURITY;
ALTER TABLE outside_coverage ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'newstrack_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON adoption_series, adoption_lookup, outside_coverage TO newstrack_worker;
    DROP POLICY IF EXISTS adoption_series_worker ON adoption_series;
    CREATE POLICY adoption_series_worker ON adoption_series
      FOR ALL TO newstrack_worker USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS adoption_lookup_worker ON adoption_lookup;
    CREATE POLICY adoption_lookup_worker ON adoption_lookup
      FOR ALL TO newstrack_worker USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS outside_coverage_worker ON outside_coverage;
    CREATE POLICY outside_coverage_worker ON outside_coverage
      FOR ALL TO newstrack_worker USING (true) WITH CHECK (true);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'newstrack_app') THEN
    GRANT SELECT ON adoption_series, adoption_lookup, outside_coverage TO newstrack_app;
    DROP POLICY IF EXISTS adoption_series_app ON adoption_series;
    CREATE POLICY adoption_series_app ON adoption_series
      FOR SELECT TO newstrack_app USING (true);
    DROP POLICY IF EXISTS adoption_lookup_app ON adoption_lookup;
    CREATE POLICY adoption_lookup_app ON adoption_lookup
      FOR SELECT TO newstrack_app USING (true);
    DROP POLICY IF EXISTS outside_coverage_app ON outside_coverage;
    CREATE POLICY outside_coverage_app ON outside_coverage
      FOR SELECT TO newstrack_app USING (true);
  END IF;
END $$;

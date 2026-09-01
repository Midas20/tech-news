-- 0033: keep a month of news, keep the analysis forever.
--
-- The archive hit Neon's 512 MB project ceiling at 187,086 stories, and no
-- amount of per-row thrift closes an order-of-magnitude gap: at ~1,600 bytes a
-- story the plan holds about 320,000 of them, while the question being asked --
-- which technologies are rising and falling -- wants a decade.
--
-- So stories stop being the thing that is kept. A story is expensive because it
-- carries a title, a URL, a summary, hashes, dedup keys and a job row, and all
-- of that exists so a person can READ it. Nobody reads a story from 2019. What
-- survives from 2019 is what it counted towards.
--
-- These tables are that. They are written before anything is deleted, they are
-- derived purely from stories, and they are small: 154 months of history came to
-- 10,894 (month, stack) rows and 4,260 co-occurrence rows -- a few MB to replace
-- hundreds.
--
-- Three things make the difference between an aggregate that supports analysis
-- and one that merely looks like it does:
--
--   1. THE DENOMINATOR. A stack going from 40 mentions to 80 means nothing
--      without knowing whether the month itself doubled. month_totals is not
--      optional bookkeeping; it is what makes every other number a rate.
--   2. DISTINCT SOURCES, not just story counts. Fifty posts from one enthusiast
--      blog is not a trend, and a count alone cannot tell it from fifty outlets
--      each covering something once.
--   3. EVIDENCE. An aggregate nobody can drill into is a number you have to take
--      on faith. A handful of exemplar stories per stack per month keeps the
--      "why" attached to the "how many" at trivial cost.

-- ---------------------------------------------------------------------------
-- The denominator.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS month_totals (
  month           date PRIMARY KEY,
  stories         int  NOT NULL,
  -- Tagged against the vocabulary at all. Every per-stack share is a fraction of
  -- THIS, not of `stories`: an untagged story could not have counted towards any
  -- technology, so including it in the denominator understates everything.
  tagged_stories  int  NOT NULL,
  distinct_sources int NOT NULL,
  -- Source mix moves under you. A jump in volume when the registry grew from 300
  -- to 473 feeds is a fact about the collector, not about the industry.
  active_sources  int  NOT NULL,
  releases        int  NOT NULL DEFAULT 0,
  news            int  NOT NULL DEFAULT 0,
  community       int  NOT NULL DEFAULT 0,
  research        int  NOT NULL DEFAULT 0,
  rolled_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- The spine: one row per technology per month.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stack_month (
  month           date NOT NULL,
  slug            text NOT NULL,
  stories         int  NOT NULL,
  -- How many DIFFERENT feeds carried it. The single most useful column here:
  -- it separates something the industry is talking about from something one
  -- outlet is talking about a lot.
  distinct_sources int NOT NULL,
  -- Summed coverage_count: how many outlets carried the underlying stories.
  outlet_mentions int  NOT NULL DEFAULT 0,
  -- What KIND of attention. A technology whose entire month is release notes is
  -- in a different phase from one being written about by the press.
  from_releases   int  NOT NULL DEFAULT 0,
  from_news       int  NOT NULL DEFAULT 0,
  from_community  int  NOT NULL DEFAULT 0,
  from_research   int  NOT NULL DEFAULT 0,
  avg_importance  numeric(4,2),
  max_importance  int,
  -- Share of the month's tagged stories, stored rather than computed, so a
  -- query over ten years does not have to join the totals every time.
  share           numeric(7,6) NOT NULL DEFAULT 0,
  -- Rank within the month by story count: the cheapest way to ask "was it
  -- top-ten that month" without re-sorting the whole table.
  rank_in_month   int,
  first_published date,
  last_published  date,
  PRIMARY KEY (month, slug)
);

CREATE INDEX IF NOT EXISTS stack_month_slug_idx  ON stack_month (slug, month);
CREATE INDEX IF NOT EXISTS stack_month_rank_idx  ON stack_month (month, rank_in_month);

-- ---------------------------------------------------------------------------
-- What rises together.
-- ---------------------------------------------------------------------------
-- Fashion is relational: React and TypeScript climbed together, Kubernetes
-- dragged Helm and Prometheus behind it, and a stack that only ever appears
-- beside one other is a satellite rather than a trend. Thresholded at 3 per
-- month, which took 154 months of history to 4,260 rows.
CREATE TABLE IF NOT EXISTS stack_pair_month (
  month     date NOT NULL,
  slug_a    text NOT NULL,
  slug_b    text NOT NULL,
  stories   int  NOT NULL,
  PRIMARY KEY (month, slug_a, slug_b),
  -- Stored one way round only (a < b); the reader flips it. Halves the table
  -- and removes the chance of the two directions disagreeing.
  CONSTRAINT stack_pair_ordered CHECK (slug_a < slug_b)
);

CREATE INDEX IF NOT EXISTS stack_pair_month_b_idx ON stack_pair_month (slug_b, month);

-- ---------------------------------------------------------------------------
-- Who was doing the talking.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_month (
  month     date NOT NULL,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  stories   int  NOT NULL,
  PRIMARY KEY (month, source_id)
);

-- ---------------------------------------------------------------------------
-- The other two vocabularies, same shape.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_month (
  month            date NOT NULL,
  slug             text NOT NULL,
  stories          int  NOT NULL,
  distinct_sources int  NOT NULL,
  share            numeric(7,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (month, slug)
);

CREATE TABLE IF NOT EXISTS platform_month (
  month            date NOT NULL,
  slug             text NOT NULL,
  stories          int  NOT NULL,
  distinct_sources int  NOT NULL,
  share            numeric(7,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (month, slug)
);

-- ---------------------------------------------------------------------------
-- The evidence.
-- ---------------------------------------------------------------------------
-- Three stories per technology per month, chosen by how widely they were
-- carried. This is what stops the archive becoming a wall of numbers nobody can
-- interrogate: when the chart shows Rust spiking in March 2024, this says what
-- happened. The URL is kept so the original is still reachable even though the
-- story row is long gone.
CREATE TABLE IF NOT EXISTS stack_month_exemplar (
  month        date NOT NULL,
  slug         text NOT NULL,
  rank         smallint NOT NULL,
  title        text NOT NULL,
  url          text NOT NULL,
  source_name  text,
  published_at date,
  coverage     int,
  importance   int,
  PRIMARY KEY (month, slug, rank)
);

-- ---------------------------------------------------------------------------
-- What has been rolled up, and therefore what is safe to delete.
-- ---------------------------------------------------------------------------
-- Retention reads this and refuses to delete a month that is not in it. A
-- deletion that outruns its rollup is unrecoverable -- the stories are the only
-- copy -- so the order is enforced by data rather than by remembering.
CREATE TABLE IF NOT EXISTS rollup_log (
  month          date PRIMARY KEY,
  stories_seen   int NOT NULL,
  stacks_written int NOT NULL,
  pairs_written  int NOT NULL,
  rolled_at      timestamptz NOT NULL DEFAULT now(),
  stories_pruned int,
  pruned_at      timestamptz
);

GRANT SELECT ON month_totals, stack_month, stack_pair_month, source_month,
                company_month, platform_month, stack_month_exemplar, rollup_log
   TO newstrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE
   ON month_totals, stack_month, stack_pair_month, source_month,
      company_month, platform_month, stack_month_exemplar, rollup_log
   TO newstrack_worker;

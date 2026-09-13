-- The work market, measured where the work is posted.
--
-- 2026-09-13: "The report still focus on projects, I want clear report - which
-- market like freelancing, jobs are changes, which market appear newly and we
-- can use which platform to attend to this market."
--
-- The reports were written from engineering blogs and release feeds, so every
-- one of them was about projects: what Vercel shipped, what ClickHouse bought.
-- A vendor post says what a company decided to sell. It cannot say which kind
-- of work is being paid for, whether that work is remote or contract, how many
-- other people are competing for it, or where to go to get it.
--
-- Those are questions about POSTINGS, and three public records answer them:
--
--   Hacker News "Who is hiring?", "Who wants to be hired?" and "Freelancer?
--   Seeking freelancer?" -- one thread each a month since 2011, every post
--   public, anybody can recount them. Demand, supply and the freelance market
--   side by side, over fifteen years.
--
--   Remote job boards with public feeds -- Himalayas, We Work Remotely, Remote
--   OK, Jobicy, Working Nomads -- and Superteam Earn's open bounties. What is
--   being posted right now, on the platforms a remote worker actually uses.
--
--   Indeed Hiring Lab, already in `labour_series` (0082).
--
-- WHAT IS STORED, AND WHAT IS NOT. No post text is kept: a thread is ~500 KB
-- and there are 500 of them. Only the counts, with the thread id so any count
-- can be recounted from the public API. Board listings keep title, category,
-- type, tags and pay -- enough to classify and to link back to the board -- and
-- never the description.

-- One number per thread (or board snapshot) per market per measure.
CREATE TABLE IF NOT EXISTS work_counts (
  -- 'hn-whoishiring', or a board slug for board snapshots.
  source      text        NOT NULL,
  -- 'hiring' | 'seeking' | 'freelance-work' | 'freelance-hire' for the HN
  -- threads; 'board' for a board's own totals.
  dataset     text        NOT NULL,
  -- The thread's posting date, or the snapshot day.
  day         date        NOT NULL,
  -- 'all', a market slug from src/vocab/workmarkets.ts, or 'skill:<slug>'.
  market      text        NOT NULL,
  -- 'posts' | 'remote' | 'contract' for threads; 'open' | 'reward' for boards.
  measure     text        NOT NULL,
  value       numeric     NOT NULL,
  -- The HN item the count was taken from, so it can be taken again.
  thread_id   text,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, dataset, day, market, measure)
);

CREATE INDEX IF NOT EXISTS work_counts_day
  ON work_counts (source, dataset, day DESC);

-- What a remote board is carrying, one row per listing.
CREATE TABLE IF NOT EXISTS work_listings (
  board         text        NOT NULL,
  listing_id    text        NOT NULL,
  posted_at     timestamptz,
  title         text        NOT NULL,
  company       text,
  -- The board's own category label, unchanged.
  category      text,
  -- The board's own employment type: 'Full-Time', 'contract', 'freelance'.
  employment    text,
  tags          text[]      NOT NULL DEFAULT '{}',
  -- Markets from src/vocab/workmarkets.ts, classified from title, category and
  -- tags at write time.
  markets       text[]      NOT NULL DEFAULT '{}',
  location      text,
  salary_min    numeric,
  salary_max    numeric,
  currency      text,
  -- Bounties: the prize, its token and how many people have already submitted.
  reward        numeric,
  reward_token  text,
  submissions   integer,
  url           text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board, listing_id)
);

CREATE INDEX IF NOT EXISTS work_listings_posted
  ON work_listings (board, posted_at DESC);
CREATE INDEX IF NOT EXISTS work_listings_markets
  ON work_listings USING gin (markets);

-- Where a person goes to take the work. Curated in seeds/workplatforms.ts, with
-- every address checked when it is seeded.
CREATE TABLE IF NOT EXISTS work_platforms (
  slug          text        PRIMARY KEY,
  name          text        NOT NULL,
  url           text        NOT NULL,
  -- 'marketplace' | 'network' | 'board' | 'community' | 'ai-work' | 'bounty'
  -- | 'security'
  kind          text        NOT NULL,
  -- One sentence: how work arrives on this platform.
  how           text        NOT NULL,
  markets       text[]      NOT NULL DEFAULT '{}',
  -- The `work_listings.board` or `work_counts.source` that measures it, when
  -- one does. Null for platforms with no public feed.
  measured_by   text,
  check_status  integer,
  checked_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON work_counts, work_listings, work_platforms TO newstrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON work_counts, work_listings, work_platforms
  TO newstrack_worker;

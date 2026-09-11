-- Where the work actually is, from somebody else's measurement.
--
-- 2026-09-11: "the purpose of this project is finding new market and market
-- change", followed by a nineteen-section report on the IT labour market and
-- "I want to make monthly report at this level".
--
-- That report is built from Indeed Hiring Lab, the Stanford Digital Economy
-- Lab, METR, DORA, Gartner, ISC2 and the BLS. This archive had none of them.
-- Its instruments were 512 mostly-vendor feeds, download curves for 152
-- packages, and GitHub topic censuses -- none of which can say what is being
-- hired for, at what rate, or from where. A report about the market for work
-- cannot be assembled out of what vendors chose to blog about.
--
-- WHAT THIS TABLE IS FOR, and what it deliberately is not.
--
-- Indeed Hiring Lab publishes its trackers as plain CSV in public GitHub
-- repositories, updated daily, under a licence that permits this. They are
-- somebody else's measurement of a population this archive cannot see: every
-- job posting on one of the largest job boards in the world, indexed to
-- 1 February 2020 = 100, by country and by occupational sector.
--
-- Three of them matter here:
--
--   postings     the level of job postings by sector. "Software Development"
--                is a sector, and so are "Data & Analytics", "IT Systems &
--                Solutions", "Mathematics" and forty-odd controls that are not
--                technology at all -- which is what makes the technology
--                numbers mean something.
--   remote       the share of postings mentioning remote or hybrid work, by
--                sector. This archive exists to find remote work; this is the
--                only number in it that measures how much of that there is.
--   ai           the share of postings mentioning AI or generative AI terms.
--                The demand side of the thing every vendor blog is about.
--
-- NOT STORED: posted wage growth. Hiring Lab publishes it and its US sector
-- list contains nineteen sectors, none of which is software -- it is
-- administrative assistance, childcare, nursing, retail and the like. Collecting
-- it would put a pay number on the page that says nothing about this readership,
-- and an adjacent number that does not apply is worse than no number.
--
-- THE SHAPE IS ONE ROW PER SERIES PER DAY, deliberately narrow. Every value is
-- a number somebody else published on a date, and the row records which
-- dataset, which country, which sector and which measure it came from so that
-- any figure on any page can be traced back to one line of one public CSV and
-- re-fetched by anybody. Nothing here is computed by this repository; the
-- arithmetic happens in `src/analysis/labour.ts` where it can be read.

CREATE TABLE IF NOT EXISTS labour_series (
  -- Who published it. One value today; named rather than assumed so a second
  -- source does not require a migration to tell the two apart.
  source      text        NOT NULL,
  -- Which of that publisher's datasets: 'postings' | 'remote' | 'ai'.
  dataset     text        NOT NULL,
  -- ISO country code as the publisher writes it: 'US', 'GB', 'CA', 'DE'.
  country     text        NOT NULL,
  -- The publisher's own sector label, unchanged. 'Software Development' in the
  -- postings tracker, 'techsoftware' in the remote tracker -- they do not agree
  -- with each other and neither is rewritten here, because a label this
  -- repository invented would be a label nobody could check against the source.
  sector      text        NOT NULL,
  -- 'total postings' | 'new postings' for the postings tracker; 'share' for the
  -- others. Part of the key because one sector-day has more than one measure.
  measure     text        NOT NULL,
  day         date        NOT NULL,
  value       numeric     NOT NULL,
  -- When this row was fetched. A figure with no fetch date is a claim about the
  -- present made from an unknown past, which is the rule `public.ts` already
  -- applies to adoption numbers.
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, dataset, country, sector, measure, day)
);

-- The two queries this table exists to answer: one sector's whole series, and
-- every sector on one day.
CREATE INDEX IF NOT EXISTS labour_series_sector_day
  ON labour_series (dataset, country, sector, measure, day DESC);
CREATE INDEX IF NOT EXISTS labour_series_day
  ON labour_series (dataset, country, day DESC);

GRANT SELECT ON labour_series TO newstrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON labour_series TO newstrack_worker;

-- 0035: teach the derived views that history no longer lives in `stories`.
--
-- 0033 split the archive in two. Whole stories are kept for a month; everything
-- older survives as monthly aggregate. That was the right trade, and it quietly
-- broke every number computed by counting rows in `stories`, because those
-- numbers were all answering "how much has ever been written about this" and
-- the table they ask stopped being able to answer it.
--
-- `stack_frequency` is the sharpest case. It backs the "niche technologies"
-- view, whose threshold is three stories IN THE WHOLE ARCHIVE. Counted over one
-- month instead, almost the entire 1,600-entry vocabulary falls under three, and
-- a view meant to surface the genuinely obscure would return nearly everything
-- -- not obviously broken, which is the worst way for a threshold to break.
--
-- So it is redefined over both halves, and the seam is the rollup log:
--
--   a month WITHOUT a rollup_log row   -> count its stories, they are the truth
--   a month WITH one                   -> use stack_month, the stories are gone
--                                         (or are a handful of favourites, which
--                                         the aggregate already counted)
--
-- That split is what keeps it from double counting. A rolled-but-not-yet-pruned
-- month exists in both places for a while, and counting it twice would inflate
-- exactly the technologies that are best covered.

DROP MATERIALIZED VIEW IF EXISTS stack_frequency;

CREATE MATERIALIZED VIEW stack_frequency AS
WITH live AS (
  -- Months the rollup has not claimed yet: the current one, plus anything
  -- collected since the last run.
  SELECT x AS slug,
         count(*)::int AS stories,
         count(*) FILTER (
           WHERE coalesce(s.published_at, s.collected_at) > now() - interval '90 days')::int
           AS recent
    FROM stories s, LATERAL unnest(s.stacks) AS x
   WHERE s.superseded_by IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM rollup_log l
        WHERE l.month = date_trunc('month', s.published_at)::date)
   GROUP BY x
),
archived AS (
  -- Everything the rollup has taken over. `stories` here is already a count of
  -- stories, so the two halves add without translation.
  SELECT slug,
         sum(stories)::int AS stories,
         coalesce(sum(stories) FILTER (
           WHERE month >= date_trunc('month', now() - interval '90 days')), 0)::int AS recent
    FROM stack_month
   GROUP BY slug
)
SELECT coalesce(l.slug, a.slug) AS slug,
       (coalesce(l.stories, 0) + coalesce(a.stories, 0))::int AS stories,
       (coalesce(l.recent, 0) + coalesce(a.recent, 0))::int AS recent
  FROM live l
  FULL JOIN archived a ON a.slug = l.slug;

CREATE UNIQUE INDEX IF NOT EXISTS stack_frequency_slug_idx ON stack_frequency (slug);
CREATE INDEX IF NOT EXISTS stack_frequency_stories_idx ON stack_frequency (stories);

GRANT SELECT ON stack_frequency TO newstrack_app, newstrack_worker;

-- ---------------------------------------------------------------------------
-- The same seam, as a view, for everything that reads a per-technology series.
-- ---------------------------------------------------------------------------
-- Written once here rather than repeated in each page, because the double-count
-- rule above is easy to state and easy to forget, and forgetting it produces
-- numbers that look plausible.
--
-- Monthly, not weekly: monthly is the resolution history actually survives at.
-- The live month still has whole stories and can be cut finer, and the reader
-- does that separately -- but a series that runs back years has to be built out
-- of what is there for all of it.
CREATE OR REPLACE VIEW stack_history AS
SELECT date_trunc('month', s.published_at)::date AS month,
       x AS slug,
       count(*)::int AS stories,
       count(DISTINCT s.source_id)::int AS distinct_sources,
       max(s.importance)::int AS max_importance,
       false AS archived
  FROM stories s, LATERAL unnest(s.stacks) AS x
 WHERE s.superseded_by IS NULL
   AND s.published_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM rollup_log l
      WHERE l.month = date_trunc('month', s.published_at)::date)
 GROUP BY 1, 2
UNION ALL
SELECT month, slug, stories, distinct_sources, max_importance, true
  FROM stack_month;

GRANT SELECT ON stack_history TO newstrack_app, newstrack_worker;

-- And the denominator, the same way: what the whole archive did each month, so
-- a per-technology count can always be read as a share rather than a raw number.
CREATE OR REPLACE VIEW archive_history AS
SELECT date_trunc('month', s.published_at)::date AS month,
       count(*)::int AS stories,
       count(*) FILTER (WHERE array_length(s.stacks, 1) > 0)::int AS tagged_stories,
       count(DISTINCT s.source_id)::int AS distinct_sources,
       false AS archived
  FROM stories s
 WHERE s.superseded_by IS NULL
   AND s.published_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM rollup_log l
      WHERE l.month = date_trunc('month', s.published_at)::date)
 GROUP BY 1
UNION ALL
SELECT month, stories, tagged_stories, distinct_sources, true
  FROM month_totals;

GRANT SELECT ON archive_history TO newstrack_app, newstrack_worker;

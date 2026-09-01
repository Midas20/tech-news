-- 0025: how rare a technology is.
--
-- "Niche" meant a story carried by two outlets or fewer -- a property of the
-- STORY. The more useful reading, and the one asked for, is a property of the
-- TECHNOLOGY: news about things almost nobody writes about. Those are different
-- questions and the second is the harder one to get any other way, because the
-- long tail of a 1,600-entry vocabulary is invisible in a feed sorted by
-- anything else.
--
-- Materialised because it is read on every niche query and changes only when
-- stories are tagged. Recomputing a group-over-unnest of the whole archive per
-- page load is the kind of query that is fine at 3,500 stories and ruinous at
-- 350,000.

CREATE MATERIALIZED VIEW IF NOT EXISTS stack_frequency AS
  SELECT x AS slug,
         count(*)::int AS stories,
         count(*) FILTER (
           WHERE coalesce(s.published_at, s.collected_at) > now() - interval '90 days')::int AS recent
    FROM stories s, LATERAL unnest(s.stacks) AS x
   WHERE s.superseded_by IS NULL
   GROUP BY x;

CREATE UNIQUE INDEX IF NOT EXISTS stack_frequency_slug_idx ON stack_frequency (slug);
CREATE INDEX IF NOT EXISTS stack_frequency_stories_idx ON stack_frequency (stories);

GRANT SELECT ON stack_frequency TO newstrack_app, newstrack_worker;

-- CONCURRENTLY needs the unique index above and lets the refresh run while the
-- reader is querying it.
CREATE OR REPLACE FUNCTION refresh_stack_frequency() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY stack_frequency;
EXCEPTION WHEN OTHERS THEN
  -- A first refresh cannot run concurrently; fall back rather than fail a cycle.
  REFRESH MATERIALIZED VIEW stack_frequency;
END
$fn$;

GRANT EXECUTE ON FUNCTION refresh_stack_frequency() TO newstrack_app, newstrack_worker;

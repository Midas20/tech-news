-- 0036: the registry's all-time column, precomputed.
--
-- 0035 gave the pages a `stack_history` view that stitches live months onto
-- rolled ones. Reading it once is cheap. Reading it once PER ROW is not, and
-- that is exactly what the registry did when its per-stack total moved onto it:
-- a LATERAL over 1,600 vocabulary entries re-evaluated the view's live half --
-- a group-over-unnest of every story in the current month -- 1,600 times. The
-- page stopped answering rather than got slower, which is the honest way to
-- find out you have written a quadratic query and no way to ship one.
--
-- So the same numbers are materialised here, with the hierarchy expansion done
-- once instead of per row.
--
-- Expansion is the reason this cannot just be `stack_frequency` with more
-- columns. The registry's count includes everything BENEATH an entry -- asking
-- about "javascript" and being told only about stories that used that exact
-- word, while `react` and `node` sit underneath it, is a wrong answer that
-- looks like a right one. `stack_frequency` is per exact slug and backs a
-- different question ("how rare is this term"), so both exist.

CREATE MATERIALIZED VIEW IF NOT EXISTS stack_totals AS
WITH RECURSIVE fam AS (
  -- Every entry paired with itself and everything under it.
  --
  -- One recursive pass for the whole vocabulary rather than a stack_expand()
  -- call per root: same answer, and it walks each edge once instead of once per
  -- ancestor. `depth` is a cycle guard -- parent_id is a plain self-reference
  -- with nothing stopping a loop, and a loop here does not error, it hangs.
  SELECT id AS root_id, slug AS root, id AS member_id, slug AS member, 0 AS depth
    FROM stacks
  UNION ALL
  SELECT f.root_id, f.root, s.id, s.slug, f.depth + 1
    FROM fam f JOIN stacks s ON s.parent_id = f.member_id
   WHERE f.depth < 12
)
SELECT f.root AS slug,
       coalesce(sum(h.stories), 0)::int AS stories,
       coalesce(max(h.distinct_sources), 0)::int AS peak_sources,
       max(h.max_importance)::int AS max_importance,
       min(h.month) AS first_month,
       max(h.month) AS last_month,
       count(DISTINCT h.month)::int AS months_seen
  FROM fam f
  LEFT JOIN stack_history h ON h.slug = f.member
 GROUP BY f.root;

CREATE UNIQUE INDEX IF NOT EXISTS stack_totals_slug_idx ON stack_totals (slug);
CREATE INDEX IF NOT EXISTS stack_totals_stories_idx ON stack_totals (stories DESC);

GRANT SELECT ON stack_totals TO newstrack_app, newstrack_worker;

-- Refreshed with stack_frequency, because they go stale for the same reasons --
-- a tagging pass, a collection cycle, a rollup -- and a caller that refreshes
-- one and forgets the other produces two adjacent numbers on the same page that
-- disagree.
CREATE OR REPLACE FUNCTION refresh_stack_frequency() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY stack_frequency;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW stack_frequency;
  END;
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY stack_totals;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW stack_totals;
  END;
END
$fn$;

GRANT EXECUTE ON FUNCTION refresh_stack_frequency() TO newstrack_app, newstrack_worker;

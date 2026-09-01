-- 0040: expand the taxonomy by lookup, not by walking it again.
--
-- `/news?field=languages` did not answer. Not slowly -- at all, past a
-- ninety-second timeout, while `?field=ai` on the same page took 1.4 seconds.
--
-- The clause is the same for both:
--
--   s.stacks && stack_expand(ARRAY[$1]::text[])
--
-- and stack_expand is STABLE, which permits the planner to call it once per row
-- rather than once. Each call is a recursive descent of the whole subtree. That
-- is survivable when the subtree is small -- `ai` is 81 slugs, `frontend` 37 --
-- and it is not when it is `languages`, which is 668: every language, every
-- library under every language. Same query shape, same code path, and the only
-- thing separating "fine" from "never returns" is which root you clicked.
--
-- The fix is to stop recomputing an answer that changes only when the
-- vocabulary changes. The closure of every entry is precomputed here, once, by
-- the same single recursive pass 0036 already uses for stack_totals, and
-- stack_expand becomes an indexed lookup. Called per row it is now a couple of
-- index probes rather than a tree walk, which is the difference between a
-- planner mistake costing a few milliseconds and it costing the page.
--
-- This is the fourth time the cost of expanding this hierarchy has taken a page
-- down. The other three were fixed one query at a time, by moving the call into
-- a materialised CTE. This one fixes the function itself, so every call site --
-- twenty-two of them across the reader, the registry, the fields pages, the
-- trends and search -- gets the cheap version without being rewritten, and the
-- next query someone writes gets it too.

CREATE MATERIALIZED VIEW IF NOT EXISTS stack_closure AS
WITH RECURSIVE fam AS (
  -- Every entry paired with itself and everything under it. `depth` is a cycle
  -- guard: parent_id is a plain self-reference with nothing stopping a loop,
  -- and a loop here does not raise, it hangs -- which is precisely the failure
  -- this migration exists to remove, so it is not repeated at a lower level.
  SELECT id AS root_id, slug AS root, id AS member_id, slug AS member, 0 AS depth
    FROM stacks
  UNION ALL
  SELECT f.root_id, f.root, s.id, s.slug, f.depth + 1
    FROM fam f JOIN stacks s ON s.parent_id = f.member_id
   WHERE f.depth < 12
)
SELECT root AS slug,
       array_agg(DISTINCT member ORDER BY member) AS members,
       count(DISTINCT member)::int AS n
  FROM fam
 GROUP BY root;

CREATE UNIQUE INDEX IF NOT EXISTS stack_closure_slug_idx ON stack_closure (slug);

GRANT SELECT ON stack_closure TO newstrack_app, newstrack_worker;

-- Same signature, same answer, same STABLE contract. Only the cost changes, so
-- nothing that calls it needs to know this happened.
--
-- A root with no row -- one added since the last refresh -- still expands to
-- itself rather than to nothing. Returning an empty array for a stack that
-- exists would turn a stale matview into a page that silently shows no stories,
-- which is the worst of the available failures because it looks like an answer.
CREATE OR REPLACE FUNCTION stack_expand(roots text[])
RETURNS text[] LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(DISTINCT m), '{}')
    FROM (
      SELECT unnest(c.members) AS m
        FROM stack_closure c
       WHERE c.slug = ANY(roots)
      UNION ALL
      SELECT r FROM unnest(roots) AS r
       WHERE NOT EXISTS (SELECT 1 FROM stack_closure c WHERE c.slug = r)
    ) x
$fn$;

-- stack_descendants keeps its recursive definition: it is the row-returning
-- form, it is used in joins where the planner wants a set rather than an array,
-- and it is called once per query rather than once per row. Reading it out of
-- the closure would be a second thing to keep in step for no gain.

-- Refreshed with the others, and FIRST: stack_totals is built from the same
-- vocabulary, and a closure that lags the totals beside it is how two adjacent
-- numbers on one page come to disagree.
CREATE OR REPLACE FUNCTION refresh_stack_frequency() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY stack_closure;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW stack_closure;
  END;
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

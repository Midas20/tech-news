-- 0043: one membership row per outlet, not one per poll.
--
-- "Also carried by" on a story page listed the same Register URL thirty-seven
-- times, one row every fifteen minutes since the story was collected. Across
-- the archive: 180,456 rows describing 4,589 distinct (story, source, url)
-- triples.
--
-- The cause is in 0005 and it is not a typo, it is a constraint that could not
-- be written. story_members is PARTITIONED BY RANGE (seen_at), and Postgres
-- requires a unique index on a partitioned table to include the partition key.
-- So the index reads
--
--   (story_id, source_id, url, seen_at)
--
-- and with a timestamp in the key no two sightings can ever collide. The
-- ON CONFLICT DO NOTHING that ingest relied on therefore never fired once. The
-- schema's own comment -- "grows 5-8x faster than stories" -- was measuring
-- this and reading it as the nature of the table.
--
-- The write path is fixed in src/db/repos/stories.ts, which now asks whether
-- the membership already exists instead of asking the index to refuse it. This
-- collapses what the old path wrote.
--
-- The earliest row wins. seen_at is meant to be when this outlet was FIRST seen
-- carrying the story, which is what the coverage curve is drawn against; the
-- later copies are re-sightings and carry no information the first one lacks.

-- 0037 replaced the blanket refusal with a rule permitting only orphan cleanup,
-- which is right for the archive and cannot express "delete a row that is a
-- verbatim copy of the one beside it". Suspended for this statement only, and
-- restored immediately after -- deliberately in the same transaction, so a
-- failure here cannot leave the table unprotected.
ALTER TABLE story_members DISABLE TRIGGER story_members_orphans_only;

WITH ranked AS (
  SELECT id, seen_at,
         row_number() OVER (
           PARTITION BY story_id, source_id, url
           ORDER BY seen_at, id) AS n
    FROM story_members
)
DELETE FROM story_members m
 USING ranked r
 WHERE m.id = r.id AND m.seen_at = r.seen_at AND r.n > 1;

ALTER TABLE story_members ENABLE TRIGGER story_members_orphans_only;

-- coverage_count is `1 + count(DISTINCT source_id)`, so it was never wrong --
-- the DISTINCT was carrying the whole weight of a broken table. Recomputed
-- anyway, because after this the two agree by construction rather than by one
-- of them working around the other.
UPDATE stories s SET coverage_count = c.n
  FROM (SELECT story_id, 1 + count(DISTINCT source_id) AS n
          FROM story_members GROUP BY story_id) AS c
 WHERE s.id = c.story_id AND s.coverage_count <> c.n;

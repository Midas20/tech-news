-- 0047: coverage counted the publisher as corroboration of itself.
--
-- `story_members` holds two different things under one shape. A layer-2/3/4
-- merge records the OTHER outlet that carried a story, which is what coverage
-- means and what the column exists for. Layer 1 records a second ADDRESS for the
-- same item from the same publisher -- a feed link and a page's rel=canonical
-- disagreeing over a tracking parameter -- which is the same outlet twice.
--
-- Both writers of `coverage_count` counted `1 + count(DISTINCT source_id)` over
-- every member, so a changelog entry that only ever had one publisher read as
-- two outlets. It was not a rare edge: 487 of 542 live stories, nine in ten of
-- the archive, claimed corroboration that never existed. Zero stories in the
-- archive genuinely had coverage above one.
--
-- The code fix is in src/db/repos/stories.ts, in both addMember and
-- addMembersBatch. This is the repair of what they already wrote.

UPDATE stories s SET coverage_count = c.n
  FROM (
    SELECT x.id,
           1 + count(DISTINCT m.source_id)
                 FILTER (WHERE m.source_id <> x.source_id) AS n
      FROM stories x
      LEFT JOIN story_members m ON m.story_id = x.id
     GROUP BY x.id
  ) AS c
 WHERE s.id = c.id AND s.coverage_count IS DISTINCT FROM c.n;

-- The coverage curve is drawn from `coverage_snapshots`, whose `count` is a copy
-- of `coverage_count` taken at +1h, +6h, +24h and +7d. Every one of those copies
-- inherited the same error, which is why a single-outlet story rendered a chart
-- reading "peak 2 in one bucket".
--
-- The reader page says a curve cannot be reconstructed later, and that is true
-- of the MEASUREMENT: the number of outlets at +6h is knowable only at +6h, and
-- writing today's figure into that slot would be a fabrication. This is a
-- different operation. Every member row carries `seen_at`, so "how many other
-- outlets had been seen by the moment this snapshot was captured" is a fact
-- already in the database, recorded at the time. Correcting arithmetic over
-- retained evidence is not the same as inventing a measurement, and the
-- distinction is the whole reason `seen_at` is kept.
UPDATE coverage_snapshots cs SET count = t.n
  FROM (
    SELECT cs2.story_id, cs2.captured_at,
           1 + count(DISTINCT m.source_id) AS n
      FROM coverage_snapshots cs2
      JOIN stories x ON x.id = cs2.story_id
      LEFT JOIN story_members m
             ON m.story_id = cs2.story_id
            AND m.source_id <> x.source_id
            AND m.seen_at <= cs2.captured_at
     GROUP BY cs2.story_id, cs2.captured_at
  ) AS t
 WHERE cs.story_id = t.story_id AND cs.captured_at = t.captured_at
   AND cs.count IS DISTINCT FROM t.n;

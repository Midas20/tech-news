-- 0042: collapse the stories that were stored more than once at the same URL.
--
-- Ingest looked up the URL an item arrived by, and stored the URL the page
-- claimed to be. When a feed's link and a page's rel=canonical disagree -- a
-- tracking parameter, a "www" the canonical drops -- those are different
-- strings, so the next poll looked up the arrival URL, found nothing, fetched,
-- rewrote, and inserted the article again. And again. ZDNET's travel-charger
-- piece was stored eight times in eight hours; one Hacker News item
-- twenty-seven times. Every copy carried one canonical_url, and the first copy
-- was the only one holding a url key -- the later inserts collided with it and
-- silently kept none, which is the fingerprint that identified the bug.
--
-- The code fix is in src/collect/ingest.ts: the arrival hash is kept and
-- written as a second url key, and anything whose canonical was rewritten is
-- re-checked against what is already held before it counts as new. This is the
-- repair of what the bug already wrote.
--
-- Superseded, not deleted. `superseded_by` is what this schema already means by
-- "an older row that a later one replaced": the reader skips it, coverage stops
-- counting it, and retention removes it on the normal schedule. Deleting would
-- also mean arguing with the rules in 0037, for no gain.

WITH ranked AS (
  SELECT id,
         canonical_url,
         -- The first copy is the keeper: it is the one that holds the url key,
         -- the one every story_members row points at, and the one whose
         -- collected_at is the truth about when this story was first seen.
         first_value(id) OVER (
           PARTITION BY canonical_url ORDER BY collected_at, id) AS keeper
    FROM stories
   WHERE superseded_by IS NULL
), dupes AS (
  SELECT id, keeper FROM ranked WHERE id <> keeper
)
UPDATE stories s
   SET superseded_by = d.keeper
  FROM dupes d
 WHERE s.id = d.id;

-- Coverage counts the outlets carrying a story, and a story that was itself
-- duplicated has been counting its own copies. Recount from story_members for
-- everything that just absorbed one.
UPDATE stories s SET coverage_count = c.n
  FROM (
    SELECT m.story_id, 1 + count(DISTINCT m.source_id) AS n
      FROM story_members m
     WHERE EXISTS (SELECT 1 FROM stories x
                    WHERE x.superseded_by = m.story_id)
     GROUP BY m.story_id
  ) AS c
 WHERE s.id = c.story_id AND s.coverage_count <> c.n;

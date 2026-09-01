-- Undo 0056, which solved a problem that was already solved.
--
-- 0056 added `story_urls` on the reasoning that `stories` is partitioned and so
-- cannot carry a global unique index on the URL. That reasoning is correct and
-- the conclusion was wrong: `story_keys` has been that table since the archive
-- was built. PRIMARY KEY (key_hash), not partitioned, one row per URL for the
-- whole archive -- exactly the thing 0056 went and built a second copy of.
--
-- Adding a second identity table to a system that already had one is the same
-- mistake this codebase keeps finding in itself: one fact written twice, in two
-- places, with nothing making them agree.
--
-- THE REAL DEFECT IS IN THE ORDER OF TWO WRITES, not in the schema.
--
--   insertStory()    writes the story
--   registerKeys()   claims the URL, ON CONFLICT (key_hash) DO NOTHING
--
-- The claim is allowed to fail and the story is already there. So when two
-- polls race, both insert, the loser's claim quietly does nothing, and the
-- archive ends up with two rows for one URL and only one of them owning it.
-- Measured: 70 such rows in 1,272 -- GitLab releases holding 30 rows at 15
-- addresses, the .NET blog 14 at 7. Exactly twice each, which is the shape of a
-- lost race rather than of a bad feed.
--
-- Fixed in src/db/repos/stories.ts: the URL is claimed FIRST, and the story is
-- written only by the claim's winner. A story cannot exist without owning its
-- address, which is what "the URL is the primary key" has to mean to be worth
-- anything.

DROP TABLE IF EXISTS story_urls;

-- Kept from 0056. Nothing in the collector reads it -- the lookup goes through
-- story_keys -- but every audit of duplicate addresses does, and the table is
-- append-mostly so the write cost is small.
CREATE INDEX IF NOT EXISTS stories_url_hash ON stories (url_hash);

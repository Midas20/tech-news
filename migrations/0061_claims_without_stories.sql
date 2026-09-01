-- 0061: a claim without a story is not a claim.
--
-- `story_keys` is what makes the URL a story's identity: the collector claims
-- an address before writing anything under it, and an item whose address is
-- already claimed is a duplicate. That is the right rule, and it had a hole at
-- both ends -- nothing removed a claim when its story was deleted, and the
-- lookup never checked whether the owner still existed.
--
-- So a deleted story left its addresses locked. Forever, and invisibly: the
-- item is counted as a `duplicate`, which is the same thing the collector says
-- about the thousands of items it correctly already holds.
--
-- Measured on 2026-08-28, two days after the registry was emptied:
--
--   73,286   url keys
--   71,274   pointing at a story that no longer exists          (97%)
--      374   items inside the retention window, on offer in the
--             live feeds right now, that could never be collected
--   41,795   `duplicate` drops in thirty days -- the second largest
--             reason in the archive, after the closed month 0060 fixes
--
-- Worst hit were the sources whose whole feed was re-read during the emptying:
-- Vercel 103 blocked, AWS Security Bulletins 77, ClickHouse 32, NVIDIA 28,
-- OpenAI 21 -- five of the fourteen live sources that have never produced a
-- single story.
--
-- Three changes, and the migration is only the first:
--
--   here             delete the orphans that already exist
--   findManyByUrl    an address is only held if its holder exists
--   claimUrls        a dead claim is taken over, not lost
--
-- The last one is why this is not a recurring cleanup job. Deleting stories is
-- normal -- retention does it every month -- so the collector has to survive it
-- rather than be repaired afterwards.

DELETE FROM story_keys k
 WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = k.story_id);

-- Not a foreign key, deliberately.
--
-- `stories` is partitioned by month, and a FK to a partitioned table means
-- every insert here pays a lookup across every partition -- on the hottest
-- write path the collector has. The rule is enforced where it is read instead:
-- both lookups check, and the claim takes over a dead one. This DELETE is the
-- one-time repair, not the mechanism.

-- Membership rows have the same shape of problem and none of the consequences:
-- a member of a deleted story is orphaned data, but nothing reads it as a
-- refusal, so it costs disk and not news. Cleaned here for the same reason.
DELETE FROM story_members m
 WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = m.story_id);

-- The seventy rows that lost a race and were kept anyway.
--
-- Before the URL was claimed ahead of the insert, two polls arriving at one
-- address both wrote a story and only one of them won the key. What is left is
-- 70 rows over 1,272 whose URL is held by a different story: GitLab releases at
-- 30 rows for 15 addresses, the .NET blog at 14 for 7. Exactly twice each.
--
-- They are SUPERSEDED, not deleted, which is what this archive already does
-- when two stories turn out to be one: `superseded_by` points the loser at the
-- winner, every aggregate keeps adding up, and `story_members` keeps the record
-- that the address was seen twice. A DELETE here would silently change numbers
-- a reader has already been shown.
--
-- The winner is whoever holds the URL in `story_keys`, which is the row every
-- earlier deduplication was measured against and therefore the one carrying the
-- members, the coverage and the snapshots.

-- The loser joins the winner's story as a member first, so the second sighting
-- is not lost on the way to being hidden.
INSERT INTO story_members (story_id, source_id, url, title, match_layer, seen_at)
SELECT k.story_id, dup.source_id, dup.canonical_url,
       coalesce(dup.title_en, dup.title_original), 1, dup.first_seen_at
  FROM stories dup
  JOIN story_keys k ON k.key_hash = dup.url_hash AND k.key_kind = 'url'
 WHERE k.story_id <> dup.id
   AND dup.superseded_by IS NULL
ON CONFLICT DO NOTHING;

UPDATE stories dup
   SET superseded_by = k.story_id,
       superseded_at = now()
  FROM story_keys k
 WHERE k.key_hash = dup.url_hash
   AND k.key_kind = 'url'
   AND k.story_id <> dup.id
   AND dup.superseded_by IS NULL;

-- word_count was never words.
--
-- It has held `bodyText.length` since 0005 -- CHARACTERS -- and the name said
-- otherwise for sixty-two migrations. Nothing inside the collector minded,
-- because everything that read it compared one row against another and the unit
-- cancelled. The reading page is where it stopped cancelling:
--
--   if (archived >= 300 && readable.words < archived * 0.25)
--       "Only 561 words came back from a page the archive read as 3,769
--        -- it is probably behind a wall now."
--
-- 561 words and 3,769 characters are THE SAME TEXT. English runs about six
-- characters to the word, so `words < chars * 0.25` is true of essentially
-- every article ever collected, and the reader has been refusing to show the
-- page and falling back to the stored summary for all of them. What looked like
-- a wall-detection heuristic firing too eagerly was a unit conversion that was
-- never done.
--
-- Renamed rather than converted. Converting would need every row re-fetched to
-- be counted honestly, and would silently change what depthScore() means: it
-- normalises by 12,000, a figure calibrated against characters. The rename
-- keeps every stored number exactly as true as it was and makes the name agree
-- with it.
--
-- A partitioned table renames the column in every partition in one statement.

ALTER TABLE stories RENAME COLUMN word_count TO body_chars;

COMMENT ON COLUMN stories.body_chars IS
  'Characters of extracted body text at collection time. NOT words -- see 0067.';

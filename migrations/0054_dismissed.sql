-- Let a reader delete a story.
--
-- WHAT "DELETE" MEANS HERE, AND WHY IT IS NOT A DELETE.
--
-- This archive's contract is that news lives a month and ANALYSIS LIVES FOREVER:
-- `stack_totals`, `coverage_snapshots` and the month rollups are all derived
-- from stories, and a settled month is never recomputed. Removing the row after
-- its month is rolled up would leave every aggregate counting something that no
-- longer exists -- and removing it BEFORE the rollup silently changes a number
-- the reader has already seen. Neither is a delete; both are corruption with a
-- friendly name.
--
-- So dismissal is what the reader gets: gone from every view, reversible, and
-- recorded. The aggregates are untouched because the row is untouched. This is
-- the same shape `superseded_by` already uses for merges and `is_tech` for
-- off-topic -- three ways of not being shown, and none of them a DELETE.
--
-- `dismissed_reason` is free text and optional. It exists because "why did I
-- get rid of this" is the only interesting thing about a dismissal, and a
-- column of them is the raw material for a filter that learns.

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_reason text;

-- The reader's every query gains `dismissed_at IS NULL`. Partial, because the
-- dismissed set is small and it is the un-dismissed rows that need finding
-- fast.
CREATE INDEX IF NOT EXISTS stories_not_dismissed
  ON stories (collected_at DESC)
  WHERE dismissed_at IS NULL AND superseded_by IS NULL;

-- Finding them again, to undo one.
CREATE INDEX IF NOT EXISTS stories_dismissed
  ON stories (dismissed_at DESC)
  WHERE dismissed_at IS NOT NULL;

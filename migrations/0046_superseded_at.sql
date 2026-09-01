-- 0046: when a story was merged away, not just into what.
--
-- `superseded_by` and `supersede_reason` say WHAT happened and WHY. Nothing says
-- WHEN, and the difference is an afternoon.
--
-- Chasing a dedup fault that kept reappearing meant asking "which job created
-- these 67 merges" -- a question the archive could not answer. `collected_at`
-- is when the story arrived, which for a re-merged story is hours earlier and
-- tells you nothing; the job log says what each run reported, which is only
-- useful if the run that did it reported honestly. The investigation came down
-- to correlating counts against a poll loop, which is guesswork wearing a
-- lab coat.
--
-- One column ends that. "Which merges happened in the last ten minutes, and what
-- was running then" becomes a WHERE clause.
--
-- Backfilled to NULL rather than to a guess: a merge whose time is unknown must
-- read as unknown, not as the moment this migration ran.

ALTER TABLE stories ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

COMMENT ON COLUMN stories.superseded_at IS
  'When this story was merged into superseded_by. NULL for rows merged before 0046.';

-- The question this exists to answer is always "recently", so the index is
-- partial: merged rows are a small minority and unmerged ones are never asked
-- about here.
CREATE INDEX IF NOT EXISTS stories_superseded_at_idx
  ON stories (superseded_at DESC) WHERE superseded_by IS NOT NULL;

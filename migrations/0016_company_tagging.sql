-- 0016: mark when company tagging RAN, not just when it found something.
--
-- Without this the pass cannot make progress: a story with no company in it
-- stays eligible forever, so every batch re-examines the same rows and the
-- runner spins. "Examined and found nothing" is a result and has to be recorded,
-- exactly as classified_at records it for classification.

ALTER TABLE stories ADD COLUMN IF NOT EXISTS companies_tagged_at timestamptz;

CREATE INDEX IF NOT EXISTS stories_untagged_companies_idx ON stories (collected_at DESC)
  WHERE companies_tagged_at IS NULL AND superseded_by IS NULL;

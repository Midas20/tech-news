-- Remember what the gate refused, so the same item is not re-fetched forever.
--
-- Measured on 2026-09-09, chasing "the number of news is very low": 246,016
-- feed items were seen in three days and 5,199 stories were kept. 97,302 of the
-- refusals were `too_short`, and they were not 97,302 items. Vercel's feed
-- carries 1,563 entries; 1,103 of them failed the length gate on EVERY poll,
-- every thirty minutes, for as long as the collector has been running.
--
-- Nothing was wrong with refusing them. What was wrong is that a refusal left
-- no trace. Only stories that are KEPT get a row, so dedup can only recognise
-- what was accepted -- a refused item is indistinguishable from a new one on
-- the next poll, and is fetched, extracted, gated and refused again.
--
-- That is not merely wasted work, it is a cap on the archive. ingest.ts allows
-- 25 article fetches per source per poll. An item whose page cannot be read
-- occupies one of those 25 slots on every poll and never vacates it, so as
-- permanently-unreadable items accumulate at the head of a feed the budget
-- fills with them and the number of NEW stories a source can contribute falls
-- towards zero. Hugging Face has 860 title-only entries against a budget of 25.
--
-- So a refusal is recorded here and skipped next time -- but with an expiry,
-- because the reasons are not all permanent. A page that 403s today may not
-- next month, and a stub summary is sometimes a post that had not finished
-- publishing. `retry_after` is how the difference is expressed: cheap textual
-- refusals wait a long time, fetch failures wait a short one.
--
-- Deliberately NOT a foreign key to sources or stories. This table is a memory
-- of things that never became stories, and retention deletes stories; a
-- refusal outliving the archive it protected is the point of it.

CREATE TABLE IF NOT EXISTS refused_items (
  url_hash    bytea PRIMARY KEY,
  source_id   text NOT NULL,
  url         text NOT NULL,
  reason      text NOT NULL,
  -- How many polls have now refused it. Kept because a single refusal is a
  -- fact about one fetch and a fifth is a fact about the item.
  attempts    integer NOT NULL DEFAULT 1,
  first_at    timestamptz NOT NULL DEFAULT now(),
  last_at     timestamptz NOT NULL DEFAULT now(),
  -- Before this instant the item is skipped without being fetched. After it,
  -- the item gets one more chance and either becomes a story or comes back
  -- here with a longer wait.
  retry_after timestamptz NOT NULL
);

-- The one query this table exists to answer, asked once per source per poll:
-- of these N urls, which am I still allowed to skip?
CREATE INDEX IF NOT EXISTS refused_items_live
  ON refused_items (retry_after);

CREATE INDEX IF NOT EXISTS refused_items_source
  ON refused_items (source_id, last_at DESC);

-- A refusal is not a story and carries nothing a reader could see, so it is
-- readable by the worker alone; the reader role never needs it.
ALTER TABLE refused_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'newstrack_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON refused_items TO newstrack_worker;
    DROP POLICY IF EXISTS refused_items_worker ON refused_items;
    CREATE POLICY refused_items_worker ON refused_items
      FOR ALL TO newstrack_worker USING (true) WITH CHECK (true);
  END IF;
END $$;

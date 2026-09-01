-- 0034: favourites, and the one exemption from retention.
--
-- 0033 made stories disposable: a month is kept, the rest becomes aggregate.
-- That is right for a river and wrong for the handful of stories a person
-- deliberately kept, so this table is the exception -- and it is a table rather
-- than a flag on `stories` because it has to say two different things:
--
--   unfavourited_at IS NULL      kept. Retention must not touch it, ever.
--   unfavourited_at IS NOT NULL  released, at that moment. Retention may take it
--                                once the grace window has passed.
--
-- The grace window exists because un-favouriting is a click, and the story it
-- releases may be the only surviving copy of something six months old. Deleting
-- on the click makes that click unrecoverable; a day of grace makes it a
-- mistake you can undo by clicking again. The row is a tombstone in that window,
-- not an absence, which is also why re-favouriting is an UPDATE back to NULL
-- rather than a fresh INSERT -- saved_at survives the round trip.
--
-- No copy of the story is kept here. The point of a favourite is that the story
-- ITSELF stays, so this is a claim on a row in `stories`, and the retention
-- script honours it. When the claim lapses, both go.

CREATE TABLE IF NOT EXISTS favourites (
  -- Not a foreign key: `stories` is partitioned, and a FK to a partitioned
  -- parent would force every retention delete to check this table row by row.
  -- The protection is enforced where deletes happen, in one place, on purpose.
  story_id        uuid PRIMARY KEY,
  saved_at        timestamptz NOT NULL DEFAULT now(),
  -- When it was taken off the list. NULL means it is still on it.
  unfavourited_at timestamptz,
  note            text
);

-- Retention asks one question of this table -- "which of these ids are still
-- protected" -- and asks it about every story older than the window. Partial,
-- because the rows that matter are a small minority once someone has been using
-- the list for a while.
CREATE INDEX IF NOT EXISTS favourites_live_idx
  ON favourites (story_id) WHERE unfavourited_at IS NULL;

-- And the reverse question, asked by the sweeper: what has lapsed.
CREATE INDEX IF NOT EXISTS favourites_released_idx
  ON favourites (unfavourited_at) WHERE unfavourited_at IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON favourites TO newstrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON favourites TO newstrack_worker;

-- A favourite belongs to somebody.
--
-- Reported by clicking the star and being told:
--
--   "That changes something everybody sees, and this account is a reader."
--
-- The refusal was accurate and the design behind it was wrong. `favourites` had
-- one column that mattered -- story_id -- and PRIMARY KEY (story_id), so there
-- was exactly one favourites list for the whole installation. `stories.read_at`
-- is the same shape: one timestamp per story, so marking an article read marked
-- it read for everybody.
--
-- That was correct when the reader ran on 127.0.0.1 and there was one person.
-- It stopped being correct the moment accounts existed, and the authorisation
-- rule was the thing that noticed: it had to call a personal action "shared
-- state", because in the schema it genuinely was.
--
-- So the fix is not to relax the permission. It is to give reading an owner.
--
-- WHAT STAYS GLOBAL, AND WHY THAT IS NOT AN OVERSIGHT. `stories.dismissed_at`
-- is moderation -- it removes something from the archive because it should not
-- have been collected, which is what happened to eleven Daring Fireball links
-- that were somebody else's page. That IS shared state, it stays admin-only,
-- and it is a different act from "I have read this".

-- ---------------------------------------------------------------------------
-- Favourites

ALTER TABLE favourites ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;

-- Everything saved before accounts existed was saved by the person running the
-- installation, and the seeded administrator is the only account that can be.
-- Claimed rather than deleted: a favourite is a deliberate act and losing one
-- silently is worse than attributing it to the operator who made it.
UPDATE favourites SET account_id = (
  SELECT id FROM accounts WHERE role = 'admin' ORDER BY created_at LIMIT 1
) WHERE account_id IS NULL;

-- If there is no admin at all, there was nothing to claim and nothing to keep.
DELETE FROM favourites WHERE account_id IS NULL;

ALTER TABLE favourites
  ALTER COLUMN account_id SET NOT NULL,
  DROP CONSTRAINT favourites_pkey,
  ADD PRIMARY KEY (account_id, story_id);

-- The retention rule -- "favourites are exempt" -- asks whether ANY account
-- saved a story, so it needs to find rows by story without scanning.
CREATE INDEX favourites_story_idx ON favourites (story_id) WHERE unfavourited_at IS NULL;

COMMENT ON COLUMN favourites.account_id IS
  'Whose favourite. Before 0070 there was one list for the whole installation.';

-- ---------------------------------------------------------------------------
-- Read state

-- A row per account per story, created when somebody reads it. Absence means
-- unread, which is why there is no `unread_at` and no boolean: the common case
-- is the one that costs nothing to store.
CREATE TABLE story_reads (
  account_id uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  story_id   uuid        NOT NULL,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, story_id)
);

CREATE INDEX story_reads_story_idx ON story_reads (story_id);

COMMENT ON TABLE story_reads IS
  'Per-account read state. Replaces stories.read_at, which was one timestamp for everybody.';

-- Carry over what the single-user era recorded, to the account that recorded it.
INSERT INTO story_reads (account_id, story_id, read_at)
SELECT a.id, s.id, s.read_at
  FROM stories s
 CROSS JOIN LATERAL (
   SELECT id FROM accounts WHERE role = 'admin' ORDER BY created_at LIMIT 1
 ) a
 WHERE s.read_at IS NOT NULL
ON CONFLICT DO NOTHING;

-- `stories.read_at` is left in place and no longer written.
--
-- Dropping a column from a partitioned table with live traffic on it buys
-- nothing here: the data has been copied, every reader and writer moves to
-- story_reads in the same change, and a column nobody references is cheaper to
-- remove on a quiet day than mid-flight.
COMMENT ON COLUMN stories.read_at IS
  'SUPERSEDED by story_reads (0070). Retained only so the migration is reversible; '
  'nothing reads or writes it.';

GRANT SELECT, INSERT, UPDATE, DELETE ON story_reads TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON favourites TO app_user;

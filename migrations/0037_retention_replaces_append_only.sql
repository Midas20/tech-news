-- 0037: move the guarantee from "never delete" to "never delete unanalysed".
--
-- 0001 stated the principle and 0005 enforced it: `stories` and `story_members`
-- are append-only, corrections supersede, and a DELETE is a loud failure rather
-- than a silent hole in a permanent archive. That was right, and it is the
-- reason this database can be trusted about the past.
--
-- 0033 changed what "the archive" means. History is no longer the story rows --
-- it is `stack_month` and its siblings, written before anything is deleted and
-- covering months the story rows could never have reached on a 512 MB plan.
-- Under that arrangement a blanket refusal to delete does not protect the
-- archive; it caps the archive at whatever fits, which is about eighteen months
-- of collection, and then stops collecting.
--
-- So the guarantee moves rather than goes away, and it gets STRONGER in the one
-- way that matters: it stops being a convention the retention script promises
-- to honour and becomes something the database enforces. Before this migration,
-- "only delete a month that has been rolled up" was a WHERE clause in
-- scripts/retain.ts -- correct, tested, and one typo away from silently taking
-- a month whose analysis did not exist. Now the row itself refuses.
--
-- Three rules, and each says no to something the old trigger could not:
--
--   1. A story may be deleted only if its month is in `rollup_log`. An
--      unanalysed month is exactly the case the append-only rule existed to
--      prevent, and it is still prevented.
--   2. A story on the favourites list may never be deleted, whatever its month
--      says. The user asked for it by name; a retention pass should not be able
--      to take it by accident.
--   3. A child row may be deleted only once its parent story is already gone.
--      Deleting the coverage curve out from under a story that still exists is
--      how you get a row that renders as a stub, and it is not recoverable --
--      snapshots are a measurement of a moment that has passed.
--
-- Rule 3 is why retention now deletes stories BEFORE their members and
-- snapshots, which is the opposite of the usual order. The usual order protects
-- referential integrity; this one protects evidence, and there are no foreign
-- keys here to protect.

-- ---------------------------------------------------------------------------
-- Stories.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_unanalysed_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A story with no publication date belongs to no month, so no rollup can ever
  -- cover it. Those are kept, not guessed about.
  IF OLD.published_at IS NULL THEN
    RAISE EXCEPTION 'story % has no published_at, so no month covers it', OLD.id
      USING HINT = 'undated stories are never pruned; they are not in any rollup';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM rollup_log l
     WHERE l.month = date_trunc('month', OLD.published_at)::date
  ) THEN
    RAISE EXCEPTION 'story % is in %, which has not been rolled up',
      OLD.id, to_char(OLD.published_at, 'YYYY-MM')
      USING HINT = 'run `npm run rollup` first -- stories are the only copy of themselves';
  END IF;

  IF EXISTS (
    SELECT 1 FROM favourites f
     WHERE f.story_id = OLD.id AND f.unfavourited_at IS NULL
  ) THEN
    RAISE EXCEPTION 'story % is on the favourites list', OLD.id
      USING HINT = 'favourites are exempt from retention; remove it from the list first';
  END IF;

  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS stories_no_delete ON stories;
CREATE TRIGGER stories_analysed_before_delete
  BEFORE DELETE ON stories
  FOR EACH ROW EXECUTE FUNCTION forbid_unanalysed_delete();

-- ---------------------------------------------------------------------------
-- Children: members and the two snapshot tables.
-- ---------------------------------------------------------------------------
-- One rule for all three: the parent must already be gone. That makes the check
-- self-evidently safe -- there is no argument to have about whether the child
-- was still needed, because nothing is left to need it.
CREATE OR REPLACE FUNCTION forbid_orphan_only_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM stories s WHERE s.id = OLD.story_id) THEN
    RAISE EXCEPTION 'row still belongs to story %, which is still held', OLD.story_id
      USING HINT = 'delete the story first; this table may only be cleared of orphans';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS story_members_no_delete ON story_members;
CREATE TRIGGER story_members_orphans_only
  BEFORE DELETE ON story_members
  FOR EACH ROW EXECUTE FUNCTION forbid_orphan_only_delete();

DROP TRIGGER IF EXISTS coverage_snapshots_no_delete ON coverage_snapshots;
CREATE TRIGGER coverage_snapshots_orphans_only
  BEFORE DELETE ON coverage_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_orphan_only_delete();

DROP TRIGGER IF EXISTS engagement_snapshots_no_delete ON engagement_snapshots;
CREATE TRIGGER engagement_snapshots_orphans_only
  BEFORE DELETE ON engagement_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_orphan_only_delete();

-- `deliveries` and `platform_facts` keep their blanket refusal. Nothing rolls
-- them up, so for those two the original principle still holds unchanged.

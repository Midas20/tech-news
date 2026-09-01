-- 0039: repair the snapshot labels that could never be captured.
--
-- `scheduleSnapshotsBatch` formatted any offset of a day or more as days, which
-- turned the 24-hour offset into '1d'. Both snapshot tables carry
--
--   CHECK (offset_label IN ('1h','6h','24h','7d','adhoc'))
--
-- so '1d' is legal in `snapshot_schedule`, which has no such constraint, and
-- illegal in the table the capture writes to. The rows inserted happily and the
-- capture raised twenty-four hours later, inside the collector, one story at a
-- time.
--
-- The visible symptom was not an error. It was that every coverage curve was
-- missing its 24-hour point -- the single most useful one, since it is where a
-- story that spread and a story that did not have visibly diverged. 6,996 of
-- them were queued this way.
--
-- The formatter is fixed in src/db/repos/stories.ts. This relabels what it
-- already wrote, which is worth doing rather than deleting: the rows are still
-- due, the stories still exist, and a '1d' row renamed to '24h' captures at
-- exactly the moment it was always meant to.

UPDATE snapshot_schedule SET offset_label = '24h'
 WHERE offset_label = '1d'
   -- Only where it does not collide with a '24h' row already scheduled for the
   -- same story, which is possible for anything collected around the change.
   AND NOT EXISTS (
     SELECT 1 FROM snapshot_schedule other
      WHERE other.story_id = snapshot_schedule.story_id
        AND other.offset_label = '24h'
   );

-- Whatever collided is a duplicate of a row that already exists under the right
-- name, so it has nothing to contribute.
DELETE FROM snapshot_schedule WHERE offset_label = '1d';

-- The same shape would return the moment someone adds an offset to
-- SNAPSHOT_OFFSETS_HOURS that has no label. Better to refuse the row here than
-- to discover it a day later in the collector: this table is written in
-- batches, so a bad row poisons the whole batch, while the capture that reads
-- it fails story by story and looks like a network problem.
ALTER TABLE snapshot_schedule
  DROP CONSTRAINT IF EXISTS snapshot_schedule_offset_label_check;
ALTER TABLE snapshot_schedule
  ADD CONSTRAINT snapshot_schedule_offset_label_check
  CHECK (offset_label IN ('1h','6h','24h','7d','adhoc'));

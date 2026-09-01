-- Correcting what dirty_at means.
--
-- 0065 introduced it as a trigger: a settled month that gained a story would be
-- rolled again. Reviewing that before it ever ran found what it would have
-- done. `rollMonth` is a delete-then-insert for the month, and for a month
-- whose stories were PRUNED the surviving rows are a fragment of what the
-- analysis was computed from -- 2026-04 holds 333 stories and its stack_month
-- says 23,561, because it was rolled while the archive still had them.
--
-- Re-rolling would have replaced the complete record with the fragment,
-- permanently. "Monthly analysis outlives the stories" is the one promise in
-- this system that cannot be re-derived once broken.
--
-- So a pruned month is never re-rolled, and dirty_at is a RECORD rather than a
-- trigger: this month holds stories its analysis does not count. That is an
-- understatement of history, and anyone who wants the true number can count
-- the stories -- which is exactly the direction an irreversible operation
-- should fail in.

COMMENT ON COLUMN rollup_log.dirty_at IS
  'Set by ingest when a story lands in this already-rolled month. For a month '
  'that was never pruned the next rollup recomputes it and clears this. For a '
  'PRUNED month it is permanent and advisory: the analysis predates these '
  'stories and is never recomputed, because the surviving rows are only a '
  'fragment of what it was built from.';

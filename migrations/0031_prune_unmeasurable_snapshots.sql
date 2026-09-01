-- 0031: stop storing a coverage curve for stories whose curve already happened.
--
-- A coverage snapshot samples how far a story has spread at +1h, +6h, +24h and
-- +7d after it broke. The value is the SHAPE: a story on forty outlets within an
-- hour is a different event from one that reaches forty over a week.
--
-- Backfill breaks that. A story published in 2019 is discovered today, and the
-- scheduler dutifully queues a "+1h" sample for one hour from now -- which would
-- record how many outlets carry a six-year-old story today, and file it in the
-- column that every curve average reads as "coverage after one hour". That is
-- not a missing measurement. It is a false one, and it is worse than a gap
-- because nothing downstream can tell it from a real reading.
--
-- 275,732 such rows existed, against 26,976 that can still be measured: the
-- backfill had made the schedule ten parts fiction to one part fact. Ingest no
-- longer creates them (the gate is on the story's age, not on how it arrived, so
-- a live poll finding a month-old post is covered too); this clears what the old
-- behaviour wrote.
--
-- Only unfired rows are touched. A snapshot that was actually captured is
-- evidence and stays, however odd its provenance.

DELETE FROM snapshot_schedule ss
 USING stories s
 WHERE s.id = ss.story_id
   AND ss.captured IS NOT TRUE
   AND s.published_at IS NOT NULL
   AND s.published_at < now() - interval '7 days';

-- No VACUUM here: the migration runner wraps each file in a transaction and
-- VACUUM cannot run inside one. Autovacuum reclaims it, and ANALYZE is enough to
-- stop the planner believing the table is still ten times its real size.
ANALYZE snapshot_schedule;

-- Partitions follow what is COLLECTED, not what is KEPT.
--
-- 0062 made both schedulers pass keepMonths to ensure_partitions, which was
-- right while the window described both things. RETENTION_KEEP_MONTHS=0
-- (KEEP_FOREVER, 2026-08-29) split them apart: the window now covers nothing
-- behind the current month, while collection reaches back as far as a feed
-- will offer. ensure_partitions(0, 3) builds no back-months at all, and a
-- missing partition FAILS an insert rather than degrading it -- so the first
-- story published last month and fetched this month would be lost to an error
-- nobody is watching for. The same shape as 0060 and 0062, a third time.
--
-- The code fix is lib/retention.ts partitionMonthsBack(), read by both
-- schedulers. This migration is the one-time catch-up, and it is generous on
-- purpose: an unnecessary partition is an empty table, and being wrong in the
-- other direction costs collected news.
--
-- 24 is written literally for the reason 0060 writes 2 and 0062 writes 4: the
-- setting lives in the environment and a migration cannot read it.

SELECT ensure_partitions(24, 3);

-- 0060: a month inside the retention window is not a settled month.
--
-- `rollup_log` is the record of which months have been reduced to analysis, and
-- ingest treats a month in it as CLOSED: a story from a settled month would be
-- invisible to the aggregate, skipped by the history views, and deleted by the
-- next prune, so collecting one is worse than useless.
--
-- That is right for finished history and wrong for a month still inside the
-- window. On 2026-08-26, emptying the registry required deleting August's
-- stories; the delete guard refuses a month that is not rolled up; so July and
-- August 2026 were both rolled up by hand to get past it. August survived on a
-- current-month exemption written into isArchived. July did not, and with
-- RETENTION_KEEP_MONTHS=2 July was half the archive.
--
-- What that cost, measured on 2026-08-28 across the 50 live feeds:
--
--   557   July items on offer right now, refused on every poll
--     1   July stories held
--   668   August stories held
--
-- Every source reported itself healthy the whole time. `items_kept: 0` against
-- `items_seen: 114` is what a working feed and a closed month look like from
-- the outside, which is why this ran for two days unnoticed.
--
-- The code fix is in lib/retention.ts: the collector, the rollup and the pruner
-- now read one definition of the window instead of three that agreed on the
-- arithmetic and disagreed on the boundary. This migration undoes the damage
-- the old definition already did.
--
-- ONLY MONTHS THAT WERE NEVER PRUNED. A pruned month's stories are gone except
-- the favourited handful, so its rollup is the only remaining account of it;
-- deleting that row would let a later rollup overwrite the analysis with the
-- survivors. There are none here, and the guard costs nothing.

DELETE FROM rollup_log
 WHERE pruned_at IS NULL
   AND month >= date_trunc('month', now())
                - make_interval(months => (
                    -- The window, from the same setting the collector reads.
                    -- Hardcoded to 2 rather than read from a table because
                    -- RETENTION_KEEP_MONTHS lives in the environment, and a
                    -- migration that guessed wrong would reopen a month the
                    -- pruner is about to delete. 2 is the value in force on
                    -- 2026-08-28; a later change to the setting needs no
                    -- migration, because pendingMonths() now refuses open
                    -- months on its own.
                    2 - 1)::int);

-- The monthly analysis for those months stays exactly where it is. rollMonth()
-- is delete-then-insert per month, so the next rollup after they leave the
-- window replaces it wholesale with the complete picture. Leaving it in place
-- means the history views keep working in the meantime.

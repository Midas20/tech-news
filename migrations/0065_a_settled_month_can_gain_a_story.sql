-- A settled month can gain a story again, so it has to be able to say so.
--
-- Under KEEP_FOREVER (RETENTION_KEEP_MONTHS=0, 2026-08-29) no month is closed
-- to ingest: a month was only ever closed because its stories were about to be
-- pruned, and nothing is pruned any more. See lib/retention.ts.
--
-- That trades one problem for a smaller one. A story landing in a month whose
-- rollup already ran leaves that month's analysis understating it -- stale, not
-- wrong, and fixable by rolling it again. `dirty_at` is how the collector tells
-- the rollup which months to redo; the rollup clears it.
--
-- Without this the trade would be silent, and a silent trade is the thing this
-- schema keeps being rewritten to avoid: `stack_month` would quietly disagree
-- with `stories` for every month that ever received a late arrival.

ALTER TABLE rollup_log ADD COLUMN IF NOT EXISTS dirty_at timestamptz;

COMMENT ON COLUMN rollup_log.dirty_at IS
  'Set by ingest when a story lands in this already-rolled month; cleared when '
  'the month is rolled again. Only reachable under KEEP_FOREVER.';

CREATE INDEX IF NOT EXISTS rollup_log_dirty_idx ON rollup_log (dirty_at)
  WHERE dirty_at IS NOT NULL;

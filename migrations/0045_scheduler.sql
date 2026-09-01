-- 0045: the schedule, in the database.
--
-- WHAT WAS MISSING
--
-- Every job this system needs already existed and every one of them was started
-- by a person typing a command. There were two half-schedulers and neither ran
-- everything: the Worker's cron polled and processed but never rolled up or
-- pruned, and `npm run live` collected and tagged but never classified or
-- scored. Rollup and retention -- the two that keep the archive inside its
-- contract -- ran only when asked.
--
-- WHY A TABLE AND NOT setInterval()
--
-- Three properties a timer in memory cannot have:
--
--   It survives a restart. `next_run_at` is a fact about the archive, not about
--   the process. A deploy at 03:02 must not skip the 03:10 rollup, and must not
--   run it twice because two processes came up.
--
--   It is exclusive. The claim is a single UPDATE with the due test in its
--   WHERE, so two instances racing for the same job produce one winner and one
--   empty result -- no lock table, no leader election, no split brain.
--
--   It is observable. "When did collection last run, how long did it take, what
--   did it say" is a SELECT rather than a question about a log file on a host
--   nobody can reach. /admin/jobs reads exactly this table.
--
-- A crashed runner leaves `running_since` set forever, so the claim also takes
-- any job whose lease has expired. The lease is per job, sized to a run that has
-- gone wrong rather than to one that is merely slow.

CREATE TABLE IF NOT EXISTS job_runs (
  name                  text PRIMARY KEY,
  every_seconds         integer NOT NULL CHECK (every_seconds > 0),
  -- When set, the job runs at this UTC hour rather than every_seconds after the
  -- last one. Retention belongs at a quiet hour, not at 14:37 because that is
  -- when the process happened to start.
  at_hour               smallint CHECK (at_hour IS NULL OR at_hour BETWEEN 0 AND 23),
  enabled               boolean NOT NULL DEFAULT true,

  next_run_at           timestamptz NOT NULL DEFAULT now(),
  running_since         timestamptz,
  runner                text,
  -- How long a run may hold the claim before another runner may take it. A
  -- process killed mid-job is the case this exists for.
  lease_seconds         integer NOT NULL DEFAULT 900 CHECK (lease_seconds > 0),

  last_started_at       timestamptz,
  last_finished_at      timestamptz,
  last_ms               integer,
  last_ok               boolean,
  -- One line of what the run actually did: "12 due, 4 new, 0 err". This is the
  -- difference between knowing a job ran and knowing it worked.
  last_note             text,
  last_error            text,

  runs                  bigint NOT NULL DEFAULT 0,
  failures              bigint NOT NULL DEFAULT 0,
  consecutive_failures  integer NOT NULL DEFAULT 0
);

-- The claim scans for due-and-unclaimed. Small table, but this is the hottest
-- query in the system after the collector's own.
CREATE INDEX IF NOT EXISTS job_runs_due_idx
  ON job_runs (next_run_at) WHERE enabled;

-- The reader shows the schedule on /admin/jobs and nothing more; the runner
-- connects as the worker role and needs to write its own bookkeeping.
GRANT SELECT ON job_runs TO newstrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON job_runs TO newstrack_worker;

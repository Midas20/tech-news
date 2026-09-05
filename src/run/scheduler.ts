// The thing that makes this a system rather than a set of commands.
//
// Every job NewsTrack needs already existed; every one of them was started by a
// person typing. This runs them, on their own schedules, for as long as the
// process is alive -- and because the schedule lives in `job_runs` rather than
// in memory, "as long as the process is alive" is not the same as "until the
// next deploy".
//
// HOW A JOB IS TAKEN
//
// One UPDATE, with the due test in its WHERE clause:
//
//   UPDATE job_runs SET running_since = now() ... WHERE name = $1 AND due
//
// Two instances racing produce one winner and one empty result. There is no lock
// table, no leader election, and no window in which both believe they won --
// which is the property that lets this be deployed as more than one container
// without the collector polling every feed twice.
//
// WHAT HAPPENS WHEN A JOB FAILS
//
// It is recorded and backed off, never retried in a tight loop. The delay
// doubles per consecutive failure to a ceiling of sixteen intervals, so a source
// of failure that is going to clear on its own (a database failover, an expired
// token) is retried soon, and one that is not (a bad migration) stops costing
// anything within the hour. `consecutive_failures` is on the row, so /admin/jobs
// can say "failing since" rather than "last run failed".
//
// A crash leaves `running_since` set with nobody behind it. Every claim also
// takes any job whose lease has expired, so a killed process costs one lease
// rather than a job that never runs again.

import type { Db } from '../db/client.ts';

export type Privilege = 'worker' | 'owner';

export interface JobContext {
  /** NOBYPASSRLS. Everything that collects, processes or tags uses this. */
  worker: Db;
  /** Owner. Only for DDL and for deleting stories. */
  owner: Db;
  log: (line: string) => void;
}

export interface Job {
  name: string;
  /** One line, shown on /admin/jobs. What it does, not how. */
  what: string;
  everySeconds: number;
  /** Run at this UTC hour instead of every N seconds from the last run. */
  atHour?: number;
  /** How long a run may hold its claim before another runner may take it. */
  leaseSeconds?: number;
  /** Which connection the run gets. Default 'worker'. */
  needs?: Privilege;
  /** Off unless something turns it on -- a job whose preconditions are absent. */
  enabled?: boolean;
  /** Returns one line describing what actually happened. */
  run: (ctx: JobContext) => Promise<string>;
}

export interface SchedulerOptions {
  jobs: Job[];
  worker: Db;
  owner: Db;
  /** How often to look for due work. Not how often jobs run. */
  tickSeconds?: number;
  /** Most jobs running at once. Collection is the only long one. */
  maxParallel?: number;
  log?: (line: string) => void;
  /** Identifies this process in `job_runs.runner`. */
  runner?: string;
}

/** The ceiling on backoff: sixteen intervals, then it stops getting worse. */
const MAX_BACKOFF_MULTIPLIER = 16;

/** The longest a failing scheduler will wait before trying again. */
const MAX_BACKOFF_MS = 5 * 60_000;

export class Scheduler {
  private readonly opts: Required<Omit<SchedulerOptions, 'jobs' | 'worker' | 'owner'>>
    & Pick<SchedulerOptions, 'jobs' | 'worker' | 'owner'>;

  private readonly byName = new Map<string, Job>();
  private readonly running = new Set<string>();
  private stopping = false;
  private timer: NodeJS.Timeout | null = null;
  private idle: Promise<void> = Promise.resolve();

  /**
   * Consecutive failed ticks, which is how fast the next one comes.
   *
   * A tick that fails because the DATABASE is unreachable used to be retried on
   * the same five-second cadence, forever. On 2026-09-05 the Neon project ran
   * out of data transfer and the log filled with one identical line every five
   * seconds -- 17,000 of them a day, each one a connection attempt against a
   * dependency that had already said no.
   *
   * A tick failing is almost never a transient the next tick can fix: the ones
   * that reach here are the database being down, out of quota, or refusing
   * credentials, and all three want waiting rather than retrying. Job-level
   * errors are handled inside the run and never surface here.
   */
  private failures = 0;

  constructor(options: SchedulerOptions) {
    this.opts = {
      tickSeconds: 5,
      maxParallel: 3,
      log: (line: string) => console.log(line),
      runner: `${process.pid}@${hostLabel()}`,
      ...options,
    };
    for (const job of options.jobs) this.byName.set(job.name, job);
  }

  /**
   * Write the catalogue into `job_runs`, then start ticking.
   *
   * The upsert deliberately does NOT touch `next_run_at` for a job that already
   * exists. A deploy at 03:02 must not reset the 03:10 rollup to "now", and two
   * containers coming up must not each decide everything is due.
   */
  /**
   * Bring the scheduler up, even when the database will not have it.
   *
   * This used to let the first failing query out, and `await scheduler.start()`
   * in main.ts is a top-level await -- so an unreachable database took the
   * whole process down, web server included. On 2026-09-05 that turned "the
   * archive cannot reach its database" into "there is nothing listening on port
   * 3000", which is a worse outage than the one that caused it and a much
   * harder one to diagnose from outside.
   *
   * A failure here is the same failure a tick has, so it is counted as one and
   * handed to the same backoff. The catalogue is re-registered on the first
   * tick that succeeds, because the upsert is idempotent by design.
   */
  async start(): Promise<void> {
    try {
      await this.register();
      this.registered = true;
      this.opts.log?.(`scheduler: ${this.byName.size} jobs, tick `
        + `${this.opts.tickSeconds}s, runner ${this.opts.runner}`);
    } catch (err) {
      this.failures += 1;
      this.opts.log?.(`scheduler: cannot reach the database (${message(err)}) -- `
        + `retrying in ${Math.round(this.nextDelayMs() / 1000)}s; `
        + 'the web server is up and will serve what it can');
    }
    this.schedule();
  }

  /** Whether the catalogue has been written. Retried until it has. */
  private registered = false;

  private async register(): Promise<void> {
    for (const job of this.byName.values()) {
      await this.opts.worker.query(
        `INSERT INTO job_runs (name, every_seconds, at_hour, lease_seconds, enabled, next_run_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (name) DO UPDATE SET
           every_seconds = excluded.every_seconds,
           at_hour       = excluded.at_hour,
           lease_seconds = excluded.lease_seconds`,
        [job.name, job.everySeconds, job.atHour ?? null,
          job.leaseSeconds ?? 900, job.enabled ?? true]);
    }

    // A row this runner does not know about is deliberately LEFT ALONE.
    //
    // The obvious thing is to delete it, so a job removed from the code stops
    // appearing. The obvious thing is wrong the moment two runners disagree
    // about their catalogues, which is a supported configuration: a container
    // with PROCESSING_ENABLED=0 does not build the `process` and `discover`
    // jobs, and if it deleted their rows it would silently unschedule work
    // another container was doing correctly.
    //
    // So an unknown row survives, and /admin/jobs labels it as not being in this
    // runner's catalogue rather than as overdue. Removing a job from the code is
    // a rare and deliberate act; deleting its row can be too.

    await this.reclaimFromDeadRunners();
  }

  /**
   * Take back what a dead predecessor on this host was holding.
   *
   * A runner is identified as `pid@host`, and the pid changes on every restart --
   * so clearing only THIS runner's claims cleared nothing, and a process killed
   * mid-cycle stranded its jobs until the lease expired. Measured: a restart
   * during a collection left `collect` claimed by the old pid with a 600-second
   * lease, and collection simply stopped for ten minutes. Every deploy would
   * have done that, quietly, and the only symptom is a gap in the archive.
   *
   * The lease is still the backstop for a machine that vanishes. This is the
   * case where we can do better than waiting, because a process on OUR OWN host
   * can be asked whether it exists. Claims from any other host are left alone:
   * they may well be running normally, and stealing a job from a live runner is
   * a worse failure than waiting out a lease.
   */
  private async reclaimFromDeadRunners(): Promise<void> {
    const held = await this.opts.worker.query<{ name: string; runner: string | null }>(
      `SELECT name, runner FROM job_runs WHERE running_since IS NOT NULL`);
    const host = hostLabel();
    const dead = held.filter(({ runner }) => {
      const [pid, owner] = (runner ?? '').split('@');
      if (owner !== host) return false;
      const n = Number(pid);
      if (!Number.isFinite(n) || n <= 0) return false;
      if (n === process.pid) return true;
      try {
        // Signal 0 checks for existence without delivering anything.
        process.kill(n, 0);
        return false;
      } catch (err) {
        // ESRCH is "no such process". EPERM means it exists and belongs to
        // somebody else, which is very much alive.
        return (err as NodeJS.ErrnoException).code === 'ESRCH';
      }
    }).map((r) => r.name);

    if (dead.length === 0) return;
    await this.opts.worker.query(
      `UPDATE job_runs SET running_since = NULL, runner = NULL
        WHERE name = ANY($1::text[]) AND running_since IS NOT NULL`, [dead]);
    this.opts.log?.(`scheduler: reclaimed ${dead.join(', ')} from a runner that is gone`);
  }

  /** Stop taking new work and wait for what is in flight. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.idle;
    // Hand back anything still claimed, so a restart does not wait out a lease.
    await this.opts.worker.query(
      `UPDATE job_runs SET running_since = NULL, runner = NULL
        WHERE runner = $1 AND running_since IS NOT NULL`, [this.opts.runner])
      .catch(() => undefined);
  }

  /**
   * How long before the next tick.
   *
   * Doubles per consecutive failure and resets on the first success, so a
   * healthy scheduler keeps its cadence exactly and a broken one backs off to
   * five minutes instead of hammering. The cap matters as much as the growth:
   * whatever went wrong may be fixed at any moment, and a scheduler that has
   * backed off to an hour is one that stays down long after its database came
   * back.
   */
  private nextDelayMs(): number {
    const base = this.opts.tickSeconds * 1000;
    if (this.failures === 0) return base;
    return Math.min(base * 2 ** Math.min(this.failures, 10), MAX_BACKOFF_MS);
  }

  private schedule(): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.idle = this.tick().then(() => {
        if (this.failures > 0) {
          this.opts.log?.(`scheduler: recovered after ${this.failures} failed `
            + `tick${this.failures === 1 ? '' : 's'}`);
          this.failures = 0;
        }
      }).catch((err: unknown) => {
        this.failures += 1;
        // Logged on the way up and then only as the delay changes, because the
        // point of the line is to say something is wrong -- repeating it every
        // five seconds says nothing the first one did not.
        const wait = Math.round(this.nextDelayMs() / 1000);
        if (this.failures <= 3 || this.failures % 10 === 0) {
          this.opts.log?.(`scheduler: tick failed (${this.failures}): `
            + `${message(err)} -- next attempt in ${wait}s`);
        }
      }).finally(() => this.schedule());
    }, this.nextDelayMs());
  }

  /** One pass: find what is due, claim what there is room for, run it. */
  private async tick(): Promise<void> {
    if (this.stopping) return;

    // Start-up may have found the database down. Until the catalogue is
    // written there is nothing for a tick to claim, so the first tick that can
    // reach the database does the registration the start never managed.
    if (!this.registered) {
      await this.register();
      this.registered = true;
      this.opts.log?.(`scheduler: ${this.byName.size} jobs registered, `
        + `runner ${this.opts.runner}`);
    }

    const room = this.opts.maxParallel - this.running.size;
    if (room <= 0) return;

    const due = await this.opts.worker.query<{ name: string }>(
      `SELECT name FROM job_runs
        WHERE enabled
          AND next_run_at <= now()
          AND (running_since IS NULL
               OR running_since < now() - make_interval(secs => lease_seconds))
        ORDER BY next_run_at
        LIMIT $1`, [room]);

    const started: Promise<void>[] = [];
    for (const { name } of due) {
      const job = this.byName.get(name);
      if (!job || this.running.has(name)) continue;
      started.push(this.claimAndRun(job));
    }
    await Promise.all(started);
  }

  private async claimAndRun(job: Job): Promise<void> {
    // The claim. Everything that decides whether this runner may proceed is in
    // the WHERE clause of one statement, so the answer cannot change between
    // deciding and acting.
    const claimed = await this.opts.worker.query<{ name: string }>(
      `UPDATE job_runs
          SET running_since = now(), runner = $2, last_started_at = now()
        WHERE name = $1
          AND enabled
          AND next_run_at <= now()
          AND (running_since IS NULL
               OR running_since < now() - make_interval(secs => lease_seconds))
        RETURNING name`, [job.name, this.opts.runner]);
    if (claimed.length === 0) return;

    this.running.add(job.name);
    const started = Date.now();
    let ok = true;
    let note = '';
    let error: string | null = null;

    try {
      const ctx: JobContext = {
        worker: this.opts.worker,
        owner: this.opts.owner,
        log: (line) => this.opts.log?.(`  ${job.name}: ${line}`),
      };
      note = await job.run(ctx);
    } catch (err) {
      ok = false;
      error = message(err);
    } finally {
      this.running.delete(job.name);
    }

    const ms = Date.now() - started;
    await this.release(job, ok, ms, note, error).catch((err: unknown) => {
      // If this fails the lease expires and another runner takes the job. Worth
      // one log line and nothing more dramatic.
      this.opts.log?.(`scheduler: could not record ${job.name}: ${message(err)}`);
    });

    if (!ok) this.opts.log?.(`  ${job.name}: FAILED after ${ms}ms — ${error}`);
    else if (note) this.opts.log?.(`  ${job.name}: ${note} (${ms}ms)`);
  }

  /**
   * Record the outcome and set the next due time.
   *
   * The next time is computed in SQL against `now()` rather than in JavaScript
   * against Date.now(), for the same reason the claim is: the database's clock
   * is the one every runner shares.
   */
  private async release(
    job: Job, ok: boolean, ms: number, note: string, error: string | null,
  ): Promise<void> {
    const nextAt = job.atHour === undefined
      // Ordinary cadence, with backoff on consecutive failure.
      //
      // The exponent is capped before the power, not after. `power(2, 41)::int`
      // overflows and raises, which would mean a job that had failed forty times
      // could no longer even record that it had failed again -- the one moment
      // the bookkeeping matters most.
      ? `now() + make_interval(secs => every_seconds * least(
           CASE WHEN $3 THEN 1
                ELSE power(2, least(consecutive_failures + 1, 10))::int END,
           ${MAX_BACKOFF_MULTIPLIER}))`
      // A wall-clock job. A failure retries in an hour rather than tomorrow --
      // the daily jobs are the ones whose whole point is not being skipped.
      : `CASE WHEN $3 THEN
             (date_trunc('day', now()) + make_interval(hours => at_hour))
               + CASE WHEN (date_trunc('day', now()) + make_interval(hours => at_hour)) <= now()
                      THEN interval '1 day' ELSE interval '0' END
           ELSE now() + interval '1 hour' END`;

    await this.opts.worker.query(
      `UPDATE job_runs SET
         running_since = NULL,
         runner = NULL,
         last_finished_at = now(),
         last_ms = $2,
         last_ok = $3,
         last_note = $4,
         last_error = $5,
         runs = runs + 1,
         failures = failures + CASE WHEN $3 THEN 0 ELSE 1 END,
         consecutive_failures = CASE WHEN $3 THEN 0 ELSE consecutive_failures + 1 END,
         next_run_at = ${nextAt}
       WHERE name = $1`,
      [job.name, Math.min(ms, 2_147_483_647), ok, note.slice(0, 500) || null,
        error ? error.slice(0, 500) : null]);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hostLabel(): string {
  // Deployed platforms set one of these; a laptop sets none and gets 'local'.
  return process.env.FLY_MACHINE_ID
    ?? process.env.RAILWAY_REPLICA_ID
    ?? process.env.RENDER_INSTANCE_ID
    ?? process.env.HOSTNAME
    ?? 'local';
}

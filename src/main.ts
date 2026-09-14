// The whole system, as one process.
//
//   npm start                    web server and scheduler
//   ROLE=web    npm start        web server only
//   ROLE=worker npm start        scheduler only
//
// WHY THIS EXISTS
//
// Until now NewsTrack was a set of commands. `npm run ui` served pages, `npm run
// live` collected, and everything else -- classification, scoring, rollup,
// retention, keeping the release feeds in step with Settings -- ran when a person
// remembered to run it. That is a workable way to build something and an
// impossible way to deploy it: the archive's contract says a month of stories
// and two months in the database, and a contract that depends on somebody typing
// is a plan, not a guarantee.
//
// ONE PROCESS OR TWO
//
// Both work, and the difference is only which of the two halves you want to
// scale. In one process they share a database pool and a politeness gate, which
// is the cheapest arrangement and the right default. Split into ROLE=web and
// ROLE=worker, several web containers can sit behind a load balancer while
// exactly one worker collects -- and if two workers start anyway, the claim in
// job_runs means they divide the work rather than duplicate it.
//
// TWO ROLES, NOT ONE CONNECTION
//
// The scheduler holds two: `worker_user` (NOBYPASSRLS) for everything that
// collects, tags and processes, and the owner only for the two jobs that
// genuinely need it -- creating next month's partition, which is DDL, and
// deleting stories, which is not granted to the collecting role on purpose. A
// process that can collect should not also be able to erase what it collected.

import { loadDotEnv } from './lib/dotenv.ts';
import { configureFromEnv } from './config.ts';
import { createPoolDb, type PooledDb } from './db/client.ts';
import { applyStoredSettings } from './db/repos/settings.ts';
import { Scheduler } from './run/scheduler.ts';
import { buildJobs } from './run/jobs.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

type Role = 'all' | 'web' | 'worker';
const ROLE = (process.env.ROLE ?? 'all') as Role;
if (!['all', 'web', 'worker'].includes(ROLE)) {
  console.error(`ROLE must be all, web or worker — got "${ROLE}".`);
  process.exit(1);
}

const shutdown: (() => Promise<void>)[] = [];

// --- the web half -------------------------------------------------------------

if (ROLE === 'all' || ROLE === 'web') {
  // Imported here rather than at the top so that ROLE=worker never opens a
  // listening socket, and never builds the asset bundles it would not serve.
  const { startUi } = await import('./ui/server.ts');

  // THE FIRST ADMINISTRATOR, created here rather than by a command.
  //
  // "If it must happen twice, it belongs in the job catalogue" -- and this must
  // happen exactly once, on a database that has never had an account. It is
  // idempotent by test rather than by catch: it looks for any admin at all, and
  // does nothing if one exists, so it can never resurrect an account somebody
  // deliberately changed.
  const { ensureDefaultAdmin } = await import('./ui/auth.ts');
  const { q } = await import('./ui/db.ts');
  try {
    const outcome = await ensureDefaultAdmin(q);
    if (outcome === 'created') {
      console.log('auth   created the administrator "admin" with the password in ADMIN_PASSWORD');
    } else if (outcome === 'no-password') {
      console.error('auth   no administrator exists and ADMIN_PASSWORD is not set (8+ characters) — none was created');
    }
  } catch (err) {
    console.error(`auth   could not seed an administrator: ${
      err instanceof Error ? err.message : String(err)}`);
  }

  const server = startUi();
  shutdown.push(() => new Promise<void>((resolve) => {
    server.close(() => resolve());
    // A connection held open by keep-alive will not close on its own. Node 18+
    // can end them; older behaviour is to wait for the platform's SIGKILL.
    server.closeIdleConnections?.();
  }));
}

// --- the working half ---------------------------------------------------------

if (ROLE === 'all' || ROLE === 'worker') {
  const workerUrl = process.env.DATABASE_WORKER_URL ?? process.env.DATABASE_URL;
  const ownerUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!workerUrl || !ownerUrl) {
    console.error('DATABASE_URL is not set; the scheduler has nothing to connect to.');
    process.exit(1);
  }
  if (!process.env.DATABASE_WORKER_URL) {
    // Worth saying rather than silently running the collector as the owner: the
    // owner bypasses row-level security, so a bug in a collection query is a
    // tenant isolation bug rather than an error.
    console.warn('DATABASE_WORKER_URL is not set — the scheduler is running as the database '
      + 'owner, which bypasses row-level security. Set it to the NOBYPASSRLS role.');
  }

  const worker: PooledDb = createPoolDb(workerUrl, 'worker');
  const owner: PooledDb = createPoolDb(ownerUrl, 'owner');

  // Settings saved in the UI override the environment, and they have to land
  // before any job reads a value off the config.
  await applyStoredSettings(worker);

  const scheduler = new Scheduler({
    jobs: buildJobs({
      batch: num('COLLECT_BATCH', 40),
      concurrency: num('COLLECT_CONCURRENCY', 0) || undefined,
      // Model work is the only part of this that costs money per item, so it has
      // an off switch that leaves collection running. Off means stories arrive,
      // are tagged and are readable; nothing is scored or deduplicated.
      processing: process.env.PROCESSING_ENABLED !== '0',
    }),
    worker,
    owner,
    // FIFTEEN, NOT FIVE.
    //
    // The tick asks "is anything due" and the fastest job in the catalogue runs
    // every thirty seconds, so a five-second tick was six times more often than
    // any job could use -- 17,280 round trips a day to learn nothing, against a
    // database billed by data transfer. At fifteen it is 5,760, and the worst
    // case a job waits beyond its cadence is fifteen seconds, which no job here
    // can tell the difference about.
    //
    // Still an environment variable, because a deployment with a faster job
    // than any of these needs a faster tick and should not need a patch.
    tickSeconds: num('SCHEDULER_TICK_SECONDS', 15),
    maxParallel: num('SCHEDULER_MAX_PARALLEL', 3),
    log: (line) => console.log(`${stamp()} ${line}`),
  });

  await scheduler.start();

  shutdown.push(async () => {
    await scheduler.stop();
    await worker.close();
    await owner.close();
  });
}

// --- stopping ------------------------------------------------------------------

/**
 * Every deploy is a SIGTERM. Handling it is the difference between a rolling
 * restart nobody notices and one that drops the request in flight, leaves a job
 * claimed until its lease expires, and comes back to a stale `running_since`.
 *
 * The second signal is not politeness -- it is the escape hatch for a shutdown
 * that has itself hung.
 */
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) {
      console.log(`${stamp()} ${signal} again — exiting now.`);
      process.exit(1);
    }
    stopping = true;
    console.log(`${stamp()} ${signal} — finishing what is in flight…`);
    const forced = setTimeout(() => {
      console.log(`${stamp()} shutdown took too long; exiting anyway.`);
      process.exit(1);
    }, 25_000);
    forced.unref();

    void Promise.all(shutdown.map((fn) => fn().catch(() => undefined)))
      .then(() => {
        clearTimeout(forced);
        console.log(`${stamp()} stopped cleanly.`);
        process.exit(0);
      });
  });
}

// An unhandled rejection that reaches here has escaped a job's own catch, which
// means the scheduler could not record it. Logged rather than fatal: killing the
// process would also stop the web server, and one broken job is not an outage.
process.on('unhandledRejection', (reason) => {
  console.error(`${stamp()} unhandled rejection: `
    + `${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

function num(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

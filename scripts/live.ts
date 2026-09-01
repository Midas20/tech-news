// Continuous collection.
//
//   npm run live
//
// WHAT THIS IS NOW
//
// A thin alias for the worker half of `npm start`. It used to be its own loop --
// poll what is due, capture snapshots, tag, sleep, repeat -- and that loop was
// most of a scheduler with three things missing: it never classified or scored,
// it never rolled up or pruned, and two copies of it would have polled every
// feed twice.
//
// All of that lives in src/run/scheduler.ts now, so this file exists only so
// that `npm run live` still means what it always meant. The difference is that
// it now also processes, rolls up, prunes, and takes a claim on each job so a
// second copy divides the work rather than repeating it.
//
// The equivalent, and what a deployment should run:
//
//   ROLE=worker npm start     collection and maintenance, no web server
//   npm start                 both halves in one process

import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import { createPoolDb } from '../src/db/client.ts';
import { applyStoredSettings } from '../src/db/repos/settings.ts';
import { Scheduler } from '../src/run/scheduler.ts';
import { buildJobs } from '../src/run/jobs.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

const workerUrl = process.env.DATABASE_WORKER_URL ?? process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!workerUrl || !ownerUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const worker = createPoolDb(workerUrl, 'worker');
const owner = createPoolDb(ownerUrl, 'owner');
await applyStoredSettings(worker);

const scheduler = new Scheduler({
  jobs: buildJobs({
    batch: arg('limit', 40),
    ...(arg('concurrency', 0) ? { concurrency: arg('concurrency', 0) } : {}),
  }),
  worker,
  owner,
  tickSeconds: arg('tick', 5),
  log: (line) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`),
});

await scheduler.start();
console.log('collection, processing and maintenance are running. ctrl-c to stop.');

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('\nfinishing what is in flight…');
    void scheduler.stop()
      .then(() => Promise.all([worker.close(), owner.close()]))
      .then(() => process.exit(0));
  });
}

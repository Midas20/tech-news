// The long walk backwards.
//
//   npm run deep -- --provider hn --until 2020-01-01 --max-gb 6
//   npm run deep -- --provider hn --until 2015-01-01 --max-gb 20 --tag-every 20
//   npm run deep -- --status
//
// `npm run backfill` is one bounded pass: it stops at a page count or a ten
// minute deadline and tells you to run it again. That is the right shape for a
// cron job and the wrong shape for filling an archive, where the answer to "run
// it again" is "four hundred more times".
//
// So this is the loop around it. It re-enters the same resumable walk until the
// cursor reaches the target date, and it stops for exactly three reasons, all of
// them stated out loud:
//
//   * the history reached the date you asked for
//   * the provider ran out of history
//   * the database hit the size ceiling you set
//
// The size ceiling is not optional. A year of Hacker News is about 1.3 GB and
// the whole of it is north of 25 GB; a managed Postgres plan has a number, and
// finding the number by crossing it means writes start failing in the middle of
// a run. Passing --max-gb makes the stop deliberate rather than a surprise.
//
// Tagging runs periodically inside the loop rather than at the end. An untagged
// story belongs to no project and is invisible to every per-technology view, so
// a run that collects for six hours and tags at the end is a database that looks
// empty for six hours -- and one that dies at hour five is six hours wasted.

import { createDb, closePool } from '../src/db/client.ts';
import { applyStoredSettings } from '../src/db/repos/settings.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { backfill, type Provider } from '../src/collect/backfill.ts';
import type { SourceRow } from '../src/db/repos/sources.ts';
import { PolitenessGate } from '../src/collect/fetcher.ts';
import { tagStacks } from '../src/process/tagstacks.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const db = createDb(url);
await applyStoredSettings(db);

const provider = (arg('provider') ?? 'hn') as Provider;
const target = arg('target') ?? '*';
const until = arg('until') ? new Date(arg('until')!) : null;
const maxGb = Number(arg('max-gb') ?? 0);
const tagEvery = Number(arg('tag-every') ?? 10);
const pagesPerPass = Number(arg('pages') ?? 500);

async function dbGb(): Promise<number> {
  const [r] = await db.query<{ b: string }>(
    'SELECT pg_database_size(current_database())::text AS b');
  return Number(r?.b ?? 0) / 1e9;
}

async function state(): Promise<{ oldest: string | null; stored: number; status: string }> {
  const [r] = await db.query<{ oldest: string | null; stored: string; status: string }>(
    `SELECT oldest_seen::text AS oldest, items_stored::text AS stored, status
       FROM backfill_state WHERE provider = $1 AND target = $2`, [provider, target]);
  return { oldest: r?.oldest ?? null, stored: Number(r?.stored ?? 0), status: r?.status ?? 'pending' };
}

if (process.argv.includes('--status')) {
  const s = await state();
  console.log(`${provider}/${target}: ${s.status}, ${s.stored.toLocaleString('en-US')} stored, `
    + `reaching ${s.oldest?.slice(0, 10) ?? 'nowhere yet'}`);
  console.log(`database: ${(await dbGb()).toFixed(2)} GB`);
  await closePool();
  process.exit(0);
}

if (!maxGb) {
  console.error('Refusing to run without --max-gb. A deep backfill is unbounded by nature and\n'
    + 'the ceiling is the one number this script cannot work out for you: it depends on\n'
    + 'the plan behind DATABASE_URL. Current size is '
    + `${(await dbGb()).toFixed(2)} GB.`);
  await closePool();
  process.exit(1);
}

const startedGb = await dbGb();
const startedAt = Date.now();
console.log(`deep backfill · ${provider}/${target}`);
console.log(`  target   ${until ? until.toISOString().slice(0, 10) : 'as far as it goes'}`);
console.log(`  ceiling  ${maxGb} GB  (now ${startedGb.toFixed(2)} GB)`);
console.log(`  tagging  every ${tagEvery} passes\n`);

// The walk is attributed to the source row it belongs to, exactly as the single
// pass does -- backfilled stories must land against the same source as live ones
// or the archive grows a second, parallel Hacker News.
const SOURCE_COLUMNS = `id, name, url, feed_url, feed_kind, kind::text, roles, lang, country,
  trust_weight, weight_content, never_canonical, fields, poll_interval_seconds,
  politeness_seconds, requires_secret, last_etag, last_modified,
  consecutive_failures, health`;

const NAME_FOR: Record<string, string> = { hn: 'Hacker News', arxiv: 'arXiv cs' };
const [source] = await db.query<SourceRow>(
  `SELECT ${SOURCE_COLUMNS} FROM sources WHERE name = $1 LIMIT 1`,
  [NAME_FOR[provider] ?? provider]);
if (!source) {
  console.error(`no source row for provider "${provider}" — expected one named `
    + `"${NAME_FOR[provider] ?? provider}".`);
  await closePool();
  process.exit(1);
}

const politeness = new PolitenessGate(1000);
let pass = 0;
let stop = '';

// Ctrl-C mid-pass is safe -- the cursor is written after every page -- but it
// should say so rather than looking like a crash.
let interrupted = false;
process.on('SIGINT', () => {
  interrupted = true;
  console.log('\n  interrupted; finishing the current pass, cursor is already saved');
});

for (;;) {
  pass++;
  const before = await state();

  const report = await backfill(db, provider, target, source, {
    maxPages: pagesPerPass,
    ...(until ? { until } : {}),
    deadlineMs: 9 * 60_000,
    politeness,
    // A pass is up to nine minutes. Reporting only when one ends means a job
    // that runs for hours looks hung for the first nine minutes of it, which is
    // exactly when you are still deciding whether to trust it.
    // `info.stored` is the pass's own running total and does not survive the
    // provider's internal retry, so it can sit still while the walk is very much
    // moving -- it read a frozen 164 through 200 pages that added 35,000 rows.
    // The date is the honest progress signal: it is what the cursor persists.
    onPage: (info) => {
      if (info.page % 25 !== 0) return;
      process.stdout.write(`    page ${String(info.page).padStart(4)}  `
        + `reaching ${info.oldest?.slice(0, 10) ?? '—'}
`);
    },
  });

  const after = await state();
  const gb = await dbGb();
  const reached = after.oldest?.slice(0, 10) ?? '—';
  const gained = after.stored - before.stored;

  console.log(`  pass ${String(pass).padStart(3)}  +${String(gained).padStart(6)} stored  `
    + `total ${after.stored.toLocaleString('en-US').padStart(9)}  `
    + `reaching ${reached}  ${gb.toFixed(2)} GB`);

  if (pass % tagEvery === 0) {
    let tagged = 0;
    for (let i = 0; i < 60; i++) {
      const r = await tagStacks(db, 500);
      if (r.examined === 0) break;
      tagged += r.tagged;
    }
    console.log(`           tagged ${tagged} stories against the vocabulary`);
  }

  if (interrupted) { stop = 'interrupted'; break; }
  if (report.status === 'exhausted') { stop = 'the provider has no more history'; break; }
  if (until && after.oldest && new Date(after.oldest) <= until) {
    stop = `reached ${until.toISOString().slice(0, 10)}`;
    break;
  }
  if (gb >= maxGb) { stop = `hit the ${maxGb} GB ceiling`; break; }
  if (gained === 0 && report.pages === 0) { stop = 'a pass returned nothing'; break; }
}

// Whatever stopped it, the archive should be fully tagged before anyone looks.
console.log('\n  final tagging pass...');
let tagged = 0;
for (let i = 0; i < 400; i++) {
  const r = await tagStacks(db, 500);
  if (r.examined === 0) break;
  tagged += r.tagged;
}
await db.query('SELECT refresh_stack_frequency()').catch(() => {});

const final = await state();
const mins = Math.round((Date.now() - startedAt) / 60_000);
console.log(`\nstopped: ${stop}`);
console.log(`  ${final.stored.toLocaleString('en-US')} stored for this target, `
  + `reaching ${final.oldest?.slice(0, 10) ?? '—'}`);
console.log(`  ${tagged} tagged in the final pass`);
console.log(`  ${(await dbGb()).toFixed(2)} GB (from ${startedGb.toFixed(2)}), ${mins} min`);
console.log('  re-run the same command to continue from the saved cursor.');

await closePool();

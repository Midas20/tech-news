// Keep the window. Delete the rest, once the analysis is safe.
//
//   npm run retain -- --dry-run            what would go, and what survives it
//   npm run retain -- --yes                do it
//   npm run retain -- --keep-months 3 --yes
//   npm run retain -- --lapsed-only --yes  only favourites that ran out of time
//   npm run retain -- --yes --vacuum-full  hand the bytes back (locks the table)
//
// THE WORK ITSELF IS IN src/maintain/retain.ts, which the scheduler also runs --
// see the note at the top of scripts/rollup.ts for why that matters.
//
// The one difference between this and the scheduled run is reclamation.
// VACUUM FULL rewrites a table under an ACCESS EXCLUSIVE lock, so every read of
// `stories` blocks for its duration: fine for a command somebody is watching,
// an outage when a timer starts it at 03:40. The scheduler uses plain VACUUM;
// --vacuum-full here is how you actually hand the bytes back, deliberately and
// while looking at it.
//
// The order is not negotiable: roll up, verify, then delete. FAVOURITES ARE
// EXEMPT at any age; a story taken OFF the list goes once its grace window has
// passed, which is what --lapsed-only sweeps.

import { createDb, closePool } from '../src/db/client.ts';
import { configureFromEnv, getConfig } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { retain } from '../src/maintain/retain.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const dryRun = process.argv.includes('--dry-run');
const lapsedOnly = process.argv.includes('--lapsed-only');
const keepMonths = Number(arg('keep-months') ?? getConfig().retention.keepMonths);
const graceHours = Number(arg('grace-hours') ?? getConfig().retention.favouriteGraceHours);
const assumeYes = process.argv.includes('--yes');
const vacuumFull = process.argv.includes('--vacuum-full');

if (!Number.isFinite(keepMonths) || keepMonths < 1) {
  console.error('--keep-months must be at least 1.');
  await closePool();
  process.exit(1);
}

const n = (v: number) => v.toLocaleString('en-US');

// --- what the favourites list is holding back --------------------------------

const [cut] = await db.query<{ cutoff: string }>(
  `SELECT (date_trunc('month', now()) - make_interval(months => $1::int))::date::text AS cutoff`,
  [keepMonths - 1]);
console.log(lapsedOnly
  ? `sweep: stories older than ${cut!.cutoff} whose favourite lapsed more than ${graceHours}h ago\n`
  : `retention: keep stories published on or after ${cut!.cutoff} (${keepMonths} month(s))\n`);

const [fav] = await db.query<{ kept: string; lapsing: string; lapsed: string; old_kept: string }>(
  `SELECT count(*) FILTER (WHERE unfavourited_at IS NULL)::text AS kept,
          count(*) FILTER (WHERE unfavourited_at IS NOT NULL
                             AND unfavourited_at > now() - make_interval(hours => $2::int))::text
            AS lapsing,
          count(*) FILTER (WHERE unfavourited_at IS NOT NULL
                             AND unfavourited_at <= now() - make_interval(hours => $2::int))::text
            AS lapsed,
          count(*) FILTER (WHERE unfavourited_at IS NULL
                             AND EXISTS (SELECT 1 FROM stories s
                                          WHERE s.id = favourites.story_id
                                            AND s.published_at < $1::date))::text
            AS old_kept
     FROM favourites`, [cut!.cutoff, graceHours]);

if (Number(fav!.kept) || Number(fav!.lapsing) || Number(fav!.lapsed)) {
  console.log(`favourites: ${fav!.kept} kept (${fav!.old_kept} of them older than the window `
    + `and surviving only because of it)`);
  console.log(`            ${fav!.lapsing} released and still inside the ${graceHours}h grace `
    + `window, ${fav!.lapsed} past it\n`);
}

// --- the run ------------------------------------------------------------------
//
// A dry run always goes ahead; a real one is asked for twice, because this is
// the only command here that cannot be undone.

const preview = await retain(db, { keepMonths, graceHours, lapsedOnly, dryRun: true });

console.log(`${preview.months.length} month(s) older than the window:`);
for (const m of preview.months) {
  const mark = m.rolled && m.hasTotals ? 'rolled' : 'NOT ROLLED';
  console.log(`   ${m.month}  ${String(m.stories).padStart(7)} stories  ${mark.padStart(10)}`
    + `  ${String(m.stacks).padStart(5)} stack rows`
    + (m.spared ? `  (${m.spared} kept as favourites)` : ''));
}

if (preview.refused) {
  console.error(`\nRefusing to delete: ${preview.refused}`);
  console.error('Run `npm run rollup` first.');
  await closePool();
  process.exit(1);
}

if (preview.eligible === 0) {
  console.log('\nNothing to prune.');
  await closePool();
  process.exit(0);
}

console.log(`\n${n(preview.eligible)} stories would be deleted. `
  + `Database is ${preview.sizeBefore}.`);

if (dryRun) {
  console.log('\ndry run — nothing deleted.');
  await closePool();
  process.exit(0);
}

if (!assumeYes) {
  console.log('\nThis is not reversible. Re-run with --yes to proceed.');
  await closePool();
  process.exit(1);
}

console.log(vacuumFull
  ? '\ndeleting, then rewriting the tables (this locks them and takes a minute)...'
  : '\ndeleting...');

const report = await retain(db, {
  keepMonths, graceHours, lapsedOnly,
  reclaim: vacuumFull ? 'full' : 'vacuum',
});

console.log(`   ${n(report.pruned)} stories deleted`);
for (const [name, count] of Object.entries(report.children)) {
  if (count >= 0) console.log(`   ${name.padEnd(22)} ${n(count).padStart(9)} removed`);
}
if (report.fetchLogTrimmed) console.log(`   ${n(report.fetchLogTrimmed)} fetch_log rows trimmed`);
if (report.rejectsTrimmed) console.log(`   ${n(report.rejectsTrimmed)} story_rejects rows trimmed`);
if (report.orphanJobs) console.log(`   ${n(report.orphanJobs)} orphaned jobs swept`);

console.log(`\ndone. ${n(report.storiesHeld)} stories held `
  + `(${report.favourites} of them favourites), database ${report.sizeAfter}`);
if (!vacuumFull) {
  console.log('space is marked reusable but not handed back — `--vacuum-full` does that,');
  console.log('and blocks every read of `stories` while it runs.');
}
console.log('the analysis for every pruned month is in stack_month and its siblings.');

await closePool();

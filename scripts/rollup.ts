// Turn a month of stories into the analysis that outlives them.
//
//   npm run rollup                    roll up every month that is not current
//   npm run rollup -- --month 2024-03 one month, again (idempotent)
//   npm run rollup -- --status        what is rolled, what is pruned
//   npm run rollup -- --month 2024-03 --force   re-roll a month that was pruned
//
// THE WORK ITSELF IS IN src/maintain/rollup.ts. This file is the command-line
// wrapper: argument parsing, a connection, and printing. The scheduler runs the
// same functions on a timer, which is the only way the two can be guaranteed to
// agree -- a maintenance job with a scheduled copy and a manual copy is two
// programs that will differ the first time either is fixed.
//
// Runs before retention, always. `rollup_log` is the record of which months have
// been reduced, and the pruner refuses to touch a month that is not in it.

import { createDb, closePool } from '../src/db/client.ts';
import { applyStoredSettings } from '../src/db/repos/settings.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { rollupAll, RollupRefused } from '../src/maintain/rollup.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);
await applyStoredSettings(db);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv.includes('--status')) {
  const rows = await db.query<Record<string, string>>(
    `SELECT to_char(l.month, 'YYYY-MM') AS month, l.stories_seen::text AS seen,
            l.stacks_written::text AS stacks, l.pairs_written::text AS pairs,
            coalesce(l.stories_pruned::text, '—') AS pruned,
            (SELECT count(*) FROM stories s
              WHERE date_trunc('month', s.published_at) = l.month)::text AS still_held
       FROM rollup_log l ORDER BY l.month DESC LIMIT 40`);
  console.log('month     seen     stacks  pairs   pruned   still held');
  for (const r of rows) {
    console.log(`${r.month}  ${r.seen!.padStart(7)}  ${r.stacks!.padStart(6)}  `
      + `${r.pairs!.padStart(5)}  ${r.pruned!.padStart(7)}  ${r.still_held!.padStart(9)}`);
  }
  const [n] = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM rollup_log');
  console.log(`\n${n?.n ?? 0} months rolled up.`);
  await closePool();
  process.exit(0);
}

const month = arg('month');
const force = process.argv.includes('--force');

let months;
try {
  months = await rollupAll(db, { ...(month ? { month } : {}), force });
} catch (err) {
  if (err instanceof RollupRefused) {
    console.error(err.message);
    console.error('If you need it anyway, --force says so out loud.');
    await closePool();
    process.exit(1);
  }
  throw err;
}

console.log(`rolling up ${months.length} month(s)\n`);
let totalStacks = 0, totalPairs = 0, totalSeen = 0;
for (const r of months) {
  totalSeen += r.seen; totalStacks += r.stacks; totalPairs += r.pairs;
  if (r.seen > 0) {
    console.log(`  ${r.month.slice(0, 7)}  ${String(r.seen).padStart(7)} stories  ->  `
      + `${String(r.stacks).padStart(5)} stacks, ${String(r.pairs).padStart(5)} pairs`);
  }
}

console.log(`\n${totalSeen.toLocaleString('en-US')} stories reduced to `
  + `${totalStacks.toLocaleString('en-US')} stack-months and `
  + `${totalPairs.toLocaleString('en-US')} pair-months.`);
console.log('nothing has been deleted — the scheduler prunes at 03:00 UTC, '
  + 'or `npm run retain` does it now.');

await closePool();

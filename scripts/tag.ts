// Tag every untagged story against every vocabulary, and keep going until there
// are none left.
//
//   npm run tag                       all three vocabularies
//   npm run tag -- --only stacks      one of them
//   npm run tag -- --max-mb 495       stop before the plan's ceiling
//
// This exists because tagging is the step that decides what the PERMANENT
// analysis says. `npm run rollup` faithfully records whatever proportion of a
// month happened to be tagged when it ran, and once the stories behind it are
// pruned that proportion is frozen -- an untagged story cannot be tagged after
// it has been deleted. So the order is tag, then roll, then prune, and this is
// the first of the three.
//
// All three vocabularies, because all three feed the rollup and all three were
// behind. The cron does 300 rows of each per cycle, which keeps up with live
// collection and is nowhere near a backfilled archive: 165,000 stories had
// never been offered to the company or platform vocabulary at all, so
// `platform_month` held two rows for a decade of history. Pruning first would
// have made those two rows permanent.
//
// It vacuums as it goes. Tagging is an UPDATE on a wide table, so every batch
// leaves a dead tuple the size of the whole row behind it; on a database near
// its size limit the backlog is not what stops the run, the bloat is. A plain
// VACUUM does not hand pages back to the operating system, which is exactly
// what is wanted here -- the next batch of updates reuses them.

import { createDb, closePool, type Db } from '../src/db/client.ts';
import { applyStoredSettings } from '../src/db/repos/settings.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { tagStacks } from '../src/process/tagstacks.ts';
import { tagCompanies } from '../src/process/companies.ts';
import { tagPlatforms } from '../src/process/platforms.ts';

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
const batch = Number(arg('batch') ?? 500);
const vacuumEvery = Number(arg('vacuum-every') ?? 20);
const maxMb = Number(arg('max-mb') ?? 0);
const only = arg('only');

/**
 * The three passes, each with the column that marks a row as examined.
 *
 * `examined` is the field name on every report. Reading a field that does not
 * exist yields undefined, which compares false against 0 and exits the loop
 * after a single batch -- that is how 129,364 stories once went untagged while
 * the loop reported success. Naming the accessor once, here, is the fix.
 */
const PASSES: { name: string; column: string; run: (db: Db, n: number) => Promise<{ examined: number; tagged: number }> }[] = [
  { name: 'stacks', column: 'stacks_tagged_at', run: (d, n) => tagStacks(d, n) },
  { name: 'companies', column: 'companies_tagged_at', run: (d, n) => tagCompanies(d, n) },
  { name: 'platforms', column: 'platforms_tagged_at', run: (d, n) => tagPlatforms(d, n) },
];

async function sizeMb(): Promise<number> {
  const [r] = await db.query<{ b: string }>(
    'SELECT pg_database_size(current_database())::text AS b');
  return Number(r?.b ?? 0) / 1e6;
}

const passes = only ? PASSES.filter((p) => p.name === only) : PASSES;
if (passes.length === 0) {
  console.error(`--only must be one of: ${PASSES.map((p) => p.name).join(', ')}`);
  await closePool();
  process.exit(1);
}

console.log(`${(await sizeMb()).toFixed(0)} MB used`
  + (maxMb ? `, stopping at ${maxMb} MB` : '') + '\n');

let ceilingHit = false;

for (const pass of passes) {
  const [before] = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM stories
      WHERE superseded_by IS NULL AND ${pass.column} IS NULL`);
  const backlog = Number(before!.n);

  console.log(`${pass.name}: ${backlog.toLocaleString('en-US')} untagged`);
  if (backlog === 0) { console.log('   nothing to do\n'); continue; }

  let examined = 0, tagged = 0, round = 0;
  for (;;) {
    round++;
    const r = await pass.run(db, batch);
    if (r.examined === 0) break;
    examined += r.examined;
    tagged += r.tagged;

    if (round % vacuumEvery === 0) {
      // Plain, not FULL: FULL needs a second copy of the table on a disk that
      // is already the constraint, and takes an exclusive lock while it makes it.
      await db.query('VACUUM stories').catch(() => {});
      const mb = await sizeMb();
      process.stdout.write(`   ${examined.toLocaleString('en-US')} examined, `
        + `${tagged.toLocaleString('en-US')} tagged, ${mb.toFixed(0)} MB\n`);
      if (maxMb && mb >= maxMb) { ceilingHit = true; break; }
    }
  }

  await db.query('VACUUM stories').catch(() => {});
  const [after] = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM stories
      WHERE superseded_by IS NULL AND ${pass.column} IS NULL`);
  console.log(`   ${examined.toLocaleString('en-US')} examined, `
    + `${tagged.toLocaleString('en-US')} gained a tag, `
    + `${Number(after!.n).toLocaleString('en-US')} still untagged\n`);

  if (ceilingHit) { console.log(`stopped: hit the ${maxMb} MB ceiling`); break; }
}

await db.query('SELECT refresh_stack_frequency()').catch(() => {});

console.log(`${(await sizeMb()).toFixed(0)} MB used`);
console.log('run `npm run rollup` so the monthly analysis reflects this.');

await closePool();

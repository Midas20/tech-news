// Vocabulary discovery, on demand.
//
//   npm run discover              propose, promote, then tag the archive
//   npm run discover -- --dry     propose only, promote nothing
//   npm run discover -- --tag     tagging only, no discovery
//
// Safe to run repeatedly: proposals are upserted by term, and tagging is bounded
// by a progress marker rather than by a time window.

import { createDb } from '../src/db/client.ts';
import { applyStoredSettings } from '../src/db/repos/settings.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { discoverStacks } from '../src/process/discover.ts';
import { tagStacks } from '../src/process/tagstacks.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = createDb(url);
await applyStoredSettings(db);

const dry = process.argv.includes('--dry');
const tagOnly = process.argv.includes('--tag');

if (!tagOnly) {
  const report = await discoverStacks(db, { promote: !dry });
  console.log(
    `discovery: ${report.examined} candidates examined · ${report.proposed} new · ` +
    `${report.updated} updated · ${report.promoted} promoted · ${report.pending} pending`,
  );
}

// Tagging runs until it stops finding work: a promotion marks the recent archive
// for re-examination, so one batch is rarely the whole job.
let total = { examined: 0, tagged: 0, added: 0 };
// The archive grew from 3,590 to 21,754 in one backfill run; a cap of twenty
// passes would have stopped two thirds of the way through it.
for (let pass = 0; pass < 200; pass++) {
  const r = await tagStacks(db, 750);
  if (r.examined === 0) break;
  total = {
    examined: total.examined + r.examined,
    tagged: total.tagged + r.tagged,
    added: total.added + r.added,
  };
  console.log(`  tagging pass ${pass + 1}: ${r.examined} examined, ${r.tagged} tagged, ${r.added} tags added`);
}
console.log(`tagging: ${total.examined} examined · ${total.tagged} tagged · ${total.added} tags added`);

await db.query('SELECT refresh_stack_frequency()').catch(() => undefined);
console.log('rarity refreshed');

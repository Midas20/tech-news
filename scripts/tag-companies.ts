// Tag stories with the companies they are about.
//
//   npm run tag:companies -- --limit 2000
//
// Plain string work against the closed company vocabulary: no model, no cost.
// Runs repeatedly until nothing is left untagged.

import { createDb, dbStats, resetDbStats } from '../src/db/client.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { tagCompanies } from '../src/process/companies.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const i = process.argv.indexOf('--limit');
const limit = i >= 0 ? Number(process.argv[i + 1]) : 500;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = createDb(url);
resetDbStats();
const started = Date.now();

let total = 0;
let announcements = 0;
for (;;) {
  const report = await tagCompanies(db, Math.min(limit, 500));
  total += report.tagged;
  announcements += report.announcements;
  console.log(`  examined ${report.examined}, tagged ${report.tagged}, announcements ${report.announcements}`);
  if (report.examined === 0 || total >= limit) break;
}

console.log(`\ntagged ${total} stories (${announcements} first-party announcements) ` +
  `in ${((Date.now() - started) / 1000).toFixed(1)}s, ${dbStats.queries} queries`);
process.exit(0);

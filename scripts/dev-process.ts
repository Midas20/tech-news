// Run the Phase 2 pipeline once, locally: dedup -> classify -> score -> snapshot.
//
//   node --experimental-strip-types scripts/dev-process.ts
//   node --experimental-strip-types scripts/dev-process.ts --step classify
//
// Every step is separately runnable because Phase 2 is meant to be inspected by
// hand before it is trusted -- run one step, read the rows it wrote, then run
// the next.

import { createDb } from '../src/db/client.ts';
import { applyStoredSettings } from '../src/db/repos/settings.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { dedupRecent } from '../src/process/dedup.ts';
import { classifyPending } from '../src/process/classify.ts';
import { scoreUnscored } from '../src/process/score.ts';
import { captureDueSnapshots } from '../src/process/snapshot.ts';
import { tagCompanies } from '../src/process/companies.ts';
import { discoverStacks } from '../src/process/discover.ts';
import { tagPlatforms } from '../src/process/platforms.ts';
import { tagStacks } from '../src/process/tagstacks.ts';
import type { LlmContext } from '../src/llm/router.ts';

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
// Settings saved in the UI override the environment; this is where they land.
await applyStoredSettings(db);
const ctx: LlmContext = { db, env: process.env as Record<string, string | undefined> };
const step = arg('step') ?? 'all';

if (step === 'all' || step === 'dedup') {
  const d = await dedupRecent(ctx);
  console.log('dedup    ', JSON.stringify(d));
  if (d.skippedOverBudget > 0) {
    console.log(`  NOTE: ${d.skippedOverBudget} ambiguous pairs left unasked this cycle (model budget).`);
  }
}
if (step === 'all' || step === 'classify') {
  const report = await classifyPending(ctx);
  console.log('classify ', JSON.stringify({
    processed: report.processed, classified: report.classified, deferred: report.deferred,
  }));
  for (const [reason, count] of Object.entries(report.deferReasons)) {
    console.log(`  deferred x${count}: ${reason}`);
  }
  const rejected = Object.entries(report.rejectedFields).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (rejected.length > 0) {
    // Fields the model invented. A recurring entry here is a real signal: either
    // the taxonomy is missing something, or an alias needs adding.
    console.log('  fields rejected as outside the vocabulary:');
    for (const [field, count] of rejected) console.log(`    ${String(count).padStart(4)}  ${field}`);
  }
}
if (step === 'all' || step === 'score') {
  console.log('score    ', JSON.stringify(await scoreUnscored(ctx)));
}
if (step === 'all' || step === 'companies') {
  console.log('companies', JSON.stringify(await tagCompanies(db, 500)));
}
if (step === 'all' || step === 'platforms') {
  console.log('platforms', JSON.stringify(await tagPlatforms(db, 500)));
}
if (step === 'all' || step === 'discover') {
  console.log('discover ', JSON.stringify(await discoverStacks(db)));
}
if (step === 'all' || step === 'tagstacks' || step === 'discover') {
  console.log('tagstacks', JSON.stringify(await tagStacks(db, 500)));
}
if (step === 'all' || step === 'snapshot') {
  console.log('snapshot ', JSON.stringify(await captureDueSnapshots(db)));
}

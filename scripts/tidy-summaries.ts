// Strip page furniture out of summaries already stored.
//
//   npm run tidy            what would change, and the before/after of 20 rows
//   npm run tidy -- --apply write it
//
// A repository page has no article for an extractor to find, so what it grabbed
// instead was the header: "Uh oh! There was an error while loading. Please
// reload this page. owner / repo Public Notifications You must be signed in to
// change notification settings". That is what a reader saw where the summary
// should be.
//
// looksLikeChrome() now refuses those extractions at the source, and the
// adapter path -- which serves the link aggregators, whose items are mostly
// GitHub links -- now passes the guard at all, which it never did. This is the
// repair of what got through before both were true.
//
// Stripping the front was the first attempt and it was not enough. A repository
// page is furniture all the way down: take off the error banner and the
// notification prompt and what remains is the file browser --
// "BranchesTagsOpen more actions menuLatest commit History7 CommitsFolders and
// filesNameName". There is no article under there to recover.
//
// So a summary that is still furniture after stripping is CLEARED, not kept.
// The reader then shows the title alone, which for a Show HN item is already a
// sentence somebody wrote on purpose. Blank is not the worst outcome here; the
// worst outcome is a paragraph of navigation labels presented as a description.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { stripChrome, looksLikeChrome } from '../src/collect/pipeline.ts';

await loadDotEnv();

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

const apply = process.argv.includes('--apply');

/** Enough of the original to be worth keeping. Below this, clear it. */
const MIN_REMAINING = 40;

const rows = await db.query<{ id: string; summary: string; title: string }>(
  `SELECT id::text, summary_en AS summary, coalesce(title_en, title_original) AS title
     FROM stories
    WHERE summary_en IS NOT NULL
      AND (summary_en ILIKE '%uh oh!%'
        OR summary_en ILIKE '%error while loading%'
        OR summary_en ILIKE '%must be signed in to change notification%'
        OR summary_en ILIKE '%this repository was archived by the owner%'
        OR summary_en ILIKE '%folders and files%'
        OR summary_en ILIKE '%open more actions menu%')`);

console.log(`${rows.length.toLocaleString('en-US')} summaries carry page furniture\n`);

const fixes: { id: string; summary: string | null }[] = [];
let recovered = 0;
let cleared = 0;

for (const r of rows) {
  const cleaned = stripChrome(r.summary);
  // Real prose survived the strip: keep it.
  if (cleaned.length >= MIN_REMAINING && !looksLikeChrome(cleaned)) {
    fixes.push({ id: r.id, summary: cleaned });
    recovered++;
    continue;
  }
  // Nothing under the furniture but more furniture.
  fixes.push({ id: r.id, summary: null });
  cleared++;
}

console.log(`${recovered} have a real description underneath and keep it; `
  + `${cleared} are furniture throughout and are cleared\n`);

for (const f of fixes.slice(0, 20)) {
  const before = rows.find((r) => r.id === f.id)!;
  console.log(`  ${before.title.slice(0, 88)}`);
  console.log(`    was: ${before.summary.replace(/\s+/g, ' ').slice(0, 92)}`);
  console.log(`    now: ${f.summary === null
    ? '(cleared — the reader shows the title alone)'
    : f.summary.replace(/\s+/g, ' ').slice(0, 92)}\n`);
}

if (!apply) {
  console.log('(dry run. `npm run tidy -- --apply` to write.)');
  await closePool();
  process.exit(0);
}

let done = 0;
for (let i = 0; i < fixes.length; i += 200) {
  const batch = fixes.slice(i, i + 200);
  const [r] = await db.query<{ n: string }>(
    `WITH upd AS (
       UPDATE stories s SET summary_en = v.summary
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS summary) AS v
        WHERE s.id = v.id
       RETURNING 1)
     SELECT count(*)::text AS n FROM upd`,
    [batch.map((f) => f.id), batch.map((f) => f.summary)]);
  done += Number(r?.n ?? 0);
}

console.log(`cleaned ${done.toLocaleString('en-US')} summaries.`);
await closePool();

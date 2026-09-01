// Take the build log back out of the archive.
//
//   npm run tidy:builds             what would go
//   npm run tidy:builds -- --apply  do it
//
// Three hundred repository release feeds were added to raise the story count.
// The count went up and the archive got worse: six consecutive YugabyteDB
// nightlies, an Elixir tag reading "Automated release for latest v1.18", release
// candidates, experimental commits. A releases.atom is a build log, and most of
// what it carries is a machine writing to a tag.
//
// isBuildNoise now refuses these at ingest. This applies the same rule to what
// the archive already holds, so the fix is not only prospective.
//
// It DISMISSES rather than deletes, for the reason in src/ui/dismiss.ts: every
// aggregate here is derived from stories and a settled month is never
// recomputed, so removing rows corrupts the analysis. Dismissed rows are gone
// from every list and can come back, which also means a rule that turns out to
// be too eager is undoable.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import { isBuildNoise } from '../src/vocab/buildnoise.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

// Every visible story, not only the ones from release feeds: a tag page can
// arrive through any feed that links to one, and the URL rule is what catches
// it. See isTagPage.
const rows = await db.query<{ id: string; t: string; s: string | null; u: string; src: string }>(
  `SELECT st.id::text, coalesce(st.title_en, st.title_original) AS t,
          st.summary_en AS s, st.canonical_url AS u, src.name AS src
     FROM stories st JOIN sources src ON src.id = st.source_id
    WHERE st.superseded_by IS NULL AND st.dismissed_at IS NULL`);

const hits = rows
  .map((r) => ({ ...r, v: isBuildNoise(r.t, r.s ?? '', { url: r.u }) }))
  .filter((r) => r.v.noise);

const by = new Map<string, number>();
for (const h of hits) by.set(h.v.why!, (by.get(h.v.why!) ?? 0) + 1);

console.log(`stories visible: ${rows.length}`);
console.log(`build artefacts among them: ${hits.length}`);
for (const [why, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${why.padEnd(12)} ${n}`);
console.log('');
for (const h of hits.slice(0, 12)) console.log(`  ${h.v.why!.padEnd(11)} ${h.t.slice(0, 74)}`);
if (hits.length > 12) console.log(`  …and ${hits.length - 12} more`);

if (!apply) {
  console.log('');
  console.log('(dry run. `npm run tidy:builds -- --apply` to do it.)');
  await closePool();
  process.exit(0);
}

// In batches: the id list would otherwise be one very large parameter.
let done = 0;
for (let i = 0; i < hits.length; i += 200) {
  const batch = hits.slice(i, i + 200);
  await db.query(
    `UPDATE stories SET dismissed_at = now(),
            dismissed_reason = 'build artefact, not a release'
      WHERE id = ANY($1::uuid[]) AND dismissed_at IS NULL`,
    [batch.map((b) => b.id)]);
  done += batch.length;
}
console.log('');
console.log(`done: ${done} dismissed. They are on /deleted and can be restored.`);
await closePool();
process.exit(0);

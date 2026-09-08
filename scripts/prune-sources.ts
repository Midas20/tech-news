// Cut the registry back to the core, and take their stories with them.
//
//   npm run sources:core             what would go, and what survives it
//   npm run sources:core -- --apply  do it
//
// Different from `npm run reset:sources` in the one way that matters: this keeps
// what the surviving sources produced. A reset empties the registry and the
// archive together, which is right when the registry is wrong from the ground
// up; this is right when most of it is wrong and some of it is exactly what you
// want. Stories belonging to a kept source are not touched.
//
// The order is the schema's, not mine. `stories.source_id` is ON DELETE NO
// ACTION so a source cannot leave before its stories, and the child tables carry
// forbid_orphan_only_delete() so a child cannot leave before its story. That
// means: stories first, then children, then sources -- the opposite of the usual
// order, and the only one this database permits.
//
// FAVOURITES ARE EXEMPT, and so is the source behind a favourite: a story whose
// provenance has been deleted is a quotation with no attribution. Those sources
// are kept, paused and labelled, exactly as the reset does it.

import { makePool } from '../src/db/driver.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { CORE_SOURCES, reasonFor } from '../seeds/core.ts';
import { shardFor } from '../seeds/sources.ts';
import type { PrimarySeed } from '../seeds/primary.ts';

await loadDotEnv();
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const apply = process.argv.includes('--apply');

const pool = makePool(url);
const db = await pool.connect();
const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-US');
const done = async (code = 0): Promise<never> => {
  db.release();
  await pool.end();
  process.exit(code);
};

const keepUrls = CORE_SOURCES.map((s) => s.url);

const { rows: [before] } = await db.query<Record<string, string>>(
  `SELECT count(*)::text AS sources,
          (SELECT count(*)::text FROM stories WHERE superseded_by IS NULL) AS stories
     FROM sources`);
const { rows: doomed } = await db.query<{ name: string; kind: string; stories: string }>(
  `SELECT src.name, src.kind::text AS kind, count(s.id)::text AS stories
     FROM sources src LEFT JOIN stories s ON s.source_id = src.id
    WHERE NOT (src.url = ANY($1::text[]))
    GROUP BY 1, 2 ORDER BY count(s.id) DESC, src.name`, [keepUrls]);
const { rows: keptFav } = await db.query<{ name: string }>(
  `SELECT DISTINCT src.name FROM favourites f
     JOIN stories s ON s.id = f.story_id
     JOIN sources src ON src.id = s.source_id
    WHERE f.unfavourited_at IS NULL AND NOT (src.url = ANY($1::text[]))`, [keepUrls]);

const doomedStories = doomed.reduce((sum, r) => sum + Number(r.stories), 0);

console.log(`now: ${n(before?.sources)} sources, ${n(before?.stories)} stories`);
console.log('');
console.log(`keeping ${CORE_SOURCES.length}:`);
for (const s of CORE_SOURCES) {
  console.log(`  ${s.name.padEnd(28)} ${reasonFor(s.name)}`);
}
console.log('');
console.log(`removing ${doomed.length} sources and ${n(doomedStories)} stories:`);
for (const r of doomed.slice(0, 18)) {
  console.log(`  ${r.name.slice(0, 34).padEnd(36)} ${r.kind.padEnd(9)} ${String(r.stories).padStart(5)} stories`);
}
if (doomed.length > 18) console.log(`  …and ${doomed.length - 18} more`);
if (keptFav.length) {
  console.log('');
  console.log('kept anyway, paused, because a favourite needs its attribution:');
  for (const r of keptFav) console.log(`  ${r.name}`);
}

if (!apply) {
  console.log('');
  console.log('(dry run. `npm run sources:core -- --apply` to do it.)');
  await done();
}

await db.query('BEGIN');
try {
  const doomedFilter = `
    s.source_id IN (SELECT id FROM sources WHERE NOT (url = ANY($1::text[])))
    AND NOT EXISTS (SELECT 1 FROM favourites f WHERE f.story_id = s.id
                      AND f.unfavourited_at IS NULL)`;

  // Parents before children, which this schema requires. Written as one
  // temporary list so the six deletes cannot disagree about which stories are
  // going -- a favourite added between two statements would otherwise be
  // protected by one and not the other.
  await db.query(
    `CREATE TEMP TABLE doomed_stories ON COMMIT DROP AS
       SELECT s.id FROM stories s WHERE ${doomedFilter}`, [keepUrls]);
  const { rows: counted } = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM doomed_stories`);
  const storyCount = counted[0]?.count ?? '0';

  await db.query(`DELETE FROM stories WHERE id IN (SELECT id FROM doomed_stories)`);
  for (const t of ['story_members', 'coverage_snapshots', 'engagement_snapshots',
    'story_keys', 'snapshot_schedule']) {
    await db.query(`DELETE FROM ${t} WHERE story_id IN (SELECT id FROM doomed_stories)`);
  }
  await db.query(
    `DELETE FROM jobs j WHERE NOT EXISTS (
       SELECT 1 FROM stories s WHERE s.id = (j.payload->>'storyId')::uuid)`);
  await db.query(
    `DELETE FROM fetch_log WHERE source_id IN
       (SELECT id FROM sources WHERE NOT (url = ANY($1::text[])))`, [keepUrls]);
  await db.query(
    `DELETE FROM source_budgets WHERE source_id IN
       (SELECT id FROM sources WHERE NOT (url = ANY($1::text[])))`, [keepUrls]);
  await db.query(
    `UPDATE source_candidates SET promoted_source_id = NULL
      WHERE promoted_source_id IN
        (SELECT id FROM sources WHERE NOT (url = ANY($1::text[])))`, [keepUrls]);

  // Two reasons a dropped source cannot actually leave, and both are the
  // schema telling the truth about provenance.
  //
  //   1. It still owns a story. That means the story is favourited -- everything
  //      else was deleted above -- and a favourite whose source is gone is a
  //      quotation with no attribution.
  //
  //   2. It appears in story_members for a story that SURVIVES. That row says
  //      "this outlet also carried this story", which is how coverage is
  //      counted, and story_members has a real foreign key to sources. It also
  //      carries forbid_orphan_only_delete(), so the row cannot be deleted while
  //      its story lives -- correctly: deleting it would silently reduce a kept
  //      story's coverage count to hide a bookkeeping problem.
  //
  // Measured on the first run: the second case is why an ordinary DELETE fails
  // with story_members_source_id_fkey. Both are handled the same way -- the row
  // stays, paused, uncurated and labelled, so it can never look like a choice.
  const stillReferenced = `
    EXISTS (SELECT 1 FROM stories s WHERE s.source_id = sources.id)
    OR EXISTS (SELECT 1 FROM story_members m WHERE m.source_id = sources.id)`;
  const { rowCount: paused } = await db.query(
    `UPDATE sources SET health = 'paused', curated = false,
            notes = 'not polled; kept only because a story that survives cites it'
      WHERE NOT (url = ANY($1::text[])) AND (${stillReferenced})`, [keepUrls]);
  const { rowCount: removed } = await db.query(
    `DELETE FROM sources WHERE NOT (url = ANY($1::text[])) AND NOT (${stillReferenced})`,
    [keepUrls]);
  if (paused) console.log(`
${n(paused)} sources paused rather than removed: a kept story cites them`);

  // The survivors, refreshed from the seed and made due immediately.
  let index = 0;
  for (const s of CORE_SOURCES) {
    const kind = (s as PrimarySeed).kind ?? 'news';
    await db.query(
      `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang, country,
                            trust_weight, weight_content, never_canonical, fields,
                            poll_interval_seconds, politeness_seconds, shard, curated, notes)
       VALUES ($1,$2,$3,$4,$5::source_kind,$6::source_role[],$7,$8,$9,$10,false,$11,$12,2,$13,true,$14)
       ON CONFLICT (url) DO UPDATE SET
         name = EXCLUDED.name, feed_url = EXCLUDED.feed_url, kind = EXCLUDED.kind,
         roles = EXCLUDED.roles, health = 'healthy', consecutive_failures = 0,
         next_fetch_at = now(), curated = true, notes = EXCLUDED.notes,
         poll_interval_seconds = EXCLUDED.poll_interval_seconds`,
      [s.name, s.url, s.feedHint ?? null, s.feedKind ?? 'rss', kind, s.roles,
        s.lang ?? 'en', s.country ?? null, s.trust ?? 1.0, s.weightContent ?? 0.9,
        s.fields ?? [], Math.min(s.pollSeconds ?? 3600, 3600), shardFor(s, index++),
        reasonFor(s.name)]);
  }

  await db.query('COMMIT');
  console.log('');
  console.log(`done: ${n(removed)} sources removed, ${n(storyCount)} stories removed`);
} catch (err) {
  await db.query('ROLLBACK');
  console.error('');
  console.error('rolled back, nothing changed:', (err as Error).message);
  await done(1);
}

const { rows: [after] } = await db.query<Record<string, string>>(
  `SELECT count(*)::text AS sources,
          (SELECT count(*)::text FROM stories WHERE superseded_by IS NULL) AS stories
     FROM sources`);
console.log(`now: ${n(after?.sources)} sources, ${n(after?.stories)} stories`);
console.log('');
console.log('`npm run sync:releases -- --tracked --apply` adds a release feed for each');
console.log('technology named in Settings -> Releases you track, and nothing else.');
await done();

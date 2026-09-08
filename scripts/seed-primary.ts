// Put the first-party announcement channels into the registry.
//
//   npm run seed:primary            what it would add, and nothing else
//   npm run seed:primary -- --apply add them
//
// Additive and idempotent: every row is keyed on `sources.url`, so running it
// twice adds nothing the second time and refreshes what is already there. It
// deletes nothing, and it will not touch a row it did not write -- if a URL here
// already exists as an uncurated, discovered source, it is promoted rather than
// duplicated, and its name and feed become the hand-written ones.
//
// These rows are `curated: true`, which is not decoration: sync-release-feeds.ts
// refuses to overwrite a curated row, and that is what stops the derived Kafka
// tag feed from clobbering the hand-resolved one.

import { makePool } from '../src/db/driver.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { PRIMARY_SOURCES } from '../seeds/primary.ts';
import { shardFor } from '../seeds/sources.ts';

await loadDotEnv();
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const apply = process.argv.includes('--apply');

const pool = makePool(url);
const db = await pool.connect();
const done = async (code = 0): Promise<never> => {
  db.release();
  await pool.end();
  process.exit(code);
};

const { rows: before } = await db.query<{ kind: string; n: string }>(
  `SELECT kind::text AS kind, count(*)::text AS n FROM sources GROUP BY 1 ORDER BY 1`);
const { rows: overlap } = await db.query<{ url: string; name: string; curated: boolean }>(
  `SELECT url, name, curated FROM sources WHERE url = ANY($1::text[])`,
  [PRIMARY_SOURCES.map((s) => s.url)]);

console.log('now:');
for (const r of before) console.log(`  ${r.kind.padEnd(10)} ${r.n}`);
console.log('');
console.log(`going in: ${PRIMARY_SOURCES.length} first-party channels`);
const byKind = new Map<string, number>();
for (const s of PRIMARY_SOURCES) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
for (const [k, n] of byKind) console.log(`  ${k.padEnd(10)} ${n}`);
for (const s of PRIMARY_SOURCES) {
  console.log(`  ${s.name.padEnd(28)} ${(s.kind as string).padEnd(9)} ${s.feedHint ?? s.url}`);
}
if (overlap.length) {
  console.log('');
  console.log('already present, and will be updated in place:');
  for (const r of overlap) console.log(`  ${r.name}${r.curated ? ' (curated)' : ''}`);
}

if (!apply) {
  console.log('');
  console.log('(dry run. `npm run seed:primary -- --apply` to add them.)');
  await done();
}

let n = 0;
const skipped: string[] = [];
await db.query('BEGIN');
try {
  let index = 0;
  for (const s of PRIMARY_SOURCES) {
    // ONE BAD ROW MUST NOT DISCARD THE OTHER SIXTY-TWO.
    //
    // `sources` has two unique indexes -- url, and feed_url where it is not
    // null -- and this statement only knows about the first. A seed whose
    // feedHint is already held by a row at a slightly different address (a
    // trailing slash: elastic.co/blog vs elastic.co/blog/) raises on the second
    // index, and inside one transaction that took every other source down with
    // it: the whole run ended "rolled back, nothing changed".
    //
    // A savepoint per row makes the failure local. What collides is reported and
    // skipped, and the rest go in.
    await db.query('SAVEPOINT one_source');
    try {
      const res = await db.query(
        `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang, country,
                              trust_weight, weight_content, never_canonical, fields,
                              poll_interval_seconds, politeness_seconds, shard, curated, notes)
         VALUES ($1,$2,$3,$4,$5::source_kind,$6::source_role[],$7,$8,$9,$10,false,$11,$12,2,$13,true,$14)
         ON CONFLICT (url) DO UPDATE SET
           name = EXCLUDED.name, feed_url = EXCLUDED.feed_url, kind = EXCLUDED.kind,
           roles = EXCLUDED.roles, trust_weight = EXCLUDED.trust_weight,
           poll_interval_seconds = EXCLUDED.poll_interval_seconds,
           health = 'healthy', consecutive_failures = 0, next_fetch_at = now(),
           curated = true, notes = EXCLUDED.notes
         RETURNING id`,
        [s.name, s.url, s.feedHint ?? null, s.feedKind ?? 'rss', s.kind, s.roles,
          s.lang ?? 'en', s.country ?? null, s.trust ?? 1.0, s.weightContent ?? 0.9,
          s.fields ?? [], s.pollSeconds ?? 3600, shardFor(s, index++), s.notes ?? null]);
      n += res.rowCount ?? 0;
      await db.query('RELEASE SAVEPOINT one_source');
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT one_source');
      skipped.push(`${s.name}: ${(err as Error).message.slice(0, 90)}`);
    }
  }
  await db.query('COMMIT');
} catch (err) {
  await db.query('ROLLBACK');
  console.error('');
  console.error('rolled back, nothing changed:', (err as Error).message);
  await done(1);
}

const { rows: after } = await db.query<{ kind: string; n: string }>(
  `SELECT kind::text AS kind, count(*)::text AS n FROM sources GROUP BY 1 ORDER BY 1`);
console.log('');
console.log(`done: ${n} rows written`);
for (const r of after) console.log(`  ${r.kind.padEnd(10)} ${r.n}`);
if (skipped.length) {
  console.log('');
  console.log(`${skipped.length} skipped, the rest went in:`);
  for (const s of skipped) console.log(`  ${s}`);
}
console.log('');
console.log('`npm run sync:releases` adds the per-project release feeds derived from the registry.');
await done();

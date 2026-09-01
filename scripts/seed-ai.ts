// Add the AI sources the audition admitted.
//
//   npm run seed:ai             what would change
//   npm run seed:ai -- --apply  do it
//
// Additive only. It inserts and never deletes, pauses or overwrites, which is
// what makes it safe to run twice. `npm run audit -- --pause` goes the other
// way.
//
// The evidence for every row is in seeds/ai.ts, measured by `npm run audition`:
// each feed fetched live, every item through the whole gauntlet in memory, the
// article page fetched wherever the feed body was too short -- the same order
// and the same functions ingest uses.
//
// FILED tech_only=false, LIKE EVERY OTHER SOURCE HERE. That flag is what lets a
// channel publish an article rather than only events, and setting it would
// quietly undo the thing that keeps the noise out. Each of these was auditioned
// under the strict setting and is filed under the strict setting; a source that
// only looks good with the flag on has not passed.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import { AI_SOURCES, AI_REFUSED, AI_JUDGEMENT, type AiSource } from '../seeds/ai.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

const existing = await db.query<{ url: string; feed_url: string | null }>(
  `SELECT url, feed_url FROM sources
    WHERE url = ANY($1::text[]) OR feed_url = ANY($2::text[])`,
  [AI_SOURCES.map((s) => s.url), AI_SOURCES.map((s) => s.feed)]);
const known = new Set([...existing.map((r) => r.url), ...existing.map((r) => r.feed_url ?? '')]);
const fresh = AI_SOURCES.filter((s) => !known.has(s.url) && !known.has(s.feed));

const line = (s: AiSource) =>
  `  ${String(s.kept).padStart(3)}/${String(s.sampled).padEnd(3)} ${s.beat.padEnd(8)}`
  + ` ${s.name.padEnd(30)} ${s.why.split('.')[0]!.slice(0, 58)}`;

console.log(`ADD  ${fresh.length} AI sources`);
console.log('  kept/of  beat     name                           why\n');
for (const s of fresh) console.log(line(s));

if (fresh.length < AI_SOURCES.length) {
  console.log(`\n${AI_SOURCES.length - fresh.length} already in the registry:`);
  for (const s of AI_SOURCES.filter((x) => known.has(x.url) || known.has(x.feed))) {
    console.log(`  ${s.name}`);
  }
}

console.log(`\nREFUSED  ${AI_REFUSED.length} entries, kept so the decision is not re-litigated\n`);
for (const r of AI_REFUSED) {
  console.log(`  ${r.name.slice(0, 70)}`);
  console.log(`    ${r.note.slice(0, 108)}`);
}

console.log('\nLEFT FOR A PERSON');
for (const j of AI_JUDGEMENT) {
  console.log(`  ${j.name}: ${j.kept} of ${j.sampled} — a personal blog scoring like a release feed. `
    + 'Not seeded.');
}

const projected = fresh.reduce((n, s) => n + s.kept, 0);
console.log(`\nprojected: ~${projected} items per 90 days (~${(projected / 90).toFixed(1)}/day) from `
  + `${fresh.length} sources, at the rate each was measured at.`);
console.log('A FLOOR, not an estimate: the audition samples 30 items per feed and nine of these '
  + 'returned every item they carry.');

if (!apply) {
  console.log('\n(dry run. `npm run seed:ai -- --apply` to do it.)');
  await closePool();
  process.exit(0);
}

let added = 0;
for (const s of fresh) {
  const rows = await db.query(
    `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang,
                          trust_weight, weight_content, never_canonical, fields,
                          poll_interval_seconds, politeness_seconds, shard,
                          curated, tech_only, notes)
     VALUES ($1, $2, $3, 'rss', 'news',
             CASE WHEN $4::boolean THEN '{CONTENT,PRIMARY}'::source_role[]
                  ELSE '{CONTENT}'::source_role[] END,
             'en', $5, 0.9, false, '{}', 3600, 2, abs(hashtext($2)) % 6, true, false, $6)
     ON CONFLICT (url) DO NOTHING RETURNING 1`,
    [s.name, s.url, s.feed, s.primary, s.primary ? 0.85 : 0.7,
      `added 2026-08-31 for the ${s.beat} beat `
      + `(${s.kept} kept of ${s.sampled} sampled in 90 days): ${s.why}`]);
  added += rows.length;
}

const [after] = await db.query<{ n: string; healthy: string }>(
  `SELECT count(*)::text AS n,
          count(*) FILTER (WHERE health = 'healthy')::text AS healthy FROM sources`);
console.log(`\n${added} added.`);
console.log(`registry: ${after!.n} sources, ${after!.healthy} healthy.`);
await closePool();

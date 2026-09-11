// Add the independent press, and the two feeds that carry funding.
//
//   npm run seed:independent             what would change
//   npm run seed:independent -- --apply  do it
//
// Additive only. It inserts and it never deletes, pauses or overwrites, which
// is what makes it safe to run twice.
//
// The evidence for every row is in seeds/independent.ts, measured by fetching
// each live feed and putting every item through the whole gauntlet in memory.
//
// FILED AS CONTENT, NEVER PRIMARY, and that is the whole point of the file. A
// first-party channel gets the benefit of the doubt -- an unparseable vendor
// post is recorded as "something changed, we cannot say what" -- because a
// company writing about its own release is authoritative about what shipped.
// That rule is exactly wrong for an outlet writing about other people's
// products: an unparseable Register headline is not a change, and marking these
// PRIMARY would manufacture events out of ordinary reporting.
//
// `tech_only` is false for the two market feeds. Their value is precisely the
// story that names no technology -- "Celero raises $275m to bring coherent
// optics inside AI data centres" is a market event whether or not the taxonomy
// recognises a single word in it.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import {
  INDEPENDENT_SOURCES, INDEPENDENT_REFUSED, type IndependentSource,
} from '../seeds/independent.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

const existing = await db.query<{ url: string; feed_url: string | null }>(
  `SELECT url, feed_url FROM sources
    WHERE url = ANY($1::text[]) OR feed_url = ANY($2::text[])`,
  [INDEPENDENT_SOURCES.map((s) => s.url), INDEPENDENT_SOURCES.map((s) => s.feed)]);
const known = new Set([
  ...existing.map((r) => r.url),
  ...existing.map((r) => r.feed_url ?? ''),
]);
const fresh = INDEPENDENT_SOURCES.filter(
  (s) => !known.has(s.url) && !known.has(s.feed));

const line = (s: IndependentSource) =>
  `  ${String(s.kept).padStart(3)}/${String(s.recent).padEnd(4)} ${s.beat.padEnd(10)}`
  + ` ${s.name.padEnd(20)} ${s.why.slice(0, 64)}`;

console.log(`ADD  ${fresh.length} independent sources`);
console.log('  kept/recent beat       name                 why\n');
for (const s of fresh) console.log(line(s));

if (fresh.length < INDEPENDENT_SOURCES.length) {
  console.log(`\n${INDEPENDENT_SOURCES.length - fresh.length} already in the registry:`);
  for (const s of INDEPENDENT_SOURCES.filter((x) => known.has(x.url) || known.has(x.feed))) {
    console.log(`  ${s.name}`);
  }
}

console.log(`\nREFUSED  ${INDEPENDENT_REFUSED.length}, kept so the decision is not re-litigated\n`);
for (const r of INDEPENDENT_REFUSED) {
  console.log(`  ${r.name.padEnd(20)} ${r.why.slice(0, 70)}`);
}

const projected = fresh.reduce((n, s) => n + s.kept, 0);
console.log(`\nprojected: ~${projected} items per 90 days from ${fresh.length} sources, `
  + 'at the rate each was measured at');

if (!apply) {
  console.log('\n(dry run. `npm run seed:independent -- --apply` to do it.)');
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
     VALUES ($1, $2, $3, 'rss', 'news', '{CONTENT}'::source_role[],
             'en', 0.7, 0.9, false, '{}', 3600, 2, abs(hashtext($2)) % 6,
             true, $4, $5)
     ON CONFLICT (url) DO NOTHING RETURNING 1`,
    [s.name, s.url, s.feed, s.beat !== 'market',
      `added 2026-09-10 for the ${s.beat} beat `
      + `(${s.kept} kept of ${s.offered} offered, ${s.recent} recent): ${s.why}`]);
  added += rows.length;
}

const [after] = await db.query<{ n: string; healthy: string }>(
  `SELECT count(*)::text AS n,
          count(*) FILTER (WHERE health = 'healthy')::text AS healthy FROM sources`);
console.log(`\n${added} added.`);
console.log(`registry: ${after!.n} sources, ${after!.healthy} healthy.`);
await closePool();

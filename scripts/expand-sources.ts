// Expand the registry to what the current rules can actually read.
//
//   npm run sources:expand             what would change
//   npm run sources:expand -- --apply  do it
//
// Additive and reversible. It unpauses and inserts; it never deletes and never
// pauses. `npm run audit -- --pause` is the command that goes the other way,
// and keeping the two apart is what makes this one safe to run.
//
// The evidence for every line is in seeds/expand.ts, measured by fetching each
// live feed and putting every item through the whole gauntlet in memory.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import { UNPAUSE, ADD, DISCOVERED, REFUSED, type Candidate } from '../seeds/expand.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

const line = (c: Candidate) =>
  `  ${String(c.kept).padStart(4)} kept  ${String(c.fallback).padStart(3)}% fb  `
  + `${c.name.padEnd(26)} ${c.why}`;

// --- what is already there ---------------------------------------------------
const ALL_NEW = [...ADD, ...DISCOVERED];
const feeds = [...UNPAUSE, ...ALL_NEW].map((c) => c.feed);
const existing = await db.query<{ name: string; feed_url: string; url: string; health: string }>(
  `SELECT name, coalesce(feed_url, '') AS feed_url, url, health::text
     FROM sources WHERE feed_url = ANY($1::text[]) OR url = ANY($2::text[])`,
  [feeds, [...UNPAUSE, ...ALL_NEW].map((c) => c.url)]);
const byFeed = new Map(existing.map((r) => [r.feed_url, r]));
const byUrl = new Map(existing.map((r) => [r.url, r]));
const known = (c: Candidate) => byFeed.get(c.feed) ?? byUrl.get(c.url);

console.log(`UNPAUSE  ${UNPAUSE.length} sources the audition brings back\n`);
for (const c of UNPAUSE) console.log(line(c));

const fresh = ALL_NEW.filter((c) => !known(c));
const already = ALL_NEW.filter((c) => known(c));
console.log(`\nADD  ${fresh.length} new sources\n`);
for (const c of fresh) console.log(line(c));
if (already.length) {
  console.log(`\n${already.length} of the candidates are already in the registry:`);
  for (const c of already) console.log(`  ${c.name.padEnd(26)} ${known(c)!.health}`);
}

console.log(`\nREFUSED  ${REFUSED.length}, kept here so the decision is not re-litigated\n`);
for (const r of REFUSED) {
  console.log(`  ${String(r.kept).padStart(4)} kept  ${r.name.padEnd(26)} ${r.why}`);
}

const projected = [...UNPAUSE, ...fresh].reduce((n, c) => n + c.kept, 0);
console.log(`\nprojected: +${projected} stories inside the current window, `
  + `from ${UNPAUSE.length + fresh.length} sources`);

if (!apply) {
  console.log('\n(dry run. `npm run sources:expand -- --apply` to do it.)');
  await closePool();
  process.exit(0);
}

// --- unpause -----------------------------------------------------------------
//
// next_fetch_at = now() so the first poll happens immediately rather than an
// interval from whenever the source was paused, and the conditional headers are
// cleared so the publisher re-sends a feed it thinks we already have.
let woken = 0;
for (const c of UNPAUSE) {
  const rows = await db.query(
    `UPDATE sources
        SET health = 'healthy', consecutive_failures = 0, next_fetch_at = now(),
            last_etag = NULL, last_modified = NULL,
            notes = $2
      WHERE (feed_url = $1 OR url = $3) AND health = 'paused'
      RETURNING 1`,
    [c.feed, `unpaused 2026-08-28 on audition: ${c.why}`, c.url]);
  woken += rows.length;
}

// --- add ---------------------------------------------------------------------
//
// The feed URL IS written here, unlike seed:announce, because every one of them
// was fetched and parsed during the audition. Autodiscovery is for addresses
// nobody has checked; these have been.
let added = 0;
for (const c of fresh) {
  const rows = await db.query(
    `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang,
                          trust_weight, weight_content, never_canonical, fields,
                          poll_interval_seconds, politeness_seconds, shard,
                          curated, tech_only, notes)
     VALUES ($1, $2, $3, 'rss', 'news', '{CONTENT,PRIMARY}'::source_role[], 'en',
             0.85, 0.9, false, '{}', 3600, 2, abs(hashtext($2)) % 6, true, true, $4)
     ON CONFLICT (url) DO NOTHING
     RETURNING 1`,
    [c.name, c.url, c.feed, `added 2026-08-28 on audition (${c.kept} kept, ${c.fallback}% fallback): ${c.why}`]);
  added += rows.length;
}

const [after] = await db.query<{ n: string; healthy: string }>(
  `SELECT count(*)::text AS n,
          count(*) FILTER (WHERE health = 'healthy')::text AS healthy FROM sources`);
console.log(`\n${woken} unpaused, ${added} added.`);
console.log(`registry: ${after!.n} sources, ${after!.healthy} healthy.`);
await closePool();

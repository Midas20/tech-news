// Add the company announcement channels. Additive: nothing is removed.
//
//   npm run seed:announce             what would be added
//   npm run seed:announce -- --apply  add it
//
// WHY NOT `npm run sources:core -- --apply`. That command makes the registry
// EQUAL the core list, and the registry has drifted from it: twenty first-party
// changelogs were added afterwards and never written into CORE_NAMES. Run today
// it would remove 59 sources and 192 stories on the way to adding these. That
// is a real decision about curation and it is not this script's to make -- so
// this one only inserts, and the drift is reported rather than resolved.
//
// The channels come from COMPANY_SEEDS[].announce by way of seeds/announce.ts.
// `company_slug` is what makes an announcement distinguishable from coverage
// later; it is the reason that column exists and it has been empty until now.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import { ANNOUNCE_SOURCES, ANNOUNCE_WITHOUT_FEEDS } from '../seeds/announce.ts';
import { reasonFor } from '../seeds/core.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

const existing = await db.query<{ url: string; name: string }>(
  `SELECT url, name FROM sources WHERE url = ANY($1::text[])`,
  [ANNOUNCE_SOURCES.map((s) => s.url)]);
const have = new Map(existing.map((r) => [r.url, r.name]));

const fresh = ANNOUNCE_SOURCES.filter((s) => !have.has(s.url));

console.log(`${ANNOUNCE_SOURCES.length} announcement channels in the company registry`);
console.log(`${have.size} already present as sources — they gain a company link only`);
console.log('');
console.log(`adding ${fresh.length}:`);
for (const s of fresh) {
  console.log(`  ${s.companySlug!.padEnd(18)} ${s.name.padEnd(30)} ${s.url}`);
}

if (!apply) {
  console.log('');
  console.log('(dry run. `npm run seed:announce -- --apply` to do it.)');
  await closePool();
  process.exit(0);
}

let added = 0, linked = 0;
for (const s of ANNOUNCE_SOURCES) {
  // No feed URL is written. Every one of these is a page address, and
  // autodiscovery resolves the real feed on the first poll and stores what it
  // found -- which is how the rest of this registry works and the only way a
  // feed that moves does not become a silent failure.
  await db.query(
    `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang, country,
                          trust_weight, weight_content, never_canonical, fields,
                          poll_interval_seconds, politeness_seconds, shard,
                          curated, notes, company_slug)
     VALUES ($1,$2,$3,'rss','news',$4::source_role[],$5,$6,$7,$8,false,'{}',$9,2,
             abs(hashtext($2)) % 6, true, $10, $11)
     ON CONFLICT (url) DO UPDATE SET
       company_slug = EXCLUDED.company_slug,
       -- A hand-verified feed overrides whatever discovery failed to find.
       feed_url = coalesce(EXCLUDED.feed_url, sources.feed_url),
       health = CASE WHEN EXCLUDED.feed_url IS NOT NULL THEN 'healthy'
                     ELSE sources.health END,
       consecutive_failures = CASE WHEN EXCLUDED.feed_url IS NOT NULL THEN 0
                                   ELSE sources.consecutive_failures END,
       next_fetch_at = CASE WHEN EXCLUDED.feed_url IS NOT NULL THEN now()
                            ELSE sources.next_fetch_at END,
       notes = coalesce(sources.notes, EXCLUDED.notes)`,
    [s.name, s.url, s.feedHint ?? null, s.roles, s.lang ?? 'en', s.country ?? null,
      s.trust ?? 0.8, s.weightContent ?? 0.9, s.pollSeconds ?? 3600,
      reasonFor(s.name) || (s.notes ?? null), s.companySlug]);
  if (have.has(s.url)) linked++; else added++;
}

// A channel that publishes no feed is paused with the reason, not left to fail
// on every poll for ever. It stays in the registry because it is still the
// company's channel and the finding is worth keeping.
let parked = 0;
for (const c of ANNOUNCE_WITHOUT_FEEDS) {
  const rows = await db.query(
    `UPDATE sources SET health = 'paused', notes = $2
      WHERE url = $1 AND health <> 'paused' RETURNING 1`,
    [c.url, `no feed: ${c.why}`]);
  parked += rows.length;
}

console.log('');
console.log(`done: ${added} sources added, ${linked} existing sources linked to a company`);
if (parked > 0) console.log(`${parked} paused: no feed to poll`);
if (ANNOUNCE_WITHOUT_FEEDS.length > 0) {
  console.log('');
  console.log('channels with no feed, checked and recorded:');
  for (const c of ANNOUNCE_WITHOUT_FEEDS) console.log(`  ${c.name.padEnd(24)} ${c.why}`);
}

const [after] = await db.query<{ n: string; company: string }>(
  `SELECT count(*)::text AS n,
          count(*) FILTER (WHERE company_slug IS NOT NULL)::text AS company
     FROM sources`);
console.log(`registry: ${after!.n} sources, ${after!.company} of them a company's own channel`);

await closePool();
process.exit(0);

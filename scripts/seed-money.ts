// Add the sources that cover money and earning.
//
//   npm run seed:money             what would change
//   npm run seed:money -- --apply  do it
//
// Additive only. It inserts and it never deletes, pauses or overwrites, which
// is what makes it safe to run twice. `npm run audit -- --pause` is the command
// that goes the other way.
//
// The evidence for every row is in seeds/money.ts, measured by fetching each
// live feed and putting every item through the whole gauntlet in memory with
// the speculation gate in force.
//
// FILED AS CONTENT, NOT PRIMARY, and curated=false for the press. A first-party
// channel gets the benefit of the doubt -- "a vendor post we cannot parse is a
// change" -- and that rule is wrong for an outlet writing ABOUT other people's
// money. The five first-party channels here -- Kraken, Solana, the Ethereum
// Foundation, BitMEX and YouTube -- are writing about their own platform and
// are marked PRIMARY; TechCrunch, Sifted, Decrypt and Cointelegraph are not.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import { MONEY_SOURCES, MONEY_REFUSED, type MoneySource } from '../seeds/money.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

/** A protocol writing about its own network is a first party; a magazine is not. */
const FIRST_PARTY = new Set(['Kraken Blog', 'Solana News', 'Ethereum Foundation Blog',
                             'BitMEX Blog', 'YouTube Official Blog']);

const existing = await db.query<{ url: string; feed_url: string | null; health: string }>(
  `SELECT url, feed_url, health::text FROM sources
    WHERE url = ANY($1::text[]) OR feed_url = ANY($2::text[])`,
  [MONEY_SOURCES.map((s) => s.url), MONEY_SOURCES.map((s) => s.feed)]);
const known = new Set([...existing.map((r) => r.url), ...existing.map((r) => r.feed_url ?? '')]);
const fresh = MONEY_SOURCES.filter((s) => !known.has(s.url) && !known.has(s.feed));

const line = (s: MoneySource) =>
  `  ${String(s.recent).padStart(3)}/${String(s.offered).padEnd(4)} ${s.beat.padEnd(8)}`
  + ` ${s.name.padEnd(26)} ${s.why.slice(0, 66)}`;

console.log(`ADD  ${fresh.length} sources for money and earning`);
console.log('  90d/offered  beat     name                       why\n');
for (const s of fresh) console.log(line(s));
if (fresh.length < MONEY_SOURCES.length) {
  console.log(`\n${MONEY_SOURCES.length - fresh.length} already in the registry:`);
  for (const s of MONEY_SOURCES.filter((x) => known.has(x.url) || known.has(x.feed))) {
    console.log(`  ${s.name}`);
  }
}

console.log(`\nREFUSED  ${MONEY_REFUSED.length}, kept so the decision is not re-litigated\n`);
for (const r of MONEY_REFUSED) {
  console.log(`  ${String(r.recent).padStart(3)}/${String(r.offered).padEnd(4)} `
    + `${r.name.padEnd(30)} ${r.why.slice(0, 62)}`);
}

const projected = fresh.reduce((n, s) => n + s.recent, 0);
console.log(`\nprojected: ~${projected} items per 90 days from ${fresh.length} sources, `
  + 'at the rate each was measured at');

if (!apply) {
  console.log('\n(dry run. `npm run seed:money -- --apply` to do it.)');
  await closePool();
  process.exit(0);
}

let added = 0;
for (const s of fresh) {
  const primary = FIRST_PARTY.has(s.name);
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
    [s.name, s.url, s.feed, primary, primary ? 0.85 : 0.7,
      `added 2026-08-29 for the ${s.beat} beat `
      + `(${s.recent} kept of ${s.offered} offered in 90 days, ${s.fallback}% fallback): ${s.why}`]);
  added += rows.length;
}

const [after] = await db.query<{ n: string; healthy: string }>(
  `SELECT count(*)::text AS n,
          count(*) FILTER (WHERE health = 'healthy')::text AS healthy FROM sources`);
console.log(`\n${added} added.`);
console.log(`registry: ${after!.n} sources, ${after!.healthy} healthy.`);
await closePool();

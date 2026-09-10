// Add the outlets that cover the market, once the host block stopped hiding them.
//
//   npm run seed:market             what would change
//   npm run seed:market -- --apply  do it
//
// Additive only, like seed-breadth.ts and seed-communities.ts: it inserts and
// never deletes, pauses or overwrites, so it is safe to run twice. Rows already
// held by url or feed_url are skipped and named.
//
// THIS SCRIPT IS THE SECOND HALF OF A TWO-PART FIX and does nothing useful on
// its own. Six of these outlets were refused at the HOST level by
// src/vocab/offtopic.ts, before any source row could have mattered, so
// registering them while that list stood would have produced six sources that
// fetch cleanly and keep nothing -- which is precisely the failure mode found
// on the same day in 363 other rows. The hosts moved to MARKET_PRESS_HOSTS
// first; this registers them second.
//
// Every row is inserted `tech_only` (= allowsArticles). A funding round reads
// to the event classifier as a `market` event and would survive on its own, but
// an acquisition analysis and a deal write-up do not, and those are most of
// what these outlets publish. Filed strictly they would contribute their
// headlines and lose their reporting.
//
// See seeds/market-press.ts for what each one measured and why the four
// refusals were refused.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import { MARKET_PRESS, REFUSED_MARKET_PRESS } from '../seeds/market-press.ts';
import type { MeasuredSource } from '../seeds/measured-breadth.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

const existing = await db.query<{ url: string; feed_url: string | null }>(
  `SELECT url, feed_url FROM sources
    WHERE url = ANY($1::text[]) OR feed_url = ANY($2::text[])`,
  [MARKET_PRESS.map((s) => s.url), MARKET_PRESS.map((s) => s.feed)]);
const known = new Set([...existing.map((r) => r.url), ...existing.map((r) => r.feed_url ?? '')]);
const fresh = MARKET_PRESS.filter((s) => !known.has(s.url) && !known.has(s.feed));

const line = (s: MeasuredSource) =>
  `  ${String(s.kept).padStart(3)}/${String(s.sampled).padEnd(3)}`
  + ` ${s.sourceType.toLowerCase().padEnd(24)} ${s.name.slice(0, 30).padEnd(32)}`
  + `${s.categories.join(',')}`;

console.log(`ADD  ${fresh.length} market-press outlets\n`);
console.log('  kept/of  type                     name                            categories');
for (const s of fresh) console.log(line(s));

if (fresh.length < MARKET_PRESS.length) {
  console.log(`\n${MARKET_PRESS.length - fresh.length} already held: `
    + MARKET_PRESS.filter((s) => known.has(s.url) || known.has(s.feed))
      .map((s) => s.name).join(', '));
}

console.log(`\nREFUSED  ${REFUSED_MARKET_PRESS.length} entries, kept so the decision `
  + 'is not re-litigated\n');
for (const r of REFUSED_MARKET_PRESS) console.log(`  ${r.name}\n    ${r.note}`);

// A FLOOR AND SAID TO BE ONE. The audition samples at most 30 items per feed
// and several of these returned every item they carry, so the true rate is at
// least this and the honest word for the number is "at least".
const perPoll = fresh.reduce((n, s) => n + s.kept, 0);
console.log(`\nprojected: at least ${perPoll} items on the first poll across `
  + `${fresh.length} sources, at the rate each was measured at. Thereafter only `
  + 'what is new, since everything else dedups.');

if (!apply) {
  console.log('\n(dry run. `npm run seed:market -- --apply` to do it.)');
  await closePool();
  process.exit(0);
}

let added = 0;
for (const s of fresh) {
  const rows = await db.query(
    `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang,
                          trust_weight, weight_content, never_canonical, fields,
                          poll_interval_seconds, politeness_seconds, shard,
                          curated, tech_only, notes,
                          source_type, categories, tech_domains, status,
                          discovery_method, inclusion_reason, last_evaluated_at)
     VALUES ($1, $2, $3, 'rss', 'news', '{CONTENT}'::source_role[],
             'en', 0.65, 0.9, false, '{}',
             -- Forums move all day and none of it is breaking. An hour keeps
             -- the archive current and keeps 22 new sources off the collector's
             -- critical path; politeness is 5s rather than the usual 2 because
             -- most of these are one small team's self-hosted Discourse.
             3600, 5, abs(hashtext($2)) % 6,
             true, true, $4,
             $5::source_type, $6::text[], $7::text[], 'APPROVED',
             'audition', $8, now())
     ON CONFLICT (url) DO NOTHING RETURNING 1`,
    [s.name, s.url, s.feed,
      `added 2026-09-09 as a market-press outlet (${s.kept} kept of ${s.sampled} `
      + `sampled in a live audition, filed with articles allowed): ${s.why}`,
      s.sourceType, s.categories, s.domains,
      `${s.kept} of ${s.sampled} kept in a live audition. ${s.why}`]);
  added += rows.length;
}

const [after] = await db.query<{ n: string; community: string; independent: string }>(
  `SELECT count(*)::text AS n,
          count(*) FILTER (WHERE source_type = 'COMMUNITY')::text AS community,
          count(*) FILTER (WHERE source_type IN
            ('MAJOR_JOURNALISM','TECHNICAL_JOURNALISM','SPECIALIST_PUBLICATION',
             'REGIONAL_PUBLICATION','MARKET_ANALYSIS','RESEARCH','COMMUNITY'))::text
            AS independent
     FROM sources`);
console.log(`\n${added} added.`);
console.log(`registry: ${after!.n} sources, ${after!.community} communities, `
  + `${after!.independent} independent of first parties.`);
await closePool();

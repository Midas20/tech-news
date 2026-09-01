// Add the sources the breadth audition admitted.
//
//   npm run seed:breadth             what would change
//   npm run seed:breadth -- --apply  do it
//
// Additive only. It inserts and never deletes, pauses or overwrites, which is
// what makes it safe to run twice.
//
// Every row carries its taxonomy at insert -- source_type, categories,
// tech_domains -- rather than waiting for the nightly `evaluate` job to derive
// it. The classifier can prove what a first party is, from the vocabulary; it
// cannot prove that IEEE Spectrum is technical journalism, and that is exactly
// the DECLARED half of the schema: a checkable fact about a named organisation,
// written down by somebody who checked.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import { AS_EVENTS, AS_ARTICLES, REFUSED, type MeasuredSource } from '../seeds/measured-breadth.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

const all = [...AS_EVENTS, ...AS_ARTICLES];
const existing = await db.query<{ url: string; feed_url: string | null }>(
  `SELECT url, feed_url FROM sources WHERE url = ANY($1::text[]) OR feed_url = ANY($2::text[])`,
  [all.map((s) => s.url), all.map((s) => s.feed)]);
const known = new Set([...existing.map((r) => r.url), ...existing.map((r) => r.feed_url ?? '')]);
const fresh = all.filter((s) => !known.has(s.url) && !known.has(s.feed));

const line = (s: MeasuredSource) =>
  `  ${String(s.kept).padStart(3)}/${String(s.sampled).padEnd(3)} ${s.articles ? 'articles' : 'events  '}`
  + ` ${s.sourceType.toLowerCase().padEnd(23)} ${s.name.slice(0, 26).padEnd(28)}`
  + `${s.categories.join(',')}`;

console.log(`ADD  ${fresh.length} sources, chosen against the portfolio gap\n`);
console.log('  kept/of  filed    type                    name                        categories');
for (const s of fresh) console.log(line(s));

if (fresh.length < all.length) {
  console.log(`\n${all.length - fresh.length} already held: `
    + all.filter((s) => known.has(s.url) || known.has(s.feed)).map((s) => s.name).join(', '));
}

console.log(`\nREFUSED  ${REFUSED.length} entries, kept so the decision is not re-litigated\n`);
for (const r of REFUSED) console.log(`  ${r.name}\n    ${r.note}`);

const projected = fresh.reduce((n, s) => n + s.kept, 0);
console.log(`\nprojected: ~${projected} items per 90 days (~${(projected / 90).toFixed(1)}/day) `
  + `from ${fresh.length} sources, at the rate each was measured at.`);
console.log('A FLOOR, not an estimate: the audition samples at most 30 items per feed and '
  + 'several of these returned every item they carry.');

if (!apply) {
  console.log('\n(dry run. `npm run seed:breadth -- --apply` to do it.)');
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
     VALUES ($1, $2, $3, 'rss', 'news',
             CASE WHEN $4::boolean THEN '{CONTENT,PRIMARY}'::source_role[]
                  ELSE '{CONTENT}'::source_role[] END,
             'en', $5, 0.9, false, '{}', 3600, 2, abs(hashtext($2)) % 6,
             true, $6::boolean, $7,
             $8::source_type, $9::text[], $10::text[], 'APPROVED',
             'audition', $11, now())
     ON CONFLICT (url) DO NOTHING RETURNING 1`,
    [s.name, s.url, s.feed, s.primary, s.primary ? 0.85 : 0.75, s.articles,
      `added 2026-08-31 against the portfolio gap (${s.kept} kept of ${s.sampled} sampled `
      + `in 90 days, filed ${s.articles ? 'with articles allowed' : 'events only'}): ${s.why}`,
      s.sourceType, s.categories, s.domains,
      `${s.kept} of ${s.sampled} kept in a live audition. ${s.why}`]);
  added += rows.length;
}

const [after] = await db.query<{ n: string; healthy: string; independent: string }>(
  `SELECT count(*)::text AS n,
          count(*) FILTER (WHERE health = 'healthy')::text AS healthy,
          count(*) FILTER (WHERE source_type IN
            ('MAJOR_JOURNALISM','TECHNICAL_JOURNALISM','SPECIALIST_PUBLICATION',
             'REGIONAL_PUBLICATION','MARKET_ANALYSIS','RESEARCH','COMMUNITY'))::text AS independent
     FROM sources`);
console.log(`\n${added} added.`);
console.log(`registry: ${after!.n} sources, ${after!.healthy} healthy, `
  + `${after!.independent} independent of first parties.`);
await closePool();

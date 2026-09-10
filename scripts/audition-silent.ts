// Re-audition the sources that fetch cleanly and keep nothing.
//
//   npm run audition:silent              measure, change nothing
//   npm run audition:silent -- --apply   set tech_only on the ones that clear
//
// WHY THIS EXISTS. Measured 2026-09-09, chasing "5,276 is less when it is a
// month's news from 507 sources": 406 of 507 sources had produced no story at
// all, and 363 of those reported no error. They fetch, they parse, they see
// items, and they keep zero. gihyo.jp had seen 4,145 items and kept none.
//
// Every one of the 363 has `tech_only = false`, and the dominant refusal is
// `not_an_event`. With EVENTS_ONLY on, ingest keeps an article only when
// `allowsArticles(source)`, so a publication that writes about technology is
// vetoed sentence by sentence while a vendor changelog sails through. gihyo.jp:
// 3,960 not_an_event. heise online: 562.
//
// seeds/measured-breadth.ts recorded this exact finding on 2026-08-31 --
// "IEEE Spectrum 1 of 27 -> 27 of 27", "InfoWorld 3 of 20 -> 19 of 20" -- and
// the flag was then set on the ten sources named in that file and on none of
// the other 363. This finishes the job the same way it was started: by
// measuring each feed against the live gauntlet rather than by arguing.
//
// WHAT THIS DOES NOT DO, deliberately:
//
//   It does not touch the topic filter. `judgeTopic` still runs and off_topic
//   is still refused, so a publication that mostly writes about phones stays
//   out on the same terms as before.
//
//   It does not unblock a blocked host. TechCrunch (380 items) and ZDNET (575)
//   are refused at `blocked_host`, which is a separate decision made on
//   purpose, and quietly reversing it here would hide it.
//
//   It does not touch the language gate. Twelve Japanese, six German and three
//   Chinese sources are refused at `lang_gate` because ALLOWED_LANGUAGES is
//   ['en']. That is a real choice with real consequences -- gihyo.jp and @IT
//   are good sources -- and it belongs to whoever decides what languages this
//   archive reads, not to a script about a boolean column.
//
//   It does not lower the bar. A source still has to clear KEEP_BAR on its own
//   live feed, with articles allowed, or it stays exactly as it is.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv, getConfig } from '../src/config.ts';
import { topicVocabulary } from '../src/collect/topical.ts';
import { auditionFeed, KEEP_BAR } from '../src/collect/audition.ts';
import { mapWithConcurrency } from '../src/lib/pool.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);
const vocab = await topicVocabulary(db);
const userAgent = getConfig().fetch.userAgent;

interface Silent {
  id: string; name: string; feed_url: string | null; url: string;
  lang: string | null; seen: number;
}

// Fetches cleanly, keeps nothing, and is not already allowed to publish an
// article. Ordered by how much it has offered us, because that is the size of
// what is being thrown away.
const silent = await db.query<Silent>(
  `SELECT s.id, s.name, s.feed_url, s.url, s.lang,
          coalesce((SELECT sum(f.items_seen) FROM fetch_log f
                     WHERE f.source_id = s.id), 0)::int AS seen
     FROM sources s
    WHERE s.tech_only = false
      AND s.last_error IS NULL
      AND NOT EXISTS (SELECT 1 FROM stories st
                       WHERE st.source_id = s.id AND st.superseded_at IS NULL)
    ORDER BY seen DESC`);

console.log(`${silent.length} sources fetch cleanly and keep nothing.\n`);

interface Verdict {
  s: Silent; kept: number; recent: number; reasons: string; clears: boolean;
}

const results = await mapWithConcurrency(silent, 8, async (s): Promise<Verdict> => {
  try {
    const r = await auditionFeed({
      site: s.feed_url ?? s.url, userAgent, vocab,
      // Auditioned exactly as it would be FILED if this script applies: not a
      // first party, and articles allowed. Auditioning under a generous flag
      // and filing under a strict one is how a source looks better on paper
      // than it turns out to be.
      primary: false, allowArticles: true, sample: 30,
    });
    const reasons = [...r.reasons.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k}:${v}`).join(' ');
    return { s, kept: r.kept, recent: r.recent, reasons, clears: r.kept >= KEEP_BAR };
  } catch (e) {
    return { s, kept: 0, recent: 0, reasons: `error:${String((e as Error).message).slice(0, 30)}`, clears: false };
  }
});

const clears = results.filter((r) => r.clears).sort((a, b) => b.kept - a.kept);
const fails = results.filter((r) => !r.clears).sort((a, b) => b.s.seen - a.s.seen);

console.log(`CLEARS with articles allowed: ${clears.length}\n`);
console.log('  kept/of  offered  lang  name                             top refusals');
for (const r of clears) {
  console.log(`  ${String(r.kept).padStart(3)}/${String(r.recent).padEnd(3)}`
    + ` ${String(r.s.seen).padStart(7)}  ${(r.s.lang ?? '--').padEnd(4)}`
    + `  ${r.s.name.slice(0, 32).padEnd(33)}${r.reasons}`);
}

console.log(`\nSTILL REFUSES ITSELF: ${fails.length}. Left exactly as they are.\n`);
for (const r of fails.slice(0, 20)) {
  console.log(`  ${String(r.kept).padStart(3)}/${String(r.recent).padEnd(3)}`
    + ` ${String(r.s.seen).padStart(7)}  ${(r.s.lang ?? '--').padEnd(4)}`
    + `  ${r.s.name.slice(0, 32).padEnd(33)}${r.reasons}`);
}
if (fails.length > 20) console.log(`  ... and ${fails.length - 20} more`);

const wasted = fails.reduce((n, r) => n + r.s.seen, 0);
const recovered = clears.reduce((n, r) => n + r.kept, 0);
console.log(`\nrecovered: at least ${recovered} items on the next poll of `
  + `${clears.length} sources, at the rate each just measured at.`);
console.log(`still silent: ${fails.length} sources holding ${wasted} items offered `
  + 'and none kept. Their refusals are named above and are mostly real.');

if (!apply) {
  console.log('\n(dry run. `npm run audition:silent -- --apply` to set tech_only '
    + 'on the ones that clear.)');
  await closePool();
  process.exit(0);
}

// One statement, one column, and the reason written into notes so that the
// next person reading this row can see it was measured rather than assumed.
for (const r of clears) {
  await db.query(
    `UPDATE sources
        SET tech_only = true,
            notes = coalesce(notes || ' | ', '')
              || $2,
            last_evaluated_at = now()
      WHERE id = $1`,
    [r.s.id,
      `2026-09-09 re-auditioned with articles allowed: ${r.kept} of ${r.recent} `
      + `kept, against 0 kept in ${r.s.seen} items offered under events-only.`]);
}

console.log(`\n${clears.length} sources now allowed to publish an article.`);
await closePool();

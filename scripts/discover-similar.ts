// Find sources by asking what a source we already trust is like.
//
//   npm run discover:similar
//   npm run discover:similar -- --seeds 8 --per-seed 40
//   npm run discover:similar -- --apply
//
// sitelike.org answers "what sites are like this one". Point it at a source
// already in the registry and it returns neighbours -- some of them the exact
// projects this archive is missing, most of them personal blogs and link farms.
// It is a CANDIDATE GENERATOR and nothing more; the audition is what decides.
//
// Three stages, and only the first is new:
//
//   1. neighbours   sitelike.org, seeded from sources that already produce
//   2. feed         link rel=alternate, then the common paths
//   3. audition     every item through the whole gauntlet, in memory
//
// Stage 3 is the same measurement seeds/expand.ts records, so a candidate that
// arrives this way is judged by exactly the standard a hand-picked one is:
// what it published in the window, and how much of that the grammar could place
// rather than wave through on the publisher's identity.
//
// WHY THE SEEDS ARE THE PRODUCERS. Asking "what is like Vercel" returns the
// neighbourhood of a source whose output this archive has already measured. A
// seed picked for being famous returns a neighbourhood of famous things, which
// is how a registry fills up with outlets nobody reads for the beat.
//
// Nothing is written without --apply, and even then only INSERTs: this script
// cannot pause, delete, or overwrite an existing source.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv, getConfig } from '../src/config.ts';
import { parseFeed } from '../src/collect/feed.ts';
import { discoverFeedLinks, COMMON_FEED_PATHS } from '../src/collect/fetcher.ts';
import { judgeTopic, isTechnicalTitle } from '../src/collect/topical.ts';
import { classifyEvent, isEvent } from '../src/collect/eventful.ts';
import { isBuildNoise } from '../src/vocab/buildnoise.ts';
import { isTooOld } from '../src/lib/retention.ts';
import { loadStackVocabulary, detectStacks } from '../src/process/tagstacks.ts';
import { detectLanguage } from '../src/lib/lang.ts';
import { mapWithConcurrency } from '../src/lib/pool.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
};
const apply = process.argv.includes('--apply');
const SEEDS = arg('seeds', 10);
const PER_SEED = arg('per-seed', 30);
/** What a candidate must produce in the window to be worth a row. */
const FLOOR = arg('floor', 3);
/** How many candidate domains to probe for a feed in one run. */
const MAX = arg('max', 400);

// Probing a thousand unknown domains reaches parts of Node's HTTP stack that a
// try/catch cannot. A socket closed mid-body raises assert(!this.paused) inside
// undici, on a stream callback, with no promise to reject -- and it killed a run
// that had already done twenty minutes of work. A crawler over strangers has to
// survive strangers.
//
// Scoped to this script and deliberately loud: it prints the first few it
// swallows and counts the rest, so a real bug here is visible rather than
// absorbed silently.
let swallowed = 0;
const fault = (e: unknown) => {
  swallowed++;
  if (swallowed <= 5) console.log(`  (network fault ignored: ${String(e).slice(0, 70)})`);
};
process.on('uncaughtException', fault);
process.on('unhandledRejection', fault);

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);
const vocab = await loadStackVocabulary(db);
const keepMonths = getConfig().retention.keepMonths;
const allowed = getConfig().filters.allowedLanguages;

const UA = 'Mozilla/5.0 (compatible; NewsTrack/1.0; +source discovery)';
const host = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
};

// --- what we already have ----------------------------------------------------
const have = await db.query<{ u: string; f: string | null }>(
  `SELECT url u, feed_url f FROM sources`);
const known = new Set<string>();
for (const r of have) { const h = host(r.u); if (h) known.add(h); if (r.f) known.add(host(r.f)); }

// Seeds: the sources that actually produce, most first. Asking what Vercel is
// like is a better question than asking what a famous site is like.
const seeds = await db.query<{ name: string; u: string; n: string }>(
  `SELECT s.name, s.url u, count(st.id)::text n
     FROM sources s JOIN stories st ON st.source_id = s.id
    WHERE s.health = 'healthy' AND st.superseded_by IS NULL AND st.dismissed_at IS NULL
    GROUP BY 1, 2 HAVING count(st.id) >= 5
    ORDER BY count(st.id) DESC LIMIT $1`, [SEEDS]);

console.log(`seeding sitelike.org with ${seeds.length} producing sources\n`);

// --- 1. neighbours -----------------------------------------------------------
const candidates = new Map<string, string[]>();   // domain -> which seeds named it
await mapWithConcurrency(seeds, 3, async (s) => {
  const h = host(s.u);
  if (!h) return;
  try {
    const res = await fetch(`https://www.sitelike.org/similar/${h}/`,
      { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!res.ok) { console.log(`  ${h}: HTTP ${res.status}`); return; }
    const html = await res.text();
    const found = [...html.matchAll(/\/similar\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\//gi)]
      .map((m) => m[1]!.toLowerCase())
      .filter((d) => d !== h && !known.has(d));
    let n = 0;
    for (const d of found) {
      if (n >= PER_SEED) break;
      if (!candidates.has(d)) { candidates.set(d, []); n++; }
      candidates.get(d)!.push(s.name);
    }
    console.log(`  ${s.name.padEnd(26)} ${new Set(found).size} neighbours`);
  } catch (e) { console.log(`  ${h}: ${(e as Error).message.slice(0, 40)}`); }
});

// Ordered by how many seeds named the domain: a site that turns up in three
// different neighbourhoods is a better bet than one that turns up in one.
const ranked = [...candidates.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .map(([d]) => d);
const probing = ranked.slice(0, MAX);
console.log(`\n${candidates.size} distinct candidate domains, none already in the registry`);
if (ranked.length > MAX) {
  // Never a silent cap: what was dropped is said out loud.
  console.log(`probing the ${MAX} named by the most seeds; `
    + `${ranked.length - MAX} not probed this run (raise --max to reach them)`);
}

// --- 2. feed -----------------------------------------------------------------
interface Found { domain: string; feed: string; title: string; seeds: string[] }
const withFeed: Found[] = [];
await mapWithConcurrency(probing, 6, async (domain) => {
  const base = `https://${domain}`;
  const tryFeed = async (u: string): Promise<Found | null> => {
    try {
      const res = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'follow',
        signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      // A domain that redirects into one we already poll is that source under
      // another name. aws.com resolves to aws.amazon.com and would have arrived
      // as a 73-item "discovery" of AWS What's New.
      if (known.has(host(res.url))) return null;
      const body = await res.text();
      const feed = parseFeed(body, u);
      if (!feed || feed.items.length === 0) return null;
      return { domain, feed: u, title: feed.title || domain, seeds: candidates.get(domain)! };
    } catch { return null; }
  };
  // The page's own declaration first: a feed a site advertises is the one it
  // maintains, and guessing paths finds the one it forgot to delete.
  try {
    const res = await fetch(base, { headers: { 'user-agent': UA }, redirect: 'follow',
      signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      for (const link of discoverFeedLinks(await res.text(), base).slice(0, 2)) {
        const f = await tryFeed(link);
        if (f) { withFeed.push(f); return; }
      }
    }
  } catch { /* fall through to the common paths */ }
  for (const path of COMMON_FEED_PATHS.slice(0, 5)) {
    const f = await tryFeed(base + path);
    if (f) { withFeed.push(f); return; }
  }
});

console.log(`${withFeed.length} of them publish a readable feed\n`);
if (swallowed) console.log(`${swallowed} network faults survived`);

// --- 3. audition -------------------------------------------------------------
interface Verdict extends Found { kept: number; fallback: number; win: number;
                                  classes: Map<string, number>; samples: string[] }
const judged: Verdict[] = [];
await mapWithConcurrency(withFeed, 8, async (f) => {
  try {
    const res = await fetch(f.feed, { headers: { 'user-agent': UA }, redirect: 'follow',
      signal: AbortSignal.timeout(25000) });
    if (!res.ok) return;
    const feed = parseFeed(await res.text(), f.feed);
    if (!feed) return;
    let kept = 0, fb = 0, win = 0;
    const classes = new Map<string, number>(); const samples: string[] = [];
    for (const it of feed.items) {
      if (isTooOld(it.publishedAt, keepMonths)) continue;
      win++;
      const t = it.title ?? ''; const b = it.content || it.summary || '';
      if (isBuildNoise(t, b, { url: it.link ?? '' }).noise) continue;
      if (!allowed.includes(detectLanguage(`${t} ${b}`.slice(0, 4000)).lang)) continue;
      // AUDITIONED AS A STRANGER, which is what it is.
      //
      // The first draft judged these as first-party technology channels -- the
      // way seeds/expand.ts judges a hand-picked candidate -- and that turns on
      // the fallback rule: a post from a vendor's own channel that the grammar
      // cannot place is a change. Safe for Vercel. Catastrophic for a domain
      // nobody has looked at. It passed salon.com at 18 kept, 101greatgoals.com
      // at 14, the Illinois Green Party at 2, every one of them 100% fallback,
      // every one of them a change about nothing.
      //
      // A stranger gets no benefit of the doubt: the grammar has to actually
      // say launch, release, change or market. That is also exactly how the
      // INSERT below files it -- CONTENT, not PRIMARY, curated false -- so the
      // audition and the row it produces now agree about what this source is.
      if (!judgeTopic(t, b, { vocab, sourceKind: 'news', sourceRoles: ['CONTENT'] }).keep) continue;
      // POSITIVE EVIDENCE, because judgeTopic is a blocklist.
      //
      // Its job for a curated source is to catch what is not technology, and
      // anything no rule names is kept -- which is right when somebody chose the
      // source and wrong when nobody has. "NASA to launch telescope to teach
      // scientists about tens of thousands of galaxies" matches no reject rule
      // and is not a stack changing; nor is "Imperial County D.A.'s Office
      // launches first-ever Summer Post", nor 88 vendor press releases a week
      // from an IT trade site.
      //
      // A curated source is trusted to be on the beat and the filter catches
      // what strays. A stranger has no such credit: it has to SHOW technology
      // -- a name the vocabulary knows, or a title that reads as technical --
      // not merely fail to show football.
      if (detectStacks(`${t} ${b}`.slice(0, 600), vocab, { max: 2 }).length === 0
          && !isTechnicalTitle(t)) continue;
      const e = classifyEvent(t, { sourceKind: 'news', firstParty: false });
      if (!isEvent(e.kind)) continue;
      kept++;
      if (e.matched === 'first-party post') fb++;
      classes.set(e.kind, (classes.get(e.kind) ?? 0) + 1);
      if (samples.length < 2) samples.push(`${e.kind}: ${t.slice(0, 62)}`);
    }
    judged.push({ ...f, kept, fallback: kept ? Math.round(fb / kept * 100) : 0,
                  win, classes, samples });
  } catch { /* a candidate that cannot be read is not a candidate */ }
});

judged.sort((a, b) => b.kept - a.kept);
const passing = judged.filter((v) => v.kept >= FLOOR);

console.log(`kept  fb%  in-win  domain                       named by`);
for (const v of passing) {
  console.log(`${String(v.kept).padStart(4)} ${String(v.fallback).padStart(3)}% ${String(v.win).padStart(6)}   `
    + `${v.domain.padEnd(28)} ${v.seeds.slice(0, 2).join(', ')}`);
  for (const s of v.samples) console.log(`                          ${s}`);
}
console.log(`\n${passing.length} candidates clear the floor of ${FLOOR} kept; `
  + `${judged.length - passing.length} produce less`);

if (!apply) {
  console.log('\n(dry run. --apply to add the ones above.)');
  await closePool();
  process.exit(0);
}

let added = 0;
for (const v of passing) {
  const rows = await db.query(
    `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang,
                          trust_weight, weight_content, never_canonical, fields,
                          poll_interval_seconds, politeness_seconds, shard,
                          curated, tech_only, notes)
     VALUES ($1, $2, $3, 'rss', 'news', '{CONTENT}'::source_role[], 'en',
             0.6, 0.8, false, '{}', 7200, 2, abs(hashtext($2)) % 6, false, false, $4)
     ON CONFLICT (url) DO NOTHING RETURNING 1`,
    [v.title.slice(0, 80), `https://${v.domain}`, v.feed,
      `discovered via sitelike.org from ${v.seeds[0]}; auditioned ${v.kept} kept, ${v.fallback}% fallback`]);
  added += rows.length;
}
// curated=false and CONTENT-only on purpose: nothing arrives here hand-checked,
// so it does not get a first party's benefit of the doubt until somebody looks.
console.log(`\n${added} added, uncurated, as CONTENT rather than PRIMARY.`);
await closePool();

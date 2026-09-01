// Every source, and how much of what it publishes is actually about technology.
//
//   npm run audit                     the table, sorted worst first
//   npm run audit -- --social         only the social-shaped ones
//   npm run audit -- --show "ZDNET"   read one source's recent titles
//   npm run audit -- --pause          pause what this recommends
//   npm run audit -- --restore        un-pause everything paused by this
//
// The question a source list cannot answer by itself is "is this feed for me".
// A name and a URL say what an outlet IS; they say nothing about what it turns
// out to publish. TechRadar Computing sounds like a computing feed and is
// mostly shopping; Hacker News sounds like a technology board and carries a
// steady stream of letters from Dolly Parton to Eminem.
//
// So each source is judged on its own output, on two numbers:
//
//   REFUSED   what fraction the topic filter threw out. High means the feed is
//             actively publishing shopping, television, politics or reports.
//
//   TECHNICAL what fraction of the REST names a technology from the closed
//             vocabulary or reads like a technical announcement. This is the
//             number that matters, and it is the one nothing else measures: a
//             feed can pass the topic filter completely and still be a general
//             interest board that happens to sit on a technology domain,
//            because "Otto Dix, Nietzsche, and the Great War" is refused by no
//            rule here and is not what this archive is for.
//
// SOCIAL is structural rather than measured: a link aggregator or a community
// board, where the feed is whatever its members chose to post that hour. That
// is a different kind of thing from an outlet with an editor, and it is the
// reason the two numbers below can be so far apart.

import { createDb, closePool } from '../src/db/client.ts';
// The lists moved to the vocabulary when the same judgement had to be made
// about a LINK as well as about a source. See src/vocab/offtopic.ts.
import {
  SOCIAL_HOSTS, CONSUMER_HOSTS, OFF_BEAT_HOSTS, ALWAYS_KEEP_HOSTS, hostMatches,
} from '../src/vocab/offtopic.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { loadStackVocabulary, detectStacks } from '../src/process/tagstacks.ts';
import { judgeTopic, isTechnicalTitle } from '../src/collect/topical.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const days = Number(arg('days') ?? 30);
const socialOnly = process.argv.includes('--social');
const show = arg('show');
const doPause = process.argv.includes('--pause');
const doRestore = process.argv.includes('--restore');
/**
 * Spare a social source whose technical rate reaches this, if one is given.
 *
 * Off by default, and that is the deliberate part. "Social" here is a statement
 * about what a feed IS, not about how it scored last month: a board where the
 * contents are whatever the members posted this hour will publish letters from
 * Dolly Parton to Eminem next to a Postgres release, and no threshold measured
 * over thirty days changes what it will do tomorrow. Hacker News measured 57%
 * technical, which sounds respectable until you notice it means 8,700 items of
 * general interest reading in one month.
 *
 * `--keep-above 0.7` is the escape hatch for the developer-only boards, where
 * the topic really is bounded.
 */
const keepAbove = arg('keep-above') === undefined ? null : Number(arg('keep-above'));
/** Too few items to judge on. */
const MIN_SAMPLE = 20;

// The note written into sources.notes, so --restore knows what it paused and a
// person reading the row later knows why it stopped.
const MARK = 'paused by audit-sources';

if (doRestore) {
  const back = await db.query<{ name: string }>(
    `UPDATE sources SET health = 'healthy', consecutive_failures = 0,
            next_fetch_at = now(),
            notes = nullif(regexp_replace(coalesce(notes, ''), '${MARK}[^\\n]*\\n?', ''), '')
      WHERE health = 'paused' AND notes LIKE '%${MARK}%'
      RETURNING name`);
  console.log(back.length === 0 ? 'nothing to restore.'
    : `restored ${back.length}: ${back.map((b) => b.name).join(', ')}`);
  await closePool();
  process.exit(0);
}

const vocab = await loadStackVocabulary(db);

interface SourceRow {
  id: string; name: string; url: string; kind: string; roles: string[];
  health: string; curated: boolean; items: string;
}

const sources = await db.query<SourceRow>(
  `SELECT s.id::text, s.name, s.url, s.kind::text, s.roles::text[] AS roles,
          s.health::text, s.curated,
          (SELECT count(*) FROM stories st
            WHERE st.source_id = s.id
              AND st.collected_at > now() - make_interval(days => $1::int))::text AS items
     FROM sources s
    ORDER BY s.name`, [days]);

const titles = await db.query<{ source_id: string; title: string; summary: string | null }>(
  `SELECT st.source_id::text, coalesce(st.title_en, st.title_original) AS title,
          st.summary_en AS summary
     FROM stories st
    WHERE st.collected_at > now() - make_interval(days => $1::int)`, [days]);

const bySource = new Map<string, { title: string; summary: string | null }[]>();
for (const t of titles) {
  const list = bySource.get(t.source_id) ?? [];
  list.push({ title: t.title, summary: t.summary });
  bySource.set(t.source_id, list);
}




/**
 * The same judgement where the host cannot carry it.
 *
 * heise.de publishes `heise Security` and `iX` -- both professional IT press
 * and both wanted -- from the SAME host as `heise online`, a general news
 * portal that is not. itmedia.co.jp is the same story: `@IT` is written for IT
 * professionals, `ITmedia NEWS` is written for everyone. A host list cannot
 * express that, so these are named.
 */
const OFF_BEAT_NAMES = new Set([
  'heise online',
  'ITmedia NEWS',
  // Apple's press room: baseball schedules, Apple Arcade, retail openings.
  // Apple's DEVELOPER channel is a different host and is exempted below.
  'Apple Newsroom',
]);


function hostOf(s: SourceRow): string {
  try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function inList(host: string, list: readonly string[]): boolean {
  return hostMatches(host, list);
}

function isSocial(s: SourceRow): boolean {
  return inList(hostOf(s), SOCIAL_HOSTS);
}

function isConsumer(s: SourceRow): boolean {
  return inList(hostOf(s), CONSUMER_HOSTS);
}

function isOffBeat(s: SourceRow): boolean {
  if (inList(hostOf(s), ALWAYS_KEEP_HOSTS)) return false;
  return OFF_BEAT_NAMES.has(s.name) || inList(hostOf(s), OFF_BEAT_HOSTS);
}

interface Verdict {
  s: SourceRow;
  n: number;
  refused: number;
  technical: number;
  social: boolean;
  /** technical share of the items the topic filter kept */
  rate: number;
  recommend: 'pause' | 'watch' | 'keep';
  why: string;
}

const verdicts: Verdict[] = sources.map((s) => {
  const items = bySource.get(s.id) ?? [];
  const social = isSocial(s);
  let refused = 0;
  let technical = 0;
  let kept = 0;

  for (const it of items) {
    const v = judgeTopic(it.title ?? '', it.summary ?? '',
      { vocab, sourceKind: s.kind, sourceRoles: s.roles });
    if (!v.keep) { refused++; continue; }
    kept++;
    const named = detectStacks(it.title ?? '', vocab, { max: 1 }).length > 0;
    if (named || isTechnicalTitle(it.title ?? '')) technical++;
  }

  const rate = kept > 0 ? technical / kept : 0;
  let recommend: Verdict['recommend'] = 'keep';
  let why = '';

  const spared = keepAbove !== null && items.length >= MIN_SAMPLE && rate >= keepAbove;

  if (social && spared) {
    why = `social, spared at ${(rate * 100).toFixed(0)}% technical`;
  } else if (social) {
    recommend = 'pause';
    why = items.length >= MIN_SAMPLE
      ? `social, ${(rate * 100).toFixed(0)}% technical`
      : `social, ${items.length} items`;
  } else if (isOffBeat(s)) {
    recommend = 'pause';
    why = 'not a tech-news source';
  } else if (isConsumer(s)) {
    recommend = 'pause';
    why = items.length >= MIN_SAMPLE
      ? `consumer press, ${((refused / items.length) * 100).toFixed(0)}% off-topic`
      : 'consumer press';
  } else if (!s.roles.includes('PRIMARY') && items.length >= MIN_SAMPLE
             && refused / items.length >= 0.15) {
    // Measured rather than listed, for the outlets nobody thought to name. A
    // first-party source is exempt: a vendor publishing about its own product
    // is the purest source this system has, whatever its off-topic rate says.
    recommend = 'pause';
    why = `${((refused / items.length) * 100).toFixed(0)}% off-topic`;
  }

  return { s, n: items.length, refused, technical, social, rate, recommend, why };
});

// --- one source, read in full ------------------------------------------------

if (show) {
  const hit = verdicts.find((v) => v.s.name.toLowerCase().includes(show.toLowerCase()));
  if (!hit) { console.log(`no source matching "${show}"`); await closePool(); process.exit(0); }
  const items = bySource.get(hit.s.id) ?? [];
  console.log(`${hit.s.name}  (${hit.s.kind}, ${hit.s.roles.join('+')}, ${hit.s.health})`);
  console.log(`${hit.s.url}`);
  console.log(`${items.length} items in ${days} days; ${hit.refused} refused; `
    + `${(hit.rate * 100).toFixed(0)}% of the rest technical\n`);
  for (const it of items.slice(0, 70)) {
    const v = judgeTopic(it.title ?? '', it.summary ?? '',
      { vocab, sourceKind: hit.s.kind, sourceRoles: hit.s.roles });
    const named = detectStacks(it.title ?? '', vocab, { max: 1 });
    const mark = !v.keep ? `refused:${v.category}`
      : named.length ? `tech:${named[0]}`
        : isTechnicalTitle(it.title ?? '') ? 'tech:phrasing' : 'NEITHER';
    console.log(`  ${mark.slice(0, 18).padEnd(19)}${(it.title ?? '').slice(0, 100)}`);
  }
  await closePool();
  process.exit(0);
}

// --- the table ---------------------------------------------------------------

const shown = (socialOnly ? verdicts.filter((v) => v.social) : verdicts)
  .filter((v) => v.n > 0 || v.social)
  .sort((a, b) => (a.rate - b.rate) || (b.n - a.n));

console.log(`${sources.length} sources, judged on ${days} days of their own output`);
console.log(`social = link aggregator or community board; technical = share of KEPT items `
  + `naming a technology or reading like an announcement\n`);
console.log(`  ${'source'.padEnd(28)}${'kind'.padEnd(11)}${'items'.padStart(7)}`
  + `${'refused'.padStart(9)}${'technical'.padStart(11)}  ${'health'.padEnd(9)}verdict`);

for (const v of shown) {
  const refusedPct = v.n ? `${((v.refused / v.n) * 100).toFixed(0)}%` : '-';
  const techPct = v.n >= MIN_SAMPLE ? `${(v.rate * 100).toFixed(0)}%` : '-';
  console.log(
    `  ${v.s.name.slice(0, 27).padEnd(28)}${(v.social ? `${v.s.kind}*` : v.s.kind).padEnd(11)}`
    + `${String(v.n).padStart(7)}${refusedPct.padStart(9)}${techPct.padStart(11)}  `
    + `${v.s.health.padEnd(9)}${v.recommend === 'pause' ? 'PAUSE' : v.recommend === 'watch' ? 'watch' : ''}`
    + (v.why ? `  ${v.why}` : ''));
}

const toPause = verdicts.filter((v) => v.recommend === 'pause' && v.s.health !== 'paused');
console.log('\n* link aggregator or community board.');
console.log(`${toPause.length} active sources recommended for pausing `
  + `(${verdicts.filter((v) => v.recommend === 'pause').length} in total, `
  + 'the rest already paused).');

if (!doPause) {
  console.log('(`npm run audit -- --pause` to pause them; `--restore` to undo.)');
  await closePool();
  process.exit(0);
}

if (toPause.length === 0) {
  console.log('nothing to pause.');
} else {
  // Paused, not deleted. A source row is referenced by every story it ever
  // carried and by every membership row; deleting one would either cascade
  // through the archive or fail on a foreign key. Pausing stops the polling,
  // which is the part that was the problem, and it is reversible from one
  // command or from /sources.
  await db.query(
    `UPDATE sources
        SET health = 'paused',
            notes = coalesce(notes || E'\\n', '') || $2,
            updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [toPause.map((v) => v.s.id), `${MARK}: ${new Date().toISOString().slice(0, 10)}`]);
  console.log(`\npaused ${toPause.length}:`);
  for (const v of toPause) console.log(`  ${v.s.name.padEnd(28)}${v.why}`);
  console.log('\nstories already collected are untouched. `npm run audit -- --restore` to undo.');
}

await closePool();

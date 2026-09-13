// Give every technology this archive tracks a release feed.
//
//   npm run seed:releases             audition, print what would change
//   npm run seed:releases -- --apply  do it
//
// 2026-09-12, against "The news scope still low, extend source list".
//
// WHY THIS LIST AND NOT A LIST OF PUBLICATIONS. The archive's collection target
// is two things -- new stacks, tools and platforms, and market moves -- and
// articles are noise. A repository's own releases.atom is the least
// article-shaped source that exists: it is the technology telling you what it
// did, dated, with the notes its maintainers wrote. There is no editorial layer
// to see through and no publisher's interest to discount.
//
// The candidates are not guessed. `stacks` holds 2,460 technologies, 1,038 of
// them with a GitHub repository, and 436 of those had no release feed in the
// registry. Those 436 are the list: every one of them is something this archive
// already decided was worth tracking, and every one of them was publishing to
// an address nobody was reading.
//
// WHY THIS COULD NOT HAVE BEEN RUN YESTERDAY. Until 2026-09-12 a release feed
// admitted here would have stored nothing. `isBuildNoise` refused every
// `/releases/tag/` address unless the source was marked `kind = 'releases'`, no
// row in the registry had ever carried that value, and the 325 release feeds
// already registered had been fetching cleanly and silently for their whole
// lives. Adding 436 more would have added 436 more silent rows. See
// migration 0083 and `isReleaseFeed`.
//
// EVERY CANDIDATE IS AUDITIONED against the same gauntlet ingest runs, before
// it is offered. A repository with no releases, or one whose tags are all
// nightlies, is refused here rather than discovered as a dead row in a month.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv, getConfig } from '../src/config.ts';
import { fetchConditional } from '../src/collect/fetcher.ts';
import { parseFeed } from '../src/collect/feed.ts';
import { topicVocabulary, judgeTopic } from '../src/collect/topical.ts';
import { classifyEvent, isEvent } from '../src/collect/eventful.ts';
import { isBuildNoise } from '../src/vocab/buildnoise.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const apply = process.argv.includes('--apply');
const limitAt = process.argv.indexOf('--limit');
const limit = limitAt === -1 ? 0 : Number(process.argv[limitAt + 1] ?? 0) || 0;
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);
const userAgent = getConfig().fetch.userAgent;
const vocab = await topicVocabulary(db);

/** owner/repo, off the repository URL the stack already carries. */
const NWO = "regexp_replace(s.repo_url,"
  + " '^https?://(www[.])?github[.]com/([^/]+/[^/?#]+).*$', '\\2')";

interface Candidate { slug: string; name: string; category: string | null; nwo: string }

const candidates = await db.query<Candidate>(
  `SELECT s.slug, s.name, s.category, ${NWO} AS nwo
     FROM stacks s
    WHERE s.repo_url ~* '^https?://(www[.])?github[.]com/[^/]+/[^/?#]+'
      AND NOT EXISTS (
        SELECT 1 FROM sources src
         WHERE src.feed_url ILIKE '%' || ${NWO} || '/releases.atom')
    ORDER BY s.slug` + (limit ? ` LIMIT ${limit}` : ''));

console.log(`auditioning ${candidates.length} repositories`);

/**
 * The gauntlet, as ingest runs it, on one release entry.
 *
 * `fromReleaseFeed` is true by construction: the only thing this script ever
 * auditions is a releases.atom. Passing it is the whole point -- without it
 * every entry is refused as a tag page and every candidate scores zero, which
 * is the shape of the bug this script exists downstream of.
 */
function keeps(title: string, body: string): boolean {
  if (!title.trim()) return false;
  const topic = judgeTopic(title, body, {
    vocab, sourceKind: 'releases', sourceRoles: ['CONTENT', 'PRIMARY'],
  });
  if (!topic.keep) return false;
  if (isBuildNoise(title, body, { fromReleaseFeed: true }).noise) return false;
  return isEvent(classifyEvent(title, { sourceKind: 'releases', firstParty: true }).kind);
}

/** Three real releases in what the feed carries. Below that it is a build log. */
const BAR = 3;

interface Judged extends Candidate { offered: number; kept: number; note: string }
const judged: Judged[] = [];
const LANES = 6;
let next = 0;
await Promise.all(Array.from({ length: LANES }, async () => {
  for (;;) {
    const i = next++;
    if (i >= candidates.length) return;
    const c = candidates[i]!;
    const feed = `https://github.com/${c.nwo}/releases.atom`;
    try {
      const res = await fetchConditional(feed, { userAgent });
      if (res.kind !== 'ok') {
        judged.push({ ...c, offered: 0, kept: 0, note: `fetch ${res.kind}` });
      } else {
        const items = parseFeed(res.body, feed)?.items ?? [];
        let kept = 0;
        for (const it of items) {
          if (keeps(it.title ?? '', it.content || it.summary || '')) kept++;
        }
        judged.push({ ...c, offered: items.length, kept, note: '' });
      }
    } catch (err) {
      judged.push({ ...c, offered: 0, kept: 0, note: (err as Error).message.slice(0, 40) });
    }
    if (judged.length % 25 === 0) console.error(`  ${judged.length}/${candidates.length}`);
  }
}));

judged.sort((a, b) => b.kept - a.kept || a.slug.localeCompare(b.slug));
const pass = judged.filter((j) => j.kept >= BAR);
const fail = judged.filter((j) => j.kept < BAR);

console.log(' kept/of  repository                                  technology');
console.log(' ' + '-'.repeat(88));
for (const j of pass) {
  console.log(` ${String(j.kept).padStart(4)}/${String(j.offered).padEnd(3)} `
    + `${j.nwo.slice(0, 42).padEnd(44)}${j.name.slice(0, 28)}`);
}

const why = new Map<string, number>();
for (const j of fail) {
  const raw = j.note || (j.offered === 0
    ? 'no releases at all'
    : `only ${j.kept} of ${j.offered} entries are releases`);
  const k = raw.replace(/\d+/g, 'N');
  why.set(k, (why.get(k) ?? 0) + 1);
}
console.log(`\nREFUSED ${fail.length}: `
  + [...why].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', '));
console.log(`\nADD ${pass.length} release feeds, `
  + `${pass.reduce((n, j) => n + j.kept, 0)} releases already on their front pages.`);

if (!apply) {
  console.log('\n(dry run. `npm run seed:releases -- --apply` to do it.)');
  await closePool();
  process.exit(0);
}

// Polled every three hours rather than hourly. A repository ships a release on
// a human schedule, GitHub's feed carries the last ten whatever happens, and
// 400 more hourly fetches buy nothing but rate limit.
let added = 0;
for (const j of pass) {
  const rows = await db.query(
    `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang,
                          trust_weight, weight_content, never_canonical, fields,
                          poll_interval_seconds, politeness_seconds, shard,
                          curated, tech_only, notes,
                          source_type, categories, tech_domains, status,
                          discovery_method, inclusion_reason, last_evaluated_at)
     VALUES ($1, $2, $3, 'atom', 'releases',
             '{CONTENT,PRIMARY,LAUNCH}'::source_role[],
             'en', 0.9, 0.9, false, '{}', 10800, 2, abs(hashtext($2)) % 6,
             true, true, $4,
             'PRIMARY_PROJECT'::source_type, '{releases}'::text[], $5::text[],
             'APPROVED', 'stacks-without-a-release-feed', $6, now())
     ON CONFLICT (url) DO NOTHING RETURNING 1`,
    [`${j.name} releases`,
      `https://github.com/${j.nwo}/releases`,
      `https://github.com/${j.nwo}/releases.atom`,
      `added 2026-09-12: tracked in stacks as ${j.slug}, no release feed `
      + `registered. ${j.kept} of ${j.offered} entries on the feed's front page `
      + 'pass the ingest gauntlet.',
      j.category ? [j.category] : [],
      `${j.kept} of ${j.offered} front-page entries are real releases, auditioned live.`]);
  added += rows.length;
}

const [after] = await db.query<{ n: string; rel: string }>(
  `SELECT count(*)::text AS n,
          count(*) FILTER (WHERE kind = 'releases')::text AS rel
     FROM sources`);
console.log(`\n${added} added. Registry: ${after!.n} sources, ${after!.rel} release feeds.`);
await closePool();

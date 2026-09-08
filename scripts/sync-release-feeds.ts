// Turn the technology registry into release feeds, by asking GitHub rather than
// by guessing.
//
//   npm run sync:releases                  what it would add, and nothing else
//   npm run sync:releases -- --apply       add them
//   npm run sync:releases -- --months 24   how stale a project may be and still count
//   npm run sync:releases -- --curated     only the hand-curated entries
//   npm run sync:releases -- --tracked     only what Settings says you track
//
// WHY THIS IS DERIVED AND NOT A SEED FILE
//
// The registry holds 1,005 technologies with a GitHub repository. Hand-listing
// their feeds would be a thousand lines that rot: projects are renamed, archived
// and moved, and a hand-written feed URL keeps its confident shape long after it
// stops resolving. So the list is computed from `stacks.repo_url` every time
// this runs, and every candidate is PROBED before it is written down.
//
// WHAT THE PROBE FOUND ON 2026-08-26, over all 1,005:
//
//   656  publish GitHub releases      562 of them within 12 months
//    57  tag but never publish        Linux, Python, PostgreSQL, Go, Java, Git,
//                                     Kafka, MongoDB -- the biggest things here
//    30  neither
//   261  the URL is an ORGANISATION, not a repository: github.com/aws,
//        /cloudflare, /android. There is no releases.atom for an org, and the
//        announcement channel for those IS the vendor changelog. 42 are curated
//        and every one of them is hand-resolved in seeds/primary.ts.
//
// A repository that has not published a release in a year is not dropped from
// the vocabulary -- it stays searchable and browsable. It is dropped as a
// SOURCE, because polling it forever costs a request an hour to learn nothing.
//
// WHAT THIS NEVER TOUCHES
//   Rows a person wrote. A hand-curated source and a derived one can collide on
//   `sources.url` -- seeds/primary.ts lists github.com/apache/kafka by hand --
//   and on that collision the hand-written row wins, always. The guard is
//   `WHERE sources.curated IS NOT TRUE` on the upsert, not an ordering trick.

import { makePool } from '../src/db/driver.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';

await loadDotEnv();
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN is not set. Unauthenticated probing of 1,005 repositories');
  console.error('is rate-limited to 60 requests an hour and would take seventeen hours.');
  process.exit(1);
}

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const curatedOnly = argv.includes('--curated');
// Collection follows the reader's choice rather than preceding it.
//
// 319 repository feeds were polled for a reader tracking nothing, which is the
// wrong way round: "Releases you track" governs what News SHOWS, and there is no
// reason for it not to govern what is fetched. With --tracked this script adds a
// feed for each technology named in Settings and no others.
const trackedOnly = argv.includes('--tracked');
const flag = (name: string, fallback: number): number => {
  const i = argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
};
const months = flag('months', 12);
const limit = flag('limit', 0);

const pool = makePool(url);
const db = await pool.connect();
const done = async (code = 0): Promise<never> => {
  db.release();
  await pool.end();
  process.exit(code);
};

interface Entry {
  slug: string; name: string; kind: string; curated: boolean; repo_url: string;
}

let tracked: string[] = [];
if (trackedOnly) {
  const { rows } = await db.query<{ value: unknown }>(
    `SELECT value FROM app_settings WHERE key = 'reading.tracked'`);
  const raw = rows[0]?.value;
  tracked = Array.isArray(raw) ? raw.map(String) : [];
  if (tracked.length === 0) {
    console.log('Settings -> Releases you track is empty, so there is nothing to add.');
    console.log('Choose technologies there first; this script follows that list.');
    await done();
  }
  console.log(`tracking ${tracked.length}: ${tracked.join(', ')}`);
}

const { rows: entries } = await db.query<Entry>(
  `SELECT slug, name, kind::text AS kind, curated, repo_url
     FROM stacks
    WHERE repo_url LIKE 'https://github.com/%'
      ${curatedOnly ? 'AND curated' : ''}
      ${trackedOnly ? 'AND slug = ANY($1::text[])' : ''}
    ORDER BY curated DESC, slug`, trackedOnly ? [tracked] : []);

// Sources that already exist, so a repo is never probed twice and a hand-written
// row is never even considered for replacement.
const { rows: existing } = await db.query<{ url: string; curated: boolean }>(
  `SELECT url, curated FROM sources`);
const known = new Map(existing.map((r) => [r.url.replace(/\/+$/, ''), r.curated]));

type Verdict = 'releases' | 'tags' | 'stale' | 'no_releases' | 'gone' | 'org' | 'held' | 'error';
interface Probe extends Entry { repo: string; verdict: Verdict; latest: string | null; note?: string }

const head = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'newstrack-source-sync',
};
const cutoff = Date.now() - months * 30 * 864e5;
const results: Probe[] = [];
let scanned = 0;

async function probe(e: Entry): Promise<void> {
  const repo = e.repo_url.replace('https://github.com/', '').replace(/\/+$/, '');
  const base: Probe = { ...e, repo, verdict: 'error', latest: null };
  try {
    // An organisation URL has one path segment. It is not a mistake in the data
    // -- "aws" and "cloudflare" are real entries whose home IS the org page --
    // it just means the announcement lives somewhere this script cannot derive.
    if (!repo.includes('/')) { results.push({ ...base, verdict: 'org' }); return; }
    // A tree/blob URL points inside a repository, not at one.
    if (/\/(tree|blob)\//.test(repo)) {
      results.push({ ...base, verdict: 'error', note: 'points inside a repo, not at one' });
      return;
    }
    if (known.has(e.repo_url.replace(/\/+$/, ''))) {
      results.push({ ...base, verdict: 'held', note: 'already a source' });
      return;
    }

    const rel = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=5`, { headers: head });
    if (rel.status === 404) { results.push({ ...base, verdict: 'gone' }); return; }
    if (!rel.ok) {
      results.push({ ...base, verdict: 'error', note: `releases http ${rel.status}` });
      return;
    }
    const list = await rel.json() as { published_at: string | null; draft: boolean }[];
    const live = Array.isArray(list) ? list.filter((x) => !x.draft && x.published_at) : [];
    if (live.length > 0) {
      const latest = live[0]!.published_at!;
      results.push({ ...base, latest,
        verdict: Date.parse(latest) >= cutoff ? 'releases' : 'stale' });
      return;
    }
    // Tags are a thinner signal -- a version and a date, no notes -- so they are
    // taken only for entries a person put in the vocabulary. A bulk-imported
    // topic that tags without releasing is not worth an hourly request.
    const tags = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=1`, { headers: head });
    const tagList = tags.ok ? await tags.json() as unknown[] : [];
    results.push({ ...base,
      verdict: Array.isArray(tagList) && tagList.length && e.curated ? 'tags' : 'no_releases' });
  } catch (err) {
    results.push({ ...base, verdict: 'error', note: (err as Error).message.slice(0, 50) });
  } finally {
    if (++scanned % 100 === 0) process.stderr.write(`  probed ${scanned}/${entries.length}\n`);
  }
}

const queue = limit > 0 ? entries.slice(0, limit) : [...entries];
const total = queue.length;
console.log(`probing ${total} repositories in the registry…`);
await Promise.all(Array.from({ length: 8 }, async () => {
  for (;;) { const next = queue.shift(); if (!next) return; await probe(next); }
}));

const tally = new Map<Verdict, number>();
for (const r of results) tally.set(r.verdict, (tally.get(r.verdict) ?? 0) + 1);
const promote = results.filter((r) => r.verdict === 'releases' || r.verdict === 'tags');

console.log('');
console.log('probe:');
for (const [v, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${v.padEnd(12)} ${String(n).padStart(5)}`);
}
console.log('');
console.log(`to add: ${promote.length} sources`);
console.log(`  release feeds  ${promote.filter((r) => r.verdict === 'releases').length}`);
console.log(`  tag feeds      ${promote.filter((r) => r.verdict === 'tags').length} (curated entries only)`);
console.log(`  curated        ${promote.filter((r) => r.curated).length}`);
for (const r of promote.slice(0, 10)) {
  console.log(`    ${r.name.padEnd(24)} ${r.verdict === 'tags' ? 'tags' : 'releases'}.atom`
    + `   ${r.latest ? `latest ${r.latest.slice(0, 10)}` : ''}`);
}
if (promote.length > 10) console.log(`    …and ${promote.length - 10} more`);

if (!apply) {
  console.log('');
  console.log('(dry run. `npm run sync:releases -- --apply` to add them.)');
  await done();
}

// --- write ------------------------------------------------------------------
// Two writes per entry, and they are different in kind. `stacks.release_feed_url`
// is a FACT about the technology and is filled in whether or not the source is
// wanted; `sources` is a decision about what to poll. Keeping them separate means
// a later run with different flags still has the fact.
// A feed already in the registry under a DIFFERENT address.
//
// The upsert keys on `url` -- github.com/hashicorp/terraform -- while `feed_url`
// is unique, and a hand-written first-party changelog gives the same
// releases.atom a different url (.../terraform/releases). Neither row sees the
// other, so the insert dies on the constraint and the whole transaction rolls
// back: 302 feeds lost to one collision, with "duplicate key" as the only clue.
//
// The hand-written row wins -- it was chosen, and it carries the fields and the
// notes a derived row does not. Skipped feeds are counted out loud, because a
// sync that quietly drops them is how a technology goes uncollected.
const { rows: claimedRows } = await db.query<{ feed_url: string }>(
  `SELECT feed_url FROM sources WHERE feed_url IS NOT NULL`);
const claimed = new Set(claimedRows.map((x) => x.feed_url));
const skippedFeeds: string[] = [];

let added = 0, filled = 0;
await db.query('BEGIN');
try {
  for (const [index, r] of promote.entries()) {
    const feed = `https://github.com/${r.repo}/${r.verdict === 'tags' ? 'tags' : 'releases'}.atom`;
    if (claimed.has(feed)) { skippedFeeds.push(`${r.name} -> ${feed}`); continue; }
    claimed.add(feed);
    const res = await db.query(
      `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang,
                            trust_weight, weight_content, never_canonical, fields,
                            poll_interval_seconds, politeness_seconds, shard, curated, notes)
       VALUES ($1,$2,$3,'atom','releases', ARRAY['PRIMARY']::source_role[], 'en',
               1.0, 0.8, false, ARRAY[]::text[], $4, 2, $5, false, $6)
       ON CONFLICT (url) DO UPDATE SET
         feed_url = EXCLUDED.feed_url, kind = 'releases', health = 'healthy',
         consecutive_failures = 0, notes = EXCLUDED.notes
       WHERE sources.curated IS NOT TRUE
       RETURNING id`,
      [
        `${r.name} ${r.verdict === 'tags' ? 'tags' : 'releases'}`,
        `https://github.com/${r.repo}`,
        feed,
        // Curated entries are the ones a person said matter, so they are polled
        // four times a day and the rest twice. `fields` is left empty on purpose:
        // which field a story belongs to is decided by the technologies tagged in
        // it, through the taxonomy closure, and copying a guess onto the source
        // row would put a second, weaker answer next to the real one.
        r.curated ? 6 * 3600 : 12 * 3600,
        1 + (index % 5),
        `derived from stacks.repo_url (${r.slug})`,
      ]);
    if (res.rowCount) added++;

    const fill = await db.query(
      `UPDATE stacks SET release_feed_url = $2
        WHERE slug = $1 AND release_feed_url IS DISTINCT FROM $2`, [r.slug, feed]);
    filled += fill.rowCount ?? 0;
  }
  await db.query('COMMIT');
} catch (err) {
  await db.query('ROLLBACK');
  console.error('');
  console.error('rolled back, nothing changed:', (err as Error).message);
  await done(1);
}

const { rows: after } = await db.query<{ kind: string; n: string }>(
  `SELECT kind::text AS kind, count(*)::text AS n FROM sources GROUP BY 1 ORDER BY 2 DESC`);
console.log('');
console.log('done:');
console.log(`  sources added            ${added}`);
console.log(`  stacks.release_feed_url  ${filled} filled in`);
if (skippedFeeds.length > 0) {
  console.log(`  already seeded by hand   ${skippedFeeds.length} skipped`);
  for (const line of skippedFeeds.slice(0, 10)) console.log(`    ${line}`);
  if (skippedFeeds.length > 10) console.log(`    …and ${skippedFeeds.length - 10} more`);
}
for (const r of after) console.log(`  ${r.kind.padEnd(10)} ${r.n}`);
console.log('');
console.log('`npm run poll` to collect from them.');
await done();

// The registry, changing itself.
//
// Asked for on 2026-08-31: *"I don't want to get news from fixed sources, the
// source list have to be change to get good news"*.
//
// Half of this already existed and had never been finished. Every kept story
// contributes its outbound domains to `source_candidates`, which by the time
// this was written held 3,113 of them -- and the table carries `evaluated_at`,
// `verdict` and `promoted_source_id` columns for a promotion pass that was
// described in a comment as "a separate weekly model pass" and never written.
// So the archive had been watching where its sources point for months and doing
// nothing with the answer.
//
// This is that pass, and it is not a model pass. It is the audition: fetch the
// domain, find its feed, put every recent item through the whole gauntlet, and
// decide on the number.
//
// IT ONLY EVER ADDS. Nothing here pauses, retires or deletes a source -- "don't
// remove anyone anymore" is a standing instruction, and a loop that prunes what
// it judges quiet would break it every night while nobody was watching. A
// source that goes silent stays in the registry and shows as silent.
//
// THE BAR IS HIGHER THAN THE GAUNTLET, AND THAT IS THE WHOLE DESIGN.
//
// The gauntlet is not sufficient to admit a source unattended. Measured
// 2026-08-31, live:
//
//     howtogeek.com   10 of 10 kept   "A $25 power bank is all you need to
//                                      stay online during a power outage"
//     thenextweb.com   8 of 10 kept   "Pinterest CFO Julia Donnelly is leaving
//                                      to join an early-stage company"
//
// Both clear it comfortably. Neither belongs in an archive of what happens to
// stacks, tools and platforms. What keeps them out today is a blocklist of
// hosts and the fact that nobody added them -- cnet.com and hackaday.com are
// literally on a list -- and a blocklist is not a rule, it is a memory of every
// mistake made so far.
//
// The technical-share measure does not separate them either: HowToGeek scores
// 70% and The Next Web 88%, against vLLM's 93% and PyTorch's 100%. Close enough
// that a threshold there is a coin toss wearing a number.
//
// What does separate them is FIRST-PARTY-NESS: does this domain belong to
// something the archive already tracks? pytorch.org is the home of a stack,
// snowflake.com of a platform and a company, modal.com and ollama.com of
// platforms. howtogeek.com, thenextweb.com, hackaday.com and cnet.com are the
// homes of nothing -- they write about other people's work.
//
// That test is high-precision and low-recall: it also fails vLLM, LangChain and
// Qdrant, which ARE first parties whose homepage_url the vocabulary happens not
// to record. For a loop that runs unattended, that is the right way round. It
// promotes only what it can prove, and everything else it can only PROPOSE,
// with its numbers attached, for a person to accept.

import type { Db } from '../db/client.ts';
import { getConfig } from '../config.ts';
import { auditionFeed, looksLikeLinkblog, KEEP_BAR } from '../collect/audition.ts';
import { topicVocabulary } from '../collect/topical.ts';
import { isOffTopicHost } from '../vocab/offtopic.ts';

export interface SourcesReport {
  examined: number;
  promoted: number;
  proposed: number;
  refused: number;
  noFeed: number;
  promotedNames: string[];
}

interface CandidateRow {
  domain: string;
  mention_count: number;
  refs: number;
  sample_urls: string[];
}

/**
 * How many distinct sources must have pointed at a domain before it is worth a
 * dozen requests. One source linking somewhere repeatedly is a habit; three
 * unrelated ones is a signal.
 */
const MIN_REFERRERS = 3;

/** Per run. Each candidate costs a feed hunt plus up to a dozen page fetches. */
const BATCH = 8;

/**
 * Does this domain own something the archive already tracks?
 *
 * The homepage of a stack, the URL of a platform, the homepage or blog of a
 * company. Matched on the registrable-looking tail so that blog.x.com counts
 * for x.com, which is how vendors actually arrange their writing.
 */
async function isFirstParty(db: Db, domain: string): Promise<string | null> {
  const bare = domain.replace(/^www\./, '');
  const [row] = await db.query<{ what: string | null }>(
    `SELECT coalesce(
              (SELECT 'the ' || name || ' stack' FROM stacks
                WHERE split_part(split_part(coalesce(homepage_url,''),'//',2),'/',1) ILIKE '%'||$1
                   OR split_part(split_part(coalesce(docs_url,''),'//',2),'/',1) ILIKE '%'||$1
                LIMIT 1),
              (SELECT 'the ' || name || ' platform' FROM platforms
                WHERE split_part(split_part(coalesce(url,''),'//',2),'/',1) ILIKE '%'||$1
                LIMIT 1),
              (SELECT name || ', a tracked company' FROM companies
                WHERE split_part(split_part(coalesce(homepage_url,''),'//',2),'/',1) ILIKE '%'||$1
                   OR split_part(split_part(coalesce(blog_url,''),'//',2),'/',1) ILIKE '%'||$1
                LIMIT 1)
            ) AS what`,
    [bare],
  );
  return row?.what ?? null;
}

/**
 * The three words the table allows, since 0003: promoted, rejected, deferred.
 *
 * 'deferred' is the interesting one and it already meant the right thing --
 * not refused, not accepted, waiting on a judgement this job is not entitled to
 * make. The schema had the vocabulary for this pass before the pass existed.
 */
type Verdict = 'promoted' | 'rejected' | 'deferred';

async function settle(
  db: Db, domain: string, verdict: Verdict, reason: string, sourceId?: string,
): Promise<void> {
  await db.query(
    `UPDATE source_candidates
        SET evaluated_at = now(), verdict = $2, verdict_reason = $3,
            promoted_source_id = coalesce($4::uuid, promoted_source_id)
      WHERE domain = $1`,
    [domain, verdict, reason.slice(0, 400), sourceId ?? null],
  );
}

export async function auditionCandidates(db: Db, opts: { batch?: number } = {}): Promise<SourcesReport> {
  const report: SourcesReport = {
    examined: 0, promoted: 0, proposed: 0, refused: 0, noFeed: 0, promotedNames: [],
  };
  const vocab = await topicVocabulary(db);
  const userAgent = getConfig().fetch.userAgent;

  const rows = await db.query<CandidateRow>(
    `SELECT domain, mention_count, array_length(referring_sources, 1) AS refs, sample_urls
       FROM source_candidates
      WHERE evaluated_at IS NULL
        AND array_length(referring_sources, 1) >= $1
      ORDER BY array_length(referring_sources, 1) DESC, mention_count DESC
      LIMIT $2`,
    [MIN_REFERRERS, opts.batch ?? BATCH],
  );

  for (const row of rows) {
    report.examined++;

    if (isOffTopicHost(row.domain)) {
      report.refused++;
      await settle(db, row.domain, 'rejected', 'on the off-topic host list');
      continue;
    }

    const result = await auditionFeed({
      site: `https://${row.domain}/`,
      // Judged as CONTENT, never PRIMARY. Nothing is known about a domain the
      // archive merely found, and PRIMARY is what relaxes the topic filter --
      // granting it on a guess is how the generous setting gets used to admit
      // something that would fail the strict one.
      primary: false,
      vocab,
      userAgent,
      sample: 12,
      politenessMs: 1200,
    });

    if (!result.feed) {
      report.noFeed++;
      await settle(db, row.domain, 'rejected', `no feed advertised or guessable (${row.refs} referrers)`);
      continue;
    }

    // A linkblog is not a first party, however first-party its domain looks.
    // Checked before the keep count, because a linkblog scores WELL -- it is
    // recommending things worth reading, so the gauntlet likes it.
    if (looksLikeLinkblog(result)) {
      report.refused++;
      await settle(db, row.domain, 'rejected',
        `links away from itself: ${result.linkDomains.size} domains across ${result.recent} `
        + `items — a linkblog, not a publisher (feed ${result.feed})`);
      continue;
    }

    if (result.kept < KEEP_BAR) {
      report.refused++;
      const top = [...result.reasons.entries()].sort((a, b) => b[1] - a[1])[0];
      await settle(db, row.domain, 'rejected',
        `${result.kept} kept of ${result.recent} in 90 days`
        + `${top ? `, mostly ${top[0]}` : ''} — feed ${result.feed}`);
      continue;
    }

    const owns = await isFirstParty(db, row.domain);
    if (!owns) {
      // It reads well and we cannot show it is a first party. Recorded with its
      // numbers and left for a person: this is the branch HowToGeek lands in,
      // and it is the reason the loop does not simply trust the gauntlet.
      report.proposed++;
      await settle(db, row.domain, 'deferred',
        `${result.kept} of ${result.recent} kept, ${Math.round((result.technical / result.kept) * 100)}%`
        + ` technical, ${row.refs} referrers — feed ${result.feed}. Not a first party for anything`
        + ' the archive tracks, so not promoted automatically.');
      continue;
    }

    const name = row.domain.replace(/^www\./, '');
    const [inserted] = await db.query<{ id: string }>(
      `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang,
                            trust_weight, weight_content, never_canonical, fields,
                            poll_interval_seconds, politeness_seconds, shard,
                            curated, tech_only, notes)
       VALUES ($1, $2, $3, 'rss', 'news', '{CONTENT,PRIMARY}'::source_role[], 'en',
               0.8, 0.9, false, '{}', 3600, 2, abs(hashtext($2)) % 6, false, false, $4)
       ON CONFLICT (url) DO NOTHING
       RETURNING id::text`,
      [name, `https://${row.domain}/`, result.feed,
        `promoted by the sources job: ${result.kept} of ${result.recent} kept in 90 days, `
        + `${row.refs} referring sources, and it owns ${owns}`],
    );

    if (!inserted) {
      report.refused++;
      await settle(db, row.domain, 'rejected', 'already held under this URL');
      continue;
    }
    report.promoted++;
    report.promotedNames.push(name);
    await settle(db, row.domain, 'promoted',
      `${result.kept} of ${result.recent} kept in 90 days; owns ${owns}`, inserted.id);
  }

  return report;
}


// --- the second channel: what the archive already tracks ---------------------
//
// The outbound-link pool turned out to be the wrong place to look for
// PUBLISHERS. Vendor blogs link to docs, repositories, standards and social, so
// the top of that pool by referrer count is github.io, youtube.com,
// wikipedia.org, apache.org, npmjs.com -- infrastructure everything points at
// and none of it publishing a feed worth polling. Thirty-two domains examined,
// nothing promoted, nothing even deferred. The channel is good at discovering
// THINGS the archive should track; it is poor at discovering sources.
//
// This channel asks the opposite question, and it is the one that pays: the
// archive tracks 860 stacks and 151 platforms whose own domain it does not poll
// at all. Anthropic is named in 6,246 stories and nobody reads its blog. Every
// candidate here is a first party BY CONSTRUCTION -- it is the vocabulary entry
// -- so the test that phase one has to prove is satisfied before it starts.
//
// Ranked by how much the archive actually mentions the thing, so the ones that
// matter are tried first rather than alphabetically.

interface TrackedRow {
  name: string;
  homepage: string;
  kind: 'stack' | 'platform';
  mentions: number;
}

/** Registrable-looking tail: blog.rust-lang.org and www.rust-lang.org agree. */
const REGISTRABLE = "substring(lower(split_part(split_part(%s, '//', 2), '/', 1)) from '[^.]+[.][^.]+$')";

export async function auditionTracked(
  db: Db, opts: { batch?: number } = {},
): Promise<SourcesReport> {
  const report: SourcesReport = {
    examined: 0, promoted: 0, proposed: 0, refused: 0, noFeed: 0, promotedNames: [],
  };
  const vocab = await topicVocabulary(db);
  const userAgent = getConfig().fetch.userAgent;

  const rows = await db.query<TrackedRow>(
    `WITH src AS (
       SELECT ${REGISTRABLE.replace('%s', 'coalesce(feed_url, url)')} AS d FROM sources
     ),
     seen AS (SELECT domain FROM source_candidates WHERE evaluated_at IS NOT NULL),
     vol AS (SELECT slug, sum(stories)::int AS n FROM stack_month GROUP BY slug),
     pvol AS (SELECT slug, sum(stories)::int AS n FROM platform_month GROUP BY slug)
     SELECT s.name, s.homepage_url AS homepage, 'stack' AS kind, coalesce(v.n, 0) AS mentions
       FROM stacks s LEFT JOIN vol v ON v.slug = s.slug
      WHERE coalesce(s.homepage_url, '') <> ''
        AND ${REGISTRABLE.replace('%s', 's.homepage_url')} NOT IN (SELECT d FROM src WHERE d IS NOT NULL)
        AND ${REGISTRABLE.replace('%s', 's.homepage_url')} NOT IN (SELECT domain FROM seen)
     UNION ALL
     SELECT p.name, p.url AS homepage, 'platform' AS kind, coalesce(pv.n, 0) AS mentions
       FROM platforms p LEFT JOIN pvol pv ON pv.slug = p.slug
      WHERE coalesce(p.url, '') <> ''
        AND ${REGISTRABLE.replace('%s', 'p.url')} NOT IN (SELECT d FROM src WHERE d IS NOT NULL)
        AND ${REGISTRABLE.replace('%s', 'p.url')} NOT IN (SELECT domain FROM seen)
      ORDER BY mentions DESC
      LIMIT $1`,
    [opts.batch ?? BATCH],
  );

  for (const row of rows) {
    report.examined++;
    let host: string;
    try { host = new URL(row.homepage).hostname.replace(/^www\./, ''); } catch { continue; }

    // The ledger is keyed by domain and shared with phase one, so a domain
    // settled here is not offered again by either channel.
    await db.query(
      `INSERT INTO source_candidates (domain, sample_urls, referring_sources, mention_count)
       VALUES ($1, ARRAY[$2], ARRAY[]::uuid[], 0)
       ON CONFLICT (domain) DO NOTHING`,
      [host, row.homepage]);

    if (isOffTopicHost(host)) {
      report.refused++;
      await settle(db, host, 'rejected', `on the off-topic host list (${row.kind} ${row.name})`);
      continue;
    }

    const result = await auditionFeed({
      site: row.homepage,
      // PRIMARY is earned here, unlike in phase one: this domain IS the thing
      // the vocabulary names, so a post on it is a first party writing about
      // its own work -- which is the definition the role carries.
      primary: true,
      vocab,
      userAgent,
      sample: 12,
      politenessMs: 1200,
    });

    if (!result.feed) {
      report.noFeed++;
      await settle(db, host, 'rejected',
        `${row.kind} ${row.name} (${row.mentions} mentions) publishes no discoverable feed`);
      continue;
    }

    const [held] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sources WHERE feed_url = $1`, [result.feed]);
    if (held && held.n > 0) {
      report.refused++;
      await settle(db, host, 'rejected', `its feed is already polled: ${result.feed}`);
      continue;
    }

    // A LINKBLOG IS NOT A FIRST PARTY, however first-party its domain looks.
    // Checked before the keep count, because a linkblog scores WELL: it is
    // recommending things worth reading, so the gauntlet likes it. What it
    // brings in is somebody else's page under this source's name.
    if (looksLikeLinkblog(result)) {
      report.refused++;
      const doms = [...result.linkDomains.keys()].length;
      await settle(db, host, 'rejected',
        `links away from itself: ${doms} domains across ${result.recent} items `
        + `— a linkblog, not a publisher (feed ${result.feed})`);
      continue;
    }

    if (result.kept < KEEP_BAR) {
      report.refused++;
      const top = [...result.reasons.entries()].sort((a, b) => b[1] - a[1])[0];
      await settle(db, host, 'rejected',
        `${row.kind} ${row.name}: ${result.kept} kept of ${result.recent} in 90 days`
        + `${top ? `, mostly ${top[0]}` : ''} — feed ${result.feed}`);
      continue;
    }

    const [inserted] = await db.query<{ id: string }>(
      `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang,
                            trust_weight, weight_content, never_canonical, fields,
                            poll_interval_seconds, politeness_seconds, shard,
                            curated, tech_only, notes)
       VALUES ($1, $2, $3, 'rss', 'news', '{CONTENT,PRIMARY}'::source_role[], 'en',
               0.85, 0.9, false, '{}', 3600, 2, abs(hashtext($2)) % 6, false, false, $4)
       ON CONFLICT (url) DO NOTHING
       RETURNING id::text`,
      [`${row.name} (first party)`, row.homepage, result.feed,
        `promoted by the sources job from the vocabulary: the ${row.kind} "${row.name}" is named in `
        + `${row.mentions} stories and its own site was not polled. `
        + `${result.kept} of ${result.recent} kept in 90 days.`]);

    if (!inserted) {
      report.refused++;
      await settle(db, host, 'rejected', 'already held under this URL');
      continue;
    }
    report.promoted++;
    report.promotedNames.push(row.name);
    await settle(db, host, 'promoted',
      `${row.kind} ${row.name}: ${result.kept} of ${result.recent} kept in 90 days`, inserted.id);
  }

  return report;
}

export function summarise(r: SourcesReport): string {
  if (!r.examined) return '';
  const bits = [`${r.examined} examined`];
  if (r.promoted) bits.push(`${r.promoted} promoted (${r.promotedNames.join(', ')})`);
  if (r.proposed) bits.push(`${r.proposed} proposed`);
  if (r.refused) bits.push(`${r.refused} refused`);
  if (r.noFeed) bits.push(`${r.noFeed} with no feed`);
  return bits.join(', ');
}

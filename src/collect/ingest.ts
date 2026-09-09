// Batched ingest: one feed's worth of items, in a fixed handful of queries.
//
// The per-item path this replaces cost about six database round trips per story
// and fetched article pages one at a time. Measured on six real feeds that was
// 6.3 queries per item and 0.75 items per second. The shape of the fix follows
// from what the measurement said: the database work batches, and the network
// work fans out.
//
//   1  which of these URLs do we already have          (1 query for the feed)
//   2  fetch + extract the unknown ones                (parallel, politeness per domain)
//   3  which of these bodies do we already have        (1 query)
//   4  insert stories / keys / snapshot schedule / jobs (1 query each)
//   5  members + one coverage recount                  (2 queries)
//
// Politeness is still per domain, so fanning out never means hitting one host
// harder -- it means hitting thirty different hosts at once, which is the whole
// point.

import type { Db } from '../db/client.ts';
import type { SourceRow } from '../db/repos/sources.ts';
import * as stories from '../db/repos/stories.ts';
import type { FeedItem } from './feed.ts';
import { gateItem, DropCounter, type DropReason } from './filters.ts';
import { judgeTopic, topicVocabulary } from './topical.ts';
import { isBuildNoise } from '../vocab/buildnoise.ts';
import { classifyEvent, isEvent } from './eventful.ts';
import { fetchConditional, type PolitenessGate } from './fetcher.ts';
import { extractArticle } from './extract.ts';
import { mapWithConcurrency } from '../lib/pool.ts';
import { stillRefused, remember, type Refusal } from './refused.ts';
import { contentHash, sha256, normalizeForHash } from '../lib/hash.ts';
import { simhash, simhashBands, toSigned64 } from '../lib/simhash.ts';
import { canonicalizeUrl, domainOf } from '../lib/url.ts';
import { resolveItemUrls } from './itemurl.ts';
import { truncateSummary, checkLength } from '../lib/text.ts';
import { toHex } from '../lib/hash.ts';
import { getConfig } from '../config.ts';
import { isOffTopicHost } from '../vocab/offtopic.ts';
import {
  isOpenMonth, isTooOld, monthKey, isClosedToIngest,
} from '../lib/retention.ts';

export interface IngestOptions {
  politeness: PolitenessGate;
  userAgent?: string;
  collectionMode?: 'live' | 'backfill';
  fetchArticles?: boolean;
  maxArticleFetches?: number;
  /** How many article pages to fetch at once. Politeness still applies per host. */
  articleConcurrency?: number;
  /**
   * Wall-clock ceiling for this source's article fetching.
   *
   * Measured need: Google Cloud's release notes feed carries 30 items whose
   * pages all time out, and per-domain politeness serializes them -- one source
   * spent 653 seconds and would have owned an entire cron invocation. Past the
   * deadline the remaining items are gated on their feed content instead, and
   * the shortfall is reported rather than hidden.
   */
  deadlineMs?: number;
  qualifyTitle?: (title: string) => string;
  /** Length floor for this source, overriding the article threshold. */
  minLength?: number;
  isPrerelease?: (title: string) => boolean;
  isSelfDescribing?: (url: string) => boolean;
  looksLikeChrome?: (text: string) => boolean;
  /** Override the TOPIC_FILTER setting for this one call. Tests and backfills. */
  topicFilter?: boolean;
  /** Override EVENTS_ONLY for this one call. */
  eventsOnly?: boolean;
  /**
   * Skip and record items the gate has already refused. On by default.
   *
   * Off for backfills and for tests that mean to re-examine everything: a
   * backfill exists precisely to reconsider what a previous pass concluded.
   */
  rememberRefusals?: boolean;
}

export interface IngestResult {
  kept: number;
  duplicates: number;
  drops: Record<string, number>;
  /** canonical URL -> story id, for engagement snapshots on the adapter path. */
  storyByUrl: Map<string, string>;
  articleFetches: number;
  /** Items whose page was skipped because the source ran out of its time budget. */
  deadlineSkipped: number;
}

/** One source may not own a cycle. 45s is generous for a feed and fatal for none. */
export const DEFAULT_SOURCE_DEADLINE_MS = 45_000;

interface Candidate {
  item: FeedItem;
  title: string;
  canonicalUrl: string;
  urlHash: Uint8Array;
  bodyText: string;
  /**
   * The article page was asked for and refused us.
   *
   * Not the same as "this item is short". A publisher who writes two sentences
   * has told us something; a publisher whose server answers 403 has told us
   * nothing, and treating those two the same is how the most important AI
   * source in the registry produced nothing at all for its entire life.
   */
  pageBlocked?: boolean;
  /**
   * The URL this item arrived by, before the page's own rel=canonical had a say.
   *
   * Kept because losing it re-inserted the same article on every single poll.
   * The lookup in step 2 hashes the FEED's link; the row that gets written
   * hashes whatever the page claims to be. When those differ -- a feed with a
   * tracking parameter, an outlet whose canonical drops "www" -- the next poll
   * looks up the arrival URL, finds nothing, fetches, rewrites, and inserts
   * again. ZDNET's travel-charger article was stored eight times in eight
   * hours; one Hacker News item twenty-seven times, all under one URL.
   *
   * So both hashes are now written as url keys, and step 4a re-checks the
   * rewritten one before deciding anything is new.
   */
  arrivalHash: Uint8Array;
  /**
   * What this item IS, decided once, at arrival.
   *
   * It used to live in a Map keyed by canonical URL, and step 3 rewrites that
   * URL whenever a page declares its own rel=canonical -- so the lookup at
   * insert time missed, and the story was stored with no event kind at all.
   * Azure's updates feed does exactly that on every item: 49 releases from a
   * source whose every entry is a release by construction, all filed as
   * unjudged. A verdict that travels with the candidate cannot be lost by a
   * rename.
   */
  eventKind: string | null;
}

/**
 * The set of months already reduced to monthly analysis.
 *
 * Returned as a Set of 'YYYY-MM' rather than a cutoff date, because the rollup
 * is not guaranteed to be contiguous: a month can be rolled while a later one
 * is not, and a cutoff would then either admit stories into a settled month or
 * reject them from an open one.
 *
 * A backfill is exempt. Its whole job is to reach months that are not covered
 * yet, and it is run deliberately rather than on a schedule.
 */
async function archivedMonths(db: Db, opts: IngestOptions): Promise<Set<string> | null> {
  if (opts.collectionMode === 'backfill') return null;
  try {
    const rows = await db.query<{ m: string }>(
      `SELECT to_char(month, 'YYYY-MM') AS m FROM rollup_log`);
    return rows.length ? new Set(rows.map((r) => r.m)) : null;
  } catch {
    // Before 0033 there is no rollup_log, and there is nothing to protect.
    return null;
  }
}

/**
 * Is this item's month settled -- reduced to analysis and closed to collection?
 *
 * A MONTH INSIDE THE RETENTION WINDOW IS NEVER SETTLED, whatever rollup_log
 * says. The window is what the archive keeps whole, so a month inside it is
 * still accumulating by definition; a month in rollup_log is closed to ingest,
 * so settling one that is still open shuts collection down for it.
 *
 * It happened twice, and the second time cost a month. Emptying the registry
 * required deleting August's stories, the delete guard refuses a month that is
 * not rolled up, so August AND July 2026 were rolled up by hand -- and every
 * source afterwards fetched normally, logged `items_kept: 0`, and reported
 * itself healthy. August was saved by a current-month exemption written here by
 * hand. July was not, and with RETENTION_KEEP_MONTHS=2 July was half the
 * archive: measured on 2026-08-28, 557 July items on offer across 50 live
 * feeds, and one July story held.
 *
 * The hand-written exemption was the bug. It named the current month when what
 * it meant was the open window, and the two are only the same thing when
 * keepMonths is 1. isOpenMonth says the general thing, and every caller that
 * decides what "old" means now reads the same sentence -- see lib/retention.ts.
 */
function isArchived(
  months: Set<string>,
  publishedAt: Date | null | undefined,
  keepMonths: number,
  now: Date = new Date(),
): boolean {
  if (!publishedAt) return false;
  // Nothing is archived when nothing is deleted.
  //
  // A settled month was closed to ingest because its stories were about to be
  // PRUNED -- storing into it would put a row in a month whose totals are final
  // and whose contents are leaving. Under KEEP_FOREVER nothing leaves, so the
  // reason is gone, and what remains is a stale rollup that can be recomputed.
  //
  // Measured 2026-08-29, before this line existed: May, June and July were all
  // in rollup_log, so keepMonths=0 narrowed the collectable window from four
  // months to one and refused 86,000 items every six hours.
  if (!isClosedToIngest(true, keepMonths)) return false;
  if (isOpenMonth(publishedAt, keepMonths, now)) return false;
  return months.has(monthKey(publishedAt));
}

/**
 * May this source's articles be kept?
 *
 * The archive collects events and refuses articles, because articles are the
 * bulk of what feeds publish and a river of them buries the launches. That is
 * right about the press and wrong about a project writing about itself:
 * "What's new in DevTools (Chrome 149)" is a change, from the team that made
 * it, and it reads to a classifier as an article. Sixty refusals in this
 * archive name a version like that.
 *
 * The distinction is the source, not the sentence. A project blog, a company
 * engineering channel and a release feed publish nothing but technology, so an
 * article from one is still about a stack. An outlet covering the industry
 * publishes funding rounds and breaches, and there the event test is the only
 * thing keeping the archive on subject.
 *
 * NOT a blanket pass. This is read after the off-topic gate and cannot reach
 * it, so a tech-only source blogging about its hiring is still refused. That
 * ordering is asserted in tests/own-channel.test.ts.
 *
 * Exported because the flag has to survive two separate SELECTs to get here,
 * and if either drops the column nothing errors -- the sources just go quiet
 * again.
 */
export function allowsArticles(
  source: { tech_only?: boolean | null; company_slug?: string | null },
): boolean {
  return Boolean(source.tech_only) || Boolean(source.company_slug);
}

export async function ingestItems(
  db: Db,
  source: SourceRow,
  items: FeedItem[],
  opts: IngestOptions,
): Promise<IngestResult> {
  const drops = new DropCounter();
  const storyByUrl = new Map<string, string>();
  const members: stories.MemberRow[] = [];
  let articleFetches = 0;
  let deadlineSkipped = 0;
  /** What this poll refused, flushed once at the end rather than per item. */
  const refusals: Refusal[] = [];
  const deadline = Date.now() + (opts.deadlineMs ?? DEFAULT_SOURCE_DEADLINE_MS);

  // The months that have already been reduced to monthly analysis. Read once
  // per source rather than per item, and only when a horizon might apply.
  const archived = await archivedMonths(db, opts);
  // Read once: both month gates below must ask the same window the same way.
  const keepMonths = getConfig().retention.keepMonths;

  // The topic filter runs on the feed's own text, before anything is fetched.
  // That is the point of putting it first: an item refused here costs one
  // regular expression instead of a page load, an extraction and four inserts.
  const topical = opts.topicFilter ?? getConfig().filters.topical;
  const eventsOnly = opts.eventsOnly ?? getConfig().filters.eventsOnly;
  const vocab = topical ? await topicVocabulary(db) : undefined;
  const rejects: stories.RejectRow[] = [];
  /** canonical URL -> what kind of event it is, carried to the INSERT below. */

  // --- 1. cheap gates and canonical URLs, no I/O ----------------------------
  const staged: { item: FeedItem; title: string; canonicalUrl: string;
                  eventKind: string }[] = [];

  // One address per item, computed across the whole batch rather than per item.
  // Four feeds in this registry give every item the same link and put the real
  // identity in the guid, which is what a guid is for. See itemurl.ts.
  const itemUrls = resolveItemUrls(items, source.feed_url ?? source.url ?? '');

  for (const [index, item] of items.entries()) {
    if (!item.link) { drops.record('no_link'); continue; }
    const title = opts.qualifyTitle ? opts.qualifyTitle(item.title) : item.title;
    if (!title.trim()) { drops.record('no_title'); continue; }
    const resolved = itemUrls[index];
    const canonical = resolved?.url ?? undefined;
    if (!canonical) { drops.record('no_link'); continue; }
    // An item whose address had to be disambiguated came off a listing, and
    // fetching a listing gives every item on it the same body. Treated as
    // complete for the same reason an adapter would say so. See ResolvedUrl.
    const fromListing = resolved!.fromListing;

    // Where the link POINTS, before anything about what it says.
    //
    // gateItem() asks this too, but it asks in step 4 -- after the page has
    // been fetched and extracted, which is most of the cost of collecting an
    // item this archive was never going to keep. An aggregator submits an
    // article from a general-news or consumer outlet and the whole pipeline
    // runs on it: 3,236 items in thirty days, 13.8% of everything collected.
    // The host is known here, so the refusal belongs here.
    if (getConfig().filters.offTopicHosts) {
      const host = domainOf(canonical);
      if (host && isOffTopicHost(host)) {
        drops.record('blocked_host');
        rejects.push({
          url: canonical, title, sourceId: source.id,
          category: 'off_topic_host', matched: host,
        });
        continue;
      }
    }

    // Two questions, in this order, both lexical and both auditable.
    //
    //   1. Is this about technology at all.        topical.ts
    //   2. Is it an EVENT or an article about one. eventful.ts
    //
    // The order is the cheap one first, and it also keeps the audit log
    // honest: a shopping listicle is refused as shopping rather than as an
    // article, which is the more useful thing to know when reading back.
    if (topical) {
      const verdict = judgeTopic(title, item.content || item.summary || '', {
        vocab, sourceKind: source.kind, sourceRoles: source.roles,
      });
      if (!verdict.keep) {
        drops.record('off_topic');
        rejects.push({
          url: canonical, title, sourceId: source.id,
          category: verdict.category!, matched: verdict.matched ?? null,
        });
        continue;
      }
    }

    // The archive collects what HAPPENS to a stack, a tool or a platform:
    // launches, releases, and material changes. An article about a technology
    // is not an event in its history, and articles are the bulk of what feeds
    // publish -- 86% of everything collected, measured over 40 days.
    const verdict = classifyEvent(title, {
      sourceKind: source.kind, firstParty: source.roles.includes('PRIMARY'),
    });
    // Kept whatever the classifier makes of the sentence, when the source
    // publishes nothing but technology. See allowsArticles above: this is a
    // property of the source, and it is why 412 of the 415 rows in the
    // registry may publish an article and three may not.
    // A repository's releases.atom is a build log, not an editorial channel.
    // Six consecutive YugabyteDB nightlies and an Elixir tag reading
    // "Automated release for latest v1.18" are not six-and-one pieces of news;
    // they are a machine writing to tags. Refused before the event test,
    // because they classify as releases and would otherwise sail through it.
    const noise = isBuildNoise(title, item.content || item.summary || '', {
      url: canonical, fromReleaseFeed: source.kind === 'releases',
    });
    if (noise.noise) {
      drops.record('build_noise');
      rejects.push({
        url: canonical, title, sourceId: source.id,
        category: `build:${noise.why}`, matched: null,
      });
      continue;
    }

    if (eventsOnly && !isEvent(verdict.kind) && !allowsArticles(source)) {
      drops.record('not_an_event');
      rejects.push({
        url: canonical, title, sourceId: source.id,
        category: 'article', matched: verdict.matched ?? null,
      });
      continue;
    }
    // A feed that still lists something from a month already rolled up. Keeping
    // it would put a story into a month whose totals are settled: the aggregate
    // does not count it, the history views deliberately skip it to avoid double
    // counting, and the next retention run deletes it. Three ways of being
    // invisible, for the cost of storing it. Dropped here, at the top, before
    // any page fetch.
    //
    // Both guards read the same window, so neither can refuse a month the other
    // is keeping. That was the July bug: this one closed July while retention
    // still held it, and nothing in either gate could see the disagreement.
    if (archived && isArchived(archived, item.publishedAt, keepMonths)) {
      drops.record('already_archived'); continue;
    }
    if (opts.collectionMode !== 'backfill'
        && isTooOld(item.publishedAt, keepMonths)) {
      drops.record('too_old'); continue;
    }
    staged.push({
      item: fromListing ? { ...item, complete: true } : item,
      title, canonicalUrl: canonical, eventKind: verdict.kind,
    });
  }

  // Every refusal comes from the loop above, so one flush here covers all of
  // them and the three return paths below do not each need to remember.
  await stories.recordRejects(db, rejects);

  if (staged.length === 0) {
    return { kept: 0, duplicates: 0, drops: drops.toJSON(), storyByUrl, articleFetches, deadlineSkipped };
  }

  // --- 2. one query: which URLs are already known ---------------------------
  const urlHashes = await Promise.all(staged.map((s) => sha256(s.canonicalUrl)));
  const known = await stories.findManyByUrl(db, urlHashes);

  // WHAT WAS ALREADY REFUSED, so it does not spend one of this poll's 25
  // article fetches proving the same thing again. See ./refused.ts: without
  // this, an unreadable item at the head of a feed takes a fetch slot on every
  // poll for ever and the source's capacity to contribute NEW stories falls
  // towards zero. The refusal expires; the source is never skipped.
  const refused = opts.rememberRefusals === false
    ? new Set<string>() : await stillRefused(db, urlHashes);

  const unknown: Candidate[] = [];
  staged.forEach((s, i) => {
    const hash = urlHashes[i]!;
    const existing = known.get(toHex(hash));
    if (!existing && refused.has(toHex(hash))) {
      // Counted under its own name rather than folded into the reason it was
      // originally refused for -- a drop chart that cannot tell "we looked and
      // said no" from "we said no last month" hides exactly the growth this
      // table exists to stop.
      drops.record('refused_before');
      return;
    }
    if (existing) {
      // Already held. No page fetch, no extraction, no hashing -- just a
      // membership row. This is the majority of every poll after the first.
      members.push({
        storyId: existing, sourceId: source.id, url: s.canonicalUrl,
        title: s.title, matchLayer: 1,
      });
      storyByUrl.set(s.canonicalUrl, existing);
      return;
    }
    unknown.push({
      item: s.item, title: s.title, canonicalUrl: s.canonicalUrl,
      urlHash: hash, arrivalHash: hash, eventKind: s.eventKind,
      bodyText: s.item.content || s.item.summary,
    });
  });

  // --- 3. fetch and extract the unknown ones, in parallel -------------------
  const maxFetches = opts.maxArticleFetches ?? 25;
  const concurrency = opts.articleConcurrency ?? getConfig().fetch.maxConcurrency;
  let budget = (opts.fetchArticles ?? true) ? maxFetches : 0;

  await mapWithConcurrency(unknown, concurrency, async (c) => {
    // Complete as delivered: there is no page behind this item, only the
    // listing it was split out of. Fetching that would give every item on the
    // page the same body and the same rel=canonical -- see FeedItem.complete.
    if (c.item.complete) return;
    if (checkLength(c.bodyText).passes) return;
    if (opts.isSelfDescribing?.(c.canonicalUrl)) return;
    if (budget <= 0) return;
    if (Date.now() > deadline) { deadlineSkipped++; return; }
    budget--;
    articleFetches++;

    await opts.politeness.wait(domainOf(c.canonicalUrl) ?? source.id, source.politeness_seconds * 1000);
    const page = await fetchConditional(c.canonicalUrl, {
      userAgent: opts.userAgent,
      timeoutMs: getConfig().fetch.timeoutMs,
    });
    if (page.kind !== 'ok') { c.pageBlocked = true; return; }

    const extracted = extractArticle(page.body, page.finalUrl);
    if (extracted.text.length > c.bodyText.length && !opts.looksLikeChrome?.(extracted.text)) {
      c.bodyText = extracted.text;
    }
    // A page's own rel=canonical beats the URL we arrived by.
    if (extracted.canonicalUrl && extracted.canonicalUrl !== c.canonicalUrl) {
      c.canonicalUrl = extracted.canonicalUrl;
      c.urlHash = await sha256(extracted.canonicalUrl);
    }
    if (!c.item.author && extracted.author) c.item.author = extracted.author;
    if (!c.item.publishedAt && extracted.publishedAt) c.item.publishedAt = extracted.publishedAt;
  });

  // --- 4a. one query: did the rewritten URLs turn out to be known -----------
  //
  // Step 2 asked about the URLs these items arrived by. Any item whose page
  // claimed a different canonical is now pointing somewhere that was never
  // looked up, and that somewhere is frequently a story already held -- which
  // is how the same article came to be stored eight times in one morning. The
  // question costs one query for the handful of items that were rewritten.
  const rewritten = unknown.filter((c) => toHex(c.arrivalHash) !== toHex(c.urlHash));
  const alreadyHeld = rewritten.length > 0
    ? await stories.findManyByUrl(db, rewritten.map((c) => c.urlHash))
    : new Map<string, string>();

  // --- 4. gate, then one query: which bodies are already known --------------
  const gated: { c: Candidate; lang: string; contentHash: Uint8Array }[] = [];
  for (const c of unknown) {
    const held = alreadyHeld.get(toHex(c.urlHash));
    if (held) {
      members.push({
        storyId: held, sourceId: source.id, url: c.canonicalUrl,
        title: c.title, matchLayer: 1,
      });
      storyByUrl.set(c.canonicalUrl, held);
      drops.record('duplicate_url');
      continue;
    }
    // THE LENGTH BAR MEASURES THE PUBLISHER, NOT THE WALL.
    //
    // openai.com answers 403 to this collector and its feed carries 110-160
    // character summaries, so every one of its 1,157 items failed the 400
    // character bar. Measured 2026-08-29: 8,097 `too_short` drops in a day,
    // 0 stories kept, none ever. The busiest field in the archive, and its
    // best-known source contributed nothing while reporting itself healthy.
    //
    // The shortness was ours, not theirs. When a CURATED FIRST-PARTY source
    // hands us a title and the page behind it refuses to be read, the title is
    // the record -- and classifyEvent() reads the title and nothing else, so
    // the item is still classified exactly as it would have been.
    //
    // The same argument RELEASE_MIN_LENGTH already makes for release feeds:
    // "release notes are events, not essays". This is the announcement case of
    // the same sentence.
    //
    // Deliberately narrow. It needs all three: the source is on the beat by
    // construction (`tech_only`, the same flag the own-channel rule reads), it
    // is the subject of its own announcement (PRIMARY), and the page was ASKED
    // FOR and REFUSED. A short item from a source that answered normally is
    // still short, and a walled source that is neither of the first two is
    // still held to the ordinary bar.
    const walledAnnouncement = c.pageBlocked === true
      && Boolean(source.tech_only) && source.roles.includes('PRIMARY');
    const minOverride = walledAnnouncement ? 0 : opts.minLength;
    const gate = gateItem(
      { ...c.item, link: c.canonicalUrl, title: c.title }, c.bodyText,
      minOverride === undefined ? {} : { minLengthOverride: minOverride },
    );
    if (!gate.keep) {
      drops.record(gate.reason!);
      // `page_blocked` rather than `too_short` when the page was asked for and
      // refused: the two want very different waits, and calling a 403 a short
      // article would sit on it for three weeks over a fault that is often gone
      // by tomorrow.
      refusals.push({
        urlHash: c.urlHash,
        url: c.canonicalUrl,
        reason: gate.reason === 'too_short' && c.pageBlocked === true
          ? 'page_blocked' : gate.reason!,
      });
      continue;
    }
    gated.push({ c, lang: gate.lang!, contentHash: await contentHash(c.title, c.bodyText) });
  }

  // One flush for the whole poll, here rather than at each return below, so
  // that the two exits cannot disagree about what was remembered.
  if (opts.rememberRefusals !== false) await remember(db, source.id, refusals);

  if (gated.length === 0) {
    await stories.addMembersBatch(db, members);
    return {
      kept: 0, duplicates: members.length, drops: drops.toJSON(),
      storyByUrl, articleFetches, deadlineSkipped,
    };
  }

  const knownContent = await stories.findManyByContent(db, gated.map((g) => g.contentHash));

  const fresh: typeof gated = [];
  for (const g of gated) {
    const existing = knownContent.get(toHex(g.contentHash));
    if (existing) {
      members.push({
        storyId: existing, sourceId: source.id, url: g.c.canonicalUrl,
        title: g.c.title, matchLayer: 1,
      });
      storyByUrl.set(g.c.canonicalUrl, existing);
      continue;
    }
    fresh.push(g);
  }

  // --- 5. insert everything new, in four queries ----------------------------
  const inserts: stories.StoryInsert[] = [];
  for (const g of fresh) {
    const sh = simhash(`${g.c.title} ${g.c.bodyText}`);
    const isEnglish = g.lang === 'en';
    inserts.push({
      canonicalUrl: g.c.canonicalUrl,
      urlHash: g.c.urlHash,
      contentHash: g.contentHash,
      titleOriginal: g.c.title,
      titleEn: isEnglish ? g.c.title : null,
      titleHashEn: isEnglish ? await sha256(normalizeForHash(g.c.title)) : null,
      summaryEn: isEnglish ? truncateSummary(g.c.bodyText) : null,
      author: g.c.item.author,
      sourceId: source.id,
      country: source.country,
      lang: g.lang,
      publishedAt: g.c.item.publishedAt,
      simhash: toSigned64(sh),
      simhashBands: simhashBands(sh),
      bodyChars: g.c.bodyText.length,
      outboundDomains: [...new Set(g.c.item.outboundLinks.map((l) => domainOf(l) ?? '').filter(Boolean))].slice(0, 20),
      collectionMode: opts.collectionMode ?? 'live',
      isPrerelease: opts.isPrerelease?.(g.c.item.title) ?? false,
      eventKind: g.c.eventKind,
    });
  }

  // Claim the addresses BEFORE writing anything under them.
  //
  // The URL is the story's identity, so a story that does not own its URL must
  // not exist. This used to run the other way round -- insert, then claim with
  // ON CONFLICT DO NOTHING -- and a claim that lost left its story behind: 70
  // rows in 1,272, always exactly twice, which is two polls racing rather than
  // a bad feed. See claimUrls.
  const claimed = await stories.claimUrls(db, inserts.map((i) => i.urlHash));
  const winners = inserts.filter((i) => claimed.has(toHex(i.urlHash)));
  for (const w of winners) w.id = claimed.get(toHex(w.urlHash));

  // Whoever already held an address gets a membership row instead of a second
  // copy: another poll reached this story first, which is exactly what layer 1
  // membership is for.
  const lost = inserts.filter((i) => !claimed.has(toHex(i.urlHash)));
  if (lost.length > 0) {
    const held = await stories.findManyByUrl(db, lost.map((l) => l.urlHash));
    for (const l of lost) {
      const owner = held.get(toHex(l.urlHash));
      if (!owner) continue;
      members.push({
        storyId: owner, sourceId: source.id, url: l.canonicalUrl,
        title: l.titleOriginal, matchLayer: 1,
      });
      storyByUrl.set(l.canonicalUrl, owner);
      drops.record('duplicate_url');
    }
  }

  const inserted = await stories.insertStories(db, winners);
  const byUrlHex = new Map(inserted.map((r) => [r.url_hex, r]));

  // A story that lands in a month whose rollup already ran leaves that month's
  // analysis understating it. Only reachable under KEEP_FOREVER, where a
  // settled month is open to ingest again -- see isArchived above.
  //
  // Marked rather than recomputed here: rolling a month is minutes of work over
  // every story in it, and a poll cycle is measured in seconds. The rollup job
  // reads `dirty_at` and clears it.
  if (archived) {
    const touched = new Set<string>();
    for (const g of fresh) {
      const when = g.c.item.publishedAt;
      if (when && archived.has(monthKey(when))) touched.add(monthKey(when));
    }
    if (touched.size > 0) {
      await db.query(
        `UPDATE rollup_log SET dirty_at = now()
          WHERE to_char(month, 'YYYY-MM') = ANY($1::text[]) AND dirty_at IS NULL`,
        [[...touched]]);
    }
  }

  const keys: stories.KeyRow[] = [];
  const jobRows: { type: string; storyId: string; priority: number }[] = [];

  for (const g of fresh) {
    const row = byUrlHex.get(toHex(g.c.urlHash));
    if (!row) continue; // a same-batch duplicate URL; the first one won
    storyByUrl.set(g.c.canonicalUrl, row.id);

    // The URL key is the identity of the story and is always written: it is what
    // stops the same article being stored twice.
    keys.push({ hash: g.c.urlHash, kind: 'url', storyId: row.id, collectedAt: row.collected_at });

    // And a second key for the URL it arrived by, when the page's rel=canonical
    // disagreed with the feed. Both are real addresses for this story, both are
    // how it will be offered again tomorrow, and storing only the tidier one is
    // what made the next poll believe it had found something new. Writing both
    // is the fix; step 4a above is the safety net for what is already stored.
    if (toHex(g.c.arrivalHash) !== toHex(g.c.urlHash)) {
      keys.push({
        hash: g.c.arrivalHash, kind: 'url', storyId: row.id, collectedAt: row.collected_at,
      });
    }

    // The content and title keys are for CROSS-SOURCE dedup -- the same story
    // under two URLs from two outlets, which is the normal case in live
    // collection and the reason coverage_count means anything.
    //
    // A backfill is one provider walked backwards, already unique by its own
    // id, so those two keys buy almost nothing and cost 400 bytes a story: at
    // three keys each they were the second-largest table in the database. On a
    // few million rows of history that is the difference between an archive
    // that fits and one that does not. Live collection is untouched.
    const crossSource = opts.collectionMode !== 'backfill';
    if (crossSource) {
      keys.push({
        hash: g.contentHash, kind: 'content', storyId: row.id, collectedAt: row.collected_at,
      });
    }
    if (g.lang === 'en') {
      if (crossSource) {
        keys.push({
          hash: await sha256(normalizeForHash(g.c.title)),
          kind: 'title_en', storyId: row.id, collectedAt: row.collected_at,
        });
      }
    } else {
      // Non-English titles are translated first: cross-language dedup depends on it.
      jobRows.push({ type: 'translate_title', storyId: row.id, priority: 3 });
    }
    // Classification is an LLM call. Live collection is a few hundred stories a
    // day and worth judging; a backfill is hundreds of thousands, and enqueuing
    // one call each quietly commits a budget nobody agreed to -- 73,418 were
    // pending before this line existed. The per-project association that
    // analysis actually needs comes from the deterministic tagger instead,
    // which reads the same vocabulary and costs nothing.
    //
    // And nothing is queued at all while classification is switched off. That
    // sounds obvious and was not being done: with CLASSIFICATION_ENABLED=false
    // the queue still grew by one row per story and nothing ever read it --
    // 23,693 rows of work for a step that cannot run. A queue nobody drains is
    // not a backlog, it is a leak, and it is worse than empty because it makes
    // the job table look busy while saying nothing about what is actually
    // pending.
    //
    // The cost of not queuing is that turning the gate on later starts from
    // now rather than from the archive. That is the right default: the stories
    // worth an editorial judgement are the recent ones, and `npm run process`
    // can always sweep what is already stored.
    const classifiable = getConfig().gates.classificationEnabled
      && (opts.collectionMode !== 'backfill' || getConfig().gates.backfillClassify);
    if (classifiable) {
      jobRows.push({ type: 'classify', storyId: row.id, priority: 4 });
    }
  }

  // A coverage curve measures how a story SPREADS after it breaks, sampled at
  // +1h, +6h, +24h and +7d. For something published a year ago every one of
  // those moments passed before this system had heard of it, and capturing one
  // now would write today's outlet count into a column labelled "+1h" -- not a
  // missing measurement but a false one, and one that silently poisons every
  // curve average drawn over the archive.
  //
  // It is also the difference between a large archive and an unusable one: the
  // backfill had already queued 179,188 of these for stories older than a
  // month, four rows and a scheduled job apiece, none of which can ever say
  // anything true.
  //
  // Keyed on the story's age, not on how it arrived: a live poll picking up a
  // month-old blog post has exactly the same problem.
  const offsets = getConfig().schedule.snapshotOffsetHours;
  const widestMs = Math.max(0, ...offsets) * 3600_000;
  const curveable = inserted.filter((r) => {
    const g = fresh.find((x) => byUrlHex.get(toHex(x.c.urlHash))?.id === r.id);
    const published = g?.c.item.publishedAt ?? null;
    return !published || Date.now() - published.getTime() <= widestMs;
  });

  await Promise.all([
    stories.registerKeysBatch(db, keys),
    stories.scheduleSnapshotsBatch(
      db,
      curveable.map((r) => ({ id: r.id, collectedAt: r.collected_at })),
      offsets,
    ),
    stories.enqueueBatch(db, jobRows),
  ]);

  await stories.addMembersBatch(db, members);

  return {
    kept: inserted.length,
    duplicates: members.length,
    drops: drops.toJSON(),
    storyByUrl,
    articleFetches,
    deadlineSkipped,
  };
}

export type { DropReason };

/**
 * The archive horizon, exposed for tests.
 *
 * archivedMonths() needs a database; isArchived() is the decision, and the
 * decision is the part with edge cases -- an undated item, a month boundary, a
 * month that is rolled while a later one is not.
 */
export const __test = { isArchived, isTooOld };

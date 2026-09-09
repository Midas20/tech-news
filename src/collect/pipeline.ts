// One source, one poll. Phase 1 in its entirety:
//
//   fetch -> parse -> gate -> extract -> hash -> dedup layer 1 -> store
//
// No classification, no scoring, no model call anywhere in this file. That is
// the point of running Phase 1 alone for a week: dead feeds, encoding problems
// and volume surprises surface while the pipeline is still cheap to change.

import type { Db } from '../db/client.ts';
import type { SourceRow } from '../db/repos/sources.ts';
import * as sources from '../db/repos/sources.ts';
import { fetchConditional, discoverFeedLinks, COMMON_FEED_PATHS, type PolitenessGate } from './fetcher.ts';
import { parseFeed } from './feed.ts';
import { isPodcastFeed, DropCounter } from './filters.ts';
import { ingestItems } from './ingest.ts';
import { adapterFor, isPlanned } from './adapters.ts';
import { recordEngagement } from '../process/snapshot.ts';
import { registrableDomain, domainOf } from '../lib/url.ts';

export interface CollectOptions {
  userAgent?: string;
  politeness: PolitenessGate;
  collectionMode?: 'live' | 'backfill';
  /** Fetch the article page when the feed body is too thin to judge. */
  fetchArticles?: boolean;
  /**
   * Only consider the newest N items of a feed.
   *
   * Feeds are newest-first, so this bounds CPU per source without losing
   * anything: whatever is trimmed is older than what was taken, and the next
   * poll sees it again if it is still in the window. The Worker needs this --
   * parsing and hashing 150 items in one invocation exceeds its CPU allowance.
   */
  maxItemsPerSource?: number;
  maxArticleFetches?: number;
  now?: () => Date;
}

export interface CollectSummary {
  sourceId: string;
  itemsSeen: number;
  itemsKept: number;
  duplicates: number;
  drops: Record<string, number>;
  error: string | null;
}

export async function collectSource(
  db: Db,
  source: SourceRow,
  opts: CollectOptions,
): Promise<CollectSummary> {
  const drops = new DropCounter();
  const empty = (error: string | null): CollectSummary => ({
    sourceId: source.id, itemsSeen: 0, itemsKept: 0, duplicates: 0,
    drops: drops.toJSON(), error,
  });

  // API sources have no feed to parse; each needs its own adapter.
  if (source.feed_kind === 'api') return collectViaAdapter(db, source, opts, drops);

  const feedUrl = source.feed_url ?? (await resolveFeedUrl(db, source, opts));
  if (!feedUrl) {
    await sources.recordFailure(db, source.id, 'no feed could be discovered', source.poll_interval_seconds);
    await sources.logFetch(db, {
      sourceId: source.id, status: null, durationMs: 0, bytes: 0, itemsSeen: 0,
      itemsKept: 0, notModified: false, error: 'no feed discovered', dropReasons: {},
    });
    return empty('no feed discovered');
  }

  await opts.politeness.wait(domainOf(feedUrl) ?? source.id, source.politeness_seconds * 1000);

  const res = await fetchConditional(feedUrl, {
    etag: source.last_etag,
    lastModified: source.last_modified,
    userAgent: opts.userAgent,
  });

  if (res.kind === 'not_modified') {
    await sources.recordNotModified(db, source.id, source.poll_interval_seconds);
    await sources.logFetch(db, {
      sourceId: source.id, status: 304, durationMs: res.durationMs, bytes: 0,
      itemsSeen: 0, itemsKept: 0, notModified: true, error: null, dropReasons: {},
    });
    return empty(null);
  }

  if (res.kind === 'rate_limited') {
    // Back off past the window the server asked for, and do not count it as a
    // failure -- a 429 is the source working correctly, not breaking.
    const wait = res.retryAfterSeconds ?? source.poll_interval_seconds * 2;
    await db.query(
      `UPDATE sources SET last_fetch_at = now(),
              next_fetch_at = now() + make_interval(secs => $2) WHERE id = $1`,
      [source.id, wait],
    );
    await sources.logFetch(db, {
      sourceId: source.id, status: res.status, durationMs: res.durationMs, bytes: 0,
      itemsSeen: 0, itemsKept: 0, notModified: false, error: 'rate limited', dropReasons: {},
    });
    return empty('rate limited');
  }

  if (res.kind === 'error') {
    await sources.recordFailure(db, source.id, res.error, source.poll_interval_seconds);
    await sources.logFetch(db, {
      sourceId: source.id, status: res.status, durationMs: res.durationMs, bytes: 0,
      itemsSeen: 0, itemsKept: 0, notModified: false, error: res.error, dropReasons: {},
    });
    return empty(res.error);
  }

  const parsed = parseFeed(res.body, feedUrl);
  if (!parsed) {
    await sources.recordFailure(db, source.id, 'unparseable feed', source.poll_interval_seconds);
    await sources.logFetch(db, {
      sourceId: source.id, status: res.status, durationMs: res.durationMs, bytes: res.bytes,
      itemsSeen: 0, itemsKept: 0, notModified: false, error: 'unparseable feed', dropReasons: {},
    });
    return empty('unparseable feed');
  }

  // A MIXED FEED IS FILTERED, NOT SILENCED.
  //
  // This used to pause the whole source when more than half its items carried a
  // media enclosure, on the reasoning that dropping items one at a time "would
  // still leave the source polled forever". That traded a few wasted polls for
  // every future post the source ever makes, and the trade is not worth it:
  // gate() at filters.ts already refuses an item with a media enclosure on its
  // own, so a feed that mixes a podcast with written posts loses the episodes
  // and keeps the posts. Pausing loses both, permanently, on the strength of
  // one poll's worth of items.
  //
  // Removed on 2026-09-09, asked for as "I want to filter articles not block
  // sources". The ratio is still measured, but it is now a fact recorded about
  // a source rather than a sentence passed on it -- a source whose output is
  // mostly media is visible on /admin/sources and can be paused by a person
  // who has looked at it.
  const mediaShare = isPodcastFeed(parsed.items);

  // One batched call for the whole feed. See ingest.ts for why: the per-item
  // path cost six round trips per story and fetched pages one at a time.
  const items = opts.maxItemsPerSource
    ? parsed.items.slice(0, opts.maxItemsPerSource)
    : parsed.items;

  const result = await ingestItems(db, source, items, {
    politeness: opts.politeness,
    userAgent: opts.userAgent,
    collectionMode: opts.collectionMode,
    fetchArticles: opts.fetchArticles,
    maxArticleFetches: opts.maxArticleFetches,
    qualifyTitle: (t) => (source.kind === 'releases' ? qualifyReleaseTitle(t, source.name) : t),
    // A release IS the event; its notes are often two lines. Judge it as an
    // article and the whole primary-source layer silently produces nothing.
    minLength: source.kind === 'releases' ? RELEASE_MIN_LENGTH : undefined,
    isPrerelease: (t) => source.kind === 'releases' && isPrereleaseTitle(t),
    isSelfDescribing,
    looksLikeChrome,
  });

  const kept = result.kept;
  const duplicates = result.duplicates;
  for (const [reason, count] of Object.entries(result.drops)) {
    for (let i = 0; i < count; i++) drops.record(reason as never);
  }

  const candidateDomains = new Map<string, string>();
  for (const item of parsed.items) {
    for (const link of item.outboundLinks) {
      const host = domainOf(link);
      if (!host) continue;
      const reg = registrableDomain(host);
      if (reg === registrableDomain(domainOf(source.url) ?? '')) continue;
      if (!candidateDomains.has(reg)) candidateDomains.set(reg, link);
    }
  }

  await sources.recordCandidateDomains(
    db, source.id,
    [...candidateDomains].map(([domain, sampleUrl]) => ({ domain, sampleUrl })),
  );

  await sources.recordSuccess(db, source.id, {
    etag: res.etag, lastModified: res.lastModified, intervalSeconds: source.poll_interval_seconds,
  });

  await sources.logFetch(db, {
    sourceId: source.id, status: res.status, durationMs: res.durationMs, bytes: res.bytes,
    itemsSeen: parsed.items.length, itemsKept: kept, notModified: false, error: null,
    dropReasons: {
      ...drops.toJSON(),
      duplicate: duplicates,
      ...(result.deadlineSkipped ? { deadline_skipped: result.deadlineSkipped } : {}),
      // Recorded, not acted on. A source whose items are mostly audio or video
      // is worth a person's attention on /admin/sources; it is not worth
      // silencing on the evidence of one poll.
      ...(mediaShare ? { mostly_media: parsed.items.length } : {}),
    },
  });

  return {
    sourceId: source.id,
    itemsSeen: parsed.items.length,
    itemsKept: kept,
    duplicates,
    drops: drops.toJSON(),
    error: null,
  };
}

/**
 * The API path. Same gates, same dedup, same storage -- only the item source
 * differs. An API source with no adapter is paused with a reason rather than
 * retried forever against a shape the feed parser cannot read.
 */
async function collectViaAdapter(
  db: Db,
  source: SourceRow,
  opts: CollectOptions,
  drops: DropCounter,
): Promise<CollectSummary> {
  const adapter = adapterFor(source.name);
  if (!adapter) {
    const reason = isPlanned(source.name)
      ? 'adapter not implemented yet'
      : 'api source with no adapter';
    await sources.pauseSource(db, source.id, reason);
    await sources.logFetch(db, {
      sourceId: source.id, status: null, durationMs: 0, bytes: 0, itemsSeen: 0,
      itemsKept: 0, notModified: false, error: reason, dropReasons: {},
    });
    return { sourceId: source.id, itemsSeen: 0, itemsKept: 0, duplicates: 0, drops: {}, error: reason };
  }

  const started = Date.now();
  let result_raw;
  try {
    await opts.politeness.wait(domainOf(source.url) ?? source.id, source.politeness_seconds * 1000);
    result_raw = await adapter({}, { userAgent: opts.userAgent });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sources.recordFailure(db, source.id, message, source.poll_interval_seconds);
    await sources.logFetch(db, {
      sourceId: source.id, status: null, durationMs: Date.now() - started, bytes: 0,
      itemsSeen: 0, itemsKept: 0, notModified: false, error: message, dropReasons: {},
    });
    return { sourceId: source.id, itemsSeen: 0, itemsKept: 0, duplicates: 0, drops: {}, error: message };
  }

  const result = await ingestItems(db, source, result_raw.items, {
    politeness: opts.politeness,
    userAgent: opts.userAgent,
    collectionMode: opts.collectionMode,
    fetchArticles: opts.fetchArticles,
    maxArticleFetches: opts.maxArticleFetches,
    // The same guards the feed path uses. Leaving them off here is why summaries
    // reading "Uh oh! There was an error while loading. Please reload this page.
    // owner / repo Public Notifications You must be signed in to change
    // notification settings" reached the reader: this path serves the link
    // aggregators, whose items are overwhelmingly links to GitHub repositories,
    // and a repository page has no article for an extractor to find.
    isSelfDescribing,
    looksLikeChrome,
    // The same three the feed path applies, and they were missing here.
    //
    // A source is 'releases' or it is not; which code path happened to read it
    // is not a fact about the source. Without these, an adapter-backed release
    // channel was judged by the ordinary length floor while a feed-backed one
    // was not -- measured on Google Cloud, 136 of 338 release notes refused as
    // `too_short` purely for arriving through this function instead of the
    // other one. A release IS the event; its notes are often two lines.
    qualifyTitle: (t) => (source.kind === 'releases' ? qualifyReleaseTitle(t, source.name) : t),
    minLength: source.kind === 'releases' ? RELEASE_MIN_LENGTH : undefined,
    isPrerelease: (t) => source.kind === 'releases' && isPrereleaseTitle(t),
  });
  const kept = result.kept;
  const duplicates = result.duplicates;
  const storyByUrl = result.storyByUrl;
  for (const [reason, count] of Object.entries(result.drops)) {
    for (let i = 0; i < count; i++) drops.record(reason as never);
  }

  // Engagement is captured at observation time and stored per type -- points and
  // comments never share a column (spec 1.3).
  const engagementRows = result_raw.engagement
    .map((e) => {
      const storyId = storyByUrl.get(e.url);
      return storyId ? { storyId, type: e.type, value: e.value, sourceId: source.id } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (engagementRows.length > 0) await recordEngagement(db, engagementRows);

  await sources.recordSuccess(db, source.id, {
    etag: null, lastModified: null, intervalSeconds: source.poll_interval_seconds,
  });
  await sources.logFetch(db, {
    sourceId: source.id, status: 200, durationMs: Date.now() - started, bytes: 0,
    itemsSeen: result_raw.items.length, itemsKept: kept, notModified: false, error: null,
    dropReasons: { ...drops.toJSON(), duplicate: duplicates },
  });

  return {
    sourceId: source.id, itemsSeen: result_raw.items.length, itemsKept: kept,
    duplicates, drops: drops.toJSON(), error: null,
  };
}

// The per-item ingest path that used to live here has been replaced by the
// batched one in ingest.ts. It is gone rather than kept behind a flag: two paths
// through the collector would drift, and only one of them was measured.

/**
 * Feeds whose entries are already the full artefact. Fetching the page behind
 * them replaces good content with navigation.
 */
const SELF_DESCRIBING = [
  'github.com', 'gitlab.com', 'news.ycombinator.com', 'lobste.rs',
  'sourceforge.net', 'bitbucket.org',
];

export function isSelfDescribing(url: string): boolean {
  const host = domainOf(url);
  if (!host) return false;
  return SELF_DESCRIBING.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Boilerplate an extractor grabs when a page has no article: sign-in prompts,
 * cookie banners, star counts. Cheap to detect, and the alternative is storing
 * it in a permanent archive.
 */
const CHROME_MARKERS = [
  'you must be signed in',
  'there was an error while loading',
  'please reload this page',
  'enable javascript',
  'javascript is disabled',
  'accept all cookies',
  'sign in to continue',
  'are you a robot',
  'access denied',
  // A GitHub repository page rendered without its README. The header survives
  // and the content does not, so the summary becomes a notification-settings
  // prompt with a slash in it.
  'change notification settings',
  'notifications you must be',
  'fork your own copy',
  'this repository was archived by the owner',
  // ...and the file browser underneath it, which is what is left once the
  // header is stripped away: "BranchesTagsOpen more actions menuLatest commit
  // History7 Commits7 CommitsFolders and filesNameName".
  'folders and files',
  'latest commit history',
  'open more actions menu',
  'branchestags',
];

export function looksLikeChrome(text: string): boolean {
  const head = text.slice(0, 600).toLowerCase();
  return CHROME_MARKERS.some((m) => head.includes(m));
}

/**
 * The same boilerplate, removed from the front of text already stored.
 *
 * looksLikeChrome() decides whether to accept an extraction at all; this
 * salvages the ones that were accepted before the guard covered them. The
 * distinction matters because most of these pages do carry real prose after the
 * chrome -- a repository's description and README -- so dropping the whole
 * summary would lose more than it fixes.
 *
 * Nothing here is clever. Each pattern is a specific sentence GitHub emits,
 * anchored to the start, applied repeatedly until none matches. Anything that
 * cannot be identified confidently is left exactly as it was.
 */
const CHROME_PREFIXES: RegExp[] = [
  /^\s*uh oh!?\s*/i,
  /^\s*there was an error while loading\.?\s*/i,
  /^\s*please reload this page\.?\s*/i,
  /^\s*this repository was archived by the owner on [^.]+\.\s*/i,
  /^\s*it is now read-only\.?\s*/i,
  /^\s*[\w.-]+\s*\/\s*[\w.-]+\s+public(\s+archive)?\s*/i,
  /^\s*forked from\s+[\w.-]+\/[\w.-]+\s*/i,
  /^\s*notifications?\s*/i,
  /^\s*you must be signed in to change notification settings\.?\s*/i,
  /^\s*fork your own copy of [\w.-]+\/[\w.-]+\s*/i,
  /^\s*(star|fork|watch)\s+[\d.,km]+\s*/i,
];

export function stripChrome(text: string): string {
  let out = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of CHROME_PREFIXES) {
      const next = out.replace(p, '');
      if (next !== out) { out = next; changed = true; }
    }
  }
  return out.trim();
}

function safeJoin(base: string, path: string): string | null {
  try {
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}

/**
 * A release feed entry is titled with its tag and nothing else: "v4.2.0-rc4".
 * That is unreadable in a river of hundreds of stories from hundreds of
 * projects, so the source supplies the subject the feed left out.
 */
// A tag is any title with no whitespace in it, not just a bare version number.
//
// `^v?\d...` covered "v4.2.0" and missed everything a monorepo publishes:
// `pkg/machinery/v1.13.9`, `@sveltejs/package@3.0.0-next.7`, `client/v2.4.1`.
// Measured on the first poll of the derived feeds, those are a large minority of
// all release titles, and each one arrived in the river naming no project at all.
//
// A release title that is a SENTENCE is left alone -- "Kubernetes 1.32: Penelope"
// already says what it is. A title with no space is a tag, and a tag needs its
// subject supplied.
const TAG_TITLE = /^\S+$/;

/**
 * Release notes are events, not essays -- and a great many of them are a title
 * and nothing else.
 *
 * This was 60 characters, which sounds generous until the feeds are measured.
 * Of the first-party channels in the registry, four carry NO body text at all:
 *
 *   Vercel changelog      1,524 entries, 100% empty
 *   Notion releases         149 entries, 100% empty
 *   Apache Kafka tags        10 entries, 100% empty
 *   Git tags                 10 entries, 100% empty
 *
 * "Muse Image now available on AI Gateway", published by Vercel, dated, linked:
 * that is the whole event, and a 60-character minimum threw away every one of
 * them. The pages behind them are client-rendered, so the article fetch that
 * rescues a short press item returns nothing here either.
 *
 * So the floor for a release feed is zero, and the justification is the format's
 * contract rather than generosity: every entry in a release feed IS a release,
 * which is why classifyEvent takes the source's word for it and never reads the
 * title. A gate that drops the entry has overruled that contract on the strength
 * of a byte count.
 *
 * This does NOT skip enrichment. The article fetch in ingest step 3 is driven by
 * `checkLength` against the ordinary 400-character bar, so a release whose page
 * does have notes still gets them; what changed is only what happens when there
 * is nothing to find.
 */
export const RELEASE_MIN_LENGTH = 0;

export function qualifyReleaseTitle(title: string, sourceName: string): string {
  const tag = title.trim();
  if (!TAG_TITLE.test(tag)) return title;
  const project = sourceName.replace(/\s+(releases|tags)$/i, '').trim();
  if (!project) return title;
  // Some feeds already name themselves in the tag -- "next.js@16.4.0". Prefixing
  // those produces "Next.js next.js@16.4.0", which is worse than doing nothing.
  if (tag.toLowerCase().includes(project.toLowerCase())) return title;
  return `${project} ${tag}`;
}

/** Release candidates, alphas, betas and nightlies are not news. */
const PRERELEASE = /(^|[-\s.])(rc|alpha|beta|preview|pre|nightly|snapshot|canary)\d*($|[-\s.])/i;

/**
 * Build artefacts wearing a release's clothes.
 *
 * A GitHub releases feed carries whatever the project tags, and for a great
 * many projects that is continuous integration output rather than anything a
 * human announced. Measured on one hour of collection: Kotlin published twelve
 * `build-2.5.0-dev-5797` tags, llama.cpp published `b10635`, PyTorch published
 * `viable/strict/1787738484`, YugabyteDB published `2025.2.7.0-b28`.
 *
 * None of them is a release in the sense that matters here -- nobody upgrades
 * to `b10635`, and no history of a technology contains it. They were reaching
 * the archive as first-class events because PRERELEASE above looks for the
 * words alpha, beta and rc, and a build number contains none of them.
 *
 * Kept as "prerelease" rather than given a new column: the existing flag
 * already means "not a stable release anyone should read as news", every read
 * path already honours it, and a CI tag is the purest example of the category.
 */
const BUILD_ARTEFACT = [
  // dev builds: build-2.5.0-dev-5797, 1.2.0.dev3
  /(^|[-\s.])dev\d*($|[-\s.])/i,
  // a bare build number as the whole title: b10635, build 4521
  /^\s*(b|build[-\s]?)\d{3,}\s*$/i,
  // a build suffix on an otherwise ordinary version: 2025.2.7.0-b28
  /\d+\.\d+[\d.]*-b\d+/i,
  // CI refs and bare timestamps: viable/strict/1787738484, 20260826.3
  /(^|[-\s/])(viable|strict|ci|main|master|head|untagged)[-\s/]/i,
  /(^|[-\s/])\d{9,}($|[-\s/])/,
  // Explicit non-release tags some projects publish.
  /(^|[-\s.])(dirty|wip|test|debug|unstable|edge)($|[-\s.])/i,
];

export function isPrereleaseTitle(title: string): boolean {
  const t = title.trim();
  return PRERELEASE.test(t) || BUILD_ARTEFACT.some((p) => p.test(t));
}

/**
 * Feed autodiscovery, run once per source and then stored. Hardcoding feed URLs
 * guarantees breakage: sites move them, and the registry would rot silently.
 */
async function resolveFeedUrl(db: Db, source: SourceRow, opts: CollectOptions): Promise<string | null> {
  await opts.politeness.wait(domainOf(source.url) ?? source.id, source.politeness_seconds * 1000);
  const res = await fetchConditional(source.url, { userAgent: opts.userAgent });
  if (res.kind !== 'ok') return null;

  const advertised = discoverFeedLinks(res.body, res.finalUrl);
  for (const candidate of [...advertised, ...COMMON_FEED_PATHS.map((p) => safeJoin(source.url, p))]) {
    if (!candidate) continue;
    const probe = await fetchConditional(candidate, { userAgent: opts.userAgent });
    if (probe.kind !== 'ok') continue;
    const parsed = parseFeed(probe.body, candidate);
    if (parsed && parsed.items.length > 0) {
      const claimed = await sources.setFeedUrl(db, source.id, candidate,
        parsed.format === 'jsonfeed' ? 'jsonfeed' : parsed.format);
      // Another source already owns this feed; this one is now paused.
      return claimed ? candidate : null;
    }
  }
  return null;
}

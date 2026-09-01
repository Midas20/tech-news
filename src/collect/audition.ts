// Judging a source that is not in the registry yet.
//
// AUDITION, NEVER ARGUMENT. A source is not admitted because it sounds
// important, or because somebody listed it. Its live feed is fetched, every
// item goes through the whole gauntlet in memory -- host, topic, build noise,
// event class, language, length -- and a number comes out the other side.
//
// The gauntlet here is the one ingestItems() runs, in ingest's order, calling
// the same functions, including the page fetch ingest does when a feed body is
// too short to judge. Nothing is relaxed for a candidate. That is the whole of
// "the rule that avoids noise is stable": the filters do not move, the registry
// grows to what those filters can already read.
//
// Shared by `npm run audition`, which asks about a list somebody wrote, and by
// the `sources` job, which asks about domains the archive found by itself. One
// copy, because two would drift and the second one would be the one making
// decisions unattended.

import { parseFeed, type FeedItem } from './feed.ts';
import { judgeTopic, isTechnicalTitle } from './topical.ts';
import { classifyEvent, isEvent } from './eventful.ts';
import { isBuildNoise } from '../vocab/buildnoise.ts';
import { gateItem } from './filters.ts';
import { extractArticle } from './extract.ts';
import { checkLength } from '../lib/text.ts';
import { detectStacks } from '../process/tagstacks.ts';
import type { StackVocabulary } from '../process/tagstacks.ts';

/** The window that decides. See WHY_90_DAYS. */
export const AUDITION_WINDOW_MS = 90 * 864e5;

/**
 * THE NUMBER THAT DECIDES IS THE LAST 90 DAYS, NOT THE LIFETIME.
 *
 * Several feeds carry their whole archive. blog.ethereum.org offered 636 items
 * and three of them were recent; ranked on lifetime output it was the strongest
 * candidate seen, at 33x its real rate. A dormant blog with a long memory beats
 * a live one on any all-time count, so every number here is the recent one.
 */
export const WHY_90_DAYS = true;

export interface AuditionResult {
  feed: string | null;
  /** Items the feed carries at all, which is how to read the rest. */
  offered: number;
  /** Items in the window, capped by `sample`. */
  recent: number;
  /** In-window items carrying no date. Ingest keeps these, so they are counted. */
  undated: number;
  kept: number;
  /** Of the kept, how many name a technology or read like engineering. */
  technical: number;
  reasons: Map<string, number>;
  keptTitles: string[];
  /** Registrable domain of every sampled item's link, and how often it appeared. */
  linkDomains: Map<string, number>;
}

/**
 * The registrable domain of a URL: blog.rust-lang.org and www.rust-lang.org
 * both answer rust-lang.org. Naive, and deliberately so -- it is comparing two
 * hosts with each other, not resolving a public suffix list.
 */
export function registrable(u: string): string | null {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return host.split('.').slice(-2).join('.') || null;
  } catch { return null; }
}

/**
 * HOW SCATTERED A FEED'S LINKS ARE, WHICH IS HOW A LINKBLOG IS RECOGNISED.
 *
 * A publisher's items all land on one domain -- whichever domain that is.
 * Stripe's feed is registered under stripe.com and publishes on stripe.dev, so
 * "does the link match the homepage" is the wrong question and answers 0% for a
 * perfectly good first party. "Do the links agree with EACH OTHER" is the right
 * one, and it needs no homepage at all.
 *
 * Measured across the whole registry over 120 days: 100 of 103 sources put
 * every story on a single domain. The exceptions are Google DeepMind (5 domains
 * across 283 stories) and Notion (2 across 439) -- companies with more than one
 * property, still ~2% scatter. Daring Fireball sat at 55%: eleven domains in
 * twenty items, which is not a company with properties, it is a linkblog.
 *
 * The gap between 2% and 55% is where the cap goes.
 */
export function scatter(r: AuditionResult): number {
  let items = 0;
  for (const n of r.linkDomains.values()) items += n;
  return items ? r.linkDomains.size / items : 0;
}

/**
 * A third of the sampled items arriving from different domains means the feed
 * is recommending other people's writing, not publishing its own.
 *
 * This is the gate that PRIMARY needed and did not have. The tracked channel
 * grants PRIMARY "by construction", reasoning that a domain which IS the
 * vocabulary entry must be a first party writing about its own work -- and
 * PRIMARY is the flag that RELAXES the topic filter. daringfireball.net is the
 * home of Markdown and is not Markdown's release channel, and the promotion
 * brought in American cheese, a Trump story and a McSweeney's satire within the
 * hour. By construction was an assumption; this is the measurement.
 */
export const SCATTER_CAP = 1 / 3;

/** Below this many items, scatter says nothing. See looksLikeLinkblog. */
export const SCATTER_MIN_ITEMS = 6;

/**
 * Whether a feed is recommending other people's writing rather than publishing.
 *
 * Two guards around the ratio, both of them protecting the honest end:
 *
 *   - A SMALL SAMPLE CANNOT BE SCATTERED. Scatter is distinct domains over
 *     items, so a perfectly good first party with two recent posts scores 50%
 *     on one domain and would be thrown out by the ratio alone. Under six
 *     items the question is not asked; the feed still has to clear KEEP_BAR.
 *
 *   - ONE OR TWO DOMAINS IS A COMPANY, NOT A LINKBLOG. Notion publishes across
 *     notion.so and notion.com. Stripe's feed is registered under stripe.com
 *     and its posts land on stripe.dev. Whatever the ratio says at small
 *     sample sizes, a feed whose links agree on two names is not scattered.
 *
 * The case this is here to catch had ten domains in twelve items.
 */
export function looksLikeLinkblog(r: AuditionResult): boolean {
  let items = 0;
  for (const n of r.linkDomains.values()) items += n;
  if (items < SCATTER_MIN_ITEMS) return false;
  if (r.linkDomains.size <= 2) return false;
  return scatter(r) > SCATTER_CAP;
}

export interface AuditionOptions {
  site: string;
  /** A first party writing about its own work; changes how topic judges it. */
  primary: boolean;
  vocab: StackVocabulary | undefined;
  userAgent: string;
  /** Most recent N in-window items. Each can cost a page fetch. */
  sample?: number;
  /** Pause between item fetches, per feed. */
  politenessMs?: number;
  /**
   * Model a source filed with `tech_only = true`.
   *
   * That flag is badly named -- what it does is `allowsArticles()`, and with
   * EVENTS_ONLY on (the default) it is the difference between a publication
   * being read and being dropped whole. A vendor blog does not need it; a
   * newsroom is nothing but articles, so without it Krebs on Security scores
   * 0 of 10 and every refusal reads `not_an_event`.
   */
  allowArticles?: boolean;
}

interface Fetched { ok: boolean; body: string; type: string }

async function get(u: string, userAgent: string): Promise<Fetched> {
  try {
    const res = await fetch(u, {
      headers: {
        'user-agent': userAgent,
        accept: 'application/rss+xml,application/atom+xml,text/html,*/*',
      },
      signal: AbortSignal.timeout(15_000),
    });
    return {
      ok: res.ok,
      body: res.ok ? await res.text() : '',
      type: res.headers.get('content-type') ?? '',
    };
  } catch { return { ok: false, body: '', type: '' }; }
}

/** Feed paths worth trying when a site advertises none. */
const GUESSES = [
  '/feed', '/feed/', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml',
  '/blog/rss.xml', '/blog/feed', '/blog/feed.xml', '/blog/index.xml',
  '/news/rss.xml', '/blog/atom.xml', '/rss/index.xml', '/feed.rss',
  '/feeds/posts/default', '/blog/rss/', '/api/rss', '/blog.rss',
];

/**
 * The feed a site advertises, or the first guess that parses.
 *
 * Asking the page costs one request and is right far more often than a list of
 * paths: half of these sites use a path nobody would guess. The guesses are the
 * fallback, not the method.
 */
export async function findFeed(site: string, userAgent: string): Promise<string | null> {
  if (/\.(xml|atom|rss)$/.test(site)) return site;

  const page = await get(site, userAgent);
  // Ask whether the thing handed over IS a feed before treating it as a page.
  // The file extension is a different question: simonwillison.net serves Atom
  // from /atom/everything/ with no extension, and testing the suffix reported
  // "no feed" for a feed already downloaded and parsed.
  if (page.ok && parseFeed(page.body, site)?.items?.length) return site;

  if (page.ok && page.type.includes('html')) {
    for (const tag of page.body.match(/<link[^>]+>/gi) ?? []) {
      if (!/rel=["']?alternate/i.test(tag)) continue;
      if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href) continue;
      try {
        const abs = new URL(href, site).toString();
        const probe = await get(abs, userAgent);
        if (probe.ok && parseFeed(probe.body, abs)?.items?.length) return abs;
      } catch { /* try the next one */ }
    }
  }

  const bases = new Set<string>();
  try { bases.add(new URL('/', site).toString()); } catch { /* malformed */ }
  bases.add(site.endsWith('/') ? site : `${site}/`);
  for (const base of bases) {
    for (const path of GUESSES) {
      let u: string;
      try { u = new URL(path.replace(/^\//, ''), base).toString(); } catch { continue; }
      const r = await get(u, userAgent);
      if (!r.ok) continue;
      if (parseFeed(r.body, u)?.items?.length) return u;
    }
  }
  return null;
}

/**
 * THE PAGE FETCH, WHICH THE FIRST VERSION OF THIS LEFT OUT.
 *
 * Its absence did not make the audition slightly pessimistic, it inverted the
 * answer. Most feeds carry one line of description, so judging on the feed body
 * alone refuses nearly everything for length: OpenAI's feed scored 0 of 142
 * with 104 refused as `too_short`, LangChain 0 of 100, vLLM 0 of 33 -- all of
 * them sources ingest keeps, because ingest goes and reads the page.
 *
 * A lazy harness does not produce a slightly wrong number. It produces a
 * confident rejection.
 */
async function bodyFor(item: FeedItem, userAgent: string): Promise<string> {
  const feedBody = item.content || item.summary || '';
  if (checkLength(feedBody).passes) return feedBody;
  if (item.complete || !item.link) return feedBody;

  const page = await get(item.link, userAgent);
  if (!page.ok || !page.type.includes('html')) return feedBody;
  const extracted = extractArticle(page.body, item.link);
  return extracted.text.length > feedBody.length ? extracted.text : feedBody;
}

/** Every gate ingest applies, in ingest's order, on one item. */
function runGauntlet(
  item: FeedItem, primary: boolean, body: string, vocab: StackVocabulary | undefined,
  allowArticles = false,
): { keep: boolean; why: string } {
  if (!item.link) return { keep: false, why: 'no_link' };
  if (!item.title?.trim()) return { keep: false, why: 'no_title' };

  const roles = primary ? ['CONTENT', 'PRIMARY'] : ['CONTENT'];

  const topic = judgeTopic(item.title, body, { vocab, sourceKind: 'news', sourceRoles: roles });
  if (!topic.keep) return { keep: false, why: `off_topic:${topic.category}` };

  const noise = isBuildNoise(item.title, body, { url: item.link });
  if (noise.noise) return { keep: false, why: `build:${noise.why}` };

  // Judged as it would be FILED. Everything admitted here is filed
  // tech_only=false, which is the setting under which an article is an article.
  // Auditioning under the generous flag and filing under the strict one is how
  // a source looks better on paper than it turns out to be.
  const event = classifyEvent(item.title, { sourceKind: 'news', firstParty: primary });
  // ingest: `if (eventsOnly && !isEvent(kind) && !allowsArticles(source))`.
  // The third clause is the one modelled here.
  if (!isEvent(event.kind) && !allowArticles) return { keep: false, why: 'not_an_event' };

  const gate = gateItem(item, body);
  if (!gate.keep) return { keep: false, why: gate.reason ?? 'gate' };

  return { keep: true, why: event.kind };
}

export async function auditionFeed(opts: AuditionOptions): Promise<AuditionResult> {
  const r: AuditionResult = {
    feed: null, offered: 0, recent: 0, undated: 0, kept: 0, technical: 0,
    reasons: new Map(), keptTitles: [], linkDomains: new Map(),
  };
  r.feed = await findFeed(opts.site, opts.userAgent);
  if (!r.feed) return r;

  const got = await get(r.feed, opts.userAgent);
  const items = (parseFeed(got.body, r.feed)?.items ?? []) as FeedItem[];
  r.offered = items.length;

  // An undated item is NOT skipped: ingest keeps it, because isTooOld() is
  // false without a published_at. Dropping it here would under-report a feed
  // whose only fault is not stamping its entries.
  const cutoff = Date.now() - AUDITION_WINDOW_MS;
  const inWindow = items.filter((i) => !i.publishedAt || i.publishedAt.getTime() >= cutoff);
  r.undated = inWindow.filter((i) => !i.publishedAt).length;

  const sample = inWindow.slice(0, opts.sample ?? 30);
  r.recent = sample.length;
  for (const item of sample) {
    // Recorded for every sampled item, not only the kept ones: whether a feed
    // links away from itself is a property of the feed, and the items the
    // gauntlet refuses are evidence about it too.
    const dom = item.link ? registrable(item.link) : null;
    if (dom) r.linkDomains.set(dom, (r.linkDomains.get(dom) ?? 0) + 1);

    const body = await bodyFor(item, opts.userAgent);
    const v = runGauntlet(item, opts.primary, body, opts.vocab, opts.allowArticles);
    if (v.keep) {
      r.kept++;
      const named = opts.vocab
        ? detectStacks(item.title, opts.vocab, { max: 1 }).length > 0
        : false;
      if (named || isTechnicalTitle(item.title)) r.technical++;
      if (r.keptTitles.length < 4) r.keptTitles.push(item.title);
    } else {
      r.reasons.set(v.why, (r.reasons.get(v.why) ?? 0) + 1);
    }
    if (opts.politenessMs) await new Promise((f) => setTimeout(f, opts.politenessMs));
  }
  return r;
}

/**
 * Three kept in ninety days.
 *
 * Deliberately low, and it is a rate rather than a volume: a feed exposing ten
 * items that keeps nine of them compounds, because the collector polls it again
 * tomorrow. Crunchbase News kept 2 of the 10 it offers and is a better bet than
 * a 600-item archive feed yielding 3.
 */
export const KEEP_BAR = 3;

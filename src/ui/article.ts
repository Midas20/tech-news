// Reading an article without leaving the river.
//
// The archive stores links and derived metadata, never bodies (spec 0), and that
// does not change here: this fetches the page when someone asks for it, hands
// the text to that one reader, and keeps it only in memory for a few minutes so
// re-opening the same story does not hit the publisher again. Nothing is written
// to the database, and the modal says where the text came from with the original
// link one click away -- the point is to save a tab, not to become the source.
//
// What is sent to the browser is TEXT in typed blocks, never third-party HTML.
// No markup from a publisher's page reaches the page the operator is looking at,
// so there is no sanitizer to get subtly wrong.

import { one } from './db.ts';
import { fetchConditional, PolitenessGate, type FetchOutcome } from '../collect/fetcher.ts';
import { extractReadable, type Block } from '../collect/extract.ts';
import { getConfig } from '../config.ts';

export interface ArticlePayload {
  id: string;
  title: string;
  url: string;
  host: string;
  source: string;
  author: string | null;
  published: string | null;
  words: number;
  blocks: Block[];
  /** Set when the page could not be read; the modal shows this and links out. */
  problem?: string;
  /** Where the text came from, when it is not the page itself. */
  origin?: string;
  thin?: boolean;
}

interface StoryRow {
  id: string;
  title: string;
  url: string;
  source: string;
  published: string | null;
  summary: string | null;
  /** CHARACTERS the collector read at the time -- see migration 0067. The yardstick below. */
  bodyChars: number | null;
}

/**
 * A small, short-lived in-process cache. Ten minutes is long enough that reading
 * one story, closing it and reopening it costs one fetch, and short enough that
 * nothing here is a copy of anybody's archive.
 */
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 60;
const cache = new Map<string, { at: number; value: ArticlePayload }>();

const politeness = new PolitenessGate(1500);

/**
 * The reading request is not a crawl.
 *
 * A crawler identifies itself as one and takes what it is given. This is a
 * person clicking "read" on one article they were already shown a link to, from
 * their own machine, once -- so it asks the way their browser would, including
 * the referer their browser would send. Plenty of publishers refuse a bare
 * library user agent with a 403 and serve the identical page to a normal one;
 * npmjs.com is one of them.
 */
const BROWSER_HEADERS: Record<string, string> = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
};

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

/** Statuses that mean "not like that" rather than "not at all". */
const WORTH_RETRYING = new Set([401, 403, 406, 409, 418, 451, 429]);

function remember(id: string, value: ArticlePayload): ArticlePayload {
  cache.set(id, { at: Date.now(), value });
  if (cache.size > MAX_ENTRIES) {
    // Oldest insertion first: Map preserves it, so one shift is enough.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function describe(outcome: FetchOutcome, host: string): string {
  if (outcome.kind === 'rate_limited') {
    return `${host} is rate-limiting requests right now.`;
  }
  if (outcome.kind === 'not_modified') return 'The page returned no content.';
  if (outcome.kind !== 'error') return 'The page returned no content.';

  switch (outcome.status) {
    case 401:
    case 403:
      return `${host} refuses automated readers. Its content is only served to a real browser session.`;
    case 404:
    case 410:
      return `The page is gone from ${host} — the link was collected when it still resolved.`;
    case 451:
      return `${host} blocks this page for legal reasons in this region.`;
    case null:
      return `Could not reach ${host}: ${outcome.error}.`;
    default:
      return `${host} answered HTTP ${outcome.status}.`;
  }
}

async function attempt(url: string, browserLike: boolean, timeoutMs: number): Promise<FetchOutcome> {
  const config = getConfig();
  let referer: string | undefined;
  try {
    referer = `${new URL(url).origin}/`;
  } catch { /* a malformed URL fails on its own below */ }

  return fetchConditional(url, {
    userAgent: browserLike ? BROWSER_UA : config.fetch.userAgent,
    timeoutMs,
    accept: BROWSER_HEADERS.accept,
    headers: browserLike ? { ...BROWSER_HEADERS, ...(referer ? { referer } : {}) } : {},
  });
}

/**
 * Does this page say it is an error rather than an article?
 *
 * Read from the TITLE and the first block only. A real article about HTTP
 * status codes says "404" in its body all day; an error page says it where its
 * headline goes.
 */
const ERROR_PAGE = new RegExp('^\\s*(4\\d\\d|5\\d\\d)[.:\\s-]'
  + '|\\b(page |file )?not found\\b'
  + '|\\bthat.?s an error\\b'
  + '|\\berror \\d{3}\\b'
  + '|\\b(access denied|forbidden|page unavailable)\\b', 'i');

function looksLikeAnErrorPage(title: string | null, blocks: { text: string }[]): boolean {
  if (title && ERROR_PAGE.test(title)) return true;
  const first = blocks[0]?.text ?? '';
  return ERROR_PAGE.test(first.slice(0, 120));
}

export async function readArticle(id: string): Promise<ArticlePayload | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const story = await one<StoryRow>(
    `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title,
            s.canonical_url AS url, src.name AS source, s.summary_en AS summary,
            s.body_chars AS "bodyChars",
            coalesce(s.published_at, s.collected_at)::text AS published
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE s.id = $1::uuid`,
    [id],
  );
  if (!story) return null;

  const host = hostOf(story.url);
  const base: ArticlePayload = {
    id: story.id, title: story.title, url: story.url, host,
    source: story.source, author: null, published: story.published,
    words: 0, blocks: [],
  };

  const timeoutMs = Math.min(getConfig().fetch.timeoutMs, 15_000);
  await politeness.wait(host);

  let outcome = await attempt(story.url, false, timeoutMs);

  // A refusal aimed at the user agent is worth one second attempt, asked the way
  // a browser asks. One retry, never a loop: if a publisher means it, it means it.
  if ((outcome.kind === 'error' || outcome.kind === 'rate_limited')
      && outcome.status !== null && WORTH_RETRYING.has(outcome.status)) {
    await politeness.wait(host);
    outcome = await attempt(story.url, true, timeoutMs);
  }

  if (outcome.kind !== 'ok') {
    return remember(id, fallback(base, describe(outcome, host), story.summary));
  }

  // A PDF or an image parsed as HTML yields plausible-looking nonsense, which is
  // worse than saying what it is.
  const type = (outcome.contentType ?? '').toLowerCase();
  if (type && !type.includes('html') && !type.includes('xml') && !type.includes('text/plain')) {
    const kind = type.split(';')[0] ?? type;
    return remember(id, fallback(base, `That link is ${kind}, not an article.`, story.summary));
  }

  const readable = extractReadable(outcome.body, outcome.finalUrl);
  if (readable.blocks.length === 0) {
    return remember(id, fallback(
      base,
      'Nothing readable on the page — it is probably rendered by JavaScript, or behind a wall.',
      story.summary,
    ));
  }

  // THE ARCHIVE OUTRANKS THE LIVE PAGE.
  //
  // A 200 is not a promise that the article is still there. Reported
  // 2026-08-29: a Google Cloud Blog post stored with a real headline and 4,099
  // words rendered here as
  //
  //   title:  "Google Cloud Blog"
  //   body:   404. That's an error. The requested URL ... was not found
  //   words:  26
  //
  // Google had moved the post and served an error page whose og:title is the
  // site name. Every one of those three fields came from the live fetch and
  // overwrote a correct record. The page is a VIEW onto a request; when the
  // request stops agreeing with the archive, the archive is the thing that was
  // verified once and the request is the thing that just failed.
  if (looksLikeAnErrorPage(readable.title, readable.blocks)) {
    return remember(id, fallback(
      base,
      'That link now returns an error page — the publisher has moved or removed it.',
      story.summary,
    ));
  }

  // A page that yields a fraction of what was collected is not that article any
  // more: a consent wall, a login, a stub left behind by a move. Only checked
  // when the archive has a substantial reading to compare against, because a
  // genuinely short post must stay readable.
  //
  // BOTH SIDES IN CHARACTERS. The archive's number always was characters; this
  // compared it against WORDS, so `readable.words < archived * 0.25` held for
  // any prose in any language -- six characters to the word means the live page
  // has to come back at four times its real length to clear a bar that was
  // meant to catch a page coming back at a quarter of it. Reported 2026-08-29
  // on an InfoQ story that fetched perfectly:
  //
  //   "Only 561 words came back from a page the archive read as 3,769
  //    — it is probably behind a wall now."
  //
  // 561 words IS 3,769 characters. Every article long enough to be worth
  // reading tripped it, which is why the reading page had been showing the
  // stored summary instead of the article and saying a wall was the reason.
  //
  // The floor moves 300 -> 1,800 for the same reason: it was written to mean
  // "about three hundred words of archived reading", and three hundred words is
  // eighteen hundred characters. The bar has not moved, only its unit.
  const archived = story.bodyChars ?? 0;
  const liveChars = readable.blocks.reduce((n, b) => n + b.text.length, 0);
  if (archived >= 1800 && liveChars < archived * 0.25) {
    return remember(id, fallback(
      base,
      `Only ${liveChars.toLocaleString('en-US')} characters came back from a page the `
        + `archive read as ${archived.toLocaleString('en-US')} — it is probably behind `
        + 'a wall now.',
      story.summary,
    ));
  }

  return remember(id, {
    ...base,
    // The stored title, always. It was taken from the feed at collection time,
    // it is what the reader clicked, and a live page can only contradict it --
    // never improve on it. `readable.title` is how "Google Cloud Blog" replaced
    // a real headline.
    title: base.title,
    author: readable.author,
    published: readable.publishedAt ? readable.publishedAt.toISOString() : base.published,
    words: readable.words,
    blocks: readable.blocks,
    thin: readable.thin,
  });
}

/**
 * When the page cannot be read, show what the archive already knows instead of
 * an empty box. It is a summary rather than the article, and says so -- the
 * failure is still reported, because pretending a summary is the piece is how a
 * reader stops trusting the tool.
 */
function fallback(base: ArticlePayload, problem: string, summary: string | null): ArticlePayload {
  if (!summary) return { ...base, problem };
  return {
    ...base,
    problem,
    origin: 'This is the stored summary, not the article.',
    blocks: [{ kind: 'p', text: summary }],
    words: summary.split(/\s+/).length,
  };
}

/** The page-is-an-error test, exposed so tests can hold it without a network. */
export const __test = { looksLikeAnErrorPage };

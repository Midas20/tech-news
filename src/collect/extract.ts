// Boilerplate stripping. Plain code, zero inference cost -- this runs on all
// 5,000-8,000 items a day and a model must never touch it (spec 4.1).
//
// Note what this is FOR. No article body is ever stored, so extraction quality
// only has to be good enough to (a) hash content consistently, (b) apply the
// length gate honestly, and (c) give the summarizer something to work from. It
// does not have to reproduce the article.

import { parseHTML } from 'linkedom';

// linkedom's DOM is not the DOM in @cloudflare/workers-types (where `Element` is
// an HTMLRewriter handle). Derive the types from linkedom itself so the code
// keeps its guarantees under both type sets.
type LdDocument = ReturnType<typeof parseHTML>['document'];
type LdElement = NonNullable<ReturnType<LdDocument['querySelector']>>;
import { normalize, wordCount } from '../lib/text.ts';
import { canonicalizeUrl } from '../lib/url.ts';

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'form',
  'iframe', 'svg', 'button', '[role="navigation"]', '[role="banner"]',
  '[role="complementary"]', '.advertisement', '.ad', '.share', '.social',
  '.newsletter', '.related', '.comments', '.cookie', '.paywall',
];

/**
 * Sentences that are the page talking about itself.
 *
 * These arrive as their own block-level elements, so they are matched WHOLE and
 * never as a substring: an article paragraph is never exactly "Uh oh!", but
 * plenty of articles contain the word "loading". Matching the entire block is
 * what makes this safe to run on every site rather than only on GitHub.
 *
 * A GitHub release page is the case that forced it. Its notes are exactly the
 * content this system exists to collect -- a changelog, written by the people
 * who cut the release -- and they arrive behind eight lines of furniture:
 *
 *   Uh oh! / There was an error while loading. Please reload this page. /
 *   Notifications You must be signed in to change notification settings /
 *   Fork 4.6k / Star 30k / Choose a tag to compare / Sorry, something went
 *   wrong. / No results found
 *
 * The banner is emitted by the server on every render, error or not. It is not
 * a failure and reloading does not remove it, so a reader is being told to fix
 * something that is not broken.
 *
 * Removed from the DOM rather than from the text, which is why it lives here
 * and not in a post-processing pass: pickContainer() feeds BOTH the collector's
 * flat text and the reading page's blocks, so one removal fixes the summary and
 * the article together. It also runs before densityScore(), so furniture can no
 * longer help a navigation block win the container vote.
 */
const FURNITURE = new Set([
  'uh oh',
  'there was an error while loading',
  'there was an error while loading. please reload this page',
  'please reload this page',
  'sorry, something went wrong',
  'something went wrong, please refresh the page to try again',
  'no results found',
  'choose a tag to compare',
  "you can't perform that action at this time",
  'notifications you must be signed in to change notification settings',
  'you must be signed in to change notification settings',
]);

/** The same thing where a number makes the exact text unpredictable. */
const FURNITURE_PATTERNS: RegExp[] = [
  /^(star|fork|watch)\s+[\d.,]+\s*[km]?$/,
  /^\d[\d,.]*\s+commits?$/,
  // The way back, which is not part of the way in.
  //
  // Zig opens every post with "<- Back to News page" and Hugging Face with
  // "Back to Articles", both INSIDE the element that holds the article, so no
  // container choice can leave them behind -- and both were still arriving in
  // new rows after the container work was done: 74 and 72 of them, growing.
  //
  // The destination list is closed on purpose. A whole block reading "back to
  // basics" is a heading somebody wrote; a whole block reading "back to the
  // news page" is a link out. Naming the eight places a site links back TO is
  // what keeps those apart, and a leading arrow or bracket is allowed because
  // that is how the link is usually drawn.
  /^[^\w]{0,3}back to (the )?(news|articles?|blog|index|home|top|overview|list)( page)?$/,
];

const FURNITURE_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, div, span, strong, em, a';

/**
 * Lowercase, one-spaced, straight quotes, no trailing punctuation.
 *
 * Orphaned punctuation is closed up as well, because the banner is not one
 * element: it is `<p>There was an error while loading. <a>Please reload this
 * page</a>.</p>`. Take the link out and the paragraph left behind reads "There
 * was an error while loading. ." -- still furniture, no longer an exact match
 * for anything. Closing the gap is what lets the parent be recognised on the
 * next pass.
 */
function furnitureKey(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([.!,;:…])/g, '$1')
    .trim()
    .replace(/[.!…\s]+$/, '');
}

function isFurniture(text: string): boolean {
  const key = furnitureKey(text);
  if (!key || key.length > 90) return false;
  return FURNITURE.has(key) || FURNITURE_PATTERNS.some((p) => p.test(key));
}

/**
 * Drop the furniture, innermost first.
 *
 * Depth order matters: a <div> wrapping nothing but the banner has the banner's
 * exact text too, and removing the wrapper first would take a sibling with it if
 * one existed. Removing the leaf and letting the empty wrapper stand is the
 * conservative direction.
 */
function removeFurniture(document: LdDocument): void {
  // Repeated until nothing moves: removing a child changes what its parent
  // says, and the parent has already been passed by the time that happens.
  // Three rounds is more than the deepest nesting seen; the guard is the
  // stable check, the count only stops a pathological document.
  for (let round = 0; round < 3; round++) {
    let removed = 0;
    const els = Array.from(document.querySelectorAll(FURNITURE_SELECTOR)) as LdElement[];
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (!el.parentNode) continue;
      if (!isFurniture(el.textContent ?? '')) continue;
      el.remove();
      removed++;
    }
    if (removed === 0) return;
  }
}

const CONTENT_SELECTORS = [
  'article', 'main', '[role="main"]', '.post-content', '.entry-content',
  '.article-body', '.article-content', '.post-body', '#content', '.content',
];

export interface Extracted {
  title: string | null;
  text: string;
  author: string | null;
  canonicalUrl: string | null;
  publishedAt: Date | null;
  outboundLinks: string[];
  words: number;
}

/**
 * Strip the chrome and return the element most likely to be the article body.
 * Mutates the document, which is fine: nothing else reads it afterwards.
 */
function pickContainer(document: LdDocument, narrow = true): LdElement | null {
  for (const sel of STRIP_SELECTORS) {
    for (const el of Array.from(document.querySelectorAll(sel)) as LdElement[]) el.remove();
  }
  removeFurniture(document);

  let best: { el: LdElement; score: number } | null = null;
  for (const sel of CONTENT_SELECTORS) {
    for (const el of Array.from(document.querySelectorAll(sel)) as LdElement[]) {
      const score = densityScore(el);
      if (!best || score > best.score) best = { el, score };
    }
  }
  // The generic scan runs whenever the semantic winner is weak -- and "weak"
  // now means weak in PROSE, so a 15k-character navigation wrapper no longer
  // clears the bar on the strength of its scripts. The article this was written
  // for lives in a div with no recognised class at all.
  if (!best || best.score < 600) {
    for (const el of Array.from(document.querySelectorAll('div, section, td')) as LdElement[]) {
      const score = densityScore(el);
      if (!best || score > best.score) best = { el, score };
    }
  }
  const winner = best?.el ?? (document.body as LdElement | null);
  if (!winner) return null;
  return narrow ? narrowToArticle(winner) : winner;
}

export function extractArticle(html: string, pageUrl: string): Extracted {
  const { document } = parseHTML(html);
  const container = pickContainer(document);
  const text = normalize(container?.textContent ?? '');

  return {
    title: metaContent(document, 'og:title') ?? (normalize(document.title ?? '') || null),
    text,
    author:
      metaContent(document, 'article:author') ??
      metaName(document, 'author') ??
      null,
    canonicalUrl: resolveCanonical(document, pageUrl),
    publishedAt: parseMetaDate(
      metaContent(document, 'article:published_time') ??
        metaName(document, 'date') ??
        document.querySelector('time[datetime]')?.getAttribute('datetime') ??
        null,
    ),
    outboundLinks: collectLinks(container, pageUrl),
    words: wordCount(text),
  };
}

/**
 * Text length minus link text length. Navigation blocks are mostly anchors, so
 * subtracting link text is what separates a sidebar from a body.
 */
/**
 * How much of this element is PROSE.
 *
 * The first version scored `total textContent - links + paragraphs`, and total
 * textContent is the wrong measure: it counts inline scripts, JSON-LD, poll
 * widgets, cookie text and anything else the page happens to carry, so a
 * navigation wrapper beats an article whenever the wrapper is bigger.
 *
 * The New Stack is the case that forced this. On
 * thenewstack.io/zai-glm-weights-license the article sits in
 * `<div id="tns-post-body-content">` -- 19 paragraphs, 7,919 characters, and
 * matching NONE of CONTENT_SELECTORS. The only selector that matched anything
 * was `.content`, a wrapper holding 15,736 characters of script and furniture
 * and exactly five paragraphs of newsletter signup. It scored 15,449 against
 * the article's ~8,300 and won, so the reader showed:
 *
 *   We're so glad you're here. You can expect all the best TNS content ...
 *   Check your inbox for a confirmation email ...
 *   Become a TNS follower on LinkedIn.
 *
 * 83 words of chrome under a headline about a licence change -- which is one of
 * the highest-value classes this archive collects.
 *
 * Counting only text inside block elements fixes it without a site rule: the
 * newsletter wrapper's 15k characters stop counting because they are not in
 * paragraphs, and the article's 19 paragraphs do.
 *
 * `tr` and `td` are in the list for the reason BLOCK_SELECTOR has them: LWN's
 * "Security updates for Thursday" is a table with no <p> in it, and dropping
 * table text here would score every candidate on that page at zero and pick one
 * at random.
 */
const PROSE_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, pre, tr, td';

/**
 * A block too short to be a sentence is a label, and labels are not prose.
 *
 * Decrypt is the case that forced this, reported 2026-08-30. Its story pages
 * carry a price ticker along the top, and every entry in it is marked up as its
 * own `<article>`:
 *
 *                    blocks   prose chars   blocks >= 40 chars   score
 *   the ticker         497        2,975              0          13,945
 *   the article         13        2,362             11           2,524
 *
 * "BTC$77,828.00-0.28%" is nineteen characters. Four hundred and ninety-seven
 * of them collect 12,425 points of `blocks x 25` -- a bonus meant to reward
 * genuinely dense structure, which instead handed a scrolling price bar five
 * times the score of the article it sits above. The reader got the ticker.
 *
 * The bonus was the visible defect but not the whole one: the ticker's raw
 * character count is comparable to the article's, so counting all text in all
 * blocks leaves the two within a factor of two of each other on any page whose
 * ticker is slightly longer. Both the characters and the count now come only
 * from blocks that could be a sentence, which prices a ticker at what it is:
 * nothing.
 *
 * FORTY, because of LWN. "Security updates for Thursday" is a table with no
 * <p> in it, and its rows read "AlmaLinux ALSA-2026:60215 9 assertj-core
 * 2026-08-27" -- about fifty characters. The floor has to sit under a table row
 * that is genuinely the content and over a price chip that never is, and the
 * gap between nineteen and fifty is where it goes.
 */
const SENTENCE_CHARS = 40;

/** The blocks of an element that are long enough to be prose. */
function proseBlocks(el: LdElement): LdElement[] {
  const out: LdElement[] = [];
  for (const b of Array.from(el.querySelectorAll(PROSE_SELECTOR)) as LdElement[]) {
    if ((b.textContent ?? '').length >= SENTENCE_CHARS) out.push(b);
  }
  return out;
}

function densityScore(el: LdElement): number {
  const blocks = proseBlocks(el);
  let proseChars = 0;
  for (const b of blocks) proseChars += (b.textContent ?? '').length;

  let linkChars = 0;
  for (const a of Array.from(el.querySelectorAll('a')) as LdElement[]) {
    linkChars += (a.textContent ?? '').length;
  }
  // Nested blocks double-count -- a <li> inside a <td> is both -- which is
  // acceptable and even useful: it rewards genuinely dense structure. The link
  // penalty is what stops a list of headlines beating an article.
  return proseChars - linkChars * 1.5 + blocks.length * 25;
}

/**
 * How much prose is inside this element, measured in WORDS.
 *
 * Words rather than characters, and that is not a detail. Under characters the
 * Ruby 3.2.11 release page collapsed from 278 words to 68: its download block
 * is a list of SHA-256 digests, and a digest is 64 characters of one word, so
 * the hashes outweighed the release notes roughly three to one and the descent
 * walked straight into them. Counting words prices a digest at what it is worth
 * to a reader, which is about the same as "the".
 *
 * Descendants only -- querySelectorAll never returns the element itself -- so a
 * <p> reports zero. That is what stops the walk from stepping inside a
 * paragraph and discarding the text the paragraph holds.
 */
function proseWords(el: LdElement): number {
  let n = 0;
  for (const b of proseBlocks(el)) n += wordCount(b.textContent ?? '');
  return n;
}

/**
 * Prose this element owns DIRECTLY, rather than through a wrapper.
 *
 * The test for "am I the body, or am I the box the body came in". A wrapper
 * holds divs; a body holds paragraphs.
 */
const OWNS_PROSE = new Set(['P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4',
                            'PRE', 'TABLE', 'OL', 'UL', 'DL', 'DD', 'FIGURE']);

function ownProse(el: LdElement): number {
  let n = 0;
  for (const child of Array.from(el.children) as LdElement[]) {
    if (!OWNS_PROSE.has(child.tagName ?? '')) continue;
    const text = child.textContent ?? '';
    if (text.length < SENTENCE_CHARS) continue;
    n += wordCount(text);
  }
  return n;
}

/**
 * THE VOTE CAN ONLY EVER GROW, SO THE WINNER IS USUALLY THE PAGE.
 *
 * densityScore() is a total, and a parent contains everything its children
 * contain -- so an ancestor scores at least as much as the article inside it,
 * every time. The only thing pushing back is the link penalty, which is why
 * this survived so long: on most sites the chrome IS links, the penalty pays
 * for the extra text, and the article wins by accident rather than on purpose.
 *
 * InfoQ is the case that forced it. Its chrome is PROSE -- a byline, a
 * conference promo, "Related Sponsors" and a paragraph of sponsor copy -- and
 * prose does not pay the link penalty. So `div.infoq`, which is the entire
 * page, beat `div.article__data`, which is the article, and the 2026-08-27
 * story was stored as
 *
 *   word_count: 3,769
 *   summary:    "InfoQ Homepage News Google Cloud Launches ... Follow us on
 *                Youtube232K Followers Linkedin26K Followers InstagramNew
 *                RSS19K Readers X57.1k Followers Facebook21K Likes BlueskyNew"
 *
 * for an article of 503 words. Note the penalty was not merely insufficient
 * here, it was BACKWARDS: the follower counts and the related-article headlines
 * are links, so the furniture discounted itself, while the article body -- which
 * cites its sources -- paid full price for doing so.
 *
 * The repair walks DOWN from the winner while one child still holds most of the
 * prose. Descent stops where the prose splits between siblings, which is where
 * the article ends and the furniture around it begins:
 *
 *   div.infoq            6,255  ->  main                    0.96
 *   ...                             (four wrappers at 1.00)
 *   div.article__main    5,712  ->  div.article__content    0.64
 *   div.article__content 3,680  ->  div.article__data       0.86
 *   div.article__data    3,168  ->  blockquote              0.14   stop
 *
 * A share, not a score. "Most of this element's prose is in one place" is a
 * fact about distribution, and no amount of tuning a total can express it.
 *
 * THE FLOOR IS WHAT KEEPS THE LEDE. A share alone will follow a long table or
 * changelog down and leave the announcement above it behind -- Debian 13.5
 * lost its release announcement to its own package table, and Node.js 25.4.0
 * lost "Notable Changes" to its commit list, both by the same move. So the walk
 * stops the moment an element owns 60 words of prose itself: an element with
 * its own paragraphs is a body, and descending past a body discards text that
 * belongs to it.
 *
 * Sixty is measured, and it started at forty -- tuned against ONE InfoQ story.
 * A second InfoQ story showed why one page is not enough: there
 * `div.article__main` owns 43 words of byline and "Follow us on Youtube232K
 * Followers Linkedin26K Followers" directly. That is furniture which happens to
 * be long enough to clear a sentence floor, so the walk stopped on top of it
 * and the follower counts came back. Across 89 pages only two are sensitive to
 * this number at all -- InfoQ and developer.chrome.com -- and both want 60 or
 * more, while Debian and Node.js are unmoved anywhere between 40 and 120. Sixty
 * is the smallest value that fixes both, which keeps the walk as short as the
 * evidence allows.
 *
 * Verified across 89 pages, one per host, old container against new on the same
 * HTML. Ruby and Netlify now END on the article's last paragraph instead of a
 * related-posts rail, and Apple's press release stops being counted twice.
 *
 * THE SHARE IS A TUNED CONSTANT, NOT A PRINCIPLE, and the window it has to sit
 * in is six points wide. Measured, as the tightest step each page needs or must
 * be denied:
 *
 *   must descend   InfoQ            0.85     chrome, prose, wrapped in wrappers
 *                  archlinux, Ruby  0.75     a title-and-date line above the body
 *                  Cointelegraph    0.72     a byline block above the body
 *   ----------------------------------------- 0.70
 *   must NOT       Hugging Face     0.66     a comment thread beside a short post
 *
 * The Hugging Face wall is the one to know about. On a short post with a busy
 * discussion the COMMENTS hold more prose than the article, so the walk will
 * happily descend into them and leave the post behind -- which it did, on
 * huggingface.co/blog/ggml-joins-hf, until the share moved 0.6 -> 0.7. There is
 * no structural tell to lean on instead: the container is Tailwind utilities
 * with no class worth matching, and the obvious idea -- "the article is the
 * part holding the <h1>" -- is false on exactly the pages this exists to fix,
 * because InfoQ and Cointelegraph put the headline in a SIBLING of the body.
 * Tried, measured, and it broke both of them.
 *
 * The limit this leaves, stated exactly: a discussion at 0.66 no longer WINS,
 * but it still BLOCKS. No child clears the share, so the walk stops at the
 * wrapper holding nav, article and comments together, and a Hugging Face post
 * keeps its "Back to Articles" prefix -- which is what it did before any of
 * this, so nothing regressed, but nothing improved either. Past 0.7 the thread
 * wins outright again. Both walls are held by tests/extract-container.test.ts,
 * so moving this number means answering them.
 */
const NARROW_SHARE = 0.7;
const OWN_PROSE_FLOOR = 60;

function narrowToArticle(el: LdElement): LdElement {
  let cur = el;
  // The deepest chain seen is nine; the bound only stops a pathological
  // document, and reaching it returns the element it reached.
  for (let depth = 0; depth < 16; depth++) {
    if (ownProse(cur) >= OWN_PROSE_FLOOR) return cur;

    const total = proseWords(cur);
    if (total === 0) return cur;

    let best: { el: LdElement; words: number } | null = null;
    for (const child of Array.from(cur.children) as LdElement[]) {
      const words = proseWords(child);
      if (!best || words > best.words) best = { el: child, words };
    }
    if (!best || best.words < total * NARROW_SHARE) return cur;
    cur = best.el;
  }
  return cur;
}

function metaContent(document: LdDocument, property: string): string | null {
  const el = document.querySelector(`meta[property="${property}"]`);
  const v = el?.getAttribute('content');
  return v ? normalize(v) : null;
}

function metaName(document: LdDocument, name: string): string | null {
  const el = document.querySelector(`meta[name="${name}"]`);
  const v = el?.getAttribute('content');
  return v ? normalize(v) : null;
}

/**
 * A page's own rel=canonical beats the URL we happened to arrive by. This is the
 * cheapest dedup win available: syndicated copies frequently point home.
 */
function resolveCanonical(document: LdDocument, pageUrl: string): string | null {
  const href =
    document.querySelector('link[rel="canonical"]')?.getAttribute('href') ??
    document.querySelector('meta[property="og:url"]')?.getAttribute('content');
  if (!href) return null;
  const c = canonicalizeUrl(href, pageUrl);
  return c ? c.url : null;
}

function parseMetaDate(raw: string | null): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}

function collectLinks(container: LdElement | null, pageUrl: string): string[] {
  if (!container) return [];
  const out = new Set<string>();
  for (const a of Array.from(container.querySelectorAll('a[href]')) as LdElement[]) {
    const c = canonicalizeUrl(a.getAttribute('href') ?? '', pageUrl);
    if (c) out.add(c.url);
  }
  return [...out];
}


// --- reading view -----------------------------------------------------------
//
// The same extraction, kept as BLOCKS instead of flattened to one string, so an
// article can be shown as an article rather than as a wall of text.
//
// Nothing here is stored. No article body is ever written to the database (spec
// 0), so this runs on request, hands the result to one reader, and forgets it.
// That is also why blocks are text and never HTML: what is sent to the browser
// carries no markup from a third-party page at all, so there is nothing to
// sanitize and nothing to get wrong.

export type BlockKind = 'p' | 'h' | 'li' | 'quote' | 'code' | 'image';

export interface Block {
  kind: BlockKind;
  /** For an image this is the alt text, which is often empty and that is fine. */
  text: string;
  /**
   * IMAGES ARE A URL, NEVER MARKUP.
   *
   * The rule this file has always kept is that no HTML from a stranger's server
   * reaches the browser. An image does not need to break it: what is taken from
   * the page is one absolute https URL, and the reader builds its own <img>
   * around it. Nothing is passed through, so there is still nothing to
   * sanitize.
   *
   * What that does NOT solve, and is worth being honest about: fetching the
   * image tells the publisher's server that somebody here is reading. The
   * reader sends no referrer, and the page sets a Content-Security-Policy that
   * bounds where an image may come from, but the request itself is the cost of
   * showing the picture.
   */
  src?: string;
}

export interface Readable {
  title: string | null;
  author: string | null;
  publishedAt: Date | null;
  siteName: string | null;
  leadImage: string | null;
  blocks: Block[];
  words: number;
  /** True when extraction found so little that reading here is not honest. */
  thin: boolean;
}

// `tr` is here because some articles are tables.
//
// LWN's "Security updates for Thursday" -- one of sixteen sources -- is a table
// of distribution, advisory id, package and date, with not one <p> in it. The
// reader collected paragraphs, found none, and said "Nothing readable on the
// page — it is probably rendered by JavaScript, or behind a wall", which was
// wrong in both of its guesses about a page it had already fetched and could
// read perfectly well. extractArticle() got 5,963 characters out of the same
// HTML, because it takes textContent and does not care about structure.
//
// A row becomes a list item: cells are separated by whitespace in the source, so
// normalize() gives "AlmaLinux ALSA-2026:60215 9 assertj-core 2026-08-27", which
// is exactly how that table reads aloud.
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, li, blockquote, pre, tr, img, figcaption';

const BLOCK_KIND: Record<string, BlockKind> = {
  P: 'p', H1: 'h', H2: 'h', H3: 'h', H4: 'h',
  LI: 'li', BLOCKQUOTE: 'quote', PRE: 'code', TR: 'li',
  // A caption reads as prose and belongs with the picture above it.
  FIGCAPTION: 'p',
  IMG: 'image',
};

/**
 * The one absolute https URL an <img> is worth, or null.
 *
 * Lazy-loaded images are the common case on the sites this archive reads, and
 * they put nothing useful in `src` -- a placeholder, a data URI, or a 1x1 --
 * while the real address sits in `data-src` or the first candidate of
 * `srcset`. Reading only `src` gets a page full of grey squares.
 *
 * Rejected: anything that is not https after resolution (an http image on an
 * https page is blocked by the browser anyway, and silently), and anything
 * declaring itself 2 pixels or smaller, which is a tracking pixel rather than
 * a diagram.
 */
export function imageSource(el: LdElement, pageUrl: string): string | null {
  // THE FIRST USABLE CANDIDATE, NOT THE FIRST PRESENT ONE.
  //
  // Written with `??` this reads well and is wrong in exactly the case it
  // exists for: a lazy-loaded image has BOTH a `src` holding a data-URI
  // placeholder AND the real address in `data-src`. `??` takes the placeholder
  // because it is present, the data: test then rejects it, and the real
  // address is never reached -- a page of grey squares, from the code written
  // to prevent them.
  const candidates = [
    el.getAttribute('src'),
    el.getAttribute('data-src'),
    el.getAttribute('data-original'),
    el.getAttribute('data-lazy-src'),
    el.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] ?? null,
  ];

  const w = Number(el.getAttribute('width') ?? '');
  const h = Number(el.getAttribute('height') ?? '');
  // 2 pixels or fewer is a beacon, not a diagram.
  if ((Number.isFinite(w) && w > 0 && w <= 2) || (Number.isFinite(h) && h > 0 && h <= 2)) return null;

  for (const raw of candidates) {
    if (!raw || raw.startsWith('data:')) continue;
    let url: URL;
    try { url = new URL(raw, pageUrl); } catch { continue; }
    // http on an https page is blocked by the browser anyway, and silently.
    if (url.protocol !== 'https:') continue;
    return url.toString();
  }
  return null;
}

export function extractReadable(html: string, pageUrl: string): Readable {
  const { document } = parseHTML(html);
  const leadImage = metaContent(document, 'og:image');
  const siteName = metaContent(document, 'og:site_name');
  const title = metaContent(document, 'og:title') ?? (normalize(document.title ?? '') || null);
  const author = metaContent(document, 'article:author') ?? metaName(document, 'author');
  const publishedAt = parseMetaDate(
    metaContent(document, 'article:published_time') ??
      metaName(document, 'date') ??
      document.querySelector('time[datetime]')?.getAttribute('datetime') ??
      null,
  );

  const container = pickContainer(document);
  const blocks: Block[] = [];
  const seen = new Set<string>();

  for (const el of Array.from(container?.querySelectorAll(BLOCK_SELECTOR) ?? []) as LdElement[]) {
    const kind = BLOCK_KIND[el.tagName?.toUpperCase() ?? ''] ?? 'p';

    // An image carries no text, so it has to be decided before the emptiness
    // test below throws it away.
    if (kind === 'image') {
      const src = imageSource(el, pageUrl);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      blocks.push({ kind, text: normalize(el.getAttribute('alt') ?? ''), src });
      continue;
    }

    // <pre> keeps its line breaks; everything else collapses whitespace.
    const raw = el.textContent ?? '';
    const text = kind === 'code' ? raw.replace(/\s+$/, '') : normalize(raw);
    if (!text) continue;
    // A paragraph nested inside a list item would otherwise appear twice.
    if (seen.has(text)) continue;
    if (kind !== 'code' && text.length < 2) continue;
    seen.add(text);
    blocks.push({ kind, text });
    if (blocks.length >= 400) break;
  }

  // The net under the selector.
  //
  // Whatever a page is made of, if the container holds readable text then the
  // reader must show it rather than claim there is nothing there. A layout
  // nobody anticipated is a reason to lose the STRUCTURE, not the article.
  if (blocks.length === 0) {
    const fallback = normalize(container?.textContent ?? '');
    if (fallback.length >= 200) blocks.push({ kind: 'p', text: fallback });
  }

  // Images do not count towards the word total. A page of diagrams with no
  // prose is still thin, and alt text is a label rather than reading.
  const words = blocks.reduce((n, b) => n + (b.kind === 'image' ? 0 : wordCount(b.text)), 0);
  return {
    title, author, publishedAt, siteName,
    leadImage: leadImage && /^https:\/\//.test(leadImage) ? leadImage : null,
    blocks,
    words,
    thin: words < 120,
  };
}

/**
 * The container pick, exposed so a test can hold it against a fixture and so
 * the narrowing can be measured against what it replaced. `narrow: false` is
 * the behaviour before InfoQ; nothing in the collector calls it that way.
 */
export const __test = { pickContainer, proseWords, ownProse, densityScore };

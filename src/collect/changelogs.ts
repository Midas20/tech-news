// Two announcement channels that are not feeds, and why they need code.
//
// The registry was cut to sixteen sources chosen by one test: does this report
// that a technology CHANGED. Two of them then produced nothing at all, for two
// different reasons, and both reported themselves healthy the whole time. That
// last part is the real fault -- a source that yields zero and says nothing is
// worse than one that fails, because nobody looks for it.
//
// GOOGLE CLOUD: one entry per DAY, not per change
//
// The Atom feed is well-formed and useless as-is. Every entry is titled with a
// date -- "August 27, 2026" -- and links to the same page with a different
// fragment. Fragments are stripped when canonicalising a URL, because they have
// to be: a fragment is a position on a page, not a different page. So all thirty
// entries collapsed onto one URL and twenty-seven were refused as duplicates,
// every hour, forever. Measured before this existed: 420 items seen, 0 kept, 0
// rejected -- it never even reached a content gate.
//
// The content of each day-entry is a clean list of that day's notes, one
// <h2 class="release-note-product-title"> per product. So the split is exact
// rather than heuristic: the publisher already marked the boundaries.
//
// OPENAI: the announcement channel has no feed at all
//
// `openai.com/news/rss.xml` is the marketing blog. Measured over 24 hours: 3,395
// items examined, 0 kept, and the refusals were right -- "How Cars24 scales
// conversations with OpenAI", letters to governors, business posts. Its feed is
// also 1,154 entries, re-parsed hourly to keep nothing, which alone was 25,000
// of the 87,648 items the collector examined each day.
//
// Every other candidate was checked before writing this. `platform.openai.com`
// has no RSS; `developers.openai.com/rss.xml` exists and is guides, cookbooks
// and YouTube links -- learning material, not events, and it would be refused
// too; `status.openai.com` is incidents, which is not a change to a technology.
// The changelog page itself is the only announcement channel, and it renders
// server-side, so it can be read.
//
// WHAT THIS COSTS
//
// A scraper breaks when the page changes, and that is the trade. It is made
// acceptable by failing LOUDLY: each adapter throws when it finds no entries,
// which records an error on the source and shows up on /admin/health, rather
// than returning an empty list that looks like a quiet news day.

import { parseHTML } from 'linkedom';
import type { FeedItem } from './feed.ts';
import { parseAtomEntriesRaw } from './feed.ts';
import type { AdapterResult } from './adapters.ts';

/** No entries means the page moved or the markup changed. Never silence. */
export class ChangelogShapeChanged extends Error {}

const GCP_FEED = 'https://docs.cloud.google.com/feeds/gcp-release-notes.xml';
const GCP_PAGE = 'https://docs.cloud.google.com/release-notes';
const OPENAI_CHANGELOG = 'https://platform.openai.com/docs/changelog';

async function fetchText(url: string, userAgent?: string): Promise<string> {
  const res = await fetch(url, {
    headers: userAgent ? { 'user-agent': userAgent } : {},
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** Collapse whitespace; these documents are indented HTML. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A headline from a paragraph of prose.
 *
 * The event classifier and the money lens both read the TITLE and nothing else,
 * so this is the only string that decides whether a note is filed as a release,
 * a deprecation or a price change. First sentence, because a release note's
 * first sentence is what it did; the rest is how.
 */
function headline(body: string, limit = 150): string {
  const text = tidy(body);
  if (!text) return '';
  const stop = text.search(/[.!?](\s|$)/);
  let head = stop > 20 ? text.slice(0, stop) : text;
  if (head.length > limit) {
    const cut = head.lastIndexOf(' ', limit);
    head = `${head.slice(0, cut > 40 ? cut : limit)}…`;
  }
  return head;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// --- Google Cloud -------------------------------------------------------------

/**
 * One day-digest, split into the notes the publisher already separated.
 *
 * Exported for the tests: this is the part worth holding, because the whole
 * failure it fixes was invisible.
 */
export function splitGoogleCloudDigest(
  contentHtml: string,
  publishedAt: Date | null,
): FeedItem[] {
  const { document } = parseHTML(`<body>${contentHtml}</body>`);
  const items: FeedItem[] = [];
  const date = (publishedAt ?? new Date()).toISOString().slice(0, 10);

  // Each product heading opens a note and closes the one before it. Walking
  // siblings rather than splitting on a string keeps entity decoding and nested
  // markup the parser's problem rather than ours.
  // A product appearing twice in one day would collapse onto one URL, which is
  // the very failure this adapter exists to fix, in miniature. Today's feed
  // groups each product's notes under a single heading and there are no
  // collisions -- measured, 338 items, 338 distinct links -- but that is an
  // observation of one day's data, not a promise about the next. The counter
  // makes it structural.
  const usedProduct = new Map<string, number>();

  const headings = [...document.querySelectorAll('h2.release-note-product-title')];
  for (const heading of headings) {
    const product = tidy(heading.textContent ?? '');
    if (!product) continue;

    let kind = '';
    const parts: string[] = [];
    for (let node = heading.nextElementSibling; node; node = node.nextElementSibling) {
      const tag = node.tagName?.toUpperCase();
      if (tag === 'H2') break;                       // the next product
      if (tag === 'H3' && !kind) {
        // Feature, Announcement, Changed, Fixed, Issue, Deprecated, Breaking.
        kind = tidy(node.textContent ?? '');
        continue;
      }
      const text = tidy(node.textContent ?? '');
      if (text) parts.push(text);
    }

    const body = parts.join(' ');
    if (!body) continue;

    // The kind stays in the title on purpose. "Deprecated" and "Breaking" are
    // the words the event classifier and the money lens are looking for, and
    // dropping them to make the title prettier would hide the notes that cost
    // money.
    const title = kind
      ? `${product} — ${kind}: ${headline(body)}`
      : `${product}: ${headline(body)}`;

    // A synthetic but honest URL. There is no per-note anchor to link to, and
    // the identity of a story is its canonical URL -- so without something
    // distinct per note they would collapse again, which is the entire bug.
    // Query parameters survive canonicalisation (fragments do not), these two
    // are not on the tracking list, and the page loads and ignores them.
    const key = slug(product);
    const nth = (usedProduct.get(key) ?? 0) + 1;
    usedProduct.set(key, nth);
    const link = `${GCP_PAGE}?product=${encodeURIComponent(key)}&date=${date}`
      + (nth > 1 ? `&n=${nth}` : '');

    items.push({
      title,
      link,
      guid: `gcp:${date}:${key}:${slug(kind)}:${nth}`,
      summary: body.slice(0, 600),
      content: body,
      author: null,
      publishedAt,
      enclosureTypes: [],
      categories: kind ? [kind] : [],
      outboundLinks: [],
      // There is no page behind this note -- its link is the listing it was
      // split out of, and fetching that returns the whole changelog.
      complete: true,
    });
  }

  return items;
}

export async function googleCloudReleaseNotes(
  opts: { userAgent?: string } = {},
): Promise<AdapterResult> {
  const xml = await fetchText(GCP_FEED, opts.userAgent);
  // parseAtomEntriesRaw, not parseFeed: the ordinary path strips markup, and the
  // markup is the only thing that says where one day's notes end and the next
  // product's begin.
  const days = parseAtomEntriesRaw(xml);
  if (days.length === 0) {
    throw new ChangelogShapeChanged('Google Cloud release notes: the feed parsed to no entries');
  }

  const items: FeedItem[] = [];
  for (const day of days) {
    items.push(...splitGoogleCloudDigest(day.html, day.publishedAt));
  }

  if (items.length === 0) {
    throw new ChangelogShapeChanged(
      `Google Cloud release notes: ${days.length} day entries held no `
      + `h2.release-note-product-title headings — the digest format has changed`);
  }
  return { items, engagement: [] };
}

// --- OpenAI -------------------------------------------------------------------

/**
 * The changelog page, as items.
 *
 * Selectors are matched on the STABLE PREFIX of each class. The page is built
 * with hashed module class names -- `_ChangelogMarkdown_f3xd6_19` -- and the
 * hash changes whenever the stylesheet is rebuilt, so matching the whole name
 * would break on a deploy that changed nothing visible.
 */
export function parseOpenAiChangelog(html: string, now = new Date()): FeedItem[] {
  const { document } = parseHTML(html);
  const bodies = [...document.querySelectorAll('[class*="_ChangelogMarkdown_"]')];
  const items: FeedItem[] = [];
  const seen = new Set<string>();

  for (const body of bodies) {
    const text = tidy(body.textContent ?? '');
    if (!text) continue;

    // The entry is a two-column grid: the date badge in the first cell, the
    // badges and prose in the second. Walk up to whichever ancestor holds both.
    const entry = body.parentElement?.parentElement ?? null;
    const badges = entry ? [...entry.querySelectorAll('[class*="_Badge_"]')] : [];
    const labels = badges.map((b) => tidy(b.textContent ?? '')).filter(Boolean);

    // "Aug 20", "Dec 3" -- the year is not on the page, so it is inferred.
    const dateLabel = labels.find((l) => /^[A-Z][a-z]{2} \d{1,2}$/.test(l)) ?? '';
    const publishedAt = parseBadgeDate(dateLabel, now);

    // The first badge that is not the date and not a model name is the kind:
    // Feature, Update, Deprecation.
    const kind = labels.find((l) => /^(feature|update|deprecation|fix|breaking)$/i.test(l)) ?? '';
    const models = labels.filter((l) => l !== dateLabel && l !== kind
      && /^[a-z0-9][a-z0-9.\-]*$/.test(l));

    const subject = models.length ? models.slice(0, 2).join(', ') : 'OpenAI API';
    const title = kind
      ? `${subject} — ${kind}: ${headline(text)}`
      : `${subject}: ${headline(text)}`;

    // Same reasoning as Google Cloud: no per-entry anchor exists, and identity
    // is the canonical URL, so each needs something distinct that still loads
    // the right page.
    const key = `${publishedAt ? publishedAt.toISOString().slice(0, 10) : 'undated'}:${slug(subject)}:${slug(headline(text, 60))}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      title,
      link: `${OPENAI_CHANGELOG}?entry=${encodeURIComponent(key)}`,
      guid: `openai:${key}`,
      summary: text.slice(0, 600),
      content: text,
      author: null,
      publishedAt,
      enclosureTypes: [],
      categories: kind ? [kind] : [],
      outboundLinks: [],
      // There is no page behind this note -- its link is the listing it was
      // split out of, and fetching that returns the whole changelog.
      complete: true,
    });
  }

  return items;
}

/**
 * "Aug 20" with no year, which is what the page gives.
 *
 * Assume the most recent occurrence: a changelog is read newest-first, and a
 * date more than a few days ahead of today is last year's rather than a
 * prediction. Getting this wrong by a year would file a current change outside
 * the retention window, where it is refused as `too_old` and silently lost.
 */
function parseBadgeDate(label: string, now: Date): Date | null {
  if (!label) return null;
  const parsed = Date.parse(`${label} ${now.getUTCFullYear()} UTC`);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  // More than two days in the future means the year rolled over.
  if (date.getTime() > now.getTime() + 2 * 864e5) {
    date.setUTCFullYear(date.getUTCFullYear() - 1);
  }
  return date;
}

export async function openAiChangelog(
  opts: { userAgent?: string } = {},
): Promise<AdapterResult> {
  const html = await fetchText(OPENAI_CHANGELOG, opts.userAgent);
  const items = parseOpenAiChangelog(html);
  if (items.length === 0) {
    throw new ChangelogShapeChanged(
      'OpenAI changelog: no _ChangelogMarkdown_ entries found — the page has changed '
      + 'shape or is no longer server-rendered');
  }
  return { items, engagement: [] };
}

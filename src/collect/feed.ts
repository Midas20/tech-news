// Feed parsing: RSS 2.0, RSS 1.0/RDF, Atom and JSON Feed behind one shape.
//
// Real-world feeds are inconsistent in every field that matters. published_at is
// missing, wrong, or in a format nobody agreed on; links appear as <link>, as an
// Atom rel=alternate href, or only inside the guid. The parser's job is to be
// tolerant here so the pipeline downstream can be strict.

import { XMLParser } from 'fast-xml-parser';
import { stripHtml, normalize } from '../lib/text.ts';
import { canonicalizeUrl } from '../lib/url.ts';

export interface FeedItem {
  title: string;
  link: string | null;
  guid: string | null;
  summary: string;
  content: string;
  author: string | null;
  publishedAt: Date | null;
  enclosureTypes: string[];
  categories: string[];
  outboundLinks: string[];
  /**
   * This item's content is the whole of it; there is no page to go and fetch.
   *
   * Ordinarily a short body means a truncated feed, and the fix is to fetch the
   * article -- which is right for almost everything. It is exactly wrong for an
   * item split out of a digest: its `link` is the LISTING it came from, so
   * fetching returns the entire changelog for every item on it. Measured on the
   * OpenAI adapter before this existed: eighteen distinct announcements each
   * given the same 37,444-word body and the same rel=canonical, so every one of
   * them deduplicated into a single story. A price change was merged into an
   * unrelated API launch.
   *
   * Only the producer knows this, which is why it is a property of the item
   * rather than a rule about a URL.
   */
  complete?: boolean;
}

export interface ParsedFeed {
  title: string | null;
  items: FeedItem[];
  format: 'rss' | 'atom' | 'rdf' | 'jsonfeed';
}

// Entity handling is a security setting, not a formatting one. The parser's
// default cap of 1,000 total expansions is well below what a normal feed uses --
// a week of posts full of &amp; and &#8217; blows past it and the feed is lost --
// but the cap that actually stops a billion-laughs attack is expansion DEPTH,
// which stays at its default. Total count and expanded length are raised to
// levels a real feed reaches and a bomb still does not.
//
// 200,000 was calibrated against a week of posts, and a CHANGELOG is not a week
// of posts. Cloudflare publishes its entire history in one document -- 7.3 MB,
// 1,174 entries, 200,055 expansions -- so the cap rejected it by 55, the fetch
// logged `unparseable feed`, and the source produced nothing while looking
// healthy. That is the failure mode this cap has to avoid: a silent, total loss
// of one source, which is far more likely than an attack from a curated feed.
//
// The real bound on memory is maxExpandedLength, which stays at 20 MB and is
// the same size as MAX_FEED_BYTES below. Depth stays at 10. A bomb needs depth
// or length; neither moved.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
  parseTagValue: false,
  htmlEntities: true,
  processEntities: {
    enabled: true,
    maxExpansionDepth: 10,
    maxTotalExpansions: 2_000_000,
    maxExpandedLength: 20_000_000,
    maxEntityCount: 10_000,
  },
} as never);

/** Feeds this large are a misconfiguration or an attack, not a week of posts. */
const MAX_FEED_BYTES = 20_000_000;

export function parseFeed(body: string, feedUrl: string): ParsedFeed | null {
  if (body.length > MAX_FEED_BYTES) return null;
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parseJsonFeed(trimmed, feedUrl);
  try {
    return parseXmlFeed(trimmed, feedUrl);
  } catch {
    return null;
  }
}

function parseXmlFeed(xml: string, feedUrl: string): ParsedFeed | null {
  const doc = parser.parse(xml) as Record<string, any>;

  if (doc.rss?.channel) {
    const channel = doc.rss.channel;
    return {
      title: text(channel.title),
      format: 'rss',
      items: arrayOf(channel.item).map((i) => rssItem(i, feedUrl)),
    };
  }
  if (doc['rdf:RDF']) {
    const rdf = doc['rdf:RDF'];
    return {
      title: text(rdf.channel?.title),
      format: 'rdf',
      items: arrayOf(rdf.item).map((i) => rssItem(i, feedUrl)),
    };
  }
  if (doc.feed) {
    return {
      title: text(doc.feed.title),
      format: 'atom',
      items: arrayOf(doc.feed.entry).map((e) => atomEntry(e, feedUrl)),
    };
  }
  return null;
}

/**
 * Atom entries with their content left as HTML.
 *
 * Everything else here strips markup, because a story's body is prose and tags
 * are noise in it. One case needs the opposite: a feed whose entries are
 * DIGESTS, where the markup is the only record of where one item ends and the
 * next begins. Google Cloud's release notes publish one entry per day
 * containing that day's notes, separated by <h2 class="release-note-product-
 * title">; stripped to text those boundaries are gone and thirty changes become
 * one unreadable paragraph.
 *
 * Kept here rather than in the adapter so it shares the parser above -- the
 * entity limits on that object are a security setting that took a real outage
 * to calibrate, and a second parser elsewhere would not have them.
 */
export interface RawEntry {
  title: string;
  /** The entry's content, markup intact. */
  html: string;
  publishedAt: Date | null;
}

export function parseAtomEntriesRaw(body: string): RawEntry[] {
  if (body.length > MAX_FEED_BYTES) return [];
  let doc: any;
  try {
    doc = parser.parse(body);
  } catch {
    return [];
  }
  if (!doc?.feed?.entry) return [];
  return arrayOf(doc.feed.entry).map((entry: Record<string, any>) => ({
    title: normalize(stripHtml(text(entry.title) ?? '')),
    html: bodyText(entry.content) || bodyText(entry.summary),
    publishedAt: parseDate(text(entry.published) ?? text(entry.updated)),
  }));
}

function rssItem(item: Record<string, any>, feedUrl: string): FeedItem {
  const contentEncoded = text(item['content:encoded']) ?? '';
  const description = text(item.description) ?? '';
  const rawLink = text(item.link) ?? text(item.guid) ?? null;

  return {
    title: normalize(stripHtml(text(item.title) ?? '')),
    link: resolveLink(rawLink, feedUrl),
    guid: text(item.guid) ?? null,
    summary: stripHtml(description),
    content: stripHtml(contentEncoded || description),
    author: text(item['dc:creator']) ?? text(item.author) ?? null,
    publishedAt: parseDate(text(item.pubDate) ?? text(item['dc:date'])),
    enclosureTypes: arrayOf(item.enclosure)
      .map((e) => String(e?.['@type'] ?? ''))
      .filter(Boolean),
    categories: arrayOf(item.category).map((c) => text(c) ?? '').filter(Boolean),
    outboundLinks: extractLinks(contentEncoded || description, feedUrl),
  };
}

function atomEntry(entry: Record<string, any>, feedUrl: string): FeedItem {
  const links = arrayOf(entry.link);
  const alternate =
    links.find((l) => (l?.['@rel'] ?? 'alternate') === 'alternate' && l?.['@href']) ?? links[0];
  const contentRaw = bodyText(entry.content);
  const summaryRaw = bodyText(entry.summary);

  return {
    title: normalize(stripHtml(text(entry.title) ?? '')),
    link: resolveLink(alternate?.['@href'] ?? text(entry.id) ?? null, feedUrl),
    guid: text(entry.id) ?? null,
    summary: stripHtml(summaryRaw),
    content: stripHtml(contentRaw || summaryRaw),
    author: text(entry.author?.name) ?? null,
    publishedAt: parseDate(text(entry.published) ?? text(entry.updated)),
    enclosureTypes: links
      .filter((l) => l?.['@rel'] === 'enclosure')
      .map((l) => String(l?.['@type'] ?? ''))
      .filter(Boolean),
    categories: arrayOf(entry.category).map((c) => String(c?.['@term'] ?? '')).filter(Boolean),
    outboundLinks: extractLinks(contentRaw || summaryRaw, feedUrl),
  };
}

function parseJsonFeed(body: string, feedUrl: string): ParsedFeed | null {
  let doc: any;
  try {
    doc = JSON.parse(body);
  } catch {
    return null;
  }
  // JSON Feed proper wraps items in an object; several sites (Lobsters among
  // them) just return the array. Accept both rather than losing the source.
  const items = Array.isArray(doc) ? doc : Array.isArray(doc.items) ? doc.items : null;
  if (!items) return null;

  return {
    title: doc.title ?? null,
    format: 'jsonfeed',
    items: items.map((i: any): FeedItem => {
      const html = String(i.content_html ?? i.description ?? '');
      const plain = String(i.content_text ?? '');
      return {
        title: normalize(stripHtml(String(i.title ?? ''))),
        // A self-post has no external URL; the discussion page is the story.
        link: resolveLink(i.url || i.external_url || i.comments_url || null, feedUrl),
        guid: i.id != null ? String(i.id) : (i.short_id ?? null),
        summary: stripHtml(String(i.summary ?? plain ?? '')),
        content: plain ? normalize(plain) : stripHtml(html),
        author: i.author?.name ?? i.authors?.[0]?.name ?? i.submitter_user ?? null,
        publishedAt: parseDate(i.date_published ?? i.date_modified ?? i.created_at),
        enclosureTypes: (i.attachments ?? []).map((a: any) => String(a.mime_type ?? '')),
        categories: i.tags ?? [],
        outboundLinks: extractLinks(html, feedUrl),
      };
    }),
  };
}

function arrayOf<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const inner = v['#text'] ?? v['@href'] ?? v['_'];
    return inner != null ? String(inner).trim() || null : null;
  }
  return null;
}

/**
 * Atom's OTHER content form, which this parser could not read.
 *
 * Measured on 2026-09-09, chasing "the number of news is very low": Vercel's
 * feed carries 1,563 entries and 1,103 of them were refused as `too_short` on
 * every single poll, forever, while the raw XML plainly contained paragraphs of
 * prose. ClickHouse, Hugging Face, Shopify and Stripe were failing the same
 * way. Between them that is 92,000 refusals in three days against 5,199 stories
 * kept in total.
 *
 * The cause is RFC 4287 section 4.1.3.  may be `type="html"`, where
 * the body is escaped markup and arrives as a string, or `type="xhtml"`, where
 * the body is REAL NESTED XML --  --
 * and arrives as a parsed object tree with no `#text` of its own. `text()`
 * looks for a string or a `#text` and finds neither, so it returns null, so the
 * body is empty, so the length gate refuses an item whose emptiness was ours.
 * Exactly the mistake the walled-announcement comment in ingest.ts names: "the
 * shortness was ours, not theirs" -- except here nothing was even walled.
 *
 * So the tree is walked and turned back into markup. `stripHtml` then makes
 * prose of it and `extractLinks` can still see the anchors, which is why this
 * rebuilds tags rather than merely concatenating the text leaves.
 *
 * ONE HONEST LIMIT: fast-xml-parser does not preserve document order between an
 * element's `#text` and its child elements unless `preserveOrder` is set, and
 * setting it would rewrite every accessor in this file. So a sentence with a
 * link in the middle of it can come back with the link's words moved to the
 * end. Every word survives, the anchors survive, and the order within any one
 * run of text survives. For a length gate, a classifier and a summariser that
 * is the right trade; for quoting a sentence verbatim it is not, which is why
 * the reader still links to the source.
 */
function markupFrom(node: unknown, depth = 0): string {
  if (node == null || depth > 12) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => markupFrom(n, depth + 1)).join(' ');
  if (typeof node !== 'object') return '';

  const parts: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '#text') { parts.push(String(value)); continue; }
    // Attributes of THIS node; the ones worth keeping are read off the child
    // below, where the tag they belong to is known.
    if (key.startsWith('@')) continue;
    // Namespace prefixes are dropped:  is  once
    // stripHtml is through with it, and keeping the prefix only risks a tag
    // name the stripper does not recognise.
    const tag = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    for (const child of Array.isArray(value) ? value : [value]) {
      const href = child && typeof child === 'object'
        ? (child as Record<string, unknown>)['@href'] : undefined;
      const open = tag === 'a' && typeof href === 'string'
        ? `<a href="${href}">` : `<${tag}>`;
      parts.push(`${open}${markupFrom(child, depth + 1)}</${tag}>`);
    }
  }
  return parts.join(' ');
}

/**
 * An entry body, whichever of the two Atom forms it arrived in.
 *
 * Used only for content and summary. Titles and dates stay on `text()`, which
 * is right for them: a title that parsed as a tree is a broken feed, and
 * rebuilding markup into one would put tag names in a headline.
 */
function bodyText(node: unknown): string {
  return text(node) ?? markupFrom(node);
}

function resolveLink(raw: string | null, base: string): string | null {
  if (!raw) return null;
  const c = canonicalizeUrl(raw, base);
  return c ? c.url : null;
}

/** Outbound links feed the source discovery loop (spec 2.4). */
export function extractLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  const re = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const c = canonicalizeUrl(m[1]!, base);
    if (c) out.add(c.url);
  }
  return [...out];
}

/**
 * Date parsing. A feed date that cannot be parsed becomes null rather than
 * now(): published_at is allowed to be missing, and collected_at is the field
 * the system actually trusts.
 */
/**
 * How far ahead of the clock a publication date may be before it is disbelieved.
 *
 * Small, because the rule underneath is not about tolerance at all: a story
 * cannot be published after the moment it was fetched. Parsing happens at fetch
 * time, so `now()` here IS collection time, and an hour is for clock skew
 * between two machines rather than for genuinely future news.
 */
const FUTURE_SKEW_MS = 60 * 60 * 1000;

export function parseDate(raw: string | null | undefined, now = Date.now()): Date | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    // Feeds routinely carry dates decades out. Treat those as absent.
    const year = d.getUTCFullYear();
    if (year < 1990 || year > new Date(now).getUTCFullYear() + 1) return null;
    // And dates a few hours out, which the year check waves straight through.
    //
    // Found 2026-08-29 while checking whether "the last AI news is 6 hours ago"
    // was true. It was -- but sitting above it was a Cloudflare changelog entry
    // dated 2026-08-30 00:00, four hours in the future, fetched at 17:57 the
    // day before. A DATE-ONLY feed value parses as midnight UTC, so any
    // publisher who stamps tomorrow's date lands ahead of the clock.
    //
    // It is not a harmless cosmetic: every page here orders by
    // coalesce(published_at, collected_at), so that row pins itself to the top
    // of the newest-first lists until midnight catches up, and relativeTime()
    // clamps a negative age to zero -- so it reads "now" and hides the reason.
    //
    // Null rather than clamped to now(), which is this function's existing
    // contract: published_at is allowed to be missing and collected_at is the
    // field the system actually trusts.
    if (parsed > now + FUTURE_SKEW_MS) return null;
    return d;
  }
  return null;
}

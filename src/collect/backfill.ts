// The backward direction.
//
// Forward collection answers "what is happening"; this answers "what happened",
// which is what any trend claim actually rests on. A twelve-week chart built
// from twelve weeks of live collection is not a trend, it is a start-up
// transient.
//
// Three rules, all of them consequences of the spec:
//
//   1. It is a SEPARATE job, never part of a poll cycle. It runs at its own
//      pace, marks everything collection_mode='backfill', and enqueues at the
//      lowest priority so it cannot compete with live collection for quota.
//   2. It is RESUMABLE. Every provider writes an opaque cursor after each page,
//      so a run that is killed halfway resumes from where it stopped rather
//      than starting over -- which matters when the target is 2006-to-now.
//   3. It only walks sources that genuinely expose history. RSS has no past
//      tense; pretending otherwise would produce a slow, failing loop. Press and
//      blog history begins on day one of live collection, and the registry says
//      so rather than hiding it.

import type { Db } from '../db/client.ts';
import type { SourceRow } from '../db/repos/sources.ts';
import type { FeedItem } from './feed.ts';
import { ingestItems } from './ingest.ts';
import { PolitenessGate } from './fetcher.ts';
import { canonicalizeUrl } from '../lib/url.ts';
import { getConfig } from '../config.ts';

export interface BackfillOptions {
  /** Stop after this many pages, whatever the cursor says. */
  maxPages?: number;
  /** Stop once history reaches back this far. */
  until?: Date;
  deadlineMs?: number;
  userAgent?: string;
  politeness?: PolitenessGate;
  onPage?: (info: { page: number; seen: number; stored: number; oldest: string | null }) => void;
}

export interface BackfillReport {
  provider: string;
  target: string;
  pages: number;
  seen: number;
  stored: number;
  oldest: string | null;
  status: 'complete' | 'exhausted' | 'stopped' | 'failed';
  error?: string;
}

interface Page {
  items: FeedItem[];
  /** Cursor for the NEXT page, or null when history is exhausted. */
  next: string | null;
  oldest: Date | null;
}

/** Backfilled rows are records, not articles: the event is the title and the date. */
const BACKFILL_MIN_LENGTH = 0;

// --- Hacker News, via Algolia -----------------------------------------------
//
// The only complete, free, unauthenticated archive of HN, 2006 to now. Walks
// backwards by created_at, 100 items per request.

async function hnPage(cursor: string | null, userAgent?: string): Promise<Page> {
  const before = cursor ?? String(Math.floor(Date.now() / 1000));
  const url = 'https://hn.algolia.com/api/v1/search_by_date'
    + `?tags=story&hitsPerPage=100&numericFilters=created_at_i<${before}`;

  const res = await fetch(url, { headers: userAgent ? { 'user-agent': userAgent } : {} });
  if (!res.ok) throw new Error(`algolia ${res.status}`);
  const body = await res.json() as { hits?: HnHit[] };
  const hits = body.hits ?? [];

  const items: FeedItem[] = [];
  let oldest: Date | null = null;
  let minTs: number | null = null;

  for (const h of hits) {
    if (!h.title || typeof h.created_at_i !== 'number') continue;
    const when = new Date(h.created_at_i * 1000);
    if (!oldest || when < oldest) oldest = when;
    minTs = minTs === null ? h.created_at_i : Math.min(minTs, h.created_at_i);

    const discussion = `https://news.ycombinator.com/item?id=${h.objectID}`;
    const link = h.url ? canonicalizeUrl(h.url)?.url ?? discussion : discussion;

    items.push({
      title: h.title,
      link,
      guid: String(h.objectID),
      // The archive keeps the record, not a body it never had.
      summary: `${h.points ?? 0} points, ${h.num_comments ?? 0} comments on Hacker News`,
      content: `${h.points ?? 0} points, ${h.num_comments ?? 0} comments on Hacker News`,
      author: h.author ?? null,
      publishedAt: when,
      enclosureTypes: [],
      categories: [],
      outboundLinks: h.url ? [h.url] : [],
    });
  }

  return {
    items,
    // Step one second past the oldest hit or the same page repeats forever.
    next: hits.length === 0 || minTs === null ? null : String(minTs),
    oldest,
  };
}

interface HnHit {
  objectID: string;
  title?: string;
  url?: string | null;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at_i?: number;
}

// --- GitHub releases, via the REST API ---------------------------------------
//
// releases.atom carries only the newest entries; the REST endpoint pages through
// every release a repo ever cut. Needs a token for a usable rate limit.

async function githubReleasesPage(
  repo: string, cursor: string | null, userAgent?: string, token?: string,
): Promise<Page> {
  const page = cursor ? Number(cursor) : 1;
  const url = `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`;

  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (userAgent) headers['user-agent'] = userAgent;
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (res.status === 404) return { items: [], next: null, oldest: null };
  if (!res.ok) throw new Error(`github ${res.status}: ${(await res.text()).slice(0, 120)}`);

  const releases = await res.json() as GhRelease[];
  const items: FeedItem[] = [];
  let oldest: Date | null = null;

  for (const r of releases) {
    const when = r.published_at ? new Date(r.published_at) : null;
    if (when && (!oldest || when < oldest)) oldest = when;
    const title = (r.name && r.name.trim()) || r.tag_name;
    if (!title) continue;

    items.push({
      title,
      link: r.html_url,
      guid: String(r.id),
      summary: (r.body ?? '').slice(0, 2000),
      content: (r.body ?? '').slice(0, 4000),
      author: r.author?.login ?? null,
      publishedAt: when,
      enclosureTypes: [],
      categories: r.prerelease ? ['prerelease'] : [],
      outboundLinks: [],
    });
  }

  return { items, next: releases.length === 100 ? String(page + 1) : null, oldest };
}

interface GhRelease {
  id: number;
  name?: string | null;
  tag_name: string;
  html_url: string;
  body?: string | null;
  prerelease?: boolean;
  published_at?: string | null;
  author?: { login?: string } | null;
}

// --- arXiv -------------------------------------------------------------------
//
// Paged by offset, newest first. The API asks for three seconds between
// requests and means it, which the politeness gate enforces.

async function arxivPage(
  category: string, cursor: string | null, userAgent?: string,
): Promise<Page> {
  const start = cursor ? Number(cursor) : 0;
  const url = 'http://export.arxiv.org/api/query'
    + `?search_query=cat:${encodeURIComponent(category)}`
    + `&start=${start}&max_results=100&sortBy=submittedDate&sortOrder=descending`;

  const res = await fetch(url, { headers: userAgent ? { 'user-agent': userAgent } : {} });
  if (!res.ok) throw new Error(`arxiv ${res.status}`);
  const xml = await res.text();

  const entries = xml.split('<entry>').slice(1);
  const items: FeedItem[] = [];
  let oldest: Date | null = null;

  for (const raw of entries) {
    const pick = (tag: string) =>
      new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(raw)?.[1]?.trim() ?? '';
    const title = clean(pick('title'));
    const link = /<id>([\s\S]*?)<\/id>/.exec(raw)?.[1]?.trim() ?? '';
    if (!title || !link) continue;

    const published = pick('published');
    const when = published ? new Date(published) : null;
    if (when && (!oldest || when < oldest)) oldest = when;

    items.push({
      title,
      link,
      guid: link,
      summary: clean(pick('summary')).slice(0, 1200),
      content: clean(pick('summary')).slice(0, 4000),
      author: clean(pick('name')) || null,
      publishedAt: when,
      enclosureTypes: [],
      categories: [category],
      outboundLinks: [],
    });
  }

  return { items, next: entries.length === 100 ? String(start + 100) : null, oldest };
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

// --- the walker --------------------------------------------------------------

export type Provider = 'hn' | 'github_releases' | 'arxiv';

export async function backfill(
  db: Db,
  provider: Provider,
  target: string,
  source: SourceRow,
  opts: BackfillOptions = {},
): Promise<BackfillReport> {
  const config = getConfig();
  const politeness = opts.politeness ?? new PolitenessGate(config.fetch.politenessMs);
  const deadline = Date.now() + (opts.deadlineMs ?? 10 * 60_000);
  const maxPages = opts.maxPages ?? 20;
  const userAgent = opts.userAgent ?? config.fetch.userAgent;

  const state = await loadState(db, provider, target, source.id);
  let cursor = state.cursor;

  const report: BackfillReport = {
    provider, target, pages: 0, seen: 0, stored: 0,
    oldest: state.oldest_seen, status: 'stopped',
  };

  if (state.status === 'complete') {
    report.status = 'complete';
    return report;
  }

  await db.query(
    `UPDATE backfill_state SET status='running', started_at=coalesce(started_at, now()) WHERE id=$1`,
    [state.id],
  );

  try {
    for (let page = 0; page < maxPages; page++) {
      if (Date.now() > deadline) break;

      // Politeness is per host and shared with the live collector, so a backfill
      // cannot make the forward direction rude.
      await politeness.wait(providerHost(provider), providerInterval(provider));

      const result = provider === 'hn' ? await hnPage(cursor, userAgent)
        : provider === 'github_releases'
          ? await githubReleasesPage(target, cursor, userAgent, process.env.GITHUB_TOKEN)
          : await arxivPage(target, cursor, userAgent);

      report.pages++;
      report.seen += result.items.length;

      // `until` BOUNDS WHAT IS STORED, NOT ONLY WHEN TO STOP ASKING.
      //
      // The stop test below runs after the page has already been ingested, so
      // the last page went in whole -- and a page is up to 100 releases. Asking
      // for history back to 2024-01-01 across eight repositories stored 168 rows
      // from 2020 to 2023: not harmful in an archive that wants depth, but not
      // what the flag says, and the overshoot is a different size for every
      // repository because it depends where the cutoff falls in the page.
      //
      // An item with no date is kept: undated is not the same as out of range,
      // and the ingest path has its own handling for it.
      const pageItems = opts.until
        ? result.items.filter((i) => !i.publishedAt || i.publishedAt >= opts.until!)
        : result.items;

      let pageStored = 0;
      if (pageItems.length > 0) {
        const ingested = await ingestItems(db, source, pageItems, {
          politeness,
          userAgent,
          collectionMode: 'backfill',
          // Never fetch article pages while walking history: it multiplies a
          // 200-page walk into 20,000 requests against sites that owe us nothing.
          fetchArticles: false,
          minLength: BACKFILL_MIN_LENGTH,
          deadlineMs: Math.max(5000, deadline - Date.now()),
        });
        pageStored = ingested.kept;
        report.stored += pageStored;
      }

      if (result.oldest) {
        const iso = result.oldest.toISOString();
        if (!report.oldest || iso < report.oldest) report.oldest = iso;
      }

      cursor = result.next;
      await saveProgress(db, state.id, cursor, {
        seen: result.items.length,
        stored: pageStored,
        oldest: report.oldest,
      });
      opts.onPage?.({
        page: report.pages, seen: result.items.length,
        stored: report.stored, oldest: report.oldest,
      });

      if (!cursor) {
        report.status = 'exhausted';
        break;
      }
      if (opts.until && result.oldest && result.oldest <= opts.until) {
        report.status = 'complete';
        break;
      }
    }

    await db.query(
      `UPDATE backfill_state SET status=$2, last_error=NULL WHERE id=$1`,
      [state.id, report.status === 'stopped' ? 'pending' : report.status],
    );
    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The cursor survives the failure, so the next run resumes rather than
    // restarting a walk that may be thousands of pages deep.
    await db.query(
      `UPDATE backfill_state SET status='failed', last_error=$2 WHERE id=$1`,
      [state.id, message.slice(0, 500)],
    );
    report.status = 'failed';
    report.error = message;
    return report;
  }
}

interface StateRow {
  id: string;
  cursor: string | null;
  status: string;
  oldest_seen: string | null;
}

async function loadState(db: Db, provider: string, target: string, sourceId: string): Promise<StateRow> {
  const rows = await db.query<StateRow>(
    `INSERT INTO backfill_state (provider, target, source_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, target) DO UPDATE SET source_id = EXCLUDED.source_id
     RETURNING id::text, cursor, status, oldest_seen::text`,
    [provider, target, sourceId],
  );
  return rows[0]!;
}

/** Per-page progress. The deltas are what make a resumed run's totals honest. */
async function saveProgress(
  db: Db,
  id: string,
  cursor: string | null,
  page: { seen: number; stored: number; oldest: string | null },
): Promise<void> {
  await db.query(
    `UPDATE backfill_state SET
       cursor = $2,
       items_seen = items_seen + $3,
       items_stored = items_stored + $4,
       requests = requests + 1,
       oldest_seen = LEAST(coalesce(oldest_seen, 'infinity'::timestamptz), $5::timestamptz)
     WHERE id = $1`,
    [id, cursor, page.seen, page.stored, page.oldest],
  );
}

function providerHost(provider: Provider): string {
  return provider === 'hn' ? 'hn.algolia.com'
    : provider === 'github_releases' ? 'api.github.com'
    : 'export.arxiv.org';
}

/** arXiv asks for three seconds between requests and means it. */
function providerInterval(provider: Provider): number {
  return provider === 'arxiv' ? 3000 : 1000;
}

/** What the registry says can be walked backwards, and how far it has got. */
export async function backfillTargets(db: Db, provider?: string): Promise<{
  provider: string; target: string; source_id: string; status: string;
  oldest_seen: string | null; items_stored: number;
}[]> {
  return db.query(
    `SELECT b.provider, b.target, b.source_id::text, b.status,
            b.oldest_seen::text, b.items_stored
       FROM backfill_state b
      WHERE ($1::text IS NULL OR b.provider = $1)
      ORDER BY b.items_stored DESC`,
    [provider ?? null],
  );
}

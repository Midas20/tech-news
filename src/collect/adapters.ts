// Adapters for sources that have no feed.
//
// Most of the registry is RSS/Atom/JSON Feed and goes through the normal path.
// A minority are APIs, and each needs its own shape. Rather than let those fail
// as "unparseable feed" forever, an API source with no adapter is PAUSED with a
// reason -- a gap you can see in source_health_board beats a source that quietly
// burns a poll slot every hour.
//
// Hacker News is implemented here because it is the discovery backbone and
// because it carries the engagement signal (points, comments) that the snapshot
// curves need. The remaining API adapters are declared, not implemented.

import type { FeedItem } from './feed.ts';
import { canonicalizeUrl } from '../lib/url.ts';
import { googleCloudReleaseNotes, openAiChangelog } from './changelogs.ts';

export interface AdapterResult {
  items: FeedItem[];
  engagement: { url: string; type: 'points' | 'comments'; value: number }[];
}

export type Adapter = (
  env: Record<string, string | undefined>,
  opts: { userAgent?: string; limit?: number },
) => Promise<AdapterResult>;

const HN_API = 'https://hacker-news.firebaseio.com/v0';

async function hackerNews(
  listName: 'topstories' | 'showstories' | 'newstories',
  opts: { limit?: number; userAgent?: string },
): Promise<AdapterResult> {
  const limit = opts.limit ?? 60;
  const ids: number[] = await fetchJson(`${HN_API}/${listName}.json`, opts.userAgent);
  const slice = ids.slice(0, limit);

  const items: FeedItem[] = [];
  const engagement: AdapterResult['engagement'] = [];

  for (const id of slice) {
    const item = await fetchJson<any>(`${HN_API}/item/${id}.json`, opts.userAgent).catch(() => null);
    if (!item || item.dead || item.deleted || item.type !== 'story') continue;

    const discussionUrl = `https://news.ycombinator.com/item?id=${id}`;
    // Ask HN and text posts have no external URL; the discussion IS the story.
    const link = item.url ? canonicalizeUrl(item.url)?.url ?? discussionUrl : discussionUrl;

    items.push({
      title: String(item.title ?? ''),
      link,
      guid: String(id),
      summary: String(item.text ?? ''),
      content: String(item.text ?? ''),
      author: item.by ?? null,
      publishedAt: item.time ? new Date(item.time * 1000) : null,
      enclosureTypes: [],
      categories: [],
      outboundLinks: item.url ? [item.url] : [],
    });

    if (typeof item.score === 'number') {
      engagement.push({ url: link, type: 'points', value: item.score });
    }
    if (typeof item.descendants === 'number') {
      engagement.push({ url: link, type: 'comments', value: item.descendants });
    }
  }

  return { items, engagement };
}

async function fetchJson<T = any>(url: string, userAgent?: string): Promise<T> {
  const res = await fetch(url, {
    headers: userAgent ? { 'user-agent': userAgent } : {},
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const ADAPTERS: Record<string, Adapter> = {
  'Hacker News': (_env, opts) => hackerNews('topstories', opts),
  'Show HN': (_env, opts) => hackerNews('showstories', opts),
  // Two announcement channels that are not feeds. Both produced ZERO stories
  // through the ordinary path while reporting themselves healthy -- see the
  // note at the top of changelogs.ts for what each was doing instead.
  'Google Cloud release notes': (_env, opts) => googleCloudReleaseNotes(opts),
  'OpenAI changelog': (_env, opts) => openAiChangelog(opts),
};

/**
 * Declared but not yet implemented. Named explicitly so the poller can pause
 * them with an honest reason instead of retrying a shape it cannot read.
 */
export const PLANNED_ADAPTERS = [
  'Bluesky (tech feed)', 'Fosstodon', 'Hachyderm', 'infosec.exchange', 'mastodon.social',
  'Product Hunt', 'Reddit (programming clusters)',
  'npm registry', 'crates.io', 'RubyGems', 'Go package index', 'Maven Central', 'NuGet',
  'NVD CVE feed', 'CISA Known Exploited Vulnerabilities', 'EPSS', 'OSV.dev',
  'GitHub Security Advisories', 'arXiv cs',
  'Cloudflare status', 'AWS Health Dashboard', 'GitHub status', 'Google Cloud status',
  'G2', 'Trustpilot',
];

export function adapterFor(sourceName: string): Adapter | null {
  return ADAPTERS[sourceName] ?? null;
}

export function isPlanned(sourceName: string): boolean {
  return PLANNED_ADAPTERS.includes(sourceName);
}

// HTTP fetching with the rules that apply to every source (spec 2.3).
//
// The single most important property here is failure isolation: one dead feed
// must never stall a cycle. Every error path returns a FetchResult rather than
// throwing, and the caller records it against the source and moves on.

import { countSubrequest } from '../lib/subrequests.ts';

export interface FetchOptions {
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  userAgent?: string;
  accept?: string;
  /** Extra request headers, merged last. Used by the on-demand article reader. */
  headers?: Record<string, string>;
}

export type FetchOutcome =
  | { kind: 'ok'; status: number; body: string; etag: string | null; lastModified: string | null; bytes: number; durationMs: number; finalUrl: string; contentType: string | null }
  | { kind: 'not_modified'; status: 304; durationMs: number }
  | { kind: 'rate_limited'; status: number; retryAfterSeconds: number | null; durationMs: number }
  | { kind: 'error'; status: number | null; error: string; durationMs: number };

const DEFAULT_UA = 'NewsTrack/0.1 (+https://example.invalid/about)';
const DEFAULT_TIMEOUT = 20_000;

export async function fetchConditional(url: string, opts: FetchOptions = {}): Promise<FetchOutcome> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);

  try {
    const headers: Record<string, string> = {
      'user-agent': opts.userAgent ?? DEFAULT_UA,
      accept: opts.accept ?? 'application/atom+xml, application/rss+xml, application/xml;q=0.9, application/json;q=0.8, text/html;q=0.7, */*;q=0.5',
      'accept-encoding': 'gzip, deflate',
    };
    // Conditional GET. Feeds that honour this cost one header exchange instead of
    // a full body, which is most of why 1,150 feeds fit in a free tier at all.
    if (opts.etag) headers['if-none-match'] = opts.etag;
    if (opts.lastModified) headers['if-modified-since'] = opts.lastModified;
    for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;

    // Counts against the Worker invocation's subrequest allowance.
    countSubrequest();
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    const durationMs = Date.now() - started;

    if (res.status === 304) return { kind: 'not_modified', status: 304, durationMs };

    if (res.status === 429 || res.status === 503) {
      const ra = res.headers.get('retry-after');
      return {
        kind: 'rate_limited',
        status: res.status,
        retryAfterSeconds: ra ? parseRetryAfter(ra) : null,
        durationMs,
      };
    }

    if (!res.ok) {
      return { kind: 'error', status: res.status, error: `HTTP ${res.status}`, durationMs };
    }

    const body = await decodeBody(res);
    return {
      kind: 'ok',
      status: res.status,
      body,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      bytes: body.length,
      durationMs,
      finalUrl: res.url || url,
      contentType: res.headers.get('content-type'),
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    // Chinese sources time out intermittently from US infrastructure. That is
    // normal, not a bug, and must not escalate the source to 'dead' quickly.
    return {
      kind: 'error',
      status: null,
      error: controller.signal.aborted ? `timeout after ${opts.timeoutMs ?? DEFAULT_TIMEOUT}ms` : message,
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseRetryAfter(value: string): number | null {
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - Date.now()) / 1000)) : null;
}

/**
 * Charset handling. Japanese and Chinese feeds still ship Shift_JIS, EUC-JP and
 * GB18030; decoding those as UTF-8 produces mojibake that survives all the way
 * into the archive, so the charset is read from the header first and the XML
 * declaration second.
 */
async function decodeBody(res: Response): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer());
  const headerCharset = /charset=["']?([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1];

  let charset = headerCharset?.toLowerCase();
  if (!charset) {
    const head = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(buf.slice(0, 1024));
    charset = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase()
      ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  }

  if (!charset || charset === 'utf-8' || charset === 'utf8') {
    return new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(buf);
  }
  try {
    return new TextDecoder(charset, { fatal: false, ignoreBOM: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(buf);
  }
}

/**
 * Per-domain politeness. Sources are polled in parallel across shards, so two
 * feeds on the same host can otherwise be hit simultaneously; arXiv in particular
 * asks for 3 seconds between requests and means it.
 */
export class PolitenessGate {
  private lastHit = new Map<string, number>();
  private readonly defaultIntervalMs: number;

  // Plain field assignment rather than a parameter property: Node's type
  // stripping runs these files directly and does not support the shorthand.
  constructor(defaultIntervalMs = 2000) {
    this.defaultIntervalMs = defaultIntervalMs;
  }

  async wait(domain: string, intervalMs?: number): Promise<void> {
    const interval = intervalMs ?? this.defaultIntervalMs;
    const last = this.lastHit.get(domain);
    const now = Date.now();
    if (last !== undefined) {
      const elapsed = now - last;
      if (elapsed < interval) await sleep(interval - elapsed);
    }
    this.lastHit.set(domain, Date.now());
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Feed autodiscovery. Feed URLs are never hardcoded blindly: the registry seeds
 * a site URL and the real feed is resolved from <link rel="alternate"> and then
 * stored. Common paths are a fallback for sites that do not advertise.
 */
export function discoverFeedLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkRe) ?? []) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["']?application\/(rss|atom|feed)\+?(xml|json)/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      out.push(new URL(href, pageUrl).toString());
    } catch {
      /* malformed href, skip */
    }
  }
  return out;
}

export const COMMON_FEED_PATHS = [
  '/feed', '/feed/', '/rss', '/rss.xml', '/feed.xml', '/atom.xml',
  '/index.xml', '/feeds/posts/default', '/blog/feed', '/feed/atom',
];

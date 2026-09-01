// Learning resources: propose, then verify.
//
//   npm run resources                 seed curated + derived, then verify new ones
//   npm run resources -- --verify     re-check what is already stored
//   npm run resources -- --stale 30   re-check anything not checked in 30 days
//
// Nothing is shown on the strength of a URL pattern. `devdocs.io/rust` exists
// and `devdocs.io/some-tool` does not, and there is no way to know which without
// asking -- so every candidate is fetched, and one that does not answer is kept
// with its status rather than displayed. A dead link is worse than an absent
// one: the reader has to click it to find out.

import { createDb, type Db } from '../src/db/client.ts';
import { applyStoredSettings } from '../src/db/repos/settings.ts';
import { configureFromEnv, getConfig } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { mapWithConcurrency } from '../src/lib/pool.ts';
import { PolitenessGate } from '../src/collect/fetcher.ts';
import { CURATED, DERIVED, DEVDOCS_INDEX } from '../seeds/resources.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const db = createDb(url);
await applyStoredSettings(db);

const verifyOnly = process.argv.includes('--verify');
const staleDays = Number(arg('stale') ?? 0);
const limit = Number(arg('limit') ?? 400);

interface StackRow {
  slug: string;
  name: string;
  category: string;
  repo_url: string | null;
  homepage_url: string | null;
}

// --- seeding ------------------------------------------------------------------

/**
 * What DevDocs actually hosts, asked once.
 *
 * The first run guessed at 700 devdocs.io URLs to find nine. DevDocs publishes
 * the whole list, so the question becomes "which of ours does it have" -- one
 * request instead of several hundred aimed at one host, and no wrong guesses to
 * verify away afterwards.
 */
async function devdocsIndex(): Promise<Map<string, { slug: string; name: string }>> {
  const out = new Map<string, { slug: string; name: string }>();
  try {
    const res = await fetch(DEVDOCS_INDEX, { headers: { 'user-agent': 'NewsTrack/0.1' } });
    if (!res.ok) return out;
    const docs = await res.json() as { name: string; slug: string }[];
    for (const d of docs) {
      // Versioned sets are "rust~1.70"; the bare form is the current one.
      const base = d.slug.split('~')[0] ?? d.slug;
      const key = d.name.toLowerCase();
      if (!out.has(key)) out.set(key, { slug: base, name: d.name });
      if (!out.has(base)) out.set(base, { slug: base, name: d.name });
    }
  } catch (err) {
    console.warn(`devdocs index unavailable (${err instanceof Error ? err.message : err})`);
  }
  return out;
}

async function seed(): Promise<{ curated: number; derived: number }> {
  const stacks = await db.query<StackRow & { aliases: string[] }>(
    `SELECT slug, name, category, repo_url, homepage_url, aliases FROM stacks ORDER BY slug`);
  const devdocs = await devdocsIndex();
  console.log(`devdocs index: ${devdocs.size} keys`);

  let curated = 0;
  let derived = 0;

  for (const stack of stacks) {
    const rows: {
      kind: string; title: string; url: string; provider: string;
      free: boolean; origin: string; order: number;
    }[] = [];

    for (const [i, r] of (CURATED[stack.slug] ?? []).entries()) {
      rows.push({
        kind: r.kind, title: r.title, url: r.url,
        provider: r.provider ?? 'official',
        free: r.free ?? true, origin: 'curated', order: r.order ?? i,
      });
    }

    // DevDocs, matched by name or by any alias rather than guessed at.
    const dd = [stack.slug, stack.name.toLowerCase(), ...(stack.aliases ?? []).map((a) => a.toLowerCase())]
      .map((k) => devdocs.get(k))
      .find(Boolean);
    if (dd) {
      rows.push({
        kind: 'reference', title: `${dd.name} on DevDocs`,
        url: `https://devdocs.io/${dd.slug}/`, provider: 'DevDocs',
        free: true, origin: 'derived', order: 210,
      });
    }

    for (const p of DERIVED) {
      const candidate = p.url(stack.slug, {
        repoUrl: stack.repo_url, homepageUrl: stack.homepage_url, category: stack.category,
      });
      if (!candidate) continue;
      // A curated link to the same place always wins: it has a better title.
      if (rows.some((r) => r.url === candidate)) continue;
      rows.push({
        kind: p.kind, title: p.title(stack.name), url: candidate,
        provider: p.provider, free: true, origin: 'derived', order: p.order,
      });
    }

    for (const r of rows) {
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO stack_resources (stack_slug, kind, title, url, provider, free, origin, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (stack_slug, url) DO UPDATE
            SET title = EXCLUDED.title, kind = EXCLUDED.kind,
                provider = EXCLUDED.provider, sort_order = EXCLUDED.sort_order
         RETURNING id::text`,
        [stack.slug, r.kind, r.title, r.url, r.provider, r.free, r.origin, r.order]);
      if (inserted.length) {
        if (r.origin === 'curated') curated++;
        else derived++;
      }
    }
  }

  return { curated, derived };
}

// --- verification -------------------------------------------------------------

const politeness = new PolitenessGate(700);

/**
 * Ask whether a URL answers.
 *
 * HEAD first because it is the cheap question, then GET for the many hosts that
 * refuse HEAD but serve the page perfectly well. A browser user agent, because
 * this is a one-off check of a link a person will click, and a documentation
 * site that answers a browser and refuses a library is not telling us the page
 * is missing.
 */
async function check(target: string, retried = false): Promise<{ status: number | null; error: string | null }> {
  let host = '';
  try {
    host = new URL(target).hostname;
  } catch {
    return { status: null, error: 'not a URL' };
  }

  const headers = {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/131.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
  };

  for (const method of ['HEAD', 'GET'] as const) {
    await politeness.wait(host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(getConfig().fetch.timeoutMs, 12_000));
    try {
      const res = await fetch(target, {
        method, headers, redirect: 'follow', signal: controller.signal,
      });
      // A HEAD that is refused says nothing about the page. Several hosts answer
      // 403 or even 404 to HEAD and serve the same URL happily to GET --
      // portswigger.net and codeberg.org both do -- so anything other than a
      // success from HEAD is re-asked properly before it is believed.
      if (method === 'HEAD' && (res.status < 200 || res.status >= 400)) continue;
      if (res.status === 405 || res.status === 501) continue;
      return { status: res.status, error: null };
    } catch (err) {
      if (method === 'GET') {
        if (!retried) {
          // One retry before believing a network failure. Transient beats
          // permanent in the other direction far too often.
          return check(target, true);
        }
        return {
          status: null,
          error: controller.signal.aborted ? 'timeout' : err instanceof Error ? err.message : String(err),
        };
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: null, error: 'no response' };
}

/**
 * Verification outcomes are three, not two.
 *
 *   answered      2xx/3xx        show it
 *   refused       4xx/5xx        do not show a derived link; a curated one is
 *                                still a human's judgement about a real page
 *   unreachable   no response    proves nothing at all
 *
 * developer.android.com came back "fetch failed" on the first run. It is not
 * missing; the request failed. Treating that as a dead link would have hidden
 * the Android documentation because of one flaky moment on this machine.
 */
async function verify(where: string, params: unknown[]): Promise<{ ok: number; dead: number }> {
  const rows = await db.query<{ id: string; url: string; stack_slug: string; title: string }>(
    `SELECT id::text, url, stack_slug, title FROM stack_resources
      ${where} ORDER BY verified_at NULLS FIRST LIMIT ${limit}`, params);

  if (rows.length === 0) return { ok: 0, dead: 0 };
  console.log(`verifying ${rows.length} links…`);

  let ok = 0;
  let dead = 0;
  let unreachable = 0;

  // Six at a time: politeness is per host, so the concurrency is across hosts.
  await mapWithConcurrency(rows, 6, async (row) => {
    const result = await check(row.url);
    const good = result.status !== null && result.status >= 200 && result.status < 400;
    if (good) ok++;
    else if (result.status === null) unreachable++;
    else dead++;

    await db.query(
      `UPDATE stack_resources SET http_status = $2, last_error = $3, verified_at = now()
        WHERE id = $1::uuid`,
      [row.id, result.status, result.error]);

    if (!good) {
      const label = result.status === null ? 'unreach' : 'dead';
      console.log(`  ${label.padEnd(7)} ${String(result.status ?? result.error).padEnd(14)} ${row.stack_slug}: ${row.url}`);
    }
  });

  if (unreachable) {
    console.log(`  (${unreachable} unreachable — a network failure is not a 404, see below)`);
  }
  return { ok, dead };
}

// --- run ----------------------------------------------------------------------

if (!verifyOnly) {
  const seeded = await seed();
  console.log(`seeded: ${seeded.curated} curated, ${seeded.derived} derived`);
}

const filter = verifyOnly && staleDays > 0
  ? { where: `WHERE verified_at IS NULL OR verified_at < now() - ($1 || ' days')::interval`, params: [String(staleDays)] }
  : verifyOnly
    ? { where: '', params: [] }
    : { where: 'WHERE verified_at IS NULL', params: [] };

const result = await verify(filter.where, filter.params);
console.log(`verified: ${result.ok} answered, ${result.dead} did not`);

const [summary] = await db.query<{ live: string; dead: string; unchecked: string; stacks: string }>(
  `SELECT count(*) FILTER (WHERE http_status BETWEEN 200 AND 399)::text AS live,
          count(*) FILTER (WHERE verified_at IS NOT NULL
                             AND (http_status IS NULL OR http_status >= 400))::text AS dead,
          count(*) FILTER (WHERE verified_at IS NULL)::text AS unchecked,
          count(DISTINCT stack_slug) FILTER (WHERE http_status BETWEEN 200 AND 399)::text AS stacks
     FROM stack_resources`);
console.log(
  `resources: ${summary?.live ?? 0} live · ${summary?.dead ?? 0} dead · ` +
  `${summary?.unchecked ?? 0} unchecked · covering ${summary?.stacks ?? 0} technologies`);

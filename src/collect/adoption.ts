// How widely a technology is actually used, measured rather than asserted.
//
// The technology page used to lead with a histogram of how often THIS ARCHIVE
// mentioned the thing. For C++ that was nine years of empty buckets and one
// spike at the right-hand end -- a picture of the observer, not the subject.
//
// The honest available answer to "how big is this" is how many public projects
// carry its GitHub topic. The slugs land on GitHub topics directly, which is
// not luck: much of this vocabulary was imported from GitHub topics.
//
// WHAT THIS DOES NOT MEASURE
//
// Developers. Nobody has that number -- not GitHub, not Stack Overflow, not
// libraries.io -- and the closest available proxies each measure something
// else: stars are interest in one repository, questions are confusion, and
// downloads are continuous integration. Each is stored under its own name or
// not at all. See 0048.

import type { Db } from '../db/client.ts';

export interface AdoptionReport {
  /** Technologies whose numbers were refreshed. */
  measured: number;
  /** Technologies GitHub has no topic for -- recorded as zero, not as failure. */
  absent: number;
  /** Attempts that failed for a reason other than absence. */
  failed: number;
  /** Set when the pass did not run at all, with the reason. */
  skipped?: string;
  /** Requests spent, so the rate limit is visible in the job note. */
  requests: number;
}

export interface AdoptionOptions {
  /** How many technologies to refresh in one pass. */
  limit?: number;
  token?: string;
  userAgent?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /** Refresh anything measured longer ago than this. */
  staleAfterHours?: number;
}

interface Due {
  id: string;
  slug: string;
  repo_url: string | null;
}

/**
 * GitHub's SEARCH quota is 30 requests a minute, and it is counted separately
 * from the 5,000-an-hour core quota. That is the binding constraint on this
 * whole feature, so the default slice is sized to fit inside one minute with
 * room to spare rather than to finish the registry quickly.
 *
 * At 20 per run on a 15-minute cadence, 1,361 technologies come round roughly
 * every 17 hours. An adoption figure is not a number that moves in an hour, so
 * that is not a compromise -- it is the correct rate to ask at.
 */
export const SLICE = 20;
export const SEARCH_PER_MINUTE = 30;
/** A measurement older than this is due again. */
export const STALE_AFTER_HOURS = 24 * 7;

/**
 * A topic search costs one request and answers the only question that matters,
 * so it is the one call made per technology. `per_page=1` because the repos
 * themselves are not wanted -- only `total_count`.
 */
function topicUrl(slug: string): string {
  const u = new URL('https://api.github.com/search/repositories');
  u.searchParams.set('q', `topic:${slug}`);
  u.searchParams.set('per_page', '1');
  return u.toString();
}

/** owner/repo out of a GitHub URL, or null when repo_url is somewhere else. */
export function githubRepo(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts as [string, string];
    return `${owner}/${repo.replace(/\.git$/, '')}`;
  } catch {
    return null;
  }
}

export async function refreshAdoption(
  db: Db,
  opts: AdoptionOptions = {},
): Promise<AdoptionReport> {
  const report: AdoptionReport = { measured: 0, absent: 0, failed: 0, requests: 0 };

  const token = opts.token ?? process.env.GITHUB_TOKEN;
  if (!token) {
    // Unauthenticated search is 10 requests a minute and shared with everything
    // else on this IP. Saying so beats burning the allowance to learn nothing.
    report.skipped = 'GITHUB_TOKEN is not set, so no adoption figure was refreshed.';
    return report;
  }

  const limit = Math.min(opts.limit ?? SLICE, SEARCH_PER_MINUTE);
  const stale = opts.staleAfterHours ?? STALE_AFTER_HOURS;
  const doFetch = opts.fetchImpl ?? fetch;

  // Least recently measured first, never-measured before stale, and a failing
  // technology backs off so a permanently absent topic does not crowd out the
  // ones that have never been asked about.
  const due = await db.query<Due>(
    `SELECT s.id::text, s.slug, s.repo_url
       FROM stacks s
       LEFT JOIN stack_adoption a ON a.stack_id = s.id
      -- Both halves parenthesised deliberately. AND binds tighter than OR, so
      -- without the brackets this reads "never measured, OR (stale AND not
      -- backing off)" -- and a never-measured technology that fails every time
      -- is never measured and never backing off, so it would return in every
      -- slice forever and crowd out everything that has not been asked yet.
      WHERE (a.measured_at IS NULL
             OR a.measured_at < now() - make_interval(hours => $2))
        AND (a.failed_at IS NULL
             OR a.failed_at < now() - make_interval(hours => least(a.failures, 12) * 6))
      ORDER BY a.measured_at ASC NULLS FIRST, s.slug
      LIMIT $1`,
    [limit, stale],
  );
  if (due.length === 0) return report;

  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': opts.userAgent ?? 'newstrack-adoption',
  };

  for (const stack of due) {
    try {
      const res = await doFetch(topicUrl(stack.slug), { headers });
      report.requests++;

      if (res.status === 403 || res.status === 429) {
        // The search quota is gone. Stop the pass rather than spending the rest
        // of it collecting 403s -- the remaining technologies are still due and
        // the next run picks them up.
        report.skipped = `GitHub search quota exhausted after ${report.requests} request(s).`;
        break;
      }
      if (!res.ok) throw new Error(`search http ${res.status}`);

      const body = await res.json() as { total_count?: number };
      const projects = typeof body.total_count === 'number' ? body.total_count : null;
      if (projects === null) throw new Error('search returned no total_count');

      // Stars come from the core quota (5,000 an hour), so they are effectively
      // free next to the search call and are only asked for where repo_url
      // actually names a GitHub repository.
      let stars: number | null = null;
      const repo = githubRepo(stack.repo_url);
      if (repo) {
        const r = await doFetch(`https://api.github.com/repos/${repo}`, { headers });
        report.requests++;
        if (r.ok) {
          const info = await r.json() as { stargazers_count?: number };
          stars = typeof info.stargazers_count === 'number' ? info.stargazers_count : null;
        }
      }

      await record(db, stack.id, projects, stars);
      if (projects === 0) report.absent++;
      report.measured++;
    } catch (err) {
      report.failed++;
      await recordFailure(db, stack.id, err instanceof Error ? err.message : String(err));
    }
  }

  return report;
}

async function record(
  db: Db, stackId: string, projects: number, stars: number | null,
): Promise<void> {
  await db.query(
    `INSERT INTO stack_adoption (stack_id, projects, stars, measured_at, failed_at, failures, note)
     VALUES ($1::uuid, $2, $3, now(), NULL, 0, NULL)
     ON CONFLICT (stack_id) DO UPDATE
        SET projects = EXCLUDED.projects,
            -- A repo that has stopped being reachable must not silently keep
            -- yesterday's star count under today's date.
            stars = EXCLUDED.stars,
            measured_at = now(), failed_at = NULL, failures = 0, note = NULL`,
    [stackId, projects, stars],
  );
}

async function recordFailure(db: Db, stackId: string, note: string): Promise<void> {
  await db.query(
    `INSERT INTO stack_adoption (stack_id, failed_at, failures, note)
     VALUES ($1::uuid, now(), 1, $2)
     ON CONFLICT (stack_id) DO UPDATE
        SET failed_at = now(),
            failures = stack_adoption.failures + 1,
            note = EXCLUDED.note`,
    [stackId, note.slice(0, 300)],
  );
}

/** One line for the job note. */
export function summariseAdoption(r: AdoptionReport): string {
  if (r.skipped && r.measured === 0) return r.skipped;
  const bits: string[] = [];
  if (r.measured) bits.push(`${r.measured} measured`);
  if (r.absent) bits.push(`${r.absent} with no topic`);
  if (r.failed) bits.push(`${r.failed} failed`);
  if (r.requests) bits.push(`${r.requests} request(s)`);
  if (r.skipped) bits.push(r.skipped);
  return bits.join(', ');
}

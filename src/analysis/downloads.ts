// Adoption as a MEASUREMENT, across the whole registry rather than six packages.
//
// Asked for on 2026-09-10: "I think the news scope isn't still wide and the
// report are focus on news analysis. The target of report is recognizing market
// change and finding new market."
//
// THE OBJECTION IS RIGHT, AND HERE IS THE NUMBER. Measured that morning:
//
//   stories classified `market`     35 of 5,993   (0.6%)
//   sources of kind 'news'          510 of 512
//   stacks with a GitHub repo       1,038
//   ...with an adoption curve       6
//
// The 35 is a SOURCING number, not a parsing one: classifyEvent reads funding
// and acquisition out of a headline with rules and no model, and does it well.
// The archive simply does not subscribe to the places funding is announced.
//
// So the only real market instrument in the system was pointed at six packages,
// and everything else on a report was a sentence about a news article. A report
// built on that can only ever be news analysis wearing the word "market".
//
// WHY IT WAS SIX. `gatherOutside` resolves packages for the subjects of the day
// it is briefing, capped at `subjectCap` (6) so one report does not spend its
// afternoon on registry lookups. That cap is right for a report and wrong for a
// catalogue: it means the archive only ever learns about a package on a day a
// story happens to name it, and only six of those a day.
//
// So resolution and series-fetching move OUT of the report and into their own
// jobs, walking the whole registry at a polite rate. The report then reads a
// table that is already full instead of filling it six rows at a time.
//
// WHAT THIS BUYS THAT NEWS CANNOT. A download series is the one signal here
// that is a magnitude, is published by somebody else, is checkable by anybody,
// and exists whether or not a journalist wrote about it. Across hundreds of
// packages it answers two questions no amount of reading answers:
//
//   MARKET CHANGE   what is being installed more, and less, than it was.
//   NEW MARKET      what has gone from nothing to something -- a package with a
//                   small base and a steep curve is a market forming, and it is
//                   usually months ahead of the funding round that announces it.
//
// EVERY CALL HERE IS KEYLESS: registry.npmjs.org, pypi.org, crates.io and
// api.npmjs.org/pypistats all answer without a credential. That matters because
// this has to run unattended, and a key is a thing that expires while nobody is
// looking.

import type { Db } from '../db/client.ts';
import {
  resolvePackage, fetchSeries, saveSeries, OUTSIDE_DAYS, type Registry,
} from './outside.ts';

/**
 * How many unresolved technologies to look up per run.
 *
 * A resolution costs up to six requests -- two candidate names against three
 * registries -- and 1,038 technologies have a repository to verify against. At
 * twenty every five minutes the registry comes round in about four days, and
 * the answer is cached for ever afterwards, so this is a one-time walk that
 * then only picks up newly added technologies.
 *
 * Deliberately not faster. Nothing here is urgent: an adoption curve does not
 * move in an afternoon, and these are free public APIs run by volunteers and
 * foundations. The rate is what it is out of manners, not because a limit was
 * hit.
 */
export const RESOLVE_BATCH = 20;

/**
 * How many series to refresh per run.
 *
 * One request each. Spread over the day this keeps every resolved package
 * within a day of current, which is the resolution the curves are drawn at.
 */
export const SERIES_BATCH = 40;

/** How stale a series may be before it is refreshed. */
const SERIES_STALE_HOURS = 20;

export interface ResolveResult {
  tried: number;
  resolved: number;
  refused: number;
  remaining: number;
}

/**
 * Look up the next batch of technologies that have a repository and no answer.
 *
 * ORDERED BY WHETHER THE ARCHIVE HAS EVER SEEN THE TECHNOLOGY, most-seen first.
 * The registry holds 2,460 technologies and the archive has stories about a few
 * hundred of them; a curve for something nobody writes about is worth having
 * eventually and worth having later than a curve for something on today's page.
 */
export async function resolveBacklog(
  db: Db, batch = RESOLVE_BATCH,
): Promise<ResolveResult> {
  const rows = await db.query<{ slug: string }>(
    `SELECT s.slug
       FROM stacks s
       LEFT JOIN adoption_lookup l ON l.slug = s.slug
      WHERE l.slug IS NULL
        AND s.repo_url ILIKE '%github.com%'
      ORDER BY (
        SELECT count(*) FROM stories st
         WHERE st.superseded_by IS NULL AND st.stacks && ARRAY[s.slug]
      ) DESC, s.slug
      LIMIT $1`, [batch]);

  let resolved = 0;
  let refused = 0;
  for (const r of rows) {
    // resolvePackage writes its own answer -- a hit or an explained miss -- so
    // a technology is never looked up twice however this loop ends.
    const got = await resolvePackage(db, r.slug);
    if (got) resolved += 1;
    else refused += 1;
  }

  const [left] = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM stacks s LEFT JOIN adoption_lookup l ON l.slug = s.slug
      WHERE l.slug IS NULL AND s.repo_url ILIKE '%github.com%'`);

  return { tried: rows.length, resolved, refused, remaining: Number(left?.n ?? 0) };
}

export interface SeriesResult {
  fetched: number;
  points: number;
  empty: number;
}

/**
 * Refresh the series for resolved packages whose curve is going stale.
 *
 * Oldest first, so a package that has never been fetched is always ahead of one
 * fetched yesterday and the backlog drains in a predictable order.
 */
export async function refreshSeries(
  db: Db, batch = SERIES_BATCH,
): Promise<SeriesResult> {
  const rows = await db.query<{ slug: string; registry: string; package: string }>(
    `SELECT l.slug, l.registry, l.package
       FROM adoption_lookup l
      WHERE l.missing = false AND l.registry IS NOT NULL AND l.package IS NOT NULL
      ORDER BY (
        SELECT max(a.fetched_at) FROM adoption_series a
         WHERE a.slug = l.slug
      ) ASC NULLS FIRST
      LIMIT $1`, [batch]);

  const to = new Date();
  const from = new Date(to.getTime() - OUTSIDE_DAYS * 86_400_000);
  let points = 0;
  let empty = 0;
  let fetched = 0;

  for (const r of rows) {
    // Skip anything already fresh: the ordering puts stale first, so the first
    // fresh row means the rest of the batch is fresh too.
    const [last] = await db.query<{ age_hours: number | null }>(
      `SELECT extract(epoch FROM (now() - max(fetched_at))) / 3600 AS age_hours
         FROM adoption_series WHERE slug = $1`, [r.slug]);
    if (last?.age_hours !== null && last?.age_hours !== undefined
      && Number(last.age_hours) < SERIES_STALE_HOURS) break;

    const got = await fetchSeries(r.registry as 'npm' | 'pypi' | 'crates',
      r.package, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    fetched += 1;
    if (got.length === 0) { empty += 1; continue; }
    await saveSeries(db, r.registry as Registry, r.package, r.slug, got);
    points += got.length;
  }

  return { fetched, points, empty };
}

export function summariseResolve(r: ResolveResult): string {
  if (r.tried === 0) return `nothing left to resolve (${r.remaining} pending)`;
  return `${r.tried} looked up: ${r.resolved} verified, ${r.refused} refused; `
    + `${r.remaining} still to try`;
}

export function summariseSeries(r: SeriesResult): string {
  if (r.fetched === 0) return 'every series is current';
  return `${r.fetched} series refreshed, ${r.points} points`
    + (r.empty > 0 ? `, ${r.empty} returned nothing` : '');
}

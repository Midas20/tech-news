// The market, measured -- not the news about the market.
//
// Asked for on 2026-09-10: "I think the news scope isn't still wide and the
// report are focus on news analysis. The target of report is recognizing market
// change and finding new market."
//
// Every other analysis in this repository starts from a story somebody wrote.
// That is the ceiling the objection is pointing at: a report assembled from
// articles is a report about what got written, and what got written is a fact
// about 512 feeds.
//
// AND THE CLASSIFIER IS NOT THE PROBLEM, which is worth stating because it was
// the first place I looked and it was wrong. `classifyEvent` in
// collect/eventful.ts reads funding, acquisition and position out of a headline
// with rules and no model at all -- tests/market.test.ts is a long record of it
// being taught to. Only 35 of 5,993 stories are `market` because the archive
// hardly ever COLLECTS a funding story: 510 of its 512 sources are `kind =
// 'news'` and almost all of them are engineering and vendor blogs. Widening
// the beat is a sourcing job, not a parsing one.
//
// This module takes the other road entirely.
//
// THIS MODULE NEVER READS A STORY. It reads daily download counts published by
// PyPI and npm, which exist whether or not a journalist noticed, are checkable
// by anybody against the same public API, and move before the coverage does.
//
// The two questions, and why they need different arithmetic:
//
//   MARKET CHANGE   What is being installed more, or less, than it was? This is
//                   a comparison of two means on the SAME package, so the units
//                   cancel and a percentage is meaningful.
//
//   NEW MARKET      What has gone from nothing to something? This is NOT the
//                   top of the percentage list. A package going 40/day -> 400
//                   is +900% and is one CI pipeline being switched on; a
//                   package going 8,000/day -> 60,000 is +650% and is a tool
//                   people are adopting. So a forming market needs a floor
//                   under the LATER end -- enough volume to be real -- with the
//                   earlier end small enough that it is genuinely new.
//
// WHAT THIS STILL CANNOT SEE, said here rather than discovered later: a package
// registry is not the market. Anything sold rather than installed -- a SaaS
// product, a database with a licence, a consultancy -- has no curve at all, and
// three of the four biggest movements in technology are invisible to it. This
// is one instrument, it is honest about what it measures, and it is the only
// one here whose numbers were not written by somebody with an interest.

import type { Query } from './corpus.ts';
import { q } from '../ui/db.ts';
import { detectCohortBreak, ZERO_IS_MISSING, type CohortBreak } from './period.ts';

/** Days averaged at each end. A whole multiple of 7: downloads are weekly. */
export const EDGE = 28;

/**
 * The smallest daily volume that can count as a market.
 *
 * Below a few thousand installs a day a curve is one team's build server, and
 * its percentage swings are enormous and meaningless. This is a floor on being
 * REAL, not on being big -- it is set low enough that a genuinely forming tool
 * clears it long before anybody writes about it.
 */
export const FLOOR = 2_000;

/**
 * The largest earlier volume that can still count as NEW.
 *
 * A package already shipping a hundred thousand a day is not a new market
 * however fast it is growing; it is an established one having a good quarter.
 */
export const NEW_CEILING = 60_000;

/** How much growth makes a market "forming" rather than merely healthy. */
export const NEW_GROWTH = 60;

export interface Move {
  slug: string;
  registry: string;
  package: string;
  /** Mean daily downloads over the earlier window. */
  before: number;
  /** Mean daily downloads over the later window. */
  after: number;
  changePct: number;
  fromDay: string;
  toDay: string;
  days: number;
  /** Days averaged at each end. Shorter than EDGE after a measurement break. */
  edge: number;
}

export interface MarketPicture {
  /** Every package with enough series to compare, by size of move. */
  moves: Move[];
  /** Growing from a small base: a market forming. */
  forming: Move[];
  /** The largest declines. Losing a market is a market change too. */
  fading: Move[];
  /** Set when a registry-wide step forced the window to move after it. */
  shift: CohortBreak | null;
  /** Days averaged at each end of the comparison actually used. */
  edge: number;
  /** Packages that had a series but too little of it to compare. */
  tooThin: number;
  measuredTo: string | null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Compare the last `EDGE` days against the `EDGE` days before them.
 *
 * Both windows come from the END of the series rather than from a calendar
 * period, because this question is "what is happening now", not "what happened
 * in September". A calendar month would answer a different question and would
 * go stale for four weeks every time one ended.
 */
export function moveOf(
  slug: string, registry: string, pkg: string,
  points: Array<{ day: string; downloads: number }>,
  edge = EDGE,
): Move | null {
  if (edge < 7 || edge % 7 !== 0 || points.length < edge * 2) return null;
  const s = [...points].sort((a, b) => a.day.localeCompare(b.day));
  const late = s.slice(-edge);
  const early = s.slice(-edge * 2, -edge);
  const before = mean(early.map((p) => p.downloads));
  const after = mean(late.map((p) => p.downloads));
  if (before <= 0) return null;
  return {
    slug, registry, package: pkg, before, after,
    changePct: Math.round(((after - before) / before) * 100),
    fromDay: early[0]!.day, toDay: late[late.length - 1]!.day,
    days: edge * 2, edge,
  };
}

/**
 * The whole market, as far as this archive can measure it.
 *
 * Reads every verified package at once and runs the same cohort-break check the
 * period reports use: on 2026-08-25 every tracked package stepped down together
 * because PyPI changed how it counts, and a page that published that as a
 * market collapse would have been confidently, checkably wrong.
 */
export async function marketPicture(query: Query = q): Promise<MarketPicture> {
  const rows = await query<{ slug: string; registry: string; package: string;
    day: string; downloads: string }>(
    `SELECT a.slug, a.registry, a.package, a.day::text AS day,
            a.downloads::text AS downloads
       FROM adoption_series a
       JOIN adoption_lookup l ON l.slug = a.slug AND l.missing = false
        AND l.registry = a.registry AND l.package = a.package
      WHERE a.day >= (current_date - $1::int)
        AND ${ZERO_IS_MISSING}
      ORDER BY a.slug, a.day`, [EDGE * 2 + 7]);

  const bySlug = new Map<string, { registry: string; package: string;
    points: Array<{ day: string; downloads: number }> }>();
  for (const r of rows) {
    const at = bySlug.get(r.slug)
      ?? { registry: r.registry, package: r.package, points: [] };
    at.points.push({ day: r.day, downloads: Number(r.downloads) });
    bySlug.set(r.slug, at);
  }

  const shift = detectCohortBreak(new Map(
    [...bySlug].map(([slug, v]) => [slug, v.points])));

  // A BREAK VOIDS EVERY NUMBER THAT SPANS IT -- and the answer is to move the
  // window, not to blank the page.
  //
  // The step is in the instrument, so it is in every series and no subset
  // survives a comparison across it. But the days AFTER it are measured
  // consistently with each other, and so are the days before. On 2026-09-10 the
  // break was 2026-08-25, which sits inside the 56-day window this page
  // compares over: suppressing everything would have left the page empty until
  // late October, which is seven weeks of showing nothing while a perfectly
  // good short baseline existed.
  //
  // So a break shortens the window to the largest whole number of weeks that
  // fits entirely after it. The comparison gets weaker -- a 7-day baseline is
  // noisier than a 28-day one -- and it is honest, current, and says which it
  // is. The alternative is not a better number; it is no number.
  const from = shift ? shift.day : null;
  const usable = from
    ? new Map([...bySlug].map(([slug, v]) => [slug,
      { ...v, points: v.points.filter((p) => p.day >= from) }]))
    : bySlug;

  const span = Math.min(...[...usable.values()].map((v) => v.points.length));
  const edge = from
    ? Math.min(EDGE, Math.floor((Number.isFinite(span) ? span : 0) / 2 / 7) * 7)
    : EDGE;

  const moves: Move[] = [];
  let tooThin = 0;
  for (const [slug, v] of usable) {
    const m = edge >= 7 ? moveOf(slug, v.registry, v.package, v.points, edge) : null;
    if (m) moves.push(m); else tooThin += 1;
  }

  // Even the shortened window may not hold two whole weeks yet. Then there is
  // genuinely nothing to say, and the page says that rather than guessing.
  if (shift && moves.length === 0) {
    return { moves: [], forming: [], fading: [], shift, edge, tooThin, measuredTo: null };
  }

  const real = moves.filter((m) => m.after >= FLOOR || m.before >= FLOOR);
  const forming = real
    .filter((m) => m.before < NEW_CEILING && m.after >= FLOOR
      && m.changePct >= NEW_GROWTH)
    .sort((a, b) => b.changePct - a.changePct);
  const fading = real.filter((m) => m.changePct <= -20)
    .sort((a, b) => a.changePct - b.changePct);

  return {
    moves: real.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)),
    forming, fading, shift, edge, tooThin,
    measuredTo: moves[0]?.toDay ?? null,
  };
}

/** How much of the registry this instrument can actually see. */
export async function marketCoverage(query: Query = q): Promise<{
  tracked: number; resolved: number; withRepo: number; total: number;
}> {
  const [r] = await query<{ tracked: string; resolved: string;
    with_repo: string; total: string }>(
    `SELECT
       (SELECT count(DISTINCT slug)::text FROM adoption_series) AS tracked,
       (SELECT count(*)::text FROM adoption_lookup WHERE missing = false) AS resolved,
       (SELECT count(*)::text FROM stacks WHERE repo_url ILIKE '%github.com%') AS with_repo,
       (SELECT count(*)::text FROM stacks) AS total`);
  return {
    tracked: Number(r?.tracked ?? 0), resolved: Number(r?.resolved ?? 0),
    withRepo: Number(r?.with_repo ?? 0), total: Number(r?.total ?? 0),
  };
}

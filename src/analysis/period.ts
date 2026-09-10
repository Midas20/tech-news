// Reports over a week, a month and a year, and the day summary that leads them.
//
// Asked for on 2026-09-09, against a screenshot of /reports: "at the top of
// list, you have to display report that summary all day's news and about new
// market and things like tool, platform and so on. And make weekly report and
// month report. And generate a year's report by collecting all news."
//
// NO MODEL WRITES ANY OF THIS, and that is a decision rather than a shortcut.
// Three reasons, in the order they bind:
//
//   1. A YEAR DOES NOT FIT IN A PROMPT. The archive holds 5,461 stories back to
//      2010. Any model-written year report is really a report about whichever
//      slice was sampled, and the sampling would be the finding.
//
//   2. THE PROVIDERS ARE NOT THERE. Measured hours before this was written: the
//      daily report fired at 20:53:48 with cerebras, both Gemini tiers and groq
//      all inside a cooldown and no Anthropic key, so all fourteen fields
//      failed in 9.7 seconds. A monthly report that needs a model is a monthly
//      report that does not exist on the day you want it.
//
//   3. THE MATERIAL IS ALREADY WRITTEN. Every daily briefing in the period was
//      model-written once, cited, and checked by the pairing rule. Re-reading
//      the same stories to say the same thing again is a second chance to be
//      wrong, not a second opinion.
//
// So a period report COMPOSES. It carries three things, and each answers a
// different question a reader actually has:
//
//   WHAT APPEARED   launches, funding and acquisitions, and names this archive
//                   had never seen -- the pipeline's own verdicts, no model.
//                   This is the "new market and things like tool, platform"
//                   half of the ask.
//   WHAT MOVED      public download curves measured across the period. The only
//                   magnitudes on the page, and the only real trend: they are
//                   published by somebody else and anybody can re-run them.
//   WHAT WAS READ   the claims the daily readings already made, deduplicated.
//
// WHY NO STORY COUNTS ANYWHERE. Counting our own stories measures the feed
// list, not the world: "launches rose 40% this month" is a fact about which
// sources answered. Lists are shown and never totalled into a trend. The
// numbers on the page come from PyPI, npm and crates.io, which is the standing
// rule for this archive and the reason `movementOver` exists at all.

import type { Query } from './corpus.ts';
import { q } from '../ui/db.ts';
import { launches, marketMoves, newNames, type NewThing, type NewName } from './whatsnew.ts';

/** The spans a report can cover, longest last. */
export type Span = 'day' | 'week' | 'month' | 'year';

export const SPANS: Span[] = ['day', 'week', 'month', 'year'];

/** How many days each span covers, for the curve edges and the page copy. */
export const SPAN_DAYS: Record<Span, number> = {
  day: 1, week: 7, month: 30, year: 365,
};

export const SPAN_LABEL: Record<Span, string> = {
  day: 'day', week: 'week', month: 'month', year: 'year',
};

export interface Range { from: string; to: string; label: string }

const DAY_MS = 86_400_000;

function iso(d: Date): string {
  return d.toISOString();
}

/**
 * The calendar range a span key names.
 *
 * CALENDAR MONTHS AND YEARS, NOT ROLLING WINDOWS, for month and year. "Make a
 * month report" means September, not the last thirty days: a reader comparing
 * two of them needs the boundaries to be the same boundaries every time, and a
 * rolling window silently re-cuts the period on every view. Week is the seven
 * days ending on the given date, because there is no calendar week a reader of
 * this archive already thinks in.
 */
export function rangeFor(span: Span, key: string): Range | null {
  if (span === 'year') {
    if (!/^\d{4}$/.test(key)) return null;
    const y = Number(key);
    return { from: iso(new Date(Date.UTC(y, 0, 1))),
      to: iso(new Date(Date.UTC(y + 1, 0, 1))), label: key };
  }
  if (span === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) return null;
    const y = Number(m[1]); const mo = Number(m[2]) - 1;
    if (mo < 0 || mo > 11) return null;
    const start = new Date(Date.UTC(y, mo, 1));
    return { from: iso(start), to: iso(new Date(Date.UTC(y, mo + 1, 1))),
      label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const end = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;
  const days = span === 'day' ? 1 : 7;
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  const to = new Date(end.getTime() + DAY_MS);
  const nice = (d: Date) => d.toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return { from: iso(start), to: iso(to),
    label: days === 1
      ? end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      : `${nice(start)} – ${nice(end)} ${end.getUTCFullYear()}` };
}

// ---------------------------------------------------------------------------
// What moved, measured by somebody else
// ---------------------------------------------------------------------------

export interface PeriodMovement {
  slug: string;
  registry: string;
  package: string;
  before: number;
  after: number;
  changePct: number;
  fromDay: string;
  toDay: string;
  /** Days averaged at each end, so the reader can weigh the comparison. */
  edge: number;
}

/**
 * How wide each end of the comparison is.
 *
 * A QUARTER OF THE PERIOD, CAPPED AT 28 DAYS AND FLOORED AT 3. The daily
 * reading compares two 28-day means because it is asking about six months, and
 * 28 days of a seven-day period is the whole period twice. A quarter keeps the
 * two ends disjoint with a gap between them at every span, and the floor of
 * three exists because package downloads are violently weekly -- a Sunday is a
 * third of a Tuesday -- so a single day at each end would report the shape of
 * the calendar rather than the shape of the adoption.
 */
export function edgeFor(days: number): number {
  return Math.max(3, Math.min(28, Math.floor(days / 4)));
}

/** The mean of a run of points, or null when there are none. */
function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Measure one cached series across a period.
 *
 * Reads what the daily reports already fetched rather than asking the registry
 * again: the series is stored precisely so a report about March can still be
 * drawn in September, and a page that re-fetched on view would show a different
 * curve every day under a claim written once.
 */
export function movementOver(
  slug: string, registry: string, pkg: string,
  points: Array<{ day: string; downloads: number }>, days: number,
): PeriodMovement | null {
  const edge = edgeFor(days);
  // Two disjoint ends need at least twice the edge. Below that there is no
  // comparison to make, and a percentage from four days is a number with no
  // meaning -- printing one is worse than printing nothing.
  if (points.length < edge * 2) return null;
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));
  const before = mean(sorted.slice(0, edge).map((p) => p.downloads));
  const after = mean(sorted.slice(-edge).map((p) => p.downloads));
  if (before === null || after === null || before <= 0) return null;
  return {
    slug, registry, package: pkg, before, after,
    changePct: Math.round(((after - before) / before) * 100),
    fromDay: sorted[0]!.day, toDay: sorted[sorted.length - 1]!.day, edge,
  };
}

/** Every verified series, measured across the range. */
export async function movementsIn(
  range: Range, days: number, query: Query = q,
): Promise<PeriodMovement[]> {
  const rows = await query<{ slug: string; registry: string; package: string;
    day: string; downloads: string }>(
    `SELECT a.slug, a.registry, a.package, a.day::text AS day, a.downloads::text AS downloads
       FROM adoption_series a
       JOIN adoption_lookup l ON l.slug = a.slug AND l.missing = false
        AND l.registry = a.registry AND l.package = a.package
      WHERE a.day >= $1::date AND a.day < $2::date
      ORDER BY a.slug, a.day`,
    [range.from, range.to]);

  const bySlug = new Map<string, { registry: string; package: string;
    points: Array<{ day: string; downloads: number }> }>();
  for (const r of rows) {
    const key = r.slug;
    const at = bySlug.get(key)
      ?? { registry: r.registry, package: r.package, points: [] };
    at.points.push({ day: r.day, downloads: Number(r.downloads) });
    bySlug.set(key, at);
  }

  const out: PeriodMovement[] = [];
  for (const [slug, v] of bySlug) {
    const m = movementOver(slug, v.registry, v.package, v.points, days);
    if (m) out.push(m);
  }
  // Largest absolute move first: a reader scanning for a trend wants the thing
  // that moved, in either direction, not the alphabet.
  return out.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

// ---------------------------------------------------------------------------
// What the readings already found
// ---------------------------------------------------------------------------

export interface PeriodFinding {
  field: string;
  day: string;
  /** The claim, as the reading wrote it. */
  text: string;
  kind: 'shift' | 'direction';
}

/**
 * The claims the daily readings made inside the period.
 *
 * Taken verbatim from what was stored, never re-summarised. A period report
 * that paraphrased its own daily reports would be a model's summary of a
 * model's summary, and each pass moves further from the story that was cited.
 */
export async function findingsIn(
  range: Range, query: Query = q, cap = 40,
): Promise<PeriodFinding[]> {
  const rows = await query<{ field: string; day: string; strategy: unknown }>(
    `SELECT field, day::text AS day, strategy
       FROM field_briefings
      WHERE strategy IS NOT NULL
        AND day >= $1::date AND day < $2::date
      ORDER BY day DESC, field`,
    [range.from, range.to]);

  const out: PeriodFinding[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const s = r.strategy as {
      shift?: { moved?: unknown } | null;
      direction?: Array<{ claim?: unknown }> | null;
    } | null;
    const push = (text: unknown, kind: PeriodFinding['kind']) => {
      const t = typeof text === 'string' ? text.trim() : '';
      if (t.length < 20) return;
      // The same claim can be reached by two fields on the same day -- an AI
      // funding round is an `ai` finding and a `market` one. Showing it twice
      // is the repetition this archive was told about on 2026-09-09.
      const key = t.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ field: r.field, day: r.day, text: t, kind });
    };
    push(s?.shift?.moved, 'shift');
    for (const d of s?.direction ?? []) push(d?.claim, 'direction');
  }
  return out.slice(0, cap);
}

// ---------------------------------------------------------------------------
// The whole thing
// ---------------------------------------------------------------------------

export interface PeriodReport {
  span: Span;
  key: string;
  range: Range;
  days: number;
  launches: NewThing[];
  market: NewThing[];
  names: NewName[];
  movements: PeriodMovement[];
  findings: PeriodFinding[];
  /** Everything the period held, before the caps below took a slice. */
  totals: { launches: number; market: number };
}

/**
 * How many items each span shows.
 *
 * A year that listed every launch would be a database dump, and a week that
 * showed six would read as an accident of timing. These are display caps on a
 * list, never a measurement -- the totals are carried separately and the page
 * says how many were not listed.
 */
const CAPS: Record<Span, { launch: number; market: number }> = {
  day: { launch: 12, market: 8 },
  week: { launch: 25, market: 20 },
  month: { launch: 40, market: 40 },
  year: { launch: 60, market: 60 },
};

export async function periodReport(
  span: Span, key: string, query: Query = q,
): Promise<PeriodReport | null> {
  const range = rangeFor(span, key);
  if (!range) return null;
  const days = Math.max(1, Math.round(
    (Date.parse(range.to) - Date.parse(range.from)) / DAY_MS));
  const cap = CAPS[span];

  const [l, m, movements, findings] = await Promise.all([
    launches(range.from, range.to, cap.launch, query),
    marketMoves(range.from, range.to, cap.market, query),
    movementsIn(range, days, query),
    findingsIn(range, query),
  ]);
  const names = await newNames([...l.rows, ...m.rows], query);

  return {
    span, key, range, days,
    launches: l.rows, market: m.rows, names, movements, findings,
    totals: { launches: l.total, market: m.total },
  };
}

/** Whether a string is one of the spans, for routing. */
export function isSpan(s: string): s is Span {
  return (SPANS as string[]).includes(s);
}

/**
 * The most recent day that actually holds stories.
 *
 * NOT `new Date()`, and the difference is visible for several hours a day. This
 * archive works in UTC throughout -- `runDailyReport` names its report from
 * `now.toISOString()` -- so at 04:13Z the calendar day is already the new one
 * and holds a handful of overnight items. A lead card that summarised "today"
 * would show almost nothing every morning, which reads as a broken page rather
 * than as an early hour.
 *
 * Falls back to the calendar day when the archive is empty, so a fresh install
 * still renders a coherent page instead of a null.
 */
export async function latestDay(query: Query = q): Promise<string> {
  const rows = await query<{ day: string }>(
    `SELECT max(coalesce(published_at, collected_at))::date::text AS day
       FROM stories WHERE superseded_by IS NULL`);
  return rows[0]?.day ?? new Date().toISOString().slice(0, 10);
}

/**
 * The keys a reader can actually open, newest first.
 *
 * Built from the days that HAVE stories rather than from the calendar: offering
 * a month that was never collected is offering an empty page.
 */
export async function spanKeys(
  span: Span, query: Query = q, limit = 24,
): Promise<Array<{ key: string; label: string }>> {
  if (span === 'day' || span === 'week') {
    const rows = await query<{ day: string }>(
      `SELECT DISTINCT coalesce(published_at, collected_at)::date::text AS day
         FROM stories WHERE superseded_by IS NULL
         ORDER BY day DESC LIMIT $1`, [limit]);
    return rows.map((r) => ({ key: r.day,
      label: rangeFor(span, r.day)?.label ?? r.day }));
  }
  const fmt = span === 'month' ? 'YYYY-MM' : 'YYYY';
  const rows = await query<{ key: string }>(
    `SELECT DISTINCT to_char(coalesce(published_at, collected_at), $1) AS key
       FROM stories WHERE superseded_by IS NULL
       ORDER BY key DESC LIMIT $2`, [fmt, limit]);
  return rows.map((r) => ({ key: r.key,
    label: rangeFor(span, r.key)?.label ?? r.key }));
}

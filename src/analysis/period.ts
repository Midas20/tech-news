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
  const at = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;

  if (span === 'day') {
    return { from: iso(at), to: iso(new Date(at.getTime() + DAY_MS)),
      label: at.toLocaleDateString('en-GB',
        { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }

  // THE ISO WEEK CONTAINING THAT DATE, not the seven days ending on it.
  //
  // It was the latter, and the two are only the same for one date in seven.
  // "I want you make report every week" (2026-09-09) is what exposed it: a
  // trailing window anchored on an arbitrary day cannot enumerate, because
  // every date names a different overlapping week and no set of them partitions
  // a year. Weeks 36 and 37 must not share four days, or a story is reported in
  // both and the two cannot be compared.
  //
  // Monday-start, matching Postgres `date_trunc('week', ...)`, so the SQL that
  // lists the weeks and the code that renders one agree about where a week
  // begins. Any date in a week resolves to that week, so an existing
  // /reports/week/<date> link keeps working and now means something stable.
  const start = weekStart(at);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const nice = (d: Date) => d.toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return {
    from: iso(start), to: iso(new Date(start.getTime() + 7 * DAY_MS)),
    label: `${nice(start)} – ${nice(end)} ${end.getUTCFullYear()}`,
  };
}

/** The Monday of the week a date falls in, in UTC. */
export function weekStart(d: Date): Date {
  // getUTCDay is 0 for Sunday, so Sunday belongs to the week that began six
  // days earlier rather than starting a new one.
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - back * DAY_MS);
}

/** The key a span uses for the period containing a given day. */
export function keyFor(span: Span, day: string): string {
  if (span === 'year') return day.slice(0, 4);
  if (span === 'month') return day.slice(0, 7);
  if (span === 'week') return weekStart(new Date(`${day}T00:00:00Z`)).toISOString().slice(0, 10);
  return day;
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
 * How wide each end of the comparison is: WHOLE WEEKS, or no comparison at all.
 *
 * THE BUG THIS REPLACES, found generating every 2026 week report at once.
 * The rule was "a quarter of the period, floored at 3", which for a seven-day
 * period means comparing days 1-3 against days 5-7. Those are Monday to
 * Wednesday against Friday to Sunday. Package downloads are violently weekly --
 * a Sunday is a third of a Tuesday -- so EVERY week came out around -30% to
 * -45%:
 *
 *   8-14 June   polars -45%  pip -39%  fastapi -28%  huggingface -21%
 *
 * Nothing happened in that week. The measurement was the weekend.
 *
 * A three-day edge was already an attempt to mitigate this, and mitigation is
 * the wrong shape of answer: a signal with a seven-day cycle is only averaged
 * out by a whole multiple of seven days. So an edge is 7, 14, 21 or 28 days,
 * and a period too short to hold two disjoint whole-week edges gets NO CURVE.
 *
 * That means a week report shows no curve, and it should not: you cannot
 * measure how a seven-day-cycle signal changed over seven days without
 * comparing it to a different week, which is outside the period being reported
 * on. Refusing is the honest answer, and the week report still carries what
 * appeared and what was read.
 */
export function edgeFor(days: number): number {
  return Math.min(28, Math.floor(days / 2 / 7) * 7);
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
  // Zero means the period is too short to hold two whole-week edges, so there
  // is no cycle-safe comparison to make at all. Two disjoint ends then need at
  // least twice the edge in actual data: a percentage from a partial window is
  // a number with no meaning, and printing one is worse than printing nothing.
  if (edge === 0 || points.length < edge * 2) return null;
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

/**
 * A day on which EVERY series moved together, which means the measurement moved.
 *
 * THE NUMBER THIS EXISTS TO STOP. Generating the 2026 month reports produced,
 * for August:
 *
 *   fastapi -47%   huggingface -57%   pip -52%   polars -38%   langchain -32%
 *
 * Five unrelated Python projects do not lose a third to a half of their
 * downloads in the same week. The raw series shows a clean step on 2026-08-25 --
 * fastapi goes from ~22M on a weekday to ~12.5M and stays there -- and every
 * other package steps on the same day. That is PyPI changing how it counts
 * (mirror or bot filtering is the usual cause), and it is invisible in any
 * single series: each number on its own looks like a plausible decline, which is
 * exactly why it nearly shipped.
 *
 * The rule is the one this archive already applies to its own counts, pointed at
 * somebody else's: A MOVE SHARED BY EVERY SUBJECT IS A FACT ABOUT THE
 * INSTRUMENT. Adoption is not correlated across unrelated projects at this
 * magnitude; measurement is perfectly correlated across all of them by
 * construction.
 *
 * Detection compares the seven days before a candidate day with the seven from
 * it, for every series at once, and calls a break when nearly all of them move
 * the same way by more than a fifth. It needs at least three series to say
 * anything -- with two, "all of them" is not evidence of anything.
 */
export interface CohortBreak {
  day: string;
  /** The median move across all series at that day, as a percentage. */
  medianPct: number;
  /** How many series moved together. */
  agreed: number;
  total: number;
}

const BREAK_EDGE = 7;
/** How far the median must move before a shared move is called a break. */
const BREAK_PCT = 20;
/** The share of series that must agree. */
const BREAK_SHARE = 0.8;
/** Below this many series, "they all moved" is not evidence. */
const BREAK_MIN_SERIES = 3;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function detectCohortBreak(
  series: Map<string, Array<{ day: string; downloads: number }>>,
): CohortBreak | null {
  if (series.size < BREAK_MIN_SERIES) return null;
  const days = [...new Set([...series.values()].flatMap((p) => p.map((x) => x.day)))].sort();
  if (days.length < BREAK_EDGE * 2) return null;

  let worst: CohortBreak | null = null;
  for (let i = BREAK_EDGE; i + BREAK_EDGE <= days.length; i += 1) {
    const cut = days[i]!;
    const pcts: number[] = [];
    for (const points of series.values()) {
      const before = points.filter((p) => p.day < cut).slice(-BREAK_EDGE);
      const after = points.filter((p) => p.day >= cut).slice(0, BREAK_EDGE);
      if (before.length < BREAK_EDGE || after.length < BREAK_EDGE) continue;
      const b = before.reduce((a, p) => a + p.downloads, 0) / before.length;
      const a = after.reduce((x, p) => x + p.downloads, 0) / after.length;
      if (b <= 0) continue;
      pcts.push(((a - b) / b) * 100);
    }
    if (pcts.length < BREAK_MIN_SERIES) continue;
    const med = median(pcts);
    if (Math.abs(med) < BREAK_PCT) continue;
    const agreed = pcts.filter((p) => Math.sign(p) === Math.sign(med)
      && Math.abs(p) >= BREAK_PCT / 2).length;
    if (agreed / pcts.length < BREAK_SHARE) continue;
    if (!worst || Math.abs(med) > Math.abs(worst.medianPct)) {
      worst = { day: cut, medianPct: Math.round(med), agreed, total: pcts.length };
    }
  }
  return worst;
}

/** Every verified series, measured across the range. */
export async function movementsIn(
  range: Range, days: number, query: Query = q,
): Promise<{ movements: PeriodMovement[]; shift: CohortBreak | null }> {
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

  // A BREAK INSIDE THE PERIOD VOIDS EVERY CURVE IN IT, and refusing all of them
  // is the point rather than a limitation. The step is in the instrument, so it
  // is in every series: there is no subset that survives it, and publishing the
  // two that moved least would just be publishing the same error smaller.
  const shift = detectCohortBreak(new Map(
    [...bySlug].map(([slug, v]) => [slug, v.points])));
  if (shift) return { movements: [], shift };

  const out: PeriodMovement[] = [];
  for (const [slug, v] of bySlug) {
    const m = movementOver(slug, v.registry, v.package, v.points, days);
    if (m) out.push(m);
  }
  // Largest absolute move first: a reader scanning for a trend wants the thing
  // that moved, in either direction, not the alphabet.
  return {
    movements: out.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)),
    shift: null,
  };
}

// ---------------------------------------------------------------------------
// What the readings already found
// ---------------------------------------------------------------------------

/** One end of a comparison, as it was copied at write time. */
export interface FindingCite {
  title: string;
  when: string;
  source: string;
  id?: string;
}

export interface PeriodFinding {
  field: string;
  day: string;
  /** The claim, as the reading wrote it. */
  text: string;
  kind: 'shift' | 'direction';
  /**
   * THE EARLIER END, AND THE CURRENT ONE. This is the finding.
   *
   * "the report still looks like filter news by date. The core content [is] the
   * result that analysis the news in the period with old news that related to
   * each news" -- 2026-09-10.
   *
   * The objection is precise and it was right. A period page listed the claims
   * its daily readings made, as sentences, with the stories at either end of
   * each one reachable only by opening the field report that argued it. Read on
   * its own, a claim about change with an invisible past is indistinguishable
   * from a claim about today -- so the page read as a set of assertions over a
   * date range, which is what "filtered by date" describes.
   *
   * `then` and `now` are the pairing that makes it an analysis rather than a
   * list: the older story a subject was last seen in, against the one that
   * revises it. Both are already stored with every reading -- copied at write
   * time precisely because retention deletes the stories and the comparison has
   * to outlive them -- and were simply never rendered here.
   *
   * NOT THE SAME THING AS THE HEADLINE LISTS REMOVED EARLIER THE SAME DAY. Those
   * were every story of the period, in date order, attached to no claim. These
   * are two stories attached to one claim, and the relation between them IS the
   * content.
   */
  then: FindingCite[];
  now: FindingCite[];
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

  /**
   * Two per end, at most.
   *
   * A claim resting on six citations is not better evidenced than one resting
   * on two; it is just longer, and length is what was wrong with these pages.
   * The rest stay one click away on the field report that argued the claim.
   */
  const cites = (v: unknown): FindingCite[] =>
    (Array.isArray(v) ? v : [])
      .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
      .map((c) => ({
        title: String(c.title ?? '').trim(),
        when: String(c.when ?? '').trim(),
        source: String(c.source ?? '').trim(),
        ...(typeof c.id === 'string' ? { id: c.id } : {}),
      }))
      .filter((c) => c.title !== '')
      .slice(0, 2);

  for (const r of rows) {
    const s = r.strategy as {
      shift?: { moved?: unknown; then?: unknown; now?: unknown;
        thenOutside?: unknown } | null;
      direction?: Array<{ claim?: unknown; then?: unknown; now?: unknown }> | null;
    } | null;
    const push = (
      text: unknown, kind: PeriodFinding['kind'], then: unknown, now: unknown,
    ) => {
      const t = typeof text === 'string' ? text.trim() : '';
      if (t.length < 20) return;
      // The same claim can be reached by two fields on the same day -- an AI
      // funding round is an `ai` finding and a `market` one. Showing it twice
      // is the repetition this archive was told about on 2026-09-09.
      const key = t.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ field: r.field, day: r.day, text: t, kind,
        then: cites(then), now: cites(now) });
    };
    // `thenOutside` is the fallback earlier end: the reading is told to prefer
    // it for anything older than a few weeks, because this archive's own past
    // is only as deep as the retention window and the comparison is not.
    push(s?.shift?.moved, 'shift',
      (Array.isArray(s?.shift?.then) && s.shift.then.length > 0)
        ? s.shift.then : s?.shift?.thenOutside,
      s?.shift?.now);
    for (const d of s?.direction ?? []) push(d?.claim, 'direction', d?.then, d?.now);
  }

  // CLAIMS THAT SHOW THEIR EARLIER END COME FIRST. A finding with both ends is
  // the thing this section exists to publish; one with only a present end is a
  // statement about today that happened to be filed under a change heading, and
  // it should not be what a reader meets at the top of the page.
  out.sort((a, b) => Number(b.then.length > 0) - Number(a.then.length > 0));
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
  /** Set when a measurement break voids every curve in the period. */
  shift: CohortBreak | null;
  findings: PeriodFinding[];
  /**
   * WHY THERE ARE NO FINDINGS, when there are none.
   *
   * An absent section reads as "nothing was found", and for every period before
   * 2026-09-09 that is a false statement: no daily reading existed to find
   * anything. `/reports/month/2026-06` renders four lists, a curve table and
   * silence where the analysis goes, and a reader has no way to tell whether
   * June was a quiet month or an unwatched one.
   *
   * So the page needs to distinguish two facts it could not previously
   * separate: no briefing covered this period at all, versus briefings covered
   * it and none of them got a reading out of a model.
   */
  readings: ReadingCoverage;
  /** Everything the period held, before the caps below took a slice. */
  totals: { launches: number; market: number };
}

export interface ReadingCoverage {
  /** Field briefings written inside the period. */
  briefings: number;
  /** Of those, how many carried a strategic reading. */
  withReading: number;
  /** The first day this archive ever wrote a briefing, or null if never. */
  firstEver: string | null;
  /**
   * HOW MANY PUBLISHERS STAND BEHIND THE PERIOD, and how much of it the three
   * biggest account for.
   *
   * "Generate all report of 10 years" (2026-09-10). The archive does hold ten
   * years and eight of them cannot be read, because 1,392 of the 1,402 stories
   * before 2025 come from five vendor blogs with deep archives a backfill could
   * walk. A reader looking at an unread 2019 needs to be told that, and told it
   * in numbers, or the empty page reads as a failure of this software rather
   * than an honest limit of the evidence under it.
   */
  stories: number;
  sources: number;
  /** Percentage of the period's stories from its three largest publishers. */
  topPct: number;
}

/**
 * How much of this period the daily reading actually covered.
 *
 * `firstEver` is the honest denominator. A period entirely before the archive
 * started writing briefings has no analysis for a reason that has nothing to do
 * with the industry, and saying "the archive began on 9 September 2026" is the
 * only version of that a reader can act on.
 */
export async function readingCoverage(
  range: Range, query: Query = q,
): Promise<ReadingCoverage> {
  const [r] = await query<{ briefings: string; with_reading: string;
    first_ever: string | null; stories: string; sources: string;
    top_pct: string | null }>(
    `WITH per_source AS (
       SELECT s.source_id, count(*) AS c
         FROM stories s
        WHERE s.superseded_by IS NULL AND s.dismissed_at IS NULL
          AND s.summary_en IS NOT NULL AND length(s.summary_en) >= 60
          AND coalesce(s.published_at, s.collected_at) >= $1::timestamptz
          AND coalesce(s.published_at, s.collected_at) <  $2::timestamptz
        GROUP BY 1
     ), ranked AS (
       SELECT c, row_number() OVER (ORDER BY c DESC) AS rn,
              sum(c) OVER () AS total
         FROM per_source
     )
     SELECT
       (SELECT count(*)::text FROM field_briefings
         WHERE day >= $1::date AND day < $2::date) AS briefings,
       (SELECT count(*)::text FROM field_briefings
         WHERE day >= $1::date AND day < $2::date AND strategy IS NOT NULL)
         AS with_reading,
       (SELECT min(day)::text FROM field_briefings) AS first_ever,
       (SELECT coalesce(max(total), 0)::text FROM ranked) AS stories,
       (SELECT count(*)::text FROM per_source) AS sources,
       (SELECT round(100.0 * sum(c) / nullif(max(total), 0))::text
          FROM ranked WHERE rn <= 3) AS top_pct`,
    [range.from, range.to]);
  return {
    briefings: Number(r?.briefings ?? 0),
    withReading: Number(r?.with_reading ?? 0),
    firstEver: r?.first_ever ?? null,
    stories: Number(r?.stories ?? 0),
    sources: Number(r?.sources ?? 0),
    topPct: Number(r?.top_pct ?? 0),
  };
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

  const [l, m, curves, findings, readings] = await Promise.all([
    launches(range.from, range.to, cap.launch, query),
    marketMoves(range.from, range.to, cap.market, query),
    movementsIn(range, days, query),
    findingsIn(range, query),
    readingCoverage(range, query),
  ]);
  const names = await newNames([...l.rows, ...m.rows], query);

  return {
    span, key, range, days,
    launches: l.rows, market: m.rows, names, findings, readings,
    movements: curves.movements, shift: curves.shift,
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
  const rows = await periodIndex(span, query, limit);
  return rows.map((p) => ({ key: p.key, label: p.label }));
}

export interface PeriodRow {
  key: string;
  label: string;
  /** Stories the archive holds in this period. Navigation, never a magnitude. */
  stories: number;
  launches: number;
  market: number;
}

/**
 * Every period of a span that the archive holds stories for, newest first.
 *
 * Asked for on 2026-09-09: "I want you make report every week, every month,
 * every year." The pages already composed on demand; what was missing was any
 * way to reach one that is not this week or this month.
 *
 * WHY THE COUNTS ARE HERE AND WHY THEY ARE NOT A FINDING. This archive's
 * standing rule is that it never counts its own stories, because a count over
 * an unknown denominator measures the feed list rather than the industry. That
 * rule is about CLAIMS. This is an index: a reader choosing between fifty weeks
 * needs to know which ones have anything in them, and "36 stories, 4 launches"
 * is the honest answer to "is this page worth opening". It is labelled as what
 * the archive caught, and no period page turns it into a trend.
 *
 * The whole index is one grouped query rather than a report per period: the
 * composed page for a single period does real work, and building fifty of them
 * to draw a list of links would be a page that takes a minute to load.
 */
export async function periodIndex(
  span: Span, query: Query = q, limit = 400,
): Promise<PeriodRow[]> {
  // date_trunc('week') is Monday-based, which is what `weekStart` implements.
  const bucket = span === 'year' ? `to_char(d, 'YYYY')`
    : span === 'month' ? `to_char(d, 'YYYY-MM')`
      : span === 'week' ? `to_char(date_trunc('week', d), 'YYYY-MM-DD')`
        : `to_char(d, 'YYYY-MM-DD')`;

  const rows = await query<{ key: string; stories: string; launches: string; market: string }>(
    `SELECT ${bucket} AS key,
            count(*)::text AS stories,
            count(*) FILTER (WHERE kind = 'launch')::text AS launches,
            count(*) FILTER (WHERE kind = 'market')::text AS market
       FROM (
         SELECT coalesce(published_at, collected_at) AS d,
                coalesce(event_kind::text, 'article') AS kind
           FROM stories WHERE superseded_by IS NULL
       ) s
      GROUP BY 1 ORDER BY 1 DESC LIMIT $1`, [limit]);

  return rows.map((r) => ({
    key: r.key,
    label: rangeFor(span, r.key)?.label ?? r.key,
    stories: Number(r.stories),
    launches: Number(r.launches),
    market: Number(r.market),
  }));
}

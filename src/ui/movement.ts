// What is moving, what the archive has to prove it, and what to do about it.
//
// The trends page is a table of numbers. A number is not a finding: "Rust, 412"
// answers nothing on its own, and the reader has to do the comparison, the
// normalisation and the corroboration in their head before it means anything.
// This page does those three things and states the result as a sentence, with
// the rows it was computed from sitting underneath it.
//
// THE ONE THING THAT WOULD MAKE THIS LIE
//
// Measured on 2026-09-01: the last 90 days hold 8,195 stories from 325 active
// sources; the prior 90 hold 4,205 from 213. The archive itself roughly doubled
// -- 179 release feeds came back, 61 first-party channels were seeded, and a
// backfill walked GitHub release history to January 2024.
//
// So a verdict built on raw counts would report every technology in the
// vocabulary as growing by about 2x, and it would be measuring this repository's
// commit history rather than the industry. That is the failure mode of every
// "trending" panel that counts documents.
//
// The comparison is therefore on SHARE of the window, not volume. If the archive
// doubles uniformly, every share is unchanged and every verdict is "steady",
// which is the correct answer. A technology only moves here when it moved
// relative to everything else the archive saw in the same period.
//
// The coverage figures are still reported at the top, because a reader is
// entitled to know how much the instrument changed under the measurement.

import { q } from './db.ts';
import { wrap, pageHead, empty, escapeHtml, truncate } from './html.ts';
import { crumbsFor } from './nav.ts';
import { llmCall, type LlmContext } from '../llm/router.ts';
import { meaningOf, type SourceType } from '../vocab/intel.ts';

/** How far a share has to move before it is worth a word. */
const BANDS = [
  { at: 2.0, verdict: 'surging', label: 'Growing very strongly' },
  { at: 1.25, verdict: 'growing', label: 'Growing' },
  { at: 0.8, verdict: 'steady', label: 'Steady' },
  { at: 0.5, verdict: 'fading', label: 'Declining' },
  { at: 0, verdict: 'collapsing', label: 'Declining sharply' },
] as const;

export type Verdict = typeof BANDS[number]['verdict'] | 'unbaselined';

/**
 * The floors.
 *
 * Below these a ratio is arithmetic rather than evidence: three stories going to
 * six is "up 100%" and means nothing. Both windows have to carry enough for the
 * division to survive one story landing differently.
 */
export const MIN_NOW = 8;
export const MIN_TOTAL = 20;

/**
 * A RATIO NEEDS A BASELINE, AND THE ARCHIVE KEEPS GROWING ONE.
 *
 * Without this the top of the report was AT Protocol at 254x, on 495 stories
 * now against 1 before. That is not a technology arriving; it is a feed
 * arriving. AT Protocol was one of 179 GitHub release feeds resumed on
 * 2026-09-01, so the "growth" is this repository's own repair showing up as a
 * market finding -- the most embarrassing thing an instrument like this can do.
 *
 * A technology with less than this in the prior window has no baseline to be
 * measured against. It is reported, separately and by name, as newly covered
 * rather than as growing: a real fact about the archive, stated as one.
 */
export const MIN_PREV = 5;

export function verdictFor(ratio: number): { verdict: Verdict; label: string } {
  for (const b of BANDS) {
    if (ratio >= b.at) return { verdict: b.verdict, label: b.label };
  }
  return { verdict: 'collapsing', label: 'Declining sharply' };
}

export interface Exemplar {
  id: string; title: string; url: string; source: string; kind: string; when: string;
}

/**
 * WHAT MOVED, not only which technology moved.
 *
 * A report that can name a stack but not a company cannot describe half of what
 * this archive collects: 14,713 stories carry a company tag. The three arrays
 * are structurally identical -- a text[] of slugs on `stories`, a table with a
 * slug and a name -- so one query shape covers all three, which is also what
 * stops the three drifting apart.
 */
export type EntityKind = 'technology' | 'company' | 'platform';

export const ENTITY_SQL: Record<EntityKind, { column: string; table: string }> = {
  technology: { column: 'stacks', table: 'stacks' },
  company: { column: 'companies', table: 'companies' },
  platform: { column: 'platforms', table: 'platforms' },
};

export interface Movement {
  entity: EntityKind;
  slug: string;
  name: string;
  kind: string;
  category: string;
  nowN: number;
  prevN: number;
  nowShare: number;
  prevShare: number;
  ratio: number;
  verdict: Verdict;
  label: string;
  sources: number;
  independent: number;
  launches: number;
  releases: number;
  changes: number;
  market: number;
  articles: number;
  exemplars: Exemplar[];
}

export interface Coverage {
  nowStories: number;
  prevStories: number;
  nowSources: number;
  prevSources: number;
  /** How much of the change in volume is the archive rather than the subject. */
  volumeRatio: number;
  sourceRatio: number;
}

export interface Report {
  days: number;
  coverage: Coverage;
  rows: Movement[];
  /** Newly covered: real activity, no prior window to compare it against. */
  unbaselined: Movement[];
  /** Technologies the archive sees but cannot yet speak about. */
  belowFloor: number;
}

interface RawRow {
  slug: string; name: string; kind: string; category: string;
  now_n: string; prev_n: string; sources: string;
  launches: string; releases: string; changes: string; market: string; articles: string;
  source_types: (string | null)[];
}

/**
 * Everything the verdicts are computed from, in one pass.
 *
 * `unnest(s.stacks)` rather than a join through a slug array: a story carries at
 * most a handful of tags, so this is a few index lookups per row instead of a
 * scan of the 2,338-entry vocabulary per candidate.
 */
export type Query = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export async function movementReport(days = 90, query: Query = q): Promise<Report> {
  const [cov] = await query<{
    now_stories: string; prev_stories: string; now_sources: string; prev_sources: string;
  }>(
    `SELECT
       count(*) FILTER (WHERE d > now() - make_interval(days => $1::int))::text AS now_stories,
       count(*) FILTER (WHERE d <= now() - make_interval(days => $1::int))::text AS prev_stories,
       count(DISTINCT source_id) FILTER (
         WHERE d > now() - make_interval(days => $1::int))::text AS now_sources,
       count(DISTINCT source_id) FILTER (
         WHERE d <= now() - make_interval(days => $1::int))::text AS prev_sources
     FROM (SELECT coalesce(published_at, collected_at) AS d, source_id
             FROM stories
            WHERE superseded_by IS NULL AND dismissed_at IS NULL
              AND coalesce(published_at, collected_at) > now() - make_interval(days => $1::int * 2)) z`,
    [days]);

  const nowStories = Number(cov?.now_stories ?? 0);
  const prevStories = Number(cov?.prev_stories ?? 0);

  const raw: (RawRow & { entity: EntityKind })[] = [];
  for (const entity of Object.keys(ENTITY_SQL) as EntityKind[]) {
    const def = ENTITY_SQL[entity];
    // `kind` is a column on `stacks` only; for the other two the entity IS the
    // kind. Interpolated from a fixed record, never from a request.
    const kindCol = entity === 'technology' ? 'st.kind::text' : `'${entity}'::text`;
    const got = await query<RawRow>(
    `WITH tagged AS (
       SELECT x AS slug, s.source_id, s.event_kind,
              coalesce(s.published_at, s.collected_at) AS d
         FROM stories s, LATERAL unnest(s.${def.column}) AS x
        WHERE s.superseded_by IS NULL AND s.dismissed_at IS NULL
          AND coalesce(s.published_at, s.collected_at) > now() - make_interval(days => $1::int * 2)
     )
     SELECT st.slug, st.name, ${kindCol} AS kind, ''::text AS category,
            count(*) FILTER (WHERE t.d > now() - make_interval(days => $1::int))::text AS now_n,
            count(*) FILTER (WHERE t.d <= now() - make_interval(days => $1::int))::text AS prev_n,
            count(DISTINCT t.source_id) FILTER (
              WHERE t.d > now() - make_interval(days => $1::int))::text AS sources,
            count(*) FILTER (WHERE t.event_kind = 'launch'
              AND t.d > now() - make_interval(days => $1::int))::text AS launches,
            count(*) FILTER (WHERE t.event_kind = 'release'
              AND t.d > now() - make_interval(days => $1::int))::text AS releases,
            count(*) FILTER (WHERE t.event_kind = 'change'
              AND t.d > now() - make_interval(days => $1::int))::text AS changes,
            count(*) FILTER (WHERE t.event_kind = 'market'
              AND t.d > now() - make_interval(days => $1::int))::text AS market,
            count(*) FILTER (WHERE t.event_kind = 'article'
              AND t.d > now() - make_interval(days => $1::int))::text AS articles,
            array_agg(DISTINCT src.source_type::text) FILTER (
              WHERE t.d > now() - make_interval(days => $1::int)) AS source_types
       FROM tagged t
       JOIN ${def.table} st ON st.slug = t.slug
       JOIN sources src ON src.id = t.source_id
      GROUP BY st.slug, st.name, ${kindCol}`,
      [days]);
    for (const r of got) raw.push({ ...r, entity });
  }

  let belowFloor = 0;
  const rows: Movement[] = [];
  const unbaselined: Movement[] = [];

  for (const r of raw) {
    const nowN = Number(r.now_n);
    const prevN = Number(r.prev_n);
    if (nowN < MIN_NOW || nowN + prevN < MIN_TOTAL) { belowFloor++; continue; }

    // SHARE, not volume. See the note at the top of this file.
    const nowShare = nowStories > 0 ? nowN / nowStories : 0;
    const prevShare = prevStories > 0 ? prevN / prevStories : 0;
    // A technology with no prior showing is new rather than infinitely grown;
    // it lands in the top band without dividing by zero.
    const ratio = prevShare > 0 ? nowShare / prevShare : (nowShare > 0 ? BANDS[0]!.at : 1);
    const thin = prevN < MIN_PREV;
    const { verdict, label } = thin
      ? { verdict: 'unbaselined' as const, label: 'Newly covered' }
      : verdictFor(ratio);

    const independent = (r.source_types ?? [])
      .filter((t): t is string => Boolean(t))
      .filter((t) => meaningOf(t as SourceType)?.independent).length;

    (thin ? unbaselined : rows).push({
      entity: r.entity, slug: r.slug, name: r.name, kind: r.kind, category: r.category,
      nowN, prevN, nowShare, prevShare, ratio, verdict, label,
      sources: Number(r.sources), independent,
      launches: Number(r.launches), releases: Number(r.releases),
      changes: Number(r.changes), market: Number(r.market), articles: Number(r.articles),
      exemplars: [],
    });
  }

  rows.sort((a, b) => b.ratio - a.ratio || b.nowN - a.nowN);
  unbaselined.sort((a, b) => b.nowN - a.nowN);

  return {
    days,
    coverage: {
      nowStories, prevStories,
      nowSources: Number(cov?.now_sources ?? 0),
      prevSources: Number(cov?.prev_sources ?? 0),
      volumeRatio: prevStories > 0 ? nowStories / prevStories : 0,
      sourceRatio: Number(cov?.prev_sources ?? 0) > 0
        ? Number(cov?.now_sources ?? 0) / Number(cov?.prev_sources ?? 0) : 0,
    },
    rows,
    unbaselined,
    belowFloor,
  };
}

/** The headlines behind a verdict, so a claim can be opened rather than believed. */
export async function exemplarsFor(
  slug: string, days: number, limit = 3, query: Query = q,
): Promise<Exemplar[]> {
  return query<Exemplar>(
    `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title,
            s.canonical_url AS url, src.name AS source,
            coalesce(s.event_kind::text, 'article') AS kind,
            coalesce(s.published_at, s.collected_at)::date::text AS when
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE s.superseded_by IS NULL AND s.dismissed_at IS NULL
        AND $1 = ANY(s.stacks)
        AND coalesce(s.published_at, s.collected_at) > now() - make_interval(days => $2::int)
      ORDER BY (s.event_kind = 'article'), s.importance DESC NULLS LAST,
               coalesce(s.published_at, s.collected_at) DESC
      LIMIT $3`,
    [slug, days, limit]);
}

/**
 * What to actually do, ranked, with the reason attached.
 *
 * Movement alone is not a recommendation: a technology can double its share
 * because one vendor published ten times in a fortnight. So the ranking requires
 * INDEPENDENT corroboration -- sources whose type means they do not speak for
 * the thing they are describing -- and says how much it has.
 */
export interface Recommendation {
  row: Movement;
  why: string;
  strength: 'strong' | 'moderate' | 'weak';
}

export function recommend(rows: Movement[], limit = 6): Recommendation[] {
  return rows
    .filter((r) => r.verdict === 'surging' || r.verdict === 'growing')
    .filter((r) => r.independent >= 1)
    .sort((a, b) => (b.independent - a.independent) || (b.ratio - a.ratio))
    .slice(0, limit)
    .map((r) => {
      const strength: Recommendation['strength'] = r.independent >= 3 ? 'strong'
        : r.independent === 2 ? 'moderate' : 'weak';
      const events = r.launches + r.changes + r.market;
      const why = events > r.releases
        ? `${r.independent} independent source${r.independent === 1 ? '' : 's'}, `
          + `and the movement is ${events} launches, changes and market moves rather than `
          + `routine version traffic`
        : `${r.independent} independent source${r.independent === 1 ? '' : 's'}; `
          + `mostly release traffic (${r.releases} of ${r.nowN}), so this is activity `
          + `rather than a market signal`;
      return { row: r, why, strength };
    });
}

/** Technologies whose movement rests entirely on people describing themselves. */
export function firstPartyOnly(rows: Movement[], limit = 5): Movement[] {
  return rows
    .filter((r) => (r.verdict === 'surging' || r.verdict === 'growing') && r.independent === 0)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, limit);
}



/** What the model is allowed to write from, and nothing else. */
export interface Written {
  headline: string;
  summary: string;
  body: string;
  watch: string[];
  /** Which model wrote it. Shown, because a briefing is not anonymous. */
  provider?: string;
}

/**
 * Turn the measured movements into the evidence packet the writer sees.
 *
 * Deliberately narrow. The model gets movements that cleared the floors, the
 * headlines behind the ones being named, and the coverage caveat -- and gets
 * them as numbers rather than as prose, so there is nothing to copy and every
 * sentence has to be derived. Anything it cannot support from this is a
 * fabrication, which is the property the prompt is written to enforce.
 */
export function evidencePacket(
  report: Report, exemplars: Map<string, Exemplar[]>,
): string {
  const line = (m: Movement) =>
    `- ${m.name} (${m.entity}): share ${(m.prevShare * 100).toFixed(2)}% -> `
    + `${(m.nowShare * 100).toFixed(2)}% (x${m.ratio.toFixed(2)}, ${m.label}); `
    + `${m.nowN} stories now vs ${m.prevN} before, ${m.sources} sources of which `
    + `${m.independent} independent; ${m.launches} launches, ${m.releases} releases, `
    + `${m.changes} changes, ${m.market} market`;

  const moving = report.rows.filter(
    (r) => r.verdict === 'surging' || r.verdict === 'growing').slice(0, 12);
  const falling = report.rows.filter(
    (r) => r.verdict === 'fading' || r.verdict === 'collapsing').slice(0, 8);

  const heads: string[] = [];
  for (const [slug, list] of exemplars) {
    const name = [...moving, ...falling].find((m) => m.slug === slug)?.name ?? slug;
    for (const e of list) heads.push(`- ${name}: "${e.title}" (${e.source}, ${e.kind}, ${e.when})`);
  }

  return [
    `WINDOW: last ${report.days} days, against the ${report.days} before it.`,
    '',
    'COVERAGE CAVEAT (about the archive, not the industry):',
    `The archive held ${report.coverage.prevStories} stories from `
      + `${report.coverage.prevSources} sources in the earlier window and `
      + `${report.coverage.nowStories} from ${report.coverage.nowSources} in the later one. `
      + 'Movements below are therefore SHARE of each window, not raw counts.',
    '',
    'GAINING SHARE:',
    moving.length ? moving.map(line).join('\n') : '- nothing',
    '',
    'LOSING SHARE:',
    falling.length ? falling.map(line).join('\n') : '- nothing',
    '',
    'REAL HEADLINES BEHIND THESE (the only specifics you may name):',
    heads.length ? heads.join('\n') : '- none',
    '',
    `NOT REPORTABLE: ${report.belowFloor} subjects fell below the evidence floor, and `
      + `${report.unbaselined.length} are newly covered with no prior baseline`
      + (report.unbaselined.length
        ? ` (${report.unbaselined.slice(0, 5).map((r) => r.name).join(', ')})` : '')
      + '. Do not present these as growth.',
  ].join('\n');
}

/**
 * Write the briefing.
 *
 * Returns null rather than throwing when no model is reachable: a missing key or
 * an exhausted budget should leave the archive with its measured report and no
 * prose, not with no report at all.
 */
export async function writeReport(
  ctx: LlmContext, report: Report, exemplars: Map<string, Exemplar[]>,
): Promise<Written | null> {
  const packet = evidencePacket(report, exemplars);
  const res = await llmCall<Written>(ctx, 'movement_report', packet, packet);
  return res.status === 'ok' ? { ...res.value, provider: res.provider } : null;
}

// ---------------------------------------------------------------------------
// The daily record
// ---------------------------------------------------------------------------

/**
 * Version of the shape written into daily_reports.payload.
 *
 * Stored on the row rather than assumed, so a report written by older code stays
 * readable as what it was instead of being reinterpreted as what this version
 * would have produced. Bump it when the payload's meaning changes, not when its
 * numbers do.
 */
/**
 * THE TITLE NAMES THE SUBJECT AND THE DAY.
 *
 * "Movement report" on every row of a list of reports is a filename, not a
 * title: two hundred of them say nothing about which one to open. A report is
 * about something -- a technology, a tool, a platform, a company, or the money
 * -- and it is about a date, so the title carries both.
 *
 * The subject is chosen the same way the recommendations are: corroboration
 * first. Naming whatever moved fastest would put a vendor's own publishing
 * schedule in the headline, which is exactly the mistake the rest of this file
 * exists to avoid. If nothing has independent backing, the movers are named
 * with no claim attached.
 *
 * `market` leads when the window's market events -- funding, acquisitions,
 * consolidation -- outweigh the launches and changes. That is a different kind
 * of day and the title should say so before it says any name.
 */
export function reportTitle(report: Report, day: string): string {
  const when = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const moving = report.rows.filter(
    (r) => r.verdict === 'surging' || r.verdict === 'growing');
  if (moving.length === 0) return `No movement to report — ${when}`;

  const market = moving.reduce((n, r) => n + r.market, 0);
  const others = moving.reduce((n, r) => n + r.launches + r.changes, 0);

  const corroborated = moving.filter((r) => r.independent >= 1);
  const pool = corroborated.length > 0 ? corroborated : moving;
  const named = [...pool]
    .sort((a, b) => (b.independent - a.independent) || (b.ratio - a.ratio))
    .slice(0, 3)
    .map((r) => r.name);

  const subjects = named.length === 1 ? named[0]!
    : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;

  const lead = market > others && market > 0 ? 'Market moves: ' : '';
  const hedge = corroborated.length === 0 ? ' (uncorroborated)' : '';
  return `${lead}${subjects}${hedge} — ${when}`;
}

export const GENERATOR = 'movement-v1';

export interface StoredReport {
  day: string;
  title: string;
  windowDays: number;
  generatedAt: string;
  generator: string;
  stories: number;
  sources: number;
  compared: number;
  growing: number;
  declining: number;
}

/**
 * Generate today's report and keep it.
 *
 * The page renders live, because somebody looking now should see now. This is
 * the other half: the archive's own record of what it was prepared to say on a
 * given morning. For an instrument whose subject is the passage of time, a
 * finding that cannot be looked up a week later is not a finding.
 *
 * Written with the day as the key, so a retry after a failure corrects that
 * day's row rather than appending a second opinion.
 */
export async function saveDailyReport(
  query: Query, days = 90, now = new Date(), ctx?: LlmContext,
): Promise<{
  day: string; title: string; written: boolean;
  compared: number; growing: number; declining: number;
}> {
  const report = await movementReport(days, query);

  const growing = report.rows.filter(
    (r) => r.verdict === 'surging' || r.verdict === 'growing');
  const declining = report.rows.filter(
    (r) => r.verdict === 'fading' || r.verdict === 'collapsing');
  const picks = recommend(report.rows);

  // Only what the report actually named. Storing all 250 rows every day would
  // grow this table faster than the archive it describes, and the rows that did
  // not make the report are recoverable from the stories either way.
  const slim = (m: Movement) => ({
    slug: m.slug, name: m.name, kind: m.kind,
    nowN: m.nowN, prevN: m.prevN,
    nowShare: Number(m.nowShare.toFixed(6)), prevShare: Number(m.prevShare.toFixed(6)),
    ratio: Number(m.ratio.toFixed(3)), verdict: m.verdict, label: m.label,
    sources: m.sources, independent: m.independent,
    launches: m.launches, releases: m.releases, changes: m.changes,
    market: m.market, articles: m.articles,
  });

  // The headlines behind everything the briefing is allowed to name. Fetched
  // before the model runs, because the model may only name what it was given.
  const named = [...picks.map((p) => p.row), ...growing.slice(0, 8), ...declining.slice(0, 5)];
  const seen = new Set<string>();
  const exemplars = new Map<string, Exemplar[]>();
  for (const r of named) {
    if (seen.has(r.slug) || seen.size >= 12) continue;
    seen.add(r.slug);
    exemplars.set(r.slug, await exemplarsFor(r.slug, days, 2, query));
  }

  // The written briefing. Null when no model is reachable -- a missing key or an
  // exhausted budget leaves the archive with its measured report and no prose,
  // which is a smaller loss than no report at all.
  const written = ctx ? await writeReport(ctx, report, exemplars) : null;

  const payload = {
    generator: GENERATOR,
    days,
    coverage: report.coverage,
    belowFloor: report.belowFloor,
    written,
    exemplars: Object.fromEntries(exemplars),
    growing: growing.slice(0, 25).map(slim),
    declining: declining.slice(0, 25).map(slim),
    unbaselined: report.unbaselined.slice(0, 25).map(slim),
    recommendations: picks.map((p) => ({
      slug: p.row.slug, name: p.row.name, strength: p.strength, why: p.why,
    })),
  };

  const day = now.toISOString().slice(0, 10);
  // The model names the subject when it wrote the thing; the computed title is
  // the fallback, and both end in the date.
  const when = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const title = written
    ? `${written.headline} — ${when}`
    : reportTitle(report, day);
  await query(
    `INSERT INTO daily_reports
       (day, window_days, generator, title, stories, sources, compared,
        growing, declining, payload)
     VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (day, window_days) DO UPDATE SET
       generated_at = now(), generator = EXCLUDED.generator, title = EXCLUDED.title,
       stories = EXCLUDED.stories, sources = EXCLUDED.sources,
       compared = EXCLUDED.compared, growing = EXCLUDED.growing,
       declining = EXCLUDED.declining, payload = EXCLUDED.payload`,
    [day, days, GENERATOR, title, report.coverage.nowStories, report.coverage.nowSources,
      report.rows.length, growing.length, declining.length, JSON.stringify(payload)]);

  return {
    day, title, written: written !== null, compared: report.rows.length,
    growing: growing.length, declining: declining.length,
  };
}

/** The most recent written briefing for a window, if the job has produced one. */
export async function latestWritten(
  windowDays = 90, query: Query = q,
): Promise<{ day: string; title: string; written: Written | null } | null> {
  const [row] = await query<{ day: string; title: string; written: Written | null }>(
    `SELECT day::text AS day, title, payload->'written' AS written
       FROM daily_reports WHERE window_days = $1
      ORDER BY day DESC LIMIT 1`, [windowDays]);
  return row ?? null;
}

/** The reports already written, newest first. */
export async function storedReports(
  windowDays = 90, limit = 30, query: Query = q,
): Promise<StoredReport[]> {
  return query<StoredReport>(
    `SELECT day::text AS day, title, window_days AS "windowDays",
            generated_at::text AS "generatedAt", generator,
            stories, sources, compared, growing, declining
       FROM daily_reports
      WHERE window_days = $1
      ORDER BY day DESC
      LIMIT $2`, [windowDays, limit]);
}

/** One line for the scheduler's log. */
export function summariseReport(
  r: {
    day: string; title: string; written?: boolean;
    compared: number; growing: number; declining: number;
  },
): string {
  const how = r.written === false ? ' [measured only, no model]' : '';
  return `${r.title} (${r.compared} compared, ${r.growing} up, ${r.declining} down)${how}`;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** Windows the report will accept, so the range is never assembled from input. */
export function reportWindow(raw: string | null): number {
  const n = Number(raw);
  return [30, 90, 180, 365].includes(n) ? n : 90;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function movementRow(m: Movement): string {
  const events = m.launches + m.changes + m.market;
  const corroboration = m.independent === 0
    ? '<span class="mv-warn">first-party only</span>'
    : `${m.independent} independent`;
  return `<tr>
    <td><a href="/trend/${encodeURIComponent(m.slug)}">${escapeHtml(m.name)}</a>
      <span class="muted">${escapeHtml(m.kind)}</span></td>
    <td><span class="mv mv-${m.verdict}">${escapeHtml(m.label)}</span></td>
    <td class="num">${pct(m.prevShare)} &rarr; ${pct(m.nowShare)}</td>
    <td class="num">${m.nowN.toLocaleString('en-US')} / ${m.prevN.toLocaleString('en-US')}</td>
    <td class="num">${m.sources} <span class="muted">${corroboration}</span></td>
    <td class="num">${events} <span class="muted">of ${m.nowN}</span></td>
  </tr>`;
}

const HEAD = `<thead><tr>
  <th>Technology</th><th>Movement</th><th class="num">Share of archive</th>
  <th class="num">Stories now / before</th><th class="num">Sources</th>
  <th class="num">Events</th></tr></thead>`;

/**
 * The report.
 *
 * Three parts, in the order a reader needs them: what moved, what the archive
 * holds that says so, and what to do. The recommendation is last on purpose --
 * it is the only part that is an opinion, and the only way to reach it is past
 * the evidence it was drawn from.
 */
export async function renderMovementReport(days: number): Promise<string> {
  const report = await movementReport(days);
  const { coverage: c, rows } = report;

  if (rows.length === 0) {
    return wrap(`${pageHead('Movement report',
      'Not enough history yet to compare two windows.')}
      ${empty(`No technology has ${MIN_NOW} stories in the last ${days} days and `
        + `${MIN_PREV} in the ${days} before that. The archive needs to run for longer.`,
      'trending')}`);
  }

  const surging = rows.filter((r) => r.verdict === 'surging');
  const growing = rows.filter((r) => r.verdict === 'growing');
  const steady = rows.filter((r) => r.verdict === 'steady');
  const fading = rows.filter((r) => r.verdict === 'fading' || r.verdict === 'collapsing');
  const picks = recommend(rows);
  const selfDescribed = firstPartyOnly(rows);

  // Exemplars only for what the report actually names, so the page costs a
  // bounded number of queries however large the vocabulary grows.
  const named = [...picks.map((p) => p.row), ...surging.slice(0, 5), ...fading.slice(0, 5)];
  const seen = new Set<string>();
  const wanted = named.filter((r) => (seen.has(r.slug) ? false : seen.add(r.slug))).slice(0, 12);
  const exemplars = new Map<string, Exemplar[]>();
  for (const r of wanted) exemplars.set(r.slug, await exemplarsFor(r.slug, days, 2));

  const findings = `
    <p class="mv-lede">Across ${c.nowStories.toLocaleString('en-US')} stories in the last
      ${days} days, ${rows.length} technologies had enough history on both sides to be
      compared. ${surging.length} grew their share of the archive sharply,
      ${growing.length} grew, ${steady.length} held steady and ${fading.length} declined.</p>

    <h3 class="mv-h">Growing</h3>
    ${surging.length + growing.length === 0
      ? '<p class="note">Nothing grew its share this window.</p>'
      : `<table class="mvt">${HEAD}<tbody>${
        [...surging, ...growing].slice(0, 12).map(movementRow).join('')}</tbody></table>`}

    <h3 class="mv-h">Declining</h3>
    ${fading.length === 0
      ? '<p class="note">Nothing lost share this window.</p>'
      : `<table class="mvt">${HEAD}<tbody>${
        fading.slice(0, 10).map(movementRow).join('')}</tbody></table>`}`;

  const evidence = `
    <p class="note">Every verdict above is a share comparison. These are stories it was
      computed from &mdash; open one and the claim is either there or it is not.</p>
    ${wanted.map((r) => {
    const ex = exemplars.get(r.slug) ?? [];
    if (ex.length === 0) return '';
    return `<div class="mv-ev">
        <h4><a href="/trend/${encodeURIComponent(r.slug)}">${escapeHtml(r.name)}</a>
          <span class="mv mv-${r.verdict}">${escapeHtml(r.label)}</span>
          <span class="muted">${r.nowN} stories, ${r.sources} sources,
            ${r.independent} independent</span></h4>
        <ul>${ex.map((e) => `<li>
          <a href="/read/${escapeHtml(e.id)}">${escapeHtml(truncate(e.title, 110))}</a>
          <span class="muted">${escapeHtml(e.source)} &middot; ${escapeHtml(e.kind)}
            &middot; ${escapeHtml(e.when)}</span></li>`).join('')}</ul>
      </div>`;
  }).join('')}`;

  const recommendation = `
    <p class="note">Ranked by independent corroboration first and movement second. A
      technology whose only sources are the people who make it is not ranked here,
      however fast it is moving.</p>
    ${picks.length === 0
      ? '<p class="note">Nothing growing this window has independent corroboration yet.</p>'
      : `<ol class="mv-rec">${picks.map((p) => `<li>
          <a href="/trend/${encodeURIComponent(p.row.slug)}">${escapeHtml(p.row.name)}</a>
          <span class="mv mv-${p.strength}">${escapeHtml(p.strength)}</span>
          <p>${escapeHtml(p.why)}.</p></li>`).join('')}</ol>`}

    ${selfDescribed.length === 0 ? '' : `
      <h3 class="mv-h">Moving, but only its own people are saying so</h3>
      <p class="note">Real activity, no independent source. A vendor is authoritative about
        what it shipped and worthless as evidence that anyone wanted it.</p>
      <ul class="mv-list">${selfDescribed.map((r) => `<li>
        <a href="/trend/${encodeURIComponent(r.slug)}">${escapeHtml(r.name)}</a>
        <span class="muted">${r.nowN} stories from ${r.sources}
          source${r.sources === 1 ? '' : 's'}, none independent</span></li>`).join('')}</ul>`}`;

  const limits = `
    <ul class="mv-list">
      <li><b>The archive grew under the measurement.</b>
        ${c.prevStories.toLocaleString('en-US')} stories from ${c.prevSources} sources in the
        earlier window, ${c.nowStories.toLocaleString('en-US')} from ${c.nowSources} in the
        later one &mdash; ${c.volumeRatio.toFixed(2)}&times; the volume from
        ${c.sourceRatio.toFixed(2)}&times; the sources. Verdicts compare each technology's
        <b>share</b> of its own window for exactly this reason: if collection doubles
        uniformly, every share is unchanged and every verdict is &ldquo;steady&rdquo;.</li>
      <li><b>${report.belowFloor.toLocaleString('en-US')} technologies are not reported.</b>
        Fewer than ${MIN_NOW} stories in the window, or fewer than ${MIN_TOTAL} across both.
        A ratio built on three stories is arithmetic, not evidence.</li>
      ${report.unbaselined.length === 0 ? '' : `<li><b>${report.unbaselined.length} are newly
        covered</b> &mdash; real activity now, under ${MIN_PREV} stories before, so there is
        no baseline to measure against. They are named rather than ranked:
        ${report.unbaselined.slice(0, 6).map((r) =>
    `<a href="/trend/${encodeURIComponent(r.slug)}">${escapeHtml(r.name)}</a>`).join(', ')}.
        A feed being switched on looks exactly like a technology arriving, and this archive
        has switched several on recently.</li>`}
    </ul>`;

  // THE WRITTEN BRIEFING COMES FIRST, AND IS NOT RE-GENERATED PER VIEW.
  //
  // It is written once a day by the `report` job and read here. Generating it on
  // view would cost a model call per refresh and, worse, would give two people
  // looking at the same archive two different briefings -- a report that changes
  // when you reload is not a report.
  //
  // The measured sections below it are computed live, because those are counts
  // and counts should be current. So the page is one dated statement over
  // today's evidence, which is the honest arrangement of the two.
  const latest = await latestWritten(days).catch(() => null);
  const w = latest?.written ?? null;
  const briefing = !w ? `<p class="note">No briefing has been written yet. The
      <code>report</code> job writes one daily; the measured findings below are live.</p>`
    : `<p class="mv-lede">${escapeHtml(w.summary)}</p>
       ${w.body.split(/\n{2,}/).map((para) =>
    `<p class="mv-body">${escapeHtml(para.trim())}</p>`).join('')}
       ${(w.watch ?? []).length === 0 ? '' : `<h3 class="mv-h">What to watch</h3>
         <ul class="mv-list">${w.watch.map((x) =>
    `<li>${escapeHtml(x)}</li>`).join('')}</ul>`}
       <p class="note">Written ${escapeHtml(latest!.day)} from the evidence below,
         by ${escapeHtml(w.provider ?? 'an unnamed model')}. It may name only what
         that evidence contains.</p>`;

  return wrap(`
    ${pageHead(latest?.title ?? reportTitle(report, new Date().toISOString().slice(0, 10)),
    `What moved over ${days} days, what says so, and what to do about it`,
    { crumbs: crumbsFor('/trends/report', 'Analyse') })}
    <form method="get" action="/trends/report" class="row" style="--row-gap:var(--s-2)">
      <label for="f-days">Window</label>
      <select id="f-days" name="days" onchange="this.form.submit()">
        ${[30, 90, 180, 365].map((d) => `<option value="${d}"${
    d === days ? ' selected' : ''}>${d} days</option>`).join('')}
      </select>
    </form>
    <h2 class="sect">The briefing</h2>${briefing}
    <h2 class="sect">The finding</h2>${findings}
    <h2 class="sect">The evidence</h2>${evidence}
    <h2 class="sect">What to watch</h2>${recommendation}
    <h2 class="sect">What this cannot tell you</h2>${limits}`);
}

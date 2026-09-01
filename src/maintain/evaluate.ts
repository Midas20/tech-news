// Measuring sources against what they actually produced.
//
// Every number in this file is computed from the archive's own history. None of
// it is typed in, and none of it is inferred from a source's reputation. That
// is the whole distinction the schema draws: authority is a PRIOR and needs a
// person, everything here is MEASURED and needs only the record.
//
// The rule that produced most of the care below: a number that cannot be
// computed honestly is left NULL. Not zero. A source with eleven stories has no
// meaningful duplicate rate, and writing 0 would put it top of the ranking for
// cleanliness. NULL says "no evidence", which is true, and the composite score
// knows to skip it.
//
// ---------------------------------------------------------------------------
// THE DENOMINATOR, WHICH IS THE WHOLE PROBLEM
//
// `fetch_log.items_kept / items_seen` looks like signal density and is not.
// `items_kept` counts items NEWLY STORED, so any feed the archive has already
// backfilled reports zero: measured live, TechCrunch scored 0% on 280 items,
// InfoQ 0% on 2,070, Stripe 0% on 12,601. Those are not noisy sources, they are
// finished ones -- the collector had already seen every item in the feed.
//
// So the denominator is not what the feed OFFERED, it is what the gauntlet
// JUDGED. `already_archived`, `duplicate` and `duplicate_url` are the archive
// recognising something it has seen; they say nothing about the source's
// quality and are excluded. What is left -- kept, off_topic, too_short,
// not_an_event, build_noise -- is the set of items on which an actual judgement
// about worth was made, and the share of those that survived is signal density.
//
// A source polled hourly whose feed never changes will produce an empty
// denominator and a NULL density, which is correct.

import type { Db } from '../db/client.ts';
import { composite, DEFAULT_WEIGHTS, type ScoreWeights } from '../vocab/intel.ts';

/** Drop reasons that mean "already seen", not "judged and refused". */
const SEEN_BEFORE = ['already_archived', 'duplicate', 'duplicate_url'];

/** Drop reasons that mean the gauntlet looked at it and said no. */
const JUDGED_AND_REFUSED = ['off_topic', 'too_short', 'not_an_event', 'build_noise'];

/** Of those, the ones that are the SOURCE's fault rather than the extractor's. */
const NOISE_REASONS = ['off_topic', 'build_noise'];

export interface EvaluateReport {
  windowDays: number;
  sources: number;
  measured: number;
  /** Sources where nothing could be measured at all. */
  silent: number;
  scored: number;
  /** Average number of the eight dimensions actually known, across scored sources. */
  meanKnown: number;
  gaps: string[];
}

export interface EvaluateOptions {
  windowDays?: number;
  weights?: ScoreWeights;
  apply?: boolean;
}

const sqlJudged = `
  coalesce(sum((f.drop_reasons ->> 'off_topic')::int), 0)
+ coalesce(sum((f.drop_reasons ->> 'too_short')::int), 0)
+ coalesce(sum((f.drop_reasons ->> 'not_an_event')::int), 0)
+ coalesce(sum((f.drop_reasons ->> 'build_noise')::int), 0)`;

interface MetricRow {
  source_id: string;
  name: string;
  stories: number;
  signal_density: number | null;
  noise_score: number | null;
  duplicate_rate: number | null;
  freshness: number | null;
  availability: number | null;
  market_relevance: number | null;
  developer_relevance: number | null;
  enterprise_relevance: number | null;
  originality: number | null;
  early_signal: number | null;
  confirmations: number;
  authority_score: number | null;
  expertise_score: number | null;
}

/**
 * One pass over the archive, one row per source per window.
 *
 * Written as a single query per dimension family rather than per source: 308
 * sources times eight round trips is a job that takes minutes and locks
 * nothing usefully, and every one of these is a plain aggregate.
 */
export async function evaluateSources(
  db: Db, opts: EvaluateOptions = {},
): Promise<EvaluateReport> {
  const days = opts.windowDays ?? 90;
  const weights = opts.weights ?? DEFAULT_WEIGHTS;

  const rows = await db.query<MetricRow>(
    `
    WITH win AS (SELECT (now() - make_interval(days => $1))::timestamptz AS from_ts),

    -- Signal density and availability, from the poller's own record.
    fetches AS (
      SELECT f.source_id,
             ${sqlJudged} AS refused,
             coalesce(sum(f.items_kept), 0) AS kept,
             coalesce(sum((f.drop_reasons ->> 'off_topic')::int), 0)
           + coalesce(sum((f.drop_reasons ->> 'build_noise')::int), 0) AS noisy,
             coalesce(sum((f.drop_reasons ->> 'duplicate')::int), 0) AS dupes,
             count(*) AS polls,
             count(*) FILTER (WHERE f.status BETWEEN 200 AND 399) AS ok
        FROM fetch_log f, win
       WHERE f.fetched_at >= win.from_ts
       GROUP BY f.source_id),

    -- When the archive started watching each source. sources.first_seen_at
    -- cannot answer this -- every row in the registry carries a date from the
    -- week the table was last rebuilt -- so it is taken from the record
    -- itself: the first story the collector ever stored from that source.
    watching AS (
      SELECT source_id, min(first_seen_at) AS watching_since
        FROM stories GROUP BY source_id),

    -- Relevance, measured against what this platform tracks rather than
    -- against the source's reputation.
    told AS (
      SELECT s.source_id,
             count(*) AS stories,
             count(*) FILTER (WHERE cardinality(s.stacks) > 0
                                 OR cardinality(s.platforms) > 0
                                 OR cardinality(s.companies) > 0) AS relevant,
             count(*) FILTER (WHERE cardinality(s.stacks) > 0) AS dev,
             count(*) FILTER (WHERE cardinality(s.companies) > 0
                                 OR cardinality(s.platforms) > 0) AS ent,
             -- FRESHNESS, AND WHY THE OBVIOUS VERSION IS WRONG.
             --
             -- Lag is first_seen_at - published_at, and over all rows that
             -- measures the backfill: 13,086 hours for Vercel, 1,155 even
             -- after excluding the first days of polling. Those numbers
             -- describe an import.
             --
             -- A lag is only meaningful for a story published AFTER the
             -- archive started watching the source. Anything older was
             -- always going to arrive late, however fast the feed is. Cut
             -- there and AWS What's New goes from 165 hours to 3.3, which is
             -- the number that was actually being asked for.
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY extract(epoch FROM (s.first_seen_at - s.published_at)) / 3600.0)
               FILTER (WHERE s.published_at >= w.watching_since) AS lag_hours
        FROM stories s
        JOIN watching w ON w.source_id = s.source_id, win
       WHERE s.collected_at >= win.from_ts
       GROUP BY s.source_id),

    -- Confirmation: this source's stories that another source also reported.
    -- Currently near zero across the registry, which is a finding about the
    -- portfolio rather than a bug in the measurement.
    confirmed AS (
      SELECT s.source_id, count(DISTINCT m.story_id) AS n
        FROM story_members m JOIN stories s ON s.id = m.story_id, win
       WHERE m.source_id <> s.source_id AND m.seen_at >= win.from_ts
       GROUP BY s.source_id),

    -- Originality: was this source the one the archive credited with the
    -- event, or did it turn up afterwards as a member of somebody else's?
    follower AS (
      SELECT m.source_id, count(*) AS n
        FROM story_members m JOIN stories s ON s.id = m.story_id, win
       WHERE m.source_id <> s.source_id AND m.seen_at >= win.from_ts
       GROUP BY m.source_id),

    -- Early signal: of the technologies this source wrote about, how often was
    -- it among the first three sources in the archive to mention one. This is
    -- the brief's "identifies important developments early", expressed as
    -- something the record can actually answer.
    mentions AS (
      SELECT unnest(s.stacks) AS slug, s.source_id, min(s.first_seen_at) AS at
        FROM stories s, win
       WHERE s.collected_at >= win.from_ts AND cardinality(s.stacks) > 0
       GROUP BY 1, 2),
    ranked AS (
      SELECT slug, source_id, rank() OVER (PARTITION BY slug ORDER BY at) AS pos
        FROM mentions),
    early AS (
      SELECT source_id,
             count(*) FILTER (WHERE pos <= 3) AS first_movers,
             count(*) AS covered
        FROM ranked GROUP BY source_id)

    SELECT src.id::text AS source_id, src.name,
           coalesce(t.stories, 0)::int AS stories,
           CASE WHEN coalesce(f.kept, 0) + coalesce(f.refused, 0) >= 20
                THEN round(100.0 * f.kept / (f.kept + f.refused))::int END AS signal_density,
           CASE WHEN coalesce(f.kept, 0) + coalesce(f.refused, 0) >= 20
                THEN round(100.0 * f.noisy / (f.kept + f.refused))::int END AS noise_score,
           CASE WHEN coalesce(f.dupes, 0) + coalesce(f.kept, 0) >= 20
                THEN round(100.0 * f.dupes / (f.dupes + f.kept))::int END AS duplicate_rate,
           CASE WHEN t.lag_hours IS NOT NULL
                -- 0 hours -> 100, 48 hours or worse -> 0. Beyond two days a
                -- feed is not breaking anything.
                THEN greatest(0, least(100, round(100 - (t.lag_hours / 48.0) * 100)))::int END AS freshness,
           CASE WHEN coalesce(f.polls, 0) >= 10
                THEN round(100.0 * f.ok / f.polls)::int END AS availability,
           CASE WHEN coalesce(t.stories, 0) >= 10
                THEN round(100.0 * t.relevant / t.stories)::int END AS market_relevance,
           CASE WHEN coalesce(t.stories, 0) >= 10
                THEN round(100.0 * t.dev / t.stories)::int END AS developer_relevance,
           CASE WHEN coalesce(t.stories, 0) >= 10
                THEN round(100.0 * t.ent / t.stories)::int END AS enterprise_relevance,
           -- NULL unless somebody else covered something too. Almost always
           -- NULL today, and that is the honest answer.
           CASE WHEN coalesce(c.n, 0) + coalesce(fl.n, 0) >= 5
                THEN round(100.0 * c.n / (c.n + fl.n))::int END AS originality,
           CASE WHEN coalesce(e.covered, 0) >= 10
                THEN round(100.0 * e.first_movers / e.covered)::int END AS early_signal,
           coalesce(c.n, 0)::int AS confirmations,
           src.authority_score, src.expertise_score
      FROM sources src
      LEFT JOIN fetches f ON f.source_id = src.id
      LEFT JOIN told t ON t.source_id = src.id
      LEFT JOIN confirmed c ON c.source_id = src.id
      LEFT JOIN follower fl ON fl.source_id = src.id
      LEFT JOIN early e ON e.source_id = src.id
    `, [days]);

  const report: EvaluateReport = {
    windowDays: days, sources: rows.length, measured: 0, silent: 0, scored: 0,
    meanKnown: 0, gaps: [],
  };

  let knownTotal = 0;
  for (const r of rows) {
    const anything = r.signal_density ?? r.market_relevance ?? r.availability
      ?? r.freshness ?? r.early_signal;
    if (anything === null || anything === undefined) { report.silent++; continue; }
    report.measured++;

    const c = composite({
      authority: r.authority_score,
      expertise: r.expertise_score,
      originality: r.originality,
      market: r.market_relevance,
      density: r.signal_density,
      developer: r.developer_relevance,
      enterprise: r.enterprise_relevance,
      early: r.early_signal,
    }, weights);

    if (c) { report.scored++; knownTotal += c.known; }

    if (opts.apply) {
      await db.query(
        `INSERT INTO source_metrics (
           source_id, window_end, window_days, stories, signal_density, noise_score,
           originality, duplicate_rate, freshness, market_relevance, developer_relevance,
           enterprise_relevance, early_signal, availability, confirmations)
         VALUES ($1::uuid, current_date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (source_id, window_end, window_days) DO UPDATE SET
           stories = excluded.stories, signal_density = excluded.signal_density,
           noise_score = excluded.noise_score, originality = excluded.originality,
           duplicate_rate = excluded.duplicate_rate, freshness = excluded.freshness,
           market_relevance = excluded.market_relevance,
           developer_relevance = excluded.developer_relevance,
           enterprise_relevance = excluded.enterprise_relevance,
           early_signal = excluded.early_signal, availability = excluded.availability,
           confirmations = excluded.confirmations, computed_at = now()`,
        [r.source_id, days, r.stories, r.signal_density, r.noise_score, r.originality,
          r.duplicate_rate, r.freshness, r.market_relevance, r.developer_relevance,
          r.enterprise_relevance, r.early_signal, r.availability, r.confirmations]);

      // The composite is cached for ordering. It never gates admission and it
      // never causes a source to be dropped -- degradation here means a lower
      // place in a list, nothing more.
      await db.query(
        `UPDATE sources SET overall_score = $2, last_evaluated_at = now() WHERE id = $1::uuid`,
        [r.source_id, c?.score ?? null]);
    }
  }

  report.meanKnown = report.scored ? Math.round((knownTotal / report.scored) * 10) / 10 : 0;
  return report;
}

export function summariseEvaluate(r: EvaluateReport): string {
  return `${r.measured} of ${r.sources} measured over ${r.windowDays}d`
    + `, ${r.scored} scored on ${r.meanKnown}/8 dimensions`
    + `${r.silent ? `, ${r.silent} silent` : ''}`;
}

// One collection cycle, fanned out across sources.
//
// This is the piece that makes collection continuous rather than batch. A cycle
// takes whatever is due, polls it with bounded concurrency, and returns; the
// caller decides whether that happens every fifteen minutes from a cron trigger
// or every few seconds from a long-running process. Both call the same function.
//
// Two ceilings, both necessary and both measured into existence:
//   - per source (ingest.ts): one slow host cannot own the cycle
//   - per cycle  (here):      the cycle cannot outlive its scheduling interval

import type { Db } from '../db/client.ts';
import type { SourceRow } from '../db/repos/sources.ts';
import { dueSources } from '../db/repos/sources.ts';
import { collectSource, type CollectOptions } from './pipeline.ts';
import { PolitenessGate } from './fetcher.ts';
import { mapWithConcurrency } from '../lib/pool.ts';
import { getConfig } from '../config.ts';
import { canAfford, budgetState } from '../lib/subrequests.ts';

export interface CycleOptions {
  /** Poll only this shard. Omit to take whatever is due across all shards. */
  shard?: number;
  limit?: number;
  concurrency?: number;
  deadlineMs?: number;
  userAgent?: string;
  /** Off in the Worker: article pages are the biggest subrequest consumer. */
  fetchArticles?: boolean;
  /** Bound CPU per source by taking only the newest N items of each feed. */
  maxItemsPerSource?: number;
  /** Shared across the whole cycle so politeness is global, not per source. */
  politeness?: PolitenessGate;
  onSource?: (name: string, kept: number, seen: number, ms: number, error: string | null) => void;
}

export interface CycleReport {
  sources: number;
  /** Sources left unpolled because the invocation ran out of subrequests. */
  outOfBudget?: number;
  seen: number;
  kept: number;
  duplicates: number;
  errors: number;
  skipped: number;
  ms: number;
  subrequests?: number;
}

/**
 * Worst-case outbound cost of one source: the feed fetch, plus headroom for a
 * redirect and a couple of article fetches. Deliberately pessimistic -- running
 * out mid-source is far worse than stopping one source early.
 */
const SUBREQUESTS_PER_SOURCE = 4;

export async function runCycle(db: Db, opts: CycleOptions = {}): Promise<CycleReport> {
  const config = getConfig();
  const started = Date.now();
  const deadline = started + (opts.deadlineMs ?? 5 * 60_000);
  const politeness = opts.politeness ?? new PolitenessGate(config.fetch.politenessMs);

  const sources = opts.shard === undefined
    ? await dueAcrossShards(db, opts.limit ?? 60)
    : await dueSources(db, opts.shard, opts.limit ?? 60);

  const report: CycleReport = {
    sources: sources.length, seen: 0, kept: 0, duplicates: 0, errors: 0, skipped: 0, ms: 0,
  };

  const collectOpts: CollectOptions = {
    userAgent: opts.userAgent ?? config.fetch.userAgent,
    politeness,
    collectionMode: 'live',
    ...(opts.fetchArticles === undefined ? {} : { fetchArticles: opts.fetchArticles }),
    ...(opts.maxItemsPerSource === undefined ? {} : { maxItemsPerSource: opts.maxItemsPerSource }),
  };

  await mapWithConcurrency(sources, opts.concurrency ?? config.fetch.maxConcurrency, async (source) => {
    // Past the cycle deadline, leave the rest due. Nothing is lost: next_fetch_at
    // was never advanced for them, so the next cycle picks them up first.
    if (Date.now() > deadline) {
      report.skipped++;
      return;
    }
    // Stop while there is still allowance left rather than being killed
    // mid-source. Anything unpolled stays due; next_fetch_at never advanced.
    if (!canAfford(SUBREQUESTS_PER_SOURCE)) {
      report.outOfBudget = (report.outOfBudget ?? 0) + 1;
      return;
    }
    const t0 = Date.now();
    try {
      const summary = await collectSource(db, source, collectOpts);
      report.seen += summary.itemsSeen;
      report.kept += summary.itemsKept;
      report.duplicates += summary.duplicates;
      if (summary.error) report.errors++;
      opts.onSource?.(source.name, summary.itemsKept, summary.itemsSeen, Date.now() - t0, summary.error);
    } catch (err) {
      // Per-source failure isolation: one dead feed must never stall a cycle.
      report.errors++;
      opts.onSource?.(source.name, 0, 0, Date.now() - t0,
        err instanceof Error ? err.message : String(err));
    }
  });

  report.ms = Date.now() - started;
  const budget = budgetState();
  if (budget) report.subrequests = budget.used;
  return report;
}

/**
 * Everything due, most-neglected first, regardless of which shard it owns.
 *
 * The order used to be (poll_interval_seconds, next_fetch_at) -- shortest
 * interval wins. That is a strict priority queue, and a strict priority queue
 * starves every class below the first one that can saturate the server. It did:
 * the 30-minute tier is 167 sources, so it alone needs ~334 polls an hour, and a
 * tick taking 8 sources every 5 minutes supplies 96. Nothing below that tier was
 * ever reached. Not slowly -- never: 164 sources had sat unfetched since the day
 * they were registered, at ranks 127 to 404 of a 404-long queue.
 *
 * So the order is now LATENESS MEASURED IN THE SOURCE'S OWN INTERVALS. A feed
 * promising half-hourly freshness that is an hour late scores 2.0; a daily feed
 * six hours late scores 0.25, and waits. A source that has never been fetched
 * scores enormously and goes first, once, after which it takes its place in the
 * same rotation as everything else. Every source is served in bounded time and
 * the tiers still mean what they say.
 */
async function dueAcrossShards(db: Db, limit: number): Promise<SourceRow[]> {
  return db.query<SourceRow>(
    `SELECT id, name, url, feed_url, feed_kind, kind::text, roles, lang, country, trust_weight,
            weight_content, never_canonical, fields, poll_interval_seconds,
            politeness_seconds, requires_secret, last_etag, last_modified,
            consecutive_failures, health, company_slug, tech_only
       FROM sources
      WHERE health NOT IN ('dead','paused')
        AND next_fetch_at <= now()
      ORDER BY extract(epoch FROM (now() - next_fetch_at))
               / greatest(poll_interval_seconds, 60) DESC,
               next_fetch_at
      LIMIT $1`,
    [limit],
  );
}

/**
 * Adaptive polling.
 *
 * A fixed interval is wrong in both directions: it hammers a blog that posts
 * twice a month and starves a newswire that posts twice an hour. This moves each
 * source's interval toward its observed publication rate, inside the tier bounds
 * the operator configured, and it only ever moves one step at a time so a quiet
 * afternoon does not retire a busy source.
 */
export async function tuneIntervals(db: Db): Promise<{ faster: number; slower: number }> {
  const config = getConfig();

  const [row] = await db.query<{ faster: string; slower: string }>(
    `WITH yield AS (
       SELECT s.id,
              s.poll_interval_seconds AS interval_s,
              -- How far this source may be backed off for being quiet.
              --
              -- Backing off a silent source used to mean the cold tier for
              -- everything, and that is the wrong trade for news. The reason to
              -- poll less often is cost, and a quiet feed costs almost nothing:
              -- it answers 304 Not Modified with no body. What backing off
              -- actually buys is a few bytes; what it spends is latency, and
              -- latency is the entire product for a news reader. A blog that
              -- posts weekly still deserves to be noticed within the hour.
              --
              -- Release feeds were the exception that made the rule readable:
              -- a project can be silent for months, and there are 300 of them. The
              -- exception is now nearly nothing -- COLD is an hour rather than six
              -- -- because the argument was measured and lost: with a six-hour
              -- ceiling the median item published in the last day reached the page
              -- 3.3 hours late and the 90th percentile 8.5 hours. The two tiers
              -- stay separate so the distinction is still expressible.
              CASE WHEN s.kind = 'releases' THEN $2::int ELSE $3::int END AS ceiling,
              count(f.id) FILTER (WHERE f.fetched_at > now() - interval '24 hours') AS fetches,
              coalesce(sum(f.items_kept) FILTER (WHERE f.fetched_at > now() - interval '24 hours'), 0) AS kept
         FROM sources s
         LEFT JOIN fetch_log f ON f.source_id = s.id
        WHERE s.health = 'healthy'
        GROUP BY s.id, s.poll_interval_seconds, s.kind
       HAVING count(f.id) FILTER (WHERE f.fetched_at > now() - interval '24 hours') >= 3
     ),
     moved AS (
       UPDATE sources s SET poll_interval_seconds = CASE
           -- producing on most polls: poll it sooner, never below the hot tier
           WHEN y.kept::numeric / GREATEST(y.fetches, 1) >= 1.0
             THEN GREATEST($1::int, (s.poll_interval_seconds / 2))
           -- silent across many polls: back off, but only as far as this KIND
           -- of source earns -- see the ceiling in the CTE above.
           WHEN y.kept = 0
             THEN LEAST(y.ceiling, (s.poll_interval_seconds * 2))
           ELSE s.poll_interval_seconds
         END
         FROM yield y
        WHERE y.id = s.id
          AND s.poll_interval_seconds <> CASE
            WHEN y.kept::numeric / GREATEST(y.fetches, 1) >= 1.0
              THEN GREATEST($1::int, (s.poll_interval_seconds / 2))
            WHEN y.kept = 0 THEN LEAST(y.ceiling, (s.poll_interval_seconds * 2))
            ELSE s.poll_interval_seconds END
       RETURNING s.id, y.interval_s AS was, s.poll_interval_seconds AS now
     )
     SELECT count(*) FILTER (WHERE now < was)::text AS faster,
            count(*) FILTER (WHERE now > was)::text AS slower
       FROM moved`,
    // Three bounds: the floor, the ceiling for release feeds, and the tighter
    // ceiling for everything a person actually reads.
    [config.schedule.hotSeconds, config.schedule.coldSeconds, config.schedule.warmSeconds],
  );

  return { faster: Number(row?.faster ?? 0), slower: Number(row?.slower ?? 0) };
}

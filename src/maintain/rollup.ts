// Turn a month of stories into the analysis that outlives them.
//
// This was the body of scripts/rollup.ts and nothing about the SQL has changed.
// It moved here because the scheduler has to run it too, and a maintenance job
// that exists twice -- once as a command and once as whatever the scheduler
// reimplemented -- is a pair of programs that will disagree the first time one
// of them is fixed.
//
// The rule this file exists to enforce: analysis before deletion, always.
// `rollup_log` is the record of which months have been reduced, and the pruner
// refuses to touch a month that is not in it, because stories are the only copy
// of themselves.
//
// AN OPEN MONTH IS NEVER ROLLED UP. A month inside the retention window is
// still accumulating, so any aggregate of it is a partial answer -- and worse,
// a month in `rollup_log` is CLOSED TO INGEST (see isArchived in
// collect/ingest.ts), so settling one stops collection dead for it.
//
// This used to say "the current month", which is the same thing only when
// keepMonths is 1. With 2 it settled July while retention was still keeping
// July, and the archive spent a month refusing half of its own window: 557 July
// items on offer across 50 live feeds on 2026-08-28, one July story held. The
// window is now the single answer to "is this month finished", read from
// lib/retention.ts by the collector, this file, and the pruner alike.

import type { Db } from '../db/client.ts';
import { getConfig } from '../config.ts';
import { isOpenMonth, monthOffset } from '../lib/retention.ts';

export interface MonthReport {
  month: string;
  seen: number;
  stacks: number;
  pairs: number;
}

export interface RollupOptions {
  /** One month, as YYYY-MM. Omit to take every settled month that needs one. */
  month?: string;
  /** Re-roll a month that has already been pruned. Almost never right. */
  force?: boolean;
}

export class RollupRefused extends Error {}

/** The month still filling up. Kept for callers that report on it. */
export async function currentMonth(db: Db): Promise<string> {
  const [row] = await db.query<{ m: string }>(
    `SELECT to_char(date_trunc('month', now()), 'YYYY-MM') AS m`);
  return row?.m ?? '';
}

/**
 * Is this month still inside the window the archive keeps whole?
 *
 * Asked of the DATABASE's clock rather than the process's, because the pruner
 * computes its cutoff in SQL and a rollup that disagreed with it by an hour on
 * the 1st of a month would settle a month the pruner still protects.
 */
export async function isOpen(db: Db, month: string): Promise<boolean> {
  const [row] = await db.query<{ now: string }>(`SELECT now()::text AS now`);
  return isOpenMonth(month, getConfig().retention.keepMonths,
                     row ? new Date(row.now) : new Date());
}

/**
 * Months with stories, excluding any month still open -- and excluding any
 * month that has already been pruned.
 *
 * That second exclusion is load-bearing. rollMonth() is delete-then-insert per
 * month, which is what makes it safely repeatable BEFORE a prune. After one, the
 * month's stories are gone except the handful somebody starred, so re-rolling it
 * would replace thirty thousand stories' worth of analysis with three --
 * silently, and with no way back.
 */
export async function pendingMonths(db: Db, opts: RollupOptions = {}): Promise<string[]> {
  if (opts.month) {
    const month = `${opts.month}-01`;
    if (await isOpen(db, opts.month) && !opts.force) {
      throw new RollupRefused(
        `${opts.month} is still inside the ${getConfig().retention.keepMonths}-month `
        + `retention window. Rolling it up would close it to collection: ingest refuses `
        + `any story whose month is already rolled, so every source would fetch normally `
        + `and keep nothing from ${opts.month} until it leaves the window.`);
    }
    if (!opts.force) {
      const [pruned] = await db.query<{ n: string }>(
        `SELECT stories_pruned::text AS n FROM rollup_log
          WHERE month = $1::date AND pruned_at IS NOT NULL`, [month]);
      if (pruned) {
        throw new RollupRefused(
          `${opts.month} was pruned (${pruned.n} stories deleted). Re-rolling it would `
          + `overwrite its analysis with whatever survived.`);
      }
    }
    return [month];
  }

  const rows = await db.query<{ m: string }>(
    `SELECT DISTINCT date_trunc('month', s.published_at)::date::text AS m
       FROM stories s
      WHERE s.published_at IS NOT NULL
        -- Outside the retention window: the same boundary the collector and
        -- the pruner use, expressed once here in the database's own clock.
        AND date_trunc('month', s.published_at)
              < date_trunc('month', now()) - make_interval(months => $1::int)
        -- A PRUNED MONTH IS NEVER RE-ROLLED, dirty or not.
        --
        -- This clause was briefly written the other way, so that a month
        -- marked dirty by a late arrival would be recomputed. That would have
        -- destroyed the thing the retention contract exists to protect.
        --
        -- rollMonth is a delete-then-insert for the month. For a month whose
        -- stories were pruned, the rows still present are a FRAGMENT of what
        -- the analysis was computed from: 2026-04 holds 333 stories and its
        -- stack_month says 23,561, because it was rolled when the archive still
        -- had them and then pruned. Re-rolling would replace the complete
        -- record with the fragment, permanently, and "monthly analysis
        -- outlives the stories" is the one promise this system cannot re-derive
        -- once broken.
        --
        -- The cost of leaving it: a late arrival into a pruned month is held
        -- and displayed, but is not counted in that month's analysis. That is
        -- an understatement of history, which is recoverable by anyone who
        -- looks at the stories; the alternative was an unrecoverable loss.
        ${opts.force ? '' : `AND NOT EXISTS (
          SELECT 1 FROM rollup_log l
           WHERE l.month = date_trunc('month', s.published_at)::date
             AND l.pruned_at IS NOT NULL)`}
      ORDER BY 1`, [monthOffset(getConfig().retention.keepMonths)]);
  return rows.map((r) => r.m);
}

/**
 * One month, reduced.
 *
 * Every statement is a delete-then-insert for that month alone, so running it
 * twice produces the same rows and a month can be re-rolled after a vocabulary
 * change without touching its neighbours.
 */
export async function rollMonth(db: Db, month: string): Promise<MonthReport> {
  const p = [month];

  // --- the denominator ----------------------------------------------------
  await db.query(`DELETE FROM month_totals WHERE month = $1::date`, p);
  await db.query(
    `INSERT INTO month_totals (month, stories, tagged_stories, distinct_sources,
                               active_sources, releases, news, community, research)
     SELECT $1::date,
            count(*),
            count(*) FILTER (WHERE array_length(s.stacks, 1) > 0),
            count(DISTINCT s.source_id),
            count(DISTINCT s.source_id),
            count(*) FILTER (WHERE src.kind = 'releases'),
            count(*) FILTER (WHERE src.kind = 'news'),
            count(*) FILTER (WHERE src.kind = 'community'),
            count(*) FILTER (WHERE src.kind = 'research')
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE date_trunc('month', s.published_at) = $1::date
        AND s.superseded_by IS NULL`, p);

  // --- one row per technology --------------------------------------------
  await db.query(`DELETE FROM stack_month WHERE month = $1::date`, p);
  const stacks = await db.query<{ n: string }>(
    `WITH tagged AS (
       SELECT s.id, s.source_id, s.published_at, s.importance, s.coverage_count,
              src.kind AS source_kind, k.slug
         FROM stories s
         JOIN sources src ON src.id = s.source_id
         JOIN unnest(s.stacks) AS k(slug) ON true
        WHERE date_trunc('month', s.published_at) = $1::date
          AND s.superseded_by IS NULL
     ), agg AS (
       SELECT slug,
              count(*)::int AS stories,
              count(DISTINCT source_id)::int AS distinct_sources,
              coalesce(sum(coverage_count), 0)::int AS outlet_mentions,
              count(*) FILTER (WHERE source_kind = 'releases')::int AS from_releases,
              count(*) FILTER (WHERE source_kind = 'news')::int AS from_news,
              count(*) FILTER (WHERE source_kind = 'community')::int AS from_community,
              count(*) FILTER (WHERE source_kind = 'research')::int AS from_research,
              round(avg(importance), 2) AS avg_importance,
              max(importance)::int AS max_importance,
              min(published_at)::date AS first_published,
              max(published_at)::date AS last_published
         FROM tagged GROUP BY slug
     )
     INSERT INTO stack_month (month, slug, stories, distinct_sources, outlet_mentions,
                              from_releases, from_news, from_community, from_research,
                              avg_importance, max_importance, share, rank_in_month,
                              first_published, last_published)
     SELECT $1::date, a.slug, a.stories, a.distinct_sources, a.outlet_mentions,
            a.from_releases, a.from_news, a.from_community, a.from_research,
            a.avg_importance, a.max_importance,
            -- Share of the month's TAGGED stories: an untagged story could not
            -- have counted towards any technology, so it does not belong in the
            -- denominator.
            CASE WHEN t.tagged_stories > 0
                 THEN least(a.stories::numeric / t.tagged_stories, 9.999999)
                 ELSE 0 END,
            rank() OVER (ORDER BY a.stories DESC, a.slug),
            a.first_published, a.last_published
       FROM agg a CROSS JOIN month_totals t
      WHERE t.month = $1::date
     RETURNING 1`, p);

  // --- what appeared beside what ------------------------------------------
  await db.query(`DELETE FROM stack_pair_month WHERE month = $1::date`, p);
  const pairs = await db.query<{ n: string }>(
    `INSERT INTO stack_pair_month (month, slug_a, slug_b, stories)
     SELECT $1::date, a.slug, b.slug, count(*)::int
       FROM stories s, unnest(s.stacks) a(slug), unnest(s.stacks) b(slug)
      WHERE date_trunc('month', s.published_at) = $1::date
        AND s.superseded_by IS NULL
        AND a.slug < b.slug
      GROUP BY 1, 2, 3
      -- Below three co-mentions in a month is noise, and keeping it would make
      -- this table larger than everything else here combined.
     HAVING count(*) >= 3
     RETURNING 1`, p);

  // --- who was talking ----------------------------------------------------
  await db.query(`DELETE FROM source_month WHERE month = $1::date`, p);
  await db.query(
    `INSERT INTO source_month (month, source_id, stories)
     SELECT $1::date, s.source_id, count(*)::int
       FROM stories s
      WHERE date_trunc('month', s.published_at) = $1::date
        AND s.superseded_by IS NULL
      GROUP BY 2`, p);

  // --- companies and platforms, same shape --------------------------------
  for (const [table, column] of [['company_month', 'companies'], ['platform_month', 'platforms']]) {
    await db.query(`DELETE FROM ${table} WHERE month = $1::date`, p);
    await db.query(
      `INSERT INTO ${table} (month, slug, stories, distinct_sources, share)
       SELECT $1::date, e.slug, count(*)::int, count(DISTINCT s.source_id)::int,
              CASE WHEN t.stories > 0
                   THEN least(count(*)::numeric / t.stories, 9.999999) ELSE 0 END
         FROM stories s, unnest(s.${column}) AS e(slug)
         CROSS JOIN month_totals t
        WHERE date_trunc('month', s.published_at) = $1::date
          AND s.superseded_by IS NULL
          AND t.month = $1::date
        GROUP BY e.slug, t.stories`, p);
  }

  // --- the evidence -------------------------------------------------------
  await db.query(`DELETE FROM stack_month_exemplar WHERE month = $1::date`, p);
  await db.query(
    `WITH ranked AS (
       SELECT k.slug,
              coalesce(s.title_en, s.title_original) AS title,
              s.canonical_url AS url, src.name AS source_name,
              s.published_at::date AS published_at,
              s.coverage_count, s.importance,
              row_number() OVER (
                PARTITION BY k.slug
                -- Most widely carried first, then most important. What survives
                -- should be the story a person would have pointed at.
                ORDER BY s.coverage_count DESC NULLS LAST,
                         s.importance DESC NULLS LAST, s.published_at) AS rn
         FROM stories s
         JOIN sources src ON src.id = s.source_id
         JOIN unnest(s.stacks) AS k(slug) ON true
        WHERE date_trunc('month', s.published_at) = $1::date
          AND s.superseded_by IS NULL
     )
     INSERT INTO stack_month_exemplar
            (month, slug, rank, title, url, source_name, published_at, coverage, importance)
     SELECT $1::date, slug, rn::smallint, left(title, 300), url, source_name,
            published_at, coverage_count, importance
       FROM ranked WHERE rn <= 3`, p);

  const [seen] = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM stories
      WHERE date_trunc('month', published_at) = $1::date`, p);

  await db.query(
    `INSERT INTO rollup_log (month, stories_seen, stacks_written, pairs_written, rolled_at)
     VALUES ($1::date, $2, $3, $4, now())
     ON CONFLICT (month) DO UPDATE
        SET stories_seen = excluded.stories_seen,
            stacks_written = excluded.stacks_written,
            pairs_written = excluded.pairs_written,
            rolled_at = now(),
            -- Redone, so no longer dirty. Cleared in the same statement that
            -- records the roll: two statements could leave a month marked
            -- clean that was never rolled, or rolled and still marked.
            dirty_at = NULL`,
    [month, Number(seen?.n ?? 0), stacks.length, pairs.length]);

  return { month, seen: Number(seen?.n ?? 0), stacks: stacks.length, pairs: pairs.length };
}

/** Every month that needs reducing, reduced. Safe to run when there are none. */
export async function rollupAll(db: Db, opts: RollupOptions = {}): Promise<MonthReport[]> {
  const months = await pendingMonths(db, opts);
  const out: MonthReport[] = [];
  for (const m of months) out.push(await rollMonth(db, m));
  return out;
}

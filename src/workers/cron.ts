// Cloudflare Workers entry point.
//
// THREE triggers, not one per job. The Workers free plan allows five cron
// triggers per ACCOUNT, and spending them on a shard rotation was both wasteful
// and less fresh than what replaced it:
//
//   */5  * * * *   tick        poll everything DUE, then capture due snapshots
//   */20 * * * *   process     dedup -> classify -> score
//   0 3 1 * *      maintenance partitions, then retune poll intervals
//
// The tick does not know about shards. It asks for whatever is due across the
// whole registry, hottest interval first, and each source's own
// poll_interval_seconds decides its freshness -- which is what tuneIntervals
// then adjusts from observed publication rate. A source tuned to five minutes
// is polled at five minutes; the scheduler is no longer the bottleneck.

import { createWorkerDb, closeWorkerDb, type Db } from '../db/client.ts';
import { startBudget, clearBudget, budgetState } from '../lib/subrequests.ts';
import { runCycle, tuneIntervals } from '../collect/cycle.ts';
import { captureDueSnapshots } from '../process/snapshot.ts';
import { classifyPending } from '../process/classify.ts';
import { dedupRecent } from '../process/dedup.ts';
import { scoreUnscored } from '../process/score.ts';
import { tagCompanies } from '../process/companies.ts';
import { discoverStacks } from '../process/discover.ts';
import { tagPlatforms } from '../process/platforms.ts';
import { tagStacks } from '../process/tagstacks.ts';
import { configureFromEnv, getConfig } from '../config.ts';
import { applyStoredSettings } from '../db/repos/settings.ts';
import type { LlmContext } from '../llm/router.ts';
import { partitionMonthsBack } from '../lib/retention.ts';

export interface Env {
  DATABASE_URL: string;
  USER_AGENT?: string;
  ANTHROPIC_API_KEY?: string;
  GROQ_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /** Phase gate: "1" during the observation week to collect only. */
  COLLECT_ONLY?: string;
  /** Required to trigger anything over HTTP. Without it, HTTP triggers are off. */
  TRIGGER_SECRET?: string;
  /** Workers subrequest allowance: 50 free, 1000 paid. */
  SUBREQUEST_LIMIT?: string;
  [key: string]: string | undefined;
}

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(withInvocation(env, (db) => dispatch(event.cron, db, env)));
  },

  /**
   * The same entry points over HTTP, for manual re-triggering after an incident.
   *
   * This is a PUBLIC URL. Without TRIGGER_SECRET set, it serves health only --
   * an unauthenticated endpoint that starts a collection cycle is a free denial
   * of service against both this Worker's quota and every source it polls.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health is its own path. Serving it from "/" as well swallowed every
    // trigger request, since a trigger arrives as /?task=tick.
    if (url.pathname === '/healthz') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }

    const provided = request.headers.get('x-trigger-secret') ?? url.searchParams.get('secret') ?? '';
    if (!env.TRIGGER_SECRET || !timingSafeEqual(provided, env.TRIGGER_SECRET)) {
      return new Response('not found', { status: 404 });
    }

    const task = url.searchParams.get('task') ?? '';
    const result = await withInvocation(env, (db) => dispatch(task, db, env));
    return Response.json(result);
  },
};

/**
 * One invocation: configure, open a single pooled database connection, run, and
 * always close it. The subrequest allowance is opened here because it is a
 * property of the INVOCATION, not of any one job.
 */
async function withInvocation<T>(env: Env, fn: (db: Db) => Promise<T>): Promise<T | { error: string }> {
  configureFromEnv(env);
  // 50 on the Workers free plan, 1,000 on paid. Leaving five in reserve means a
  // cycle that stops early still has room to write its own fetch_log rows.
  startBudget(Number(env.SUBREQUEST_LIMIT ?? 50) - 5);
  const db = createWorkerDb(env.DATABASE_URL);
  try {
    // The environment is the floor; anything an operator changed in /settings
    // overrides it. One query, before any job reads a value.
    await applyStoredSettings(db);
    return await fn(db);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    await closeWorkerDb();
    clearBudget();
  }
}

/**
 * Is a long-running scheduler already doing this work?
 *
 * src/run/scheduler.ts collects, processes, rolls up and prunes on its own
 * timers, and it takes each job with a claim in `job_runs` so that two copies of
 * IT divide the work rather than duplicating it. This Worker predates that and
 * does not take claims, so a deployment with both running would poll every feed
 * twice -- politely by its own lights, and twice as often as any source agreed
 * to.
 *
 * Rather than remove the Worker, which is still the cheapest way to collect
 * without a container, it defers. A scheduler that has finished a job in the
 * last ten minutes is alive; anything longer and this takes over, which also
 * makes the Worker a usable fallback if the container is down.
 */
async function schedulerIsRunning(db: Db): Promise<boolean> {
  try {
    const [row] = await db.query<{ live: boolean }>(
      `SELECT bool_or(last_finished_at > now() - interval '10 minutes') AS live
         FROM job_runs`);
    return row?.live === true;
  } catch {
    // No job_runs table means no scheduler has ever started here.
    return false;
  }
}

async function dispatch(cron: string, db: Db, env: Env): Promise<unknown> {
  if ((cron === '*/5 * * * *' || cron === 'tick' || cron === '*/20 * * * *'
    || cron === 'process') && await schedulerIsRunning(db)) {
    return { skipped: 'a long-running scheduler is active against this database' };
  }

  switch (cron) {
    case '*/5 * * * *':
    case 'tick':
      return tick(db, env);

    case '*/20 * * * *':
    case 'process':
      return runProcessing(db, env);

    case '0 3 1 * *':
    case 'maintenance': {
      // Months back follows COLLECTION, not the retention window; see the same
      // call in run/jobs.ts and the note on partitionMonthsBack.
      await db.query('SELECT ensure_partitions($1, 3)',
                     [partitionMonthsBack(getConfig().retention.keepMonths)]);
      const tuned = await tuneIntervals(db);
      return { ok: true, tuned };
    }

    default:
      return { error: `unknown trigger: ${cron}` };
  }
}

/**
 * One collection tick: poll what is due, then capture snapshots that have come
 * due. Concurrency is what makes this fit inside a Worker invocation --
 * collection is network-bound, and sequential polling spent 88% of its wall
 * clock waiting on HTTP.
 */
async function tick(db: Db, env: Env): Promise<unknown> {
  const cycle = await runCycle(db, {
    // Sized by the subrequest allowance, not by ambition: on the free plan the
    // cycle can afford roughly a dozen feeds per tick. It takes what it can and
    // leaves the rest due, so nothing is skipped -- only deferred.
    // Sized against the Workers FREE plan, where CPU -- not subrequests -- is
    // the binding constraint. Measured: 10 sources x 20 items ran in 6.6s wall
    // and ~200ms CPU, but occasionally tripped the allowance when a large or
    // CJK-heavy feed came up. Eight and twelve leaves headroom for the outliers.
    // A failed tick costs nothing: next_fetch_at never advanced, so the work is
    // simply taken by the next one.
    limit: 8,
    concurrency: 4,
    maxItemsPerSource: 12,
    // Article fetches are the single biggest subrequest consumer. The Worker
    // collects feed content only; the long-running collector does the fetching.
    fetchArticles: false,
    // Comfortably inside an invocation. Past it, the remaining sources stay due:
    // next_fetch_at was never advanced, so the next tick takes them first.
    deadlineMs: 60_000,
    userAgent: env.USER_AGENT,
  });

  // Time-critical: a +1h curve point captured at +3h is a different number and
  // cannot be corrected later.
  const snapshots = await captureDueSnapshots(db, 300);
  return { cycle, snapshots, subrequests: budgetState() };
}

async function runProcessing(db: Db, env: Env): Promise<unknown> {
  if (env.COLLECT_ONLY === '1') {
    return { skipped: 'COLLECT_ONLY is set (Phase 1 observation week)' };
  }

  const ctx: LlmContext = { db, env };

  // Order matters: dedup before classification so a merged story is classified
  // once, and classification before scoring because scoring reads is_tech.
  const dedup = await dedupRecent(ctx);
  const classify = await classifyPending(ctx, 100);
  const score = await scoreUnscored(ctx, 100);
  // Free: alias matching against the closed company vocabulary, no model call.
  const companies = await tagCompanies(db, 300);

  // Also free, and the reason the vocabulary is not a fixed list. Discovery
  // proposes entries from release URLs; tagging applies the vocabulary -- old
  // entries and new ones alike -- to whatever has not been examined yet. Both
  // are plain string work, so neither is behind the classification gate.
  const discovered = await discoverStacks(db, { days: 14 });
  const stacks = await tagStacks(db, 300);
  const platforms = await tagPlatforms(db, 300);

  // Rarity is read on every niche query and only changes when tagging does.
  await db.query('SELECT refresh_stack_frequency()').catch(() => undefined);

  return { dedup, classify, score, companies, discovered, stacks, platforms };
}

/** Constant-time comparison, so the secret cannot be probed a character at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

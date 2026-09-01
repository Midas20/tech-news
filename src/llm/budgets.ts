import type { Db } from '../db/client.ts';
import type { RateLimitInfo } from './providers.ts';

// Every free-tier quota is discovered at runtime, never hardcoded (principle 7).
// This module owns the only place the system believes anything about a limit.

export interface BudgetRow {
  provider_id: string;
  quota_observed: number | null;
  remaining_observed: number | null;
  window_seconds: number;
  window_start: string;
  spent: number;
  health: string;
  retry_after: string | null;
}

export async function loadBudgets(db: Db): Promise<Map<string, BudgetRow>> {
  const rows = await db.query<BudgetRow>(
    `SELECT provider_id, quota_observed, remaining_observed, window_seconds,
            window_start::text, spent, health, retry_after::text
       FROM provider_budgets WHERE bucket = 'requests'`,
  );
  return new Map(rows.map((r) => [r.provider_id, r]));
}

/**
 * A 429 marks a provider unhealthy FOR THE REST OF ITS WINDOW -- not forever.
 *
 * The window is the authority here, not the health flag. Reading the flag alone
 * was a real bug: the first rate limit of the day retired the provider
 * permanently, the chain drained one provider at a time, and every batch after
 * that deferred with "budget exhausted" while all three services sat idle and
 * healthy.
 */
export function isUsable(row: BudgetRow | undefined, now = new Date()): boolean {
  if (!row) return true; // never seen: try it, and learn from the response

  // Inside an explicit cooldown the provider itself asked for.
  if (row.retry_after && new Date(row.retry_after) > now) return false;

  // A depleted request allowance only counts while its window is still open.
  const windowEnds = new Date(new Date(row.window_start).getTime() + row.window_seconds * 1000);
  if (row.remaining_observed !== null && row.remaining_observed <= 0 && windowEnds > now) return false;

  // Cooldown elapsed: probe it again. If it is still limited, the next response
  // says so and sets a fresh window.
  return true;
}

/** Record what the provider just told us about itself. */
export async function recordUsage(db: Db, providerId: string, rl: RateLimitInfo): Promise<void> {
  await db.query(
    `INSERT INTO provider_budgets (provider_id, bucket, quota_observed, remaining_observed,
                                   window_seconds, spent, health, updated_at)
     VALUES ($1, 'requests', $2, $3, coalesce($4, 60), 1, 'healthy', now())
     ON CONFLICT (provider_id, bucket) DO UPDATE SET
       quota_observed     = coalesce(EXCLUDED.quota_observed, provider_budgets.quota_observed),
       remaining_observed = EXCLUDED.remaining_observed,
       window_seconds     = coalesce(EXCLUDED.window_seconds, provider_budgets.window_seconds),
       spent = CASE
         WHEN provider_budgets.window_start + make_interval(secs => provider_budgets.window_seconds) < now()
           THEN 1
         ELSE provider_budgets.spent + 1
       END,
       window_start = CASE
         WHEN provider_budgets.window_start + make_interval(secs => provider_budgets.window_seconds) < now()
           THEN now()
         ELSE provider_budgets.window_start
       END,
       health = CASE
         WHEN EXCLUDED.remaining_observed IS NOT NULL AND EXCLUDED.remaining_observed <= 0
           THEN 'exhausted'::provider_health
         ELSE 'healthy'::provider_health
       END,
       retry_after = NULL,
       updated_at = now()`,
    [providerId, rl.limitRequests, rl.remainingRequests, rl.resetSeconds ? Math.ceil(rl.resetSeconds) : null],
  );
}

/**
 * A 429 marks the provider unhealthy for the rest of its window and the call
 * moves down the chain. Nothing blocks and nothing is lost: the row simply
 * retries next cycle.
 */
export async function recordRateLimit(
  db: Db,
  providerId: string,
  retryAfterSeconds: number | null,
): Promise<void> {
  await db.query(
    `INSERT INTO provider_budgets (provider_id, bucket, health, last_429_at, retry_after,
                                   window_seconds, updated_at)
     VALUES ($1, 'requests', 'throttled', now(), now() + make_interval(secs => $2), $2, now())
     ON CONFLICT (provider_id, bucket) DO UPDATE SET
       health = 'exhausted',
       last_429_at = now(),
       retry_after = now() + make_interval(secs => $2),
       updated_at = now()`,
    [providerId, retryAfterSeconds ?? 60],
  );
}

export async function recordFailure(db: Db, providerId: string, seconds = 120): Promise<void> {
  await db.query(
    `INSERT INTO provider_budgets (provider_id, bucket, health, retry_after, updated_at)
     VALUES ($1, 'requests', 'down', now() + make_interval(secs => $2), now())
     ON CONFLICT (provider_id, bucket) DO UPDATE SET
       health = 'down', retry_after = now() + make_interval(secs => $2), updated_at = now()`,
    [providerId, seconds],
  );
}

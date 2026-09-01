import type { Db } from '../client.ts';

export interface JobRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * dedup_key makes enqueueing idempotent, which is what lets the poller re-run a
 * cycle after a crash without duplicating downstream work. Backfill is enqueued
 * at priority 9 so it can never compete with live collection for quota.
 */
export async function enqueue(
  db: Db,
  type: string,
  payload: Record<string, unknown>,
  opts: { dedupKey?: string; priority?: number; runAfter?: Date } = {},
): Promise<void> {
  await db.query(
    `INSERT INTO jobs (type, payload, dedup_key, priority, run_after)
     VALUES ($1, $2::jsonb, $3, $4, coalesce($5, now()))
     ON CONFLICT (type, dedup_key) WHERE dedup_key IS NOT NULL AND status IN ('pending','leased')
     DO NOTHING`,
    [type, JSON.stringify(payload), opts.dedupKey ?? null, opts.priority ?? 5, opts.runAfter ?? null],
  );
}

export async function lease(db: Db, types: string[], limit: number, leaseSeconds = 300): Promise<JobRow[]> {
  return db.query<JobRow>(`SELECT id::text, type, payload, attempts FROM lease_jobs($1::text[], $2, $3)`, [
    types, limit, leaseSeconds,
  ]);
}

export async function complete(db: Db, jobId: string): Promise<void> {
  await db.query(`UPDATE jobs SET status = 'done', finished_at = now() WHERE id = $1::bigint`, [jobId]);
}

/**
 * Nothing blocks. A job that cannot run right now -- an exhausted provider, a
 * source under backoff -- is deferred with a run_after, and simply retries next
 * cycle. Failure only becomes terminal at max_attempts.
 */
export async function defer(db: Db, jobId: string, seconds: number, reason: string): Promise<void> {
  await db.query(
    `UPDATE jobs SET status = 'deferred', run_after = now() + make_interval(secs => $2),
            last_error = $3, attempts = GREATEST(attempts - 1, 0)
      WHERE id = $1::bigint`,
    [jobId, seconds, reason.slice(0, 500)],
  );
}

export async function fail(db: Db, jobId: string, error: string): Promise<void> {
  await db.query(
    `UPDATE jobs SET
       status = CASE WHEN attempts >= max_attempts THEN 'failed'::job_status ELSE 'pending'::job_status END,
       last_error = $2,
       run_after = now() + make_interval(secs => LEAST(60 * power(2, attempts)::int, 3600)),
       finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END
     WHERE id = $1::bigint`,
    [jobId, error.slice(0, 500)],
  );
}

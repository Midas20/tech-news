// Database access. Two shapes, deliberately.
//
//   sql()        one-shot HTTP queries. Fine for every global table: sources,
//                stories, jobs. No session state, no connection to hold open,
//                which is exactly what a Worker invocation wants.
//
//   withTenant() a pooled session that sets app.tenant_id inside a transaction.
//                RLS reads that setting, so anything tenant-scoped MUST go
//                through here. There is no application-level WHERE tenant_id.

import { neonConfig } from '@neondatabase/serverless';
import { countSubrequest } from '../lib/subrequests.ts';
import { makePool, makeQuerier, isNeon, type AnyPool } from './driver.ts';

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Round-trip accounting. Over an HTTP driver each query is a full request, so
 * "how many queries did that take" is the dominant cost of the collector -- more
 * so than any CPU work in the pipeline. Cheap to keep, and it is the only way to
 * see a per-item query creeping back in.
 */
export const dbStats = { queries: 0, totalMs: 0 };

export function resetDbStats(): void {
  dbStats.queries = 0;
  dbStats.totalMs = 0;
}

export function createDb(connectionString: string): Db {
  // Neon's HTTP driver where the host is Neon's, a pooled `pg` where it is a
  // real Postgres server. See ./driver.ts -- the connection string decides.
  const sql = makeQuerier(connectionString);
  const metered = isNeon(connectionString);
  return {
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const started = Date.now();
      // Over the HTTP driver every query is its own subrequest. A local
      // Postgres has no such allowance to spend.
      if (metered) countSubrequest();
      try {
        const rows = await sql(text, params as unknown[]);
        return rows as T[];
      } finally {
        dbStats.queries++;
        dbStats.totalMs += Date.now() - started;
      }
    },
  };
}

/**
 * The Worker's database client: one WebSocket session for the whole invocation.
 *
 * The HTTP driver spends a subrequest per query, and a Worker gets 50 on the
 * free plan -- a single collection tick exhausted them and was killed. A pooled
 * WebSocket connection costs one subrequest total, which leaves the allowance
 * for what actually has to go out over the network: the feeds.
 *
 * The caller must close it (ctx.waitUntil(closeWorkerDb())) or the invocation
 * hangs until the runtime reaps it.
 */
let workerPool: AnyPool | null = null;

export function createWorkerDb(connectionString: string): Db {
  if (!workerPool) {
    neonConfig.poolQueryViaFetch = false;
    workerPool = makePool(connectionString, { max: 1 });
    if (isNeon(connectionString)) countSubrequest(); // the connection itself
  }
  const pool = workerPool;
  return {
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const started = Date.now();
      try {
        const res = await pool.query(text, params);
        return res.rows as T[];
      } finally {
        dbStats.queries++;
        dbStats.totalMs += Date.now() - started;
      }
    },
  };
}

export async function closeWorkerDb(): Promise<void> {
  if (workerPool) {
    await workerPool.end().catch(() => {});
    workerPool = null;
  }
}

/**
 * A long-running process's database client: one pool, held open.
 *
 * createDb() above is the HTTP driver: one HTTPS request per query. The obvious
 * guess is that a held pool is dramatically faster, and it is not -- measured
 * against this database, 40 sequential queries took 1.19s over the HTTP driver
 * and 1.06s pooled, about 30ms each either way. Neon keeps the HTTP connection
 * alive, so what is saved is roughly 10%, not a handshake per query.
 *
 * The reason to use it anyway is not that number. It is that the HTTP driver
 * counts every query against the Workers subrequest allowance (countSubrequest,
 * above), which is a budget a long-running process neither has nor should be
 * spending, and that a pool surfaces connection loss as an 'error' event this
 * can handle rather than as a failed query with no context.
 *
 * The 'error' listener is not optional. A pooled connection emits it when the
 * database drops one -- a failover, an idle timeout, a rotated password -- and
 * Node treats an unhandled 'error' event as fatal. Without it a transient blip
 * takes down the process; with it, the query in flight fails and the process
 * lives.
 */
export interface PooledDb extends Db {
  close(): Promise<void>;
}

export function createPoolDb(connectionString: string, label = 'db'): PooledDb {
  const p = makePool(connectionString);
  p.on('error', (err: Error) => {
    console.error(`[db:${label}] pool error: ${err.message}`);
  });
  return {
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const started = Date.now();
      try {
        const res = await p.query(text, params);
        return res.rows as T[];
      } finally {
        dbStats.queries++;
        dbStats.totalMs += Date.now() - started;
      }
    },
    async close(): Promise<void> {
      await p.end().catch(() => undefined);
    },
  };
}

// withTenant() checks a session OUT rather than using a pooled query:
// set_config and the SELECT relying on it must land on the same connection, or
// RLS reads a setting that was never applied.
let pool: AnyPool | null = null;

function getPool(connectionString: string): AnyPool {
  if (!pool) pool = makePool(connectionString);
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Run fn with app.tenant_id bound for the duration of one transaction.
 *
 * set_config(..., true) is transaction-local: the setting cannot leak to the next
 * user of a pooled connection, which is the failure mode that makes connection
 * pooling and RLS a dangerous combination when done by hand.
 */
export async function withTenant<T>(
  connectionString: string,
  tenantId: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const client = await getPool(connectionString).connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const db: Db = {
      async query<R>(text: string, params: unknown[] = []): Promise<R[]> {
        const res = await client.query(text, params);
        return res.rows as R[];
      },
    };
    const out = await fn(db);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction without a tenant context, for global-table work. */
export async function withTransaction<T>(
  connectionString: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const client = await getPool(connectionString).connect();
  try {
    await client.query('BEGIN');
    const db: Db = {
      async query<R>(text: string, params: unknown[] = []): Promise<R[]> {
        const res = await client.query(text, params);
        return res.rows as R[];
      },
    };
    const out = await fn(db);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres bytea parameters arrive as Buffer/Uint8Array; normalize on the way in. */
export function bytea(bytes: Uint8Array): Uint8Array {
  return bytes;
}

export function one<T>(rows: T[]): T | null {
  return rows.length > 0 ? rows[0]! : null;
}

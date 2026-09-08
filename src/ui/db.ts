// Shared database access for the web UI.
//
// The UI connects with DATABASE_APP_URL when one exists -- the NOBYPASSRLS role.
// Global tables (stories, sources, stacks) carry no tenant column and are
// readable by it; anything tenant-scoped would need a tenant context, which the
// reader deliberately does not have.
//
// The admin views are the exception and say so on the page: they use the owner
// connection because seeing every tenant is the whole point of an admin surface.

import { makePool, type AnyPool } from '../db/driver.ts';

/**
 * A pooled connection emits 'error' when the database drops it -- a failover, an
 * idle timeout, a rotated password. Node treats an unhandled 'error' event as
 * fatal, so without this listener a transient database blip takes the whole web
 * server down. The request that hits it still fails; the process survives.
 */
function guard(pool: AnyPool, label: string): AnyPool {
  pool.on('error', (err: Error) => {
    console.error(`[db:${label}] pool error: ${err.message}`);
  });
  return pool;
}

let readerPool: AnyPool | null = null;
let ownerPool: AnyPool | null = null;

function must(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function readerUrl(): string {
  return must(
    'DATABASE_APP_URL / DATABASE_URL',
    process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL,
  );
}

export function ownerUrl(): string {
  return must(
    'DATABASE_DIRECT_URL / DATABASE_URL',
    process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL,
  );
}

/**
 * ONE QUERY, NOT A CHECKED-OUT SESSION.
 *
 * This used to be `connect()`, `query()`, `release()`, which is the right shape
 * for a long-lived Node process and the wrong one everywhere else. Neon's
 * `connect()` opens a WebSocket session; the pool holding it is a module
 * global, so in a Worker it is cached across invocations and the runtime does
 * not keep sockets alive between them. Deployed, that failed on a count:
 * `/stacks` answered 200, 200, 200, 500, 500, 500.
 *
 * `pool.query()` needs no session. In a Worker, with
 * `neonConfig.poolQueryViaFetch`, it is a stateless HTTP round trip that cannot
 * go stale; in Node it behaves exactly as before, since the pool checks a
 * connection out and back internally. Nothing here has ever run a transaction
 * -- every caller is a single SELECT -- so nothing needed the session in the
 * first place.
 */
export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!readerPool) readerPool = guard(makePool(readerUrl()), 'reader');
  return (await readerPool.query(sql, params)).rows as T[];
}

export async function qOwner<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!ownerPool) ownerPool = guard(makePool(ownerUrl()), 'owner');
  return (await ownerPool.query(sql, params)).rows as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

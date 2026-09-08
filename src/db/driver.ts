// Which Postgres driver, decided once, from the connection string.
//
// Asked for on 2026-09-08: "I want the site work forever". It could not, on the
// arrangement it had. Every connection went through @neondatabase/serverless,
// which does not speak to a Postgres server -- it speaks to Neon's proxy, over
// HTTP or a WebSocket. That is the right driver in a Cloudflare Worker, where
// there are no TCP sockets, and it is the only driver this project had. So the
// archive could only ever live on a metered hosted service, and on 2026-09-05
// the meter ran out and took the site with it.
//
// A database on this machine has no meter. What stood between here and there
// was one import, so this module is that import: `pg` for a real Postgres
// server, Neon's driver for a Neon host, chosen by looking at the hostname.
//
// WHY DETECT RATHER THAN CONFIGURE. A flag is a thing to get wrong -- set it
// while pointing at Neon and every query fails with a socket error nobody
// expects. The connection string already says where it goes, and `.neon.tech`
// is the only case where the specialised driver is required rather than merely
// possible. Nothing has to be told anything, and moving between the two is a
// change of URL.
//
// The two are API-compatible where this project touches them: `pool.query(text,
// params)` resolving to `{ rows }`, an 'error' event, and `end()`. Neon's Pool
// is deliberately modelled on node-postgres, which is what makes this a choice
// of constructor rather than a rewrite.

import { Pool as NeonPool, neonConfig, neon } from '@neondatabase/serverless';
import pg from 'pg';

/**
 * True for a host only Neon's driver can reach.
 *
 * Anything else -- localhost, a container, a managed Postgres elsewhere -- is a
 * real server that speaks the wire protocol, and `pg` talks to it directly.
 * A string that will not parse is treated as not-Neon: `pg` gives a clear error
 * for a malformed URL, and the Neon driver gives a confusing one.
 */
export function isNeon(connectionString: string): boolean {
  try {
    return new URL(connectionString).hostname.endsWith('.neon.tech');
  } catch {
    return false;
  }
}

/**
 * The slice of a pool this project uses. Both drivers satisfy it.
 *
 * Shaped after node-postgres rather than after anything narrower, because
 * callers already depend on the details: `rowCount` for how many rows an UPDATE
 * touched, and `connect()` for the one place that genuinely needs a session --
 * withTenant(), where a `set_config` and the SELECT relying on it must land on
 * the same connection or RLS reads a setting that was never applied.
 */
export interface PoolClient {
  query<T = any>(
    text: string, params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  release(): void;
}

export interface AnyPool {
  query<T = any>(
    text: string, params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  connect(): Promise<PoolClient>;
  on(event: 'error', handler: (err: Error) => void): unknown;
  end(): Promise<void>;
}

export interface PoolOptions {
  /** Maximum connections. One, for a Worker invocation. */
  max?: number;
}

/**
 * A connection pool for wherever this string points.
 *
 * Neon needs telling that a WebSocket exists before it will open one, because
 * Node did not have a global `WebSocket` until recently and the driver will not
 * assume. `poolQueryViaFetch` stays false so a pooled query is a real session
 * rather than an HTTP round trip -- the Worker path sets it differently and
 * says why there.
 */
export function makePool(connectionString: string, opts: PoolOptions = {}): AnyPool {
  if (isNeon(connectionString)) {
    if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket;
    return new NeonPool({ connectionString, ...opts }) as unknown as AnyPool;
  }
  return new pg.Pool({ connectionString, ...opts }) as unknown as AnyPool;
}

/**
 * One-shot queries, for callers that hold no pool.
 *
 * Neon's HTTP driver is a function returning rows; `pg` has no equivalent, so a
 * pool stands in. The pool is cached per connection string rather than created
 * per call -- a pool per query would open and close a TCP connection every time,
 * which is slower than the HTTP driver it replaces rather than faster.
 */
const oneShot = new Map<string, AnyPool>();

export function makeQuerier(
  connectionString: string,
): (text: string, params: unknown[]) => Promise<unknown[]> {
  if (isNeon(connectionString)) {
    const sql = neon(connectionString);
    return async (text, params) => (await sql(text, params)) as unknown[];
  }
  let pool = oneShot.get(connectionString);
  if (!pool) {
    pool = makePool(connectionString);
    // Same reason as everywhere else here: Node treats an unhandled 'error'
    // event on a pool as fatal, so a dropped connection would end the process
    // rather than the query.
    pool.on('error', (err) => console.error(`[db:oneshot] pool error: ${err.message}`));
    oneShot.set(connectionString, pool);
  }
  return async (text, params) => (await pool!.query(text, params)).rows;
}

/** Release anything `makeQuerier` is holding. For tests and clean shutdown. */
export async function closeQueriers(): Promise<void> {
  for (const pool of oneShot.values()) await pool.end().catch(() => undefined);
  oneShot.clear();
}

/** Where a connection string points, for a log line that is worth reading. */
export function describeTarget(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    return `${isNeon(connectionString) ? 'neon' : 'postgres'} ${u.hostname}${
      u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return 'an unparseable connection string';
  }
}

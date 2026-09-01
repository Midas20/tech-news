// Check every address the registry offers as "go here".
//
//   npm run links                  check anything never checked
//   npm run links -- --recheck 30  re-check anything older than 30 days
//   npm run links -- --report      what the last crawl found, no fetching
//
// The registry's value, once it stops being a list of names, is the URL. That
// column has never been verified, and it does not survive contact: `argocd`
// records its homepage as argo.ucsd.edu, a physics group at UC San Diego. It
// was derived from a URL pattern, it looks entirely plausible, and it is wrong.
//
// HEAD first, GET on fallback. Plenty of servers answer HEAD with 405 or lie
// about it, so a non-2xx HEAD is retried as a GET before being believed --
// otherwise the crawl reports a working site as broken because it dislikes the
// method. The body is discarded either way; nothing here reads content.
//
// Politeness is per host and it dominates the runtime, not the network: over a
// thousand of these are github.com repository pages, which is one host and
// therefore a queue. That is the correct trade -- a verification pass is not
// worth being rude for -- and it is why this runs for half an hour rather than
// half a minute.

import { createDb, closePool } from '../src/db/client.ts';
import { configureFromEnv, getConfig } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { PolitenessGate } from '../src/collect/fetcher.ts';
import { mapWithConcurrency } from '../src/lib/pool.ts';
import { domainOf } from '../src/lib/url.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const recheckDays = Number(arg('recheck') ?? 0);
const concurrency = Number(arg('concurrency') ?? 8);
const timeoutMs = Number(arg('timeout') ?? 15000);
const politenessMs = Number(arg('politeness') ?? 1200);

// --- reporting ---------------------------------------------------------------

if (process.argv.includes('--report')) {
  const by = await db.query<Record<string, string>>(
    `SELECT state, count(*)::text AS n FROM link_health GROUP BY 1 ORDER BY 2 DESC`);
  console.log('state         links');
  for (const r of by) console.log(`${r.state!.padEnd(14)}${r.n!.padStart(6)}`);

  const moved = await db.query<Record<string, string>>(
    `SELECT url, final_url FROM link_health WHERE moved AND state = 'ok' LIMIT 15`);
  if (moved.length) {
    console.log('\nredirected to a different host (worth a look):');
    for (const m of moved) console.log(`  ${m.url}\n    -> ${m.final_url}`);
  }

  const dead = await db.query<Record<string, string>>(
    `SELECT h.state, h.url, coalesce(s.name, p.name) AS owner
       FROM link_health h
       LEFT JOIN stacks s ON s.homepage_url = h.url OR s.repo_url = h.url
       LEFT JOIN platforms p ON p.url = h.url
      WHERE h.state <> 'ok' ORDER BY h.state, h.url LIMIT 25`);
  if (dead.length) {
    console.log('\nnot answering properly:');
    for (const d of dead) console.log(`  ${d.state!.padEnd(12)} ${d.owner ?? '?'} — ${d.url}`);
  }
  await closePool();
  process.exit(0);
}

// --- what to check -----------------------------------------------------------

/**
 * Every address the registry presents as somewhere to go.
 *
 * Deliberately not stack_resources: those already carry their own http_status
 * from `npm run resources`, checked at seeding time. What has never been looked
 * at is the registry's own columns and the platform list.
 */
const targets = await db.query<{ url: string }>(
  `SELECT DISTINCT u AS url FROM (
     SELECT homepage_url AS u FROM stacks WHERE homepage_url IS NOT NULL
     UNION ALL SELECT repo_url FROM stacks WHERE repo_url IS NOT NULL
     UNION ALL SELECT url FROM platforms WHERE url IS NOT NULL
   ) x
   WHERE u LIKE 'http%'
     AND NOT EXISTS (
       SELECT 1 FROM link_checks c
        WHERE c.url = x.u
          AND ($1::int = 0 OR c.checked_at > now() - make_interval(days => $1::int))
     )`,
  [recheckDays || 0]);

if (targets.length === 0) {
  console.log('nothing to check. `npm run links -- --recheck 30` to re-verify.');
  await closePool();
  process.exit(0);
}

const hosts = new Set(targets.map((t) => domainOf(t.url) ?? t.url));
console.log(`${targets.length.toLocaleString('en-US')} links across ${hosts.size} hosts`);
console.log(`  ${politenessMs}ms between hits on the same host, ${concurrency} in flight\n`);

// The worst host decides the runtime, so say which it is up front rather than
// letting the run look hung halfway through.
const perHost = new Map<string, number>();
for (const t of targets) {
  const h = domainOf(t.url) ?? t.url;
  perHost.set(h, (perHost.get(h) ?? 0) + 1);
}
const busiest = [...perHost.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
for (const [h, n] of busiest) {
  console.log(`  ${h}: ${n} links — about ${Math.round(n * politenessMs / 60000)} min on its own`);
}
console.log();

// --- check -------------------------------------------------------------------

const gate = new PolitenessGate(politenessMs);
const ua = getConfig().fetch.userAgent;

async function once(target: string, method: 'HEAD' | 'GET') {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      method,
      redirect: 'follow',
      signal: control.signal,
      headers: { 'user-agent': ua, accept: '*/*' },
    });
    // Drain a GET so the socket can be reused rather than left hanging.
    if (method === 'GET') await res.arrayBuffer().catch(() => undefined);
    return { status: res.status, finalUrl: res.url || target, error: null as string | null };
  } finally {
    clearTimeout(timer);
  }
}

let done = 0, ok = 0, bad = 0;

await mapWithConcurrency(targets, concurrency, async (t) => {
  const host = domainOf(t.url) ?? t.url;
  await gate.wait(host);

  const started = Date.now();
  let status: number | null = null;
  let finalUrl: string | null = null;
  let error: string | null = null;

  try {
    const head = await once(t.url, 'HEAD');
    status = head.status;
    finalUrl = head.finalUrl;
    // Not every server means it. A 405 or 403 to HEAD is frequently a method
    // policy rather than a statement about the page, so ask properly before
    // recording the link as broken.
    if (status >= 400) {
      await gate.wait(host);
      const get = await once(t.url, 'GET');
      status = get.status;
      finalUrl = get.finalUrl;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    error = message.slice(0, 200);
    // A timeout or DNS failure leaves status NULL, which link_health reads as
    // 'unreachable' -- a different thing from a 404 and shown differently.
  }

  await db.query(
    `INSERT INTO link_checks (url, status, final_url, error, duration_ms, checked_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (url) DO UPDATE
        SET status = excluded.status, final_url = excluded.final_url,
            error = excluded.error, duration_ms = excluded.duration_ms,
            checked_at = now()`,
    [t.url, status, finalUrl, error, Date.now() - started]);

  done++;
  if (status !== null && status >= 200 && status < 300) ok++; else bad++;
  if (done % 50 === 0) {
    process.stdout.write(`   ${done}/${targets.length}  ${ok} ok  ${bad} not\n`);
  }
});

console.log(`\nchecked ${done.toLocaleString('en-US')}: ${ok} answered, ${bad} did not`);
console.log('`npm run links -- --report` for the breakdown.');

await closePool();

// Collection benchmark.
//
//   node --experimental-strip-types scripts/bench-collect.ts --sources 6
//
// Reports the two numbers that actually govern throughput:
//
//   queries per item   -- deterministic, and the dominant cost over an HTTP
//                         database driver where every query is a round trip
//   items per second   -- wall clock, noisy, dependent on which feeds are picked
//
// It polls sources that have never been fetched, so it measures the real
// insert path rather than the cheap already-seen path.

import { createDb, dbStats, resetDbStats } from '../src/db/client.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { collectSource, type CollectOptions } from '../src/collect/pipeline.ts';
import { PolitenessGate } from '../src/collect/fetcher.ts';
import type { SourceRow } from '../src/db/repos/sources.ts';

await loadDotEnv();
const config = configureFromEnv(process.env as Record<string, string | undefined>);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const count = Number(arg('sources', '6'));
const concurrency = Number(arg('concurrency', '1'));

const db = createDb(process.env.DATABASE_URL!);

// Never-fetched sources only: this is the path that inserts.
const sources = await db.query<SourceRow>(
  `SELECT id, name, url, feed_url, feed_kind, roles, lang, country, trust_weight,
          weight_content, never_canonical, fields, poll_interval_seconds,
          politeness_seconds, requires_secret, last_etag, last_modified,
          consecutive_failures, health
     FROM sources
    WHERE last_fetch_at IS NULL
      AND feed_kind <> 'api'
      AND health = 'healthy'
    ORDER BY random()
    LIMIT $1`,
  [count],
);

console.log(`benchmark: ${sources.length} never-fetched sources, concurrency ${concurrency}\n`);

const opts: CollectOptions = {
  userAgent: config.fetch.userAgent,
  politeness: new PolitenessGate(config.fetch.politenessMs),
  collectionMode: 'live',
};

resetDbStats();
const started = Date.now();

let seen = 0;
let kept = 0;
let dupes = 0;

async function run(source: SourceRow): Promise<void> {
  const t0 = Date.now();
  const q0 = dbStats.queries;
  try {
    const summary = await collectSource(db, source, opts);
    seen += summary.itemsSeen;
    kept += summary.itemsKept;
    dupes += summary.duplicates;
    console.log(
      `${source.name.slice(0, 30).padEnd(32)} ` +
      `${String(summary.itemsSeen).padStart(4)} seen ` +
      `${String(summary.itemsKept).padStart(4)} kept ` +
      `${String(dbStats.queries - q0).padStart(5)} queries ` +
      `${String(Date.now() - t0).padStart(6)} ms ${summary.error ?? ''}`,
    );
  } catch (err) {
    console.log(`${source.name.slice(0, 30).padEnd(32)} ERROR ${err instanceof Error ? err.message : err}`);
  }
}

// Simple bounded fan-out so the benchmark can measure either mode.
const queue = [...sources];
await Promise.all(
  Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await run(next);
    }
  }),
);

const elapsed = (Date.now() - started) / 1000;
const stored = kept + dupes;

console.log('\n--- results');
console.log(`wall clock         ${elapsed.toFixed(1)} s`);
console.log(`items seen         ${seen}`);
console.log(`items stored       ${kept} new + ${dupes} duplicate`);
console.log(`db queries         ${dbStats.queries}`);
console.log(`db time            ${(dbStats.totalMs / 1000).toFixed(1)} s (${((dbStats.totalMs / 10) / elapsed).toFixed(0)}% of wall clock)`);
console.log(`queries per item   ${stored > 0 ? (dbStats.queries / stored).toFixed(2) : 'n/a'}`);
console.log(`items per second   ${(stored / elapsed).toFixed(2)}`);
console.log(`mean query latency ${dbStats.queries ? (dbStats.totalMs / dbStats.queries).toFixed(0) : 0} ms`);

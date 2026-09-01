// Run one poll cycle locally, against a real database or against nothing.
//
//   node --experimental-strip-types scripts/dev-poll.ts --shard 0
//   node --experimental-strip-types scripts/dev-poll.ts --url https://lwn.net/headlines/rss
//
// The --url form needs no database at all: it fetches, parses, gates and prints
// what WOULD be stored. That is the fastest way to find out why a source is
// producing nothing, and it is the tool to reach for during the Phase 1
// observation week.

import { createDb } from '../src/db/client.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { dueSources } from '../src/db/repos/sources.ts';
import { collectSource } from '../src/collect/pipeline.ts';
import { fetchConditional, PolitenessGate } from '../src/collect/fetcher.ts';
import { parseFeed } from '../src/collect/feed.ts';
import { gateItem, isPodcastFeed } from '../src/collect/filters.ts';
import { detectLanguage } from '../src/lib/lang.ts';
import { checkLength } from '../src/lib/text.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function inspectUrl(url: string): Promise<void> {
  const res = await fetchConditional(url, { userAgent: process.env.USER_AGENT });
  if (res.kind !== 'ok') {
    console.log(`fetch failed: ${JSON.stringify(res)}`);
    return;
  }
  console.log(`fetched ${res.bytes} bytes in ${res.durationMs}ms (etag: ${res.etag ?? 'none'})`);

  const feed = parseFeed(res.body, url);
  if (!feed) {
    console.log('could not parse as RSS, Atom or JSON Feed');
    console.log(res.body.slice(0, 400));
    return;
  }

  console.log(`format: ${feed.format}, title: ${feed.title ?? '(none)'}, items: ${feed.items.length}`);
  if (isPodcastFeed(feed.items)) console.log('WARNING: looks like a podcast feed; would be paused');

  let kept = 0;
  const drops: Record<string, number> = {};

  for (const item of feed.items) {
    const body = item.content || item.summary;
    const gate = gateItem(item, body);
    const lang = detectLanguage(`${item.title} ${body}`);
    const len = checkLength(body);

    if (gate.keep) kept++;
    else drops[gate.reason!] = (drops[gate.reason!] ?? 0) + 1;

    console.log(
      `${gate.keep ? 'KEEP' : 'DROP'} ${(gate.reason ?? '').padEnd(16)} ` +
      `${lang.lang}/${lang.confidence.toFixed(2)} ${String(len.length).padStart(5)}c` +
      `(min ${len.threshold}) ${item.title.slice(0, 70)}`,
    );
  }

  console.log(`\nkept ${kept}/${feed.items.length}; drops: ${JSON.stringify(drops)}`);
  console.log('note: a real poll would fetch the article page for items that are only too_short here');
}

async function pollShard(shard: number): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Use --url to inspect a single feed without a database.');
    process.exit(1);
  }
  const db = createDb(url);
  const sources = await dueSources(db, shard, Number(arg('limit') ?? 20));
  console.log(`shard ${shard}: ${sources.length} sources due`);

  const politeness = new PolitenessGate();
  for (const source of sources) {
    try {
      const summary = await collectSource(db, source, {
        userAgent: process.env.USER_AGENT,
        politeness,
        collectionMode: 'live',
      });
      console.log(
        `${source.name.padEnd(34)} seen ${String(summary.itemsSeen).padStart(3)} ` +
        `kept ${String(summary.itemsKept).padStart(3)} dup ${String(summary.duplicates).padStart(3)} ` +
        `${summary.error ?? ''}`,
      );
    } catch (err) {
      console.log(`${source.name.padEnd(34)} ERROR ${err instanceof Error ? err.message : err}`);
    }
  }
}

const single = arg('url');
await (single ? inspectUrl(single) : pollShard(Number(arg('shard') ?? 0)));

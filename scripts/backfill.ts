// The backward collector.
//
//   npm run backfill -- --provider hn --pages 10
//   npm run backfill -- --provider hn --until 2024-01-01
//   npm run backfill -- --provider github_releases --repo kubernetes/kubernetes
//   npm run backfill -- --provider github_releases --all --pages 3
//   npm run backfill -- --provider arxiv --category cs.AI --pages 5
//   npm run backfill -- --status
//
// Deliberately a separate command from `live`. Backfill is a bounded walk that
// competes for the same quota as live collection, so it is something you START,
// not something that happens to you: it never runs inside a poll cycle and never
// on the Worker's schedule.

import { createDb, dbStats, resetDbStats } from '../src/db/client.ts';
import { applyStoredSettings } from '../src/db/repos/settings.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { backfill, backfillTargets, type Provider } from '../src/collect/backfill.ts';
import { PolitenessGate } from '../src/collect/fetcher.ts';
import type { SourceRow } from '../src/db/repos/sources.ts';

await loadDotEnv();
const config = configureFromEnv(process.env as Record<string, string | undefined>);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const db = createDb(url);
// Settings saved in the UI override the environment; this is where they land.
await applyStoredSettings(db);

if (flag('status')) {
  const rows = await backfillTargets(db, arg('provider'));
  if (rows.length === 0) {
    console.log('no backfill has been started yet.');
  } else {
    console.log('provider          target                             status      stored   reaches back to');
    for (const r of rows) {
      console.log(
        `${r.provider.padEnd(17)} ${r.target.slice(0, 34).padEnd(35)} ` +
        `${r.status.padEnd(11)} ${String(r.items_stored).padStart(6)}   ${r.oldest_seen?.slice(0, 10) ?? '—'}`,
      );
    }
  }
  process.exit(0);
}

const provider = (arg('provider') ?? 'hn') as Provider;
const pages = Number(arg('pages') ?? 10);
const untilRaw = arg('until');
const until = untilRaw ? new Date(untilRaw) : undefined;

// One gate for the whole run: politeness is per host across every provider.
const politeness = new PolitenessGate(config.fetch.politenessMs);

const SOURCE_COLUMNS = `id, name, url, feed_url, feed_kind, kind::text, roles, lang, country,
  trust_weight, weight_content, never_canonical, fields, poll_interval_seconds,
  politeness_seconds, requires_secret, last_etag, last_modified, consecutive_failures, health`;

async function sourceFor(name: string): Promise<SourceRow | null> {
  const rows = await db.query<SourceRow>(
    `SELECT ${SOURCE_COLUMNS} FROM sources WHERE name = $1 LIMIT 1`, [name]);
  return rows[0] ?? null;
}

/**
 * Match a repo to its seeded source by URL, not by a name derived from the repo
 * path: the registry names it after the STACK ("Kubernetes releases"), and
 * lower-casing the repo half of the path does not reproduce that.
 */
async function sourceForRepo(repo: string): Promise<SourceRow | null> {
  const rows = await db.query<SourceRow>(
    `SELECT ${SOURCE_COLUMNS} FROM sources WHERE lower(url) = lower($1) LIMIT 1`,
    [`https://github.com/${repo}`]);
  return rows[0] ?? null;
}

resetDbStats();
const started = Date.now();

if (provider === 'hn') {
  const source = await sourceFor('Hacker News');
  if (!source) {
    console.error('source "Hacker News" is not seeded.');
    process.exit(1);
  }
  console.log(`backfilling Hacker News${until ? ` back to ${until.toISOString().slice(0, 10)}` : ''}` +
    `, up to ${pages} pages of 100\n`);

  const report = await backfill(db, 'hn', '*', source, {
    maxPages: pages,
    ...(until ? { until } : {}),
    politeness,
    userAgent: config.fetch.userAgent,
    onPage: (p) => console.log(
      `  page ${String(p.page).padStart(3)}  ${String(p.seen).padStart(3)} items  ` +
      `${String(p.stored).padStart(5)} stored so far  reaching ${p.oldest?.slice(0, 10) ?? '—'}`),
  });
  summarize(report.status, report.pages, report.seen, report.stored, report.oldest, report.error);

} else if (provider === 'github_releases') {
  const repoArg = arg('repo');
  const targets = repoArg
    ? [{ name: null as string | null, repo: repoArg }]
    : (await db.query<{ name: string; url: string }>(
        `SELECT name, url FROM sources
          WHERE backfill_provider = 'github_releases'
            AND url LIKE 'https://github.com/%'
          ORDER BY name LIMIT $1`, [Number(arg('repos') ?? (flag('all') ? 40 : 5))]))
        .map((r) => ({ name: r.name, repo: r.url.replace('https://github.com/', '') }));

  console.log(`backfilling ${targets.length} GitHub release histories, ${pages} pages each\n`);
  let stored = 0;
  for (const t of targets) {
    const source = t.name ? await sourceFor(t.name) : await sourceForRepo(t.repo);
    if (!source) {
      console.log(`  ${t.repo.padEnd(40)} no seeded source, skipped`);
      continue;
    }
    // `--until` was accepted on the command line, documented at the top of this
    // file, and then only ever passed to the Hacker News walk. Asking for
    // release history back to a date and getting "as many pages as you said"
    // instead is a silent difference: with per_page=100 one page reaches years
    // back for a busy repository and a fortnight for a quiet one, so the same
    // command produced a different horizon per repo.
    const report = await backfill(db, 'github_releases', t.repo, source, {
      maxPages: pages, politeness, userAgent: config.fetch.userAgent,
      ...(until ? { until } : {}),
    });
    stored += report.stored;
    console.log(
      `  ${t.repo.slice(0, 38).padEnd(40)} ${String(report.stored).padStart(4)} stored  ` +
      `${report.status}${report.error ? ` (${report.error.slice(0, 60)})` : ''}`);
  }
  console.log(`\ntotal stored: ${stored}`);

} else if (provider === 'arxiv') {
  const category = arg('category') ?? 'cs.AI';
  const source = await sourceFor('arXiv cs');
  if (!source) {
    console.error('source "arXiv cs" is not seeded.');
    process.exit(1);
  }
  console.log(`backfilling arXiv ${category}, up to ${pages} pages of 100 (3s spacing)\n`);
  const report = await backfill(db, 'arxiv', category, source, {
    maxPages: pages,
    ...(until ? { until } : {}),
    politeness,
    userAgent: config.fetch.userAgent,
    onPage: (p) => console.log(
      `  page ${String(p.page).padStart(3)}  ${String(p.seen).padStart(3)} items  ` +
      `${String(p.stored).padStart(5)} stored so far  reaching ${p.oldest?.slice(0, 10) ?? '—'}`),
  });
  summarize(report.status, report.pages, report.seen, report.stored, report.oldest, report.error);

} else {
  console.error(`unknown provider "${provider}". Use hn, github_releases or arxiv.`);
  process.exit(1);
}

function summarize(
  status: string, pages: number, seen: number, stored: number,
  oldest: string | null, error?: string,
): void {
  const secs = (Date.now() - started) / 1000;
  console.log(`\n${status}  ·  ${pages} pages  ·  ${seen} seen  ·  ${stored} stored`);
  console.log(`history now reaches back to ${oldest?.slice(0, 10) ?? 'nothing yet'}`);
  console.log(`${secs.toFixed(1)}s, ${dbStats.queries} db queries`);
  if (error) console.log(`error: ${error}`);
  if (status === 'pending' || status === 'stopped') {
    console.log('run again to continue from the stored cursor.');
  }
}

process.exit(0);

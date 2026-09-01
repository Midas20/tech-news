// Audition candidate feeds against the rules already in force.
//
//   npm run audition                     every candidate in seeds/candidates.ts
//   npm run audition -- --url https://x  one site, by hand
//   npm run audition -- --show 3         print titles that survived
//
// The judging lives in src/collect/audition.ts, shared with the `sources` job
// that runs the same test unattended on domains the archive found by itself.
// One copy: two would drift, and the copy making decisions with nobody watching
// would be the one that drifted.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv, getConfig } from '../src/config.ts';
import { topicVocabulary } from '../src/collect/topical.ts';
import { auditionFeed, KEEP_BAR } from '../src/collect/audition.ts';
import { CANDIDATES, type SourceCandidate } from '../seeds/candidates.ts';
import { BREADTH } from '../seeds/breadth.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const dbUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!dbUrl) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(dbUrl);
const vocab = await topicVocabulary(db);

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const only = arg('url');
const show = Number(arg('show') ?? 0);
const userAgent = getConfig().fetch.userAgent;

// `--set breadth` auditions the list written against the portfolio gap;
// the default stays the AI candidates.
const set = arg('set') ?? '';
const list: SourceCandidate[] = only
  ? [{ name: only, site: only, primary: true, why: 'by hand' }]
  : set === 'breadth' ? BREADTH : CANDIDATES;

interface Row { c: SourceCandidate; r: Awaited<ReturnType<typeof auditionFeed>> }
const results: Row[] = [];
const LANES = 6;
let next = 0;
await Promise.all(Array.from({ length: LANES }, async () => {
  for (;;) {
    const i = next++;
    if (i >= list.length) return;
    const c = list[i]!;
    const r = await auditionFeed({
      site: c.site, primary: c.primary, vocab, userAgent, politenessMs: 700,
      allowArticles: process.argv.includes('--articles'),
    });
    results.push({ c, r });
    if (results.length % 10 === 0) console.error(`  ${results.length}/${list.length}`);
  }
}));

results.sort((a, b) => b.r.kept - a.r.kept || b.r.recent - a.r.recent);

console.log('\n kept/recent tech  offered  source                       · top refusal');
console.log(' ' + '-'.repeat(94));
for (const { c, r } of results) {
  if (!r.feed) { console.log(`     no feed          ${c.name.slice(0, 40)}`); continue; }
  const top = [...r.reasons.entries()].sort((a, b) => b[1] - a[1])[0];
  const tech = r.kept ? Math.round((r.technical / r.kept) * 100) : 0;
  console.log(` ${String(r.kept).padStart(4)}/${String(r.recent).padEnd(4)} ${String(tech).padStart(3)}% `
    + `${String(r.offered).padStart(6)}   ${c.name.slice(0, 26).padEnd(28)}`
    + `${top ? `${top[0]} ${top[1]}` : '-'}${r.undated ? ` (${r.undated} undated)` : ''}`);
  for (const t of r.keptTitles.slice(0, show)) console.log(`              · ${t.slice(0, 82)}`);
}

const admitted = results.filter((x) => x.r.kept >= KEEP_BAR);
const total = admitted.reduce((n, x) => n + x.r.kept, 0);
console.log(`\n${results.length} auditioned · ${results.filter((x) => !x.r.feed).length} with no feed `
  + `· ${admitted.length} clearing ${KEEP_BAR} kept in 90 days`);
console.log(`those would add ~${total} items per 90 days (~${(total / 90).toFixed(1)}/day) `
  + 'at the rate each was measured at');
console.log('\nFeeds found, for the ones worth adding:');
for (const { c, r } of admitted) console.log(`  ${c.name.padEnd(32)} ${r.feed}`);
await closePool();

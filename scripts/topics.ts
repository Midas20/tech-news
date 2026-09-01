// What the topic filter would keep, and what it would throw away.
//
//   npm run topics                    dry run over what is already collected
//   npm run topics -- --days 7        a wider window
//   npm run topics -- --show politics read the titles it refused, by category
//   npm run topics -- --kept          read what it let through, to find misses
//   npm run topics -- --apply         mark the archive's off-topic rows
//
// A filter is a claim about a corpus, and the only way to know whether the
// claim holds is to run it against the corpus and read the output. So this
// exists before the filter was switched on anywhere: the numbers below decided
// the rules, not the other way round.
//
// --apply writes is_tech = false. It does not delete: retention already removes
// stories after a month, the deletion rules in 0037 refuse to touch a month
// that has not been rolled up, and marking is reversible while deleting is not.
// The reader hides anything explicitly marked false, so the effect is the same
// where it is visible and recoverable everywhere else.

import { createDb, closePool } from '../src/db/client.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { loadStackVocabulary } from '../src/process/tagstacks.ts';
import { judgeTopic, type OffTopic } from '../src/collect/topical.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const days = Number(arg('days') ?? 3);
const show = arg('show');
const showKept = process.argv.includes('--kept');
const apply = process.argv.includes('--apply');
const limit = Number(arg('limit') ?? 40000);
// Narrow the read-outs to one outlet. The aggregate is dominated by whichever
// source is loudest, and the interesting question is nearly always about one.
const only = arg('source')?.toLowerCase();

const vocab = await loadStackVocabulary(db);
console.log(`vocabulary: ${vocab.index.size.toLocaleString('en-US')} aliases\n`);

interface Row {
  id: string; title: string; summary: string | null; source: string; kind: string;
  roles: string[] | null;
}

const rows = await db.query<Row>(
  `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title,
          s.summary_en AS summary, src.name AS source, src.kind::text AS kind,
          src.roles::text[] AS roles
     FROM stories s JOIN sources src ON src.id = s.source_id
    WHERE s.collected_at > now() - make_interval(days => $1::int)
      AND s.superseded_by IS NULL
    ORDER BY s.collected_at DESC LIMIT $2`,
  [days, limit]);

console.log(`${rows.length.toLocaleString('en-US')} stories collected in the last ${days} days\n`);

const byCategory = new Map<OffTopic, { n: number; samples: string[] }>();
const bySource = new Map<string, { kept: number; dropped: number }>();
const rejected: string[] = [];
const kept: { source: string; title: string }[] = [];

for (const r of rows) {
  const verdict = judgeTopic(r.title ?? '', r.summary ?? '',
    { vocab, sourceKind: r.kind, sourceRoles: r.roles });
  const tally = bySource.get(r.source) ?? { kept: 0, dropped: 0 };
  if (verdict.keep) {
    tally.kept++;
    if (!only || r.source.toLowerCase().includes(only)) kept.push({ source: r.source, title: r.title });
  } else {
    tally.dropped++;
    rejected.push(r.id);
    const c = byCategory.get(verdict.category!) ?? { n: 0, samples: [] };
    c.n++;
    if (c.samples.length < 400 && (!only || r.source.toLowerCase().includes(only))) {
      c.samples.push(`[${verdict.matched}] ${r.source} — ${r.title}`);
    }
    byCategory.set(verdict.category!, c);
  }
  bySource.set(r.source, tally);
}

const dropped = rejected.length;
console.log(`would keep ${(rows.length - dropped).toLocaleString('en-US')}`
  + `, refuse ${dropped.toLocaleString('en-US')}`
  + ` (${((dropped / Math.max(1, rows.length)) * 100).toFixed(1)}%)\n`);

console.log('by category');
for (const [cat, v] of [...byCategory.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${cat.padEnd(15)}${String(v.n).padStart(6)}`);
}

console.log('\nby source (only where something was refused)');
const sources = [...bySource.entries()]
  .filter(([, v]) => v.dropped > 0)
  .sort((a, b) => b[1].dropped - a[1].dropped)
  .slice(0, 25);
console.log(`  ${'source'.padEnd(30)}${'kept'.padStart(7)}${'refused'.padStart(9)}   refused%`);
for (const [name, v] of sources) {
  const pct = (v.dropped / (v.kept + v.dropped)) * 100;
  console.log(`  ${name.slice(0, 29).padEnd(30)}${String(v.kept).padStart(7)}`
    + `${String(v.dropped).padStart(9)}${`${pct.toFixed(0)}%`.padStart(11)}`
    // A source refusing nearly everything is not a filtering problem, it is a
    // subscription that was a mistake -- say so rather than filtering it
    // forever at collection time.
    + (pct > 85 ? '   <- consider unsubscribing' : ''));
}

if (show) {
  const c = byCategory.get(show as OffTopic);
  if (!c) console.log(`\nnothing refused as "${show}"`);
  else {
    console.log(`\n${c.n} refused as ${show}; first ${Math.min(60, c.samples.length)}:`);
    for (const s of c.samples.slice(0, 60)) console.log(`  ${s.slice(0, 150)}`);
  }
}

if (showKept) {
  console.log(`\nkept, most recent 60 -- read these for what the filter MISSED:`);
  for (const k of kept.slice(0, 60)) {
    console.log(`  [${k.source.slice(0, 20).padEnd(20)}] ${k.title.slice(0, 110)}`);
  }
}

if (apply) {
  if (dropped === 0) {
    console.log('\nnothing to mark.');
  } else {
    // In batches: this is one UPDATE per 500 rows rather than one statement
    // with a 20,000-element array, which is the difference between a query the
    // planner handles and one it spends its time parsing.
    let done = 0;
    for (let i = 0; i < rejected.length; i += 500) {
      const slice = rejected.slice(i, i + 500);
      const r = await db.query<{ n: string }>(
        `WITH upd AS (
           UPDATE stories SET is_tech = false, classifier_version = 'topical-1'
            WHERE id = ANY($1::uuid[])
              -- Never overrule a real classification. This is a lexical rule
              -- and the model's judgement outranks it.
              AND (classifier_version IS NULL OR classifier_version = 'topical-1')
          RETURNING 1)
         SELECT count(*)::text AS n FROM upd`, [slice]);
      done += Number(r[0]?.n ?? 0);
    }
    console.log(`\nmarked ${done.toLocaleString('en-US')} stories is_tech = false.`);
    console.log('they stay in the archive and stay addressable; the reader stops listing them.');
  }
} else {
  console.log('\n(dry run. `npm run topics -- --apply` to mark these in the archive.)');
}

await closePool();

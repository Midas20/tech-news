// What the event classifier would keep, and what it would call an article.
//
//   npm run events                     dry run over what is already collected
//   npm run events -- --show launch    read the titles in one class
//   npm run events -- --show article   read what would be dropped
//   npm run events -- --source Vercel  narrow to one outlet
//   npm run events -- --apply          write event_kind onto the archive
//
// Same shape as `npm run topics`, and for the same reason: a classifier is a
// claim about a corpus, and the only honest way to know whether it holds is to
// run it over the corpus and read the output before switching it on anywhere.

import { createDb, closePool } from '../src/db/client.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { classifyEvent, isEvent, type EventKind } from '../src/collect/eventful.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const days = Number(arg('days') ?? 40);
const show = arg('show');
const only = arg('source')?.toLowerCase();
const apply = process.argv.includes('--apply');
const limit = Number(arg('limit') ?? 60000);

interface Row {
  id: string; title: string; source: string; kind: string; roles: string[] | null;
}

const rows = await db.query<Row>(
  `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title,
          src.name AS source, src.kind::text AS kind, src.roles::text[] AS roles
     FROM stories s JOIN sources src ON src.id = s.source_id
    WHERE s.collected_at > now() - make_interval(days => $1::int)
      AND s.superseded_by IS NULL
      AND coalesce(s.is_tech, true)
    ORDER BY s.collected_at DESC LIMIT $2`,
  [days, limit]);

const byKind = new Map<EventKind, { n: number; samples: string[] }>();
const bySource = new Map<string, { events: number; articles: number }>();
const articles: string[] = [];
const byId: { id: string; kind: EventKind }[] = [];

for (const r of rows) {
  const v = classifyEvent(r.title ?? '', {
    sourceKind: r.kind, firstParty: (r.roles ?? []).includes('PRIMARY') });
  byId.push({ id: r.id, kind: v.kind });

  const k = byKind.get(v.kind) ?? { n: 0, samples: [] };
  k.n++;
  if (k.samples.length < 400 && (!only || r.source.toLowerCase().includes(only))) {
    k.samples.push(`[${(v.matched ?? '—').slice(0, 20)}] ${r.source.slice(0, 18)} — ${r.title}`);
  }
  byKind.set(v.kind, k);

  const t = bySource.get(r.source) ?? { events: 0, articles: 0 };
  if (isEvent(v.kind)) t.events++; else t.articles++;
  bySource.set(r.source, t);
  if (!isEvent(v.kind)) articles.push(r.id);
}

console.log(`${rows.length.toLocaleString('en-US')} stories collected in the last ${days} days\n`);
console.log('by class');
for (const k of ['launch', 'release', 'change', 'article'] as EventKind[]) {
  const v = byKind.get(k);
  if (!v) continue;
  console.log(`  ${k.padEnd(10)}${String(v.n).padStart(7)}`
    + `${`${((v.n / rows.length) * 100).toFixed(1)}%`.padStart(8)}`);
}
const events = rows.length - articles.length;
console.log(`\n  events   ${String(events).padStart(7)}`
  + `${`${((events / Math.max(1, rows.length)) * 100).toFixed(1)}%`.padStart(8)}`);

console.log('\nby source, worst signal first (only sources with 10+ items)');
console.log(`  ${'source'.padEnd(30)}${'events'.padStart(8)}${'articles'.padStart(10)}   event%`);
const ranked = [...bySource.entries()]
  .filter(([, v]) => v.events + v.articles >= 10)
  .sort((a, b) => (a[1].events / (a[1].events + a[1].articles))
    - (b[1].events / (b[1].events + b[1].articles)));
for (const [name, v] of ranked.slice(0, 22)) {
  const pct = (v.events / (v.events + v.articles)) * 100;
  console.log(`  ${name.slice(0, 29).padEnd(30)}${String(v.events).padStart(8)}`
    + `${String(v.articles).padStart(10)}${`${pct.toFixed(0)}%`.padStart(9)}`);
}

if (show) {
  const c = byKind.get(show as EventKind);
  if (!c) console.log(`\nnothing classified as "${show}"`);
  else {
    console.log(`\n${c.n} classified ${show}; showing ${Math.min(60, c.samples.length)}:`);
    for (const s of c.samples.slice(0, 60)) console.log(`  ${s.slice(0, 155)}`);
  }
}

if (!apply) {
  console.log('\n(dry run. `npm run events -- --apply` to write event_kind onto the archive.)');
  await closePool();
  process.exit(0);
}

// Written in batches of 500: one statement per batch rather than one statement
// carrying a 20,000-element array, which is the difference between a query the
// planner handles and one it spends its time parsing.
let done = 0;
for (const kind of ['launch', 'release', 'change', 'article'] as EventKind[]) {
  const ids = byId.filter((b) => b.kind === kind).map((b) => b.id);
  for (let i = 0; i < ids.length; i += 500) {
    const [r] = await db.query<{ n: string }>(
      `WITH upd AS (
         UPDATE stories SET event_kind = $2 WHERE id = ANY($1::uuid[])
         RETURNING 1)
       SELECT count(*)::text AS n FROM upd`, [ids.slice(i, i + 500), kind]);
    done += Number(r?.n ?? 0);
  }
}
console.log(`\nclassified ${done.toLocaleString('en-US')} stories.`);
console.log('the reader shows events by default; articles are one click away under Kind.');

await closePool();

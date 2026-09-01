// Split the registry into tools, stacks and concepts.
//
//   npm run kinds              dry run: print the split and a sample of every rule
//   npm run kinds -- --apply   write it
//   npm run kinds -- --why prettier   explain one entry
//
// Dry run by default because the rules are guesses about 2,300 names and the
// only way to know whether a rule is right is to read what it did. Anything the
// classifier is unsure about lands in `tool`, which is the bucket where a wrong
// answer is easiest to spot.

import { createDb, closePool } from '../src/db/client.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { classify, KINDS, type Kind, type Verdict } from '../src/vocab/kinds.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createDb(url);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const whyIdx = args.indexOf('--why');
const only = whyIdx >= 0 ? args[whyIdx + 1] : null;

interface Row {
  slug: string; name: string; category: string;
  description: string | null; curated: boolean; stories: number | null;
}

const rows = await db.query<Row>(
  `SELECT k.slug, k.name, k.category, k.description, k.curated, sf.stories
     FROM stacks k LEFT JOIN stack_frequency sf ON sf.slug = k.slug
    ORDER BY coalesce(sf.stories, 0) DESC, k.name`);

const verdicts = new Map<string, Verdict>(rows.map((r) => [r.slug, classify(r)]));

if (only) {
  const r = rows.find((x) => x.slug === only || x.name.toLowerCase() === only.toLowerCase());
  if (!r) { console.log(`no entry matching "${only}"`); await closePool(); process.exit(0); }
  const v = verdicts.get(r.slug)!;
  console.log(`${r.name}  (${r.slug})`);
  console.log(`  category    ${r.category}${r.curated ? ' · curated' : ''}`);
  console.log(`  description ${r.description ?? '—'}`);
  console.log(`  → ${v.kind.toUpperCase()}  because ${v.why}: ${v.detail}`);
  await closePool();
  process.exit(0);
}

// ---- what the rules did -----------------------------------------------------

const pad = (s: string | number, n: number) => String(s).padStart(n);

console.log(`\n${rows.length.toLocaleString('en-US')} entries\n`);
console.log('kind      total  curated   in news');
for (const k of KINDS) {
  const mine = rows.filter((r) => verdicts.get(r.slug)!.kind === k.id);
  console.log(`${k.label.toLowerCase().padEnd(9)}${pad(mine.length, 6)}${
    pad(mine.filter((r) => r.curated).length, 9)}${
    pad(mine.filter((r) => (r.stories ?? 0) > 0).length, 10)}`);
}

console.log('\nwhich layer decided:');
const layers = ['override', 'category', 'definition', 'name', 'default'] as const;
for (const why of layers) {
  const mine = rows.filter((r) => verdicts.get(r.slug)!.why === why);
  if (!mine.length) continue;
  const split = KINDS.map((k) =>
    `${k.id} ${mine.filter((r) => verdicts.get(r.slug)!.kind === k.id).length}`).join('  ');
  console.log(`  ${why.padEnd(11)}${pad(mine.length, 5)}   ${split}`);
}

// The entries a reader will actually meet. A rule that is wrong about something
// with 300 stories matters; the same rule wrong about a topic nobody has ever
// written about is noise.
console.log('\ntop 40 by coverage:');
for (const r of rows.slice(0, 40)) {
  const v = verdicts.get(r.slug)!;
  console.log(`  ${pad(r.stories ?? 0, 5)}  ${v.kind.padEnd(8)} ${
    r.name.slice(0, 34).padEnd(34)} ${v.why}: ${v.detail}`);
}

for (const k of KINDS) {
  const mine = rows.filter((r) => verdicts.get(r.slug)!.kind === k.id && r.curated);
  console.log(`\ncurated ${k.id} (${mine.length}), a sample:`);
  console.log('  ' + mine.slice(0, 60).map((r) => r.name).join(', ').slice(0, 900));
}

if (!apply) {
  console.log('\ndry run — nothing written. Re-run with --apply once the lists above read right.');
  await closePool();
  process.exit(0);
}

// ---- write ------------------------------------------------------------------

const byKind = new Map<Kind, string[]>();
for (const r of rows) {
  const k = verdicts.get(r.slug)!.kind;
  (byKind.get(k) ?? byKind.set(k, []).get(k)!).push(r.slug);
}

let changed = 0;
for (const [kind, slugs] of byKind) {
  for (let i = 0; i < slugs.length; i += 500) {
    const batch = slugs.slice(i, i + 500);
    const res = await db.query<{ slug: string }>(
      `UPDATE stacks SET kind = $1, updated_at = now()
        WHERE slug = ANY($2::text[]) AND kind IS DISTINCT FROM $1
        RETURNING slug`, [kind, batch]);
    changed += res.length;
  }
}
console.log(`\napplied — ${changed.toLocaleString('en-US')} entries changed kind.`);
await closePool();

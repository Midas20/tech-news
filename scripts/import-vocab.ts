// Import vocabulary from the public lists that maintain it better than we could.
//
//   npm run import:vocab -- --dry              report only
//   npm run import:vocab -- --source linguist  one source
//   npm run import:vocab                       linguist, cncf, then synonyms
//
// Order matters. Linguist and CNCF ADD entries; the Stack Overflow synonyms only
// ever attach aliases to entries that already exist, so running it last means it
// can enrich everything the other two just brought in.
//
// Synonyms never create a stack. A synonym is evidence that two names mean the
// same thing, not evidence that the thing belongs in this vocabulary -- and Stack
// Overflow has tags for `arrays`, `loops` and `if-statement`.

import { createDb } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadTaxonomy } from '../src/process/taxonomy.ts';
import { isCommonWord } from '../src/lib/english.ts';
import {
  fromLinguist, fromCncf, fromLibrariesIo, fromStackOverflowSynonyms, type VocabEntry,
} from '../src/vocab/sources.ts';
import { keyStatus } from '../src/vocab/keys.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dry = process.argv.includes('--dry');
const only = arg('source');
const wanted = (name: string) => !only || only === name;

const db = createDb(url);

// Say which keys are in play before doing anything, because a missing one shows
// up as a quietly smaller import rather than an error.
for (const k of keyStatus(process.env)) {
  if (k.usedBy.some((u) => u.startsWith('import'))) {
    console.log(`  ${k.configured ? '✓' : '·'} ${k.env.padEnd(20)} ${
      k.configured ? k.unlocks : `not set — ${k.without}`}`);
  }
}

/** An alias worth storing: not prose, not a fragment, not the slug itself. */
function usefulAlias(alias: string, slug: string): boolean {
  const a = alias.trim();
  if (a.length < 3 || a.length > 40) return false;
  if (a.toLowerCase() === slug) return false;
  if (isCommonWord(a)) return false;
  return true;
}

async function importEntries(entries: VocabEntry[], label: string): Promise<void> {
  const taxonomy = await loadTaxonomy(db);
  let added = 0;
  let enriched = 0;
  let known = 0;

  for (const e of entries) {
    if (!e.slug || e.slug.length < 2) continue;

    const existing = taxonomy.resolve(e.slug)
      ?? taxonomy.resolve(e.name)
      ?? e.aliases.map((a) => taxonomy.resolve(a)).find(Boolean)
      ?? null;

    const aliases = e.aliases.filter((a) => usefulAlias(a, e.slug));

    if (existing) {
      known++;
      if (dry) continue;
      // Only nulls are filled. An imported list does not get to overwrite a
      // decision someone made about an entry that already exists.
      const updated = await db.query<{ slug: string }>(
        `UPDATE stacks SET
           description = coalesce(description, $2),
           homepage_url = coalesce(homepage_url, $3),
           repo_url = coalesce(repo_url, $4),
           aliases = coalesce((SELECT array_agg(DISTINCT x) FROM unnest(aliases || $5::text[]) AS x), '{}')
         WHERE slug = $1
           AND (description IS NULL OR homepage_url IS NULL OR repo_url IS NULL
                OR NOT (aliases @> $5::text[]))
         RETURNING slug`,
        [existing, e.description, e.homepage, e.repo, aliases]);
      if (updated.length) enriched++;
      continue;
    }

    added++;
    if (dry) continue;
    await db.query(
      `INSERT INTO stacks (slug, name, aliases, category, description, homepage_url, repo_url,
                           curated, origin, discovered_at)
       VALUES ($1, $2, $3::text[], $4, $5, $6, $7, false, $8, now())
       ON CONFLICT (slug) DO NOTHING`,
      [e.slug, e.name, aliases, e.category, e.description, e.homepage, e.repo, e.origin]);
  }

  console.log(
    `${label}: ${entries.length} read · ${added} ${dry ? 'would be added' : 'added'} · ` +
    `${enriched} enriched · ${known} already known`);
}

// --- entries -------------------------------------------------------------------

if (wanted('linguist')) {
  console.log('fetching the Linguist language list…');
  await importEntries(await fromLinguist(), 'linguist');
}

if (wanted('cncf')) {
  console.log('fetching the CNCF landscape…');
  await importEntries(await fromCncf(), 'cncf');
}

if (wanted('libraries')) {
  if (!process.env.LIBRARIES_IO_KEY?.trim()) {
    console.log('libraries: skipped — LIBRARIES_IO_KEY is not set');
  } else {
    console.log('fetching the most depended-on packages…');
    await importEntries(
      await fromLibrariesIo({ key: process.env.LIBRARIES_IO_KEY, perPlatform: 100 }),
      'libraries.io');
  }
}

// --- aliases --------------------------------------------------------------------

if (wanted('synonyms')) {
  console.log('fetching Stack Overflow tag synonyms…');
  const { synonyms, quotaRemaining, truncated } = await fromStackOverflowSynonyms({
    key: process.env.STACKEXCHANGE_KEY,
  });
  console.log(
    `  ${synonyms.length} synonyms · quota remaining ${quotaRemaining ?? 'unknown'}` +
    (truncated
      ? ' · stopped at the unauthenticated page ceiling (set STACKEXCHANGE_KEY for the rest)'
      : ''));

  const taxonomy = await loadTaxonomy(db);
  let attached = 0;
  let unmatched = 0;

  // Group by the entry the synonym points at, so each stack is updated once
  // rather than once per alias.
  const byStack = new Map<string, Set<string>>();
  for (const s of synonyms) {
    const slug = taxonomy.resolve(s.to);
    if (!slug) { unmatched++; continue; }
    if (!usefulAlias(s.from, slug)) continue;
    // An alias that already resolves somewhere else would make two technologies
    // share a name, which is the defect this vocabulary exists to prevent.
    const clash = taxonomy.resolve(s.from);
    if (clash && clash !== slug) continue;

    const set = byStack.get(slug) ?? new Set<string>();
    set.add(s.from);
    byStack.set(slug, set);
  }

  for (const [slug, set] of byStack) {
    if (dry) { attached += set.size; continue; }
    const updated = await db.query<{ slug: string }>(
      `UPDATE stacks
          SET aliases = coalesce((SELECT array_agg(DISTINCT x) FROM unnest(aliases || $2::text[]) AS x), '{}')
        WHERE slug = $1 AND NOT (aliases @> $2::text[])
        RETURNING slug`,
      [slug, [...set]]);
    if (updated.length) attached += set.size;
  }

  console.log(
    `synonyms: ${attached} aliases ${dry ? 'would be attached' : 'attached'} to ` +
    `${byStack.size} entries · ${unmatched} pointed at tags this vocabulary does not have`);
}

const [totals] = await db.query<{ n: string; aliases: string; described: string }>(
  `SELECT count(*)::text AS n,
          coalesce(sum(coalesce(array_length(aliases, 1), 0)), 0)::text AS aliases,
          count(description)::text AS described
     FROM stacks`);
console.log(`vocabulary: ${totals?.n} entries · ${totals?.aliases} aliases · ${totals?.described} described`);

if (!dry && wanted('synonyms')) {
  console.log('\nStack Exchange content is CC BY-SA 4.0 — attribution is in the page footer.');
}

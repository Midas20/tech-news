// Repair duplicate taxonomy entries.
//
// The registry page surfaced 48 pairs of stacks sharing a display name. They are
// not near-duplicates: each pair is the SAME record stored twice -- identical
// name, category, aliases and repository -- once under the slug the name implies
// and once under a slug lifted from some other entry's alias list.
//
//   sqlmesh        SQLMesh        aliases {sqlmesh}        repo TobikoData/sqlmesh
//   dagger-io      SQLMesh        aliases {sqlmesh}        repo TobikoData/sqlmesh   <- phantom
//
// That is worse than clutter. In a closed vocabulary the slug IS the identity, so
// a row claiming `drone` is Woodpecker CI makes the reader label two real stories
// with the wrong technology.
//
// The repair, in order:
//   1. pick the canonical row of each pair (the slug the name implies)
//   2. re-tag any story carrying the phantom slug
//   3. keep the phantom slug as an ALIAS of the canonical row, so old links and
//      old model output still resolve
//   4. delete the phantom row
//
// Step 3 is what makes step 4 safe. Nothing that ever resolved stops resolving.
//
//   node --experimental-strip-types scripts/fix-duplicate-stacks.ts          (dry run)
//   node --experimental-strip-types scripts/fix-duplicate-stacks.ts --apply

import { Pool } from '@neondatabase/serverless';
import { loadDotEnv } from '../src/lib/dotenv.ts';

await loadDotEnv();

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_DIRECT_URL is not set.');
  process.exit(1);
}

interface Row {
  slug: string;
  name: string;
  category: string;
  aliases: string[];
  repo_url: string | null;
  children: number;
  stories: number;
}

/** The slug a name implies, by the same rules the seeds use. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\+\+/g, 'pp')
    .replace(/[.#/]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Which of the two is real.
 *
 * The name is the evidence: whichever slug the name derives from is the one a
 * person wrote deliberately. Where neither derives cleanly, the tie is broken by
 * what would be lost -- descendants first, then stories, then the shorter slug,
 * which in every observed pair is the deliberate one.
 */
function pickCanonical(a: Row, b: Row): { keep: Row; drop: Row; why: string } {
  const target = slugify(a.name);
  if (a.slug === target && b.slug !== target) return { keep: a, drop: b, why: 'slug matches the name' };
  if (b.slug === target && a.slug !== target) return { keep: b, drop: a, why: 'slug matches the name' };

  const aPrefix = target.startsWith(a.slug);
  const bPrefix = target.startsWith(b.slug);
  if (aPrefix && !bPrefix) return { keep: a, drop: b, why: 'slug is the stem of the name' };
  if (bPrefix && !aPrefix) return { keep: b, drop: a, why: 'slug is the stem of the name' };

  if (a.children !== b.children) {
    return a.children > b.children
      ? { keep: a, drop: b, why: 'has descendants' }
      : { keep: b, drop: a, why: 'has descendants' };
  }
  if (a.stories !== b.stories) {
    return a.stories > b.stories
      ? { keep: a, drop: b, why: 'carries more stories' }
      : { keep: b, drop: a, why: 'carries more stories' };
  }
  return a.slug.length <= b.slug.length
    ? { keep: a, drop: b, why: 'shorter slug' }
    : { keep: b, drop: a, why: 'shorter slug' };
}

const pool = new Pool({ connectionString: url });
const client = await pool.connect();

try {
  const { rows } = await client.query<Row>(`
    SELECT s.slug, s.name, s.category, s.aliases, s.repo_url,
           (SELECT count(*) FROM stacks k WHERE k.parent_id = s.id)::int AS children,
           (SELECT count(*) FROM stories st
             WHERE st.superseded_by IS NULL AND st.stacks && ARRAY[s.slug])::int AS stories
      FROM stacks s
     WHERE s.name IN (SELECT name FROM stacks GROUP BY name HAVING count(*) > 1)
     ORDER BY s.name, s.slug`);

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const list = groups.get(r.name) ?? [];
    list.push(r);
    groups.set(r.name, list);
  }

  let retagged = 0;
  let dropped = 0;
  let skipped = 0;

  for (const [name, list] of groups) {
    if (list.length !== 2) {
      console.log(`skip  ${name}: ${list.length} rows, needs a human`);
      skipped++;
      continue;
    }
    const [a, b] = list as [Row, Row];

    // Only merge rows that really are the same record. Two entries that merely
    // share a display name are a naming problem, not a duplicate.
    const sameRecord = a.category === b.category
      && (a.repo_url ?? '') === (b.repo_url ?? '')
      && a.aliases.slice().sort().join('|') === b.aliases.slice().sort().join('|');
    if (!sameRecord) {
      console.log(`skip  ${name}: ${a.slug} and ${b.slug} differ beyond the name`);
      skipped++;
      continue;
    }

    const { keep, drop, why } = pickCanonical(a, b);
    console.log(
      `merge ${drop.slug.padEnd(26)} -> ${keep.slug.padEnd(24)} (${why}` +
      `${drop.stories ? `, ${drop.stories} stories re-tagged` : ''}` +
      `${drop.children ? `, ${drop.children} children` : ''})`,
    );

    if (!apply) continue;

    if (drop.children > 0) {
      await client.query(
        `UPDATE stacks SET parent_id = (SELECT id FROM stacks WHERE slug = $1)
          WHERE parent_id = (SELECT id FROM stacks WHERE slug = $2)`,
        [keep.slug, drop.slug]);
    }

    if (drop.stories > 0) {
      const res = await client.query(
        `UPDATE stories
            SET stacks = (SELECT array_agg(DISTINCT x)
                            FROM unnest(array_replace(stacks, $1, $2)) AS x)
          WHERE superseded_by IS NULL AND stacks && ARRAY[$1]`,
        [drop.slug, keep.slug]);
      retagged += res.rowCount ?? 0;
    }

    // The dead slug survives as an alias: a link, a saved view or a model that
    // learned it still resolves to the right technology.
    await client.query(
      `UPDATE stacks SET aliases =
         coalesce((SELECT array_agg(DISTINCT x) FROM unnest(aliases || ARRAY[$2]) AS x), '{}')
        WHERE slug = $1`,
      [keep.slug, drop.slug]);

    await client.query(`DELETE FROM stacks WHERE slug = $1`, [drop.slug]);
    dropped++;
  }

  console.log(
    `\n${groups.size} duplicate names · ${apply ? `${dropped} merged, ${retagged} stories re-tagged` : 'dry run'}` +
    `${skipped ? ` · ${skipped} skipped` : ''}`);
  if (!apply) console.log('re-run with --apply to make these changes.');
} finally {
  client.release();
  await pool.end();
}

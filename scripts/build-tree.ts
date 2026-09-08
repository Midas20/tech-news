// Give every entry a parent.
//
//   node --experimental-strip-types scripts/build-tree.ts           (dry run)
//   node --experimental-strip-types scripts/build-tree.ts --apply
//
// The taxonomy is a tree and was behaving like a list: 1,617 of 2,323 entries
// had no parent, so the registry showed "a root of the taxonomy" on seventy per
// cent of the vocabulary and `stack_expand` had nothing to expand.
//
// The 689 curated relationships are not touched, because they are better than
// any rule could be:
//
//   django  -> python     a Python framework, not merely "a framework"
//   numpy   -> python
//   express -> nodejs
//   tailwindcss -> css
//
// What the imports left behind is different: an entry with a category and no
// position. Category is the one property every entry has, so it is what decides
// where an orphan hangs -- python under Languages, Redis under Databases, Helm
// under Tooling. That is a real answer, and a hand-written parent can always
// replace it later without this pass undoing the change.

import { makePool } from '../src/db/driver.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';

await loadDotEnv();

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_DIRECT_URL is not set.');
  process.exit(1);
}

/**
 * The root each category hangs from.
 *
 * Most of these already exist as curated field roots and are reused rather than
 * duplicated -- `languages` has 49 hand-placed children and creating a second
 * "Language" root beside it would split the tree in two. The rest are created.
 */
const ROOT_FOR_CATEGORY: Record<string, { slug: string; name: string; blurb: string }> = {
  language: { slug: 'languages', name: 'Languages', blurb: 'Programming languages and their toolchains.' },
  framework: { slug: 'frameworks', name: 'Frameworks', blurb: 'Opinionated application scaffolding.' },
  library: { slug: 'libraries', name: 'Libraries', blurb: 'Focused packages a project depends on.' },
  runtime: { slug: 'runtimes', name: 'Runtimes', blurb: 'Where code actually executes.' },
  db: { slug: 'databases', name: 'Databases', blurb: 'Stores, engines and query layers.' },
  data: { slug: 'data', name: 'Data', blurb: 'Pipelines, warehouses, formats and processing.' },
  ai: { slug: 'ai', name: 'AI & ML', blurb: 'Models, training, inference and the tooling around them.' },
  infra: { slug: 'infra', name: 'Infrastructure', blurb: 'Orchestration, networking, storage.' },
  cloud: { slug: 'cloud', name: 'Cloud', blurb: 'Managed platforms and their services.' },
  devops: { slug: 'devops', name: 'DevOps', blurb: 'Build, deploy, observe.' },
  security: { slug: 'security', name: 'Security', blurb: 'Defence, cryptography, identity and disclosure.' },
  os: { slug: 'os', name: 'Operating systems', blurb: 'Kernels, distributions and desktops.' },
  web: { slug: 'web-platform', name: 'Web platform', blurb: 'Browsers, standards and what ships in them.' },
  mobile: { slug: 'mobile', name: 'Mobile', blurb: 'Phone and tablet platforms and their SDKs.' },
  hardware: { slug: 'hardware', name: 'Hardware', blurb: 'Silicon, accelerators and the boards they sit on.' },
  protocol: { slug: 'protocols', name: 'Protocols', blurb: 'Wire formats and specifications.' },
  tooling: { slug: 'tooling', name: 'Tooling', blurb: 'Editors, build tools and everything on the side.' },
  practice: { slug: 'practice', name: 'Practice', blurb: 'How teams work, rather than what they run.' },
  domain: { slug: 'domains', name: 'Domains', blurb: 'Fields of application: fintech, gaming, science.' },
};

const pool = makePool(url);
const client = await pool.connect();

try {
  // --- 1. every category needs a root to hang from ---------------------------
  const created: string[] = [];
  for (const [category, root] of Object.entries(ROOT_FOR_CATEGORY)) {
    const found = await client.query('SELECT slug FROM stacks WHERE slug = $1', [root.slug]);
    if (found.rowCount) continue;
    created.push(root.slug);
    if (!apply) continue;
    await client.query(
      `INSERT INTO stacks (slug, name, aliases, category, description, curated, origin)
       VALUES ($1, $2, '{}', $3, $4, true, 'manual')`,
      [root.slug, root.name, category, root.blurb]);
  }
  console.log(created.length
    ? `${apply ? 'created' : 'would create'} ${created.length} category roots: ${created.join(', ')}`
    : 'every category already has a root');

  // --- 2. attach the orphans -------------------------------------------------
  const { rows: orphans } = await client.query<{ slug: string; category: string }>(
    `SELECT slug, category FROM stacks WHERE parent_id IS NULL ORDER BY category, slug`);

  const rootSlugs = new Set(Object.values(ROOT_FOR_CATEGORY).map((r) => r.slug));
  const byCategory = new Map<string, number>();
  let attached = 0;
  let leftAlone = 0;

  for (const o of orphans) {
    // A root is not its own parent, and the curated field roots stay at the top:
    // /fields enters the tree there and would break if they were buried.
    if (rootSlugs.has(o.slug)) { leftAlone++; continue; }

    const root = ROOT_FOR_CATEGORY[o.category];
    if (!root || root.slug === o.slug) { leftAlone++; continue; }

    attached++;
    byCategory.set(o.category, (byCategory.get(o.category) ?? 0) + 1);
    if (!apply) continue;

    await client.query(
      `UPDATE stacks SET parent_id = (SELECT id FROM stacks WHERE slug = $2)
        WHERE slug = $1 AND parent_id IS NULL`,
      [o.slug, root.slug]);
  }

  console.log(
    `${attached} orphans ${apply ? 'attached' : 'would be attached'} · ${leftAlone} left as roots`);
  console.log('  ' + [...byCategory].sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}:${n}`).join(' '));

  // --- 3. a tree with a cycle in it is not a tree ----------------------------
  const cycles = await client.query<{ slug: string }>(`
    WITH RECURSIVE walk AS (
      SELECT id, parent_id, slug, ARRAY[id] AS seen, false AS looped
        FROM stacks
      UNION ALL
      SELECT s.id, s.parent_id, w.slug, w.seen || s.id, s.id = ANY(w.seen)
        FROM walk w JOIN stacks s ON s.id = w.parent_id
       WHERE NOT w.looped AND array_length(w.seen, 1) < 12
    )
    SELECT DISTINCT slug FROM walk WHERE looped`);
  if (cycles.rowCount) {
    console.error(`CYCLES: ${cycles.rows.map((r) => r.slug).join(', ')}`);
  } else {
    console.log('no cycles');
  }

  const shape = await client.query<{ depth: number; n: string }>(`
    WITH RECURSIVE t AS (
      SELECT id, 1 AS depth FROM stacks WHERE parent_id IS NULL
      UNION ALL
      SELECT s.id, t.depth + 1 FROM stacks s JOIN t ON s.parent_id = t.id WHERE t.depth < 12
    )
    SELECT depth, count(*)::text AS n FROM t GROUP BY depth ORDER BY depth`);
  console.log('depth: ' + shape.rows.map((r) => `${r.depth}→${r.n}`).join('  '));

  if (!apply) console.log('\nre-run with --apply to make these changes.');
} finally {
  client.release();
  await pool.end();
}

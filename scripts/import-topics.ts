// Import the GitHub topic index into the taxonomy.
//
//   npm run import:topics             add what is missing
//   npm run import:topics -- --dry    report only
//
// The vocabulary was 707 entries written by hand, which is both a lot of work
// and nowhere near enough: a closed vocabulary can only tag what it contains, so
// every technology nobody typed in is invisible to the whole system.
//
// github/explore is the curated index behind GitHub's own topic pages. Each
// topic ships a small frontmatter record:
//
//   topic, display_name, aliases, short_description, url, github_url, released
//
// which is exactly the shape of a stack row -- including the four columns that
// were empty for all 707 entries. So this is not a scrape of arbitrary strings;
// it is one curated list mapped onto another, and it fills in the descriptions
// and homepages at the same time.
//
// Imported entries are marked `origin = 'topic_index'` and `curated = false`, so
// the registry can always separate what a person chose from what was imported.

import { gunzipSync } from 'node:zlib';
import { createDb } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadTaxonomy } from '../src/process/taxonomy.ts';
import { frontmatter } from '../src/lib/frontmatter.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const dry = process.argv.includes('--dry');
const TARBALL = 'https://codeload.github.com/github/explore/tar.gz/refs/heads/main';

interface Topic {
  topic: string;
  display_name: string;
  aliases: string[];
  short_description: string | null;
  url: string | null;
  github_url: string | null;
  released: string | null;
  related: string[];
}

/**
 * Which of the nineteen categories a topic belongs in.
 *
 * The topic index has no category, so this reads the description for the words
 * that actually decide it. It is a heuristic and it is wrong sometimes; what
 * keeps that acceptable is that category is a browsing aid here, not an identity
 * -- the slug is the identity, and it comes from the source.
 */
const CATEGORY_RULES: [RegExp, string][] = [
  [/\b(programming language|language|compiler|interpreter|dialect)\b/i, 'language'],
  [/\b(framework|full-stack)\b/i, 'framework'],
  [/\b(database|data ?store|dbms|sql|nosql|key-value|document store)\b/i, 'db'],
  [/\b(machine learning|deep learning|neural|artificial intelligence|llm|model|nlp|computer vision)\b/i, 'ai'],
  [/\b(security|encryption|cryptograph|vulnerabilit|malware|firewall|authentication)\b/i, 'security'],
  [/\b(kubernetes|container|orchestration|infrastructure|networking|load balanc|proxy|server)\b/i, 'infra'],
  [/\b(cloud|serverless|saas|paas|hosting)\b/i, 'cloud'],
  [/\b(ci\/cd|continuous integration|deployment|devops|monitoring|observability|logging)\b/i, 'devops'],
  [/\b(android|ios|mobile|smartphone|flutter)\b/i, 'mobile'],
  [/\b(browser|css|html|web ?browser|front-?end|ui component)\b/i, 'web'],
  [/\b(operating system|kernel|linux distribution|unix)\b/i, 'os'],
  [/\b(protocol|specification|standard|rfc)\b/i, 'protocol'],
  [/\b(hardware|chip|processor|fpga|microcontroller|robot|embedded)\b/i, 'hardware'],
  [/\b(data (analysis|science|pipeline|visuali)|analytics|etl|warehouse|dataset)\b/i, 'data'],
  [/\b(library|package|module|toolkit)\b/i, 'library'],
  [/\b(runtime|virtual machine|engine)\b/i, 'runtime'],
  [/\b(game|gaming|finance|fintech|health|science|education|blockchain|cryptocurrency)\b/i, 'domain'],
  [/\b(methodology|practice|workflow|principle|pattern)\b/i, 'practice'],
];

function inferCategory(t: Topic): string {
  const text = `${t.display_name} ${t.short_description ?? ''}`;
  for (const [rx, category] of CATEGORY_RULES) {
    if (rx.test(text)) return category;
  }
  return 'tooling';
}

/**
 * Aliases worth storing.
 *
 * A two-letter alias resolves half the language, and a topic index full of
 * `api`, `app` and `list` would hand those words to the tagger. The entry is
 * still imported -- it is the ALIAS that is dropped.
 */
const GENERIC_ALIASES = new Set([
  'api', 'apis', 'app', 'apps', 'art', 'bot', 'bots', 'cli', 'sdk', 'web', 'ui',
  'ux', 'data', 'code', 'dev', 'ops', 'list', 'lists', 'awesome', 'tutorial',
  'example', 'examples', 'demo', 'project', 'library', 'framework', 'tool',
  'tools', 'server', 'client', 'game', 'games', 'text', 'file', 'files', 'test',
  'tests', 'build', 'design', 'style', 'theme', 'plugin', 'package', 'module',
  'script', 'template', 'config', 'guide', 'book', 'course', 'blog', 'news',
  'chat', 'mail', 'email', 'search', 'db', 'cloud', 'mobile', 'desktop',
  'shell', 'editor', 'browser', 'network', 'docs', 'spec', 'format',
]);

function usefulAlias(alias: string): boolean {
  const a = alias.toLowerCase().trim();
  return a.length >= 3 && !GENERIC_ALIASES.has(a);
}

function slugOk(slug: string): boolean {
  return /^[a-z0-9][a-z0-9.+#-]{1,48}$/.test(slug);
}

// --- fetch --------------------------------------------------------------------

/**
 * Read a tar archive from memory.
 *
 * Shelling out to `tar` failed on Windows -- the temp path went through as
 * something it read as stdin -- and pulling in a tar library to extract one
 * directory would be a dependency for forty lines of format. A tar file is
 * 512-byte headers, each followed by its content padded to 512.
 */
function* tarEntries(buf: Buffer): Generator<{ name: string; data: Buffer }> {
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\u0000.*$/, '');
    if (!name) break;                                  // two empty blocks end it

    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\u0000.*$/, '').trim(), 8) || 0;
    const type = String.fromCharCode(header[156] ?? 0);
    // Long names use a GNU extension record; none of the paths here need it.
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\u0000.*$/, '');
    const full = prefix ? `${prefix}/${name}` : name;

    offset += 512;
    if (type === '0' || type === '\u0000') {
      yield { name: full, data: buf.subarray(offset, offset + size) };
    }
    offset += Math.ceil(size / 512) * 512;
  }
}

console.log('downloading the topic index…');
const res = await fetch(TARBALL, { headers: { 'user-agent': 'NewsTrack/0.1 (taxonomy import)' } });
if (!res.ok) {
  console.error(`could not download the index: HTTP ${res.status}`);
  process.exit(1);
}
const tar = gunzipSync(Buffer.from(await res.arrayBuffer()));

const topics: Topic[] = [];
for (const entry of tarEntries(tar)) {
  if (!/\/topics\/[^/]+\/index\.md$/.test(entry.name)) continue;
  const dir = entry.name.split('/').slice(-2)[0] ?? '';
  const fm = frontmatter(entry.data.toString('utf8'));
  const slug = (fm.topic ?? dir).trim();
  if (!slugOk(slug)) continue;
  topics.push({
    topic: slug,
    display_name: (fm.display_name ?? dir).trim(),
    aliases: (fm.aliases ?? '').split(',').map((a) => a.trim()).filter(usefulAlias),
    short_description: fm.short_description?.replace(/\s+/g, ' ').trim() || null,
    url: fm.url?.trim() || null,
    github_url: fm.github_url?.trim() || null,
    released: fm.released?.trim() || null,
    related: (fm.related ?? '').split(',').map((a) => a.trim()).filter(Boolean),
  });
}

console.log(`parsed ${topics.length} topics`);

// --- import -------------------------------------------------------------------

const db = createDb(url);
const taxonomy = await loadTaxonomy(db);

let added = 0;
let enriched = 0;
let skipped = 0;

for (const t of topics) {
  const existing = taxonomy.resolve(t.topic)
    ?? taxonomy.resolve(t.display_name)
    ?? t.aliases.map((a) => taxonomy.resolve(a)).find(Boolean)
    ?? null;

  if (existing) {
    // Already known -- but the topic index carries description, homepage and
    // aliases, and those columns were empty for every hand-written row. Filling
    // a gap is not overwriting a decision, so only nulls are touched.
    if (!dry) {
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
        [existing, t.short_description, t.url, t.github_url, [...t.aliases, t.topic]]);
      if (updated.length) enriched++;
      else skipped++;
    } else {
      skipped++;
    }
    continue;
  }

  if (!dry) {
    await db.query(
      `INSERT INTO stacks (slug, name, aliases, category, description, homepage_url, repo_url,
                           curated, origin, discovered_at)
       VALUES ($1, $2, $3::text[], $4, $5, $6, $7, false, 'topic_index', now())
       ON CONFLICT (slug) DO NOTHING`,
      [t.topic, t.display_name, t.aliases, inferCategory(t),
        t.short_description, t.url, t.github_url]);
  }
  added++;
}

console.log(
  dry
    ? `dry run: ${added} would be added, ${skipped} already known`
    : `imported: ${added} added, ${enriched} existing entries enriched, ${skipped} unchanged`);

const [total] = await db.query<{ n: string; described: string; home: string }>(
  `SELECT count(*)::text AS n, count(description)::text AS described,
          count(homepage_url)::text AS home FROM stacks`);
console.log(`vocabulary: ${total?.n} entries · ${total?.described} described · ${total?.home} with a homepage`);

// Deterministic technology tagging.
//
// `stories.stacks` was written by the classification pass and by nothing else,
// which made the vocabulary inert in two directions at once: with the model gate
// shut, nothing was ever tagged; and adding an entry -- by hand or by discovery
// -- did nothing to the 3,500 stories already sitting in the archive that
// mention it.
//
// This is the cheap-code half of the split the whole system is built on. Alias
// matching against the closed vocabulary is plain string work: no inference, no
// budget, no gate. The model's job was never to know that "k8s" means Kubernetes
// -- a lookup table knows that -- it was to judge what a story MEANS. So this
// runs on everything, always, and classification keeps the judgement.
//
// Matching is conservative in exactly the way company tagging had to become.
// "Go", "D", "Hack", "Ent", "R" and "uv" are ordinary words, so a short alias
// must appear as a whole word AND capitalised as the technology is written.
// Over-tagging is much worse than under-tagging: a Go page that includes every
// story with the word "go" in the headline is not a Go page.

import type { Db } from '../db/client.ts';
import { stripUrls } from './companies.ts';
import { isCommonWord } from '../lib/english.ts';

export interface StackVocabulary {
  /** lowercased alias -> canonical slug */
  index: Map<string, string>;
  /** the alias as the technology actually writes it, for the capital check */
  canonicalCase: Map<string, string>;
  /** slugs a person chose, which are trusted further than imported ones */
  curated: Set<string>;
}

export interface TagStacksReport {
  examined: number;
  tagged: number;
  added: number;
}

/**
 * Aliases that are also ordinary English words. Being on this list does not
 * exclude a technology -- it raises the evidence it needs to a capital letter.
 *
 * Membership here, not length, is what decides. The first version of this used
 * "four characters or fewer", which quietly refused to match `k8s`, `npm`, `jq`
 * and `vim` -- names nobody has ever capitalised. Short is not the same as
 * ambiguous: `k8s` contains a digit and is a word in no language.
 */
const AMBIGUOUS = new Set([
  // Short English words that are also technology names.
  'ant', 'cat', 'top', 'less', 'more', 'tree', 'make', 'fish', 'dash', 'ash',
  'sed', 'awk', 'yes', 'test', 'time', 'date', 'sort', 'join', 'split', 'seq',
  'go', 'd', 'r', 'c', 'hack', 'ent', 'uv', 'nx', 'next', 'rust', 'swift',
  'kotlin', 'dart', 'elm', 'julia', 'crystal', 'nim', 'zig', 'v', 'ada',
  'spring', 'struts', 'play', 'meteor', 'ember', 'backbone', 'knockout',
  'redis', 'neon', 'druid', 'presto', 'hive', 'pig', 'storm', 'flink', 'beam',
  'arrow', 'parquet', 'avro', 'thrift', 'mesa', 'wayland', 'sway', 'i3',
  'atom', 'brackets', 'light table', 'processing', 'unity', 'unreal', 'godot',
  'chef', 'puppet', 'salt', 'consul', 'vault', 'nomad', 'packer', 'habitat',
  'element', 'signal', 'session', 'matrix', 'delta', 'iceberg', 'hudi',
  'lens', 'helm', 'flux', 'argo', 'linkerd', 'envoy', 'contour', 'ambassador',
  // Found by reading what the tagger actually claimed. Each of these is a real
  // alias of a real project AND an ordinary noun, and the ordinary noun wins in
  // headlines by a wide margin:
  //
  //   drone  -> woodpecker-ci  (Woodpecker was Drone CI)
  //             "Ukraine unveils native jet-powered drone interceptor"
  //   cargo  -> rust           "an automatic transmission to cargo bikes"
  //   asm    -> assembly       "Xtracycle's Swoop ASM e-bike"
  //   ring   -> ring           "0-ring", "ring road"
  //   red    -> red            anything at all
  //
  // Being here does not remove them from the vocabulary. It raises the evidence
  // they need to the capitalised form the project actually writes, which is the
  // same bar Go and Rust already clear.
  'drone', 'cargo', 'ring', 'red', 'arg', 'oop', 'swoop', 'native', 'jet',
  'bond', 'pilot', 'scout', 'sentry', 'falcon', 'phoenix', 'comet', 'rocket',
  'anchor', 'compass', 'atlas', 'mercury', 'saturn', 'apollo', 'orion',
]);

/**
 * Aliases that must never tag anything, however real the entry behind them.
 *
 * Importing 938 GitHub topics brought in `api`, `app`, `bot`, `art`, `list` and
 * `awesome` as aliases. Each is a genuine topic page; each is also a word that
 * appears in a third of all headlines, and a tagger that acts on them would put
 * "API" on everything and destroy the meaning of every technology page at once.
 *
 * Being here removes an alias from TAGGING only. The entry stays in the
 * vocabulary, stays searchable, and stays browsable -- what it loses is the
 * right to claim a story because a common noun appeared in the title.
 */
const GENERIC = new Set([
  'api', 'apis', 'app', 'apps', 'application', 'art', 'bot', 'bots', 'cli', 'sdk',
  'web', 'ui', 'ux', 'data', 'code', 'dev', 'ops', 'list', 'lists', 'awesome',
  'tutorial', 'tutorials', 'example', 'examples', 'sample', 'samples', 'demo',
  'project', 'projects', 'library', 'libraries', 'framework', 'frameworks',
  'tool', 'tools', 'server', 'client', 'game', 'games', 'music', 'video',
  'image', 'images', 'text', 'file', 'files', 'json', 'xml', 'http', 'https',
  'test', 'tests', 'testing', 'build', 'deploy', 'design', 'style', 'theme',
  'plugin', 'plugins', 'package', 'packages', 'module', 'modules', 'script',
  'scripts', 'template', 'templates', 'config', 'setup', 'install', 'guide',
  'book', 'books', 'course', 'blog', 'news', 'chat', 'mail', 'email', 'search',
  'database', 'db', 'cloud', 'mobile', 'desktop', 'terminal', 'shell', 'editor',
  'browser', 'network', 'security', 'privacy', 'monitoring', 'analytics',
  'documentation', 'docs', 'readme', 'license', 'open-source', 'opensource',
  'algorithm', 'algorithms', 'protocol', 'format', 'standard', 'spec',
]);

export async function loadStackVocabulary(db: Db): Promise<StackVocabulary> {
  const [rows, curatedRows] = await Promise.all([
    db.query<{ alias: string; slug: string }>(`SELECT alias, slug FROM stack_alias_lookup`),
    db.query<{ slug: string }>(`SELECT slug FROM stacks WHERE curated`),
  ]);
  const curated = new Set(curatedRows.map((r) => r.slug));

  const index = new Map<string, string>();
  const canonicalCase = new Map<string, string>();
  for (const r of rows) {
    const key = r.alias.toLowerCase().trim();
    if (key.length < 2) continue;
    if (GENERIC.has(key)) continue;
    index.set(key, r.slug);
    // Keep the first spelling seen that carries a capital -- that is how the
    // project writes its own name, and it is what the strict check compares to.
    if (!canonicalCase.has(key) && /[A-Z]/.test(r.alias)) canonicalCase.set(key, r.alias);
  }
  return { index, canonicalCase, curated };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Technologies named in a piece of text.
 *
 * Word boundaries are letter/digit-based rather than \b, because \b treats the
 * hyphen in "argo-cd" and the dot in "next.js" as boundaries and would match
 * their halves.
 */
export function detectStacks(
  rawText: string,
  vocab: StackVocabulary,
  opts: { max?: number } = {},
): string[] {
  if (!rawText) return [];
  const text = stripUrls(rawText);
  const haystack = text.toLowerCase();
  const found = new Set<string>();

  for (const [alias, slug] of vocab.index) {
    if (!haystack.includes(alias)) continue;

    const boundary = new RegExp(`(^|[^a-z0-9+#])${escapeRegex(alias)}([^a-z0-9+#]|$)`, 'i');
    if (!boundary.test(text)) continue;

    // An ordinary English word that a PERSON put in the vocabulary earns the
    // capitalised-form test -- Go and Rust are real technologies. The same word
    // arriving from a bulk import earns nothing: `support` and `first` are
    // genuine GitHub topics, and they tagged 331 stories between them before
    // this rule existed.
    if (isCommonWord(alias) && !vocab.curated.has(slug)) continue;

    // A one or two letter alias is hopeless without case whatever it is; beyond
    // that, only genuine English words need the capital.
    if (AMBIGUOUS.has(alias) || isCommonWord(alias)
        || (alias.length <= 2 && /^[a-z]+$/.test(alias))) {
      const written = vocab.canonicalCase.get(alias);
      const forms = [
        written,
        alias.replace(/\b\w/g, (c) => c.toUpperCase()),
        alias.toUpperCase(),
      ].filter((f): f is string => Boolean(f));
      const strict = forms.some((form) =>
        new RegExp(`(^|[^A-Za-z0-9+#])${escapeRegex(form)}([^A-Za-z0-9+#]|$)`).test(text));
      if (!strict) continue;
    }

    found.add(slug);
    if (opts.max && found.size >= opts.max) break;
  }

  return [...found];
}

/**
 * Tag a batch of stories.
 *
 * `stacks_tagged_at` is the progress marker, and it is not optional: a story
 * naming no technology stays eligible forever without one, so the pass re-reads
 * the same rows and reports zero every time. Company tagging learned this the
 * expensive way -- 500 rows examined, 0 tagged, three runs in a row.
 *
 * Tags are MERGED rather than replaced. The classifier's judgement about what a
 * story is about is worth more than a string match, and must not be overwritten
 * by one.
 */
export async function tagStacks(db: Db, limit = 500): Promise<TagStacksReport> {
  const vocab = await loadStackVocabulary(db);
  const report: TagStacksReport = { examined: 0, tagged: 0, added: 0 };

  const rows = await db.query<{
    id: string; collected_at: string; title: string; summary: string | null; stacks: string[];
  }>(
    `SELECT id::text, collected_at::text, coalesce(title_en, title_original) AS title,
            summary_en AS summary, stacks
       FROM stories
      WHERE superseded_by IS NULL AND stacks_tagged_at IS NULL
      ORDER BY collected_at DESC LIMIT $1`,
    [limit]);

  if (rows.length === 0) return report;
  report.examined = rows.length;

  const updates: { id: string; collected: string; stacks: string[] }[] = [];
  for (const row of rows) {
    const text = `${row.title} ${row.summary ?? ''}`;
    const detected = detectStacks(text, vocab, { max: 8 });
    const merged = [...new Set([...(row.stacks ?? []), ...detected])];
    if (detected.length > 0 && merged.length > (row.stacks ?? []).length) {
      updates.push({ id: row.id, collected: row.collected_at, stacks: merged });
      report.tagged++;
      report.added += merged.length - (row.stacks ?? []).length;
    }
  }

  // One statement for the whole batch, carrying the rows as JSON. Postgres
  // cannot unnest a two-dimensional text array into rows of arrays, and 500 per
  // row round trips is exactly the shape that made the collector twenty times
  // slower than it needed to be.
  if (updates.length > 0) {
    await db.query(
      `UPDATE stories s
          SET stacks = ARRAY(SELECT jsonb_array_elements_text(v.stacks))
         FROM (SELECT (e->>'id')::uuid AS id,
                      (e->>'at')::timestamptz AS collected_at,
                      e->'stacks' AS stacks
                 FROM jsonb_array_elements($1::jsonb) AS e) v
        WHERE s.id = v.id AND s.collected_at = v.collected_at`,
      [JSON.stringify(updates.map((u) => ({ id: u.id, at: u.collected, stacks: u.stacks })))],
    );
  }

  // Marked whether or not anything was found: "examined and found nothing" is a
  // result, and needs recording exactly as much as a hit does.
  await db.query(
    `UPDATE stories SET stacks_tagged_at = now() WHERE id = ANY($1::uuid[])`,
    [rows.map((r) => r.id)]);

  return report;
}

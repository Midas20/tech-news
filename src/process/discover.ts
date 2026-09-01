// Vocabulary discovery: the taxonomy proposes its own new entries.
//
// A hand-seeded stack list is wrong a little more every week. Every technology
// released after the seed was written is invisible to a system whose whole job
// is noticing new technologies, and "add it to seeds/stacks-extra.ts" is not a
// process that survives contact with a running archive.
//
// The closed vocabulary is not what gives way. Free-text tags fragment within a
// week and break per-user filtering silently. What changes is who closes it: a
// pass that proposes entries from evidence and promotes them when the evidence
// is strong enough. Closed at tagging time, open at the edges.
//
// No model is involved. The strongest signal here is free and exact:
//
//   github.com/{owner}/{repo}/releases/tag/v1.2.3
//
// A release note is a project announcing itself. If that repository is not in
// the vocabulary, either a technology is missing or its record lacks the repo
// URL -- and both are worth knowing. Titles are mined too, at lower confidence,
// which is what the pending queue is for.

import type { Db } from '../db/client.ts';
import { classify, type Kind } from '../vocab/kinds.ts';
import { loadTaxonomy, type Taxonomy } from './taxonomy.ts';

export interface DiscoveryReport {
  examined: number;
  proposed: number;
  updated: number;
  promoted: number;
  pending: number;
}

export interface Candidate {
  term: string;
  displayName: string;
  variants: string[];
  origin: 'github_release' | 'title' | 'repo_link';
  repoUrl?: string;
  releaseFeedUrl?: string;
  mentions: number;
  sources: number;
  stories: number;
  sampleUrls: string[];
  coStacks: string[];
}

// --- normalisation ------------------------------------------------------------

/**
 * Repository names carry decoration that is not part of the technology's name.
 * `nats-server`, `flux2`, `php-src` and `linkerd2` are NATS, Flux, PHP and
 * Linkerd -- so every stripped form is checked against the vocabulary before a
 * repository is called unknown. Without this the pass proposes a dozen entries
 * that already exist under their proper names.
 */
export function repoVariants(owner: string, repo: string): string[] {
  const out = new Set<string>([repo, owner]);
  const strip = [
    /-?(server|core|src|lang|js|cli|sdk|api|app|io|oss|community|main|monorepo)$/,
    /-?(spec|specification|standard|proposal|rfc)$/,
    /\d+$/,
  ];
  let base = repo;
  for (const rx of strip) {
    const next = base.replace(rx, '');
    if (next && next !== base) {
      out.add(next);
      base = next;
    }
  }
  out.add(repo.replace(/[-_]/g, ' '));
  out.add(repo.replace(/[-_]/g, ''));
  out.add(`${owner}/${repo}`);
  return [...out].filter((s) => s.length >= 2);
}

/** The key two spellings of one thing must share. */
export function normalizeTerm(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.+#-]/g, '')
    .replace(/^-+|-+$/g, '');
}

// --- title mining -------------------------------------------------------------

/**
 * Words that look like product names and are not.
 *
 * Precision matters far more than recall here: a wrong entry pollutes a closed
 * vocabulary permanently, while a missed one shows up again next week with more
 * evidence behind it.
 */
const TITLE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'new', 'now', 'has', 'have',
  'release', 'released', 'releases', 'version', 'update', 'updates', 'updated',
  'announcing', 'announce', 'announced', 'introducing', 'introduces', 'launch',
  'available', 'general', 'preview', 'beta', 'alpha', 'stable', 'support',
  'security', 'fix', 'fixes', 'fixed', 'bug', 'patch', 'changelog', 'notes',
  'api', 'apis', 'sdk', 'cli', 'ui', 'ux', 'os', 'ai', 'ml', 'llm', 'llms',
  'aws', 'gcp', 'cpu', 'gpu', 'ram', 'ssd', 'http', 'https', 'html', 'css',
  'json', 'yaml', 'xml', 'sql', 'url', 'urls', 'ide', 'pr', 'prs', 'ci', 'cd',
  'github', 'gitlab', 'blog', 'post', 'guide', 'how', 'why', 'what', 'when',
  'show', 'ask', 'hn', 'part', 'day', 'week', 'year', 'best', 'top', 'open',
  'source', 'free', 'more', 'less', 'better', 'faster', 'first', 'last', 'next',
  'using', 'build', 'building', 'built', 'make', 'making', 'made', 'writing',
  'written', 'read', 'reading', 'learn', 'learning', 'work', 'working', 'you',
  'your', 'our', 'their', 'its', 'was', 'were', 'been', 'will', 'can', 'could',
  'should', 'would', 'about', 'into', 'over', 'under', 'after', 'before',
  'inc', 'ltd', 'llc', 'gmbh', 'corp', 'team', 'teams', 'project', 'projects',
]);

/**
 * Tokens in a title that look like the name of a technology.
 *
 * Four shapes, all of which are conventions rather than guesses:
 *   OpenTofu     internal capital
 *   Next.js      dotted extension the ecosystem uses as part of the name
 *   DuckDB       a known technical suffix
 *   k9s / k3s    letter-digit-letter, the Kubernetes-adjacent naming habit
 */
export function candidateTerms(title: string): string[] {
  if (!title) return [];
  const cleaned = title.replace(/https?:\/\/\S+/g, ' ');
  const out = new Set<string>();

  for (const raw of cleaned.split(/[\s,;:!?()[\]{}"'“”‘’|]+/)) {
    const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.+#]+$/g, '');
    if (token.length < 3 || token.length > 28) continue;
    if (TITLE_STOPWORDS.has(token.toLowerCase())) continue;
    if (/^\d/.test(token)) continue;              // versions, dates, counts
    if (/^v\d/i.test(token)) continue;

    const internalCapital = /^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$/.test(token);
    const dotted = /^[A-Za-z][A-Za-z0-9-]*\.(js|ts|io|sh|dev|ai|rs|py|go)$/i.test(token);
    const suffix = /^[A-Za-z][A-Za-z0-9-]*(DB|QL|SQL|Kit|Lang|Script|Stack|Hub|Flow)$/.test(token);
    const shortAlnum = /^[a-z]\d[a-z]{1,4}$/.test(token);

    if (internalCapital || dotted || suffix || shortAlnum) out.add(token);
  }
  return [...out];
}

// --- the pass -----------------------------------------------------------------

interface ReleaseRow {
  owner: string;
  repo: string;
  n: string;
  sources: string;
  sample: string[];
  co_stacks: string[];
}

/**
 * Repositories that publish releases into the archive but are not in the
 * vocabulary under any name.
 */
async function fromReleases(db: Db, taxonomy: Taxonomy): Promise<Candidate[]> {
  // Unnest the tags in their own CTE. array_agg over a text[] column yields a
  // two-dimensional array, which unnest flattens rather than iterating -- and
  // refuses outright when the rows have different lengths.
  const rows = await db.query<ReleaseRow>(
    `WITH rel AS (
       SELECT lower(split_part(split_part(s.canonical_url, 'github.com/', 2), '/', 1)) AS owner,
              lower(split_part(split_part(s.canonical_url, 'github.com/', 2), '/', 2)) AS repo,
              s.source_id, s.canonical_url, s.collected_at, s.stacks
         FROM stories s
        WHERE s.superseded_by IS NULL
          AND s.canonical_url ~ 'github\.com/[^/]+/[^/]+/releases'
     ),
     co AS (
       SELECT owner, repo, array_agg(DISTINCT x) AS co_stacks
         FROM rel, LATERAL unnest(rel.stacks) AS x
        GROUP BY owner, repo
     )
     SELECT r.owner, r.repo,
            count(*)::text AS n,
            count(DISTINCT r.source_id)::text AS sources,
            (array_agg(r.canonical_url ORDER BY r.collected_at DESC))[1:3] AS sample,
            coalesce(co.co_stacks, '{}') AS co_stacks
       FROM rel r
       LEFT JOIN co ON co.owner = r.owner AND co.repo = r.repo
      GROUP BY r.owner, r.repo, co.co_stacks
      ORDER BY count(*) DESC
      LIMIT 400`);

  // A repo already named by a stack record is not a discovery, whatever it is
  // called: match on the URL first, because that is the unambiguous key.
  const known = await db.query<{ repo_url: string }>(
    `SELECT lower(repo_url) AS repo_url FROM stacks WHERE repo_url IS NOT NULL`);
  const knownRepos = new Set(known.map((k) => k.repo_url.replace(/^https?:\/\/(www\.)?github\.com\//, '')));

  const out: Candidate[] = [];
  for (const r of rows) {
    if (!r.owner || !r.repo) continue;
    if (knownRepos.has(`${r.owner}/${r.repo}`)) continue;
    if (repoVariants(r.owner, r.repo).some((v) => taxonomy.resolve(v))) continue;

    out.push({
      term: normalizeTerm(r.repo),
      displayName: prettyRepoName(r.repo),
      variants: [r.repo, `${r.owner}/${r.repo}`],
      origin: 'github_release',
      repoUrl: `https://github.com/${r.owner}/${r.repo}`,
      releaseFeedUrl: `https://github.com/${r.owner}/${r.repo}/releases.atom`,
      mentions: Number(r.n),
      sources: Number(r.sources),
      stories: Number(r.n),
      sampleUrls: r.sample ?? [],
      coStacks: (r.co_stacks ?? []).slice(0, 8),
    });
  }
  return out;
}

function prettyRepoName(repo: string): string {
  return repo
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (/^[a-z]/.test(part) ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ');
}

/**
 * Names the queue should never carry: the outlets doing the writing, and the
 * companies being written about. Both are tracked elsewhere in this system, and
 * neither is a technology.
 */
async function excludedNames(db: Db): Promise<Set<string>> {
  const [sources, companies] = await Promise.all([
    db.query<{ name: string; url: string }>(`SELECT name, url FROM sources`),
    db.query<{ alias: string }>(`SELECT alias FROM company_alias_lookup`).catch(() => []),
  ]);

  const out = new Set<string>();
  for (const c of companies) out.add(normalizeTerm(c.alias));
  for (const s of sources) {
    out.add(normalizeTerm(s.name));
    // The domain too: "servethehome" is how ServeTheHome appears in a headline.
    try {
      const host = new URL(s.url).hostname.replace(/^www\./, '');
      out.add(normalizeTerm(host.split('.')[0] ?? ''));
      out.add(normalizeTerm(host.replace(/\.[a-z.]+$/, '')));
    } catch { /* a source with an unparseable URL contributes nothing */ }
  }
  out.delete('');
  return out;
}

/** Product-shaped words in recent titles that the vocabulary does not know. */
async function fromTitles(db: Db, taxonomy: Taxonomy, days: number): Promise<Candidate[]> {
  const excluded = await excludedNames(db);
  const rows = await db.query<{
    title: string; url: string; source_id: string; stacks: string[];
  }>(
    `SELECT coalesce(s.title_en, s.title_original) AS title, s.canonical_url AS url,
            s.source_id::text, s.stacks
       FROM stories s
      WHERE s.superseded_by IS NULL
        AND (s.lang = 'en' OR s.title_en IS NOT NULL)
        AND s.collected_at > now() - ($1 || ' days')::interval
      LIMIT 4000`,
    [String(days)]);

  interface Acc {
    displayName: string;
    variants: Set<string>;
    stories: number;
    sources: Set<string>;
    sampleUrls: string[];
    coStacks: Set<string>;
  }
  const acc = new Map<string, Acc>();

  for (const row of rows) {
    for (const token of candidateTerms(row.title)) {
      if (taxonomy.resolve(token)) continue;
      const key = normalizeTerm(token);
      if (!key || key.length < 3) continue;
      if (excluded.has(key)) continue;

      const entry = acc.get(key) ?? {
        displayName: token, variants: new Set<string>(), stories: 0,
        sources: new Set<string>(), sampleUrls: [], coStacks: new Set<string>(),
      };
      entry.variants.add(token);
      entry.stories++;
      entry.sources.add(row.source_id);
      if (entry.sampleUrls.length < 3) entry.sampleUrls.push(row.url);
      for (const s of row.stacks ?? []) entry.coStacks.add(s);
      acc.set(key, entry);
    }
  }

  return [...acc].map(([term, e]): Candidate => ({
    term,
    displayName: e.displayName,
    variants: [...e.variants],
    origin: 'title',
    mentions: e.stories,
    sources: e.sources.size,
    stories: e.stories,
    sampleUrls: e.sampleUrls,
    coStacks: [...e.coStacks].slice(0, 8),
  }));
}

async function upsert(db: Db, c: Candidate): Promise<'new' | 'updated'> {
  const rows = await db.query<{ inserted: boolean }>(
    `INSERT INTO stack_candidates
       (term, display_name, variants, origin, repo_url, release_feed_url,
        mention_count, distinct_sources, distinct_stories, sample_urls, co_stacks)
     VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8, $9, $10::text[], $11::text[])
     ON CONFLICT (term) DO UPDATE SET
       mention_count = EXCLUDED.mention_count,
       distinct_sources = EXCLUDED.distinct_sources,
       distinct_stories = EXCLUDED.distinct_stories,
       variants = (SELECT array_agg(DISTINCT x)
                     FROM unnest(stack_candidates.variants || EXCLUDED.variants) AS x),
       co_stacks = EXCLUDED.co_stacks,
       sample_urls = EXCLUDED.sample_urls,
       repo_url = coalesce(stack_candidates.repo_url, EXCLUDED.repo_url),
       release_feed_url = coalesce(stack_candidates.release_feed_url, EXCLUDED.release_feed_url),
       last_seen_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [c.term, c.displayName, c.variants, c.origin, c.repoUrl ?? null, c.releaseFeedUrl ?? null,
      c.mentions, c.sources, c.stories, c.sampleUrls, c.coStacks]);
  return rows[0]?.inserted ? 'new' : 'updated';
}

/**
 * Is the evidence strong enough to close the vocabulary around this?
 *
 * Only one kind of evidence is: a repository publishing its own releases under
 * its own name. That is a primary source -- the project saying what it is called
 * -- so one release is enough.
 *
 * A word in a headline is not, at any frequency, and the first run proved it.
 * The most-repeated title candidates were `servethehome`, `techcrunch`,
 * `spacex`, `youtube` and `linkedin`: publishers, a rocket company and consumer
 * brands, every one of them clearing a "four mentions across two sources" bar
 * that sounded reasonable when it was written. Frequency measures how often
 * something is written down, not whether it is a technology.
 *
 * So title candidates are never promoted automatically. They queue, with their
 * evidence attached, and a person accepts or rejects them in one click. Recall
 * costs a click; a wrong entry in a closed vocabulary is permanent and silently
 * mis-tags everything it matches.
 */
export function shouldPromote(c: { origin: string; mentions: number; sources: number }): boolean {
  return c.origin === 'github_release' && c.mentions >= 1;
}

/**
 * Category and parent, inferred from company the term keeps.
 *
 * Whatever else is tagged on the same stories is the best free evidence of where
 * a new entry belongs, and it is exactly how a person would guess. When there is
 * no such evidence the entry is filed as tooling with no parent, which is honest
 * about knowing nothing rather than inventing a position in the tree.
 */
async function inferPlacement(
  db: Db, coStacks: string[], origin: string,
): Promise<{ category: string; parentSlug: string | null }> {
  if (coStacks.length === 0) {
    return { category: origin === 'github_release' ? 'library' : 'tooling', parentSlug: null };
  }

  const rows = await db.query<{ category: string; parent: string | null; n: string }>(
    `SELECT st.category, p.slug AS parent, count(*)::text AS n
       FROM stacks st LEFT JOIN stacks p ON p.id = st.parent_id
      WHERE st.slug = ANY($1::text[])
      GROUP BY st.category, p.slug
      ORDER BY count(*) DESC LIMIT 1`,
    [coStacks]);
  const best = rows[0];
  return {
    category: best?.category ?? 'tooling',
    parentSlug: best?.parent ?? null,
  };
}

/**
 * Which registry a newly promoted entry lands in.
 *
 * A candidate has no description yet -- it is a name the archive kept repeating
 * -- so the classifier has only the name and the inferred category to read, and
 * it will often return `concept` for want of a signal. That is the right answer
 * to give: an unplaced entry sitting among the concepts is a shrug, whereas the
 * same entry listed as something you can build on would be a claim. A repository
 * publishing its own releases is the one case with real evidence behind it, and
 * a thing that cuts releases is a thing you depend on.
 */
function kindFor(slug: string, name: string, category: string, origin: string): Kind {
  if (origin === 'github_release') return 'stack';
  return classify({ slug, name, category, curated: false }).kind;
}

/** A slug nothing else is using. */
async function freeSlug(db: Db, base: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 20; i++) {
    const taken = await db.query(`SELECT 1 FROM stacks WHERE slug = $1`, [slug]);
    if (taken.length === 0) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

export async function promoteCandidates(db: Db, limit = 40): Promise<number> {
  const pending = await db.query<{
    id: string; term: string; display_name: string; variants: string[];
    origin: string; repo_url: string | null; release_feed_url: string | null;
    mention_count: number; distinct_sources: number; co_stacks: string[];
  }>(
    `SELECT id::text, term, display_name, variants, origin, repo_url, release_feed_url,
            mention_count, distinct_sources, co_stacks
       FROM stack_candidates
      WHERE status = 'pending'
      ORDER BY mention_count DESC LIMIT $1`,
    [limit]);

  const taxonomy = await loadTaxonomy(db);
  let promoted = 0;

  for (const c of pending) {
    if (!shouldPromote({
      origin: c.origin, mentions: c.mention_count, sources: c.distinct_sources,
    })) continue;
    // The vocabulary may have gained this term since the candidate was raised.
    const existing = taxonomy.resolve(c.term) ?? c.variants.map((v) => taxonomy.resolve(v)).find(Boolean);
    if (existing) {
      await db.query(
        `UPDATE stack_candidates SET status = 'rejected', evaluated_at = now(),
                reason = $2, promoted_slug = $3 WHERE id = $1::uuid`,
        [c.id, 'already in the vocabulary', existing]);
      continue;
    }

    const { category, parentSlug } = await inferPlacement(db, c.co_stacks, c.origin);
    const slug = await freeSlug(db, c.term);
    const aliases = [...new Set(c.variants.map((v) => v.trim()).filter((v) => v && v !== slug))];

    await db.query(
      `INSERT INTO stacks (slug, name, parent_id, aliases, category, kind,
                           repo_url, release_feed_url, curated, origin, discovered_at)
       VALUES ($1, $2, (SELECT id FROM stacks WHERE slug = $3), $4::text[], $5, $6, $7, $8,
               false, $9, now())`,
      [slug, c.display_name, parentSlug, aliases, category,
        kindFor(slug, c.display_name, category, c.origin),
        c.repo_url, c.release_feed_url, c.origin]);

    await db.query(
      `UPDATE stack_candidates SET status = 'promoted', evaluated_at = now(),
              promoted_slug = $2, reason = $3 WHERE id = $1::uuid`,
      [c.id, slug,
        c.origin === 'github_release'
          ? 'publishes releases under its own repository'
          : `named in ${c.mention_count} stories across ${c.distinct_sources} sources`]);

    // Stories already in the archive mentioning it must be re-examined, or a new
    // entry arrives reading "never seen" while its evidence sits right there.
    await db.query(
      `UPDATE stories SET stacks_tagged_at = NULL
        WHERE superseded_by IS NULL AND collected_at > now() - interval '120 days'`);

    promoted++;
  }

  return promoted;
}

/**
 * Accept a queued candidate by hand.
 *
 * The same placement inference as an automatic promotion -- what differs is only
 * where the confidence came from, so the resulting record is identical and is
 * still marked as discovered rather than curated.
 */
export async function promoteCandidate(db: Db, term: string): Promise<string | null> {
  const rows = await db.query<{
    id: string; term: string; display_name: string; variants: string[];
    origin: string; repo_url: string | null; release_feed_url: string | null;
    mention_count: number; distinct_sources: number; co_stacks: string[];
  }>(
    `SELECT id::text, term, display_name, variants, origin, repo_url, release_feed_url,
            mention_count, distinct_sources, co_stacks
       FROM stack_candidates WHERE term = $1 AND status = 'pending'`, [term]);
  const c = rows[0];
  if (!c) return null;

  const taxonomy = await loadTaxonomy(db);
  const existing = taxonomy.resolve(c.term) ?? c.variants.map((v) => taxonomy.resolve(v)).find(Boolean);
  if (existing) {
    await db.query(
      `UPDATE stack_candidates SET status = 'rejected', evaluated_at = now(),
              reason = 'already in the vocabulary', promoted_slug = $2 WHERE id = $1::uuid`,
      [c.id, existing]);
    return existing;
  }

  const { category, parentSlug } = await inferPlacement(db, c.co_stacks, c.origin);
  const slug = await freeSlug(db, c.term);
  const aliases = [...new Set(c.variants.map((v) => v.trim()).filter((v) => v && v !== slug))];

  await db.query(
    `INSERT INTO stacks (slug, name, parent_id, aliases, category, kind,
                         repo_url, release_feed_url, curated, origin, discovered_at)
     VALUES ($1, $2, (SELECT id FROM stacks WHERE slug = $3), $4::text[], $5, $6, $7, $8,
             false, $9, now())`,
    [slug, c.display_name, parentSlug, aliases, category,
      kindFor(slug, c.display_name, category, c.origin),
      c.repo_url, c.release_feed_url, c.origin]);

  await db.query(
    `UPDATE stack_candidates SET status = 'promoted', evaluated_at = now(),
            promoted_slug = $2, reason = 'accepted from the queue' WHERE id = $1::uuid`,
    [c.id, slug]);

  // The archive has to be re-examined, or the new entry reads "never seen" while
  // the evidence for it is sitting right there.
  await db.query(
    `UPDATE stories SET stacks_tagged_at = NULL
      WHERE superseded_by IS NULL AND collected_at > now() - interval '120 days'`);

  return slug;
}

/** Turn a candidate down. It stays on the record, so it is not re-proposed. */
export async function rejectCandidate(db: Db, term: string, reason = 'not a technology'): Promise<boolean> {
  const rows = await db.query<{ term: string }>(
    `UPDATE stack_candidates SET status = 'rejected', evaluated_at = now(), reason = $2
      WHERE term = $1 AND status = 'pending' RETURNING term`, [term, reason]);
  return rows.length > 0;
}

export async function discoverStacks(
  db: Db, opts: { days?: number; promote?: boolean } = {},
): Promise<DiscoveryReport> {
  const taxonomy = await loadTaxonomy(db);
  const report: DiscoveryReport = { examined: 0, proposed: 0, updated: 0, promoted: 0, pending: 0 };

  const candidates = [
    ...await fromReleases(db, taxonomy),
    ...await fromTitles(db, taxonomy, opts.days ?? 45),
  ];
  report.examined = candidates.length;

  // The strongest evidence for a term wins when both passes raise it.
  const best = new Map<string, Candidate>();
  for (const c of candidates) {
    const prior = best.get(c.term);
    if (!prior || (prior.origin !== 'github_release' && c.origin === 'github_release')) {
      best.set(c.term, c);
    }
  }

  for (const c of best.values()) {
    // A single mention of a word in one headline is not evidence of anything.
    if (c.origin === 'title' && c.mentions < 2) continue;
    const outcome = await upsert(db, c);
    if (outcome === 'new') report.proposed++;
    else report.updated++;
  }

  if (opts.promote !== false) report.promoted = await promoteCandidates(db);

  const counted = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM stack_candidates WHERE status = 'pending'`);
  report.pending = Number(counted[0]?.n ?? 0);

  return report;
}

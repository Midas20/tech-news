// Vocabulary sources.
//
// Each function fetches one public list and returns entries in one shape, so the
// import script does not care where a name came from. Three are worth having and
// each answers a different question:
//
//   linguist   what IS a programming language, authoritatively, with its aliases
//   cncf       what the cloud native infrastructure landscape contains, with
//              categories already assigned
//   synonyms   how people actually misspell and abbreviate things
//
// The third is the valuable one and the least replaceable. Stack Overflow's tag
// synonyms are a hand-curated alias mapping maintained by people who watched the
// mistakes happen -- 5,329 of them -- which is exactly what a closed vocabulary
// needs and exactly what cannot be derived from a repository list.

export interface VocabEntry {
  slug: string;
  name: string;
  aliases: string[];
  category: string;
  description: string | null;
  homepage: string | null;
  repo: string | null;
  origin: 'linguist' | 'cncf' | 'libraries_io';
}

import { githubHeaders } from './keys.ts';

const UA = 'NewsTrack/0.1 (vocabulary import)';

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\+\+/g, 'pp')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function text(url: string): Promise<string> {
  // raw.githubusercontent.com counts against the same per-IP allowance as the
  // API, so a token that is already in the environment may as well be used.
  const github = /(^|\.)githubusercontent\.com|(^|\.)github\.com/.test(new URL(url).hostname);
  const headers: Record<string, string> = github
    ? { ...(githubHeaders() as Record<string, string>), accept: 'text/plain' }
    : { 'user-agent': UA };
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

// --- Linguist -----------------------------------------------------------------

/**
 * GitHub's language list, which is the closest thing to an authority on what
 * counts as a programming language -- it is what every language bar on every
 * repository is computed from.
 *
 * The file is a flat YAML map of `Name:` to indented scalars and lists. Parsing
 * only the keys this needs is a dozen lines; a YAML dependency to read four
 * fields would be the larger risk.
 */
export async function fromLinguist(): Promise<VocabEntry[]> {
  const raw = await text(
    'https://raw.githubusercontent.com/github-linguist/linguist/master/lib/linguist/languages.yml');

  const out: VocabEntry[] = [];
  let current: { name: string; type: string; aliases: string[]; url: string | null } | null = null;
  let inAliases = false;

  const flush = () => {
    if (!current) return;
    // Data and prose formats are not technologies anyone follows news about.
    if (current.type === 'programming' || current.type === 'markup') {
      out.push({
        slug: slugify(current.name),
        name: current.name,
        aliases: [...new Set(current.aliases)],
        category: 'language',
        description: null,
        homepage: current.url,
        repo: null,
        origin: 'linguist',
      });
    }
    current = null;
  };

  for (const line of raw.split(/\r?\n/)) {
    if (/^[^\s#][^:]*:\s*$/.test(line)) {
      flush();
      current = { name: line.replace(/:\s*$/, '').trim(), type: '', aliases: [], url: null };
      inAliases = false;
      continue;
    }
    if (!current) continue;

    const type = /^\s{2}type:\s*(\S+)/.exec(line);
    if (type) { current.type = type[1]!; inAliases = false; continue; }

    const url = /^\s{2}(?:language_id|url):\s*(\S+)/.exec(line);
    if (url && line.includes('url:')) { current.url = url[1]!; inAliases = false; continue; }

    if (/^\s{2}aliases:\s*$/.test(line)) { inAliases = true; continue; }
    if (inAliases) {
      const item = /^\s{2,}-\s+(.+)$/.exec(line);
      if (item) { current.aliases.push(item[1]!.trim()); continue; }
      inAliases = false;
    }
  }
  flush();

  return out;
}

// --- CNCF ---------------------------------------------------------------------

/** CNCF's own grouping mapped onto the nineteen categories this system uses. */
const CNCF_CATEGORY: [RegExp, string][] = [
  [/database|storage/i, 'db'],
  [/streaming|messaging/i, 'data'],
  [/observability|analysis/i, 'devops'],
  [/security|compliance/i, 'security'],
  [/ci\/cd|automation|configuration|application definition/i, 'devops'],
  [/serverless|platform|cloud/i, 'cloud'],
  [/machine learning|ml/i, 'ai'],
];

/**
 * The cloud native landscape, which arrives already categorised -- the cleanest
 * single source for the infrastructure branch, and the one place a maturity
 * level (sandbox, incubating, graduated) is stated rather than inferred.
 *
 * Read with a small indentation-aware scan rather than a YAML parser: the file
 * is 200KB of a fixed three-level shape, and only five keys per item matter.
 */
export async function fromCncf(opts: { projectsOnly?: boolean } = {}): Promise<VocabEntry[]> {
  // The landscape is 2,414 items and only 255 of them are CNCF PROJECTS; the
  // rest are member companies and commercial products. Companies are a separate
  // registry here and a vendor's product page is not a technology, so importing
  // the lot would add two thousand entries that will never appear in a story.
  const projectsOnly = opts.projectsOnly ?? true;
  const raw = await text('https://raw.githubusercontent.com/cncf/landscape/master/landscape.yml');

  const out: VocabEntry[] = [];
  let category = '';
  let subcategory = '';
  let item: Partial<VocabEntry> & { project?: string } | null = null;

  const flush = () => {
    if (item?.name && (!projectsOnly || item.project)) {
      const bucket = CNCF_CATEGORY.find(([rx]) => rx.test(`${category} ${subcategory}`))?.[1] ?? 'infra';
      out.push({
        slug: slugify(item.name),
        name: item.name,
        aliases: [],
        category: bucket,
        description: item.project
          ? `CNCF ${item.project} project — ${subcategory || category}.`
          : (subcategory || category ? `${subcategory || category}.` : null),
        homepage: item.homepage ?? null,
        repo: item.repo ?? null,
        origin: 'cncf',
      });
    }
    item = null;
  };

  for (const line of raw.split(/\r?\n/)) {
    const cat = /^\s{4}name:\s*(.+)$/.exec(line);
    const sub = /^\s{8}name:\s*(.+)$/.exec(line);
    const name = /^\s{12}name:\s*(.+)$/.exec(line);

    if (/^\s*-\s*category:\s*$/.test(line)) { flush(); category = ''; subcategory = ''; continue; }
    if (/^\s*-\s*subcategory:\s*$/.test(line)) { flush(); subcategory = ''; continue; }
    if (/^\s*-\s*item:\s*$/.test(line)) { flush(); item = {}; continue; }

    if (cat && !item) { category = cat[1]!.trim(); continue; }
    if (sub && !item) { subcategory = sub[1]!.trim(); continue; }
    if (name && item) { item.name = name[1]!.trim().replace(/^["']|["']$/g, ''); continue; }

    if (item) {
      const home = /^\s{12}homepage_url:\s*(\S+)/.exec(line);
      if (home) { item.homepage = home[1]!; continue; }
      const repo = /^\s{12}repo_url:\s*(\S+)/.exec(line);
      if (repo) { item.repo = repo[1]!; continue; }
      const project = /^\s{12}project:\s*(\S+)/.exec(line);
      if (project) { item.project = project[1]!; continue; }
    }
  }
  flush();

  return out;
}

// --- Stack Overflow tag synonyms ----------------------------------------------

export interface Synonym {
  from: string;
  to: string;
  applied: number;
}

/**
 * The alias mapping, paginated.
 *
 * There are 5,329 synonyms and two separate limits, not one. The daily quota is
 * 300 requests unauthenticated, which is ample -- but page 26 returns
 * `access_denied` whatever the quota says, so without an app key the ceiling is
 * 2,500 synonyms rather than all of them.
 *
 * That is why this sorts by `applied` descending: if only half can be had, the
 * half worth having is the half people actually use. `react -> reactjs` has been
 * applied 99,800 times; the tail is single-digit.
 *
 * Set STACKEXCHANGE_KEY (free, from stackapps.com) to lift the page ceiling.
 * `backoff` in a response is an instruction, not a suggestion.
 *
 * Stack Exchange content is CC BY-SA 4.0, which requires attribution. That is
 * why the footer of every page says so.
 */
export async function fromStackOverflowSynonyms(
  opts: { maxPages?: number; key?: string } = {},
): Promise<{ synonyms: Synonym[]; quotaRemaining: number | null; truncated: boolean }> {
  const out: Synonym[] = [];
  let quotaRemaining: number | null = null;
  const maxPages = opts.maxPages ?? 60;

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL('https://api.stackexchange.com/2.3/tags/synonyms');
    url.searchParams.set('site', 'stackoverflow');
    url.searchParams.set('pagesize', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('order', 'desc');
    url.searchParams.set('sort', 'applied');
    if (opts.key) url.searchParams.set('key', opts.key);

    const res = await fetch(url, { headers: { 'user-agent': UA } });
    const body = await res.json() as {
      items?: { from_tag: string; to_tag: string; applied_count: number }[];
      has_more?: boolean;
      quota_remaining?: number;
      backoff?: number;
      error_message?: string;
    };

    if (!res.ok) {
      // Hitting the unauthenticated page ceiling is an expected stop, not a
      // failure: what has been collected is the most-applied part of the list.
      if (body.error_message?.includes('page above')) {
        return { synonyms: out, quotaRemaining, truncated: true };
      }
      throw new Error(`stackexchange: HTTP ${res.status}${
        body.error_message ? ` — ${body.error_message}` : ''}`);
    }

    for (const i of body.items ?? []) {
      out.push({ from: i.from_tag, to: i.to_tag, applied: i.applied_count });
    }
    quotaRemaining = body.quota_remaining ?? quotaRemaining;

    if (!body.has_more) break;
    // The API says when to wait. Ignoring it is how an IP gets blocked.
    if (body.backoff) await new Promise((r) => setTimeout(r, body.backoff! * 1000));
    if (quotaRemaining !== null && quotaRemaining < 20) break;
  }

  return { synonyms: out, quotaRemaining, truncated: false };
}

// --- Libraries.io ---------------------------------------------------------------

/**
 * Packages ranked by how much depends on them.
 *
 * This is the one source that measures USE rather than fame: a library with
 * 40,000 dependent repositories is load-bearing whether or not anybody writes
 * about it, and that is a different signal from a GitHub topic page or a star
 * count.
 *
 * Requires a key, and returns nothing without one rather than pretending. The
 * platform is passed in because "the top packages" means something different on
 * npm than on Maven, and importing all of them would drown the vocabulary in
 * transitive utility packages.
 */
export async function fromLibrariesIo(opts: {
  key?: string;
  platforms?: string[];
  perPlatform?: number;
}): Promise<VocabEntry[]> {
  const key = opts.key?.trim();
  if (!key) return [];

  const platforms = opts.platforms ?? ['NPM', 'Pypi', 'Maven', 'Go', 'Cargo', 'NuGet', 'Packagist'];
  const perPlatform = opts.perPlatform ?? 100;
  const out: VocabEntry[] = [];

  for (const platform of platforms) {
    for (let page = 1; page * 100 <= perPlatform + 99; page++) {
      const url = new URL('https://libraries.io/api/search');
      url.searchParams.set('q', '');
      url.searchParams.set('platforms', platform);
      url.searchParams.set('sort', 'dependent_repos_count');
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      url.searchParams.set('api_key', key);

      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (res.status === 429) break;                  // rate limited: take what we have
      if (!res.ok) throw new Error(`libraries.io: HTTP ${res.status}`);

      const items = await res.json() as {
        name: string; description: string | null; homepage: string | null;
        repository_url: string | null; platform: string; dependent_repos_count: number;
      }[];
      if (items.length === 0) break;

      for (const i of items) {
        if (!i.name) continue;
        out.push({
          slug: slugify(i.name),
          name: i.name,
          aliases: [],
          category: 'library',
          description: i.description?.replace(/\s+/g, ' ').trim() || null,
          homepage: i.homepage,
          repo: i.repository_url,
          origin: 'libraries_io',
        });
      }
      // One request per second is the documented courtesy for this API.
      await new Promise((r) => setTimeout(r, 1100));
    }
  }

  return out;
}

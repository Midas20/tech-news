// Deciding whether a name is a newcomer, and whether it is a name at all.
//
// The extractor returns whatever it read in a story. Most of that is not what
// this ledger is for: a story about a Kubernetes CVE names Kubernetes, Red Hat,
// CVSS and Linux, none of which are new to anybody. What is left after the
// filtering below is the interesting residue -- names the taxonomy does not
// have, attached to a claim about what they do.
//
// Everything here is a pure function so the rules can be argued with in a test
// rather than discovered in production.

/**
 * Fold a written name to the form the taxonomy uses.
 *
 * `stacks.slug` is lowercase and hyphenated, so this has to produce exactly
 * that or the known-name check silently fails open and every incumbent is
 * reported as a discovery. Diacritics are stripped for the same reason: a
 * source writing "Café" and another writing "Cafe" must land on one row.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    // The combining marks NFKD just split off. Written as escapes rather than
    // as literal characters, which are invisible in an editor and get eaten by
    // the next tool that touches the file.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Version suffixes are not part of the identity. "aic-agent 1.0.2" and
    // "aic-agent 1.1.0" are the same tool, and a ledger that treats them as two
    // rows reports the second release as a brand new market.
    .replace(/\s+v?\d+(\.\d+)*([-.][a-z0-9]+)*\s*$/, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Names that are not products, however confidently a model returns them.
 *
 * Three groups, and each one was a real false positive in the first pass over
 * the archive:
 *
 *   the generic       "AI", "API", "Cloud", "Open Source" -- categories, not
 *                     entrants. A market cannot be new if it is the name of the
 *                     field the story is filed under.
 *   the infrastructure of news   "GitHub", "Reddit", "Hacker News", "arXiv" --
 *                     named in half the archive because that is where things
 *                     get published, not because they are the subject.
 *   the units and standards      "CVE", "CVSS", "HTTP", "JSON" -- referenced
 *                     constantly, invented decades ago.
 */
export const NOT_A_PRODUCT = new Set([
  // categories the reader already has a tab for
  'ai', 'artificial-intelligence', 'ml', 'machine-learning', 'llm', 'llms',
  'genai', 'generative-ai', 'agent', 'agents', 'agentic-ai', 'api', 'apis',
  'sdk', 'cli', 'ide', 'os', 'cloud', 'open-source', 'opensource', 'saas',
  'devops', 'security', 'database', 'databases', 'framework', 'library',
  'platform', 'model', 'models', 'tool', 'tools', 'startup', 'enterprise',
  'internet', 'web', 'software', 'hardware', 'data', 'analytics', 'blockchain',
  'crypto', 'quantum-computing', 'cybersecurity', 'infrastructure',
  // where things get published
  'github', 'gitlab', 'reddit', 'hacker-news', 'hackernews', 'arxiv', 'x',
  'twitter', 'linkedin', 'youtube', 'discord', 'slack', 'medium', 'substack',
  'stack-overflow', 'stackoverflow', 'product-hunt', 'producthunt', 'npm',
  'pypi', 'crates-io', 'docker-hub', 'maven-central', 'the-register',
  'techcrunch', 'ars-technica', 'infoq', 'zdnet', 'venturebeat', 'wired',
  // standards, formats and vocabulary older than the archive
  'cve', 'cvss', 'nvd', 'http', 'https', 'tcp', 'ip', 'dns', 'tls', 'ssl',
  'json', 'yaml', 'xml', 'csv', 'html', 'css', 'sql', 'rss', 'utf-8', 'ascii',
  'oauth', 'saml', 'jwt', 'rest', 'grpc', 'graphql', 'gpl', 'mit', 'apache-2-0',
  'usb', 'pcie', 'arm', 'x86', 'risc-v', 'gpu', 'cpu', 'tpu', 'ram', 'ssd',
]);

/**
 * The kinds worth a row.
 *
 * `company` is included and `person` is not. A company nobody has heard of
 * entering a space IS the market appearing; a person is a byline.
 */
export type EmergingKind =
  | 'tool' | 'platform' | 'model' | 'company' | 'standard' | 'format';

export const KINDS: readonly EmergingKind[] =
  ['tool', 'platform', 'model', 'company', 'standard', 'format'] as const;

export function isKind(value: string): value is EmergingKind {
  return (KINDS as readonly string[]).includes(value);
}

export interface Candidate {
  name: string;
  kind: string;
  what?: string | null;
}

export interface Newcomer {
  slug: string;
  name: string;
  kind: EmergingKind;
  what: string | null;
}

/**
 * How short a name may be before it is probably an abbreviation of something
 * that is not a product. Two characters admits "Go" and "R", which are real,
 * and also admits every stray capital in a headline -- so those two live in the
 * known taxonomy already and anything this short that is NOT known is dropped.
 */
const MIN_UNKNOWN_NAME = 3;

/**
 * Everything a story named that the taxonomy does not already have.
 *
 * `known` is the full set of slugs and aliases from `stacks`, passed in rather
 * than queried here so this stays pure and so one database read serves a whole
 * batch.
 *
 * A name that IS known is not an error and not interesting -- it is the
 * ordinary case, and the caller drops it silently.
 */
export function newcomers(candidates: Candidate[], known: Set<string>): Newcomer[] {
  const out = new Map<string, Newcomer>();

  for (const candidate of candidates) {
    const name = (candidate.name ?? '').trim();
    if (!name) continue;

    const slug = slugify(name);
    if (!slug) continue;
    if (known.has(slug)) continue;
    if (NOT_A_PRODUCT.has(slug)) continue;
    if (slug.length < MIN_UNKNOWN_NAME) continue;

    // A name that is only digits, or only a version, is a fragment of a
    // sentence rather than a thing: "2026", "3-5", "v2".
    if (/^[\d-]+$/.test(slug)) continue;

    if (!isKind(candidate.kind)) continue;

    // A claim about what it does is what separates a market from a name. A
    // model that cannot say what Booley is has not understood the story well
    // enough for the row to be worth writing.
    const what = (candidate.what ?? '').trim();
    if (!what) continue;

    // First spelling wins: the extractor returns them in the order they appear,
    // and the first mention in a story is usually the full, correct name.
    if (!out.has(slug)) {
      out.set(slug, { slug, name, kind: candidate.kind, what });
    }
  }

  return [...out.values()];
}

/**
 * THE EVIDENCE GATE, and the one rule this whole file exists to enforce.
 *
 * A gate, never an ordering. It decides what is worth showing a reader; it
 * never decides what comes first. Our counts measure the feed list and not the
 * industry, and ranking markets by them is the exact mistake the content-v2
 * rewrite was written to end.
 *
 * WHY IT IS NOT "TWO INDEPENDENT SOURCES", WHICH IS WHAT IT WAS FIRST.
 *
 * Measured on this archive on 2026-09-09, before shipping it:
 *
 *   PRIMARY_VENDOR         3,404 stories    not independent
 *   PRIMARY_PROJECT          228            not independent
 *   (unclassified)           180            not independent
 *   PRIMARY_RESEARCH         178            not independent
 *   TECHNICAL_JOURNALISM      15            independent
 *   SPECIALIST_PUBLICATION    14            independent
 *
 * Twenty-nine stories out of four thousand come from a source type that
 * corroborates. That is not an accident to be fixed: the collection target is
 * releases, launches and deprecations, and the sources that publish those first
 * are the projects and vendors doing them. On top of that, 404 of 476 sources
 * carry no source_type at all, and maintain/classify.ts leaves them NULL on
 * purpose -- "a hundred honest NULLs are worth more than a hundred plausible
 * values".
 *
 * An independence-only gate on that archive opens for nothing, ever. A page
 * that is permanently empty because its threshold cannot be met is worse than
 * no page: it reports "no new markets" when it means "I cannot tell".
 *
 * So the gate is TWO SEPARATE PUBLICATIONS, or ONE that does not speak for the
 * thing. Both readings say the same thing in the end -- more than one party has
 * bothered to mention this -- and both exclude the case the gate exists for,
 * which is a single vendor announcing itself.
 */
export const CORROBORATION = 2;

export function passesGate(sources: number, independentSources: number): boolean {
  return sources >= CORROBORATION || independentSources >= 1;
}

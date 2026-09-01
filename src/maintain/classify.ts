// Classifying the registry that already exists.
//
// 308 rows arrived before there was a taxonomy, and the brief asks what each
// one IS. The rule that shapes this file is the brief's own: do not invent
// facts about sources. So every value written here comes from one of exactly
// two places, and the third possibility is left NULL on purpose.
//
//   DERIVED   from a column the row already carries. `kind = 'releases'` means
//             this is a project or vendor publishing its own releases -- that
//             is not a guess, it is a restatement of something the collector
//             established when the source was added. `company_slug` being set
//             is the archive's own record that this domain belongs to a
//             tracked company.
//
//   DECLARED  a checkable fact about a named organisation. "InfoQ is technical
//             journalism" is not an opinion and not a score; anybody can go and
//             look. The map below is small and deliberately so: it holds the
//             sources whose identity is a matter of record, and nothing else.
//
//   UNKNOWN   everything else. Left NULL, status EVALUATING, and reported. A
//             hundred honest NULLs are worth more than a hundred plausible
//             values, because the NULLs are visible and the plausible values
//             are indistinguishable from knowledge.
//
// What this file must never do is assign a SCORE. Authority and expertise are
// priors and need a person; the other seven dimensions are measured from the
// archive by evaluate.ts. Nothing here writes a number.

import type { Db } from '../db/client.ts';
import type { SourceType, SourceStatus } from '../vocab/intel.ts';

export interface ClassifyReport {
  examined: number;
  typed: number;
  categorised: number;
  unknown: number;
  byType: Map<SourceType, number>;
  /** Named sources left for a person, with the reason. */
  undecided: string[];
}

/**
 * Sources whose identity is a matter of public record.
 *
 * Kept small. Every entry is a claim somebody can check in a minute, and none
 * of them is a judgement about quality -- that is what the scores are for, and
 * they are measured elsewhere. `region` appears only where the publication is
 * explicitly a regional one; a US publication is not marked US, because "which
 * market does this cover" and "where is the office" are different questions
 * and only the first one matters here.
 */
const DECLARED: Record<string, {
  type: SourceType;
  categories: string[];
  region?: string;
  domains?: string[];
  why: string;
}> = {
  'techcrunch.com': {
    type: 'MAJOR_JOURNALISM', categories: ['journalism', 'market'],
    why: 'General technology newsroom; strongest on funding, acquisitions and launches.',
  },
  'theregister.com': {
    type: 'TECHNICAL_JOURNALISM', categories: ['journalism', 'engineering', 'market'],
    domains: ['enterprise-software', 'cloud-computing', 'cybersecurity'],
    why: 'Enterprise IT newsroom with original reporting on vendors and infrastructure.',
  },
  'infoq.com': {
    type: 'TECHNICAL_JOURNALISM', categories: ['engineering'],
    domains: ['backend', 'frameworks', 'platform-engineering', 'databases'],
    why: 'Practitioner-facing engineering publication; architecture and production practice.',
  },
  'thenewstack.io': {
    type: 'TECHNICAL_JOURNALISM', categories: ['engineering', 'cloud'],
    domains: ['kubernetes', 'platform-engineering', 'devops', 'containers'],
    why: 'Cloud-native and platform engineering publication.',
  },
  'lwn.net': {
    type: 'SPECIALIST_PUBLICATION', categories: ['engineering', 'devecosystem'],
    domains: ['open-source', 'cybersecurity'],
    why: 'Linux kernel and free software reporting; subscriber-funded, original throughout.',
  },
  'news.crunchbase.com': {
    type: 'MARKET_ANALYSIS', categories: ['market'],
    domains: ['saas', 'enterprise-software'],
    why: 'Funding and startup formation, written against its own deal database.',
  },
  'sifted.eu': {
    type: 'REGIONAL_PUBLICATION', categories: ['market', 'regional'], region: 'Europe',
    why: 'European startup and venture coverage.',
  },
  'tech.eu': {
    type: 'REGIONAL_PUBLICATION', categories: ['market', 'regional'], region: 'Europe',
    why: 'European technology business and funding coverage.',
  },
  'cointelegraph.com': {
    type: 'SPECIALIST_PUBLICATION', categories: ['journalism'],
    domains: ['blockchain', 'fintech'],
    why: 'Blockchain trade press.',
  },
  'decrypt.co': {
    type: 'SPECIALIST_PUBLICATION', categories: ['journalism'],
    domains: ['blockchain', 'fintech'],
    why: 'Blockchain trade press.',
  },
  'laravel-news.com': {
    type: 'SPECIALIST_PUBLICATION', categories: ['devecosystem'],
    domains: ['frameworks', 'backend'],
    why: 'Community publication covering one framework ecosystem.',
  },

  // The linkblog, and the reason this type exists.
  //
  // daringfireball.net IS the home of Markdown, which is why the vocabulary
  // channel promoted it, and it is also a site that mostly recommends other
  // people's writing -- ten different domains across twelve sampled items.
  // DISCOVERY is the honest classification: worth reading to FIND things,
  // never citable as evidence for anything. Typing it this way is how it stops
  // carrying weight without anybody being removed from the registry.
  'daringfireball.net': {
    type: 'DISCOVERY', categories: ['journalism'],
    why: 'Linkblog. Points at other publishers rather than reporting; measured at ten '
      + 'link domains across twelve items. Read to discover, never counted as evidence.',
  },
};

/**
 * Domains that host other people's work.
 *
 * A source URL on one of these says nothing about who wrote it, so ownership
 * lookups skip them entirely. github.blog is GitHub writing; a release feed at
 * github.com/dotnet/runtime is Microsoft's, and reading the domain as
 * authorship would file 179 projects' announcements under one vendor.
 */
const HOSTING_DOMAINS = new Set([
  'github.com', 'gitlab.com', 'github.io', 'sourceforge.net', 'bitbucket.org',
  'googlegroups.com', 'medium.com', 'substack.com', 'wordpress.com', 'blogspot.com',
]);

/** Research arms, which are primary about their own work and not journalism. */
const RESEARCH_HINTS = ['research', 'deepmind'];

/** `fields` (the reader's stack roots) to technology domains (what a source is about). */
const FIELD_TO_DOMAIN: Record<string, string[]> = {
  ai: ['artificial-intelligence', 'machine-learning'],
  security: ['cybersecurity'],
  infra: ['ai-infrastructure', 'observability'],
  cloud: ['cloud-computing', 'serverless'],
  data: ['databases', 'data-engineering'],
  backend: ['backend', 'apis'],
  frontend: ['frontend'],
  languages: ['programming-languages'],
  devops: ['devops', 'platform-engineering'],
  mobile: ['mobile'],
  hardware: ['hardware', 'semiconductors'],
  os: ['open-source'],
  linux: ['open-source'],
  web: ['frontend'],
  'web-platform': ['frontend', 'apis'],
  practice: ['developer-tools'],
  cloudflare: ['edge-computing', 'networking'],
};

interface Row {
  id: string; name: string; url: string; kind: string; roles: string;
  company_slug: string | null; fields: string[]; curated: boolean;
  source_type: string | null; categories: string[]; tech_domains: string[];
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/** blog.rust-lang.org and www.rust-lang.org both answer rust-lang.org. */
export function registrableOf(url: string): string {
  const host = hostOf(url);
  return host.split('.').slice(-2).join('.');
}

/**
 * WHO OWNS THIS DOMAIN, ACCORDING TO THE ARCHIVE'S OWN VOCABULARY.
 *
 * The difference between PRIMARY_VENDOR and PRIMARY_PROJECT is not decoration.
 * A vendor establishes that an announcement was made and nothing more; a
 * project shipping steadily is weak evidence of a live developer ecosystem.
 * Getting the two confused inflates evidence, so it is not a distinction to
 * guess at.
 *
 * The archive already knows the answer for the domains it tracks: `companies`
 * carries homepage, blog and newsroom URLs, and `stacks` and `platforms` carry
 * homepages. A source whose registrable domain matches a company is that
 * company writing; one that matches a stack or platform is that project
 * writing. Anything matching neither is UNKNOWN, and is left that way.
 */
export interface Ownership {
  companies: Map<string, string>;
  projects: Map<string, string>;
}

export async function loadOwnership(db: Db): Promise<Ownership> {
  const companies = new Map<string, string>();
  const projects = new Map<string, string>();
  const co = await db.query<{ slug: string; url: string | null }>(
    `SELECT slug, unnest(array[homepage_url, blog_url, newsroom_url]) AS url FROM companies`);
  for (const r of co) if (r.url) { const d = registrableOf(r.url); if (d) companies.set(d, r.slug); }
  const st = await db.query<{ slug: string; url: string | null }>(
    `SELECT slug, homepage_url AS url FROM stacks WHERE homepage_url IS NOT NULL
      UNION ALL SELECT slug, url FROM platforms WHERE url IS NOT NULL`);
  for (const r of st) if (r.url) { const d = registrableOf(r.url); if (d && !companies.has(d)) projects.set(d, r.slug); }
  return { companies, projects };
}

/**
 * What this row can be shown to be, from what the row already says.
 *
 * Returns null when the answer is not derivable, and that null is the point:
 * it routes the source to EVALUATING and into the report instead of being
 * quietly guessed. An earlier version of this function ended with "first-party
 * role and no company registered, therefore a project", which typed 260 of 308
 * sources in one stroke and would have called the AWS Machine Learning Blog a
 * project. A fallback that always fires is not a derivation.
 */
export function deriveType(row: Row, own: Ownership): { type: SourceType; why: string } | null {
  const host = hostOf(row.url);
  const declared = DECLARED[host];
  if (declared) return { type: declared.type, why: `declared: ${declared.why}` };

  const name = row.name.toLowerCase();
  const primary = row.roles.includes('PRIMARY');
  const domain = registrableOf(row.url);

  // A research arm publishing its own results is PRIMARY_RESEARCH, not
  // journalism and not a vendor: the brief's distinction between EARLY_SIGNAL
  // and MARKET_ADOPTION depends on it.
  if (primary && RESEARCH_HINTS.some((h) => name.includes(h))) {
    return { type: 'PRIMARY_RESEARCH', why: 'derived: a research arm publishing its own results' };
  }

  // A RELEASE FEED IS THE PROJECT'S OWN VERSIONS, WHOEVER HOSTS IT.
  //
  // This has to be asked before the domain is looked up, and the reason is
  // 179 rows: that many release feeds live on github.com, and the company
  // vocabulary quite correctly records github.com as GitHub's homepage. Match
  // on domain first and every one of them is typed "GitHub, the vendor,
  // announcing" -- so ".NET releases" would carry Microsoft's news as if
  // GitHub had said it. Hosting is not authorship.
  if (row.kind === 'releases') {
    return row.company_slug
      ? { type: 'PRIMARY_VENDOR', why: `derived: release feed of company "${row.company_slug}"` }
      : { type: 'PRIMARY_PROJECT', why: 'derived: kind=releases, a project announcing its own versions' };
  }

  // The archive's own record that this domain belongs to a tracked company.
  if (row.company_slug) {
    return { type: 'PRIMARY_VENDOR', why: `derived: company_slug=${row.company_slug}` };
  }

  // Ownership by domain, but never on a domain that hosts other people's
  // work. github.blog is GitHub writing; github.com/x/releases is not.
  if (!HOSTING_DOMAINS.has(domain)) {
    const company = own.companies.get(domain);
    if (company) {
      return { type: 'PRIMARY_VENDOR', why: `derived: ${domain} is the registered domain of company "${company}"` };
    }
    const project = own.projects.get(domain);
    if (project) {
      return { type: 'PRIMARY_PROJECT', why: `derived: ${domain} is the homepage of tracked project "${project}"` };
    }
  }

  return null;
}

/** Beats, from the type and from whatever the row already knows about itself. */
export function deriveCategories(row: Row, type: SourceType | null): string[] {
  const host = hostOf(row.url);
  const declared = DECLARED[host];
  if (declared) return [...declared.categories];

  const out = new Set<string>();
  if (type === 'PRIMARY_VENDOR' || type === 'PRIMARY_PROJECT') out.add('vendor');
  if (type === 'PRIMARY_RESEARCH' || type === 'RESEARCH') out.add('research');
  if (type === 'COMMUNITY') out.add('devecosystem');

  for (const f of row.fields ?? []) {
    if (f === 'ai') out.add('ai');
    if (f === 'security') out.add('security');
    if (f === 'cloud' || f === 'infra' || f === 'devops') out.add('cloud');
    if (f === 'languages' || f === 'frontend' || f === 'backend') out.add('devecosystem');
  }
  return [...out];
}

export function deriveDomains(row: Row): string[] {
  const host = hostOf(row.url);
  const declared = DECLARED[host];
  if (declared?.domains) return [...declared.domains];
  const out = new Set<string>();
  for (const f of row.fields ?? []) for (const d of FIELD_TO_DOMAIN[f] ?? []) out.add(d);
  return [...out];
}

/**
 * Classify every source that has not been classified.
 *
 * Idempotent, and it never overwrites. A value already present was either
 * written by a person or by an earlier run that had the same evidence; in both
 * cases this run has nothing better to offer. `force` exists for a schema
 * change, not for routine use.
 */
export async function classifySources(
  db: Db, opts: { force?: boolean; apply?: boolean } = {},
): Promise<ClassifyReport> {
  const report: ClassifyReport = {
    examined: 0, typed: 0, categorised: 0, unknown: 0, byType: new Map(), undecided: [],
  };

  const own = await loadOwnership(db);
  const rows = await db.query<Row>(
    `SELECT id::text, name, url, kind, roles::text AS roles, company_slug,
            coalesce(fields, '{}') AS fields, curated,
            source_type::text AS source_type, categories, tech_domains
       FROM sources
      ${opts.force ? '' : 'WHERE source_type IS NULL OR cardinality(categories) = 0'}
      ORDER BY name`);

  for (const row of rows) {
    report.examined++;
    const derived = deriveType(row, own);
    const type = (row.source_type as SourceType | null) ?? derived?.type ?? null;

    if (!type) {
      report.unknown++;
      report.undecided.push(`${row.name} — ${hostOf(row.url)}`);
      if (opts.apply) {
        // EVALUATING is not a demotion. It is the honest statement that the
        // archive does not yet know what this is, and it keeps collecting
        // while somebody works it out.
        await db.query(
          `UPDATE sources SET status = 'EVALUATING', last_evaluated_at = now(),
                  exclusion_reason = coalesce(exclusion_reason,
                    'type not derivable from the row and not a declared organisation')
            WHERE id = $1::uuid AND status = 'APPROVED'`, [row.id]);
      }
      continue;
    }

    const categories = row.categories?.length ? row.categories : deriveCategories(row, type);
    const domains = row.tech_domains?.length ? row.tech_domains : deriveDomains(row);
    report.typed++;
    if (categories.length) report.categorised++;
    report.byType.set(type, (report.byType.get(type) ?? 0) + 1);

    if (opts.apply) {
      const host = hostOf(row.url);
      await db.query(
        `UPDATE sources
            SET source_type = $2::source_type,
                categories = CASE WHEN cardinality(categories) = 0 THEN $3::text[] ELSE categories END,
                tech_domains = CASE WHEN cardinality(tech_domains) = 0 THEN $4::text[] ELSE tech_domains END,
                region = coalesce(region, $5),
                inclusion_reason = coalesce(inclusion_reason, $6),
                discovery_method = coalesce(discovery_method, $7),
                last_evaluated_at = now()
          WHERE id = $1::uuid`,
        [row.id, type, categories, domains, DECLARED[host]?.region ?? null,
          derived?.why ?? 'classified', DECLARED[host] ? 'hand' : 'derived']);
    }
  }

  return report;
}

export function summariseClassify(r: ClassifyReport): string {
  if (!r.examined) return '';
  const types = [...r.byType.entries()].sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t.toLowerCase()} ${n}`).join(', ');
  return `${r.examined} examined, ${r.typed} typed (${types})`
    + `${r.unknown ? `, ${r.unknown} left for a person` : ''}`;
}

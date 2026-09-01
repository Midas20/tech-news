// The source taxonomy, and the three axes it is made of.
//
// The brief lists categories A-J, twelve source types and forty technology
// domains, and it is tempting to read those as one list. They are three, and
// keeping them apart is what makes the rest work:
//
//   SOURCE_TYPE   what kind of CLAIM the source can make. Exactly one.
//                 This is the epistemic axis, and the only one allowed to
//                 affect how strongly evidence counts.
//
//   CATEGORY      what BEAT it covers. Many. Ars Technica is both major
//                 journalism and technical journalism and forcing a choice
//                 there loses real information.
//
//   TECH_DOMAIN   what TECHNOLOGY it is about. Many. Drives coverage-gap
//                 analysis: which of these forty has nobody watching it.
//
// Collapsing them is how "TechCrunch said it" starts counting as "engineers
// verified it". The type is the thing that stops that.

export type SourceType =
  | 'PRIMARY_GOVERNMENT'
  | 'PRIMARY_VENDOR'
  | 'PRIMARY_PROJECT'
  | 'PRIMARY_RESEARCH'
  | 'MAJOR_JOURNALISM'
  | 'TECHNICAL_JOURNALISM'
  | 'SPECIALIST_PUBLICATION'
  | 'REGIONAL_PUBLICATION'
  | 'COMMUNITY'
  | 'RESEARCH'
  | 'MARKET_ANALYSIS'
  | 'DISCOVERY';

export type SourceStatus =
  | 'DISCOVERED' | 'EVALUATING' | 'APPROVED' | 'MONITORING'
  | 'LOW_PRIORITY' | 'SUSPENDED' | 'REJECTED';

/**
 * WHAT A SOURCE TYPE IS ALLOWED TO PROVE.
 *
 * `evidence` is the rung of the adoption ladder a source of this type can
 * establish ON ITS OWN. A vendor blog can prove an announcement was made. It
 * cannot prove anyone adopted anything, however many times it says so.
 *
 * `independent` is whether two sources of this type reporting the same event
 * count as two confirmations or one. For vendors the answer is ONE: four
 * vendors shipping in the same area is convergence -- a real and interesting
 * signal -- but it is not four parties confirming each other.
 */
export interface TypeMeaning {
  type: SourceType;
  label: string;
  /** Highest rung this type establishes unaided. */
  evidence: EvidenceRung;
  /** Do two sources of this type corroborate each other? */
  independent: boolean;
  why: string;
}

/**
 * The ladder. An announcement is not adoption, and the gap between them is
 * where most technology reporting lives.
 */
export type EvidenceRung =
  | 'announcement'
  | 'interest'
  | 'developer_adoption'
  | 'production_adoption'
  | 'commercial_adoption'
  | 'market_expansion';

export const RUNGS: EvidenceRung[] = [
  'announcement', 'interest', 'developer_adoption',
  'production_adoption', 'commercial_adoption', 'market_expansion',
];

export const TYPE_MEANING: TypeMeaning[] = [
  { type: 'PRIMARY_VENDOR', label: 'Vendor', evidence: 'announcement', independent: false,
    why: 'A company describing its own product. Authoritative about WHAT shipped and '
      + 'worthless as evidence that anyone wanted it.' },
  { type: 'PRIMARY_PROJECT', label: 'Project', evidence: 'developer_adoption', independent: false,
    why: 'A release is a fact, and a project shipping steadily is weak evidence of a '
      + 'live developer ecosystem around it.' },
  { type: 'PRIMARY_GOVERNMENT', label: 'Government', evidence: 'market_expansion', independent: true,
    why: 'Regulators and standards bodies move markets directly. Rare, slow, and when '
      + 'it fires it outranks everything else here.' },
  { type: 'PRIMARY_RESEARCH', label: 'Research lab', evidence: 'announcement', independent: false,
    why: 'A lab publishing its own result. EARLY_SIGNAL, explicitly not adoption.' },
  { type: 'RESEARCH', label: 'Research venue', evidence: 'announcement', independent: true,
    why: 'arXiv, ACM, IEEE. Detects technologies before the market has an opinion. A '
      + 'paper is never commercial adoption.' },
  { type: 'MAJOR_JOURNALISM', label: 'Major journalism', evidence: 'commercial_adoption', independent: true,
    why: 'Reports contracts, deals and money that vendors do not volunteer. Broad rather '
      + 'than deep -- high authority, moderate developer relevance.' },
  { type: 'TECHNICAL_JOURNALISM', label: 'Technical journalism', evidence: 'production_adoption', independent: true,
    why: 'The type that carries the signal this platform exists for: what companies '
      + 'actually run, written by people who can tell.' },
  { type: 'SPECIALIST_PUBLICATION', label: 'Specialist', evidence: 'production_adoption', independent: true,
    why: 'A narrow publication that consistently sees a domain early. Small audience, '
      + 'high signal density -- scored on what it finds, not on how known it is.' },
  { type: 'REGIONAL_PUBLICATION', label: 'Regional', evidence: 'commercial_adoption', independent: true,
    why: 'Adoption often appears in a local market before it is visible in English.' },
  { type: 'COMMUNITY', label: 'Community', evidence: 'interest', independent: false,
    why: 'Hacker News, Stack Overflow, forums. Proves people are TALKING. Community '
      + 'activity is never proof of commercial adoption.' },
  { type: 'MARKET_ANALYSIS', label: 'Market', evidence: 'commercial_adoption', independent: true,
    why: 'Funding, hiring, spending, consolidation. The rungs the archive is currently '
      + 'blind to.' },
  { type: 'DISCOVERY', label: 'Discovery', evidence: 'interest', independent: false,
    why: 'An aggregator read to FIND sources, not to cite. Never counts as evidence.' },
];

const BY_TYPE = new Map(TYPE_MEANING.map((m) => [m.type, m]));
export function meaningOf(t: SourceType): TypeMeaning | undefined { return BY_TYPE.get(t); }

/** Types that speak for themselves rather than about somebody else. */
export function isPrimaryType(t: SourceType): boolean { return t.startsWith('PRIMARY_'); }

// ---------------------------------------------------------------------------

export interface Category { slug: string; letter: string; label: string; purpose: string }

/** Categories A-J. The beat axis. */
export const CATEGORIES: Category[] = [
  { slug: 'journalism', letter: 'A', label: 'Major technology journalism',
    purpose: 'Breaking developments, acquisitions, funding, launches.' },
  { slug: 'engineering', letter: 'B', label: 'Technical & engineering journalism',
    purpose: 'Architecture, infrastructure, production practice. Where stack changes show up.' },
  { slug: 'ai', letter: 'C', label: 'AI & machine learning',
    purpose: 'Research, engineering, model releases, AI infrastructure.' },
  { slug: 'security', letter: 'D', label: 'Cybersecurity',
    purpose: 'Vulnerabilities, attacks, threat trends, enterprise security adoption.' },
  { slug: 'devecosystem', letter: 'E', label: 'Developer ecosystem',
    purpose: 'Language and framework adoption, open-source momentum, tooling.' },
  { slug: 'cloud', letter: 'F', label: 'Cloud & infrastructure',
    purpose: 'Cloud, Kubernetes, DevOps, platform engineering, edge, observability.' },
  { slug: 'vendor', letter: 'G', label: 'Vendor & primary',
    purpose: 'First-party announcements. Important, and never independent confirmation.' },
  { slug: 'research', letter: 'H', label: 'Research',
    purpose: 'Pre-adoption signal. arXiv, ACM, IEEE, university labs.' },
  { slug: 'market', letter: 'I', label: 'IT business & market',
    purpose: 'Funding, acquisitions, contracts, spending, hiring, layoffs, IPOs.' },
  { slug: 'regional', letter: 'J', label: 'Regional',
    purpose: 'Non-US technology markets, where adoption may appear first.' },
];

export const CATEGORY_SLUGS = new Set(CATEGORIES.map((c) => c.slug));

/**
 * The portfolio the brief asks for, as shares of the approved set.
 *
 * Guidelines, not quotas -- but a registry that misses them by a lot is not a
 * balanced portfolio, and the `evaluate` job reports the gap rather than
 * quietly correcting it. Nothing here ever removes a source to hit a target.
 */
export const TARGET_MIX: Array<{ slug: string; low: number; high: number }> = [
  { slug: 'journalism', low: 0.20, high: 0.25 },
  { slug: 'engineering', low: 0.20, high: 0.25 },
  { slug: 'vendor', low: 0.15, high: 0.20 },
  { slug: 'devecosystem', low: 0.10, high: 0.15 },
  { slug: 'research', low: 0.10, high: 0.15 },
  { slug: 'market', low: 0.10, high: 0.15 },
];

// ---------------------------------------------------------------------------

/**
 * Technology domains. Extensible by design: this is a starting list, not a
 * closed vocabulary, and a domain nobody covers is a finding rather than an
 * error.
 */
export const TECH_DOMAINS: string[] = [
  'artificial-intelligence', 'machine-learning', 'generative-ai', 'ai-agents', 'llms',
  'ai-infrastructure', 'cloud-computing', 'devops', 'platform-engineering', 'kubernetes',
  'containers', 'serverless', 'edge-computing', 'webassembly', 'databases',
  'data-engineering', 'big-data', 'backend', 'frontend', 'mobile',
  'programming-languages', 'frameworks', 'developer-tools', 'apis', 'saas',
  'enterprise-software', 'cybersecurity', 'identity', 'observability', 'networking',
  'hardware', 'semiconductors', 'robotics', 'iot', 'ar-vr',
  'blockchain', 'fintech', 'health-tech', 'autonomous-systems', 'quantum-computing',
  'open-source',
];

export const TECH_DOMAIN_SET = new Set(TECH_DOMAINS);

// ---------------------------------------------------------------------------

/**
 * Composite weights. Configurable, as asked -- and the individual dimensions
 * stay visible in source_metrics whatever these are set to, which is the part
 * that actually matters.
 */
export interface ScoreWeights {
  authority: number;
  originality: number;
  expertise: number;
  market: number;
  density: number;
  developer: number;
  enterprise: number;
  early: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  authority: 0.15,
  originality: 0.15,
  expertise: 0.15,
  market: 0.15,
  density: 0.15,
  developer: 0.10,
  enterprise: 0.10,
  early: 0.05,
};

/**
 * THE COMPOSITE REFUSES TO GUESS.
 *
 * Missing dimensions are dropped and the remaining weights renormalised, so a
 * source measured on three dimensions is scored on three dimensions rather
 * than being punished for the seven nobody has evidence for yet. `known` comes
 * back with the answer: a 78 built from two inputs and a 78 built from eight
 * are not the same claim, and the caller is not allowed to forget which it
 * has.
 *
 * Returns null when nothing at all is known. That is UNKNOWN, and it is a
 * legitimate state for a source to be in -- unlike zero, which is a judgement.
 */
export function composite(
  dims: Partial<Record<keyof ScoreWeights, number | null>>,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): { score: number; known: number; of: number } | null {
  let sum = 0;
  let used = 0;
  let known = 0;
  const total = Object.keys(weights).length;
  for (const [key, weight] of Object.entries(weights) as Array<[keyof ScoreWeights, number]>) {
    const v = dims[key];
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    sum += v * weight;
    used += weight;
    known++;
  }
  if (!used) return null;
  return { score: Math.round(sum / used), known, of: total };
}

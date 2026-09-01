// The source intelligence layer, and the one rule that holds it together.
//
// Asked for on 2026-08-31: a platform that can tell what is being ADOPTED from
// what is merely being ANNOUNCED. Every test here defends one of the two
// distinctions that makes that possible -- provenance of a value, and the
// epistemic type of a source -- because both are the kind of thing a later
// refactor quietly collapses.
//
// The brief's own rule, and the sharpest constraint in it: DO NOT INVENT FACTS
// ABOUT SOURCES. It collides head-on with the request for nine numeric scores
// across a hundred sources, and the collision is resolved in exactly one way --
// measured values are computed, declared values are checkable, priors are
// labelled, and everything else stays NULL.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  composite, DEFAULT_WEIGHTS, TYPE_MEANING, CATEGORIES, TECH_DOMAINS,
  meaningOf, isPrimaryType, RUNGS,
} from '../src/vocab/intel.ts';
import { deriveType, registrableOf, hostOf } from '../src/maintain/classify.ts';

const CLASSIFY = readFileSync(new URL('../src/maintain/classify.ts', import.meta.url), 'utf8');
const EVALUATE = readFileSync(new URL('../src/maintain/evaluate.ts', import.meta.url), 'utf8');
const MIGRATION = readFileSync(
  new URL('../migrations/0068_a_source_is_not_one_number.sql', import.meta.url), 'utf8');

const row = (over: Partial<Parameters<typeof deriveType>[0]> = {}) => ({
  id: 'x', name: 'Example', url: 'https://example.com/', kind: 'news',
  roles: '{CONTENT}', company_slug: null, fields: [], curated: false,
  source_type: null, categories: [], tech_domains: [], ...over,
} as Parameters<typeof deriveType>[0]);

const own = { companies: new Map<string, string>(), projects: new Map<string, string>() };

describe('a score carries its provenance', () => {
  it('refuses to invent a number when nothing is known', () => {
    // UNKNOWN is a legitimate state for a source. Zero is a judgement, and a
    // source nobody has measured has not been judged.
    expect(composite({})).toBeNull();
    expect(composite({ authority: null, market: null })).toBeNull();
  });

  it('scores on what is known and says how much that was', () => {
    // A 78 built from two dimensions and a 78 built from eight are different
    // claims. The caller is not allowed to forget which one it is holding.
    const two = composite({ market: 80, density: 76 });
    expect(two?.score).toBe(78);
    expect(two).toMatchObject({ known: 2, of: 8 });
  });

  it('does not punish a source for dimensions nobody has evidence for', () => {
    // Renormalising rather than treating missing as zero. Without this, the
    // best-measured source in the registry loses to an unmeasured one.
    const partial = composite({ market: 100 });
    expect(partial?.score).toBe(100);
  });

  it('keeps every weight configurable and the dimensions visible', () => {
    const flat = { ...DEFAULT_WEIGHTS, authority: 0.5, density: 0.5 };
    expect(composite({ authority: 100, density: 0 }, flat)?.score).toBe(50);
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('will not let a prior be stored without its reason', () => {
    // The constraint is what makes "do not invent facts" enforceable rather
    // than merely encouraged. Authority cannot be measured from the archive,
    // so the schema demands somebody say why they believe it.
    expect(MIGRATION).toMatch(/sources_prior_needs_reason[\s\S]{0,200}prior_reason IS NOT NULL/);
  });
});

describe('what a source type is allowed to prove', () => {
  it('gives every type a rung on the adoption ladder', () => {
    for (const m of TYPE_MEANING) {
      expect(RUNGS, `${m.type} has an unknown rung`).toContain(m.evidence);
      expect(m.why.length, `${m.type} needs a reason`).toBeGreaterThan(20);
    }
  });

  it('stops a vendor proving adoption', () => {
    // "Company X released an AI agent framework" is not evidence that AI agent
    // frameworks are becoming a major market. The type is where that is
    // enforced, once, rather than in every consumer of the data.
    expect(meaningOf('PRIMARY_VENDOR')?.evidence).toBe('announcement');
    expect(meaningOf('PRIMARY_RESEARCH')?.evidence).toBe('announcement');
  });

  it('refuses to let two vendors corroborate each other', () => {
    // Four vendors moving into one area is VENDOR_CONVERGENCE -- a real and
    // strong signal -- and it is still not four independent confirmations.
    expect(meaningOf('PRIMARY_VENDOR')?.independent).toBe(false);
    expect(meaningOf('PRIMARY_PROJECT')?.independent).toBe(false);
    expect(meaningOf('COMMUNITY')?.independent).toBe(false);
    expect(meaningOf('TECHNICAL_JOURNALISM')?.independent).toBe(true);
    expect(meaningOf('MAJOR_JOURNALISM')?.independent).toBe(true);
  });

  it('never lets community activity mean commercial adoption', () => {
    expect(meaningOf('COMMUNITY')?.evidence).toBe('interest');
  });

  it('never counts an aggregator as evidence at all', () => {
    // The type that exists because of daringfireball.net.
    expect(meaningOf('DISCOVERY')?.independent).toBe(false);
    expect(meaningOf('DISCOVERY')?.evidence).toBe('interest');
  });

  it('keeps the three axes separate', () => {
    // source_type is epistemic, categories are beats, tech_domains are
    // subjects. Collapsing them is how "TechCrunch said it" becomes "engineers
    // verified it".
    expect(CATEGORIES).toHaveLength(10);
    expect(TECH_DOMAINS.length).toBeGreaterThanOrEqual(40);
    const typeNames = new Set(TYPE_MEANING.map((t) => t.type as string));
    for (const c of CATEGORIES) expect(typeNames.has(c.slug)).toBe(false);
  });

  it('knows which types speak for themselves', () => {
    expect(isPrimaryType('PRIMARY_VENDOR')).toBe(true);
    expect(isPrimaryType('TECHNICAL_JOURNALISM')).toBe(false);
  });
});

describe('classification derives or declines, and never guesses', () => {
  it('leaves an unrecognised source undecided', () => {
    // The important negative. An earlier version ended with "first-party role
    // and no company, therefore a project", which typed 260 of 308 sources in
    // one stroke -- including the AWS Machine Learning Blog, which is a
    // vendor. A fallback that always fires is not a derivation.
    expect(deriveType(row({ roles: '{CONTENT,PRIMARY}' }), own)).toBeNull();
    expect(deriveType(row(), own)).toBeNull();
  });

  it('reads a release feed as the project, not as its host', () => {
    // 179 release feeds live on github.com, and the company vocabulary quite
    // correctly records github.com as GitHub's homepage. Ask the domain first
    // and ".NET releases" is filed as GitHub announcing something. Hosting is
    // not authorship.
    const host = { companies: new Map([['github.com', 'github']]), projects: new Map() };
    const dotnet = row({
      name: '.NET releases', kind: 'releases',
      url: 'https://github.com/dotnet/runtime/releases',
    });
    expect(deriveType(dotnet, host)?.type).toBe('PRIMARY_PROJECT');
  });

  it('still reads a company blog on its own domain as the vendor', () => {
    const host = { companies: new Map([['github.com', 'github']]), projects: new Map() };
    const blog = row({ name: 'GitHub Blog', url: 'https://github.blog/' });
    // github.blog is a different registrable domain and is not in the hosting
    // list, so it resolves normally rather than being suppressed.
    expect(deriveType(blog, host)).toBeNull();
    const known = { companies: new Map([['github.blog', 'github']]), projects: new Map() };
    expect(deriveType(blog, known)?.type).toBe('PRIMARY_VENDOR');
  });

  it('never suppresses ownership for a domain that hosts nobody else', () => {
    const known = { companies: new Map([['stripe.com', 'stripe']]), projects: new Map() };
    expect(deriveType(row({ url: 'https://stripe.com/blog' }), known)?.type).toBe('PRIMARY_VENDOR');
  });

  it('separates a research arm from a vendor', () => {
    // EARLY_SIGNAL and MARKET_ADOPTION are different claims, and the
    // difference starts here.
    const r = row({ name: 'Microsoft Research blog', roles: '{CONTENT,PRIMARY}' });
    expect(deriveType(r, own)?.type).toBe('PRIMARY_RESEARCH');
  });

  it('compares registrable domains', () => {
    expect(registrableOf('https://blog.rust-lang.org/inside-rust/')).toBe('rust-lang.org');
    expect(registrableOf('https://www.rust-lang.org/')).toBe('rust-lang.org');
    expect(hostOf('https://www.example.com/x')).toBe('example.com');
  });

  it('writes no score of any kind', () => {
    // Classification says what a source IS. Scoring says how well it does it,
    // is measured elsewhere, and mixing the two is how a taxonomy turns into
    // an opinion.
    expect(CLASSIFY).not.toMatch(/authority_score\s*=/);
    expect(CLASSIFY).not.toMatch(/overall_score\s*=/);
  });

  it('never overwrites a value somebody already set', () => {
    expect(CLASSIFY).toMatch(/CASE WHEN cardinality\(categories\) = 0 THEN/);
    expect(CLASSIFY).toMatch(/coalesce\(region, /);
    expect(CLASSIFY).toMatch(/coalesce\(inclusion_reason, /);
  });
});

describe('measurement refuses the convenient number', () => {
  it('does not read items_kept/items_seen as signal density', () => {
    // The trap. items_kept counts NEWLY STORED items, so a fully backfilled
    // feed reports zero: TechCrunch 0% on 280 items, InfoQ 0% on 2,070,
    // Stripe 0% on 12,601. Those are finished sources, not noisy ones.
    expect(EVALUATE).toMatch(/items_kept.*items_seen.*(looks like|is not)/s);
    // Asserted against the CODE, with the prose stripped -- the comment above
    // this necessarily contains the very expression it warns against.
    const code = EVALUATE.split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--'))
      .join('\n');
    expect(code).not.toContain('items_seen');
  });

  it('excludes already-seen items from the denominator', () => {
    // already_archived and duplicate are the archive recognising something.
    // They say nothing about whether the source is worth reading.
    for (const reason of ['already_archived', 'duplicate']) {
      expect(EVALUATE).toContain(reason);
    }
    expect(EVALUATE).toMatch(/SEEN_BEFORE = \[/);
  });

  it('measures freshness only after watching began', () => {
    // Lag over all rows measures the import, not the feed: 13,086 hours for
    // Vercel. Cut to stories published after the archive started watching and
    // AWS What's New goes from 165 hours to 3.3.
    expect(EVALUATE).toMatch(/s\.published_at >= w\.watching_since/);
    // sources.first_seen_at cannot answer this -- every row carries the date
    // the table was last rebuilt.
    expect(EVALUATE).toMatch(/watching AS \([\s\S]{0,200}min\(first_seen_at\)/);
  });

  it('requires enough evidence before it reports a rate', () => {
    // A source with four stories has no duplicate rate. Reporting 0 would put
    // it top of the ranking for cleanliness.
    expect(EVALUATE.match(/CASE WHEN[\s\S]{0,120}>= \d+\s*\n?\s*THEN round/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(6);
  });

  it('records the metrics as history rather than overwriting them', () => {
    // "Source quality is not permanently fixed" only means something if last
    // month's number is still there to compare against.
    expect(MIGRATION).toMatch(/PRIMARY KEY \(source_id, window_end, window_days\)/);
  });
});

describe('the loop still never removes anyone', () => {
  it('degrades by priority, never by deletion or pausing', () => {
    // Standing instruction, and the reason SOURCE_DEGRADATION is implemented
    // as a score rather than as a status change. A source going quiet is
    // itself a signal, and deleting the row is how that gets lost.
    for (const file of [CLASSIFY, EVALUATE]) {
      expect(file).not.toMatch(/DELETE\s+FROM\s+sources/i);
      expect(file).not.toMatch(/health\s*=\s*'paused'/i);
    }
    expect(MIGRATION).not.toMatch(/DROP\s+TABLE/i);
  });

  it('adds no way to retire a source', () => {
    // Unwrapped first: the sentence spans two comment lines in the file.
    expect(MIGRATION.replace(/\r?\n--\s*/g, ' '))
      .toMatch(/adds no way to delete, pause, or retire a source/);
  });
});

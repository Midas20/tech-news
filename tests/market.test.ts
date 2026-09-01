// The market is the second thing this archive is for.
//
// The project's purpose, stated 2026-08-28: "finding new stacks and market via
// news." Two targets. The rules implemented one of them -- launch, release,
// change, all facts about a codebase -- and actively refused the other.
//
// Every title in the "capital" block below was refused by the live system, and
// not as an article: earlier, as `business` off-topic, the category for analyst
// reports and vendor surveys. Nine funding rounds from six of the most-watched
// infrastructure companies in the registry, each announced by the company
// itself. That was the single largest miss in the archive against its own
// purpose, and these tests are the record of it.

import { describe, it, expect } from 'vitest';
import { classifyEvent, isEvent, type EventKind } from '../src/collect/eventful.ts';
import { judgeTopic } from '../src/collect/topical.ts';
import type { StackVocabulary } from '../src/process/tagstacks.ts';

const kind = (t: string): EventKind => classifyEvent(t).kind;

/**
 * The topical gate, reading a vocabulary the way the collector does.
 *
 * `rescue: 'signal'` means "naming a technology anywhere is enough", and
 * without a vocabulary there is nothing to name -- so testing this rule with no
 * vocab would only prove the fallback. These are the slugs the real registry
 * holds for the companies in the corpus below.
 */
const VOCAB: StackVocabulary = {
  index: new Map([
    ['clickhouse', 'clickhouse'], ['supabase', 'supabase'], ['postgres', 'postgresql'],
    ['mistral', 'mistral'], ['hugging face', 'hugging-face'], ['kubernetes', 'kubernetes'],
  ]),
  canonicalCase: new Map([['clickhouse', 'ClickHouse'], ['supabase', 'Supabase']]),
  curated: new Set(['clickhouse', 'supabase', 'postgresql']),
};
const topic = (t: string, body = '') => judgeTopic(t, body, { vocab: VOCAB });

describe('capital', () => {
  it('is an event, not a survey', () => {
    // Verbatim from story_rejects, all category=business.
    for (const t of [
      'ClickHouse raises $400M Series D led by Dragoneer to accelerate expansion',
      'ClickHouse raises $350 million Series C to power analytics for the AI era',
      'ClickHouse raises a $250M Series B at a $2B valuation...and we are hiring',
      'Mistral AI raises 1.7B€ to accelerate technological progress with AI',
      'We Raised $100 Million for Open & Collaborative Machine Learning',
      'Supabase $30m Series A',
      'Supabase Series F',
    ]) {
      expect(kind(t), t).toBe('market');
      expect(isEvent(kind(t)), t).toBe(true);
    }
  });

  it('survives the topical gate when it names a technology', () => {
    // The gate that actually refused these. `business` used to be one list at
    // `strong`, so only a version number in the title could rescue it -- and a
    // funding round never has one.
    expect(topic('ClickHouse raises $400M Series D led by Dragoneer').keep).toBe(true);
    expect(topic('Supabase Series F', 'Supabase, the Postgres platform, raised').keep).toBe(true);
  });

  it('is still refused when it names no technology at all', () => {
    // Not a blanket pass. A funding round with nothing technical in it is
    // business press and always was.
    const v = topic('Brightwell Holdings raises $12M in Series A funding');
    expect(v.keep).toBe(false);
    expect(v.category).toBe('business');
  });
});

describe('the reports, which are still not news', () => {
  it('refuses a survey however good its subject', () => {
    // The sentence that made the split necessary in the other direction: this
    // names a technology and reports nothing that happened.
    for (const t of [
      'New study finds 40% of companies use Kubernetes in production',
      'McKinsey says enterprise AI is finally on the road to ROI',
      'Survey finds 62% of it leaders plan to adopt AI agents',
    ]) {
      const v = topic(t);
      expect(v.keep, t).toBe(false);
      expect(v.category, t).toBe('business');
    }
  });
});

describe('ownership', () => {
  it('is market, not a product change', () => {
    // Moved off `change`, where it had been matching all along. "MotherDuck
    // bought the startup" changes nothing about what MotherDuck IS this week
    // and everything about what it will be.
    expect(kind('MotherDuck acquires the startup behind DuckDB extensions')).toBe('market');
    expect(kind('Databricks to buy Neon for $1B')).toBe('market');
  });

  it('yields to what the technology actually did, when a title says both', () => {
    // launch/release/change get first refusal. A reader can install a release;
    // they cannot install an acquisition. (Which product class wins is the
    // existing grammar's business -- "is now available" reads as a launch --
    // and all this asserts is that market does not take it.)
    expect(kind('Vercel acquires Nuxt: Nuxt 5.0 is now available')).toBe('launch');
  });
});

describe('position', () => {
  it('reads which way adoption is moving', () => {
    expect(kind('Self-hosted email is in steep decline')).toBe('market');
    expect(kind('Rust overtakes C++ in the annual developer survey')).toBe('market');
    expect(kind('Postgres is now the most popular database among new projects')).toBe('market');
  });

  it('is a claim, not a question about one', () => {
    // POSITION jumps ahead of the release grammar, which means it is read
    // before the article shapes get their say. Verbatim from the archive,
    // where it was reclassified to `market` and is a fine-tuning tutorial.
    expect(kind('Beyond LoRA: Can you beat the most popular fine-tuning technique?'))
      .toBe('article');
    expect(kind('Is Rust overtaking C++?')).toBe('article');
  });

  it('needs a direction, not just the word share', () => {
    // "Share" on its own is a verb about links -- Vercel writes "Share
    // Container Registry repositories across teams", which is a feature.
    expect(kind('Share Container Registry repositories across teams'))
      .not.toBe('market');
  });
});

describe('a vendor changelog that opens with a question', () => {
  it('is a change, not an article', () => {
    // The densest announcement format these publishers produce, refused on its
    // first word. All three verbatim from story_rejects, category=article.
    expect(kind("What's new in ClickStack - March 2026")).toBe('change');
    expect(kind('What’s new in two: June 2026 edition')).toBe('change');
    expect(kind("What's new in Postgres Managed by ClickHouse: RBAC, Terraform, ClickPipes"))
      .toBe('change');
  });

  it('does not rescue the tutorial that shares the opener', () => {
    // Why this is an exception rather than dropping `what` from the article
    // shapes. Both verbatim from the corpus.
    expect(kind('What are PostgreSQL Templates?')).toBe('article');
    expect(kind('When and what should I be logging?')).toBe('article');
  });
});

describe('a title that is a version', () => {
  const firstParty = (t: string) =>
    classifyEvent(t, { sourceKind: 'news', firstParty: true }).kind;

  it('is a release whoever publishes it', () => {
    // The shortcut was gated on the source's kind, which is a fact about the
    // feed and not about the sentence. These three are posts on blogs classed
    // `news`, so they fell through to the first-party fallback and were filed
    // as changes -- "something happened, we cannot say what" -- when each is
    // the core event the archive exists to find.
    expect(firstParty('Bun 1.4')).toBe('release');
    expect(firstParty('Deno 2.9')).toBe('release');
    expect(firstParty('Astro 7.2')).toBe('release');
  });

  it('does not turn every first-party post into a release', () => {
    // looksLikeVersion is strict: at most four words, the last of which IS a
    // version. A sentence is not a version.
    expect(firstParty('Rewriting Bun in Rust')).toBe('change');
    expect(firstParty('Welcoming Our Newest Core Team Members')).toBe('change');
  });

  it('still needs a first party or a release feed behind it', () => {
    // An anonymous headline that happens to end in a number is not a release
    // announcement, and the grammar has no other reason to think so.
    expect(classifyEvent('Bun 1.4', { sourceKind: 'news' }).kind).not.toBe('release');
  });
});

describe('what the new class must not swallow', () => {
  it('leaves the ordinary product events alone', () => {
    expect(kind('Introducing Agent Plugins 1.0.0')).toBe('launch');
    expect(kind('Python 3.9 has reached end of life')).toBe('change');
    expect(kind('Vercel WAF for Blob is now generally available')).toBe('launch');
    expect(kind('Redis 8.2 released')).toBe('release');
  });

  it('leaves the tutorials and war stories alone', () => {
    expect(kind('How Factory scaled its cloud backend to one billion monthly requests'))
      .toBe('article');
    expect(kind('A Deep Dive into Apache Parquet with ClickHouse - Part 1')).toBe('article');
  });
});

import { describe, it, expect } from 'vitest';
import {
  repoVariants, normalizeTerm, candidateTerms, shouldPromote,
} from '../src/process/discover.ts';
import { detectStacks, type StackVocabulary } from '../src/process/tagstacks.ts';

describe('repository name variants', () => {
  it('strips the decoration that is not part of the name', () => {
    // Without this the pass proposes a dozen entries that already exist:
    // nats-server IS NATS, flux2 IS Flux, php-src IS PHP.
    expect(repoVariants('nats-io', 'nats-server')).toContain('nats');
    expect(repoVariants('fluxcd', 'flux2')).toContain('flux');
    expect(repoVariants('php', 'php-src')).toContain('php');
    expect(repoVariants('linkerd', 'linkerd2')).toContain('linkerd');
    expect(repoVariants('graphql', 'graphql-spec')).toContain('graphql');
  });

  it('keeps the owner, which is often the project name', () => {
    // vuejs/core is Vue; the repository name says nothing.
    expect(repoVariants('vuejs', 'core')).toContain('vuejs');
  });

  it('offers the punctuation-free forms an alias table may hold', () => {
    const v = repoVariants('run-llama', 'llama_index');
    expect(v).toContain('llama index');
    expect(v).toContain('llamaindex');
  });
});

describe('term normalisation', () => {
  it('collapses the spellings of one thing to one key', () => {
    expect(normalizeTerm('Next.js')).toBe('next.js');
    expect(normalizeTerm('Argo CD')).toBe('argo-cd');
    expect(normalizeTerm('argo_cd')).toBe('argo-cd');
    expect(normalizeTerm('  Deno  ')).toBe('deno');
  });

  it('keeps the characters that are part of technology names', () => {
    expect(normalizeTerm('C++')).toBe('c++');
    expect(normalizeTerm('C#')).toBe('c#');
  });
});

describe('mining titles', () => {
  it('finds the naming conventions technologies actually use', () => {
    expect(candidateTerms('OpenTofu 1.9 is out')).toContain('OpenTofu');
    expect(candidateTerms('Building with Next.js and friends')).toContain('Next.js');
    expect(candidateTerms('DuckDB gets a new engine')).toContain('DuckDB');
    expect(candidateTerms('k9s is a terminal UI')).toContain('k9s');
  });

  it('ignores versions, dates and ordinary words', () => {
    const terms = candidateTerms('The new release is now available for version 4.2');
    expect(terms).toEqual([]);
    expect(candidateTerms('Rust v1.85 released')).not.toContain('v1.85');
  });

  it('ignores the vocabulary of a headline rather than its subject', () => {
    // Every one of these cleared the old promotion bar on real data.
    for (const noise of ['GitHub', 'Show HN', 'API', 'AWS', 'blog post']) {
      expect(candidateTerms(`${noise} something happened`)).not.toContain(noise);
    }
  });
});

describe('promotion policy', () => {
  it('promotes a project that publishes its own releases', () => {
    expect(shouldPromote({ origin: 'github_release', mentions: 1, sources: 1 })).toBe(true);
  });

  it('never promotes a word from a headline, however often it appears', () => {
    // The first run of the title tier proposed servethehome, techcrunch, spacex,
    // youtube and linkedin -- all of them clearing "four mentions, two sources".
    // Frequency measures how often something is written down, not whether it is
    // a technology, so this tier queues and never promotes itself.
    expect(shouldPromote({ origin: 'title', mentions: 40, sources: 12 })).toBe(false);
  });
});

// --- tagging -----------------------------------------------------------------

const vocab: StackVocabulary = {
  index: new Map([
    ['go', 'go'],
    ['golang', 'go'],
    ['kubernetes', 'kubernetes'],
    ['k8s', 'kubernetes'],
    ['rust', 'rust'],
    ['d', 'd-lang'],
    ['next.js', 'nextjs'],
    ['argo cd', 'argo-cd'],
    ['postgresql', 'postgresql'],
    ['postgres', 'postgresql'],
  ]),
  canonicalCase: new Map([
    ['go', 'Go'],
    ['d', 'D'],
    ['k8s', 'K8s'],
    ['next.js', 'Next.js'],
  ]),
  // Everything in this fixture was chosen by a person, so the imported-entry
  // rule does not apply to it.
  curated: new Set(['go', 'kubernetes', 'rust', 'd-lang', 'nextjs', 'argo-cd', 'postgresql']),
};

describe('deterministic tagging', () => {
  it('resolves an alias to its canonical slug', () => {
    expect(detectStacks('Migrating to k8s at scale', vocab)).toEqual(['kubernetes']);
    expect(detectStacks('Why we chose Golang', vocab)).toEqual(['go']);
  });

  it('requires a capital for short and ordinary words', () => {
    // The whole reason this pass can run unattended: a Go page that includes
    // every headline containing "go" is not a Go page.
    expect(detectStacks('Go 1.24 is out', vocab)).toEqual(['go']);
    expect(detectStacks('Let it go: why we moved off Kubernetes', vocab)).toEqual(['kubernetes']);
    expect(detectStacks('The d flag is undocumented', vocab)).toEqual([]);
  });

  it('does not match a name inside a longer word', () => {
    expect(detectStacks('Rustic charm in old buildings', vocab)).toEqual([]);
    expect(detectStacks('A postgresqlish approach', vocab)).toEqual([]);
  });

  it('matches names containing punctuation', () => {
    // \\b would treat the dot and the space as boundaries and match the halves.
    expect(detectStacks('Next.js 16 ships', vocab)).toEqual(['nextjs']);
    expect(detectStacks('Argo CD adds a UI', vocab)).toEqual(['argo-cd']);
  });

  it('ignores names that only appear inside URLs', () => {
    // Release notes are full of links; without this every release is "about" the
    // technologies its footer happens to link to.
    expect(detectStacks('See https://kubernetes.io/docs for details', vocab)).toEqual([]);
  });

  it('refuses an ordinary English word from an imported entry', () => {
    // `support` and `first` are real GitHub topics. They are also words, and
    // between them they tagged 331 stories before this rule existed.
    const imported: StackVocabulary = {
      index: new Map([['support', 'support'], ['first', 'first'], ['grafana', 'grafana']]),
      canonicalCase: new Map(),
      curated: new Set(),                       // nothing here was hand-picked
    };
    expect(detectStacks('Rust 1.85 adds support for async closures', imported)).toEqual([]);
    expect(detectStacks('The first release of the year', imported)).toEqual([]);
    expect(detectStacks('Grafana 12 ships', imported)).toEqual(['grafana']);
  });

  it('still trusts an ordinary word a person put in the vocabulary', () => {
    // Go is curated, so it keeps the capitalised-form test rather than losing
    // the right to match at all.
    expect(detectStacks('Go 1.24 is out', vocab)).toEqual(['go']);
  });

  it('finds several technologies in one title', () => {
    const found = detectStacks('Running Rust on Kubernetes with Postgres', vocab).sort();
    expect(found).toEqual(['kubernetes', 'postgresql', 'rust']);
  });
});

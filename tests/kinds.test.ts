import { describe, it, expect } from 'vitest';
import { classify, KINDS, OVERRIDES } from '../src/vocab/kinds.ts';

const row = (
  slug: string, name: string, category: string,
  description: string | null = null, curated = false,
) => ({ slug, name, category, description, curated });

describe('kind classification', () => {
  it('reads the noun out of a definition', () => {
    expect(classify(row('somelinter', 'SomeLinter', 'tooling',
      'SomeLinter is a linter for Go.')).kind).toBe('tool');
    expect(classify(row('someorm', 'SomeORM', 'tooling',
      'SomeORM is a library for talking to databases.')).kind).toBe('stack');
    expect(classify(row('somepractice', 'SomePractice', 'tooling',
      'SomePractice is the act of reviewing code before merge.')).kind).toBe('concept');
  });

  it('prefers the longest matching phrase', () => {
    // "testing framework" is a tool; the "framework" inside it is a stack, and
    // deciding on the shorter one would file Jest next to React.
    expect(classify(row('t', 'T', 'tooling',
      'T is a testing framework for JavaScript.')).kind).toBe('tool');
  });

  it('ignores nouns beyond the definition clause', () => {
    // The trap: a formatter described in terms of the languages it supports.
    expect(classify(row('f', 'F', 'tooling',
      'F is an opinionated code formatter that supports many languages.')).kind).toBe('tool');
  });

  it('treats one-word gerunds as activities, but not short names', () => {
    expect(classify(row('logging', 'Logging', 'devops')).kind).toBe('concept');
    expect(classify(row('marketing', 'Marketing', 'tooling')).kind).toBe('concept');
    // Spring is a framework and would be lost to a naive /ing$/ rule.
    expect(classify(row('spring', 'Spring', 'framework')).kind).toBe('stack');
  });

  it('sends disambiguation pages to concepts', () => {
    expect(classify(row('cd', 'CD (Disambiguation)', 'devops')).kind).toBe('concept');
  });

  it('trusts a category only where the category is the answer', () => {
    expect(classify(row('x', 'X', 'language')).kind).toBe('stack');
    expect(classify(row('y', 'Y', 'practice')).kind).toBe('concept');
    // `tooling` is the discovery loop's dumping ground and decides nothing.
    expect(classify(row('z', 'Z', 'tooling')).why).not.toBe('category');
  });

  it('splits undescribed tooling on whether a person filed it', () => {
    expect(classify(row('a', 'Aaa', 'tooling', null, true)).kind).toBe('tool');
    expect(classify(row('b', 'Bbb', 'tooling', null, false)).kind).toBe('concept');
  });

  it('lets an override beat every rule', () => {
    // Docker's description would read as a tool; it is a runtime you ship on.
    expect(classify(row('docker', 'Docker', 'tooling',
      'Docker is a command-line tool for containers.')).kind).toBe('stack');
  });

  it('never invents a kind outside the three', () => {
    const ids = new Set(KINDS.map((k) => k.id));
    for (const kind of Object.values(OVERRIDES)) expect(ids.has(kind)).toBe(true);
    expect(ids.has(classify(row('unknown', 'Unknown', 'nonsense')).kind)).toBe(true);
  });

  it('is stable: the same row always lands in the same registry', () => {
    const r = row('vite', 'Vite', 'tooling', 'Vite is a build tool.');
    expect(classify(r)).toEqual(classify(r));
  });
});

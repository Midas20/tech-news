// The field report: sentences instead of a river.
//
// Asked for on 2026-08-29 -- "I don't want raw news, this make noise, i want
// report that summarize related news" -- and the noise was real and countable.
// The Solana feed alone contributed nine changes and three releases in a
// fortnight, and the BitMEX feed eleven near-identical delistings. On
// /field/<slug> that is twenty-three rows. Here it is two sentences.
//
// These tests cover the prose rules rather than the queries, because the prose
// is where a report can lie: a plural that does not agree, a percentage from a
// base of one, a subset larger than its set.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { reportDays, __test } from '../src/ui/report.ts';

const { phrase, attribution } = __test;
const g = (o: Partial<Parameters<typeof phrase>[0]>) => ({
  slug: 'x', name: 'X', stories: 0, sources: 1,
  launch: 0, release: 0, change: 0, market: 0, article: 0, titles: [], ...o,
} as Parameters<typeof phrase>[0]);

describe('the period', () => {
  it('defaults to 30 days and survives nonsense', () => {
    expect(reportDays(null)).toBe(30);
    expect(reportDays('')).toBe(30);
    expect(reportDays('nonsense')).toBe(30);
    expect(reportDays('-5')).toBe(30);
    expect(reportDays('0')).toBe(30);
  });

  it('accepts a real number and caps it', () => {
    expect(reportDays('7')).toBe(7);
    expect(reportDays('90')).toBe(90);
    expect(reportDays('99999')).toBe(365);
  });
});

describe('the sentence', () => {
  it('counts in words, and agrees with itself', () => {
    expect(phrase(g({ release: 1 }))).toBe('one release');
    expect(phrase(g({ release: 3 }))).toBe('3 releases');
    expect(phrase(g({ launch: 1, release: 1 }))).toBe('one launch and one release');
    expect(phrase(g({ launch: 2, release: 3, change: 1 })))
      .toBe('2 launches, 3 releases and one change');
  });

  it('omits an empty class rather than reporting a zero', () => {
    // "0 launches" is noise in a sentence whose whole purpose is removing it.
    expect(phrase(g({ change: 2 }))).toBe('2 changes');
    expect(phrase(g({ change: 2 }))).not.toContain('0');
  });

  it('leads with money, because that is the half worth finding', () => {
    expect(phrase(g({ market: 1, change: 9 }))).toBe('one market move and 9 changes');
  });

  it('says so when nothing was classified', () => {
    expect(phrase(g({}))).toBe('nothing classified');
  });

  it('says how many outlets stand behind a group', () => {
    // Nine changes from one source is a changelog. Nine from six is a story.
    expect(attribution(g({ sources: 1 }))).toBe('from a single source');
    expect(attribution(g({ sources: 6 }))).toBe('from 6 sources');
  });
});

describe('claims the page refuses to make', () => {
  const src = readFileSync(new URL('../src/ui/report.ts', import.meta.url), 'utf8');

  it('does not call a change from a tiny base a trend', () => {
    // Up 400% from one story to five is arithmetic, not a trend, and this page
    // exists to stop that kind of sentence.
    expect(src).toContain('prev >= 5');
    expect(src).toContain('too few to call a trend');
  });

  it('does not describe overlapping groups as a subset', () => {
    // A story tagged Kubernetes AND Docker is in both groups, so the sum of the
    // groups routinely exceeds the number of stories. Phrased as "487 of them"
    // the page stated something arithmetically impossible about 354 stories.
    expect(src).toContain('account for ');
    expect(src).not.toMatch(/of them are about the/);
  });

  it('is written from counts rather than by a model', () => {
    // The page's whole value is that every sentence is a number a reader can
    // click through to. An LLM would write nicer prose and could say things the
    // archive does not support.
    // Checked as IMPORTS and CALLS rather than as a word: the header of that
    // file discusses the LLM router at length in order to explain why it is not
    // used, and a naive word search fails on its own reasoning.
    const imports = src.split(/\r?\n/)
      .filter((l) => l.trimStart().startsWith('import '));
    for (const line of imports) {
      expect(line, line).not.toMatch(/llm|anthropic|openai|provider/i);
    }
    expect(src).not.toMatch(/await\s+(complete|generate|summarise|summarize)\s*\(/);
  });

  it('says out loud that a short report may be a registry problem', () => {
    expect(src).toContain('statement about the registry rather than about the field');
  });

  it('offers a longer period rather than an empty page', () => {
    expect(src).toContain('days=180');
  });
});

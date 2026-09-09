// Analysis, as opposed to retelling.
//
// Asked for on 2026-09-09, holding up a briefing that had repeated a Databricks
// conference post almost verbatim: "This report is only repeat of some news
// content... I need strategy info in report not repeat of news, The news is only
// data that prove your analysis result."
//
// The complaint was right and the prompt was not the cause. `fieldCorpus` is
// bounded at both ends by the report window -- deliberately, since 0073, because
// that is what made a daily report actually daily. But a corpus holding one day
// cannot support a claim about direction. The model was asked what is going on
// while holding a single day's stories, and its two options were to repeat the
// post or to invent a trend. It repeated the post, which is the better of them.
//
// So there is now a second pass with the months BEFORE the window in front of
// it. What this file guards is the one rule that makes the result checkable:
//
//   A CLAIM ABOUT CHANGE CITES BOTH ENDS. `then` must land in the earlier
//   corpus and `now` in today's. A model with nothing to compare reaches for
//   two of today's stories and writes a sentence that sounds like a trend and
//   is a restatement -- indistinguishable from a finding unless something
//   checks the indices. So something checks the indices, in code, rather than
//   the prompt asking nicely.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateStrategy, MIN_HISTORY } from '../src/analysis/strategy.ts';
import { historyPacket, historySpan, LOOKBACK_DAYS } from '../src/analysis/context.ts';

const strategy = readFileSync(
  new URL('../src/analysis/strategy.ts', import.meta.url), 'utf8');
const context = readFileSync(
  new URL('../src/analysis/context.ts', import.meta.url), 'utf8');
const spec = readFileSync(new URL('../src/llm/jobs.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/ui/briefing.ts', import.meta.url), 'utf8');

const claim = (over: Record<string, unknown> = {}) => ({
  claim: 'Databricks is making auditability its wedge into regulated finance',
  reasoning: 'Last year the pitch was capability; this year every session is about proof.',
  then: [1], now: [1], ...over,
});

describe('a claim about change must cite both ends', () => {
  it('keeps one that does', () => {
    const out = validateStrategy({ direction: [claim()] }, 10, 10);
    expect(out.direction).toHaveLength(1);
    expect(out.direction[0]!.then).toEqual([1]);
    expect(out.direction[0]!.now).toEqual([1]);
  });

  it('DROPS one with no earlier evidence', () => {
    // The exact failure this exists to prevent: a trend asserted from today.
    expect(validateStrategy({ direction: [claim({ then: [] })] }, 10, 10).direction)
      .toHaveLength(0);
  });

  it('drops one with no recent evidence', () => {
    expect(validateStrategy({ direction: [claim({ now: [] })] }, 10, 10).direction)
      .toHaveLength(0);
  });

  it('drops one whose citations are all out of range', () => {
    // A model citing story 40 of a 10-story corpus has invented a source, and
    // stripping the number leaves the side empty, which drops the claim.
    expect(validateStrategy({ direction: [claim({ then: [99], now: [99] })] }, 10, 10)
      .direction).toHaveLength(0);
  });

  it('checks each side against its OWN corpus', () => {
    // `then` indexes the earlier stories and `now` indexes today's. The two are
    // different lengths, and using one bound for both would silently admit a
    // citation past the end of the shorter list.
    const out = validateStrategy({ direction: [claim({ then: [20], now: [3] })] }, 30, 5);
    expect(out.direction, 'then=20 is past the end of a 5-story history')
      .toHaveLength(0);
  });

  it('strips a bad citation but keeps a claim that still has both ends', () => {
    const out = validateStrategy({ direction: [claim({ then: [1, 99], now: [2] })] }, 10, 10);
    expect(out.direction).toHaveLength(1);
    expect(out.direction[0]!.then).toEqual([1]);
  });

  it('counts a story cited three times as one story', () => {
    const out = validateStrategy({ direction: [claim({ then: [1, 1, 1], now: [2] })] }, 10, 10);
    expect(out.direction[0]!.then).toEqual([1]);
  });

  it('drops a claim with no text, however well cited', () => {
    expect(validateStrategy({ direction: [claim({ claim: '  ' })] }, 10, 10).direction)
      .toHaveLength(0);
  });

  it('survives a model returning nothing, or nonsense', () => {
    for (const raw of [{}, { direction: null as never }, { direction: ['x' as never] }]) {
      expect(() => validateStrategy(raw, 10, 10)).not.toThrow();
      expect(validateStrategy(raw, 10, 10).direction).toEqual([]);
    }
  });
});

describe('positioning may be read from today, and still cites it', () => {
  const pos = (over: Record<string, unknown> = {}) => ({
    who: 'Databricks', bet: 'governance as the wedge into regulated finance',
    evidence: [1], firstParty: true, ...over,
  });

  it('keeps a cited bet', () => {
    // What a company ships and chooses to talk about is visible in one post, so
    // this one does not need the earlier corpus -- but it does need a citation.
    expect(validateStrategy({ positioning: [pos()] }, 10, 0).positioning).toHaveLength(1);
  });

  it('drops an uncited bet', () => {
    expect(validateStrategy({ positioning: [pos({ evidence: [] })] }, 10, 10).positioning)
      .toHaveLength(0);
  });

  it('drops one with no named company', () => {
    // "vendors are betting on X" is the claim this whole design refuses.
    expect(validateStrategy({ positioning: [pos({ who: '' })] }, 10, 10).positioning)
      .toHaveLength(0);
  });

  it('records whether the evidence is the company talking about itself', () => {
    const said = validateStrategy({ positioning: [pos({ firstParty: true })] }, 10, 10);
    expect(said.positioning[0]!.firstParty).toBe(true);
    const other = validateStrategy({ positioning: [pos({ firstParty: false })] }, 10, 10);
    expect(other.positioning[0]!.firstParty).toBe(false);
  });

  it('defaults firstParty to false rather than to true', () => {
    // Absent means unknown, and marking an unknown as first-party would label a
    // journalist's report as a press release.
    const out = validateStrategy(
      { positioning: [{ who: 'X', bet: 'y', evidence: [1] }] }, 10, 10);
    expect(out.positioning[0]!.firstParty).toBe(false);
  });
});

describe('openings', () => {
  it('keeps a cited one and drops an uncited one', () => {
    const base = { what: 'nobody sells the audit trail', why: 'because', evidence: [1] };
    expect(validateStrategy({ openings: [base] }, 10, 10).openings).toHaveLength(1);
    expect(validateStrategy({ openings: [{ ...base, evidence: [] }] }, 10, 10).openings)
      .toHaveLength(0);
  });

  it('leaves `who` off entirely when the model did not say', () => {
    const out = validateStrategy(
      { openings: [{ what: 'a gap', why: 'because', evidence: [1] }] }, 10, 10);
    expect(out.openings[0]).not.toHaveProperty('who');
  });
});

describe('an empty history is said, never implied', () => {
  it('tells the model it cannot claim direction', () => {
    const said = historyPacket([]);
    expect(said).toContain('none');
    expect(said).toMatch(/cannot say anything about how they have changed/);
  });

  it('numbers earlier stories in their own series', () => {
    // Two separate numberings would collide the moment the model cited "4", and
    // a citation that could mean either set proves nothing -- which defeats the
    // point of making it cite both.
    const said = historyPacket([{
      id: '1', title: 'An older release', summary: 'x', url: 'u', source: 'S',
      sourceType: null, rung: 'r', independent: true, kind: 'release',
      when: '2026-03-01', stacks: [], companies: [], platforms: [], importance: 1,
    }]);
    expect(said).toContain('P1.');
    expect(said).not.toMatch(/^\[1\]/m);
  });

  it('reports the span actually read, not the span requested', () => {
    // A reader judging a claim needs to know whether it was drawn against six
    // months or four days.
    const item = (when: string) => ({
      id: when, title: 't', summary: 's', url: 'u', source: 'S', sourceType: null,
      rung: 'r', independent: true, kind: 'release', when,
      stacks: [], companies: [], platforms: [], importance: 1,
    });
    expect(historySpan([item('2026-05-01'), item('2026-01-01')]))
      .toEqual({ from: '2026-01-01', to: '2026-05-01', n: 2 });
    expect(historySpan([])).toBeNull();
  });

  it('refuses to write at all below a minimum history', () => {
    expect(MIN_HISTORY).toBeGreaterThan(0);
    expect(strategy).toContain("return { status: 'no_history', prior: prior.length }");
  });
});

describe('the history is about the same things as today', () => {
  it('is led by today’s subjects, not by the whole field', () => {
    // Six months of a field's general background is background, and a model
    // asked to find a trend in background will find one.
    expect(context).toContain('s.stacks && $1::text[]');
    expect(context).toMatch(/SUBJECT-LED, NOT FIELD-LED/);
  });

  it('cannot overlap the window it is being compared against', () => {
    // Overlapping sets would let a "this changed" claim cite the same story as
    // both the before and the after.
    expect(context).toMatch(/coalesce\(s\.published_at, s\.collected_at\) < \$2/);
  });

  it('reaches further back than the retention window', () => {
    expect(LOOKBACK_DAYS).toBeGreaterThan(120);
  });
});

describe('the two passes stay separate', () => {
  it('asks for strategy in its own job, not by lengthening the briefing', () => {
    // They want opposite things: field_briefing must NOT generalise, because v2
    // abstracted real events into filing labels. Strategy is abstraction done on
    // purpose. One prompt asked for both produces the average of the two.
    expect(spec).toContain('field_strategy:');
    expect(spec).toContain('field_briefing:');
  });

  it('still forbids counting our own stories', () => {
    const block = spec.slice(spec.indexOf('field_strategy:'));
    expect(block).toContain('NEVER COUNT THE STORIES');
    expect(block).toMatch(/"a wave of", "increasingly"/);
  });

  it('separates what a company says about itself from what happened', () => {
    const block = spec.slice(spec.indexOf('field_strategy:'));
    expect(block).toMatch(/POSITIONING, NOT ADOPTION/);
  });

  it('is not fatal to the briefing when it fails', () => {
    // A briefing that exists is worth keeping whether or not a reading could be
    // drawn from it.
    const briefing = readFileSync(
      new URL('../src/analysis/briefing.ts', import.meta.url), 'utf8');
    expect(briefing).toMatch(/analyseField\([^)]*\)\s*\n?\s*\.catch/);
  });
});

describe('the page leads with the reading', () => {
  it('puts the analysis above the retelling', () => {
    // A reader who has to scroll past the news to reach the analysis is reading
    // a news summary with an appendix, which is what was complained about.
    // The heading was "What happened, in full" until the section was demoted to
    // supporting evidence and renamed to say so.
    const readingAt = page.indexOf('strategyBlock(b.strategy)');
    const newsAt = page.indexOf('The stories this was read from');
    expect(readingAt).toBeGreaterThan(0);
    expect(newsAt).toBeGreaterThan(0);
    expect(readingAt).toBeLessThan(newsAt);
  });

  it('says when there is no reading, rather than showing nothing', () => {
    expect(page).toContain('No strategic reading for this field today');
    expect(page).toMatch(/not a\s*\n?\s*statement that nothing changed/);
  });

  it('marks a first-party bet on the page, not just in the data', () => {
    expect(page).toMatch(/Read from what they say about/);
  });

  it('shows how far back the reading was drawn', () => {
    // Moved out of the reading block and into the single caveat block, with the
    // rest of the provenance -- the scattered notes were the reason the page
    // read as messy.
    expect(page).toMatch(/The reading was set against/);
    expect(page).toMatch(/b\.strategy\.history\.n/);
  });
});

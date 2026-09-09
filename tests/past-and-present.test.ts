// The relationship between past and present, which the report kept losing.
//
// Reported on 2026-09-09, after the strategy pass had already shipped: "still
// you focus on only current news, you don't analysis the relationship between
// past and current of the fields, and I still can't find the market change."
//
// The strategy pass WAS reading history. Three separate things made that
// invisible, and each has a test here:
//
//   1. THE HISTORY WAS NOT HISTORY. `priorContext` took the top 40 by
//      importance, ties broken by date descending, from an archive holding 557
//      stories in August and 93 in March. Measured for `practice`: 31 of 40
//      from the last five weeks, 4 from before July. A model asked how six
//      months changed, holding one month of stories, writes about one month.
//
//   2. THE EARLIER END WAS NEVER SHOWN. Storage kept `now` as citations and
//      reduced `then` to a count, so every claim about change rendered with
//      today's evidence and a sentence saying four other stories existed.
//
//   3. NOTHING SAID WHAT CHANGED. `direction` said it three times, some way
//      down the page, one claim at a time. Nowhere did the report say, in one
//      line, what is different now from before.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stratify, historyPacket, PERIODS, HISTORY_CAP } from '../src/analysis/context.ts';
import { validateStrategy } from '../src/analysis/strategy.ts';
import type { Item } from '../src/analysis/corpus.ts';

const page = readFileSync(new URL('../src/ui/briefing.ts', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/analysis/briefing.ts', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../src/ui/theme.ts', import.meta.url), 'utf8');
const spec = readFileSync(new URL('../src/llm/jobs.ts', import.meta.url), 'utf8');
const strategyPrompt = spec.slice(spec.indexOf('field_strategy:'));

const item = (when: string, id = when, importance = 1): Item => ({
  id, title: `story ${id}`, summary: 'x'.repeat(80), url: `https://e.test/${id}`,
  source: `S${id.slice(-1)}`, sourceType: null, rung: 'r', independent: true,
  kind: 'release', when, stacks: ['k8s'], companies: [], platforms: [], importance,
});

/** Six months of stories shaped like the real archive: recent months are busier. */
function lopsided(): Item[] {
  const out: Item[] = [];
  const perMonth: Record<string, number> = {
    '2026-03': 4, '2026-04': 6, '2026-05': 10, '2026-06': 16, '2026-07': 30, '2026-08': 90,
  };
  for (const [month, n] of Object.entries(perMonth)) {
    for (let d = 1; d <= n; d += 1) {
      // Importance rises with recency too, which is what defeated the old
      // ordering twice over rather than once.
      out.push(item(`${month}-${String((d % 27) + 1).padStart(2, '0')}`,
        `${month}-${d}`, month === '2026-08' ? 9 : 3));
    }
  }
  return out;
}

describe('the history spans the months, not the last five weeks', () => {
  const picked = stratify(lopsided(), '2026-09-01T00:00:00Z', 180, HISTORY_CAP, 'cloud');

  it('draws from every month that has stories', () => {
    // THE BUG THIS EXISTS TO CATCH. Before stratifying, `practice` came back
    // with 31 of 40 stories from the last five weeks and one from April.
    const months = new Set(picked.map((p) => p.when.slice(0, 7)));
    expect(months.size).toBeGreaterThanOrEqual(5);
    expect(months.has('2026-03'), 'the far end of the lookback must be represented')
      .toBe(true);
  });

  it('does not let the busiest month take the packet', () => {
    const august = picked.filter((p) => p.when.startsWith('2026-08')).length;
    // 90 of the 156 candidates are August and all of them outrank everything
    // else on importance. An even share would be a sixth; the guard is that it
    // is nowhere near the two thirds it used to be.
    expect(august).toBeLessThan(picked.length / 2);
  });

  it('returns them oldest first, so the numbering runs forwards through time', () => {
    // Not cosmetic: the packet numbers stories in array order, so this is what
    // makes "P3 against P37" visibly a claim about a span.
    const dates = picked.map((p) => p.when);
    expect([...dates].sort()).toEqual(dates);
  });

  it('never exceeds the cap, and never repeats a story', () => {
    expect(picked.length).toBeLessThanOrEqual(HISTORY_CAP);
    expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length);
  });

  it('survives a field with only one month of history', () => {
    // Everything lands in one period and the diversity caps still apply inside
    // it -- twelve stories on one subject are capped exactly as they would be
    // without stratifying, since perSubject is 3 with a hard multiple of 2.
    // What is asserted is that the rotation does not COLLAPSE when five of the
    // six periods are empty, which is the failure mode a round-robin invites.
    const only = Array.from({ length: 12 },
      (_, i) => item(`2026-08-${String(i + 1).padStart(2, '0')}`, `a${i}`));
    const out = stratify(only, '2026-09-01T00:00:00Z', 180, HISTORY_CAP, 'cloud');
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((o) => o.when.startsWith('2026-08'))).toBe(true);
  });

  it('caps per source WITHIN a month, not only across the packet', () => {
    // The reason to diversify each period rather than the merged result: one
    // publisher that was loud in May must not be what May looks like, even if
    // the packet as a whole is balanced.
    const may = Array.from({ length: 20 }, (_, i) => ({
      ...item('2026-05-10', `m${i}`), source: 'Loud Co',
      stacks: [`s${i % 7}`],
    }));
    const out = stratify(may, '2026-09-01T00:00:00Z', 180, HISTORY_CAP, 'cloud');
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it('does not drop a story whose date will not parse', () => {
    // A story with a bad date is still evidence, and silently losing evidence
    // is worse than filing it in the wrong month.
    const out = stratify([item('not-a-date', 'bad'), item('2026-05-04', 'ok')],
      '2026-09-01T00:00:00Z', 180, HISTORY_CAP, 'cloud');
    expect(out).toHaveLength(2);
  });

  it('splits the lookback into more than a couple of periods', () => {
    expect(PERIODS).toBeGreaterThanOrEqual(4);
  });
});

describe('the packet shows the arc rather than merely containing it', () => {
  const packet = historyPacket([
    item('2026-03-02', 'a'), item('2026-03-19', 'b'), item('2026-08-30', 'c'),
  ]);

  it('groups the earlier stories by month', () => {
    expect(packet).toContain('--- 2026-03 ---');
    expect(packet).toContain('--- 2026-08 ---');
  });

  it('numbers them in ONE ascending series across the groups', () => {
    // Per-group numbering would make P3 ambiguous, and the citation check in
    // validateStrategy is an index into a single flat array.
    expect(packet).toContain('P1.');
    expect(packet).toContain('P2.');
    expect(packet).toContain('P3.');
  });

  it('tells the model what the two ends of the list are for', () => {
    expect(packet).toMatch(/earliest group and the latest group/);
  });

  it('still says plainly when there is no history at all', () => {
    expect(historyPacket([])).toMatch(/cannot say anything about how they have changed/);
  });
});

describe('what has changed, said once and cited at both ends', () => {
  const shift = (over: Record<string, unknown> = {}) => ({
    before: 'In March the argument was whether the models could do the work.',
    after: 'Today it is what a run costs and who is liable when it is wrong.',
    moved: 'The question moved from capability to price and liability.',
    then: [1], now: [1], ...over,
  });

  it('keeps one cited from both corpora', () => {
    const out = validateStrategy({ shift: shift() }, 10, 10);
    expect(out.shift).not.toBeNull();
    expect(out.shift!.moved).toContain('capability to price');
  });

  it('DROPS one with no earlier citation', () => {
    // The most prominent paragraph on the page is the one most worth inventing
    // and the one a reader is least likely to check.
    expect(validateStrategy({ shift: shift({ then: [] }) }, 10, 10).shift).toBeNull();
  });

  it('drops one with no recent citation', () => {
    expect(validateStrategy({ shift: shift({ now: [] }) }, 10, 10).shift).toBeNull();
  });

  it('drops one whose citations are out of range', () => {
    expect(validateStrategy({ shift: shift({ then: [99] }) }, 10, 10).shift).toBeNull();
  });

  it('drops one that is missing any of its three pieces of prose', () => {
    for (const gap of ['before', 'after', 'moved']) {
      expect(validateStrategy({ shift: shift({ [gap]: '  ' }) }, 10, 10).shift,
        gap).toBeNull();
    }
  });

  it('survives a model that omits it, or returns nonsense in its place', () => {
    for (const raw of [{}, { shift: null }, { shift: 'a string' }, { shift: [] }]) {
      expect(() => validateStrategy(raw as never, 10, 10)).not.toThrow();
      expect(validateStrategy(raw as never, 10, 10).shift).toBeNull();
    }
  });

  it('is asked for as a change of subject, never a change of volume', () => {
    expect(strategyPrompt).toMatch(/change of subject, not a change of volume/);
  });

  it('permits "nothing moved" as an answer', () => {
    // A field standing still is a real finding, and inventing motion in one is
    // the worst thing this can do to a reader choosing where to spend months.
    expect(strategyPrompt).toMatch(/a field standing still is a real and/);
  });

  it('tells the model to cite the EARLIEST months as the earlier end', () => {
    expect(strategyPrompt).toContain('the EARLIEST months you were given');
    expect(strategyPrompt).toContain('last week as "before" is the failure');
  });

  it('leads the page, above the work and the vendor strategy', () => {
    const shiftAt = page.indexOf('What has changed in this field');
    const workAt = page.indexOf('Where the work is');
    expect(shiftAt).toBeGreaterThan(0);
    expect(shiftAt).toBeLessThan(workAt);
  });

  it('renders both ends side by side, and both are styled', () => {
    expect(page).toContain('mv-then-now');
    expect(theme).toMatch(/\.mv-then-now\{/);
    expect(theme).toMatch(/\.mv-shift\{/);
  });
});

describe('the earlier end of a claim survives into storage', () => {
  it('copies the prior citations instead of counting them', () => {
    // THE BUG: `thenCount: d.then.length` and nothing else, so every claim
    // about change displayed only the present. emerging_sightings has copied
    // its citations since 0074 for exactly this reason.
    expect(store).toMatch(/then: d\.then\.map\(priorCite\(b\)\)/);
    expect(store).toMatch(/priorCorpus/);
  });

  it('keeps thenCount as well, for the readings written before it', () => {
    // Dropping it would blank the earlier end on every report already stored.
    expect(store).toMatch(/thenCount: d\.then\.length/);
    expect(page).toMatch(/written before the earlier end was stored/);
  });

  it('resolves the shift citations the same way', () => {
    expect(store).toMatch(/then: b\.strategy\.shift\.then\.map\(priorCite\(b\)\)/);
  });

  it('renders the earlier stories as links when they are there', () => {
    expect(page).toMatch(/d\.then\?\.length \? `<div class="mv-then-now">/);
  });
});

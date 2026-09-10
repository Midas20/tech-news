// An absent analysis section is a claim, and it was making a false one.
//
// "check this url http://.../reports/month/2026-06, there aren't any report"
// (2026-09-10). The page was not blank -- it was the largest month page in the
// archive, 55KB of launches, funding, new names and a curve table. What it had
// no trace of was the analysis: `findings()` returns an empty string when it
// has nothing, so the section did not appear at all.
//
// For every period before 2026-09-09 that silence was a false statement. This
// archive did not write its first daily reading until then, so June has no
// analysis for a reason that has nothing whatever to do with June, and a reader
// could not tell a quiet month from an unwatched one.
//
// The archive already refuses this everywhere else -- `brokenCurves` exists
// purely so a withheld curve says it is withheld, and `noCurves` says why a
// week is too short to measure. The findings section was the one place the rule
// was not applied, and it is the half of the page a reader came for.
//
// THE THREE CASES MUST NOT SHARE A SENTENCE. "No analysis" covers a period
// nobody was watching, a period something was watching and every provider
// refused, and a period that simply predates the feature. Those are three
// different facts about three different problems, and only one of them is ever
// going to be fixed by waiting.

import { describe, it, expect } from 'vitest';
import { bodyOf } from '../src/ui/period.ts';
import type { PeriodReport, ReadingCoverage } from '../src/analysis/period.ts';

/** A period report with nothing in it but the coverage under test. */
function report(readings: ReadingCoverage, over = {}): PeriodReport {
  return {
    span: 'month', key: '2026-06',
    range: { from: '2026-06-01', to: '2026-07-01', label: 'June 2026' },
    days: 30,
    launches: [], market: [], names: [], movements: [], findings: [],
    shift: null,
    totals: { launches: 0, market: 0 },
    readings,
    ...over,
  } as PeriodReport;
}

const strip = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('a period before the archive ever read anything', () => {
  const html = strip(bodyOf(report(
    { briefings: 0, withReading: 0, firstEver: '2026-09-09' })));

  it('says the reading did not exist yet, and when it started', () => {
    expect(html).toContain('9 September 2026');
    expect(html).toContain('fact about this archive');
  });

  it('does not let the reader take it as a quiet month', () => {
    // The whole failure in one assertion. An empty section says "nothing was
    // found"; this has to say "nothing was looking".
    expect(html).not.toMatch(/nothing (happened|moved|was found)/i);
    expect(html).toContain('What the readings found');
  });

  it('says the analysis cannot be recovered by reloading', () => {
    // The stories were collected at the time and the analysis was not. A reader
    // who thinks this is a rendering problem will come back tomorrow.
    expect(html).toContain('cannot be recovered');
  });
});

describe('a period something was watching, where no model would answer', () => {
  const html = strip(bodyOf(report(
    { briefings: 5, withReading: 0, firstEver: '2026-09-09' },
    { range: { from: '2026-09-01', to: '2026-10-01', label: 'September 2026' },
      key: '2026-09' })));

  it('says the summaries were written and the analysis was not', () => {
    expect(html).toContain('5 field briefings');
    expect(html).toContain('provider failure');
  });

  it('is explicitly not a statement about the period', () => {
    // 2026-09-10 was exactly this: five fields briefed, five readings refused
    // by every provider in the chain. Reporting that as a quiet month would
    // have been the archive lying about the industry to cover its own budget.
    expect(html).toContain('not a quiet');
  });

  it('points at where the actual reason is written down', () => {
    expect(html).toContain('which model refused it');
  });
});

describe('a period no report ever ran over, after readings began', () => {
  const html = strip(bodyOf(report(
    { briefings: 0, withReading: 0, firstEver: '2026-09-09' },
    { range: { from: '2026-10-01', to: '2026-11-01', label: 'October 2026' },
      key: '2026-10' })));

  it('says no report ran, rather than that nothing was found', () => {
    expect(html).toContain('no report ran');
  });
});

describe('an archive that has never written a reading at all', () => {
  const html = strip(bodyOf(report(
    { briefings: 0, withReading: 0, firstEver: null })));

  it('says so without inventing a date', () => {
    expect(html).toContain('nothing has been read yet');
    expect(html).not.toContain('Invalid Date');
    expect(html).not.toContain('null');
  });
});

describe('a period that did find things', () => {
  const html = strip(bodyOf(report(
    { briefings: 5, withReading: 5, firstEver: '2026-09-09' },
    { findings: [{ field: 'ai', day: '2026-09-10', kind: 'direction',
      text: 'The agent pitch has moved from how clever the model is to what it '
        + 'is allowed to touch' }] })));

  it('shows the findings and none of the explanations', () => {
    expect(html).toContain('allowed to touch');
    expect(html).not.toContain('provider failure');
    expect(html).not.toContain('no report ran');
    expect(html).not.toContain('nothing has been read yet');
  });
});

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
import { readFileSync } from 'node:fs';
import { bodyOf, notRead } from '../src/ui/period.ts';
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

describe('a period that did find things', () => {
  const html = strip(bodyOf(report(
    { briefings: 5, withReading: 5, firstEver: '2026-09-09', stories: 400, sources: 30, topPct: 30 },
    { findings: [{ field: 'ai', day: '2026-09-10', kind: 'direction',
      text: 'The agent pitch has moved from how clever the model is to what it '
        + 'is allowed to touch',
      then: [{ title: 'Claude 3.5 Sonnet is the most capable model yet',
        when: '2026-03-04', source: 'Anthropic', id: 'a1' }],
      now: [{ title: 'AWS opens its Agent Registry with scoped identities',
        when: '2026-09-10', source: 'AWS News Blog', id: 'b2' }] }] })));

  it('shows the findings and none of the explanations', () => {
    expect(html).toContain('allowed to touch');
    expect(html).not.toContain('provider failure');
    expect(html).not.toContain('no report ran');
    expect(html).not.toContain('nothing has been read yet');
  });
});

// ---------------------------------------------------------------------------
// The finding is the pair, not the sentence
// ---------------------------------------------------------------------------
//
// "the report still looks like filter news by date. The core content [is] the
// result that analysis the news in the period with old news that related to
// each news" -- 2026-09-10.
//
// The claims were already on the page and the pairing was not, so it read as a
// run of assertions over a date range. A claim about change whose earlier end is
// invisible cannot be told apart from a claim about today.
//
// The data was there the whole time: `then` and `now` are copied onto every
// reading at write time -- precisely because retention deletes the stories
// within four months and the comparison has to outlive them -- and the period
// page simply never read them. Measured on 2026-09-10, ten of twelve directional
// claims and five of five shifts carried a populated earlier end.

const finding = (over = {}) => ({
  field: 'ai', day: '2026-09-10', kind: 'direction' as const,
  text: 'The agent pitch has moved from how clever the model is to what it is '
    + 'allowed to touch',
  then: [{ title: 'Claude 3.5 Sonnet is the most capable model yet',
    when: '2026-03-04', source: 'Anthropic', id: 'a1' }],
  now: [{ title: 'AWS opens its Agent Registry with scoped identities',
    when: '2026-09-10', source: 'AWS News Blog', id: 'b2' }],
  ...over,
});

describe('a claim is shown against the story it revises', () => {
  const html = strip(bodyOf(report(
    { briefings: 5, withReading: 5, firstEver: '2026-09-09', stories: 400, sources: 30, topPct: 30 },
    { findings: [finding()] })));

  it('shows both ends, labelled', () => {
    expect(html).toContain('Before');
    expect(html).toContain('Now');
    expect(html).toContain('Claude 3.5 Sonnet');
    expect(html).toContain('AWS opens its Agent Registry');
  });

  it('dates each end, so the reader can see the gap', () => {
    // "Before" and "Now" mean nothing without the two dates: six months apart
    // is a direction, six hours apart is the same story twice.
    expect(html).toContain('2026-03-04');
    expect(html).toContain('2026-09-10');
  });

  it('leads the page with the analysis, not with the inventories', () => {
    const full = bodyOf(report(
      { briefings: 5, withReading: 5, firstEver: '2026-09-09', stories: 400, sources: 30, topPct: 30 },
      { findings: [finding()],
        names: [{ name: 'VCR', sources: 1, stories: [{ when: '2026-06-29' }] }] }));
    expect(full.indexOf('What changed, and against what'))
      .toBeLessThan(full.indexOf('Names this archive had never seen'));
  });
});

describe('a claim with no earlier end', () => {
  const html = strip(bodyOf(report(
    { briefings: 5, withReading: 5, firstEver: '2026-09-09', stories: 400, sources: 30, topPct: 30 },
    { findings: [finding({ then: [] })] })));

  it('says the earlier end is missing rather than implying there was none', () => {
    // The same rule as everywhere else on these pages: an absent half reads as
    // "nothing came before", which is a claim about the industry rather than
    // about the archive's depth on that subject.
    expect(html).toMatch(/No earlier story on this subject is held/i);
  });

  it('is counted in the note at the top', () => {
    expect(html).toMatch(/1 of 1 had no earlier end/i);
  });
});

describe('a reading stored before the pairing existed', () => {
  it('renders without throwing', () => {
    // These come out of a jsonb column. A page that 500s on a row written last
    // week is worse than one that shows the claim without its earlier end.
    const old = { field: 'ai', day: '2026-09-09', kind: 'direction' as const,
      text: 'Cost per solved task has moved out of the footnotes' };
    expect(() => bodyOf(report(
      { briefings: 4, withReading: 4, firstEver: '2026-09-09', stories: 400, sources: 30, topPct: 30 },
      { findings: [old] }))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Ten years exist. Eight of them cannot be read.
// ---------------------------------------------------------------------------
//
// "Generate all report of 10 years" (2026-09-10). The archive does hold ten
// years. Measured that day:
//
//   year   stories   sources   top 3 publishers
//   2017        27         4              96%
//   2019        54         5              91%
//   2021       121         5              93%
//   2024       389         8              93%
//   2025       934        15              87%
//   2026     3,995       106              35%
//
// 1,392 of the 1,402 stories before 2025 come from five vendor blogs -- Hugging
// Face, ClickHouse, Shopify, Vercel, OpenAI -- which are there because those
// blogs keep deep archives a backfill could walk. That is a fact about their
// publishing software, not about those years.
//
// A 2019 report drawn from that corpus would read plausibly and every claim in
// it would be a claim about three companies. This archive already refuses to
// count its own stories because the feed list is not the industry; publishing a
// year drawn from three publishers is the same error one level up.

import { topShare, MAX_TOP_SHARE, MIN_PERIOD_SOURCES } from '../src/analysis/periodread.ts';

const from = (sources: string[]) =>
  sources.map((s) => ({ source: s })) as never[];

describe('how much of a period its biggest publishers hold', () => {
  it('is 1 for a period nobody but one publisher covered', () => {
    expect(topShare(from(['Vercel', 'Vercel', 'Vercel']))).toBe(1);
  });

  it('counts the three largest, not the largest', () => {
    // 6 of 8 from three publishers.
    expect(topShare(from(['a', 'a', 'b', 'b', 'c', 'c', 'd', 'e'])))
      .toBeCloseTo(0.75, 2);
  });

  it('treats an empty period as wholly concentrated rather than wholly diverse', () => {
    // The safe direction: 0/0 must refuse, not pass. Returning 0 here would
    // make every empty period look like the most diverse corpus in the archive.
    expect(topShare([])).toBe(1);
  });
});

describe('the threshold sits in the gap, not at its edge', () => {
  it('admits 2026 and refuses 2025, which is the measured break', () => {
    // 2026: 35% from three publishers, 106 sources. 2025: 87%, 15 sources.
    // Nothing between them, which is why 60% is a line and not a guess.
    expect(0.35).toBeLessThan(MAX_TOP_SHARE);
    expect(0.87).toBeGreaterThan(MAX_TOP_SHARE);
  });

  it('also floors the publisher count, which is what catches 2023 and 2024', () => {
    // Those two pass the share test once diversify has capped each publisher
    // (56% and 47%) and are still seven and eight blogs. Diversifying a narrow
    // corpus makes it look balanced without making it broad.
    expect(MIN_PERIOD_SOURCES).toBeGreaterThan(8);
  });
});

describe('a period that was refused for its sources', () => {
  const html = strip(bodyOf(report(
    { briefings: 0, withReading: 0, firstEver: '2026-09-09',
      stories: 389, sources: 8, topPct: 93 },
    { range: { from: '2024-01-01', to: '2025-01-01', label: '2024' },
      span: 'year', key: '2024' })));

  it('is not on the page at all -- this note belongs to the reading block', () => {
    // bodyOf renders the findings; the refusal note is rendered by
    // renderPeriodReport beside the reading. Asserted so the two do not
    // silently start duplicating each other.
    expect(html).not.toContain('it is the sources rather than');
  });
});

// ---------------------------------------------------------------------------
// An absence says what it is ONCE
// ---------------------------------------------------------------------------
//
// "Do you think this is correct report, Remove these content and give me
// correct report" -- 2026-09-10, against a month page carrying, in order:
//
//   1. "Not read yet ... the period-reading job takes one unread period an
//      hour whenever a provider is reachable"
//   2. "No model wrote any of this."
//   3. "What the readings found -- Nothing, and that is a fact about this
//      archive rather than about the month" + three more sentences
//   4. a one-item list under two lines of disclaimer
//   5. "20 stories were classed as introducing something ... They are not
//      listed here -- a list of headlines is not a finding"
//
// Five blocks, four about the page rather than the month. Every one of them was
// added deliberately, each defensible on its own: an absence must say what it
// is. The rule was right and the accumulation was not. Stacked, they became the
// exact thing they were written to prevent -- a page mostly about itself.
//
// So the rule gains a second half: an absence says what it is once, and only
// where a reader could otherwise draw a false conclusion. "This is pending" is
// not a false conclusion. Neither is a missing section a reader never knew to
// expect.

describe('a period with no reading of its own', () => {
  it('says nothing about the job that will produce it', () => {
    // A reader does not have a scheduler and cannot act on one. This told them
    // about the software instead of about the month.
    //
    // Asserted against the RENDERED note, not the source: the first version of
    // this test read period.ts and failed on the comment that explains the
    // removal, which is a test catching its own documentation.
    const out = notRead(report(
      { briefings: 0, withReading: 0, firstEver: '2026-09-09',
        stories: 164, sources: 17, topPct: 40 }), 'month');
    expect(out).not.toMatch(/job|hour|provider|reachable/i);
    expect(strip(out).trim()).toBe('Not read yet.');
  });

  it('still explains the one case that never resolves itself', () => {
    // Too few publishers is permanent and is not what a reader would assume,
    // so it keeps its sentence. Everything else here fixes itself.
    const page = readFileSync(
      new URL('../src/ui/period.ts', import.meta.url), 'utf8');
    expect(page).toMatch(/it is the\s+sources rather than the/);
  });
});

describe('the daily-readings section no longer competes with the period reading', () => {
  it('renders nothing at all when there are no findings', () => {
    // Two sections used to explain the same silence in different words, one of
    // them at four sentences. The period reading is the analysis; this section
    // collects the daily ones, and having nothing to collect is not news.
    const html = strip(bodyOf(report(
      { briefings: 0, withReading: 0, firstEver: '2026-09-09',
        stories: 400, sources: 30, topPct: 30 })));
    expect(html).not.toContain('What the readings found');
    expect(html).not.toContain('fact about this archive');
  });

  it('still renders them when there are some', () => {
    const html = strip(bodyOf(report(
      { briefings: 5, withReading: 5, firstEver: '2026-09-09',
        stories: 400, sources: 30, topPct: 30 },
      { findings: [finding()] })));
    expect(html).toContain('What changed, and against what');
    expect(html).toContain('allowed to touch');
  });
});

describe('what is no longer explained', () => {
  const page = readFileSync(
    new URL('../src/ui/period.ts', import.meta.url), 'utf8');

  it('does not describe the launch list it stopped showing', () => {
    // Explaining a removal forever is worse than the removal. The launches are
    // on /whatsnew, which is where somebody wanting a list of launches goes.
    expect(page).not.toMatch(/They are not listed here/);
  });

  it('does not disclaim a block small enough to judge at a glance', () => {
    // "Named in a headline and in none of the registries this archive holds. A
    // weak test: an absence here means nothing." -- two lines of hedge over one
    // name and its date.
    expect(page).not.toMatch(/A weak test:/);
  });
});

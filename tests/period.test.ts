// Reports over a week, a month and a year.
//
// Asked for on 2026-09-09, against a screenshot of /reports: "at the top of
// list, you have to display report that summary all day's news and about new
// market and things like tool, platform and so on. And make weekly report and
// month report. And generate a year's report by collecting all news."
//
// The design decision this file mostly guards is that NO MODEL WRITES ANY OF
// IT. A year holds 5,461 stories and does not fit in a prompt; every provider
// was inside a cooldown on the day this was written, so the daily report had
// just failed all fourteen fields in 9.7 seconds; and the material -- the
// classifier's verdicts, the public curves, the claims the daily readings
// already made -- is written already. Composing is not a weaker version of
// asking a model. It is the version that exists on the day you want it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  rangeFor, edgeFor, movementOver, isSpan, keyFor, weekStart,
  detectCohortBreak, SPAN_DAYS,
} from '../src/analysis/period.ts';
import { stepKey } from '../src/ui/report.ts';

const period = readFileSync(
  new URL('../src/analysis/period.ts', import.meta.url), 'utf8');
const page = readFileSync(
  new URL('../src/ui/period.ts', import.meta.url), 'utf8');
const index = readFileSync(
  new URL('../src/ui/briefing.ts', import.meta.url), 'utf8');
const server = readFileSync(
  new URL('../src/ui/server.ts', import.meta.url), 'utf8');
const report = readFileSync(
  new URL('../src/ui/report.ts', import.meta.url), 'utf8');

describe('a period is a calendar period, not a rolling window', () => {
  it('reads a year as that whole calendar year', () => {
    const r = rangeFor('year', '2026')!;
    expect(r.from).toBe('2026-01-01T00:00:00.000Z');
    expect(r.to).toBe('2027-01-01T00:00:00.000Z');
    expect(r.label).toBe('2026');
  });

  it('reads a month as that whole calendar month, and names it', () => {
    // "A month report" means September, not the last thirty days: two of them
    // are only comparable if the boundaries are the same boundaries each time.
    const r = rangeFor('month', '2026-09')!;
    expect(r.from).toBe('2026-09-01T00:00:00.000Z');
    expect(r.to).toBe('2026-10-01T00:00:00.000Z');
    expect(r.label).toBe('September 2026');
  });

  it('crosses a year boundary correctly', () => {
    expect(rangeFor('month', '2026-12')!.to).toBe('2027-01-01T00:00:00.000Z');
  });

  it('reads a week as the ISO week CONTAINING the date', () => {
    // It was "the seven days ending on the date", and the two agree for one
    // date in seven. "I want you make report every week" (2026-09-09) is what
    // exposed it: a trailing window cannot enumerate, because every date names
    // a different overlapping week and no set of them partitions a year.
    const r = rangeFor('week', '2026-09-09')!; // a Wednesday
    expect(r.from).toBe('2026-09-07T00:00:00.000Z'); // Monday
    expect(r.to).toBe('2026-09-14T00:00:00.000Z'); // the next Monday
  });

  it('puts every day of a week in the same week', () => {
    // Sunday is the trap: getUTCDay() is 0 for it, so a naive subtraction
    // starts a new week on the last day of the old one.
    const keys = ['2026-09-07', '2026-09-09', '2026-09-12', '2026-09-13']
      .map((d) => keyFor('week', d));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('2026-09-07');
  });

  it('names the period a day belongs to at every span', () => {
    expect(keyFor('day', '2026-09-09')).toBe('2026-09-09');
    expect(keyFor('month', '2026-09-09')).toBe('2026-09');
    expect(keyFor('year', '2026-09-09')).toBe('2026');
  });

  it('gives the Monday of the week for any day in it', () => {
    expect(weekStart(new Date('2026-09-13T00:00:00Z')).toISOString().slice(0, 10))
      .toBe('2026-09-07');
    expect(weekStart(new Date('2026-01-01T00:00:00Z')).toISOString().slice(0, 10))
      .toBe('2025-12-29'); // a week may start in the previous year
  });

  it('makes a day one day, ending after it', () => {
    const r = rangeFor('day', '2026-09-09')!;
    expect(r.from).toBe('2026-09-09T00:00:00.000Z');
    expect(r.to).toBe('2026-09-10T00:00:00.000Z');
  });

  it('refuses a key that is not the shape its span uses', () => {
    // A bad key must produce a page that says so, never a silent fallback to
    // the latest -- showing this month under last month's address is a lie
    // about which report you are reading.
    expect(rangeFor('year', '26')).toBeNull();
    expect(rangeFor('month', '2026-13')).toBeNull();
    expect(rangeFor('month', '2026')).toBeNull();
    expect(rangeFor('week', 'nonsense')).toBeNull();
    expect(rangeFor('day', '2026-09')).toBeNull();
  });

  it('knows which strings are spans, for routing', () => {
    for (const s of ['day', 'week', 'month', 'year']) expect(isSpan(s)).toBe(true);
    for (const s of ['decade', '2026-09', '']) expect(isSpan(s)).toBe(false);
  });
});

const series = (n: number, f: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({
    day: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    downloads: f(i),
  }));

describe('a movement is measured against the length of its own period', () => {

  it('measures over WHOLE WEEKS at each end', () => {
    // THE BUG THIS REPLACES. The rule was "a quarter of the period, floored at
    // 3", which for a seven-day period compares Monday-Wednesday against
    // Friday-Sunday. Downloads run on a seven-day cycle, so every week came out
    // around -30% to -45%: 8-14 June read polars -45%, pip -39%, fastapi -28%.
    // Nothing happened that week. The measurement was the weekend.
    expect(edgeFor(SPAN_DAYS.year)).toBe(28);
    expect(edgeFor(SPAN_DAYS.month)).toBe(14);
    for (const d of [7, 14, 30, 90, 365]) {
      expect(edgeFor(d) % 7, `edge for ${d} days`).toBe(0);
    }
  });

  it('refuses a period too short to hold two whole weeks', () => {
    // A three-day edge was a mitigation, and mitigation is the wrong shape of
    // answer: a seven-day cycle is only averaged out by a multiple of seven
    // days. You cannot measure how such a signal changed over one week without
    // comparing it to a different week, which is outside the period.
    expect(edgeFor(SPAN_DAYS.week)).toBe(0);
    expect(edgeFor(1)).toBe(0);
    expect(edgeFor(13)).toBe(0);
    expect(movementOver('x', 'pypi', 'x', series(7, () => 500), 7)).toBeNull();
  });

  it('is not fooled by the weekly cycle', () => {
    const weekly = series(120, (i) => (i % 7 === 0 ? 100 : 1000));
    const m = movementOver('x', 'pypi', 'x', weekly, 120)!;
    expect(m).not.toBeNull();
    expect(Math.abs(m.changePct)).toBeLessThan(10);
  });

  it('reports real growth as growth, and carries what it compared', () => {
    const m = movementOver('x', 'pypi', 'x', series(120, (i) => 1000 + i * 100), 120)!;
    expect(m.changePct).toBeGreaterThan(50);
    expect(m.after).toBeGreaterThan(m.before);
    expect(m.fromDay < m.toDay).toBe(true);
    expect(m.edge).toBe(edgeFor(120));
  });

  it('refuses when the two ends would have to overlap', () => {
    // Below twice the edge there is no comparison to make, and a percentage
    // from four days is a number with no meaning.
    expect(movementOver('x', 'npm', 'x', series(5, () => 500), 30)).toBeNull();
    expect(movementOver('x', 'npm', 'x', [], 365)).toBeNull();
  });

  it('refuses to divide by a zero earlier edge', () => {
    const late = series(120, (i) => (i < 40 ? 0 : 900));
    expect(movementOver('x', 'npm', 'x', late, 120)).toBeNull();
  });

  it('deletes a cached curve when its resolution is withdrawn', () => {
    // adoption_lookup caches the answer, so once a slug resolves the series is
    // fetched daily and kept for ever -- tightening the guard afterwards only
    // stops NEW rows. Both refusal paths in resolvePackage now take the curve
    // with them.
    const outside = readFileSync(
      new URL('../src/analysis/outside.ts', import.meta.url), 'utf8');
    expect(outside).toMatch(/async function forgetSeries/);
    expect(outside).toMatch(/A REFUSAL MUST REACH THE DATA THAT WAS PUBLISHED UNDER IT/);
    expect((outside.match(/await forgetSeries\(db, slug\);/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });

  it('reads only series whose resolution still stands', () => {
    // adoption_series kept 181 rows filed under `jinja` that were really
    // django's, cached before the taxonomy guard existed. Joining the lookup
    // means a withdrawn resolution takes its curve off the page with it.
    expect(period).toMatch(/JOIN adoption_lookup l ON l\.slug = a\.slug AND l\.missing = false/);
  });
});

describe('no model writes a period report', () => {
  it('records why, on the page and in the module', () => {
    expect(period).toMatch(/NO MODEL WRITES ANY OF THIS/);
    expect(period).toMatch(/A YEAR DOES NOT FIT IN A PROMPT/);
    expect(period).toMatch(/THE PROVIDERS ARE NOT THERE/);
    // The rule stays in the module. The sentence left the page on 2026-09-13,
    // when every report became one page that says nothing about how it was
    // made: "You have to say about new market and market change in report,
    // not source of report."
    expect(report).not.toMatch(/No model wrote any of this/i);
  });

  it('quotes the daily readings rather than re-summarising them', () => {
    // A model's summary of a model's summary moves further from the story that
    // was cited with every pass.
    expect(period).toMatch(/never re-summarised/);
    // These strings are written across wrapped template-literal lines, so every
    // gap between words has to tolerate a newline and its indentation.
    expect(page).toMatch(/in\s+their\s+own\s+words/i);
  });

  it('never totals a list into a trend', () => {
    expect(period).toMatch(/WHY NO STORY COUNTS ANYWHERE/);
    // The combined report uses the period index for navigation only: it links
    // months and years and never prints how many stories one of them held.
    expect(report).not.toMatch(/\.stories\b/);
  });

  it('says the only figures come from outside', () => {
    expect(page).toMatch(/published by the registry/i);
    expect(page).toMatch(/Downloads are not users/);
  });

  it('deduplicates a claim two fields reached on the same day', () => {
    // An AI funding round is an `ai` finding and a `market` one. Showing it
    // twice is the repetition this archive was told about on 2026-09-09.
    expect(period).toMatch(/if \(seen\.has\(key\)\) return;/);
  });
});

describe('every report is one page', () => {
  // "all reports are combined by logic in a report page" (2026-09-13). The
  // index, the period pages and the day listings were three renderers; a
  // reader had to know which one answered their question.
  it('serves the index, every period and every day from one renderer', () => {
    expect(server).toMatch(/renderReportHome\(\)/);
    expect(server).toMatch(/renderReport\(head, rest\.slice\(slash \+ 1\)\)/);
    expect(server).toMatch(/renderReport\('day', day\)/);
    expect(index).not.toMatch(/export async function renderReportIndex/);
    expect(page).not.toMatch(/export async function renderPeriodReport/);
  });

  it('leads with the market for work and where to take it, before technology', () => {
    const at = (id: string) => report.indexOf(`id: '${id}'`);
    for (const id of ['work', 'kinds', 'where', 'technology', 'fields', 'archive']) {
      expect(at(id), id).toBeGreaterThan(0);
    }
    expect(at('work')).toBeLessThan(at('kinds'));
    expect(at('kinds')).toBeLessThan(at('where'));
    expect(at('where')).toBeLessThan(at('technology'));
    expect(at('technology')).toBeLessThan(at('fields'));
    expect(at('fields')).toBeLessThan(at('archive'));
  });

  it('fails open, so one broken query cannot take the page with it', () => {
    expect(report).toMatch(/periodReport\(span, key\)\.catch/);
    expect(report).toMatch(/workPicture\(range\)\.catch/);
    expect(report).toMatch(/briefingsIn\(range\)\.catch/);
    expect(report).toMatch(/reportIndex\(8\)\.catch/);
  });

  it('opens on the latest day that HAS stories, not the calendar day', () => {
    // The archive works in UTC, so for several hours every morning the
    // calendar day holds a handful of overnight items.
    expect(period).toMatch(/export async function latestDay/);
    expect(report).toMatch(/await latestDay\(\)/);
  });

  it('steps to the neighbouring period at every span', () => {
    expect(stepKey('month', '2026-01', -1)).toBe('2025-12');
    expect(stepKey('month', '2026-12', 1)).toBe('2027-01');
    expect(stepKey('year', '2026', -1)).toBe('2025');
    // Any date names its ISO week, so a step lands on the next Monday.
    expect(stepKey('week', '2026-09-09', 1)).toBe('2026-09-14');
    expect(stepKey('day', '2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('a move shared by every subject is the instrument, not the market', () => {
  // THE NUMBER THIS STOPS. Generating the 2026 month reports produced, for
  // August: fastapi -47%, huggingface -57%, pip -52%, polars -38%,
  // langchain -32%. Five unrelated Python projects do not lose a third to a
  // half of their downloads in the same week. The raw series shows a clean step
  // on 2026-08-25 -- fastapi goes from ~22M on a weekday to ~12.5M and stays --
  // and every package steps on the same day. That is PyPI changing how it
  // counts, and it is invisible in any single series.
  const cohort = (n: number, drop: number, at: number) => {
    const m = new Map<string, Array<{ day: string; downloads: number }>>();
    for (let s = 0; s < n; s += 1) {
      m.set(`p${s}`, Array.from({ length: 40 }, (_, i) => ({
        day: new Date(Date.UTC(2026, 7, 1) + i * 86_400_000).toISOString().slice(0, 10),
        downloads: i < at ? 1000 : Math.round(1000 * (1 + drop / 100)),
      })));
    }
    return m;
  };

  it('finds the day every series stepped together', () => {
    const b = detectCohortBreak(cohort(5, -45, 20))!;
    expect(b).not.toBeNull();
    expect(b.day).toBe('2026-08-21');
    expect(b.agreed).toBe(5);
    expect(b.medianPct).toBeLessThan(-20);
  });

  it('says nothing when the series disagree', () => {
    // Real adoption is not correlated across unrelated projects at this
    // magnitude; measurement is correlated across all of them by construction.
    const m = cohort(4, -45, 20);
    let i = 0;
    for (const [k, pts] of m) {
      if (i++ % 2) m.set(k, pts.map((p) => ({ ...p, downloads: 1000 })));
    }
    expect(detectCohortBreak(m)).toBeNull();
  });

  it('will not call a break from too few series', () => {
    // With two series, "all of them moved" is not evidence of anything.
    expect(detectCohortBreak(cohort(2, -45, 20))).toBeNull();
  });

  it('ignores a shared move that is small', () => {
    expect(detectCohortBreak(cohort(5, -5, 20))).toBeNull();
  });

  it('voids every curve of the registry that broke, and no others', () => {
    // The step is in the instrument, so it is in every series THAT REGISTRY
    // publishes: there is no subset of those that survives it. The other
    // registry is a separate instrument and its curves are unaffected.
    //
    // This was wrong until 2026-09-11. Detection ran across every tracked
    // package at once, so when PyPI stepped on 2026-08-25 -- 57 of its 60
    // series, median -37% -- agreement across the mixed set was 42%, under the
    // 80% required, and nothing fired. The August report published fastapi at
    // -47% and dbt at -47% as adoption for three weeks.
    expect(period).toMatch(/const b = detectCohortBreak\(series, registry\)/);
    expect(period).toMatch(/if \(broken\.has\(v\.registry\)\) continue;/);
    expect(period).toMatch(/The cohort that shares an instrument is/);
  });

  it('detects a break in one registry that the other does not share', () => {
    // The mixed cohort is the case that used to slip through: half the series
    // step together, half do not, and the median across all of them is small.
    const stepped = cohort(6, -37, 20);
    const flat = cohort(6, 0, 20);
    const mixed = new Map([...stepped].map(([k, v]) => [`pypi:${k}`, v]));
    for (const [k, v] of flat) mixed.set(`npm:${k}`, v);
    expect(detectCohortBreak(mixed)).toBeNull();
    expect(detectCohortBreak(stepped, 'pypi')?.registry).toBe('pypi');
  });

  it('says on the page that the number is withheld, and why', () => {
    // An empty section reads as "nothing moved", which is the opposite of what
    // happened and worse than either the wrong number or the right one.
    expect(page).toMatch(/A SUPPRESSED NUMBER HAS TO SAY IT IS SUPPRESSED/);
    expect(page).toMatch(/because the\s+measurement changed inside it/);
    expect(page).toMatch(/function noCurves/);
    expect(page).toMatch(/which was the weekend/);
  });
});

describe('every period is reachable, not just the current one', () => {
  it('enumerates each span in one grouped query', () => {
    // The composed page for a single period does real work; building fifty of
    // them to draw a list of links would be a page that takes a minute.
    expect(period).toMatch(/export async function periodIndex/);
    expect(period).toMatch(/date_trunc\('week', d\)/);
    expect(period).toMatch(/count\(\*\) FILTER \(WHERE kind = 'launch'\)/);
  });

  it('buckets weeks the same way `weekStart` does', () => {
    // Postgres date_trunc('week') is Monday-based, and so is weekStart. If the
    // two disagreed, the list would offer a key the renderer resolves to a
    // different week.
    expect(period).toMatch(/date_trunc\('week', \.\.\.\)/);
  });

  it('says the index counts are navigation, not a finding', () => {
    // The standing rule -- never count our own stories -- is about CLAIMS. A
    // reader choosing between fifty weeks needs to know which hold anything.
    expect(period).toMatch(/WHY THE COUNTS ARE HERE AND WHY THEY ARE NOT A FINDING/);
    expect(page).toMatch(/to help you choose, not to be read as/);
  });

  it('warns that the early periods are back catalogue', () => {
    // Collection began 2026-09-08. Everything before that arrived from feeds
    // that still served it, so a thin week is not a quiet week.
    expect(page).toMatch(/Collection began on/);
    expect(page).toMatch(/back catalogue/);
  });

  it('routes /reports/periods above the span routes', () => {
    // `periods` is not a span, so it would otherwise fall through to the dated
    // report and 404.
    const idxAt = server.indexOf(`path === '/reports/periods'`);
    const spanAt = server.indexOf('if (isSpan(head))');
    expect(idxAt).toBeGreaterThan(0);
    expect(idxAt).toBeLessThan(spanAt);
  });
});

describe('routing', () => {
  it('tests the span prefix before the dated report', () => {
    // Both live under /reports/. `/reports/2026-09-09` is a day of briefings
    // and `/reports/month/2026-09` is a composed period; matching the date
    // route first would send every period page to the 404.
    const spanAt = server.indexOf('if (isSpan(head))');
    const dayAt = server.indexOf('const day = reportDay(rest)');
    expect(spanAt).toBeGreaterThan(0);
    expect(dayAt).toBeGreaterThan(spanAt);
  });
});

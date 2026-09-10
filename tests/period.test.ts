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
import { rangeFor, edgeFor, movementOver, isSpan, SPAN_DAYS } from '../src/analysis/period.ts';

const period = readFileSync(
  new URL('../src/analysis/period.ts', import.meta.url), 'utf8');
const page = readFileSync(
  new URL('../src/ui/period.ts', import.meta.url), 'utf8');
const index = readFileSync(
  new URL('../src/ui/briefing.ts', import.meta.url), 'utf8');
const server = readFileSync(
  new URL('../src/ui/server.ts', import.meta.url), 'utf8');

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

  it('reads a week as the seven days ENDING on the date', () => {
    // There is no calendar week a reader of this archive already thinks in, so
    // a week is anchored to the day you asked for and reaches backwards.
    const r = rangeFor('week', '2026-09-09')!;
    expect(r.from).toBe('2026-09-03T00:00:00.000Z');
    expect(r.to).toBe('2026-09-10T00:00:00.000Z');
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

describe('a movement is measured against the length of its own period', () => {
  const series = (n: number, f: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({
      day: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      downloads: f(i),
    }));

  it('uses a quarter of the period at each end', () => {
    // The daily reading compares two 28-day means because it asks about six
    // months. Twenty-eight days of a seven-day period is the whole period
    // twice, so the edge scales -- and stays disjoint at every span.
    expect(edgeFor(SPAN_DAYS.year)).toBe(28);
    expect(edgeFor(SPAN_DAYS.month)).toBe(7);
    expect(edgeFor(SPAN_DAYS.week)).toBe(3);
  });

  it('never drops below three days at an edge', () => {
    // Package downloads are violently weekly -- a Sunday is a third of a
    // Tuesday -- so one day at each end reports the calendar, not the adoption.
    expect(edgeFor(1)).toBe(3);
    expect(edgeFor(4)).toBe(3);
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
    expect(page).toMatch(/Nothing on this page was written by a model/);
  });

  it('quotes the daily readings rather than re-summarising them', () => {
    // A model's summary of a model's summary moves further from the story that
    // was cited with every pass.
    expect(period).toMatch(/never re-summarised/);
    expect(page).toMatch(/not\s+re-summarised/);
  });

  it('never totals a list into a trend', () => {
    expect(period).toMatch(/WHY NO STORY COUNTS ANYWHERE/);
    expect(page).toMatch(/Nothing here is counted/);
    expect(page).toMatch(/never totalled into a trend/);
  });

  it('says the only figures come from outside', () => {
    expect(page).toMatch(/published by somebody else/);
    expect(page).toMatch(/Downloads are not users/);
  });

  it('deduplicates a claim two fields reached on the same day', () => {
    // An AI funding round is an `ai` finding and a `market` one. Showing it
    // twice is the repetition this archive was told about on 2026-09-09.
    expect(period).toMatch(/if \(seen\.has\(key\)\) return;/);
  });
});

describe('the reports index leads with what appeared', () => {
  it('puts the lead card above the field navigation', () => {
    const leadAt = index.indexOf('${lead}');
    const fieldsAt = index.indexOf('Follow one field');
    expect(leadAt).toBeGreaterThan(0);
    expect(fieldsAt).toBeGreaterThan(0);
    expect(leadAt).toBeLessThan(fieldsAt);
  });

  it('offers month and year links from the index', () => {
    expect(index).toMatch(/\$\{periods\}/);
    expect(page).toMatch(/export async function periodLinks/);
  });

  it('fails open, so a broken summary cannot take the day list with it', () => {
    expect(index).toMatch(/leadCard\(\)\.catch\(\(\) => ''\)/);
    expect(index).toMatch(/periodLinks\(\)\.catch\(\(\) => ''\)/);
  });

  it('leads with the latest day that HAS stories, not the calendar day', () => {
    // The archive works in UTC, so for several hours every morning the
    // calendar day holds a handful of overnight items and a "today" summary
    // would read as a broken page.
    expect(period).toMatch(/export async function latestDay/);
    expect(page).toMatch(/await latestDay\(\)/);
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

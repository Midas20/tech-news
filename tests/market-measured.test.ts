// Market change, MEASURED rather than read.
//
// Companion to market.test.ts, which guards the rules that classify a story as
// a market event. This file is about the other half: the numbers that exist
// whether or not anybody wrote a story at all.
//
// Asked for on 2026-09-10: "I think the news scope isn't still wide and the
// report are focus on news analysis. The target of report is recognizing market
// change and finding new market."
//
// THE OBJECTION WAS RIGHT AND THE NUMBERS SAID SO. Measured that morning:
//
//   stories classified `market`     35 of 5,993   (0.6%)
//   sources of kind 'news'          510 of 512
//   stacks with a GitHub repo       1,038
//   ...with an adoption curve       6
//
// The 0.6% is NOT a classifier failure, and checking that was worth the detour:
// classifyEvent reads funding, acquisition and position out of a headline with
// rules and no model, and market.test.ts beside this file is the record of it
// being taught to. The archive holds 35 market stories because it hardly ever
// collects one -- 510 of 512 sources are engineering and vendor blogs.
//
// The other number is this module's business. The one real instrument was
// pointed at six packages, because resolution happened inside the daily report
// and was capped at six subjects a run.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { moveOf, EDGE, FLOOR, NEW_CEILING, NEW_GROWTH } from '../src/analysis/market.ts';

const market = readFileSync(
  new URL('../src/analysis/market.ts', import.meta.url), 'utf8');
const page = readFileSync(
  new URL('../src/ui/market.ts', import.meta.url), 'utf8');
const downloads = readFileSync(
  new URL('../src/analysis/downloads.ts', import.meta.url), 'utf8');
const jobs = readFileSync(
  new URL('../src/run/jobs.ts', import.meta.url), 'utf8');

const flat = (n: number, days: number, from = 0) =>
  Array.from({ length: days }, (_, i) => ({
    day: new Date(Date.UTC(2026, 6, 1) + (from + i) * 86_400_000)
      .toISOString().slice(0, 10),
    downloads: n,
  }));

describe('a move is two whole weeks against two whole weeks', () => {
  it('compares the end of the series, not a calendar period', () => {
    // The question is "what is happening now", not "what happened in
    // September". A calendar month answers a different question and goes stale
    // for four weeks every time one ends.
    const pts = [...flat(1000, EDGE), ...flat(1500, EDGE, EDGE)];
    const m = moveOf('x', 'pypi', 'x', pts)!;
    expect(m.changePct).toBe(50);
    expect(m.before).toBe(1000);
    expect(m.after).toBe(1500);
    expect(m.edge).toBe(EDGE);
  });

  it('refuses an edge that is not a whole number of weeks', () => {
    // Downloads run on a seven-day cycle; any other edge measures the calendar.
    expect(moveOf('x', 'pypi', 'x', flat(1000, 200), 10)).toBeNull();
    expect(moveOf('x', 'pypi', 'x', flat(1000, 200), 3)).toBeNull();
    expect(moveOf('x', 'pypi', 'x', flat(1000, 200), 0)).toBeNull();
  });

  it('accepts a shorter whole-week edge when asked for one', () => {
    // This is what a measurement break falls back to.
    const pts = [...flat(1000, 7), ...flat(2000, 7, 7)];
    const m = moveOf('x', 'pypi', 'x', pts, 7)!;
    expect(m.changePct).toBe(100);
    expect(m.edge).toBe(7);
  });

  it('refuses when there is not twice the edge of data', () => {
    expect(moveOf('x', 'pypi', 'x', flat(1000, EDGE * 2 - 1))).toBeNull();
    expect(moveOf('x', 'pypi', 'x', [])).toBeNull();
  });

  it('refuses to divide by a zero earlier window', () => {
    expect(moveOf('x', 'pypi', 'x', [...flat(0, EDGE), ...flat(900, EDGE, EDGE)]))
      .toBeNull();
  });
});

describe('a forming market is not the top of the percentage list', () => {
  it('puts a floor under the LATER end', () => {
    // A package going 40 a day to 400 is +900% and is one build server being
    // switched on. The floor is what separates a market from a rounding error.
    expect(FLOOR).toBeGreaterThan(0);
    expect(market).toMatch(/is NOT the\n\/\/                   top of the percentage list/);
    expect(market).toMatch(/m\.after >= FLOOR/);
  });

  it('puts a ceiling on the EARLIER end', () => {
    // Something already shipping a hundred thousand a day and growing is an
    // established market having a good quarter, not a new one.
    expect(NEW_CEILING).toBeGreaterThan(FLOOR);
    expect(market).toMatch(/m\.before < NEW_CEILING/);
  });

  it('requires real growth, not any growth', () => {
    expect(NEW_GROWTH).toBeGreaterThanOrEqual(50);
    expect(market).toMatch(/m\.changePct >= NEW_GROWTH/);
  });

  it('reports decline as well, because leaving a market is a market change', () => {
    expect(market).toMatch(/fading/);
    expect(page).toMatch(/no vendor announces/);
  });
});

describe('a measurement break moves the window rather than blanking the page', () => {
  it('measures only after the break, at the widest whole-week edge that fits', () => {
    // On 2026-09-10 the break was 2026-08-25, inside the 56-day window this
    // page compares over. Suppressing everything would have shown nothing until
    // late October -- seven weeks of an empty page while a short honest
    // baseline existed.
    expect(market).toMatch(/A BREAK VOIDS EVERY NUMBER THAT SPANS IT/);
    expect(market).toMatch(/v\.points\.filter\(\(p\) => p\.day >= from\)/);
    expect(market).toMatch(/Math\.floor\(\(Number\.isFinite\(span\) \? span : 0\) \/ 2 \/ 7\) \* 7/);
  });

  it('says on the page that the baseline is shorter, and why', () => {
    expect(page).toMatch(/The cost is a weaker baseline/);
    expect(page).toMatch(/changed how it counts on/);
  });

  it('still refuses when not even a fortnight fits after the break', () => {
    expect(market).toMatch(/if \(shift && moves\.length === 0\)/);
    expect(page).toMatch(/not yet a whole fortnight of series after that date/);
  });

  it('shows the edge actually used, never the constant', () => {
    // A page that printed "28 days" over a 7-day comparison would be lying in
    // the one place a reader checks.
    expect(page).toMatch(/\$\{m\.edge\} days and compared with the \$\{m\.edge\} days before/);
    expect(page).toMatch(/table\('Everything measured', m\.moves, m\.edge\)/);
  });
});

describe('the instrument is pointed at the whole registry, not at six packages', () => {
  it('resolves packages in its own job, out of the report', () => {
    // The report's cap of six subjects is right for a report and wrong for a
    // catalogue: it meant the archive only learned about a package on a day a
    // story happened to name it.
    expect(jobs).toMatch(/name: 'resolve-packages'/);
    expect(jobs).toMatch(/name: 'download-series'/);
    expect(downloads).toMatch(/export async function resolveBacklog/);
    expect(downloads).toMatch(/export async function refreshSeries/);
  });

  it('looks up the technologies the archive actually writes about first', () => {
    // A curve for something nobody mentions is worth having later than a curve
    // for something on today's page.
    expect(downloads).toMatch(/SELECT count\(\*\) FROM stories st/);
  });

  it('never looks a technology up twice', () => {
    // resolvePackage records a hit or an explained miss, so the walk is finite.
    expect(downloads).toMatch(/LEFT JOIN adoption_lookup l ON l\.slug = s\.slug/);
    expect(downloads).toMatch(/WHERE l\.slug IS NULL/);
  });

  it('leaves a fresh series alone', () => {
    expect(downloads).toMatch(/SERIES_STALE_HOURS/);
  });

  it('paces itself out of manners, not because a limit was hit', () => {
    expect(downloads).toMatch(/The rate is what it is out of manners/);
  });
});

describe('the page says what it cannot see', () => {
  it('states its coverage, so an empty list can be read correctly', () => {
    // "Nothing is forming" means one thing at 8 packages tracked and another at
    // 800, and a reader cannot tell which without the denominator.
    expect(page).toMatch(/How much this can see/);
    expect(page).toMatch(/marketCoverage/);
  });

  it('says a registry is not the market', () => {
    // Anything sold rather than installed has no curve at all.
    expect(page).toMatch(/A registry is not a market/);
    expect(market).toMatch(/a package\n\/\/ registry is not the market/);
  });

  it('warns that a package may be a satellite of its project', () => {
    // Verification stopped npm:torch, an unrelated project, from being
    // published as PyTorch. It does not stop a small package from the right
    // organisation standing in for a large project.
    expect(page).toMatch(/A package is not always its project/);
    expect(page).toMatch(/npm:torch/);
  });

  it('reads no story at all', () => {
    expect(page).toMatch(/No story is read on this page/);
    expect(market).toMatch(/THIS MODULE NEVER READS A STORY/);
  });
});

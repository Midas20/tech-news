// The labour market instrument: what it reads, and what it refuses to say.
//
// 2026-09-11: "the purpose of this project is finding new market and market
// change", and a nineteen-section report on the IT labour market with "I want
// to make monthly report at this level".
//
// That report runs on job postings and this archive had none. These tests cover
// the collector that fixed that and the arithmetic on top of it -- in
// particular the two places where it would be easy to publish a number that
// looks like a finding and is not.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv, readPostings, readRemote, readAi } from '../src/collect/labour.ts';
import { techGap, techOf, controlsOf, type LabourPicture } from '../src/analysis/labour.ts';

const collector = readFileSync(
  new URL('../src/collect/labour.ts', import.meta.url), 'utf8');
const analysis = readFileSync(
  new URL('../src/analysis/labour.ts', import.meta.url), 'utf8');

describe('reading the published CSVs', () => {
  it('keeps a sector whose name contains a comma', () => {
    // The real file contains `"IT Infrastructure, Operations & Support"`.
    // Splitting on commas drops it silently and the other forty-six sectors
    // look fine, which is exactly the kind of bug that ships.
    const csv = 'date,jobcountry,indeed_job_postings_index,variable,display_name\n'
      + '2026-08-01,US,70.8,total postings,"IT Infrastructure, Operations & Support"\n';
    const rows = readPostings(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sector).toBe('IT Infrastructure, Operations & Support');
    expect(rows[0]!.value).toBe(70.8);
  });

  it('handles an escaped quote inside a quoted field', () => {
    const rows = parseCsv('a,b\n"say ""hi""",2\n');
    expect(rows[1]).toEqual(['say "hi"', '2']);
  });

  it('reads columns by name rather than by position', () => {
    // A publisher reordering its columns should produce no rows or the right
    // rows, never rows with the value and the date swapped.
    const csv = 'display_name,date,variable,jobcountry,indeed_job_postings_index\n'
      + 'Software Development,2026-08-01,total postings,US,74.2\n';
    const rows = readPostings(csv);
    expect(rows[0]).toMatchObject({
      sector: 'Software Development', day: '2026-08-01', value: 74.2,
    });
  });

  it('drops countries and sectors it does not carry', () => {
    const csv = 'date,jobcountry,indeed_job_postings_index,variable,display_name\n'
      + '2026-08-01,FR,70.8,total postings,Software Development\n'
      + '2026-08-01,US,70.8,total postings,Dental\n';
    expect(readPostings(csv)).toHaveLength(0);
  });

  it('reads the remote and AI trackers under their own column names', () => {
    expect(readRemote('date,jobcountry,normtitlecategory_consistent,remote_share_postings\n'
      + '2026-08-31,US,techsoftware,30.82\n')[0]).toMatchObject({
      dataset: 'remote', sector: 'techsoftware', value: 30.82, measure: 'share',
    });
    expect(readAi('date,jobcountry,AI_share_postings\n2026-08-31,US,6.73\n')[0])
      .toMatchObject({ dataset: 'ai', sector: 'all', value: 6.73 });
  });

  it('refuses a row whose value is not a number', () => {
    const csv = 'date,jobcountry,indeed_job_postings_index,variable,display_name\n'
      + '2026-08-01,US,NA,total postings,Software Development\n';
    expect(readPostings(csv)).toHaveLength(0);
  });
});

describe('a sector number means nothing without a control beside it', () => {
  const picture = (moves: Array<[string, number, boolean]>): LabourPicture => ({
    country: 'US',
    postings: moves.map(([sector, changePct, tech]) => ({
      sector, start: 100, end: 100 + changePct, changePct, tech,
    })),
    remote: [], ai: null, from: '2026-08-01', to: '2026-08-31', days: 31,
  });

  it('reports the gap, not the fall', () => {
    // 2023: software postings fell 43.8% and the controls fell 17.6%. A page
    // that prints the first without the second is describing the economy and
    // calling it technology.
    const p = picture([
      ['Software Development', -43.8, true],
      ['Data & Analytics', -41.2, true],
      ['Nursing', -17.6, false],
      ['Construction', -17.6, false],
    ]);
    const gap = techGap(p)!;
    expect(gap.tech).toBeCloseTo(-42.5, 1);
    expect(gap.control).toBeCloseTo(-17.6, 1);
    expect(gap.gap).toBeCloseTo(-24.9, 1);
  });

  it('shows no gap when technology moved with everything else', () => {
    const gap = techGap(picture([
      ['Software Development', -5, true],
      ['Nursing', -5, false],
    ]))!;
    expect(gap.gap).toBe(0);
  });

  it('says nothing at all when there is no control to compare against', () => {
    // Better silent than a difference computed against itself.
    expect(techGap(picture([['Software Development', -40, true]]))).toBeNull();
  });

  it('uses a median so one wild control cannot move the comparison', () => {
    const gap = techGap(picture([
      ['Software Development', 0, true],
      ['Nursing', 1, false],
      ['Construction', 2, false],
      ['Accounting', 300, false],
    ]))!;
    expect(gap.control).toBe(2);
  });

  it('separates the sectors a reader might work in from the controls', () => {
    const p = picture([
      ['Software Development', 1, true],
      ['Nursing', 1, false],
    ]);
    expect(techOf(p).map((m) => m.sector)).toEqual(['Software Development']);
    expect(controlsOf(p).map((m) => m.sector)).toEqual(['Nursing']);
  });
});

describe('what the instrument says about itself', () => {
  it('records that the BLS was tried and is unreachable', () => {
    // Otherwise the next person spends the same afternoon discovering it.
    expect(collector).toMatch(/api\.bls\.gov/);
    expect(collector).toMatch(/403/);
  });

  it('refuses to store a pay number that does not apply to this reader', () => {
    // Hiring Lab publishes posted wage growth and its US sector list has no
    // software in it. An adjacent number that does not apply is worse than none.
    expect(collector).toMatch(/NOT STORED|does not apply|none of which is software/i);
  });

  it('keeps both publishers\' sector vocabularies unrewritten', () => {
    expect(collector).toMatch(/techsoftware/);
    expect(collector).toMatch(/Software Development/);
    expect(analysis).toMatch(/TECH_REMOTE/);
  });

  it('averages a week at each end so a weekday never faces a weekend', () => {
    expect(analysis).toMatch(/export const EDGE = 7/);
  });
});

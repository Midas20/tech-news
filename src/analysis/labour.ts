// Where the work is, over a period, from the postings data.
//
// The companion to `market.ts`. That module measures what is being installed;
// this one measures what is being hired for, and between them they are the only
// two instruments in this archive whose numbers were not written by somebody
// with an interest in them.
//
// WHY A SECTOR NEEDS A CONTROL NEXT TO IT. "Software Development postings are
// at 76" is not a finding. Postings fell across the whole economy after 2022,
// Indeed's own share of hiring moves, and an index against February 2020 is
// five years of compounding definitional drift. The finding is the DIFFERENCE
// between software and nursing, measured the same way, over the same window, by
// the same publisher -- which is why the collector stores ten control sectors
// nobody here will ever want to work in.
//
// EVERY NUMBER IS AN INDEX, NOT A COUNT. 100 is that sector on 1 February 2020.
// A sector at 76 has three quarters of the postings it had then; it does not
// have 76 of anything.

import { q } from '../ui/db.ts';
import type { Query } from './corpus.ts';
import type { Range } from './period.ts';

/** Days averaged at each end, so a weekday never faces a weekend. */
export const EDGE = 7;

/**
 * The sectors this archive's reader could plausibly work in.
 *
 * Kept separate from the collector's allowlist on purpose: the collector stores
 * controls so that comparisons are possible, and this decides which sectors a
 * report leads with. Changing one should not silently change the other.
 */
export const TECH_SECTORS = [
  'Software Development',
  'Data & Analytics',
  'IT Systems & Solutions',
  'IT Infrastructure, Operations & Support',
  'Scientific Research & Development',
];

/** The remote tracker's name for the same ground, in its own vocabulary. */
export const TECH_REMOTE = ['techsoftware', 'techinfo', 'techhelp'];

export interface SectorMove {
  sector: string;
  /** Mean index over the first EDGE days inside the period. */
  start: number;
  /** Mean index over the last EDGE days inside the period. */
  end: number;
  /** Change across the period, as a percentage of the start. */
  changePct: number;
  /** Whether this is one of the sectors a reader here might work in. */
  tech: boolean;
}

export interface LabourPicture {
  country: string;
  /** Job postings by sector, indexed to 1 February 2020 = 100. */
  postings: SectorMove[];
  /** Share of postings mentioning remote or hybrid work, by sector. */
  remote: SectorMove[];
  /** Share of all postings mentioning AI terms, country-wide. */
  ai: { start: number; end: number; changePct: number } | null;
  /** The days actually covered inside the period, at each end. */
  from: string | null;
  to: string | null;
  /**
   * Days of data found inside the period.
   *
   * Zero means the publisher's series does not reach this period, which is a
   * fact about the data and not about hiring. A page that renders nothing
   * cannot tell a reader which of those it is looking at.
   */
  days: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Read one dataset across a range and reduce it to a move per sector.
 *
 * Both ends are averaged over a week because these are daily series: a period
 * ending on a Sunday compared with one starting on a Tuesday produces a move
 * that is entirely the calendar. `market.ts` learned the same lesson from
 * download counts and the reasoning is written out there.
 */
function movesFrom(
  rows: Array<{ sector: string; day: string; value: number }>,
  tech: Set<string>,
): SectorMove[] {
  const bySector = new Map<string, Array<{ day: string; value: number }>>();
  for (const r of rows) {
    const at = bySector.get(r.sector) ?? [];
    at.push({ day: r.day, value: r.value });
    bySector.set(r.sector, at);
  }
  const out: SectorMove[] = [];
  for (const [sector, points] of bySector) {
    if (points.length < EDGE * 2) continue;
    const s = points.sort((a, b) => a.day.localeCompare(b.day));
    const start = mean(s.slice(0, EDGE).map((p) => p.value));
    const end = mean(s.slice(-EDGE).map((p) => p.value));
    if (start <= 0) continue;
    out.push({
      sector, start, end,
      changePct: Math.round(((end - start) / start) * 1000) / 10,
      tech: tech.has(sector),
    });
  }
  return out.sort((a, b) => b.changePct - a.changePct);
}

/**
 * What the postings data says about one period.
 *
 * Returns everything with `days: 0` rather than throwing when the series does
 * not reach the period, because "we have no data for 2021" and "nothing
 * happened in 2021" are different sentences and the page has to say which.
 */
export async function labourPicture(
  range: Range, country = 'US', query: Query = q,
): Promise<LabourPicture> {
  const rows = await query<{ dataset: string; sector: string; day: string;
    value: string }>(
    `SELECT dataset, sector, day::text AS day, value::text AS value
       FROM labour_series
      WHERE country = $3
        AND day >= $1::date AND day < $2::date
        AND measure IN ('total postings', 'share')
      ORDER BY dataset, sector, day`,
    [range.from, range.to, country]);

  const num = (r: { value: string }) => Number(r.value);
  const of = (d: string) => rows.filter((r) => r.dataset === d)
    .map((r) => ({ sector: r.sector, day: r.day, value: num(r) }));

  const postings = movesFrom(of('postings'), new Set(TECH_SECTORS));
  const remote = movesFrom(of('remote'), new Set(TECH_REMOTE));
  const aiRows = of('ai');
  const aiMove = movesFrom(aiRows, new Set())[0] ?? null;

  const days = new Set(rows.map((r) => r.day));
  const sorted = [...days].sort();
  return {
    country, postings, remote,
    ai: aiMove
      ? { start: aiMove.start, end: aiMove.end, changePct: aiMove.changePct }
      : null,
    from: sorted[0] ?? null,
    to: sorted[sorted.length - 1] ?? null,
    days: days.size,
  };
}

/** The technology sectors, largest fall first -- the reader's own market. */
export function techOf(p: LabourPicture): SectorMove[] {
  return p.postings.filter((m) => m.tech);
}

/** The controls, so a technology number can be read against something. */
export function controlsOf(p: LabourPicture): SectorMove[] {
  return p.postings.filter((m) => !m.tech);
}

/**
 * The gap between the technology sectors and everything else.
 *
 * This is the number the whole module exists to produce. If software fell 4%
 * over a month in which every other sector also fell 4%, software did not have
 * a bad month -- hiring did, or Indeed did. The median is used rather than the
 * mean because one control sector having an extraordinary month should not move
 * it.
 */
export function techGap(p: LabourPicture): {
  tech: number; control: number; gap: number;
} | null {
  const tech = techOf(p).map((m) => m.changePct);
  const control = controlsOf(p).map((m) => m.changePct);
  if (tech.length === 0 || control.length === 0) return null;
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  };
  const t = med(tech);
  const c = med(control);
  return {
    tech: Math.round(t * 10) / 10,
    control: Math.round(c * 10) / 10,
    gap: Math.round((t - c) * 10) / 10,
  };
}

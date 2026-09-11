// The labour market, from somebody else's measurement.
//
// 2026-09-11: "the purpose of this project is finding new market and market
// change", and then a nineteen-section report on the IT labour market with
// "I want to make monthly report at this level".
//
// The form of that report was reproducible here. Its substance was not: it runs
// on job postings, pay, layoffs and spend forecasts, and this archive collects
// engineering blogs. The gap was not a writing problem and no amount of
// re-reading vendor posts closes it.
//
// So this collects the part that is free, public, machine-readable, updated
// daily and directly on purpose. Indeed Hiring Lab publishes its trackers as
// CSV in public GitHub repositories. They measure postings on one of the
// largest job boards in the world -- a population this archive has no other way
// to see.
//
// WHAT WAS TRIED AND DOES NOT WORK, recorded so nobody spends the afternoon
// again: `api.bls.gov` does not resolve from this host and `www.bls.gov`
// answers 403. The US Bureau of Labor Statistics would have supplied openings,
// hires and quits (JOLTS) and pay by occupation and metro (OEWS). It is the
// obvious second source and it is unreachable from here, not merely unwritten.
//
// WHAT THESE NUMBERS ARE NOT. Indeed is a job board, not the labour market. A
// posting is not a job, a job is not a hire, and a board's share of an
// occupation varies by country and by seniority -- senior and specialist roles
// are filled through networks that never reach a board at all. Everything here
// is an index against 1 February 2020 rather than a count, because the level
// was never the claim. The direction is.

import type { Db } from '../db/client.ts';

const BASE = 'https://raw.githubusercontent.com/hiring-lab';

/** One published series, as this repository stores it. */
export interface LabourRow {
  dataset: string;
  country: string;
  sector: string;
  measure: string;
  day: string;
  value: number;
}

export interface LabourReport {
  fetched: number;
  stored: number;
  datasets: string[];
  failed: string[];
  skipped?: string;
}

/**
 * The countries worth carrying.
 *
 * The trackers cover about twenty. Storing all of them would multiply the table
 * by twenty to answer a question nobody has asked: this archive is read by one
 * person deciding where to look for remote work, and the useful comparison is
 * a handful of large English-speaking markets plus one continental European one
 * as a control. Adding a country later is one line and a re-run.
 */
const COUNTRIES = new Set(['US', 'GB', 'CA', 'DE', 'AU']);

/**
 * The sectors worth carrying, in each tracker's own vocabulary.
 *
 * THE TWO TRACKERS DISAGREE ABOUT WHAT A SECTOR IS CALLED and neither label is
 * rewritten. The postings tracker says "Software Development"; the remote
 * tracker says "techsoftware". Mapping one onto the other would produce a third
 * name that appears in neither source and cannot be checked against either.
 *
 * The controls are the point of the exercise. "Software Development fell to 76"
 * means nothing without "Nursing is at 118" beside it -- the first number alone
 * is as likely to be a fact about hiring in general, or about Indeed, as about
 * software.
 */
const POSTING_SECTORS = new Set([
  // The technology ones.
  'Software Development', 'Data & Analytics', 'IT Systems & Solutions',
  'IT Infrastructure, Operations & Support', 'Scientific Research & Development',
  'Project Management', 'Industrial Engineering', 'Electrical Engineering',
  'Architecture', 'Media & Communications',
  // The controls, so the technology numbers can be read against something.
  'Nursing', 'Construction', 'Accounting', 'Marketing', 'Sales',
  'Human Resources', 'Legal', 'Education & Instruction',
  'Customer Service', 'Management',
]);

const REMOTE_SECTORS = new Set([
  'techsoftware', 'techinfo', 'techhelp', 'math',
  // Controls again, in this tracker's vocabulary.
  'nursing', 'accounting', 'marketing', 'sales', 'management',
]);

/**
 * Parse a CSV the way these files are actually shaped.
 *
 * They are machine-written, comma-separated, and contain quoted fields -- one
 * sector is literally `"IT Infrastructure & Support"` with the quote included
 * in a naive split. So this handles quotes rather than splitting on commas and
 * hoping, which is the bug that silently drops one sector and is invisible in
 * the output because the other forty-six are fine.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((f) => f !== '')) rows.push(row);
      row = []; field = '';
      continue;
    }
    field += c;
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** Column index by header name, so a reordered CSV does not silently shift. */
function columns(header: string[]): Record<string, number> {
  const at: Record<string, number> = {};
  header.forEach((h, i) => { at[h.trim()] = i; });
  return at;
}

/**
 * Read one tracker into rows this repository can store.
 *
 * Each tracker has its own column names, which is why this is three small
 * readers rather than one clever one with a configuration object.
 */
export function readPostings(text: string): LabourRow[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const at = columns(header);
  const out: LabourRow[] = [];
  for (const r of rows) {
    const sector = r[at['display_name']!]?.trim();
    const country = r[at['jobcountry']!]?.trim();
    if (!sector || !country) continue;
    if (!COUNTRIES.has(country) || !POSTING_SECTORS.has(sector)) continue;
    const value = Number(r[at['indeed_job_postings_index']!]);
    const day = r[at['date']!]?.trim();
    if (!day || !Number.isFinite(value)) continue;
    out.push({
      dataset: 'postings', country, sector,
      measure: r[at['variable']!]?.trim() || 'total postings', day, value,
    });
  }
  return out;
}

export function readRemote(text: string): LabourRow[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const at = columns(header);
  const out: LabourRow[] = [];
  for (const r of rows) {
    const sector = r[at['normtitlecategory_consistent']!]?.trim();
    const country = r[at['jobcountry']!]?.trim();
    if (!sector || !country) continue;
    if (!COUNTRIES.has(country) || !REMOTE_SECTORS.has(sector)) continue;
    const value = Number(r[at['remote_share_postings']!]);
    const day = r[at['date']!]?.trim();
    if (!day || !Number.isFinite(value)) continue;
    out.push({ dataset: 'remote', country, sector, measure: 'share', day, value });
  }
  return out;
}

export function readAi(text: string): LabourRow[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const at = columns(header);
  const out: LabourRow[] = [];
  for (const r of rows) {
    const country = r[at['jobcountry']!]?.trim();
    if (!country || !COUNTRIES.has(country)) continue;
    const value = Number(r[at['AI_share_postings']!]);
    const day = r[at['date']!]?.trim();
    if (!day || !Number.isFinite(value)) continue;
    out.push({ dataset: 'ai', country, sector: 'all', measure: 'share', day, value });
  }
  return out;
}

/**
 * WHAT IS DELIBERATELY NOT COLLECTED: posted wage growth.
 *
 * Hiring Lab publishes it, and it would be the obvious fourth tracker. Its US
 * sector list is nineteen sectors long -- administrative assistance, childcare,
 * cleaning, construction, customer service, dental, education, food service,
 * installation, loading, management, medical technician, nursing, personal
 * care, production, retail, security, therapy, and one more. None of which is
 * software, or anything adjacent to it.
 *
 * Storing it would put a pay figure on a page read by somebody deciding what
 * technical work to take, and that figure would be about nursing. An adjacent
 * number that does not apply is worse than no number, because a reader assumes
 * a number on the page is about the page.
 */
const SOURCES: Array<{
  dataset: string; url: string; read: (t: string) => LabourRow[];
}> = [
  {
    dataset: 'postings',
    url: `${BASE}/job_postings_tracker/master/US/job_postings_by_sector_US.csv`,
    read: readPostings,
  },
  {
    dataset: 'remote',
    url: `${BASE}/remote-tracker/main/remote_postings_sector.csv`,
    read: readRemote,
  },
  {
    dataset: 'ai',
    url: `${BASE}/ai-tracker/main/AI_posting.csv`,
    read: readAi,
  },
];

/**
 * Write a batch, replacing what is already there for the same day.
 *
 * These publishers revise: a figure for last Tuesday can change when the next
 * week's data lands, because the seasonal adjustment is refitted. An insert
 * that ignored conflicts would freeze the first value ever seen and quietly
 * disagree with the source for ever, so this overwrites and records when.
 */
async function store(db: Db, source: string, rows: LabourRow[]): Promise<number> {
  const CHUNK = 2_000;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = batch.map((r, n) => {
      const b = n * 7;
      values.push(source, r.dataset, r.country, r.sector, r.measure, r.day, r.value);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::date, $${b + 7}::numeric)`;
    }).join(', ');
    await db.query(
      `INSERT INTO labour_series
         (source, dataset, country, sector, measure, day, value)
       VALUES ${tuples}
       ON CONFLICT (source, dataset, country, sector, measure, day)
       DO UPDATE SET value = EXCLUDED.value, fetched_at = now()`, values);
    written += batch.length;
  }
  return written;
}

/**
 * Fetch every tracker and store what it says.
 *
 * ONE FAILING DATASET DOES NOT FAIL THE PASS. These are three independent files
 * in three independent repositories; if the remote tracker is mid-push and
 * answers 404, the postings numbers are still worth having and the job note
 * says which one was missed.
 */
export async function refreshLabour(
  db: Db, opts: { userAgent?: string; fetchImpl?: typeof fetch } = {},
): Promise<LabourReport> {
  const doFetch = opts.fetchImpl ?? fetch;
  const report: LabourReport = { fetched: 0, stored: 0, datasets: [], failed: [] };

  for (const src of SOURCES) {
    try {
      const res = await doFetch(src.url, {
        headers: { 'user-agent': opts.userAgent ?? 'NewsTrack' },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) { report.failed.push(`${src.dataset} ${res.status}`); continue; }
      const rows = src.read(await res.text());
      report.fetched += rows.length;
      if (rows.length === 0) { report.failed.push(`${src.dataset} empty`); continue; }
      report.stored += await store(db, 'indeed-hiring-lab', rows);
      report.datasets.push(src.dataset);
    } catch (err) {
      report.failed.push(`${src.dataset} ${(err as Error).message.slice(0, 60)}`);
    }
  }
  return report;
}

export function summariseLabour(r: LabourReport): string {
  if (r.skipped) return r.skipped;
  const ok = r.datasets.length === 0 ? 'nothing stored' : `${r.datasets.join(', ')}`;
  return `${r.stored} rows from ${ok}${
    r.failed.length > 0 ? `; failed: ${r.failed.join(', ')}` : ''}`;
}

// Removes sentences about a report's own sources from every stored report.
//
//   node --experimental-strip-types scripts/scrub-report-meta.ts          dry run
//   node --experimental-strip-types scripts/scrub-report-meta.ts --apply  write
//
// New reports are filtered as they are written -- `validateStrategy` and
// `analyseFieldBriefing` pass every line through `aboutTheMarket`. This is for
// what was stored before that, and it is idempotent: a second run finds nothing.
//
// It touches prose only. Citations, confidence markers and the measured
// figures are left exactly as they were, and `limits` is emptied because the
// whole paragraph was about the evidence.

import { loadDotEnv } from '../src/lib/dotenv.ts';
import { createDb } from '../src/db/client.ts';
import { aboutTheMarket } from '../src/analysis/marketonly.ts';

await loadDotEnv();
const APPLY = process.argv.includes('--apply');
const db = createDb(process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL ?? '');

/** Keys that hold prose. Everything else -- ids, urls, citations -- is data. */
const PROSE = new Set([
  'read', 'before', 'after', 'moved', 'what', 'why', 'skills', 'claim',
  'reasoning', 'falsifier', 'who', 'bet', 'sides', 'title', 'body',
]);
/** Branches that are citations or measurements, never prose. */
const DATA = new Set(['then', 'now', 'evidence', 'history', 'outside', 'measured', 'figures']);

let changed = 0;

function scrub(o: unknown, path: string, log: string[]): unknown {
  if (Array.isArray(o)) return o.map((x, i) => scrub(x, `${path}[${i}]`, log));
  if (!o || typeof o !== 'object') return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (k === 'limits') { if (v) log.push(`${path}.limits emptied`); out[k] = ''; continue; }
    if (typeof v === 'string' && PROSE.has(k)) {
      const t = aboutTheMarket(v);
      if (t !== v) log.push(`${path}.${k}\n    was: ${v}\n    now: ${t}`);
      out[k] = t;
    } else if (typeof v === 'string' && k === 'watch') {
      out[k] = v;
    } else if (Array.isArray(v) && k === 'watch') {
      out[k] = v.map((w) => aboutTheMarket(String(w))).filter(Boolean);
    } else if (v && typeof v === 'object' && !DATA.has(k)) {
      out[k] = scrub(v, `${path}.${k}`, log);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const briefings = await db.query<Record<string, any>>(
  `SELECT day::text AS day, field, headline, summary, gaps, payload, strategy
     FROM field_briefings ORDER BY day, field`);
for (const b of briefings) {
  const log: string[] = [];
  const next = {
    headline: aboutTheMarket(b.headline ?? ''),
    summary: aboutTheMarket(b.summary ?? ''),
    gaps: aboutTheMarket(b.gaps ?? ''),
    payload: scrub(b.payload, 'payload', log),
    strategy: b.strategy ? scrub(b.strategy, 'strategy', log) : null,
  };
  for (const k of ['headline', 'summary', 'gaps'] as const) {
    if ((b[k] ?? '') !== next[k]) log.push(`${k}\n    was: ${b[k]}\n    now: ${next[k]}`);
  }
  if (log.length === 0) continue;
  changed += 1;
  console.log(`\nfield_briefings ${b.day} ${b.field}\n  ${log.join('\n  ')}`);
  if (APPLY) {
    await db.query(
      `UPDATE field_briefings SET headline = $1, summary = $2, gaps = NULLIF($3, ''),
              payload = $4::jsonb, strategy = $5::jsonb
        WHERE day = $6::date AND field = $7`,
      [next.headline, next.summary, next.gaps, JSON.stringify(next.payload),
        next.strategy === null ? null : JSON.stringify(next.strategy), b.day, b.field]);
  }
}

const periods = await db.query<Record<string, any>>(
  'SELECT span, key, strategy FROM period_readings ORDER BY span, key');
for (const p of periods) {
  const log: string[] = [];
  const next = scrub(p.strategy, 'strategy', log);
  if (log.length === 0) continue;
  changed += 1;
  console.log(`\nperiod_readings ${p.span} ${p.key}\n  ${log.join('\n  ')}`);
  if (APPLY) {
    await db.query('UPDATE period_readings SET strategy = $1::jsonb WHERE span = $2 AND key = $3',
      [JSON.stringify(next), p.span, p.key]);
  }
}

console.log(`\n${changed} report(s) ${APPLY ? 'rewritten' : 'would change'}${APPLY ? '' : ' -- dry run, pass --apply to write'}.`);
process.exit(0);

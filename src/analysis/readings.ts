// The reading that failed at breakfast, attempted again while the day is still
// the day.
//
// Asked for on 2026-09-10: "check this report .../field/ai/report/2026-09-10.
// It is only summary of report, it doesn't any new change."
//
// THE REPORT WAS EXACTLY THAT, AND HERE IS THE MEASUREMENT. Every field written
// that morning carried its summary and no reading at all:
//
//   2026-09-09   4 of 4 fields had a strategic reading
//   2026-09-10   0 of 5
//
// Five fields, five different last words from the one provider that was still
// answering:
//
//   ai         unparseable output
//   cloud      schema: $.openings[0].what: required
//   data       503, "this model is currently experiencing high demand"
//   infra      schema: $.openings[0].what: required
//   security   unparseable output
//
// Two of those five are fixed at the source -- the prompt never named
// `openings[].what`, see the note in llm/jobs.ts -- and one was a transient 503.
// But the shape of the failure is the thing this module exists for, and it is
// not really about any of those causes.
//
// THE REPORT GETS ONE ATTEMPT A DAY, AT THE WORST MOMENT OF THE DAY. It runs at
// 07:00. By 07:00 the overnight ingestion has already spent the free tiers on
// the work that cannot wait: measured on 2026-09-10, 319 `classify` calls, 281
// `entity_extraction`, 53 `dedup_pairs` -- roughly 650 model calls before the
// report asks for its first. So the report reaches for a model at the one hour
// when the budget is emptiest, fails, and nothing tries again until tomorrow
// morning, when it will fail the same way for the same reason.
//
// Quotas refill. Nothing was reaching for them.
//
// So this walks the most recent report and fills in the readings that are still
// missing, a few at a time, several times a day. It is the cheapest possible
// version of that: it writes ONLY the reading, into the row the morning already
// wrote, so the summary, the citations and the day's record are untouched.
//
// It costs nothing on a day when the morning succeeded -- there is nothing to
// select -- and it asks the budget table whether any provider is reachable
// before it does a single piece of research.

import type { Db } from '../db/client.ts';
import { q } from '../ui/db.ts';
import { type LlmContext, anyProviderUsable } from '../llm/router.ts';
import type { Query, Window } from './corpus.ts';
import { fieldCorpus, subjectsOf } from './corpus.ts';
import { publicFigures, bySize } from './public.ts';
import { analyseField } from './strategy.ts';
import { storedStrategy, type Briefing } from './briefing.ts';

/**
 * How many fields to attempt per run.
 *
 * Small on purpose. Each one is a model call against a budget that is the
 * binding constraint on this whole system, and the point is to be present
 * whenever quota frees up rather than to drain it the moment it does. Four a
 * run, several runs a day, is more than the fourteen a report asks for.
 */
export const TOPUP_BATCH = 4;

export interface TopUpResult {
  /** The day whose report was topped up, or null when there was nothing to do. */
  day: string | null;
  tried: number;
  written: number;
  /** Still missing a reading after this run. */
  missing: number;
  /** Set when the run stopped before trying anything, and why. */
  held?: string;
}

interface Pending {
  day: string;
  field: string;
  from: string;
  to: string;
}

/**
 * Fields whose morning left a model-shaped hole.
 *
 * ONLY where a model was asked and did not answer. `strategyGap` also carries
 * "no earlier stories to compare against", which is a fact about the archive's
 * depth on that subject and will be just as true this afternoon -- retrying it
 * spends a call to learn nothing. The gap text is the discriminator because it
 * is what `analyseField` already writes there.
 *
 * NEWEST DAY FIRST, and within it the fields in a stable order, so a run that
 * only gets through half the backlog gets through the same half's successors
 * next time rather than starting over.
 */
async function pending(query: Query, limit: number): Promise<Pending[]> {
  return await query<Pending>(
    `SELECT day::text AS day, field,
            covered_from::text AS "from", covered_to::text AS "to"
       FROM field_briefings
      WHERE strategy IS NULL
        AND payload->>'strategyGap' LIKE 'no model answered%'
        AND day > current_date - 3
      ORDER BY day DESC, field
      LIMIT $1`, [limit]);
}

/**
 * Write one reading into the row that is already there.
 *
 * A targeted UPDATE rather than a re-save of the day's report, because
 * `saveArchiveReport` writes the whole archive report -- every field's row plus
 * the `daily_reports` record and its `covered_to` read cursor. Re-running it
 * over a subset of fields would rewrite the day's record as though only those
 * fields had been reported, and touching `covered_to` at all risks the failure
 * that cost this archive a day of news on 2026-09-09.
 *
 * The gap is removed in the same statement. A row carrying both a reading and
 * "no model answered" would render both, and the page would tell the reader
 * there was no reading directly above one.
 */
async function store(
  query: Query, p: Pending, b: Briefing,
): Promise<void> {
  // `storedStrategy` resolves every citation index against `b.corpus` and drops
  // the ones that do not resolve, so it must be given the SAME corpus the model
  // was shown. Handing it a stub would store a reading whose every claim had
  // lost its evidence -- and `validateStrategy` has already passed by then, so
  // nothing downstream would notice: the page would render confident,
  // uncitable paragraphs. That is the exact failure this archive is built to
  // refuse, arrived at from the inside.
  const shaped = storedStrategy(b);
  if (!shaped) return;
  await query(
    `UPDATE field_briefings
        SET strategy = $3::jsonb,
            payload = payload - 'strategyGap',
            history_read = $4,
            history_from = $5::date,
            generated_at = now()
      WHERE day = $1::date AND field = $2`,
    [p.day, p.field, JSON.stringify(shaped),
      b.strategy?.history?.n ?? null, b.strategy?.history?.from ?? null]);
}

/**
 * Fill in the readings the most recent reports could not get.
 *
 * `outsideDb` is the writer the research cache needs -- a resolved package, a
 * fetched curve and a seen headline are all worth keeping so the next attempt
 * does not ask the same public API the same question.
 */
export async function topUpReadings(
  ctx: LlmContext, query: Query = q, outsideDb: Db | null = null,
  batch = TOPUP_BATCH,
): Promise<TopUpResult> {
  const rows = await pending(query, batch);
  const [left] = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM field_briefings
      WHERE strategy IS NULL AND payload->>'strategyGap' LIKE 'no model answered%'
        AND day > current_date - 3`);
  const missing = Number(left?.n ?? 0);

  if (rows.length === 0) return { day: null, tried: 0, written: 0, missing: 0 };

  // BEFORE THE RESEARCH, NOT AFTER. See anyProviderUsable: the expensive half of
  // analyseField is the open-web research it does before it reaches for a model.
  if (!await anyProviderUsable(ctx, 'field_strategy')) {
    return { day: rows[0]!.day, tried: 0, written: 0, missing,
      held: 'no provider is reachable yet' };
  }

  // ONE SET FOR THE RUN, exactly as briefArchive keeps one for the report: two
  // fields must not cite the same outside story, and the second one to want it
  // is the one that goes without.
  const seenOutside = new Set<string>();
  let written = 0;

  for (const p of rows) {
    const win: Window = { from: p.from, to: p.to };
    const corpus = await fieldCorpus(p.field, win, query);
    if (corpus.length === 0) continue;

    const figures = bySize(
      (await publicFigures(subjectsOf(corpus, 20), query)).values()).slice(0, 12);

    const read = await analyseField(
      ctx, p.field, win, corpus, figures, query, undefined, outsideDb, seenOutside);
    if (read.status !== 'written') continue;

    await store(query, p, {
      field: p.field, corpus, strategy: read.strategy,
    } as unknown as Briefing);
    written += 1;
  }

  return { day: rows[0]!.day, tried: rows.length, written, missing: missing - written };
}

/** One line for the job log. */
export function summariseTopUp(r: TopUpResult): string {
  if (r.day === null) return 'every recent field has its reading';
  if (r.held) return `${r.missing} still without a reading: ${r.held}`;
  return `${r.day}: ${r.written} of ${r.tried} now read, `
    + `${r.missing} still missing`;
}

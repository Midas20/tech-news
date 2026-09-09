// What came before, so that today can be read as a change rather than an event.
//
// Asked for on 2026-09-09, against a briefing that had repeated a Databricks
// conference post almost verbatim: "This report is only repeat of some news
// content... you have to collect past news that related to the news and analysis
// all news that are related to same field today, and then you can find the trend
// or fashion or new opportunity or new direction, the company's thought."
//
// The diagnosis is structural and it is not the prompt's fault. `fieldCorpus`
// is bounded at both ends by the report window -- deliberately, because a report
// covering the period since the last one is what made the daily report actually
// daily. But a corpus that holds only the last day CANNOT support a claim about
// direction. "Databricks is making auditability its wedge into regulated
// finance" is a statement about a trajectory, and there is no trajectory in a
// single day's stories. The model had two options: repeat the post, or invent
// the trend. It repeated the post, which is the better of the two.
//
// So this module fetches the other end of the comparison. Same subjects, the
// months BEFORE the report window, deliberately excluding the window itself so
// the two sets cannot overlap and a "then and now" cannot cite the same story
// twice.

import {
  fieldPool, diversify, shape, subjectsOf, CAPS,
  type Item, type Window, type Query, type RawItem,
} from './corpus.ts';
import { q } from '../ui/db.ts';

/**
 * How far back the comparison reaches.
 *
 * Six months, against a retention window of four. The gap is deliberate and it
 * works because of what retention actually deletes: whole stories go, and this
 * only ever reads what is still there. A shorter reach would make the
 * comparison weaker for no benefit; a longer one would mostly return nothing
 * and cost a query saying so.
 */
export const LOOKBACK_DAYS = 180;

/**
 * How many prior stories reach the model.
 *
 * Smaller than the day's corpus on purpose. History is here to establish a
 * baseline, not to compete with today for attention -- a packet where the past
 * outweighs the present produces a retrospective, which is not what was asked
 * for either.
 */
export const HISTORY_CAP = 24;

/**
 * The stories that came before today's, on today's subjects.
 *
 * SUBJECT-LED, NOT FIELD-LED. Pulling the whole field's last six months would
 * return the field's general background, and a model asked to find a trend in
 * background will find one -- that is the failure mode this exists to avoid.
 * Narrowing to the subjects today's stories actually name means the history is
 * about the same things, so a difference between the two sets is a real
 * difference rather than a change of topic.
 *
 * Returns [] when there is no history, and the caller must treat that as "no
 * strategic claim can be made" rather than as "nothing changed".
 */
export async function priorContext(
  field: string,
  win: Window,
  subjects: string[],
  query: Query = q,
  lookbackDays = LOOKBACK_DAYS,
  cap = HISTORY_CAP,
): Promise<Item[]> {
  if (subjects.length === 0) return [];

  const rows = await query<RawItem>(
    `SELECT s.id::text AS id,
            coalesce(s.title_en, s.title_original) AS title,
            s.summary_en AS summary,
            s.canonical_url AS url,
            src.name AS source,
            src.source_type::text AS source_type,
            coalesce(s.event_kind::text, 'article') AS kind,
            coalesce(s.published_at, s.collected_at)::date::text AS when,
            s.stacks,
            s.companies,
            s.platforms,
            s.importance
       FROM stories s
       JOIN sources src ON src.id = s.source_id
      WHERE s.stacks && $1::text[]
        AND s.superseded_at IS NULL
        AND s.summary_en IS NOT NULL
        AND length(s.summary_en) >= 60
        -- STRICTLY BEFORE THE WINDOW. Overlapping the two sets would let a
        -- "this changed" claim cite the same story as both the before and the
        -- after, which reads as evidence and is not.
        AND coalesce(s.published_at, s.collected_at) < $2
        AND coalesce(s.published_at, s.collected_at) > $2::timestamptz
            - make_interval(days => $3)
      ORDER BY coalesce(s.importance, 0) DESC,
               coalesce(s.published_at, s.collected_at) DESC
      LIMIT 400`,
    [subjects, win.from, lookbackDays],
  );

  // The same diversity rules as the daily corpus: no single source or subject
  // gets to define what the past looked like either.
  return diversify(rows.map(shape), { ...CAPS, total: cap }, [field]);
}

/**
 * Today's stories and their background, ready for one call.
 *
 * `subjects` is derived from the day's corpus rather than passed in, so the
 * history can never be about something today's stories do not mention.
 */
export async function withHistory(
  field: string, win: Window, today: Item[], query: Query = q,
): Promise<{ today: Item[]; prior: Item[]; subjects: string[] }> {
  const subjects = subjectsOf(today, 20);
  const prior = await priorContext(field, win, subjects, query);
  return { today, prior, subjects };
}

/**
 * The history block of the prompt.
 *
 * Numbered in its own series with a P prefix. Two separate numberings would
 * collide the moment the model cited "4" -- and a citation that could mean
 * either set is a citation that proves nothing, which defeats the point of
 * making the model cite both.
 */
export function historyPacket(prior: Item[]): string {
  if (prior.length === 0) {
    return 'EARLIER COVERAGE: none. This archive holds no earlier stories on '
      + 'these subjects, so you cannot say anything about how they have changed. '
      + 'Say so in `limits` and make no claim about direction.';
  }
  return [
    `EARLIER COVERAGE (${prior.length} stories on the same subjects, before this `
      + `window). Cite these as P1, P2, ... :`,
    ...prior.map((it, i) => [
      `P${i + 1}. [${it.when}] ${it.title}`,
      `    ${it.source}${it.independent ? '' : ' (first-party)'} · ${it.kind}`,
      it.summary ? `    ${it.summary.slice(0, 300)}` : '',
    ].filter(Boolean).join('\n')),
  ].join('\n');
}

/**
 * How far back the history actually reaches, for the page to show.
 *
 * A reader judging a strategic claim needs to know whether it was drawn against
 * six months or against four days. Returned as the real span of what was read,
 * never the span that was requested.
 */
export function historySpan(prior: Item[]): { from: string; to: string; n: number } | null {
  if (prior.length === 0) return null;
  const dates = prior.map((p) => p.when).sort();
  return { from: dates[0]!, to: dates[dates.length - 1]!, n: prior.length };
}

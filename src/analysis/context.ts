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
export const HISTORY_CAP = 40;

/**
 * How many periods the history is split into before anything is chosen.
 *
 * THIS IS THE FIX FOR THE COMPLAINT "you don't analysis the relationship
 * between past and current of the fields". Measured on 2026-09-09, the history
 * for `practice` held 31 of its 40 stories from the last five weeks and four
 * from before July. The cause is that recency wins twice: the archive simply
 * holds more recent stories (557 in August against 93 in March), and the query
 * then breaks importance ties by date descending. A model handed that packet is
 * being asked how six months changed while looking almost entirely at the last
 * month, so it writes about the last month and calls it a trend -- which is
 * precisely the report that was complained about.
 *
 * Six periods over the lookback is roughly a month each, which is coarse enough
 * that a quiet month still contributes and fine enough that a shift has
 * somewhere to show up.
 */
export const PERIODS = 6;

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

  // Stratified, THEN diversified, and returned oldest first. Taking the top 40
  // by importance would hand back five weeks of stories with a six-month label
  // on them; see PERIODS.
  return stratify(rows.map(shape), win.from, lookbackDays, cap, field);
}

/**
 * Spread a choice of stories evenly across the months they came from.
 *
 * The lookback is cut into PERIODS equal spans and each period is diversified on
 * its own -- so no single source or subject defines what any one month looked
 * like -- and then the periods are drawn from in rotation until the cap is
 * reached. A period holding nothing costs nothing: the rotation simply skips it
 * and the others take its share, so a field that genuinely went quiet in April
 * is not padded and a field that was busy does not swallow the packet.
 *
 * Returned OLDEST FIRST, which is not cosmetic. The packet numbers stories in
 * array order, so oldest-first makes the numbering itself run forwards through
 * time: a claim citing P3 against P37 is visibly a claim about a span, and the
 * model can see the arc in the order it reads.
 */
export function stratify(
  items: Item[], before: string, lookbackDays: number, cap: number, field: string,
): Item[] {
  if (items.length === 0) return [];

  const end = Date.parse(before);
  const start = end - lookbackDays * 86_400_000;
  const width = (end - start) / PERIODS;

  const periods: Item[][] = Array.from({ length: PERIODS }, () => []);
  for (const it of items) {
    const at = Date.parse(it.when);
    // Anything unparseable or out of range lands in the period nearest to it
    // rather than being dropped: a story with a bad date is still evidence.
    const i = Number.isNaN(at) ? PERIODS - 1
      : Math.min(PERIODS - 1, Math.max(0, Math.floor((at - start) / width)));
    periods[i]!.push(it);
  }

  // Each period diversified against a generous share, so that the rotation has
  // something to fall back on when a neighbouring period is empty.
  const share = Math.max(2, Math.ceil(cap / PERIODS) * 2);
  const pools = periods.map((p) => diversify(p, { ...CAPS, total: share }, [field]));

  const picked: Item[] = [];
  const seen = new Set<string>();
  for (let round = 0; picked.length < cap && round < share; round += 1) {
    let took = false;
    for (const pool of pools) {
      const it = pool[round];
      if (!it || seen.has(it.id)) continue;
      seen.add(it.id);
      picked.push(it);
      took = true;
      if (picked.length >= cap) break;
    }
    if (!took) break;
  }

  return picked.sort((a, b) => a.when.localeCompare(b.when));
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
const NL = String.fromCharCode(10);

export function historyPacket(prior: Item[]): string {
  if (prior.length === 0) {
    return 'EARLIER COVERAGE: none. This archive holds no earlier stories on '
      + 'these subjects, so you cannot say anything about how they have changed. '
      + 'Say so in `limits` and make no claim about direction.';
  }

  // GROUPED BY MONTH, OLDEST FIRST. The same forty stories in one flat list are
  // forty stories; under month headings they are a sequence, and the question
  // "what is different between the top of this list and the bottom" has a shape
  // the model can answer. The numbering stays a single ascending series across
  // the groups, because it is the index into the array and a per-group
  // numbering would make P3 ambiguous.
  const months = new Map<string, string[]>();
  prior.forEach((it, i) => {
    const key = it.when.slice(0, 7);
    const line = [
      `P${i + 1}. [${it.when}] ${it.title}`,
      `    ${it.source}${it.independent ? '' : ' (first-party)'} · ${it.kind}`,
      it.summary ? `    ${it.summary.slice(0, 300)}` : '',
    ].filter(Boolean).join(NL);
    const bucket = months.get(key);
    if (bucket) bucket.push(line); else months.set(key, [line]);
  });

  const span = historySpan(prior)!;
  return [
    `EARLIER COVERAGE: ${prior.length} stories on the same subjects, from `
      + `${span.from} to ${span.to}, ALL OF THEM BEFORE THIS WINDOW. They are `
      + 'grouped by month and run oldest first, so the difference between the '
      + 'earliest group and the latest group IS the change you are being asked '
      + 'to describe. Cite these as P1, P2, ... :',
    ...[...months.entries()].map(([month, lines]) =>
      `${NL}--- ${month} ---${NL}${lines.join(NL)}`),
  ].join(NL);
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

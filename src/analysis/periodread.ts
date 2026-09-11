// A month, read against what came before it.
//
// 2026-09-10, against /reports/month/2026-07: "hey kidding me?"
//
// The page had answered a request for analysis with a paragraph explaining why
// there could not be any. It was accurate and it was useless, and the reason it
// gave had never been measured.
//
// THE CLAIM WAS "A PERIOD DOES NOT FIT IN A PROMPT". That is true of a year --
// the archive holds 5,461 stories back to 2010 -- and it was written down about
// the year and then repeated about every span. Measured:
//
//   2026-05    163 readable stories
//   2026-06    266
//   2026-07    360
//   2026-08    790
//   2026-09  1,882
//
// A daily field briefing reads 80 stories in a ~54,000 character prompt. July,
// diversified, is the same size. The period pages were refusing work that fits.
//
// WHAT THIS ADDS, WHICH IS ALMOST NO MACHINERY. `analyseField` already takes
// its window and its corpus as arguments and derives the earlier end from the
// subjects the corpus names. Point it at a month instead of a day and it does
// the same thing over a longer baseline: what was being said about these
// subjects BEFORE this month, against what was said during it. That comparison
// -- "analysis the news in the period with old news that related to each news"
// -- is the thing that was asked for, and one model call produces it.
//
// ONE CALL PER PERIOD, NOT ONE PER FIELD. A month report is one report. Reading
// it fourteen times and stapling the results together would cost fourteen calls
// from a budget that is the binding constraint on this system, and would produce
// fourteen partial answers to a question nobody asked per-field.
//
// THE CORPUS IS ARCHIVE-WIDE, and that is the other difference from a daily
// briefing. `fieldPool` filters on `stacks && stack_expand(field)`, which is
// right for a field page and wrong here: a funding round belongs to no field,
// and the period report is the one page where it has always belonged.

import type { Db } from '../db/client.ts';
import { q } from '../ui/db.ts';
import type { LlmContext } from '../llm/router.ts';
import { anyProviderUsable } from '../llm/router.ts';
import {
  diversify, shape, subjectsOf, CAPS,
  type Item, type RawItem, type Query, type Window,
} from './corpus.ts';
import { analyseField } from './strategy.ts';
import { publicFigures, bySize } from './public.ts';
import { storedStrategy, type Briefing } from './briefing.ts';
import { rangeFor, keyFor, type Span, type Range } from './period.ts';

/**
 * How many stories one period reading is written from.
 *
 * Larger than a daily briefing's corpus, because the window is thirty times as
 * wide and a month summarised from eighty stories would be a month summarised
 * from two and a half days of them. Still comfortably inside a prompt: 120
 * stories at ~300 characters of summary each is around 45,000 characters, which
 * is the size the daily briefing already sends.
 */
export const PERIOD_CORPUS = 120;

/** How deep to draw from before diversifying. */
const PERIOD_POOL = 900;

/**
 * Every readable story in the period, across the whole archive.
 *
 * Ordered so that the events come first -- a launch, a funding round, an
 * acquisition, a release -- because those are what the archive exists to catch
 * and what a period report is about. `diversify` then caps any one publisher
 * and any one project, so a month in which Vercel published forty times does
 * not become a report about Vercel.
 */
export async function periodPool(
  range: Range, query: Query = q, pool = PERIOD_POOL,
): Promise<Item[]> {
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
            coalesce(s.companies, '{}') AS companies,
            coalesce(s.platforms, '{}') AS platforms,
            s.importance
       FROM stories s
       JOIN sources src ON src.id = s.source_id
      WHERE s.superseded_by IS NULL AND s.dismissed_at IS NULL
        AND coalesce(s.published_at, s.collected_at) >= $1::timestamptz
        AND coalesce(s.published_at, s.collected_at) <  $2::timestamptz
        AND s.summary_en IS NOT NULL AND length(s.summary_en) >= 60
      ORDER BY
        CASE coalesce(s.event_kind::text, 'article')
          WHEN 'launch' THEN 4 WHEN 'market' THEN 4 WHEN 'change' THEN 3
          WHEN 'release' THEN 2 ELSE 1 END DESC,
        s.importance DESC NULLS LAST,
        coalesce(s.published_at, s.collected_at) DESC
      LIMIT $3`,
    [range.from, range.to, pool]);
  return rows.map(shape);
}

/**
 * The pool, capped so no publisher and no month can speak for the period.
 *
 * STRATIFIED BY MONTH, and for a long span that is the difference between a
 * report and a misdated one. `periodPool` orders by event kind, then importance,
 * then recency, which is right for a day and wrong for a year: measured on the
 * 2026 corpus before this existed,
 *
 *   2026-09  63     2026-06  11     2026-04   2
 *   2026-08  28     2026-07   9     2026-03   3
 *   2026-05   4
 *
 * -- 63 of 120 stories from the last two days of the span, two from April. A
 * reading written from that is a September reading with a year's title on it,
 * and the title is the part a reader would believe.
 *
 * So each month gets a fair share and they are taken round-robin, oldest first
 * within each. A month that cannot fill its share gives the remainder back to
 * the others rather than shrinking the corpus, because a quiet April is not a
 * reason to read less of the year.
 *
 * `diversify` still runs per month, so one publisher cannot own a month either.
 * The same rotation `priorContext` uses for history, for the same reason.
 */
export async function periodCorpus(
  range: Range, query: Query = q, cap = PERIOD_CORPUS,
): Promise<Item[]> {
  const pool = await periodPool(range, query);

  const months = new Map<string, Item[]>();
  for (const it of pool) {
    const key = it.when.slice(0, 7);
    const bucket = months.get(key);
    if (bucket) bucket.push(it); else months.set(key, [it]);
  }

  // One month is a month: nothing to stratify, and the existing behaviour is
  // already right for it.
  if (months.size <= 1) return diversify(pool, { ...CAPS, total: cap }, []);

  const share = Math.max(2, Math.ceil((cap / months.size) * 2));
  const ordered = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const pools = ordered.map(([, items]) =>
    diversify(items, { ...CAPS, total: share }, []));

  const picked: Item[] = [];
  const seen = new Set<string>();
  for (let round = 0; picked.length < cap && round < share; round += 1) {
    let took = false;
    for (const bucket of pools) {
      const it = bucket[round];
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

export type ReadOutcome =
  | { status: 'written'; span: Span; key: string; read: number; provider?: string }
  | { status: 'thin'; read: number }
  /** Enough stories, too few publishers behind them. */
  | { status: 'narrow'; read: number; sources: number; topShare: number }
  | { status: 'held'; why: string }
  | { status: 'unwritten'; why: string };

/**
 * How much of a period one publisher may account for before it is that
 * publisher's year rather than the industry's.
 *
 * ASKED ON 2026-09-10: "Generate all report of 10 years." The archive does hold
 * ten years -- and measured that day, this is what they are:
 *
 *   year   stories   sources   top 3 publishers
 *   2017        27         4              96%
 *   2019        54         5              91%
 *   2021       121         5              93%
 *   2023       371         7              91%
 *   2024       389         8              93%
 *   2025       934        15              87%
 *   2026     3,995       106              35%
 *
 * 1,392 of the 1,402 stories before 2025 come from five vendor blogs: Hugging
 * Face, ClickHouse, Shopify, Vercel and OpenAI. They are there because those
 * blogs keep deep archives that a backfill could walk, which is a fact about
 * their publishing software.
 *
 * A "2019 report" written from that corpus would be Shopify and ClickHouse's
 * 2019 blog posts wearing the title of a year in technology. It would read
 * plausibly -- that is what makes it dangerous -- and every claim in it would
 * be a claim about three companies. This archive already refuses to count its
 * own stories for exactly this reason; publishing a year drawn from three
 * publishers is the same error one level up.
 *
 * SIXTY PER CENT, and the margin is why it is safe rather than lucky: the one
 * year that can support a report sits at 35% and the next-best at 87%. The line
 * is in the middle of a gap, not at the edge of either side.
 */
export const MAX_TOP_SHARE = 0.6;

/** And a floor on how many publishers there are at all. */
export const MIN_PERIOD_SOURCES = 12;

/** The share of a corpus held by its three largest publishers. */
export function topShare(items: Item[], top = 3): number {
  if (items.length === 0) return 1;
  const n = new Map<string, number>();
  for (const it of items) n.set(it.source, (n.get(it.source) ?? 0) + 1);
  const biggest = [...n.values()].sort((a, b) => b - a).slice(0, top);
  return biggest.reduce((a, b) => a + b, 0) / items.length;
}

/**
 * Below this a period is not worth a model call.
 *
 * A month holding nine stories does not have a direction in it, and asking
 * produces the confident paragraph drawn from almost nothing that this whole
 * archive is built to refuse.
 */
export const MIN_PERIOD_CORPUS = 25;

/**
 * Read one period and store what it found.
 *
 * `force` re-reads a period that already has a reading. Off by default: a
 * settled month does not change, so re-reading it spends a call from a budget
 * that is the binding constraint here to get a differently-worded version of
 * the same answer.
 */
export async function readPeriod(
  ctx: LlmContext, span: Span, key: string,
  query: Query = q, outsideDb: Db | null = null, force = false,
): Promise<ReadOutcome> {
  const range = rangeFor(span, key);
  if (!range) return { status: 'unwritten', why: `not a ${span}: ${key}` };

  if (!force) {
    const [have] = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM period_readings
        WHERE span = $1 AND key = $2`, [span, key]);
    if (Number(have?.n ?? 0) > 0) {
      return { status: 'held', why: 'already read' };
    }
  }

  const corpus = await periodCorpus(range, query);
  if (corpus.length < MIN_PERIOD_CORPUS) {
    return { status: 'thin', read: corpus.length };
  }

  // ENOUGH STORIES IS NOT ENOUGH. See MAX_TOP_SHARE: 2024 holds 389 stories and
  // 93% of them are three companies' blogs. A model handed that corpus will
  // write a confident year in technology, because the corpus does not tell it
  // that everything it is reading came from three publishers.
  const sources = new Set(corpus.map((i) => i.source)).size;
  const share = topShare(corpus);
  if (sources < MIN_PERIOD_SOURCES || share > MAX_TOP_SHARE) {
    return { status: 'narrow', read: corpus.length, sources,
      topShare: Math.round(share * 100) };
  }

  // BEFORE THE MODEL CALL AND AFTER THE CORPUS. The corpus is one query; the
  // research `analyseField` does is many, against public APIs, and there is no
  // point spending it to arrive at "budget exhausted".
  if (!await anyProviderUsable(ctx, 'field_strategy')) {
    return { status: 'held', why: 'no provider is reachable' };
  }

  const win: Window = { from: range.from, to: range.to };
  const figures = bySize(
    (await publicFigures(subjectsOf(corpus, 20), query)).values()).slice(0, 12);

  // `field` reaches the prompt as a label and reaches `priorContext` only as a
  // hint to `diversify`. Naming the span is more honest than borrowing one of
  // the fourteen field slugs, which would tell the model this is a report about
  // infrastructure when it is a report about a month.
  const read = await analyseField(
    ctx, `every field, over ${range.label}`, win, corpus, figures,
    query, undefined, outsideDb, new Set());

  if (read.status !== 'written') {
    return { status: 'unwritten',
      why: read.status === 'no_history'
        ? 'no earlier stories on these subjects to compare against'
        : read.why };
  }

  // Shaped by the same function the daily reports use, so one renderer serves
  // both and the two cannot drift apart. It resolves every citation index
  // against the corpus the model was shown, so the corpus must be the one
  // passed in above.
  const shaped = storedStrategy({
    field: span, corpus, strategy: read.strategy,
  } as unknown as Briefing);

  await query(
    `INSERT INTO period_readings
       (span, key, provider, covered_from, covered_to, stories_read,
        history_read, history_from, strategy)
     VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8::date, $9::jsonb)
     ON CONFLICT (span, key) DO UPDATE SET
       generated_at = now(), provider = EXCLUDED.provider,
       covered_from = EXCLUDED.covered_from, covered_to = EXCLUDED.covered_to,
       stories_read = EXCLUDED.stories_read,
       history_read = EXCLUDED.history_read,
       history_from = EXCLUDED.history_from,
       strategy = EXCLUDED.strategy`,
    [span, key, read.strategy.provider ?? null, range.from, range.to,
      corpus.length, read.strategy.history?.n ?? null,
      read.strategy.history?.from ?? null, JSON.stringify(shaped)]);

  return { status: 'written', span, key, read: corpus.length,
    ...(read.strategy.provider ? { provider: read.strategy.provider } : {}) };
}

export interface StoredPeriodReading {
  span: string;
  key: string;
  provider: string | null;
  storiesRead: number;
  historyRead: number | null;
  historyFrom: string | null;
  generatedAt: string;
  strategy: unknown;
}

/** What was read for this period, or null when it has not been read. */
export async function periodReading(
  span: Span, key: string, query: Query = q,
): Promise<StoredPeriodReading | null> {
  const [r] = await query<{
    span: string; key: string; provider: string | null;
    stories_read: number; history_read: number | null; history_from: string | null;
    generated_at: string; strategy: unknown;
  }>(
    `SELECT span, key, provider, stories_read, history_read,
            history_from::text AS history_from, generated_at::text AS generated_at,
            strategy
       FROM period_readings WHERE span = $1 AND key = $2`, [span, key]);
  if (!r) return null;
  return {
    span: r.span, key: r.key, provider: r.provider,
    storiesRead: Number(r.stories_read),
    historyRead: r.history_read === null ? null : Number(r.history_read),
    historyFrom: r.history_from, generatedAt: r.generated_at,
    strategy: r.strategy,
  };
}

/**
 * Read the recent periods that have not been read yet.
 *
 * NEWEST FIRST, and only one per run. Each is a model call against the budget
 * that is the binding constraint on this system, and the useful property is not
 * speed -- it is that the backlog drains on its own whenever quota exists,
 * instead of waiting for somebody to ask.
 *
 * WHY IT LOOKS BACK FOUR MONTHS AND NO FURTHER. Retention deletes stories after
 * four months, so a period older than that has nothing left to read: the
 * archive keeps the analysis and not the evidence, and a reading written now
 * from an empty corpus would be a reading of nothing. Periods read while their
 * stories still existed keep their reading for ever -- which is the whole point
 * of storing it rather than composing it on view.
 */
export async function readBacklog(
  ctx: LlmContext, query: Query = q, outsideDb: Db | null = null,
  now = new Date(),
): Promise<ReadOutcome & { pending?: number }> {
  const wanted: Array<{ span: Span; key: string }> = [];
  const day = 86_400_000;

  // Months, newest first, back four. The current month is included: a partial
  // month is a legitimate question ("what has this month been so far") and the
  // reading is refreshed by `force` when the month settles, not by this.
  for (let i = 0; i < 4; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    wanted.push({ span: 'month', key: d.toISOString().slice(0, 7) });
  }
  // Weeks, newest first, back eight.
  for (let i = 0; i < 8; i += 1) {
    const d = new Date(now.getTime() - i * 7 * day);
    wanted.push({ span: 'week', key: keyFor('week', d.toISOString().slice(0, 10)) });
  }
  wanted.push({ span: 'year', key: String(now.getUTCFullYear()) });

  const have = new Set((await query<{ span: string; key: string }>(
    `SELECT span, key FROM period_readings`)).map((r) => `${r.span}:${r.key}`));
  const todo = wanted.filter((w) => !have.has(`${w.span}:${w.key}`));

  if (todo.length === 0) return { status: 'held', why: 'every recent period is read' };
  if (!await anyProviderUsable(ctx, 'field_strategy')) {
    return { status: 'held', why: 'no provider is reachable', pending: todo.length };
  }

  // ONE PER RUN. Two would double the chance that the second finds the budget
  // the first just spent, which is a slower way of achieving the same thing
  // while looking busier in the log.
  const next = todo[0]!;
  const out = await readPeriod(ctx, next.span, next.key, query, outsideDb);
  return { ...out, pending: todo.length - (out.status === 'written' ? 1 : 0) };
}

export function summariseRead(r: ReadOutcome & { pending?: number }): string {
  const left = r.pending === undefined ? '' : `; ${r.pending} still to read`;
  switch (r.status) {
    case 'written':
      return `${r.span} ${r.key} read from ${r.read} stories`
        + (r.provider ? ` by ${r.provider}` : '') + left;
    case 'thin': return `too few stories to read (${r.read})${left}`;
    case 'narrow':
      return `${r.read} stories but only ${r.sources} publishers, `
        + `${r.topShare}% of it from three of them -- too narrow to read${left}`;
    case 'held': return `${r.why}${left}`;
    default: return `not read: ${r.why}${left}`;
  }
}

// The reading, as opposed to the report.
//
// Asked for on 2026-09-09, holding up a briefing that had repeated a Databricks
// conference post nearly verbatim: "I need strategy info in report not repeat of
// news, The news is only data that prove your analysis result."
//
// The complaint was right and the cause was not the wording. `fieldCorpus` is
// bounded at both ends by the report window, so the model was asked what is
// going on while holding one day of stories. There is no trajectory in one day.
// It could repeat the post or invent a trend, and repeating was the honest of
// the two. src/analysis/context.ts supplies the other end; this module asks the
// question and then throws away every answer that does not hold it up.
//
// WHAT MAKES THIS ANALYSIS RATHER THAN OPINION is one rule, enforced here and
// not merely requested in the prompt: a claim about direction must cite an
// earlier story AND a recent one. A model cannot satisfy that by rewording a
// press release, and a reader can check the two ends against each other. Claims
// that fail it are dropped, not softened -- a strategic paragraph a reader
// cannot check is worse than no strategic paragraph, because it reads exactly
// like one they can.

import type { LlmContext } from '../llm/router.ts';
import { llmCall } from '../llm/router.ts';
import { subjectsOf, type Item, type Window, type Query } from './corpus.ts';
import { q } from '../ui/db.ts';
import { withHistory, historyPacket, historySpan } from './context.ts';
import { gatherOutside, outsidePacket, type Outside } from './outside.ts';
import { corpusPacket, figuresPacket } from './briefing.ts';
import { aboutTheMarket } from './marketonly.ts';
import type { PublicFigure } from './public.ts';

export const STRATEGY_VERSION = 'strategy-v1';

/**
 * How much weight a claim can carry, marked on the claim itself.
 *
 * Asked for on 2026-09-11, by way of a labour-market report that puts one of
 * these on every assertion it makes: "I want to make monthly report at this
 * level". It is the single most useful thing that report does, and it is not a
 * new idea here -- it is what every `limits` paragraph in this archive has been
 * saying in prose, moved onto the claim where a reader meets it.
 *
 *   data       a published measurement. A download curve, a postings index, a
 *              GitHub topic census, a figure the publisher stated in its own
 *              announcement. Checkable by somebody else against the same source.
 *   contested  the sources disagree, or the only source is a party with an
 *              interest in the answer. Most of this archive is this: a vendor
 *              describing its own product is good evidence of what it decided
 *              to sell and no evidence that anybody bought it.
 *   forecast   a projection, and therefore wrong in detail.
 *
 * THE DEFAULT IS `contested`, DELIBERATELY. An unmarked claim is not a
 * measured one, and the failure mode worth engineering against is a reading
 * that quietly inherits more authority than its evidence. Understating costs a
 * reader a second look; overstating costs them a decision.
 */
export type Confidence = 'data' | 'contested' | 'forecast';

export const CONFIDENCE: readonly Confidence[] = ['data', 'contested', 'forecast'];

/** Unknown, absent or misspelled all mean the same thing: not measured. */
export function confidenceOf(v: unknown): Confidence {
  const t = String(v ?? '').trim().toLowerCase();
  return (CONFIDENCE as readonly string[]).includes(t) ? t as Confidence : 'contested';
}

/** The start of the research window: LOOKBACK_DAYS before the report window. */
function earlier(from: string): string {
  return new Date(Date.parse(from) - 180 * 86_400_000).toISOString();
}

/** Below this, there is not enough of a past to compare today against. */
export const MIN_HISTORY = 4;

export interface Direction {
  claim: string;
  reasoning: string;
  /**
   * What would show this claim wrong.
   *
   * Required by the prompt and kept even when empty, because an unfalsifiable
   * claim should be visibly unfalsifiable rather than quietly indistinguishable
   * from a testable one. It is also what the standing section reports against
   * as later news arrives.
   */
  falsifier: string;
  /** Indices into the prior corpus, 1-based, as shown to the model. */
  then: number[];
  /**
   * Indices into the OUTSIDE evidence, 1-based, as an alternative earlier end.
   *
   * The pairing rule caps a reading at the depth of our own collection, and
   * this archive began collecting on 2026-09-08. A dated item from the Hacker
   * News index, or a download curve reaching back six months, is a real earlier
   * end and a more checkable one than our corpus -- anybody can re-run the same
   * public query. So `then` OR `thenOutside` satisfies the rule; neither being
   * present still drops the claim.
   */
  thenOutside: number[];
  /** Indices into today's corpus, 1-based. */
  now: number[];
  /** How much weight this claim can carry. Defaults to `contested`. */
  confidence: Confidence;
}

/**
 * What the field looked like at the far end of the history, and what it looks
 * like today. The change itself, stated once, before anything else.
 *
 * Added on 2026-09-09 after a second reading of the same complaint: "still you
 * focus on only current news, you don't analysis the relationship between past
 * and current of the fields, and I still can't find the market change."
 *
 * `direction` was already the past-to-present relationship, but it arrived as
 * three separate claims some way down the page, each with its earlier end
 * reduced to a count. Nowhere did the report say, in one line, what is
 * different now from before -- so a reader scanning the page saw today's
 * stories and today's conclusions, which is what they said they saw.
 *
 * Held to the same pairing rule as `direction`: `before` is drawn from the
 * earlier corpus, `after` from today's, and both must cite. A "shift" written
 * from today alone is the exact invention this whole module exists to refuse,
 * and it would be the most prominent paragraph on the page.
 */
export interface Shift {
  /** The field at the earlier end of the history. */
  before: string;
  /** The field today. */
  after: string;
  /** What moved between them, in one sentence a reader can disagree with. */
  moved: string;
  then: number[];
  thenOutside: number[];
  now: number[];
}

export interface Positioning {
  who: string;
  bet: string;
  confidence: Confidence;
  evidence: number[];
  /** True when the evidence is that company talking about itself. */
  firstParty: boolean;
}

/**
 * Work one person could take on, which is what this whole archive is for.
 *
 * The reader is one person deciding what to learn, build and quote for. An
 * opening that can only be taken by a vendor is not a finding for them, so
 * this is kept separate from `Opening` rather than folded into it: they
 * answer different questions and only one of them pays.
 */
export interface Work {
  what: string;
  why: string;
  skills: string;
  confidence: Confidence;
  /** now = the work exists today; months = when the change lands; watch = unproven. */
  horizon: 'now' | 'months' | 'watch';
  evidence: number[];
}

/** Where the evidence points two ways, which is a finding rather than a flaw. */
export interface Tension {
  what: string;
  sides: string;
  confidence: Confidence;
  evidence: number[];
}

export interface Opening {
  what: string;
  why: string;
  who?: string;
  confidence: Confidence;
  evidence: number[];
}

export interface Strategy {
  read: string;
  /** What is different now from before. Null when the model would not say. */
  shift: Shift | null;
  work: Work[];
  direction: Direction[];
  positioning: Positioning[];
  tensions: Tension[];
  openings: Opening[];
  limits: string;
  /** The span of earlier coverage this was drawn against. */
  history: { from: string; to: string; n: number } | null;
  /** What was found outside the archive, and what it was asked about. */
  outside: Outside | null;
  provider?: string;
  /**
   * The earlier stories themselves, so `then` indexes can be resolved into
   * citations before they are stored.
   *
   * Not persisted. It exists because the earlier end of every comparison used
   * to be thrown away at write time -- the reasoning given was that retention
   * deletes those stories, so an index would rot into a pointer at nothing.
   * True of the index, and the wrong conclusion: the emerging ledger had
   * already solved this by COPYING the title, source, date and url at write
   * time, which survives retention exactly as well as a number does and tells
   * the reader what the earlier end actually was. The result of throwing it
   * away was a page whose every claim about change showed only the present,
   * which is what "you don't analysis the relationship between past and
   * current" describes.
   */
  priorCorpus?: Item[];
}

export type StrategyOutcome =
  | { status: 'written'; strategy: Strategy }
  /** No past to compare against. A fact about the archive, and safe to say. */
  | { status: 'no_history'; prior: number }
  /** It could have been written and was not. Never call this "nothing changed". */
  | { status: 'unwritten'; why: string };

interface RawStrategy {
  read?: unknown;
  shift?: unknown;
  outside?: unknown;
  work?: unknown[];
  direction?: unknown[];
  positioning?: unknown[];
  tensions?: unknown[];
  openings?: unknown[];
  limits?: unknown;
}

/**
 * Keep only the claims the evidence actually holds up.
 *
 * THE PAIRING RULE IS THE WHOLE POINT. `then` must land inside the prior corpus
 * and `now` inside today's, and both must be non-empty. A model that has
 * nothing to compare will reach for the nearest thing it can cite -- usually
 * two of today's stories -- and produce a sentence that sounds like a trend and
 * is a restatement. That sentence is indistinguishable from a real finding
 * unless something checks the indices, so this checks the indices.
 *
 * Out-of-range citations are stripped rather than the whole claim being
 * dropped, but a claim left with an empty side after stripping goes.
 */
export function validateStrategy(
  raw: RawStrategy, todaySize: number, priorSize: number, outsideSize = 0,
): Omit<Strategy, 'history' | 'provider' | 'outside'> {
  const inRange = (n: unknown, max: number): boolean =>
    Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= max;

  const ids = (v: unknown, max: number): number[] =>
    (Array.isArray(v) ? v : [])
      .map(Number)
      .filter((n) => inRange(n, max))
      // A claim citing the same story three times cites one story.
      .filter((n, i, a) => a.indexOf(n) === i);

  // Every line of prose passes through `aboutTheMarket`, so a sentence about
  // the sources is removed whichever model wrote it and whatever the prompt
  // said. A claim left empty by that is dropped by the filters below, which is
  // right: a claim that was only about the evidence was not a claim.
  const text = (v: unknown): string => aboutTheMarket(String(v ?? '').trim());

  const direction = (Array.isArray(raw.direction) ? raw.direction : [])
    .map((d) => {
      const item = d as Record<string, unknown>;
      return {
        claim: text(item.claim),
        reasoning: text(item.reasoning),
        falsifier: text(item.falsifier),
        confidence: confidenceOf(item.confidence),
        then: ids(item.then, priorSize),
        thenOutside: ids(item.thenOutside, outsideSize),
        now: ids(item.now, todaySize),
      };
    })
    // Both ends, or it is not a claim about change. The earlier end may be our
    // own history or public evidence from outside it; it may not be absent.
    .filter((d) => d.claim && (d.then.length > 0 || d.thenOutside.length > 0)
      && d.now.length > 0);

  // THE SHIFT, HELD TO THE PAIRING RULE. This is the most prominent paragraph
  // on the page, which makes it the one most worth inventing and the one a
  // reader is least likely to check. So it is checked here: no earlier
  // citation, no shift, and the page says plainly that none was written.
  const rawShift = (raw.shift ?? {}) as Record<string, unknown>;
  const shiftDraft = {
    before: text(rawShift.before),
    after: text(rawShift.after),
    moved: text(rawShift.moved),
    then: ids(rawShift.then, priorSize),
    thenOutside: ids(rawShift.thenOutside, outsideSize),
    now: ids(rawShift.now, todaySize),
  };
  const shift = shiftDraft.before && shiftDraft.after && shiftDraft.moved
    && (shiftDraft.then.length > 0 || shiftDraft.thenOutside.length > 0)
    && shiftDraft.now.length > 0
    ? shiftDraft : null;

  const positioning = (Array.isArray(raw.positioning) ? raw.positioning : [])
    .map((p) => {
      const item = p as Record<string, unknown>;
      return {
        who: text(item.who),
        bet: text(item.bet),
        confidence: confidenceOf(item.confidence),
        // Positioning may be read from today alone -- what a company ships and
        // chooses to talk about is visible in one post. It still has to cite it.
        evidence: ids(item.evidence, todaySize),
        firstParty: item.firstParty === true,
      };
    })
    .filter((p) => p.who && p.bet && p.evidence.length > 0);

  const HORIZONS = ['now', 'months', 'watch'] as const;
  const work = (Array.isArray(raw.work) ? raw.work : [])
    .map((w) => {
      const item = w as Record<string, unknown>;
      const horizon = String(item.horizon ?? '');
      return {
        what: text(item.what),
        why: text(item.why),
        skills: text(item.skills),
        confidence: confidenceOf(item.confidence),
        // An unrecognised horizon becomes "watch" rather than being dropped.
        // Overstating how ready a piece of work is costs the reader a week;
        // understating it costs them a second look.
        horizon: (HORIZONS as readonly string[]).includes(horizon)
          ? horizon as Work['horizon'] : 'watch',
        evidence: ids(item.evidence, todaySize),
      };
    })
    .filter((w) => w.what && w.why && w.evidence.length > 0);

  // A tension is read from today alone -- it is a disagreement between the
  // sources in front of you -- so it cites today and needs no earlier end.
  const tensions = (Array.isArray(raw.tensions) ? raw.tensions : [])
    .map((t) => {
      const item = t as Record<string, unknown>;
      return {
        what: text(item.what),
        sides: text(item.sides),
        confidence: confidenceOf(item.confidence),
        evidence: ids(item.evidence, todaySize),
      };
    })
    .filter((t) => t.what && t.sides && t.evidence.length > 0);

  const openings = (Array.isArray(raw.openings) ? raw.openings : [])
    .map((o) => {
      const item = o as Record<string, unknown>;
      const who = text(item.who);
      return {
        what: text(item.what),
        why: text(item.why),
        ...(who ? { who } : {}),
        confidence: confidenceOf(item.confidence),
        evidence: ids(item.evidence, todaySize),
      };
    })
    .filter((o) => o.what && o.evidence.length > 0);

  // `limits` is kept in the shape so stored readings still load, and is never
  // filled: it was the paragraph about the evidence, and it is no longer asked
  // for or shown.
  return { read: text(raw.read), shift, work, direction, positioning, tensions,
    openings, limits: '' };
}

/**
 * The prompt: today, the months before it, and the public figures.
 *
 * Today's corpus is rendered by the same `corpusPacket` the briefing uses, so a
 * citation means the same story in both -- a reader moving between the briefing
 * and the strategy on one page is looking at one numbering, not two.
 */
export function strategyPacket(
  field: string, win: Window, today: Item[], prior: Item[],
  figures: PublicFigure[], outside: Outside | null = null,
): string {
  return [
    `FIELD: ${field}`,
    `TODAY'S WINDOW: ${win.from} to ${win.to}`,
    '',
    corpusPacket(today),
    '',
    historyPacket(prior),
    '',
    // OUTSIDE BEFORE THE FIGURES, because this is the block that answers "what
    // was happening before we were watching", and the figures block answers a
    // smaller question about how large a population is today.
    ...(outside ? [outsidePacket(outside), ''] : []),
    figuresPacket(figures),
  ].join('\n');
}

/**
 * Read one field strategically, against its own past.
 *
 * Returns `no_history` rather than writing when there is nothing to compare
 * against. That is the outcome this module exists to make possible: the failure
 * it replaces was a confident paragraph about direction drawn from a single
 * day, which is the shape of every piece of analysis nobody should trust.
 */
export async function analyseField(
  ctx: LlmContext,
  field: string,
  win: Window,
  today: Item[],
  figures: PublicFigure[],
  query: Query = q,
  minHistory = MIN_HISTORY,
  /**
   * The database the outside research writes its cache to.
   *
   * Separate from `query` because that one is the reader and this one writes:
   * a lookup that has been resolved, a curve that has been fetched and a story
   * that has been seen are all worth keeping so the next report does not ask
   * the same public API the same question.
   */
  outsideDb: import('../db/client.ts').Db | null = null,
  /**
   * URLs already used by an earlier field in the SAME report run.
   *
   * "why do you repeat same sentences in report" (2026-09-09). Measured on that
   * report: `cloud` and `data` carried 26 of 32 identical outside stories, and
   * the same headline appeared in four fields' "stories elsewhere" blocks. The
   * cause is that the search subjects are the head of the frequency list, and
   * that head is the same broad tags in every field -- cloud searched `aws, ai,
   * google, cloud, gcp, cve` and data searched `data, google, database, cms, ai,
   * cve`. Three shared terms is three shared searches is one shared list.
   *
   * The set is threaded through the whole run rather than kept per field so the
   * SECOND field to want a story is the one that goes without it. Passing null
   * keeps the old behaviour, which is what every test that calls this directly
   * relies on.
   */
  seenOutside: Set<string> | null = null,
): Promise<StrategyOutcome> {
  const { prior, subjects } = await withHistory(field, win, today, query);

  // RESEARCHED BEFORE THE HISTORY IS JUDGED, and that ordering is the point.
  // "don't be limited to db's past news" (2026-09-09): an archive nine days old
  // has almost no past of its own, so refusing to write until OUR history is
  // deep enough would refuse for ever. Outside evidence is a real earlier end.
  //
  // A WIDER SUBJECT LIST THAN THE HISTORY USES, and the width is the fix. The
  // history is led by the twenty subjects today's stories name most often, and
  // measured on 2026-09-09 those are category tags -- `ai`, `cloud`,
  // `open-source`, `startups` -- plus vendor organisations whose repo_url is
  // `github.com/aws`. None of them is a package, so the first run produced zero
  // curves on a day when polars, langchain, streamlit and jinja all had six
  // months of series available. Today's corpus named 333 technologies and 69 of
  // them have a real repository; they are simply further down the list.
  //
  // gatherOutside filters this for curves and takes the head of it for search,
  // so passing more helps the first and leaves the second alone.
  const researchSubjects = subjectsOf(today, 60);
  const outside = outsideDb
    ? await gatherOutside(outsideDb, researchSubjects, earlier(win.from), win.from,
      undefined, undefined, seenOutside, field)
      .catch(() => null)
    : null;
  const outsideSize = outside?.stories.length ?? 0;

  // Below the minimum on both, there is nothing to compare today against and
  // no amount of prompting will invent one.
  if (prior.length < minHistory && outsideSize === 0) {
    return { status: 'no_history', prior: prior.length };
  }

  const packet = strategyPacket(field, win, today, prior, figures, outside);
  const res = await llmCall<RawStrategy>(ctx, 'field_strategy', packet, {
    field, version: STRATEGY_VERSION, window: win,
  });
  if (res.status !== 'ok') {
    // The REASON, not just the status. "deferred" alone sent me looking at the
    // prompt when the answer was a provider cooldown, which is a different
    // problem with a different fix, and the page shows this line to an admin.
    const why = res.status === 'deferred' ? res.reason : `invalid: ${res.errors.join('; ')}`;
    return { status: 'unwritten', why: `no model answered: ${why}` };
  }

  const kept = validateStrategy(res.value, today.length, prior.length, outsideSize);

  // Nothing survived the pairing rule. The model answered and every claim it
  // made was unsupportable -- which is a fault in the writing, not in the
  // evidence, and must not be reported as "no strategic change".
  if (kept.work.length === 0
    && kept.shift === null
    && kept.direction.length === 0
    && kept.positioning.length === 0
    && kept.tensions.length === 0
    && kept.openings.length === 0) {
    return { status: 'unwritten', why: 'no claim survived its own citations' };
  }

  return {
    status: 'written',
    strategy: {
      ...kept,
      history: historySpan(prior),
      outside,
      provider: res.provider,
      priorCorpus: prior,
    },
  };
}

/** One line for a job log or /admin. */
export function summariseStrategy(s: Strategy): string {
  const bits = [
    `${s.work.length} work`,
    `${s.direction.length} direction`,
    `${s.positioning.length} positioning`,
    `${s.tensions.length} tension`,
    `${s.openings.length} opening`,
  ];
  if (s.history) bits.push(`against ${s.history.n} earlier stories from ${s.history.from}`);
  return bits.join(', ');
}

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
import type { Item, Window, Query } from './corpus.ts';
import { q } from '../ui/db.ts';
import { withHistory, historyPacket, historySpan } from './context.ts';
import { corpusPacket, figuresPacket } from './briefing.ts';
import type { PublicFigure } from './public.ts';

export const STRATEGY_VERSION = 'strategy-v1';

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
  /** Indices into today's corpus, 1-based. */
  now: number[];
}

export interface Positioning {
  who: string;
  bet: string;
  evidence: number[];
  /** True when the evidence is that company talking about itself. */
  firstParty: boolean;
}

/**
 * Work one person could take on, which is what this whole archive is for.
 *
 * The reader is one person deciding what to learn, build and quote for. An
 * opening that can only be taken by a vendor is not a finding for them, so
 * this is kept separate from  rather than folded into it: they
 * answer different questions and only one of them pays.
 */
export interface Work {
  what: string;
  why: string;
  skills: string;
  /** now = the work exists today; months = when the change lands; watch = unproven. */
  horizon: 'now' | 'months' | 'watch';
  evidence: number[];
}

/** Where the evidence points two ways, which is a finding rather than a flaw. */
export interface Tension {
  what: string;
  sides: string;
  evidence: number[];
}

export interface Opening {
  what: string;
  why: string;
  who?: string;
  evidence: number[];
}

export interface Strategy {
  read: string;
  work: Work[];
  direction: Direction[];
  positioning: Positioning[];
  tensions: Tension[];
  openings: Opening[];
  limits: string;
  /** The span of earlier coverage this was drawn against. */
  history: { from: string; to: string; n: number } | null;
  provider?: string;
}

export type StrategyOutcome =
  | { status: 'written'; strategy: Strategy }
  /** No past to compare against. A fact about the archive, and safe to say. */
  | { status: 'no_history'; prior: number }
  /** It could have been written and was not. Never call this "nothing changed". */
  | { status: 'unwritten'; why: string };

interface RawStrategy {
  read?: unknown;
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
  raw: RawStrategy, todaySize: number, priorSize: number,
): Omit<Strategy, 'history' | 'provider'> {
  const inRange = (n: unknown, max: number): boolean =>
    Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= max;

  const ids = (v: unknown, max: number): number[] =>
    (Array.isArray(v) ? v : [])
      .map(Number)
      .filter((n) => inRange(n, max))
      // A claim citing the same story three times cites one story.
      .filter((n, i, a) => a.indexOf(n) === i);

  const text = (v: unknown): string => String(v ?? '').trim();

  const direction = (Array.isArray(raw.direction) ? raw.direction : [])
    .map((d) => {
      const item = d as Record<string, unknown>;
      return {
        claim: text(item.claim),
        reasoning: text(item.reasoning),
        falsifier: text(item.falsifier),
        then: ids(item.then, priorSize),
        now: ids(item.now, todaySize),
      };
    })
    // Both ends, or it is not a claim about change.
    .filter((d) => d.claim && d.then.length > 0 && d.now.length > 0);

  const positioning = (Array.isArray(raw.positioning) ? raw.positioning : [])
    .map((p) => {
      const item = p as Record<string, unknown>;
      return {
        who: text(item.who),
        bet: text(item.bet),
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
        evidence: ids(item.evidence, todaySize),
      };
    })
    .filter((o) => o.what && o.evidence.length > 0);

  return { read: text(raw.read), work, direction, positioning, tensions, openings,
    limits: text(raw.limits) };
}

/**
 * The prompt: today, the months before it, and the public figures.
 *
 * Today's corpus is rendered by the same `corpusPacket` the briefing uses, so a
 * citation means the same story in both -- a reader moving between the briefing
 * and the strategy on one page is looking at one numbering, not two.
 */
export function strategyPacket(
  field: string, win: Window, today: Item[], prior: Item[], figures: PublicFigure[],
): string {
  return [
    `FIELD: ${field}`,
    `TODAY'S WINDOW: ${win.from} to ${win.to}`,
    '',
    corpusPacket(today),
    '',
    historyPacket(prior),
    '',
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
): Promise<StrategyOutcome> {
  const { prior } = await withHistory(field, win, today, query);
  if (prior.length < minHistory) return { status: 'no_history', prior: prior.length };

  const packet = strategyPacket(field, win, today, prior, figures);
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

  const kept = validateStrategy(res.value, today.length, prior.length);

  // Nothing survived the pairing rule. The model answered and every claim it
  // made was unsupportable -- which is a fault in the writing, not in the
  // evidence, and must not be reported as "no strategic change".
  if (kept.work.length === 0
    && kept.direction.length === 0
    && kept.positioning.length === 0
    && kept.tensions.length === 0
    && kept.openings.length === 0) {
    return { status: 'unwritten', why: 'no claim survived its own citations' };
  }

  return {
    status: 'written',
    strategy: { ...kept, history: historySpan(prior), provider: res.provider },
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

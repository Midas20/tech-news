// Five axes, one gate.
//
//   relevance   match against the user's fields   <- the ONLY hard filter
//   importance  consequence
//   novelty     first-seen recency, genuine newness
//   niche       inverse coverage
//   depth       substance vs rewrite
//
// Niche is a RANKING dimension and never a filter. A major CVE scores terribly
// on inverse coverage and must still be delivered immediately; dropping widely
// covered stories would produce exactly the incoherent deliver-then-suppress
// behaviour the spec warns about, because coverage is a lagging signal -- a
// story is niche at hour one and mainstream by hour six.

import type { LlmContext } from '../llm/router.ts';
import { llmCall } from '../llm/router.ts';
import { getConfig } from '../config.ts';
import * as stories from '../db/repos/stories.ts';

export interface ScoreInputs {
  coverageCount: number;
  collectedAt: Date;
  publishedAt: Date | null;
  bodyChars: number;
  sourceWeightContent: number;
  sourceIsPrimary: boolean;
  domainFirstSeenDays: number | null;
  now?: Date;
}

/** Inverse coverage, saturating around 20 outlets. */
export function nicheScore(coverageCount: number): number {
  const capped = Math.max(1, coverageCount);
  return clamp01(1 - Math.log1p(capped - 1) / Math.log1p(19));
}

/**
 * Novelty rewards both freshness and genuine newness. A story from a domain the
 * system has never seen before is more likely to be new information than the
 * fourth post this week from an outlet that covers everything.
 */
export function noveltyScore(inputs: ScoreInputs): number {
  const now = inputs.now ?? new Date();
  const ageHours = Math.max(0, (now.getTime() - inputs.collectedAt.getTime()) / 3600_000);
  const recency = Math.exp(-ageHours / 48);

  // A publication date well before we saw it means we are late, not early.
  let lateness = 1;
  if (inputs.publishedAt) {
    const lagHours = (inputs.collectedAt.getTime() - inputs.publishedAt.getTime()) / 3600_000;
    if (lagHours > 48) lateness = 0.6;
    if (lagHours > 24 * 14) lateness = 0.3;
  }

  const unfamiliarity =
    inputs.domainFirstSeenDays === null ? 1
    : inputs.domainFirstSeenDays < 30 ? 1
    : inputs.domainFirstSeenDays < 180 ? 0.85
    : 0.7;

  return clamp01(recency * lateness * unfamiliarity);
}

/**
 * Depth separates original reporting from a rewrite. Length is the weakest of
 * the three signals here and is capped accordingly -- a long SEO piece is not
 * deep, and a 300-word LWN note often is.
 */
export function depthScore(inputs: ScoreInputs): number {
  const length = clamp01(Math.log1p(inputs.bodyChars) / Math.log1p(12000));
  const sourceWeight = clamp01(inputs.sourceWeightContent);
  const primaryBonus = inputs.sourceIsPrimary ? 0.15 : 0;
  return clamp01(length * 0.35 + sourceWeight * 0.5 + primaryBonus);
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

interface TriageResponse {
  results: { index: number; importance: number; reason?: string }[];
}

export interface ScoreReport {
  scored: number;
  escalated: number;
  deferred: number;
}

/**
 * Two-stage escalation (spec 4.2). A cheap model scores everything; anything at
 * or above the threshold is re-scored by Claude. In practice ~85% score below 6,
 * so Claude sees roughly 45 items a day -- exactly the ones where being wrong is
 * expensive.
 */
export async function scoreUnscored(ctx: LlmContext, limit = 200): Promise<ScoreReport> {
  const report: ScoreReport = { scored: 0, escalated: 0, deferred: 0 };
  const escalationThreshold = getConfig().llm.escalationThreshold;

  const pending = await ctx.db.query<{
    id: string;
    title_en: string | null;
    title_original: string;
    summary_en: string | null;
    coverage_count: number;
    collected_at: string;
    published_at: string | null;
    body_chars: number;
    weight_content: string;
    roles: string[];
    domain_age_days: number | null;
  }>(
    `SELECT s.id, s.title_en, s.title_original, s.summary_en, s.coverage_count,
            s.collected_at::text, s.published_at::text, s.body_chars,
            src.weight_content::text, src.roles,
            EXTRACT(day FROM now() - src.first_seen_at)::int AS domain_age_days
       FROM stories s
       JOIN sources src ON src.id = s.source_id
      WHERE s.importance IS NULL
        AND s.superseded_by IS NULL
        AND s.classified_at IS NOT NULL
        AND s.is_tech
      ORDER BY s.collected_at DESC
      LIMIT $1`,
    [limit],
  );

  for (let i = 0; i < pending.length; i += 20) {
    const batch = pending.slice(i, i + 20);
    const prompt = batch
      .map((s, idx) => `${idx}. ${s.title_en ?? s.title_original}${s.summary_en ? ` -- ${s.summary_en.slice(0, 250)}` : ''}`)
      .join('\n');

    const triage = await llmCall<TriageResponse>(ctx, 'importance_triage', prompt, batch.map((s) => s.id));
    if (triage.status !== 'ok') {
      report.deferred += batch.length;
      continue;
    }

    const scores = new Map<number, number>();
    for (const r of triage.value.results) scores.set(r.index, r.importance);
    // Which rows Claude actually re-scored. Without this the provenance lies
    // whenever escalation is unavailable: a triage score above the threshold
    // would be recorded as 'claude', and the quality audit would trust it.
    const rescored = new Set<number>();

    // Everything the cheap model flagged as consequential goes to Claude in one
    // batch -- escalation is per-cycle, not per-item, so the call count stays flat.
    const escalate = [...scores.entries()].filter(([, v]) => v >= escalationThreshold);
    if (escalate.length > 0) {
      const escalatePrompt = escalate
        .map(([idx], n) => {
          const s = batch[idx]!;
          return `${n}. ${s.title_en ?? s.title_original}${s.summary_en ? ` -- ${s.summary_en.slice(0, 400)}` : ''}`;
        })
        .join('\n');

      const critical = await llmCall<TriageResponse>(
        ctx, 'importance_critical', escalatePrompt, escalate.map(([idx]) => batch[idx]!.id),
      );
      if (critical.status === 'ok') {
        for (const r of critical.value.results) {
          const originalIndex = escalate[r.index]?.[0];
          if (originalIndex === undefined) continue;
          scores.set(originalIndex, r.importance);
          rescored.add(originalIndex);
          report.escalated++;
        }
      }
    }

    for (const [idx, importance] of scores) {
      const s = batch[idx];
      if (!s) continue;
      const inputs: ScoreInputs = {
        coverageCount: s.coverage_count,
        collectedAt: new Date(s.collected_at),
        publishedAt: s.published_at ? new Date(s.published_at) : null,
        bodyChars: s.body_chars ?? 0,
        sourceWeightContent: Number(s.weight_content),
        sourceIsPrimary: s.roles.includes('PRIMARY'),
        domainFirstSeenDays: s.domain_age_days,
      };
      await stories.applyScores(ctx.db, s.id, {
        importance,
        importanceBy: rescored.has(idx) ? 'claude' : 'triage',
        novelty: noveltyScore(inputs),
        niche: nicheScore(inputs.coverageCount),
        depth: depthScore(inputs),
      });
      report.scored++;
    }
  }

  return report;
}

export type DeliveryTier = 'critical' | 'notable' | 'niche_first' | 'background';

/**
 * Tier assignment (spec 3.4). Note there is no "drop" outcome: everything
 * relevant arrives, and the bottom tier is a collapsed one-liner in the digest
 * tail. Volume tolerance is a per-user setting, never a system-wide policy.
 */
export function assignTier(story: {
  importance: number;
  niche: number;
  novelty: number;
  stacks: string[];
}): DeliveryTier {
  if (story.importance >= 8) return 'critical';
  if (story.importance >= 6) return 'notable';
  if (story.niche >= 0.6 && story.novelty >= 0.5) return 'niche_first';
  return 'background';
}

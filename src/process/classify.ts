// Classification: is this a tech story, and which fields does it belong to.
//
// Batched 20 items per call. The model never decides what a field IS -- it picks
// from a supplied vocabulary and everything it returns is re-validated against
// the stacks table before storage.

import type { LlmContext } from '../llm/router.ts';
import { llmCall } from '../llm/router.ts';
import { getConfig } from '../config.ts';
import { loadTaxonomy, validateFields, vocabularyFor, type Taxonomy } from './taxonomy.ts';
import * as stories from '../db/repos/stories.ts';
import type { StoryRow } from '../db/repos/stories.ts';

export const CLASSIFIER_VERSION = 'classify-v1';

interface ClassifyResponse {
  results: { index: number; is_tech: boolean; fields: string[]; confidence?: number }[];
}

export interface ClassifyReport {
  processed: number;
  classified: number;
  deferred: number;
  rejectedFields: Record<string, number>;
  /** Why batches deferred. A silent deferral is indistinguishable from silence. */
  deferReasons: Record<string, number>;
}

export async function classifyPending(ctx: LlmContext, limit = 200): Promise<ClassifyReport> {
  const taxonomy = await loadTaxonomy(ctx.db);
  const pending = await stories.unclassified(ctx.db, limit);
  const report: ClassifyReport = {
    processed: 0, classified: 0, deferred: 0, rejectedFields: {}, deferReasons: {},
  };

  const batchSize = getConfig().batch.classify;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const outcome = await classifyBatch(ctx, taxonomy, batch, report);
    report.processed += batch.length;
    if (!outcome) report.deferred += batch.length;
  }
  return report;
}

async function classifyBatch(
  ctx: LlmContext,
  taxonomy: Taxonomy,
  batch: StoryRow[],
  report: ClassifyReport,
): Promise<boolean> {
  const texts = batch.map((s) => `${s.title_en ?? s.title_original} ${s.summary_en ?? ''}`);
  const vocabulary = vocabularyFor(taxonomy, texts);

  const prompt = [
    `Vocabulary (use only these field names):`,
    vocabulary.join(', '),
    '',
    'Items:',
    ...batch.map((s, idx) =>
      `${idx}. ${s.title_en ?? s.title_original}${s.summary_en ? ` -- ${s.summary_en.slice(0, 300)}` : ''}`,
    ),
  ].join('\n');

  const res = await llmCall<ClassifyResponse>(ctx, 'classify', prompt, {
    ids: batch.map((s) => s.id),
    vocabulary,
  });

  if (res.status !== 'ok') {
    const reason = res.status === 'deferred' ? res.reason : `invalid: ${res.errors.join('; ')}`;
    report.deferReasons[reason] = (report.deferReasons[reason] ?? 0) + 1;
    return false;
  }

  for (const result of res.value.results) {
    const story = batch[result.index];
    if (!story) continue; // model returned an index we did not send

    const { accepted, rejected } = validateFields(taxonomy, result.fields ?? []);
    for (const r of rejected) {
      report.rejectedFields[r] = (report.rejectedFields[r] ?? 0) + 1;
    }

    await stories.applyClassification(ctx.db, story.id, {
      isTech: result.is_tech,
      stacks: accepted,
      classifierVersion: CLASSIFIER_VERSION,
    });
    report.classified++;
  }
  return true;
}

/**
 * Comparison used by the weekly quality sample. Agreement is measured on the
 * decision that matters -- is_tech and field overlap -- not on exact JSON
 * equality, which would report disagreement over ordering.
 */
export function classificationsAgree(reference: unknown, cheap: unknown): boolean {
  const ref = reference as ClassifyResponse;
  const che = cheap as ClassifyResponse;
  if (!ref?.results || !che?.results) return false;

  const byIndex = new Map(che.results.map((r) => [r.index, r]));
  let compared = 0;
  let agreed = 0;

  for (const r of ref.results) {
    const c = byIndex.get(r.index);
    if (!c) continue;
    compared++;
    if (r.is_tech !== c.is_tech) continue;
    const refFields = new Set(r.fields ?? []);
    const cheapFields = new Set(c.fields ?? []);
    if (refFields.size === 0 && cheapFields.size === 0) {
      agreed++;
      continue;
    }
    const overlap = [...refFields].filter((f) => cheapFields.has(f)).length;
    if (overlap / Math.max(refFields.size, cheapFields.size) >= 0.5) agreed++;
  }
  return compared > 0 && agreed / compared >= 0.9;
}

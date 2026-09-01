// Deduplication layers 2 and 3, and the clustering that follows from them.
//
//   layer 1  canonical URL + content hash        -- in the collector, free
//   layer 2  simhash over normalized text        -- here, free
//   layer 3  title-translation hash              -- here, free once titles exist
//   layer 4  a model, on ambiguous pairs only    -- batched 10 pairs per call
//
// Layers 1-2 remove roughly 60% of daily volume at zero inference cost. Layer 4
// exists only for the residue, which is why the model budget stays under 100
// calls a day at 8,000 items.

import type { Db } from '../db/client.ts';
import type { LlmContext } from '../llm/router.ts';
import { llmCall } from '../llm/router.ts';
import { hammingDistance, fromSigned64, simhashBands } from '../lib/simhash.ts';
import { titleOverlap } from '../lib/text.ts';
import * as stories from '../db/repos/stories.ts';
import { getConfig } from '../config.ts';

// Thresholds measured against real pairs rather than chosen by feel. On 64-bit
// simhash over unigram+bigram features:
//
//   verbatim / near-verbatim repost      0-3    merge, no question asked
//   same wire story, lightly reworded    ~15
//   heavy paraphrase of the same event   ~23
//   same project, different release      ~20
//   unrelated stories                    ~26
//
// Note how badly the middle of that range separates: paraphrase (23) and
// unrelated (26) nearly touch. SimHash is a near-identical-text detector, not a
// meaning detector, and pretending otherwise here would merge distinct stories.
// So distance alone decides only the bottom of the range; everything above it is
// a QUESTION, and the band prefilter is what keeps the number of questions small
// -- two documents must share a full 16-bit band to be considered at all.

// Both are configurable: SIMHASH_HAMMING_THRESHOLD sets the auto-merge line, and
// DEDUP_AMBIGUOUS_LOWER (a similarity ratio) sets the outer edge of the question
// band. The defaults below are the measured values above.
/** Certain: merge without asking anyone. */
export const AUTO_MERGE_DISTANCE = 3;
/** Ambiguous: worth one tenth of a model call to settle. */
export const ASK_MODEL_MAX_DISTANCE = 16;

export interface DedupCandidate {
  id: string;
  simhash: string;
  source_id: string;
  canonical_url: string;
  title_original: string;
}

export interface DedupReport {
  examined: number;
  autoMerged: number;
  modelMerged: number;
  modelPairs: number;
  /** Band candidates rejected by the free lexical gate before any model call. */
  lexicallyRejected: number;
  /** Pairs left unasked because the per-cycle model budget ran out. */
  skippedOverBudget: number;
  distinct: number;
}

/**
 * The band prefilter is weaker in practice than the theory suggests. Band
 * collisions assume documents are spread over the hash space; a corpus of tech
 * news is not -- it shares vocabulary, so upper bands coincide constantly. On
 * 500 real stories the bands produced 9,763 candidate pairs, of which the model
 * judged exactly ONE to be the same event: 976 model calls to find one merge, in
 * a system whose whole budget is under 100 calls a day.
 *
 * So a free gate runs first, on the same evidence the model would see -- title
 * token overlap. Below the floor the pair is not the same story regardless of
 * what the hashes did, and no call is made.
 */
export const TITLE_OVERLAP_FLOOR = 0.25;
/** Close hash AND strongly overlapping titles: merge without asking. */
export const TITLE_OVERLAP_CERTAIN = 0.6;
/**
 * Hard ceiling on model pairs per cycle. What it drops is logged, never silent.
 * This is the default; the operator can lower or raise it from /settings, which
 * is why the pass reads it from config rather than from this constant.
 */
export const MAX_MODEL_PAIRS_PER_CYCLE = 200;

export async function dedupRecent(ctx: LlmContext, hours = 48, limit = 500): Promise<DedupReport> {
  const report: DedupReport = {
    examined: 0, autoMerged: 0, modelMerged: 0, modelPairs: 0,
    lexicallyRejected: 0, skippedOverBudget: 0, distinct: 0,
  };
  const since = new Date(Date.now() - hours * 3600_000);
  const { autoMergeDistance, askModelMaxDistance } = getConfig().dedup;
  const pairBatch = getConfig().batch.dedupPairs;

  const recent = await ctx.db.query<DedupCandidate & { collected_at: string; title_en: string | null }>(
    `SELECT id, simhash::text AS simhash, source_id, canonical_url, title_original,
            title_en, collected_at::text
       FROM stories
      WHERE collected_at > $1 AND superseded_by IS NULL AND simhash IS NOT NULL
      ORDER BY collected_at DESC
      LIMIT $2`,
    [since, limit],
  );

  const ambiguous: { story: typeof recent[number]; candidate: DedupCandidate; distance: number }[] = [];

  for (const story of recent) {
    report.examined++;
    const bands = simhashBands(fromSigned64(BigInt(story.simhash)));
    // Other sources only -- see bandCandidates for why.
    const candidates = await stories.bandCandidates(
      ctx.db, bands, since, story.id, story.source_id ?? null);

    let merged = false;
    for (const candidate of candidates) {
      const distance = hammingDistance(
        fromSigned64(BigInt(story.simhash)),
        fromSigned64(BigInt(candidate.simhash)),
      );
      if (distance <= autoMergeDistance) {
        await mergeStories(ctx.db, story.id, candidate.id, 2, `simhash distance ${distance}`);
        report.autoMerged++;
        merged = true;
        break;
      }
      if (distance <= askModelMaxDistance) {
        const overlap = titleOverlap(
          story.title_en ?? story.title_original,
          candidate.title_original,
        );
        if (overlap >= TITLE_OVERLAP_CERTAIN) {
          await mergeStories(ctx.db, story.id, candidate.id, 2,
            `simhash ${distance} + title overlap ${overlap.toFixed(2)}`);
          report.autoMerged++;
          merged = true;
          break;
        }
        if (overlap < TITLE_OVERLAP_FLOOR) {
          report.lexicallyRejected++;
          continue;
        }
        ambiguous.push({ story, candidate, distance });
      }
    }
    if (!merged) report.distinct++;
  }

  // Layer 3: cross-language duplicates, caught by hashing the English titles
  // rather than by any semantic comparison. This is the whole reason titles are
  // translated at ingest and bodies are not.
  report.autoMerged += await mergeByTranslatedTitle(ctx.db, since);

  // Layer 4: the residue, as a yes/no question, ten pairs at a time, under a
  // hard per-cycle ceiling. Anything beyond it is reported, not dropped quietly.
  const pairCeiling = getConfig().dedup.maxModelPairs ?? MAX_MODEL_PAIRS_PER_CYCLE;
  if (ambiguous.length > pairCeiling) {
    report.skippedOverBudget = ambiguous.length - pairCeiling;
    ambiguous.length = pairCeiling;
  }
  for (let i = 0; i < ambiguous.length; i += pairBatch) {
    const batch = ambiguous.slice(i, i + pairBatch);
    report.modelPairs += batch.length;
    const prompt = batch
      .map((p, idx) => `${idx}. A: ${p.story.title_en ?? p.story.title_original}\n   B: ${p.candidate.title_original}`)
      .join('\n');

    const res = await llmCall<{ results: { index: number; same: boolean }[] }>(
      ctx, 'dedup_pairs', prompt,
      batch.map((p) => [p.story.id, p.candidate.id]),
    );
    if (res.status !== 'ok') continue;

    for (const r of res.value.results) {
      if (!r.same) continue;
      const pair = batch[r.index];
      if (!pair) continue;
      await mergeStories(ctx.db, pair.story.id, pair.candidate.id, 4, 'model judged same event');
      report.modelMerged++;
    }
  }

  return report;
}

/**
 * Merge two stories. Nothing is deleted: the loser keeps its row, points at the
 * winner, and contributes a story_members row so the archive still shows which
 * outlets carried the story.
 *
 * Which one wins is not arbitrary. A source flagged never_canonical -- TechRadar,
 * an aggregator, a coverage-only outlet -- can never be the surviving link, no
 * matter which copy was collected first.
 */
export async function mergeStories(
  db: Db,
  aId: string,
  bId: string,
  matchLayer: number,
  reason: string,
): Promise<{ winner: string; loser: string } | null> {
  const rows = await db.query<{
    id: string;
    source_id: string;
    canonical_url: string;
    title_original: string;
    collected_at: string;
    never_canonical: boolean;
    weight_content: string;
  }>(
    `SELECT s.id, s.source_id, s.canonical_url, s.title_original, s.collected_at::text,
            src.never_canonical, src.weight_content::text
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE s.id = ANY($1::uuid[]) AND s.superseded_by IS NULL`,
    [[aId, bId]],
  );
  if (rows.length < 2) return null;

  const [x, y] = rows as [typeof rows[number], typeof rows[number]];
  const winner = pickCanonical(x, y);
  const loser = winner.id === x.id ? y : x;

  await stories.supersede(db, loser.id, winner.id, `${reason} (layer ${matchLayer})`);
  await stories.addMember(db, {
    storyId: winner.id,
    sourceId: loser.source_id,
    url: loser.canonical_url,
    title: loser.title_original,
    matchLayer,
    memberStoryId: loser.id,
  });
  return { winner: winner.id, loser: loser.id };
}

type CanonicalCandidate = {
  id: string;
  never_canonical: boolean;
  weight_content: string;
  collected_at: string;
};

export function pickCanonical<T extends CanonicalCandidate>(a: T, b: T): T {
  if (a.never_canonical !== b.never_canonical) return a.never_canonical ? b : a;
  const wa = Number(a.weight_content);
  const wb = Number(b.weight_content);
  if (wa !== wb) return wa > wb ? a : b;
  // Equal standing: the first observation wins, so canonical links are stable.
  return new Date(a.collected_at) <= new Date(b.collected_at) ? a : b;
}

/** Layer 3. Two stories whose translated titles hash identically are one story. */
/**
 * Layer 3: the same story in two languages, caught by hashing the English
 * titles. This is the whole reason titles are translated at ingest and bodies
 * are not.
 *
 * WHY THE DATE IS PART OF THE TEST FOR ONE SOURCE
 *
 * An identical title from two different outlets is one story carried twice --
 * that is the case this exists for, and it is left alone. An identical title
 * from the SAME source on a DIFFERENT DAY is something else entirely: a
 * changelog that publishes boilerplate. Google Cloud posts "Agent Platform
 * Workbench — Change: Installed latest packages from upstream dependencies"
 * repeatedly, and each one is a different day's package update; "Scheduled
 * maintenance" recurs the same way. Merging those silently loses a day's change,
 * which is the failure this archive is least willing to accept.
 *
 * Same source and the same day IS a duplicate -- a feed reposting an item under
 * a second URL -- and still merges. So the rule is not "never merge within a
 * source", it is "a date is part of a changelog entry's identity".
 */
async function mergeByTranslatedTitle(db: Db, since: Date): Promise<number> {
  const rows = await db.query<{
    id: string; h: string; source_id: string; day: string | null;
  }>(
    `SELECT id, title_hash_en::text AS h, source_id, published_at::date::text AS day
       FROM stories
      WHERE collected_at > $1 AND superseded_by IS NULL AND title_hash_en IS NOT NULL
        AND title_hash_en IN (
          SELECT title_hash_en FROM stories
           WHERE collected_at > $1 AND superseded_by IS NULL AND title_hash_en IS NOT NULL
           GROUP BY title_hash_en HAVING count(*) > 1)
      ORDER BY collected_at`,
    [since],
  );

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = groups.get(row.h) ?? [];
    list.push(row);
    groups.set(row.h, list);
  }

  let merged = 0;
  for (const group of groups.values()) {
    const [first, ...rest] = group;
    if (!first) continue;
    for (const other of rest) {
      const sameSource = other.source_id === first.source_id;
      const sameDay = other.day === first.day;
      if (sameSource && !sameDay) continue;
      const result = await mergeStories(db, first.id, other.id, 3, 'identical translated title');
      if (result) merged++;
    }
  }
  return merged;
}

// Reading every story for names, and writing down the ones nobody knows yet.
//
// Asked for on 2026-09-09: the reports find incumbents and miss new markets.
// They were not missing them for want of collection -- that morning's briefings
// had Booley, aic-agent, scigantic-surechembl and PocketBase Cloud in them. They
// were missing them because every step that turns a story into structure
// matches against `stacks`, and `stacks` is a closed list of 2,460 things
// somebody already knew about. A tool the taxonomy has never heard of is
// exactly the one worth knowing about, and it was the one thing the pipeline
// could not represent.
//
// So this runs on EVERY story, not on a selected corpus. A name is only worth
// catching on its first appearance; by the time it reaches a curated feed the
// market it belongs to is no longer new.
//
// THE COUNTS IN HERE ARE A GATE, NEVER A MEASURE. `sightings`, `sources` and
// `independent_sources` count this archive's own collection, which measures the
// feed list rather than the industry. Two unrelated sources is the line at
// which a name stops being one vendor's press release and becomes something
// worth showing a reader -- and that is all these numbers are ever allowed to
// decide. Nothing ranks by them. Magnitudes still come only from the public
// figures in `stack_adoption`.

import type { LlmContext } from '../llm/router.ts';
import { llmCall } from '../llm/router.ts';
import type { Db } from '../db/client.ts';
import { meaningOf } from '../vocab/intel.ts';
import type { SourceType } from '../vocab/intel.ts';
import {
  newcomers, CORROBORATION, type Candidate, type Newcomer,
} from '../vocab/emerging.ts';

export const EXTRACTOR_VERSION = 'entities-v1';

/** How many stories go to the model in one call. */
const BATCH = 12;

interface ExtractResponse {
  results: { index: number; entities: Candidate[] }[];
}

interface PendingStory {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source_id: string;
  source_type: SourceType | null;
  fields: string[];
  published_at: string | null;
}

export interface EmergingReport {
  read: number;
  named: number;
  /** Rows created for the first time. */
  discovered: number;
  /** Rows that gained a sighting they did not have. */
  corroborated: number;
  /** Candidates that crossed the evidence gate on this pass. */
  promoted: number;
  deferReasons: Record<string, number>;
}

/**
 * Read up to `limit` unscanned stories and record what they name.
 *
 * Every story that is read is stamped, including one that named nothing --
 * otherwise each pass re-reads the same stories that have nothing in them and
 * the backlog never moves.
 */
export async function scanForNames(
  ctx: LlmContext, limit = 120,
): Promise<EmergingReport> {
  const report: EmergingReport = {
    read: 0, named: 0, discovered: 0, corroborated: 0, promoted: 0, deferReasons: {},
  };

  const pending = await unscanned(ctx.db, limit);
  if (pending.length === 0) return report;

  const known = await knownNames(ctx.db);

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const ok = await scanBatch(ctx, batch, known, report);
    // A batch the model refused is left unstamped on purpose: a rate limit is
    // not a reading, and stamping it would silently lose those stories for
    // good. The next pass picks them up.
    if (ok) {
      await stamp(ctx.db, batch.map((s) => s.id));
      report.read += batch.length;
    }
  }

  report.promoted = await applyGate(ctx.db);
  return report;
}

async function scanBatch(
  ctx: LlmContext,
  batch: PendingStory[],
  known: Set<string>,
  report: EmergingReport,
): Promise<boolean> {
  const prompt = [
    'Stories:',
    ...batch.map((s, idx) => `${idx}. ${s.title}${
      s.summary ? ` -- ${s.summary.slice(0, 400)}` : ''}`),
  ].join('\n');

  const res = await llmCall<ExtractResponse>(ctx, 'entity_extraction', prompt, {
    ids: batch.map((s) => s.id),
    version: EXTRACTOR_VERSION,
  });

  if (res.status !== 'ok') {
    const reason = res.status === 'deferred' ? res.reason : `invalid: ${res.errors.join('; ')}`;
    report.deferReasons[reason] = (report.deferReasons[reason] ?? 0) + 1;
    return false;
  }

  for (const result of res.value.results ?? []) {
    const story = batch[result.index];
    if (!story) continue; // an index we did not send

    const found = newcomers(result.entities ?? [], known);
    report.named += found.length;

    for (const newcomer of found) {
      const outcome = await record(ctx.db, newcomer, story);
      if (outcome === 'discovered') report.discovered += 1;
      else if (outcome === 'corroborated') report.corroborated += 1;
    }
  }

  return true;
}

/**
 * Write one sighting, creating the ledger row if this is the first.
 *
 * The citation is copied into the sighting rather than referenced. Retention
 * deletes stories after the window and analysis outlives them, so a sighting
 * holding only a story_id becomes unciteable exactly when it is most useful --
 * a name first seen four months ago and still appearing is the strongest thing
 * this table can say.
 */
async function record(
  db: Db, newcomer: Newcomer, story: PendingStory,
): Promise<'discovered' | 'corroborated' | 'repeat'> {
  const independent = story.source_type
    ? meaningOf(story.source_type)?.independent ?? false
    : false;

  const [row] = await db.query<{ created: boolean }>(
    `INSERT INTO emerging (slug, name, kind, what, fields, first_seen_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (slug) DO UPDATE SET
       -- The earliest sighting is the fact worth keeping; a later pass over an
       -- older story must be able to move first_seen_at BACKWARDS.
       first_seen_at = least(emerging.first_seen_at, EXCLUDED.first_seen_at),
       last_seen_at  = greatest(emerging.last_seen_at, EXCLUDED.last_seen_at),
       -- The description from the first story to explain it stands. A later
       -- story rewriting it turns a specific claim into a vaguer one as often
       -- as the reverse, and the first explanation is the one under the
       -- citation that was recorded with it.
       what   = coalesce(emerging.what, EXCLUDED.what),
       fields = (SELECT array_agg(DISTINCT f)
                   FROM unnest(emerging.fields || EXCLUDED.fields) AS f),
       updated_at = now()
     RETURNING (xmax = 0) AS created`,
    [newcomer.slug, newcomer.name, newcomer.kind, newcomer.what,
      story.fields ?? [], story.published_at ?? new Date().toISOString()],
  );

  const [sighting] = await db.query<{ inserted: boolean }>(
    `INSERT INTO emerging_sightings
       (slug, story_id, source_id, story_title, url, field, independent, published_at, via)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'story')
     ON CONFLICT (slug, story_id, source_id) DO NOTHING
     RETURNING true AS inserted`,
    [newcomer.slug, story.id, story.source_id, story.title, story.url,
      story.fields?.[0] ?? null, independent, story.published_at],
  );

  // EVERY OTHER OUTLET THAT CARRIED THE SAME EVENT.
  //
  // Deduplication merges one event from several publications into one canonical
  // story and puts the rest in `story_members`. Counting the canonical row alone
  // recorded a name carried by seven publications as having one source -- which
  // scored the best-attested events in the archive lowest on the evidence gate,
  // the exact inversion the gate exists to prevent.
  //
  // Written out here rather than joined at read time because retention deletes
  // `story_members` and this ledger outlives it. A corroboration count that
  // silently shrinks four months later is worse than no count.
  //
  // Independence is decided by meaningOf() rather than by a list of type names
  // in the SQL. The ladder in src/vocab/intel.ts is the only place that is
  // allowed to know which source types corroborate, and a second copy of it in
  // a query is a copy that will disagree with it one day without anyone
  // noticing.
  const members = await db.query<{ source_id: string; url: string; title: string | null;
    source_type: SourceType | null }>(
    `SELECT m.source_id, m.url, m.title, src.source_type::text AS source_type
       FROM story_members m
       JOIN sources src ON src.id = m.source_id
      WHERE m.story_id = $1 AND m.source_id <> $2`,
    [story.id, story.source_id]);

  for (const member of members) {
    await db.query(
      `INSERT INTO emerging_sightings
         (slug, story_id, source_id, story_title, url, field, independent,
          published_at, via)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'member')
       ON CONFLICT (slug, story_id, source_id) DO NOTHING`,
      [newcomer.slug, story.id, member.source_id, member.title ?? story.title,
        member.url, story.fields?.[0] ?? null,
        member.source_type ? meaningOf(member.source_type)?.independent ?? false : false,
        story.published_at],
    );
  }

  // Nothing new: this story already mentioned this name. Recounting would be
  // wasted work and the numbers would not move.
  if (!sighting?.inserted) return 'repeat';

  await recount(db, newcomer.slug);
  return row?.created ? 'discovered' : 'corroborated';
}

/**
 * Recompute the gate inputs from the sightings themselves.
 *
 * Derived rather than incremented. An increment is right until the day a
 * partial failure runs the same batch twice, and then the row says three
 * unrelated sources when it has one -- which is the difference between showing
 * a reader a market and showing them a press release.
 */
async function recount(db: Db, slug: string): Promise<void> {
  await db.query(
    `UPDATE emerging SET
       sightings = s.sightings,
       sources = s.sources,
       independent_sources = s.independent_sources,
       last_seen_at = greatest(emerging.last_seen_at, s.latest),
       updated_at = now()
     FROM (
       SELECT count(*) AS sightings,
              count(DISTINCT source_id) AS sources,
              count(DISTINCT source_id) FILTER (WHERE independent) AS independent_sources,
              coalesce(max(published_at), now()) AS latest
         FROM emerging_sightings WHERE slug = $1
     ) s
     WHERE emerging.slug = $1`,
    [slug],
  );
}

/**
 * Move candidates across the evidence gate, and no further.
 *
 * Only 'candidate' rows are touched: 'known' and 'rejected' are judgments
 * somebody made, and a sweep that overwrote them would undo that judgment every
 * time another story arrived.
 */
async function applyGate(db: Db): Promise<number> {
  const rows = await db.query<{ slug: string }>(
    // Kept in step with passesGate() in src/vocab/emerging.ts, which is the same
    // rule for a single row. Two separate publications, or one that does not
    // speak for the thing -- see the measurement in that file for why it is not
    // two INDEPENDENT sources.
    `UPDATE emerging SET status = 'tracked', updated_at = now()
      WHERE status = 'candidate'
        AND (sources >= $1 OR independent_sources >= 1)
      RETURNING slug`,
    [CORROBORATION],
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Stories nobody has read for names yet, oldest first.
 *
 * Oldest first so that first_seen_at means what it says. Newest-first would
 * work through a backlog in reverse and record a name's LAST appearance as its
 * first, which inverts the one fact this ledger exists to hold.
 *
 * A story with no summary is skipped rather than sent: the extractor is asked
 * what each name does, and a headline alone rarely says.
 */
async function unscanned(db: Db, limit: number): Promise<PendingStory[]> {
  return db.query<PendingStory>(
    `SELECT st.id,
            coalesce(st.title_en, st.title_original) AS title,
            st.summary_en AS summary,
            st.canonical_url AS url,
            st.source_id,
            src.source_type::text AS source_type,
            -- There is no fields column on stories. Field membership is
            -- derived: stacks && stack_expand(ARRAY[field]). So the taxonomy
            -- tags ARE the field information, and carrying them onto the ledger
            -- row lets /emerging filter by field through the same function.
            st.stacks AS fields,
            st.published_at
       FROM stories st
       JOIN sources src ON src.id = st.source_id
      WHERE st.entities_scanned_at IS NULL
        AND st.summary_en IS NOT NULL
        AND length(st.summary_en) >= 60
        AND st.superseded_at IS NULL
      ORDER BY coalesce(st.published_at, st.collected_at) ASC
      LIMIT $1`,
    [limit],
  );
}

async function stamp(db: Db, ids: string[]): Promise<void> {
  await db.query(
    'UPDATE stories SET entities_scanned_at = now() WHERE id = ANY($1::uuid[])', [ids]);
}

/**
 * Every name the taxonomy already has, slugs and aliases together.
 *
 * Read once per pass rather than per story. If this ever fails open -- an empty
 * set -- every incumbent in the archive is reported as a new market, so it
 * returns the set or throws.
 */
async function knownNames(db: Db): Promise<Set<string>> {
  const rows = await db.query<{ slug: string }>(
    `SELECT slug FROM stacks
      UNION
     SELECT lower(a) FROM stacks, unnest(aliases) AS a
      UNION
     SELECT slug FROM companies`);
  const known = new Set(rows.map((r) => r.slug));
  if (known.size === 0) {
    throw new Error('the taxonomy is empty; every name would look new');
  }
  return known;
}

// ---------------------------------------------------------------------------
// For the reader
// ---------------------------------------------------------------------------

export interface EmergingRow {
  slug: string;
  name: string;
  kind: string;
  what: string | null;
  fields: string[];
  first_seen_at: string;
  last_seen_at: string;
  sources: number;
  independent_sources: number;
}

/**
 * What is new, newest first.
 *
 * ORDERED BY RECENCY, NOT BY CORROBORATION. The gate has already decided what
 * is worth showing; ordering by how many of our own stories mention a thing
 * would be exactly the fake ranking the whole content rewrite exists to
 * prevent. "First seen three days ago" is a fact about the world. "Mentioned
 * six times" is a fact about our feed list.
 */
export async function whatIsNew(
  db: Db, opts: { field?: string; days?: number; limit?: number } = {},
): Promise<EmergingRow[]> {
  const days = opts.days ?? 30;
  const params: unknown[] = [days, opts.limit ?? 60];
  let filter = '';
  if (opts.field) {
    params.push(opts.field);
    filter = `AND fields && stack_expand(ARRAY[$3])`;
  }
  return db.query<EmergingRow>(
    `SELECT slug, name, kind, what, fields, first_seen_at, last_seen_at,
            sources, independent_sources
       FROM emerging
      WHERE status = 'tracked'
        AND first_seen_at > now() - make_interval(days => $1)
        ${filter}
      ORDER BY first_seen_at DESC
      LIMIT $2`,
    params,
  );
}

/** Every recorded sighting of one name, for its own page. */
export async function sightingsOf(db: Db, slug: string): Promise<{
  story_title: string | null; url: string | null; field: string | null;
  independent: boolean; published_at: string | null;
}[]> {
  return db.query(
    `SELECT story_title, url, field, independent, published_at
       FROM emerging_sightings
      WHERE slug = $1
      ORDER BY published_at DESC NULLS LAST`,
    [slug],
  );
}

/** One row, for its own page. */
export async function emergingBySlug(db: Db, slug: string): Promise<EmergingRow | null> {
  const [row] = await db.query<EmergingRow>(
    `SELECT slug, name, kind, what, fields, first_seen_at, last_seen_at,
            sources, independent_sources
       FROM emerging WHERE slug = $1`,
    [slug]);
  return row ?? null;
}

/** Counts for /admin and for the job's log line. */
export async function summarise(db: Db): Promise<string> {
  const [row] = await db.query<{
    tracked: string; candidates: string; fresh: string;
  }>(
    `SELECT count(*) FILTER (WHERE status = 'tracked') AS tracked,
            count(*) FILTER (WHERE status = 'candidate') AS candidates,
            count(*) FILTER (WHERE status = 'tracked'
                             AND first_seen_at > now() - interval '7 days') AS fresh
       FROM emerging`);
  return `${row?.tracked ?? 0} tracked (${row?.fresh ?? 0} this week), `
    + `${row?.candidates ?? 0} awaiting a second source`;
}

// What the archive actually SAYS, selected for reading rather than counting.
//
// Asked for on 2026-09-01: "I don't want to analysis news' count. I want to
// analysis news's content and summarize and then build report based on it by
// fields. In analysis feature, don't count news, it is fake value because we
// can't collect all news."
//
// That is correct, and it invalidates the previous report. A count over this
// archive is a count of what 352 feeds happened to carry, and the denominator
// -- everything published anywhere -- is unknown and unknowable. "Rust: 412
// stories, up 1.4x" reads as a fact about Rust and is a fact about the feed
// list. Worse, it is a fact about the feed list ON THE DAY, so repairing
// collection moves every verdict.
//
// So counts are demoted to what they can honestly do: decide which stories are
// worth reading. Choosing to read a story is not a claim about the world. The
// CLAIMS come from the text of the stories, and the only magnitudes allowed
// near a report are public figures measured outside this archive -- see
// ./public.ts.
//
// WHY DIVERSITY IS ENFORCED HERE AND NOT LEFT TO THE RANKING
//
// Rank by importance alone and a field's corpus becomes fourteen Solana
// changelogs, because a project that ships daily out-produces an industry. The
// caps below are the difference between "what happened in cloud" and "what the
// loudest publisher in cloud did". A reader cannot correct for that; a cap can.

import { q } from '../ui/db.ts';
import { meaningOf, type SourceType } from '../vocab/intel.ts';

export type Query = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

/** One story, as the writer will see it: text, provenance, and nothing implied. */
export interface Item {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source: string;
  sourceType: SourceType | null;
  /** What this kind of source can establish on its own. */
  rung: string;
  /** False when the source speaks for the thing it is describing. */
  independent: boolean;
  kind: string;
  when: string;
  stacks: string[];
  companies: string[];
  platforms: string[];
  importance: number | null;
}

export interface RawItem extends Omit<Item, 'rung' | 'independent'> {
  source_type: SourceType | null;
}

/**
 * Event kinds, weighted by how much reading one tells you.
 *
 * A launch or a market move is a thing that happened. A release is a project
 * doing its job -- real, routine, and most of the archive. An article is
 * somebody's account of a thing that happened elsewhere, worth reading last and
 * never worth reading instead.
 */
export const KIND_RANK: Record<string, number> = {
  launch: 4, market: 4, change: 3, release: 2, article: 1,
};

/**
 * The period a briefing read.
 *
 * Both ends are explicit and both are stored with the report. "The last fourteen
 * days" is a different set of stories depending on when you ask it, and a report
 * has to be able to say which stories it read -- including a week later, when
 * the job has run six more times.
 */
export interface Window {
  /** Exclusive lower bound, ISO 8601. */
  from: string;
  /** Inclusive upper bound, ISO 8601. */
  to: string;
}

/**
 * Pull the field's window, richest first.
 *
 * Deliberately over-pulls: the diversity pass below throws a lot away, and
 * doing that outside the query is the only way to make the caps testable
 * without a database.
 *
 * `summary_en` is required, not preferred. A story with no text cannot be read,
 * and including it would let a headline alone stand in for evidence -- which is
 * how a briefing ends up asserting what a title merely implied.
 *
 * Bounded at BOTH ends, which is the fix for a report that never changed. A
 * rolling window re-reads the same fortnight every morning; a bounded one reads
 * what arrived since the last report and nothing twice.
 */
export async function fieldPool(
  field: string, win: Window, pool = 400, query: Query = q,
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
        AND s.stacks && stack_expand(ARRAY[$1]::text[])
        AND coalesce(s.published_at, s.collected_at) >  $2::timestamptz
        AND coalesce(s.published_at, s.collected_at) <= $3::timestamptz
        AND s.summary_en IS NOT NULL AND length(s.summary_en) >= 60
      ORDER BY
        CASE coalesce(s.event_kind::text, 'article')
          WHEN 'launch' THEN 4 WHEN 'market' THEN 4 WHEN 'change' THEN 3
          WHEN 'release' THEN 2 ELSE 1 END DESC,
        s.importance DESC NULLS LAST,
        coalesce(s.published_at, s.collected_at) DESC
      LIMIT $4`,
    [field, win.from, win.to, pool]);

  return rows.map(shape);
}

/** Attach what the source type means, so provenance travels with the text. */
export function shape(r: RawItem): Item {
  const m = r.source_type ? meaningOf(r.source_type) : undefined;
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    url: r.url,
    source: r.source,
    sourceType: r.source_type,
    rung: m?.evidence ?? 'announcement',
    independent: m?.independent ?? false,
    kind: r.kind,
    when: r.when,
    stacks: r.stacks ?? [],
    companies: r.companies ?? [],
    platforms: r.platforms ?? [],
    importance: r.importance === null ? null : Number(r.importance),
  };
}

export interface DiversityCaps {
  /** How many stories one publisher may contribute. */
  perSource: number;
  /** How many stories may be about the same technology. */
  perSubject: number;
  /** How many routine version announcements may be included at all. */
  maxReleases: number;
  total: number;
}

/**
 * How much of a day a report is allowed to read.
 *
 * WIDENED ON 2026-09-09 -- "the scope of news that you use when make report is
 * still small" -- and the complaint was measurable. Same day, same window:
 *
 *   field      eligible   read at 40   read at 120
 *   ai              114           40            93
 *   practice         76           40            73
 *   cloud            20           16            20
 *   data             19           19            19
 *
 * So `ai` was reading 35% of what it was allowed to see and `practice` 53%,
 * while `cloud` and `data` were already reading everything they had. The cap
 * was the binding constraint on exactly the two busiest fields, which are the
 * ones a reader most needs a filter for -- and a filter that drops two thirds
 * of the evidence is not selecting, it is sampling.
 *
 * 120 costs about 53,000 characters of prompt for the busiest field, roughly
 * 14,000 tokens. That is comfortable for Claude, which heads the chain. IT IS
 * NOT comfortable for the small free models below it, and that is a real
 * trade recorded here rather than discovered later: on a day when Claude is
 * unavailable, a wide corpus makes the fallbacks likelier to refuse. The
 * fallbacks already produce the weakest readings in the system, so losing them
 * on a busy day costs less than reading a third of a busy day every day.
 *
 * The per-source and per-subject caps rise too, but by less than threefold, so
 * they still bind: one publisher may not speak for a field. They were set when
 * the registry held 86 sources and it now holds 511.
 */
export const CAPS: DiversityCaps = {
  perSource: 6, perSubject: 5, maxReleases: 16, total: 120,
};

/**
 * The ceiling the soft cap cannot be talked past.
 *
 * `perSubject` gates on whether a story brings ANY under-represented subject,
 * which is what lets a story about both Rust and WebAssembly in when Rust is
 * full. That rule is right and it is also an escape hatch: a project with a
 * generous tag cloud -- solana, web3, defi, blockchain -- always has one subject
 * with room, so it never actually caps. This is the backstop. A subject may
 * exceed its soft cap by riding along with genuinely new ones, and never past
 * twice.
 */
export const HARD_SUBJECT_MULTIPLE = 2;

/**
 * Cut the pool down to something a person could actually read, without letting
 * one publisher or one project speak for the field.
 *
 * Greedy over the incoming order, which is already richest-first, so the caps
 * only ever remove -- they never promote a weaker story over a stronger one.
 *
 * THE FIELD ROOT IS NOT A SUBJECT. Ask for the cloud field and most of what
 * comes back is tagged `cloud`, so counting the root against a per-subject cap
 * would stop the corpus at three stories. The root is the section heading; the
 * subjects are what is underneath it. `ignore` carries it, and carries nothing
 * else.
 */
export function diversify(
  items: Item[], caps: DiversityCaps = CAPS, ignore: Iterable<string> = [],
): Item[] {
  const skip = new Set(ignore);
  /**
   * ONE STORY PER PUBLISHER PER TITLE PER DAY.
   *
   * "the amount of news that you analysis is still low" (2026-09-11) was
   * answered by letting a period be read at four times the depth, and that
   * immediately made an existing flaw four times more expensive: raising the
   * per-publisher cap from 6 to 25 took the duplicate share of an August corpus
   * from 5% to 20%. A hundred of the 499 slots were the same story twice.
   *
   * They are all same-publisher: a feed re-publishes an item under a new
   * identifier and `superseded_by` does not catch it, so the corpus carries
   * "Vercel Connect is now generally available" twice and a reading spends two
   * of its citations saying one thing.
   *
   * THE DAY IS PART OF THE KEY AND HAS TO BE. GitHub's status feed published
   * four separate posts titled "Incident with Actions" in August, on four
   * different days, about four different incidents. Keying on title alone would
   * silently drop three real outages -- which is the same class of error as
   * every other one in this file: an absence that looks like a statement.
   */
  const seen = new Set<string>();
  const bySource = new Map<string, number>();
  const bySubject = new Map<string, number>();
  const hard = caps.perSubject * HARD_SUBJECT_MULTIPLE;
  const out: Item[] = [];
  let releases = 0;

  for (const it of items) {
    if (out.length >= caps.total) break;
    if (it.kind === 'release' && releases >= caps.maxReleases) continue;

    const key = `${it.source}|${it.title.trim().toLowerCase()}|${
      it.when.slice(0, 10)}`;
    if (seen.has(key)) continue;

    const srcN = bySource.get(it.source) ?? 0;
    if (srcN >= caps.perSource) continue;

    const named = it.stacks.filter((s) => !skip.has(s));
    const subjects = named.length > 0 ? named : ['(untagged)'];
    const count = (s: string) => bySubject.get(s) ?? 0;

    // Full on every subject it names: it adds nothing this selection lacks.
    if (subjects.every((s) => count(s) >= caps.perSubject)) continue;
    // Already well past its cap on one of them: whatever else it brings, it is
    // no longer the marginal story about that subject.
    if (subjects.some((s) => count(s) >= hard)) continue;

    out.push(it);
    seen.add(key);
    if (it.kind === 'release') releases += 1;
    bySource.set(it.source, srcN + 1);
    for (const s of subjects) bySubject.set(s, count(s) + 1);
  }
  return out;
}

/** The stories a field's briefing will be written from. */
export async function fieldCorpus(
  field: string, win: Window, query: Query = q, caps: DiversityCaps = CAPS,
): Promise<Item[]> {
  return diversify(await fieldPool(field, win, 400, query), caps, [field]);
}

/**
 * How much of the corpus can corroborate anything.
 *
 * NOT a count of the field. A count of THIS SELECTION, which is a different and
 * honest thing: it describes the evidence the briefing was written from, and it
 * is what a reader needs in order to know how much weight to give it. "Read 31
 * stories, 12 independent" is a fact about the reading; "the field produced 412
 * stories" would be a fact about the feed list.
 */
export function provenance(items: Item[]): {
  read: number; independent: number; firstParty: number; sources: number; rungs: string[];
} {
  return {
    read: items.length,
    independent: items.filter((i) => i.independent).length,
    firstParty: items.filter((i) => !i.independent).length,
    sources: new Set(items.map((i) => i.source)).size,
    rungs: [...new Set(items.map((i) => i.rung))],
  };
}

/** Every technology named in the corpus, most-discussed first. */
export function subjectsOf(items: Item[], limit = 20): string[] {
  const n = new Map<string, number>();
  for (const it of items) for (const s of it.stacks) n.set(s, (n.get(s) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([s]) => s);
}

/**
 * Render the corpus for reading.
 *
 * Numbered, because the numbers are the citation mechanism: the model answers
 * with story indexes and the page turns them back into links, which is what
 * makes every paragraph openable. Summaries are truncated rather than dropped
 * -- 400 characters is enough to know what happened and short enough that forty
 * stories fit in one call.
 *
 * Lives here rather than in briefing.ts because two callers now need it and the
 * second one is strategy.ts, which briefing.ts imports -- leaving it there made
 * an import cycle out of a pure function over Item[].
 */
export function corpusPacket(items: Item[]): string {
  return items.map((it, i) => {
    const voice = it.independent ? 'independent' : 'first-party (speaks for the subject)';
    const named = [...it.stacks, ...it.companies, ...it.platforms].slice(0, 6);
    return `[${i + 1}] ${it.title}\n`
      + `    ${(it.summary ?? '').replace(/\s+/g, ' ').slice(0, 400)}\n`
      + `    source: ${it.source} (${voice}); kind: ${it.kind}; date: ${it.when}`
      + (named.length ? `; tagged: ${named.join(', ')}` : '');
  }).join('\n');
}

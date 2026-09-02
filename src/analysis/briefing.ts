// A report the archive WRITES, from what the stories say.
//
// The previous report compared how many stories each technology attracted this
// window against the last, and called the ratio a finding. On 2026-09-01 that
// was rejected, correctly: "don't count news, it is fake value because we can't
// collect all news". A ratio over an unknown denominator is a statement about
// the feed list wearing the clothes of a statement about the industry.
//
// What replaces it: read the field's stories, say what is in them, and cite the
// stories for every claim. That is slower, cheaper to check, and the only
// version of this page whose sentences survive somebody clicking through.
//
// THE THREE THINGS THAT KEEP THIS HONEST
//
// 1. THE WRITER SEES ONLY THE CORPUS. Every theme cites story numbers, and a
//    theme that cites nothing is dropped in code (see `validate`). A model
//    asked about technology trends will otherwise supply the industry consensus
//    from its training data -- fluent, plausible, about last year, and
//    indistinguishable from a real finding to the person reading it.
//
// 2. NO QUANTITY COMES FROM THE ARCHIVE. The prompt forbids counting stories,
//    and the only numbers supplied are public GitHub figures with their
//    measurement dates (./public.ts). If the model wants to say how big
//    something is, it has to use a number somebody else can verify.
//
// 3. PROVENANCE TRAVELS WITH THE TEXT. Each story is labelled independent or
//    first-party, so "the vendor says" and "three unrelated outlets report" are
//    distinguishable in the packet rather than flattened into "reports say".

import { q } from '../ui/db.ts';
import { llmCall, type LlmContext } from '../llm/router.ts';
import { FIELDS, fieldLabel } from '../vocab/fields.ts';
import {
  fieldCorpus, provenance, subjectsOf, type Item, type Query, type Window,
} from './corpus.ts';

export type { Window };
import { publicFigures, describeFigure, bySize, type PublicFigure } from './public.ts';

/**
 * Bumped when the meaning of a stored briefing changes, not when its text does.
 *
 * v2 is the fix for a daily report that was not daily. v1 read a rolling
 * fourteen days every morning, and consecutive reports shared about 92% of their
 * evidence -- so they said the same thing, which is what "the report don't
 * change" meant. v2 reads only what arrived since the previous report.
 */
export const GENERATOR = 'content-v2';

/** Nominal cadence, in days. What a run covers is the gap since the last one. */
export const CADENCE_DAYS = 1;

/**
 * How far back to read when there is no previous report to follow.
 *
 * Only reached on a first run, or after the table has been emptied. A day would
 * make the very first report unusually thin for no reason; a week is enough for
 * every field to have something and short enough to still read as news.
 */
export const FIRST_RUN_DAYS = 7;

/**
 * The most a single run will reach back, however long the job was down.
 *
 * Without this, a fortnight's outage produces a fortnight-wide report -- exactly
 * the rolling window this version exists to remove, arriving through the back
 * door. The gap is reported rather than hidden: the page says what the report
 * covered, so a reader can see the days nobody wrote about.
 */
export const MAX_CATCHUP_DAYS = 7;

/**
 * A calendar day, or nothing.
 *
 * The report is addressed by day now rather than by window length, so this is
 * what guards `/reports/<day>` and `?day=`. Shape only -- whether that day has a
 * report is a question for the database, and it is asked with a parameter.
 */
export function reportDay(raw: string | null | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : raw;
}

/**
 * The period the next report should cover.
 *
 * Runs from where the last report stopped, so no story is read into two
 * briefings and none is skipped between them.
 */
export function nextWindow(now: Date, lastCoveredTo: string | null): Window {
  const to = now.toISOString();
  const floor = new Date(now.getTime() - MAX_CATCHUP_DAYS * 86400_000);
  const fallback = new Date(now.getTime() - FIRST_RUN_DAYS * 86400_000);
  const last = lastCoveredTo ? new Date(lastCoveredTo) : null;
  const from = !last || Number.isNaN(last.getTime())
    ? fallback
    : new Date(Math.max(last.getTime(), floor.getTime()));
  return { from: from.toISOString(), to };
}

/** Where the previous report stopped reading, if there was one. */
export async function lastCoverage(query: Query = q): Promise<string | null> {
  const rows = await query<{ covered_to: string | null }>(
    `SELECT max(covered_to)::text AS covered_to FROM daily_reports
      WHERE generator LIKE 'content-%' AND covered_to IS NOT NULL`);
  return rows[0]?.covered_to ?? null;
}

/** How long a window is, for the page to state. */
export function windowDays(win: Window): number {
  const ms = new Date(win.to).getTime() - new Date(win.from).getTime();
  return Math.max(1, Math.round(ms / 86400_000));
}

// ---------------------------------------------------------------------------
// What the writer is given
// ---------------------------------------------------------------------------

/**
 * Render the corpus for reading.
 *
 * Numbered, because the numbers are the citation mechanism: the model answers
 * with story indexes and the page turns them back into links, which is what
 * makes every paragraph openable. Summaries are truncated rather than dropped
 * -- 400 characters is enough to know what happened and short enough that forty
 * stories fit in one call.
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

/** The public figures block, or an explicit statement that there is none. */
export function figuresPacket(figures: PublicFigure[]): string {
  if (figures.length === 0) {
    return 'None measured for the technologies in this corpus. Do not state any '
      + 'size, adoption or popularity figure at all.';
  }
  return figures.map((f) => `- ${describeFigure(f)}`).join('\n');
}

export function fieldPacket(
  field: string, win: Window, items: Item[], figures: PublicFigure[],
): string {
  const p = provenance(items);
  const d = windowDays(win);
  return [
    `FIELD: ${fieldLabel(field)}`,
    `WINDOW: ${win.from.slice(0, 10)} to ${win.to.slice(0, 10)} `
      + `(${d} day${d === 1 ? '' : 's'}). Everything here is new since the last briefing; `
      + 'do not refer to anything you were not shown.',
    '',
    'WHAT YOU ARE READING:',
    `${p.read} stories from ${p.sources} sources, of which ${p.independent} are `
      + `independent and ${p.firstParty} speak for the subject they describe. This is a `
      + 'SELECTION, capped so that no publisher contributes more than four and no '
      + 'project more than three. It is not everything published, and you must not '
      + 'describe it as if it were.',
    '',
    'PUBLIC FIGURES (the only quantities you may use):',
    figuresPacket(figures),
    '',
    'THE STORIES:',
    corpusPacket(items),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// What comes back
// ---------------------------------------------------------------------------

export interface Theme {
  title: string;
  body: string;
  /** 1-based indexes into the corpus. The citation, and the thing that is checked. */
  evidence: number[];
}

export interface Briefing {
  field: string;
  label: string;
  headline: string;
  summary: string;
  themes: Theme[];
  watch: string[];
  gaps: string;
  /** Which model wrote it. A briefing is not anonymous. */
  provider?: string;
  /** The stories it was written from, in the order the citations index. */
  corpus: Item[];
  figures: PublicFigure[];
}

/**
 * Throw away anything the corpus does not support.
 *
 * A theme citing a story that does not exist is the model inventing a source,
 * and a theme citing nothing is the model writing from memory. Both are dropped
 * rather than flagged: a briefing that quietly contains one unsupported
 * paragraph is worse than a shorter briefing, because the reader has no way to
 * tell which paragraph it was.
 */
export function validate(themes: Theme[], corpusSize: number): Theme[] {
  return themes
    .map((t) => ({
      title: String(t.title ?? '').trim(),
      body: String(t.body ?? '').trim(),
      evidence: (Array.isArray(t.evidence) ? t.evidence : [])
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= corpusSize),
    }))
    .filter((t) => t.title && t.body && t.evidence.length > 0);
}

interface RawBriefing {
  headline: string; summary: string; themes: Theme[]; watch: string[]; gaps: string;
}

/**
 * Below this a field is quiet for the day, and says so.
 *
 * A day's news does not reach every field, and four stories is not a briefing --
 * it is four stories with paragraphs around them. Reporting the silence is the
 * honest option and it is also the informative one: "too little arrived in
 * mobile today" is true, checkable, and not the same claim as "nothing happened
 * in mobile".
 */
export const MIN_CORPUS = 5;

/**
 * Write one field's briefing.
 *
 * Returns null rather than throwing when no model is reachable or the corpus is
 * too thin: a field with nothing to say should produce no briefing, not a
 * confident paragraph about nothing.
 */
/**
 * Why a field has no briefing. TWO DIFFERENT FACTS, and they were one.
 *
 * `briefField` used to return null for both "too little arrived to write from"
 * and "no model would answer", and `briefArchive` filed both under `quiet`. The
 * page then told the reader that the field had "produced too little to write
 * from" -- which is a statement about coverage, and was simply false whenever
 * the real cause was a provider cooldown.
 *
 * Found on 2026-09-01 generating a fortnight of back reports: 15 to 18 August
 * wrote, then gemini-flash-lite hit its rate limit and the next ten days came
 * back as fourteen quiet fields each. Ten days of "the industry was silent" for
 * an archive holding 1,800 readable stories over those days. That is exactly the
 * class of false claim this whole rewrite exists to prevent, and it was being
 * made by the part of the code that reports the limits.
 */
export type FieldOutcome =
  | { status: 'written'; briefing: Briefing }
  /** Too little evidence. A fact about coverage, and safe to say so. */
  | { status: 'quiet'; read: number }
  /** The archive could have written this and did not. Never call it quiet. */
  | { status: 'unwritten'; why: string; read: number };

export async function briefField(
  ctx: LlmContext, field: string, win: Window, query: Query = q,
  minCorpus = MIN_CORPUS,
): Promise<FieldOutcome> {
  const corpus = await fieldCorpus(field, win, query);
  if (corpus.length < minCorpus) return { status: 'quiet', read: corpus.length };

  const figures = bySize(
    (await publicFigures(subjectsOf(corpus, 20), query)).values()).slice(0, 12);

  const packet = fieldPacket(field, win, corpus, figures);
  const res = await llmCall<RawBriefing>(ctx, 'field_briefing', packet, packet);
  if (res.status !== 'ok') {
    return { status: 'unwritten', read: corpus.length,
      why: `no model answered (${res.status})` };
  }

  const themes = validate(res.value.themes ?? [], corpus.length);
  if (themes.length === 0) {
    // The model answered and cited nothing that exists. A fault in the writing,
    // not in the evidence -- there were stories to read.
    return { status: 'unwritten', read: corpus.length,
      why: 'the briefing cited no story that exists' };
  }

  return { status: 'written', briefing: {
    field,
    label: fieldLabel(field),
    headline: String(res.value.headline ?? '').trim(),
    summary: String(res.value.summary ?? '').trim(),
    themes,
    watch: (res.value.watch ?? []).map(String).filter(Boolean),
    gaps: String(res.value.gaps ?? '').trim(),
    provider: res.provider,
    corpus,
    figures,
  } };
}

// ---------------------------------------------------------------------------
// The whole archive, composed from its fields
// ---------------------------------------------------------------------------

export interface ArchiveReport {
  day: string;
  /** Exactly what was read. Stored, because "the last N days" is not a fact. */
  window: Window;
  title: string;
  fields: Briefing[];
  /** Fields with too little in the window to write from, named rather than hidden. */
  quiet: string[];
  /**
   * Fields that had evidence and got no briefing anyway.
   *
   * Kept apart from `quiet` because they are the opposite claim. A quiet field
   * says something about the world; an unwritten one says something about this
   * archive, and reporting the second as the first tells the reader the industry
   * was silent when in fact a rate limit was.
   */
  unwritten: Unwritten[];
  generator: string;
}

export interface Unwritten {
  field: string;
  why: string;
  /** How much there was to read, so the size of what is missing is visible. */
  read: number;
}

/**
 * The title.
 *
 * Asked for on 2026-08-31: it must name what the report is about -- a market, a
 * technology, a platform or a company -- and the day. "Movement report" is a
 * filename; a title is a claim about the subject.
 *
 * The subjects come from the stories each briefing LED with, so the title is
 * made of the same judgement the briefing was, rather than a second and
 * different one computed from tallies.
 *
 * FIELD ROOTS ARE EXCLUDED. Every story in the cloud briefing is tagged
 * `cloud`, so the most-tagged subject of a field is always the field, and a
 * title built from it reads "Ai, Cloud, Data" -- fourteen words for "we have
 * fourteen sections". The root is the section heading; the title needs what is
 * underneath it.
 */
export function composeTitle(
  fields: Briefing[], day: string, names: Map<string, string> = new Map(),
): string {
  const when = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (fields.length === 0) return `Nothing to report — ${when}`;

  const roots = new Set(FIELDS.map((f) => f.slug));
  const subjects: string[] = [];
  let market = 0;

  for (const b of fields) {
    const lead = b.themes[0];
    if (!lead) continue;
    for (const n of lead.evidence) {
      const it = b.corpus[n - 1];
      if (!it) continue;
      if (it.kind === 'market') market += 1;
      for (const s of [...it.companies, ...it.platforms, ...it.stacks]) {
        if (roots.has(s) || subjects.includes(s)) continue;
        subjects.push(s);
      }
    }
  }

  const named = subjects.slice(0, 3).map((s) => names.get(s) ?? titleCase(s));
  const lead = named.length > 0 ? named.join(', ') : fields.map((f) => f.label).join(', ');
  // "Market moves" first when the leading evidence is money rather than
  // shipping. That is a different kind of day and the title should say so
  // before it says any name.
  const prefix = market >= 2 ? 'Market moves: ' : '';
  const n = fields.length;
  return `${prefix}${lead} — ${n} field${n === 1 ? '' : 's'} briefed, ${when}`;
}

function titleCase(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Display names for the entities a title might use.
 *
 * Slugs are not names. `ai-agents` title-cases to "Ai Agents", `postgresql` to
 * "Postgresql", and a title is the one string in a report that nobody reads
 * charitably. Three tables carry the real spelling, so all three are asked.
 */
export async function displayNames(
  slugs: string[], query: Query = q,
): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const rows = await query<{ slug: string; name: string }>(
    `SELECT slug, name FROM stacks WHERE slug = ANY($1::text[])
      UNION ALL
     SELECT slug, name FROM companies WHERE slug = ANY($1::text[])
      UNION ALL
     SELECT slug, name FROM platforms WHERE slug = ANY($1::text[])`, [slugs]);
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.slug)) out.set(r.slug, r.name);
  return out;
}

/**
 * Brief every field, in sequence.
 *
 * Sequential on purpose. Fourteen concurrent model calls is how a provider's
 * rate limit turns one slow report into fourteen failed ones, and this runs
 * once a day on a job with a thirty-minute lease -- there is nothing to gain by
 * hurrying it.
 */
export async function briefArchive(
  ctx: LlmContext, win: Window, now = new Date(), query: Query = q,
  fields = FIELDS.map((f) => f.slug),
): Promise<ArchiveReport> {
  const written: Briefing[] = [];
  const quiet: string[] = [];
  const unwritten: Unwritten[] = [];

  for (const slug of fields) {
    const out = await briefField(ctx, slug, win, query)
      .catch((e: unknown): FieldOutcome => ({
        status: 'unwritten', read: 0, why: (e as Error)?.message ?? 'threw' }));
    if (out.status === 'written') written.push(out.briefing);
    else if (out.status === 'quiet') quiet.push(slug);
    else unwritten.push({ field: slug, why: out.why, read: out.read });
  }

  const day = now.toISOString().slice(0, 10);
  const cited = [...new Set(written.flatMap((b) => {
    const lead = b.themes[0];
    return (lead?.evidence ?? []).flatMap((n) => {
      const it = b.corpus[n - 1];
      return it ? [...it.companies, ...it.platforms, ...it.stacks] : [];
    });
  }))];
  const names = await displayNames(cited, query).catch(() => new Map<string, string>());

  return {
    day, window: win, fields: written, quiet, unwritten,
    title: composeTitle(written, day, names),
    generator: GENERATOR,
  };
}

/**
 * Read the period since the last report, and keep the result.
 *
 * One call, because the window has to be chosen from what is already stored and
 * then written back with the report -- doing that in two places is how a gap or
 * an overlap gets introduced between consecutive days.
 */
export async function runDailyReport(
  ctx: LlmContext, query: Query = q, now = new Date(),
): Promise<{ day: string; fields: number; themes: number; read: number; days: number }> {
  const win = nextWindow(now, await lastCoverage(query));
  const report = await briefArchive(ctx, win, now, query);
  return { ...await saveArchiveReport(query, report), days: windowDays(win) };
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * Keep the day's report.
 *
 * The page renders what was written, not what would be written now: a report
 * that changes when you reload is not a report. Stored against the day so a
 * retry after a failure corrects that morning rather than appending a second
 * opinion.
 *
 * The payload stores the citations resolved into real stories -- id, title,
 * source, date -- rather than indexes. Retention deletes stories after four
 * months and this table outlives them, so an unresolved index would become a
 * pointer to nothing exactly when the report became historically interesting.
 */
export async function saveArchiveReport(
  query: Query, report: ArchiveReport,
): Promise<{ day: string; fields: number; themes: number; read: number }> {
  // Citations are resolved into real stories rather than kept as indexes.
  // Retention deletes stories after four months and these tables outlive them,
  // so an index would become a pointer to nothing exactly when the report became
  // historically interesting.
  const cite = (b: Briefing, n: number) => {
    const it = b.corpus[n - 1];
    return it ? {
      id: it.id, title: it.title, url: it.url, source: it.source,
      kind: it.kind, when: it.when, independent: it.independent,
    } : null;
  };

  const shaped = report.fields.map((b) => ({
    b,
    read: provenance(b.corpus),
    payload: {
      generator: report.generator,
      figures: b.figures,
      themes: b.themes.map((t) => ({
        title: t.title, body: t.body,
        evidence: t.evidence.map((n) => cite(b, n)).filter(Boolean),
      })),
      watch: b.watch,
    },
  }));

  // ONE ROW PER FIELD PER DAY, which is the grain the reader navigates: down the
  // days for one field, across the fields for one day. Written one statement at
  // a time rather than in a single multi-row insert -- fourteen small writes
  // that can each be retried beats one that loses thirteen good briefings
  // because the fourteenth had a long headline.
  for (const s of shaped) {
    await query(
      `INSERT INTO field_briefings
         (day, field, generator, provider, covered_from, covered_to,
          headline, summary, gaps, stories_read, sources, independent, themes, payload)
       VALUES ($1::date, $2, $3, $4, $5::timestamptz, $6::timestamptz,
               $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
       ON CONFLICT (day, field) DO UPDATE SET
         generated_at = now(), generator = EXCLUDED.generator,
         provider = EXCLUDED.provider,
         covered_from = EXCLUDED.covered_from, covered_to = EXCLUDED.covered_to,
         headline = EXCLUDED.headline, summary = EXCLUDED.summary,
         gaps = EXCLUDED.gaps, stories_read = EXCLUDED.stories_read,
         sources = EXCLUDED.sources, independent = EXCLUDED.independent,
         themes = EXCLUDED.themes, payload = EXCLUDED.payload`,
      [report.day, s.b.field, report.generator, s.b.provider ?? null,
        report.window.from, report.window.to,
        s.b.headline, s.b.summary, s.b.gaps || null,
        s.read.read, s.read.sources, s.read.independent, s.payload.themes.length,
        JSON.stringify(s.payload)]);
  }

  const themes = shaped.reduce((n, s) => n + s.payload.themes.length, 0);
  const read = shaped.reduce((n, s) => n + s.read.read, 0);
  const sources = new Set(
    report.fields.flatMap((b) => b.corpus.map((i) => i.source))).size;

  // The day-level row: the composed title, the totals, and which fields had too
  // little to say. It carries no findings of its own -- those are the rows
  // above, and duplicating them here is how the two copies start to disagree.
  await query(
    `INSERT INTO daily_reports
       (day, window_days, generator, title, fields, themes, stories_read, sources,
        covered_from, covered_to, payload)
     VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz,
             $11::jsonb)
     ON CONFLICT (day, window_days) DO UPDATE SET
       generated_at = now(), generator = EXCLUDED.generator, title = EXCLUDED.title,
       fields = EXCLUDED.fields, themes = EXCLUDED.themes,
       stories_read = EXCLUDED.stories_read, sources = EXCLUDED.sources,
       covered_from = EXCLUDED.covered_from, covered_to = EXCLUDED.covered_to,
       payload = EXCLUDED.payload`,
    [report.day, CADENCE_DAYS, report.generator, report.title,
      report.fields.length, themes, read, sources,
      report.window.from, report.window.to,
      JSON.stringify({ generator: report.generator, quiet: report.quiet,
        unwritten: report.unwritten })]);

  return { day: report.day, fields: report.fields.length, themes, read };
}

// ---------------------------------------------------------------------------
// Reading the reports back
// ---------------------------------------------------------------------------

export interface Citation {
  id: string; title: string; url: string; source: string;
  kind: string; when: string; independent: boolean;
}

export interface StoredTheme {
  title: string; body: string; evidence: Citation[];
}

/** One field on one day, as the page reads it. */
export interface StoredField {
  day: string;
  field: string;
  label: string;
  headline: string;
  summary: string;
  gaps: string;
  provider?: string;
  coveredFrom: string;
  coveredTo: string;
  read: { read: number; sources: number; independent: number; firstParty: number };
  themes: StoredTheme[];
  watch: string[];
  figures: PublicFigure[];
}

interface FieldRow {
  day: string; field: string; provider: string | null;
  covered_from: string; covered_to: string;
  headline: string; summary: string; gaps: string | null;
  stories_read: number; sources: number; independent: number;
  payload: { themes?: StoredTheme[]; watch?: string[]; figures?: PublicFigure[] };
}

function toStored(r: FieldRow): StoredField {
  const read = Number(r.stories_read);
  const independent = Number(r.independent);
  return {
    day: r.day, field: r.field, label: fieldLabel(r.field),
    headline: r.headline, summary: r.summary, gaps: r.gaps ?? '',
    provider: r.provider ?? undefined,
    coveredFrom: r.covered_from, coveredTo: r.covered_to,
    read: { read, sources: Number(r.sources), independent, firstParty: read - independent },
    themes: r.payload?.themes ?? [],
    watch: r.payload?.watch ?? [],
    figures: r.payload?.figures ?? [],
  };
}

const FIELD_COLS = `day::text AS day, field, provider,
  covered_from::text AS covered_from, covered_to::text AS covered_to,
  headline, summary, gaps, stories_read, sources, independent, payload`;

/** Every field briefed on one day, in the taxonomy's reading order. */
export async function briefingsOn(day: string, query: Query = q): Promise<StoredField[]> {
  const rows = await query<FieldRow>(
    `SELECT ${FIELD_COLS} FROM field_briefings WHERE day = $1::date`, [day]);
  const order = new Map(FIELDS.map((f, i) => [f.slug, i]));
  return rows.map(toStored).sort(
    (a, b) => (order.get(a.field) ?? 99) - (order.get(b.field) ?? 99));
}

/** One field on one day. */
export async function briefingFor(
  field: string, day: string, query: Query = q,
): Promise<StoredField | null> {
  const rows = await query<FieldRow>(
    `SELECT ${FIELD_COLS} FROM field_briefings
      WHERE field = $1 AND day = $2::date`, [field, day]);
  return rows[0] ? toStored(rows[0]) : null;
}

/** The most recent briefing for one field, whenever it was written. */
export async function latestForField(
  field: string, query: Query = q,
): Promise<StoredField | null> {
  const rows = await query<FieldRow>(
    `SELECT ${FIELD_COLS} FROM field_briefings
      WHERE field = $1 ORDER BY day DESC LIMIT 1`, [field]);
  return rows[0] ? toStored(rows[0]) : null;
}

/** One line per day this field was briefed. The field's own history. */
export interface FieldDay {
  day: string; headline: string; themes: number; read: number; independent: number;
}

export async function daysForField(
  field: string, limit = 60, query: Query = q,
): Promise<FieldDay[]> {
  return query<FieldDay>(
    `SELECT day::text AS day, headline, themes, stories_read AS read, independent
       FROM field_briefings WHERE field = $1
      ORDER BY day DESC LIMIT $2`, [field, limit]);
}

/** A day in the index: the composed title, and the fields under it. */
export interface ReportDay {
  day: string;
  title: string;
  generatedAt: string;
  generator: string;
  coveredFrom: string | null;
  coveredTo: string | null;
  fields: number;
  themes: number;
  read: number;
  sources: number;
  quiet: string[];
  unwritten: Unwritten[];
  briefings: Array<{ field: string; label: string; headline: string; themes: number }>;
}

/**
 * Every report ever written, newest first, with its fields under it.
 *
 * Two queries rather than a join: the day rows and the field rows are different
 * grains, and joining them means every day's totals arrive once per field and
 * have to be de-duplicated in code. Asked for on 2026-09-01 -- the report must
 * "list that compose each report for each day and each fields".
 */
/**
 * ONE REPORT PER DAY, whichever was written last.
 *
 * `daily_reports` is keyed (day, window_days), which was right when the window
 * was a reader's choice and is not any more: a day now has exactly one report.
 * The old rows are still there -- `forbid_delete` applies, and they are true as
 * what they were -- so 1 September held both a content-v1 row over fourteen
 * rolling days and a content-v2 row over one, and the index listed the day
 * twice with two different totals and identical fields beneath them.
 *
 * DISTINCT ON by generated_at rather than a filter on the generator string,
 * because the same thing will happen at v3 and a filter would have to be
 * remembered. The newest report for a day is the report for that day.
 */
export async function reportIndex(
  limit = 30, query: Query = q, day: string | null = null,
): Promise<ReportDay[]> {
  const days = await query<{
    day: string; title: string; generated_at: string; generator: string;
    covered_from: string | null; covered_to: string | null;
    fields: number | null; themes: number | null; stories_read: number | null;
    sources: number | null; payload: { quiet?: string[]; unwritten?: Unwritten[] };
  }>(
    `SELECT DISTINCT ON (day)
            day::text AS day, title, generated_at::text AS generated_at, generator,
            covered_from::text AS covered_from, covered_to::text AS covered_to,
            fields, themes, stories_read, sources, payload
       FROM daily_reports
      WHERE generator LIKE 'content-%'
        AND ($2::date IS NULL OR day = $2::date)
      ORDER BY day DESC, generated_at DESC
      LIMIT $1`, [limit, day]);
  if (days.length === 0) return [];

  const rows = await query<{
    day: string; field: string; headline: string; themes: number;
  }>(
    `SELECT day::text AS day, field, headline, themes
       FROM field_briefings WHERE day = ANY($1::date[])`,
    [days.map((d) => d.day)]);

  const order = new Map(FIELDS.map((f, i) => [f.slug, i]));
  const byDay = new Map<string, ReportDay['briefings']>();
  for (const r of rows) {
    const list = byDay.get(r.day) ?? [];
    list.push({
      field: r.field, label: fieldLabel(r.field),
      headline: r.headline, themes: Number(r.themes),
    });
    byDay.set(r.day, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => (order.get(a.field) ?? 99) - (order.get(b.field) ?? 99));
  }

  return days.map((d) => ({
    day: d.day, title: d.title, generatedAt: d.generated_at, generator: d.generator,
    coveredFrom: d.covered_from, coveredTo: d.covered_to,
    fields: Number(d.fields ?? 0), themes: Number(d.themes ?? 0),
    read: Number(d.stories_read ?? 0), sources: Number(d.sources ?? 0),
    quiet: d.payload?.quiet ?? [],
    unwritten: d.payload?.unwritten ?? [],
    briefings: byDay.get(d.day) ?? [],
  }));
}

/** One day, whole: the composed title and every field under it. */
export interface StoredArchive extends Omit<ReportDay, 'briefings'> {
  briefings: StoredField[];
}

/**
 * One day's whole report. `null` for the day means the most recent one.
 *
 * The day row is fetched with its own query rather than by filtering the index,
 * because the index exists to list many days cheaply and this needs exactly one.
 */
export async function archiveFor(
  day: string | null, query: Query = q,
): Promise<StoredArchive | null> {
  const rows = await query<{
    day: string; title: string; generated_at: string; generator: string;
    covered_from: string | null; covered_to: string | null;
    fields: number | null; themes: number | null; stories_read: number | null;
    sources: number | null; payload: { quiet?: string[]; unwritten?: Unwritten[] };
  }>(
    `SELECT DISTINCT ON (day)
            day::text AS day, title, generated_at::text AS generated_at, generator,
            covered_from::text AS covered_from, covered_to::text AS covered_to,
            fields, themes, stories_read, sources, payload
       FROM daily_reports
      WHERE generator LIKE 'content-%'
        AND ($1::date IS NULL OR day = $1::date)
      ORDER BY day DESC, generated_at DESC
      LIMIT 1`, [day]);

  const d = rows[0];
  if (!d) return null;
  return {
    day: d.day, title: d.title, generatedAt: d.generated_at, generator: d.generator,
    coveredFrom: d.covered_from, coveredTo: d.covered_to,
    fields: Number(d.fields ?? 0), themes: Number(d.themes ?? 0),
    read: Number(d.stories_read ?? 0), sources: Number(d.sources ?? 0),
    quiet: d.payload?.quiet ?? [],
    unwritten: d.payload?.unwritten ?? [],
    briefings: await briefingsOn(d.day, query),
  };
}

/** One line for the scheduler's log. */
export function summariseReport(
  r: { day: string; fields: number; themes: number; read: number; days?: number },
): string {
  return `${r.day}: ${r.fields} fields briefed, ${r.themes} findings, `
    + `written from ${r.read} stories read`
    + (r.days ? ` over ${r.days} day${r.days === 1 ? '' : 's'}` : '');
}

// The stack registry: every entry in the taxonomy, with everything it carries.
//
// /technologies browses BY CATEGORY and shows the most active of each. This is
// the other question -- the complete list, filterable, with each entry's full
// record open next to it. In a closed vocabulary that record matters more than
// it would elsewhere: the slug is simultaneously the URL, the filter value and
// the only tag a model is allowed to return, and the aliases are the entire
// reason a story saying "k8s" ends up under Kubernetes.
//
// What is shown is what is POPULATED. Four columns of the stacks table --
// description, homepage_url, changelog_url, first_release -- are empty for every
// row, and docs_url is set on 24. Rendering them as blank cells would dress the
// page in furniture that says nothing, so the completeness panel reports the gap
// as a number instead: it is the curation backlog, and it is worth seeing.
//
// The registry is not a fixed list. Discovery proposes entries from the archive
// itself, promotes the ones with primary-source evidence behind them, and queues
// the rest for a decision -- so this page shows a vocabulary that is growing,
// with the queue that feeds it right underneath.

import { q, one } from './db.ts';
import {
  escapeHtml, wrap, pageHead, empty, truncate, kpi, panel, icon,
} from './html.ts';
import { CATEGORIES, category } from './stacks.ts';
import { CURATED_ORIGINS, DISCOVERED_ORIGINS, IMPORTED_ORIGINS, IMPORT_SOURCE, originClass }
  from '../vocab/origins.ts';
import { KINDS, type Kind } from '../vocab/kinds.ts';
import { crumbsFor } from './nav.ts';
import { promoteCandidate, rejectCandidate } from '../process/discover.ts';

const PAGE = 100;

export interface Resource {
  stack_slug: string;
  kind: string;
  title: string;
  url: string;
  provider: string;
  origin: string;
  http_status: number | null;
}

export interface RegistryRow {
  slug: string;
  name: string;
  kind: Kind;
  description: string | null;
  /** Wikidata's one-line description, for the collapsed row. See 0052. */
  blurb: string | null;
  homepage_url: string | null;
  category: string;
  status: string;
  parent: string | null;
  aliases: string[];
  docs_url: string | null;
  repo_url: string | null;
  release_feed_url: string | null;
  children: number;
  stories: number;
  recent: number;
  /** Live activity, refreshed every collection cycle. See ACTIVITY below. */
  activity: 'hot' | 'active' | 'quiet' | 'dormant' | 'unseen';
  last_story: string | null;
  /** Where to actually get this, and whether that address answered. */
  go_url: string | null;
  go_state: string | null;
  go_final: string | null;
  first_seen: string | null;
  last_seen: string | null;
  /** A source is actually polling this project's release feed. */
  tracked: boolean;
  curated: boolean;
  origin: string;
  discovered_at: string | null;
}

export interface Filters {
  /**
   * Which registry is open. It comes from the path rather than a query
   * parameter because it is not a filter -- Tools and Stacks are two lists that
   * happen to share a renderer, and a URL should say which one you are reading.
   */
  kind: Kind;
  search: string;
  categories: string[];
  have: string[];
  seen: string;
  origin: string;
  sort: string;
  offset: number;
}

// Ordered so the two most useful questions are the first two: what is worth
// looking at, and what is broken. Story volume answers "is this a real thing";
// link state answers "can I actually go there", which is what this section is
// now for.
const SORTS: Record<string, { label: string; sql: string }> = {
  activity: { label: 'Most active (30 days)', sql: 'recent DESC, stories DESC, name' },
  stories: { label: 'Most covered, all time', sql: 'stories DESC, name' },
  // Worst first, deliberately. A sort that puts the working links at the top
  // is a sort nobody needs -- they are already fine.
  broken: {
    label: 'Broken links first',
    sql: `CASE go_state WHEN 'unreachable' THEN 0 WHEN 'missing' THEN 1
            WHEN 'erroring' THEN 2 WHEN 'odd' THEN 3 WHEN 'blocked' THEN 4
            WHEN 'ok' THEN 6 ELSE 5 END, stories DESC, name`,
  },
  linked: {
    label: 'Has a working address',
    sql: `CASE WHEN go_state = 'ok' THEN 0 WHEN go_url IS NULL THEN 2 ELSE 1 END,
          stories DESC, name`,
  },
  name: { label: 'Alphabetical', sql: 'name' },
  category: { label: 'By category', sql: 'category, name' },
  aliases: { label: 'Most aliases', sql: 'coalesce(array_length(aliases, 1), 0) DESC, name' },
  children: { label: 'Most descendants', sql: 'children DESC, name' },
  quiet: { label: 'Never seen first', sql: 'stories, name' },
  // Two different meanings of "new", and the registry only had the weaker one.
  //
  //   Recently added    when the ROW was created -- a fact about this project's
  //                     curation, which says nothing about the technology.
  //   First seen        when the technology first appeared in the archive,
  //                     from stack_totals.first_month, computed across the
  //                     rolled-up years. This is the one a reader means by
  //                     "what is new", and until now it was visible only inside
  //                     an expanded row, where it cannot be scanned or sorted.
  firstseen: {
    label: 'Newest to the archive',
    sql: 'first_seen DESC NULLS LAST, stories DESC, name',
  },
  newest: { label: 'Recently added to the registry', sql: 'discovered_at DESC NULLS LAST, name' },
};

/**
 * Where an entry came from.
 *
 * This used to be two options, and the second was a lie by arithmetic: "not
 * hand-seeded" was labelled DISCOVERED AUTOMATICALLY, and 1,615 of the 1,617
 * rows it matched were a vocabulary loaded in bulk, not something the archive
 * noticed. See src/vocab/origins.ts.
 */
const ORIGINS: { value: string; label: string; sql: string }[] = [
  { value: 'any', label: 'However it got here', sql: '' },
  { value: 'seed', label: 'Chosen by a person', sql: list('origin', CURATED_ORIGINS) },
  {
    value: 'discovered', label: 'Found in the archive',
    sql: list('origin', DISCOVERED_ORIGINS),
  },
  {
    value: 'imported', label: 'Imported from a published list',
    sql: list('origin', IMPORTED_ORIGINS),
  },
];

/** A literal IN list. These are constants in this repository, never input. */
function list(col: string, values: string[]): string {
  return `${col} IN (${values.map((v) => `'${v}'`).join(', ')})`;
}

const HAVE: { value: string; label: string; sql: string }[] = [
  { value: 'address', label: 'An address', sql: 'go_url IS NOT NULL' },
  { value: 'working', label: 'A WORKING address', sql: `go_state = 'ok'` },
  {
    value: 'brokenlink', label: 'A broken address',
    // Not 'blocked': a 403 is the site refusing a robot, not a dead page, and
    // listing npm and Stack Overflow as broken would be a false accusation.
    sql: `go_state IN ('missing', 'erroring', 'unreachable')`,
  },
  { value: 'feed', label: 'Release feed', sql: 'release_feed_url IS NOT NULL' },
  { value: 'repo', label: 'Repository', sql: 'repo_url IS NOT NULL' },
  { value: 'docs', label: 'Documentation', sql: 'docs_url IS NOT NULL' },
  { value: 'aliases', label: 'Aliases', sql: 'coalesce(array_length(aliases, 1), 0) > 0' },
  { value: 'children', label: 'Descendants', sql: 'children > 0' },
  { value: 'parent', label: 'A parent', sql: 'parent IS NOT NULL' },
  {
    value: 'learning',
    label: 'Learning material',
    sql: `EXISTS (SELECT 1 FROM stack_resources sr
            WHERE sr.stack_slug = reg.slug AND sr.kind IN ('tutorial','learning')
              AND (sr.origin = 'curated' OR sr.http_status BETWEEN 200 AND 399))`,
  },
  { value: 'description', label: 'A description', sql: 'description IS NOT NULL' },
];

const SEEN: { value: string; label: string; sql: string }[] = [
  { value: 'any', label: 'Everything', sql: '' },
  { value: 'seen', label: 'Seen in the archive', sql: 'stories > 0' },
  { value: 'never', label: 'Never seen', sql: 'stories = 0' },
];

function parse(url: URL, kind: Kind): Filters {
  const many = (key: string) =>
    [...new Set(url.searchParams.getAll(key).map((v) => v.trim()).filter(Boolean))];
  const sort = url.searchParams.get('sort') ?? '';
  const offset = Number(url.searchParams.get('offset') ?? 0);
  return {
    kind,
    search: url.searchParams.get('sq')?.trim() ?? '',
    categories: many('cat').filter((c) => CATEGORIES.some((x) => x.id === c)),
    have: many('have').filter((h) => HAVE.some((x) => x.value === h)),
    seen: SEEN.some((s) => s.value === url.searchParams.get('seen')) ? url.searchParams.get('seen')! : 'any',
    origin: ORIGINS.some((o) => o.value === url.searchParams.get('origin'))
      ? url.searchParams.get('origin')! : 'any',
    sort: SORTS[sort] ? sort : 'activity',
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
  };
}

/** The path each registry lives at. Stacks keeps `/stacks`; nothing breaks. */
export /**
 * Live status, as five words.
 *
 * The registry already carried `current_status` -- active, deprecated,
 * abandoned -- which is a claim about the PROJECT and is edited by hand, so it
 * ages the moment nobody edits it. This is the other question, and the one the
 * collector can actually answer: is anyone writing about this right now. It is
 * recomputed every collection cycle, and the two lower tiers are read from the
 * monthly analysis so they keep working once the stories are gone.
 */
const ACTIVITY: Record<string, { label: string; title: string; cls: string }> = {
  hot:     { label: 'live',     cls: 'ok',      title: 'a story in the last 7 days' },
  active:  { label: 'active',   cls: 'ok soft', title: 'a story in the last 30 days' },
  quiet:   { label: 'quiet',    cls: 'warn',    title: 'nothing this month, but something in the last three' },
  dormant: { label: 'dormant',  cls: 'muted',   title: 'nothing for over three months' },
  unseen:  { label: 'unseen',   cls: 'muted',   title: 'no story has ever mentioned it' },
};

/**
 * What the crawl found at an address, said the way it should be acted on.
 *
 * The states are not equally bad and must not look it. 403 is the interesting
 * one: Stack Overflow, npm, Medium, Fiverr and OpenAI all refuse our user agent
 * and answer perfectly well to a browser. Marking those "broken" would be a
 * confident false accusation about thirty of the best-known sites on the web --
 * so a block is reported as "could not check", which is what actually happened.
 *
 * Only missing, erroring and unreachable are the site's fault, and only those
 * are worth warning a reader about before they click.
 */
const LINK_STATE: Record<string, { label: string; cls: string; title: string }> = {
  ok:          { label: '', cls: 'ok', title: 'answered when last checked' },
  blocked:     { label: 'unchecked', cls: 'muted',
                 title: 'the site refused an automated request — almost certainly fine in a browser' },
  odd:         { label: 'unchecked', cls: 'muted',
                 title: 'answered with something unexpected, probably rate limiting' },
  missing:     { label: '404', cls: 'bad', title: 'the page is not there' },
  erroring:    { label: 'erroring', cls: 'bad', title: 'the server is returning an error' },
  unreachable: { label: 'dead', cls: 'bad',
                 title: 'nothing answered at all — the domain or host is gone' },
};

/**
 * The address, as the row's main fact.
 *
 * A registry of names is a glossary. What makes it usable is knowing where to
 * go, so the link is given the width and the rest is compressed around it. A
 * redirect to a different host is shown because it is usually the truth
 * arriving late: ansible.com is Red Hat now, and anthropic.com/claude-code is
 * claude.com/product/claude-code.
 */
function addressCell(r: RegistryRow): string {
  if (!r.go_url) {
    return '<span class="addr none" title="no address recorded — a curation gap, '
      + 'not a claim that none exists">—</span>';
  }
  const st = LINK_STATE[r.go_state ?? ''] ?? { label: 'unchecked', cls: 'muted',
    title: 'not checked yet' };
  const shown = r.go_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const moved = r.go_final && host(r.go_final) !== host(r.go_url) ? host(r.go_final) : '';
  return `<a class="addr ${st.cls}" href="${escapeHtml(r.go_url)}" target="_blank"
      rel="noreferrer" title="${escapeHtml(st.title)}">${escapeHtml(truncate(shown, 46))}</a>${
    moved ? `<span class="moved" title="redirects to ${escapeHtml(r.go_final ?? '')}">→ ${
      escapeHtml(moved)}</span>` : ''}${
    st.label ? `<span class="lstate ${st.cls}">${st.label}</span>` : ''}`;
}

function host(u: string): string {
  try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Where this entry came from, said accurately.
 *
 * Every non-curated entry used to read "discovered automatically", which was
 * true of two rows in the vocabulary and wrong about the other 1,615. Being
 * on a published list is a different claim from having been found here, and
 * the difference is exactly why an entry can be recent and have no coverage.
 */
function addedLine(r: RegistryRow): string {
  const on = r.discovered_at ? ` on ${escapeHtml(r.discovered_at)}` : '';
  switch (originClass(r.origin)) {
    case 'curated':
      return 'chosen by hand, in the original seed';
    case 'imported':
      return `imported${on} from ${escapeHtml(IMPORT_SOURCE[r.origin] ?? 'a published vocabulary')}`
        + ' — somebody else’s curation, loaded in bulk. An imported entry arrives with'
        + ' no coverage and may never get any; that is a fact about this list, not about the'
        + ' technology.';
    default:
      return `found in the archive${on} — `
        + escapeHtml(r.origin === 'github_release'
          ? 'it published a release under a repository the vocabulary did not know'
          : r.origin === 'repo_link'
            ? 'a story linked its repository'
            : 'it was named in enough headlines to clear the review queue');
  }
}

function activityBadge(r: RegistryRow): string {
  const a = ACTIVITY[r.activity] ?? ACTIVITY.unseen!;
  const when = r.last_story ? ` · last story ${r.last_story}`
    : r.last_seen ? ` · last month with coverage ${r.last_seen}` : '';
  return `<span class="act ${a.cls}" title="${escapeHtml(a.title + when)}">${a.label}</span>`;
}

const KIND_PATH: Record<Kind, string> = {
  stack: '/stacks',
  tool: '/tools',
  concept: '/concepts',
};

function toQuery(f: Filters, override: Partial<Filters> = {}): string {
  const m = { ...f, ...override };
  const p = new URLSearchParams();
  if (m.search) p.set('sq', m.search);
  for (const c of m.categories) p.append('cat', c);
  for (const h of m.have) p.append('have', h);
  if (m.seen !== 'any') p.set('seen', m.seen);
  if (m.origin !== 'any') p.set('origin', m.origin);
  if (m.sort !== 'activity') p.set('sort', m.sort);
  if (m.offset) p.set('offset', String(m.offset));
  const s = p.toString();
  const base = KIND_PATH[m.kind];
  return s ? `${base}?${s}` : base;
}

function toggled(f: Filters, key: 'categories' | 'have', value: string): string {
  const current = f[key];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return toQuery(f, { [key]: next, offset: 0 } as Partial<Filters>);
}

function activeCount(f: Filters): number {
  return f.categories.length + f.have.length + (f.search ? 1 : 0)
    + (f.seen === 'any' ? 0 : 1) + (f.origin === 'any' ? 0 : 1);
}

/**
 * The whole registry in one shot, then filtered.
 *
 * Story counts come from a lateral over stack_expand, so a parent carries the
 * weight of its subtree. Derived columns are computed in a subquery and filtered
 * outside it, because "never seen" and "has descendants" are conditions on the
 * computed values rather than on the table.
 */
async function fetchRows(
  f: Filters, mode: 'all' | 'any' = 'all',
): Promise<{ rows: RegistryRow[]; total: number }> {
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  const where: string[] = [];

  if (f.search) {
    // Every word must appear somewhere in the record, but not adjacently.
    // "message queue" as one phrase found nothing, because the entries that are
    // message queues describe themselves as "a distributed queue for messages" --
    // and requiring the exact string is substring matching wearing a search box.
    //
    // Description is in scope now that the topic import filled 1,447 of them,
    // which is what makes searching by what something IS possible at all.
    const words = f.search.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const each = words.map((word) => {
      const ref = p(`%${word}%`);
      return `(lower(name) LIKE ${ref} OR lower(slug) LIKE ${ref}
         OR lower(coalesce(description, '')) LIKE ${ref}
         OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE lower(a) LIKE ${ref}))`;
    });
    // Every word, or -- when that finds nothing -- any of them. The vocabulary
    // is described in six-word GitHub blurbs, so "message queue" matching
    // nothing is common and shrugging at it is not an answer.
    if (each.length) where.push(`(${each.join(mode === 'all' ? ' AND ' : ' OR ')})`);
  }
  where.push(`kind = ${p(f.kind)}`);
  if (f.categories.length) where.push(`category = ANY(${p(f.categories)}::text[])`);
  for (const h of f.have) {
    const def = HAVE.find((x) => x.value === h);
    if (def) where.push(def.sql);
  }
  const seen = SEEN.find((s) => s.value === f.seen);
  if (seen?.sql) where.push(seen.sql);
  const origin = ORIGINS.find((o) => o.value === f.origin);
  if (origin?.sql) where.push(origin.sql);

  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = SORTS[f.sort]?.sql ?? SORTS.activity!.sql;

  const base = `
    SELECT st.slug, st.name, st.kind, st.category, st.current_status AS status,
           p.slug AS parent, st.aliases, st.docs_url, st.repo_url, st.release_feed_url,
           (SELECT count(*) FROM stacks k WHERE k.parent_id = st.id)::int AS children,
           (st.release_feed_url IS NOT NULL AND EXISTS (
              SELECT 1 FROM sources src WHERE src.feed_url = st.release_feed_url)) AS tracked,
           st.curated, st.origin, st.discovered_at::date::text AS discovered_at,
           st.description, st.homepage_url,
           -- One line saying what it is, for the collapsed row. Wikidata
           -- writes these to disambiguate an item in a list. See 0052.
           eref.short_description AS blurb,
           -- The address this entry is FOR. Homepage first because it is where a
           -- person goes to get the thing; the repository is where they go to
           -- read how it works, which is a different errand and a poor default
           -- for a tool you are deciding whether to adopt.
           coalesce(st.homepage_url, st.repo_url, st.docs_url) AS go_url,
           gh.state AS go_state,
           gh.final_url AS go_final,
           coalesce(agg.stories, 0)::int AS stories,
           coalesce(live.recent, 0)::int AS recent,
           live.last_story::date::text AS last_story,
           -- Live status, in one derived column so the list can be sorted and
           -- filtered by it rather than by a number the reader has to interpret.
           -- The two live tiers come from whole stories, which exist for the
           -- current window; the older two come from stack_totals, so an entry
           -- last seen in 2019 still says so after its stories are gone.
           CASE
             WHEN coalesce(live.week, 0) > 0                      THEN 'hot'
             WHEN coalesce(live.recent, 0) > 0                    THEN 'active'
             WHEN agg.last_month >= date_trunc('month', now() - interval '3 months')
                                                                  THEN 'quiet'
             WHEN agg.last_month IS NOT NULL                      THEN 'dormant'
             ELSE 'unseen'
           END AS activity,
           agg.first_month::date::text AS first_seen,
           agg.last_month::date::text AS last_seen
      FROM stacks st
       LEFT JOIN entity_reference eref
              ON eref.subject_kind = 'stack' AND eref.subject_id = st.id
      LEFT JOIN stacks p ON p.id = st.parent_id
      -- All-time volume comes from stack_totals, which stitches the live months
      -- onto the rolled ones with the hierarchy already expanded. Counting the
      -- stories table directly would answer "this month" while looking exactly
      -- like it answers "ever" -- and on a registry that is mostly a curation
      -- backlog, a column of small numbers is indistinguishable from a column
      -- of honest ones.
      --
      -- Materialised rather than lateral, and the difference is not a tuning
      -- detail: the same numbers computed per row re-ran a scan of the live
      -- month once per vocabulary entry, and the page stopped answering.
      LEFT JOIN stack_totals agg ON agg.slug = st.slug
      LEFT JOIN link_health gh
        ON gh.url = coalesce(st.homepage_url, st.repo_url, st.docs_url)
      -- The last 30 days still needs day resolution, which only whole stories
      -- have, so this half stays on the stories table on purpose.
      LEFT JOIN LATERAL (
        SELECT count(*) AS recent,
               count(*) FILTER (
                 WHERE coalesce(s.published_at, s.collected_at) > now() - interval '7 days')
                 AS week,
               max(coalesce(s.published_at, s.collected_at)) AS last_story
          FROM stories s
         WHERE s.superseded_by IS NULL
           AND coalesce(s.published_at, s.collected_at) > now() - interval '30 days'
           AND s.stacks && stack_expand(ARRAY[st.slug]::text[])
      ) live ON true`;

  const [rows, counted] = await Promise.all([
    q<RegistryRow>(
      `WITH reg AS (${base}) SELECT * FROM reg ${filter} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${f.offset}`,
      params),
    q<{ n: string }>(
      `WITH reg AS (${base}) SELECT count(*)::text AS n FROM reg ${filter}`, params),
  ]);

  return { rows, total: Number(counted[0]?.n ?? 0) };
}

export async function renderRegistry(url: URL, kind: Kind = 'stack'): Promise<string> {
  const f = parse(url, kind);
  const self = KINDS.find((k) => k.id === kind)!;

  const [first, totals, kindCounts, completeness, tree, catCounts, queue, arrivals, imported]
    = await Promise.all([
    fetchRows(f),
    one<{ n: string; aliases: string; roots: string; seen: string; tracked: string;
          discovered: string; described: string }>(
      `SELECT count(*)::text AS n,
              count(description)::text AS described,
              coalesce(sum(coalesce(array_length(aliases, 1), 0)), 0)::text AS aliases,
              count(*) FILTER (WHERE parent_id IS NULL)::text AS roots,
              count(*) FILTER (WHERE NOT curated)::text AS discovered,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM stack_frequency f
                 WHERE f.slug = stacks.slug AND f.stories > 0))::text AS seen,
              count(*) FILTER (WHERE release_feed_url IS NOT NULL AND EXISTS (
                SELECT 1 FROM sources src WHERE src.feed_url = stacks.release_feed_url))::text AS tracked
         FROM stacks WHERE kind = $1`, [kind]),

    // How the three registries divide, for the switcher above the list.
    q<{ kind: string; n: string }>(
      `SELECT kind, count(*)::text AS n FROM stacks GROUP BY 1`),
    // What the registry knows about itself. An empty column is a curation
    // backlog, and a number is the only honest way to show one.
    one<Record<string, string>>(
      `SELECT count(*)::text AS total,
              count(aliases_present)::text AS aliases,
              count(repo_url)::text AS repo,
              count(release_feed_url)::text AS feed,
              count(docs_url)::text AS docs,
              count(description)::text AS description,
              count(homepage_url)::text AS homepage,
              count(changelog_url)::text AS changelog,
              count(first_release)::text AS first_release
         FROM (SELECT *, nullif(coalesce(array_length(aliases, 1), 0), 0) AS aliases_present
                 FROM stacks) x`),
    // Slug -> parent, for ancestry. 753 tiny rows, one query, and it makes the
    // full path renderable without a recursive query per row.
    q<{ slug: string; name: string; kind: Kind; parent: string | null }>(
      // Kind travels with the node. A parent of a tool is very often a concept
      // and a child of one is very often a stack, so a link built from the page
      // you happen to be on would land in the wrong registry and find nothing.
      `SELECT st.slug, st.name, st.kind, p.slug AS parent
         FROM stacks st LEFT JOIN stacks p ON p.id = st.parent_id`),
    q<{ category: string; n: string }>(
      // Scoped to the registry on screen. Offering "Languages 577" as a facet
      // of a 153-entry tool list would be counting somebody else's rows.
      `SELECT category, count(*)::text AS n FROM stacks WHERE kind = $1 GROUP BY 1`, [kind]),
    q<{ term: string; display_name: string; origin: string; mention_count: number;
        distinct_sources: number; repo_url: string | null; sample_urls: string[];
        co_stacks: string[]; last_seen_at: string }>(
      `SELECT term, display_name, origin, mention_count, distinct_sources, repo_url,
              sample_urls, co_stacks, last_seen_at::text
         FROM stack_candidates WHERE status = 'pending'
        ORDER BY mention_count DESC, last_seen_at DESC LIMIT 20`).catch(() => []),
    // What the archive itself turned up, and NOT what a bulk import loaded.
    // This asked for `curated = false`, which is not the same question: it
    // returned twelve rows of the CNCF landscape, all of them added on the day
    // the list was imported, most of them with no coverage at all -- under a
    // heading promising things the system had noticed. Coverage rides along so
    // a row that has none can say so instead of looking like news.
    q<{ slug: string; name: string; category: string; origin: string; at: string;
        stories: number; first_seen: string | null }>(
      `SELECT s.slug, s.name, s.category, s.origin, s.discovered_at::date::text AS at,
              coalesce(t.stories, 0)::int AS stories,
              t.first_month::date::text AS first_seen
         FROM stacks s LEFT JOIN stack_totals t ON t.slug = s.slug
        WHERE s.origin IN (${DISCOVERED_ORIGINS.map((o) => `'${o}'`).join(', ')})
        ORDER BY s.discovered_at DESC NULLS LAST LIMIT 12`).catch(() => []),
    // The other half of where the vocabulary comes from, counted rather than
    // listed -- an import is a fact about a file, not an event worth a feed.
    one<{ n: string; unseen: string }>(
      `SELECT count(*)::text AS n,
              count(*) FILTER (WHERE coalesce(t.stories, 0) = 0)::text AS unseen
         FROM stacks s LEFT JOIN stack_totals t ON t.slug = s.slug
        WHERE s.origin IN (${IMPORTED_ORIGINS.map((o) => `'${o}'`).join(', ')})`)
      .catch(() => null),
  ]);

  // Widen only when the tighter query found nothing, and say so when it happens.
  const multiWord = f.search.trim().split(/\s+/).filter(Boolean).length > 1;
  const widened = first.total === 0 && multiWord;
  const { rows, total } = widened ? await fetchRows(f, 'any') : first;

  const parentOf = new Map(tree.map((t) => [t.slug, t.parent]));
  const nameOf = new Map(tree.map((t) => [t.slug, t.name]));
  const catCount = new Map(catCounts.map((c) => [c.category, Number(c.n)]));
  // slug -> which of the three lists it lives in, for every cross-link below.
  const kindOf = new Map<string, Kind>(tree.map((t) => [t.slug, t.kind]));

  // Children of exactly the rows on this page: one query, not a hundred.
  const children = rows.length
    ? await q<{ parent: string; slug: string; name: string; kind: Kind }>(
      `SELECT p.slug AS parent, st.slug, st.name, st.kind
         FROM stacks st JOIN stacks p ON p.id = st.parent_id
        WHERE p.slug = ANY($1::text[]) ORDER BY st.name`,
      [rows.map((r) => r.slug)])
    : [];
  const childrenOf = new Map<string, { slug: string; name: string; kind: Kind }[]>();
  for (const c of children) {
    const list = childrenOf.get(c.parent) ?? [];
    list.push({ slug: c.slug, name: c.name, kind: c.kind });
    childrenOf.set(c.parent, list);
  }

  // Resources for exactly the rows on this page, in one query rather than a
  // hundred. A hand-written link is shown even when the check failed -- a person
  // vouched for it and this crawler produces false negatives, as four
  // documentation sites that answer a browser and refuse it proved. A DERIVED
  // link has no such vouching, so it is shown only on a confirmed answer.
  const resources = rows.length
    ? await q<Resource>(
      `SELECT stack_slug, kind, title, url, provider, origin, http_status
         FROM stack_resources
        WHERE stack_slug = ANY($1::text[])
          AND (origin = 'curated' OR http_status BETWEEN 200 AND 399)
        ORDER BY sort_order, title`,
      [rows.map((r) => r.slug)])
    : [];
  const resourcesOf = new Map<string, Resource[]>();
  for (const r of resources) {
    const list = resourcesOf.get(r.stack_slug) ?? [];
    list.push(r);
    resourcesOf.set(r.stack_slug, list);
  }

  const n = (v: string | null | undefined) => Number(v ?? 0);
  const shown = rows.length;

  const countOf = new Map(kindCounts.map((r) => [r.kind, Number(r.n)]));

  return wrap(`
    ${pageHead(self.label,
      `${self.blurb} ` +
      `${n(totals?.n).toLocaleString('en-US')} entries, ` +
      `${n(totals?.aliases).toLocaleString('en-US')} aliases resolving into them.`,
      {
        crumbs: crumbsFor(KIND_PATH[kind] ?? '/stacks', self.label),
        actions: `<a class="btn" href="/technologies">Browse by category</a>`,
      })}

    <div class="kpis">
      ${kpi({ label: self.label, value: n(totals?.n) })}
      ${kpi({ label: 'Aliases', value: n(totals?.aliases), note: 'resolve to a slug' })}
      ${kpi({
        label: 'Seen in the archive', value: n(totals?.seen),
        note: `${Math.round((n(totals?.seen) / Math.max(1, n(totals?.n))) * 100)}% of the vocabulary`,
      })}
      ${kpi({
        label: 'Polled directly', value: n(totals?.tracked),
        note: 'a source watches its release feed',
      })}
      ${kpi({
        label: 'Discovered', value: n(totals?.discovered),
        href: toQuery(f, { origin: 'discovered', offset: 0 }),
        note: 'added by the system, not by hand',
      })}
    </div>

    ${decision(url)}

    ${filterPanel(f, catCount, total)}

    <div id="reglist">
    ${widened && total > 0 ? `<p class="note">Nothing matches all of those words.
      Showing entries matching <strong>any</strong> of them.</p>` : ''}

    ${shown === 0
      ? empty(f.search
        ? `No ${self.label.toLowerCase().replace(/s$/, '')} mentions “${escapeHtml(f.search)}” —
           not in a name, an alias or a description. Only ${totals?.described ?? 0} of
           ${totals?.n ?? 0} entries here have a description at all, so searching by what
           something IS only reaches that far. ${elsewhere(f.search, kind, countOf)}`
        : `No ${self.label.toLowerCase()} match that combination.`)
      : `<div class="stacklist reg">${registryHead(f)}${rows.map((r) =>
          registryRow(r, f, parentOf, nameOf, childrenOf.get(r.slug) ?? [],
            resourcesOf.get(r.slug) ?? [], kindOf)).join('')}</div>`}

    ${pager(f, shown, total)}
    </div>

    ${growth(queue, arrivals, imported, kindOf)}

    ${addForm(kind)}

    ${completenessPanel(completeness ?? {})}
  `);
}

/**
 * Where else the thing you searched for might be.
 *
 * Splitting one list into three means a search can now fail for a new reason:
 * you looked in the wrong registry. Saying "nothing here" without saying "42 in
 * Stacks" would make the split worse than the single list it replaced.
 */
function elsewhere(search: string, kind: Kind, counts: Map<string, number>): string {
  const others = KINDS.filter((k) => k.id !== kind && (counts.get(k.id) ?? 0) > 0);
  if (!others.length) return '';
  const links = others.map((k) =>
    `<a href="${KIND_PATH[k.id]}?sq=${encodeURIComponent(search)}">${escapeHtml(k.label)}</a>`);
  return `Try ${links.join(' or ')}.`;
}

/** What just happened to a proposal, said out loud. */
function decision(url: URL): string {
  const added = url.searchParams.get('added');
  const rejected = url.searchParams.get('rejected');
  const error = url.searchParams.get('error');
  if (added) {
    return `<div class="flash">${icon('check', 16)}<span><strong>${escapeHtml(added)}</strong>
      is in the vocabulary. The recent archive has been marked for re-tagging, so stories
      already mentioning it will pick it up on the next processing pass.</span></div>`;
  }
  if (rejected) {
    return `<div class="flash" style="background:color-mix(in srgb,var(--ink-4) 12%,transparent);
      border-color:var(--line)">${icon('check', 16)}<span><strong>${escapeHtml(rejected)}</strong>
      turned down. It stays on the record, so discovery will not propose it again.</span></div>`;
  }
  if (error) return `<div class="notice"><span>${escapeHtml(error)}</span></div>`;
  return '';
}

/**
 * Adding a technology by hand.
 *
 * Discovery reads the archive and the topic index reads GitHub, and between them
 * they cover developer technology well -- but neither will ever contain
 * GoHighLevel, because it is marketing software that no tracked outlet writes
 * about and GitHub has no topic for. No amount of importing fixes that; the
 * vocabulary needs a door.
 *
 * An entry added here is marked `manual`, so the registry can still tell the
 * three provenances apart.
 */
function addForm(kind: Kind): string {
  return `<h2 class="sec">${icon('check', 14)} Add one yourself</h2>
    <p class="note">Discovery finds what the archive mentions and the topic index covers what
      GitHub knows. Anything outside both — a vendor platform, an internal tool, something too
      new to have been written about — has to be named by a person. Adding it here makes it
      searchable, filterable and taggable immediately, and the archive is re-examined for it.</p>
    <form method="post" action="/stacks" class="setgrid" style="padding:var(--s-3)">
      <div class="row" style="--row-gap:8px">
        <input class="txt" type="text" name="name" placeholder="Name, e.g. GoHighLevel" required>
        <input class="txt" type="text" name="aliases" placeholder="other spellings, comma separated, e.g. GHL">
        <select name="kind" title="Does it ship with the product, or do you operate it?">
          ${KINDS.map((k) => `<option value="${k.id}"${k.id === kind ? ' selected' : ''}>
            ${escapeHtml(k.label.replace(/s$/, ''))}</option>`).join('')}
        </select>
        <select name="category">
          ${CATEGORIES.map((c) => `<option value="${c.id}"${c.id === 'tooling' ? ' selected' : ''}>
            ${escapeHtml(c.label)}</option>`).join('')}
        </select>
        <input class="txt" type="url" name="homepage" placeholder="https://homepage (optional)"
          style="min-width:240px">
        <button class="btn primary" type="submit" name="action" value="add">Add to the vocabulary</button>
      </div>
    </form>`;
}

interface QueueRow {
  term: string;
  display_name: string;
  origin: string;
  mention_count: number;
  distinct_sources: number;
  repo_url: string | null;
  sample_urls: string[];
  co_stacks: string[];
  last_seen_at: string;
}

/**
 * The vocabulary as a living thing: what it has taken in, and what is waiting on
 * a decision.
 *
 * Only one kind of evidence promotes itself -- a repository publishing releases
 * under its own name, which is the project saying what it is called. Everything
 * mined from headlines queues, because the first run of that tier proposed
 * `techcrunch`, `spacex` and `youtube` with more repetitions behind them than
 * most real technologies had.
 */
function growth(
  queue: QueueRow[],
  arrivals: { slug: string; name: string; category: string; origin: string; at: string;
              stories: number; first_seen: string | null }[],
  imported: { n: string; unseen: string } | null,
  kindOf: Map<string, Kind>,
): string {
  const arrivalRows = arrivals.length
    ? `<div class="lst">${arrivals.map((a) => `
        <a class="row" href="${KIND_PATH[kindOf.get(a.slug) ?? 'concept']}?sq=${
          encodeURIComponent(a.slug)}">
          <span class="t">${escapeHtml(a.name)}
            <span class="muted" style="font-size:11px">${escapeHtml(category(a.category).label.toLowerCase())}
              · ${a.origin === 'github_release'
                ? 'published a release'
                : a.origin === 'repo_link' ? 'linked from a story' : 'named in headlines'}</span></span>
          <span class="n">${a.stories > 0
            ? `${a.stories.toLocaleString('en-US')} <span class="muted">${
                a.stories === 1 ? 'story' : 'stories'}</span>`
            : '<span class="muted">no coverage yet</span>'}</span>
        </a>`).join('')}</div>`
    : `<p class="note" style="margin:0">Nothing discovered yet. The pass runs with every
        processing cycle and proposes an entry the first time a project publishes a release
        under a repository the vocabulary does not know.</p>`;

  // What the imports contributed, said plainly rather than dressed as arrivals.
  const importNote = imported && Number(imported.n) > 0
    ? `<p class="note">Separately, <a href="/stacks?origin=imported&sort=newest">${
        Number(imported.n).toLocaleString('en-US')} entries</a> came from published
        vocabularies — GitHub's topic index, Linguist and the CNCF landscape — loaded in
        bulk rather than found here. ${Number(imported.unseen).toLocaleString('en-US')}
        of them have never appeared in a story, which is the normal state of a vocabulary
        entry and not a discovery. They used to be listed above, under a heading that said
        the system had noticed them.</p>`
    : '';

  const queueRows = queue.length
    ? queue.map((c) => `
      <div class="qrow">
        <div style="min-width:0">
          <div class="qname">${escapeHtml(c.display_name)}
            <span class="sl">${escapeHtml(c.term)}</span>
            <span class="chip">${escapeHtml(c.origin === 'github_release' ? 'release feed' : 'headline')}</span>
          </div>
          <div class="qev">seen in ${c.mention_count.toLocaleString('en-US')}
            ${c.mention_count === 1 ? 'story' : 'stories'} across
            ${c.distinct_sources.toLocaleString('en-US')}
            ${c.distinct_sources === 1 ? 'source' : 'sources'}
            ${c.co_stacks.length ? ` · alongside ${escapeHtml(c.co_stacks.slice(0, 4).join(', '))}` : ''}
            ${c.sample_urls[0]
              ? ` · <a href="${escapeHtml(c.sample_urls[0])}" target="_blank" rel="noreferrer">example</a>`
              : ''}</div>
        </div>
        <form method="post" action="/stacks" class="qacts">
          <input type="hidden" name="term" value="${escapeHtml(c.term)}">
          <button class="btn primary" type="submit" name="action" value="promote">Add</button>
          <button class="btn" type="submit" name="action" value="reject">Not a technology</button>
        </form>
      </div>`).join('')
    : `<p class="note" style="margin:0">The queue is empty — everything proposed has been
        decided.</p>`;

  return `<h2 class="sec">${icon('spark', 14)} A vocabulary that grows</h2>
    <p class="note">A hand-seeded list is wrong a little more every week: anything released after
      the seed was written is invisible to a system whose job is noticing new technologies.
      Discovery reads the archive for evidence. A repository publishing its own releases is a
      primary source and is added automatically; a word in a headline is a guess and waits here.</p>
    ${importNote}
    <div class="panels">
      ${panel('Found by reading the archive', arrivalRows,
        { icon: 'spark', more: { href: '/stacks?origin=discovered&sort=newest', label: 'All discovered' }, flush: arrivals.length > 0 })}
      ${panel(`Waiting on a decision${queue.length ? ` · ${queue.length}` : ''}`,
        `<div class="queue">${queueRows}</div>`, { icon: 'queue' })}
    </div>`;
}

function filterPanel(f: Filters, catCount: Map<string, number>, total: number): string {
  const active = activeCount(f);

  const cats = CATEGORIES.filter((c) => (catCount.get(c.id) ?? 0) > 0).map((c) => {
    const on = f.categories.includes(c.id);
    return `<label class="fopt${on ? ' on' : ''}" data-term="${escapeHtml(c.label.toLowerCase())} ${c.id}">
      <input type="checkbox" name="cat" value="${c.id}"${on ? ' checked' : ''}>
      <span class="fname">${escapeHtml(c.label)}</span>
      <span class="fn">${catCount.get(c.id)}</span>
    </label>`;
  }).join('');

  const have = HAVE.map((h) => {
    const on = f.have.includes(h.value);
    return `<label class="fopt${on ? ' on' : ''}">
      <input type="checkbox" name="have" value="${h.value}"${on ? ' checked' : ''}>
      <span class="fname">${escapeHtml(h.label)}</span>
    </label>`;
  }).join('');

  const pills = [
    ...f.categories.map((c) =>
      `<span class="pill on">category <b>${escapeHtml(category(c).label)}</b>
        <a href="${escapeHtml(toggled(f, 'categories', c))}" title="remove">×</a></span>`),
    ...f.have.map((h) =>
      `<span class="pill on">has <b>${escapeHtml(HAVE.find((x) => x.value === h)?.label ?? h)}</b>
        <a href="${escapeHtml(toggled(f, 'have', h))}" title="remove">×</a></span>`),
    f.seen !== 'any'
      ? `<span class="pill on">${escapeHtml(SEEN.find((s) => s.value === f.seen)?.label ?? '')}
        <a href="${escapeHtml(toQuery(f, { seen: 'any', offset: 0 }))}" title="remove">×</a></span>`
      : '',
    f.origin !== 'any'
      ? `<span class="pill on">${escapeHtml(ORIGINS.find((o) => o.value === f.origin)?.label ?? '')}
        <a href="${escapeHtml(toQuery(f, { origin: 'any', offset: 0 }))}" title="remove">×</a></span>`
      : '',
    f.search
      ? `<span class="pill on">matching <b>${escapeHtml(f.search)}</b>
        <a href="${escapeHtml(toQuery(f, { search: '', offset: 0 }))}" title="remove">×</a></span>`
      : '',
  ].filter(Boolean).join('');

  const here = KIND_PATH[f.kind];

  return `<form method="get" action="${here}" class="regsearch" data-live="${here}">
      <div class="rs-box">
        ${icon('search', 16)}
        <input type="search" name="sq" value="${escapeHtml(f.search)}"
          placeholder="Search ${total.toLocaleString('en-US')} technologies by name, slug, alias or description…"
          autocomplete="off" spellcheck="false">
        <a class="rs-clear" href="${escapeHtml(toQuery(f, { search: '', offset: 0 }))}"
          title="clear"${f.search ? '' : ' hidden'}>×</a>
      </div>
      <label for="reg-seen">Coverage</label>
      <select id="reg-seen" name="seen" onchange="this.form.submit()">
        ${SEEN.map((s) => `<option value="${s.value}"${f.seen === s.value ? ' selected' : ''}>
          ${escapeHtml(s.label)}</option>`).join('')}
      </select>
      <label for="reg-origin">Origin</label>
      <select id="reg-origin" name="origin" onchange="this.form.submit()">
        ${ORIGINS.map((o) => `<option value="${o.value}"${f.origin === o.value ? ' selected' : ''}>
          ${escapeHtml(o.label)}</option>`).join('')}
      </select>
      <label for="reg-sort">Sort</label>
      <select id="reg-sort" name="sort" onchange="this.form.submit()">
        ${Object.entries(SORTS).map(([v, o]) => `<option value="${v}"${f.sort === v ? ' selected' : ''}>
          ${escapeHtml(o.label)}</option>`).join('')}
      </select>
      ${f.categories.map((c) => `<input type="hidden" name="cat" value="${escapeHtml(c)}">`).join('')}
      ${f.have.map((h) => `<input type="hidden" name="have" value="${escapeHtml(h)}">`).join('')}
      <button class="btn primary" type="submit">Search</button>
    </form>

    <details class="refine">
      <summary>${icon('layers', 14)}<span>Refine</span>${
        active ? `<span class="on-n">${active}</span>` : ''
      }<span class="hint" id="regcount">${total.toLocaleString('en-US')} matching</span></summary>
      <form method="get" action="${here}" class="fform">
        ${f.search ? `<input type="hidden" name="sq" value="${escapeHtml(f.search)}">` : ''}
        ${f.seen !== 'any' ? `<input type="hidden" name="seen" value="${escapeHtml(f.seen)}">` : ''}
        ${f.origin !== 'any' ? `<input type="hidden" name="origin" value="${escapeHtml(f.origin)}">` : ''}
        ${f.sort !== 'activity' ? `<input type="hidden" name="sort" value="${escapeHtml(f.sort)}">` : ''}
        <div class="fgrid">
          <div class="fgroup">
            <h4>Category${f.categories.length ? `<span class="on-n">${f.categories.length}</span>` : ''}
              <span class="fcount">${CATEGORIES.length}</span></h4>
            <input class="fsearch" type="search" placeholder="filter categories…"
              aria-label="filter categories" autocomplete="off">
            <div class="fopts">${cats}<p class="fnone" hidden>Nothing matches.</p></div>
          </div>
          <div class="fgroup">
            <h4>Record has${f.have.length ? `<span class="on-n">${f.have.length}</span>` : ''}</h4>
            <div class="fopts">${have}</div>
          </div>
        </div>
        <div class="factions">
          <button class="btn primary" type="submit">Apply</button>
          <a class="btn" href="${escapeHtml(toQuery(f, { categories: [], have: [], offset: 0 }))}">Clear facets</a>
        </div>
      </form>
    </details>

    ${pills ? `<div class="pills" id="regpills">${pills}
      <a class="pill" href="${here}" style="color:var(--link)">clear all</a></div>`
      : '<div class="pills" id="regpills" hidden></div>'}`;
}

/** The full ancestry, root first. In a tree, position is most of the meaning. */
/**
 * The one-line answer to "what is this a part of".
 *
 * Django is a Python thing; Kyverno is a Kubernetes thing. That relationship is
 * the most useful fact about an entry after its name, and it was buried inside
 * a collapsed panel -- so a page of 1,361 technologies read as a flat list of
 * words, and the tree that the whole taxonomy is built on was invisible to
 * anyone who did not click.
 *
 * Rendered as the IMMEDIATE parent plus its own parent, not the full chain: the
 * root is nearly always the field, the field is already a column elsewhere, and
 * "Languages › Python" is the part that tells you something.
 */
function lineage(
  slug: string,
  parentOf: Map<string, string | null>,
  nameOf: Map<string, string>,
  kindOf: Map<string, Kind>,
): string {
  const path: string[] = [];
  let cursor = parentOf.get(slug) ?? null;
  const guard = new Set<string>([slug]);
  while (cursor && !guard.has(cursor) && path.length < 2) {
    guard.add(cursor);
    path.unshift(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  if (path.length === 0) return '<span class="muted">root</span>';
  return path.map((sl) =>
    `<a href="${KIND_PATH[kindOf.get(sl) ?? 'concept']}?sq=${encodeURIComponent(sl)}"
        title="everything under ${escapeHtml(nameOf.get(sl) ?? sl)}">${
      escapeHtml(nameOf.get(sl) ?? sl)}</a>`)
    .join('<span class="sep">›</span>');
}

function ancestry(
  slug: string,
  parentOf: Map<string, string | null>,
  nameOf: Map<string, string>,
  kindOf: Map<string, Kind>,
): string {
  const path: string[] = [];
  let cursor = parentOf.get(slug) ?? null;
  const guard = new Set<string>([slug]);
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    path.unshift(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  if (path.length === 0) return '<span class="muted">a root of the taxonomy</span>';
  return path.map((s) =>
    `<a href="${KIND_PATH[kindOf.get(s) ?? 'concept']}?sq=${encodeURIComponent(s)}">${
      escapeHtml(nameOf.get(s) ?? s)}</a>`)
    .join(' <span class="sep">›</span> ');
}

/**
 * The columns of the registry list, named once.
 *
 * This table used to exist three times: as a hand-written row of cells, as a
 * grid-template-columns in the stylesheet, and nowhere at all as a header --
 * so five of the columns were bare numbers under two-letter labels ("al",
 * "sub", "came") that only somebody who had read the markup could decode. A
 * number with no name is decoration.
 *
 * Now the header, the cells and the narrow-breakpoint hiding all come from
 * here, in this order, and eight of the twelve carry the sort they order by,
 * so the header answers "what is this number" and "show me the biggest ones"
 * with the same click. The stylesheet still owns the widths -- they are
 * arithmetic against the type scale, see theme.ts -- and tests/registry-grid
 * asserts the two counts agree.
 */
interface ColumnContext {
  cat: { label: string; color: string };
  aliases: string[];
  links: string;
  parentOf: Map<string, string | null>;
  nameOf: Map<string, string>;
  kindOf: Map<string, Kind>;
}

interface Column {
  /** Classes on the grid cell. The stylesheet aligns and sizes by these. */
  cls: string;
  /** The header, in words. Empty for the category colour swatch. */
  head: string;
  /** What the column means. Shown on hover, on the header. */
  help: string;
  /** The SORTS key it orders by, when it has one. */
  sort?: string;
  /** Survives the narrow breakpoint. Everything else gets `nw`. */
  narrow?: boolean;
  /** Right-aligned, like a column of figures. */
  right?: boolean;
  body: (r: RegistryRow, x: ColumnContext) => string;
  /** A per-row explanation, where the cell is terser than the header. */
  cellTitle?: (r: RegistryRow, x: ColumnContext) => string | undefined;
}

const COLUMNS: Column[] = [
  {
    cls: 'dotc', head: '', help: '', narrow: true,
    body: () => '',
  },
  {
    cls: 'nm', head: 'Name', sort: 'name', narrow: true,
    help: 'What it is called here, and the slug beneath it — which is its URL, '
      + 'its filter value, and the only tag a model is allowed to return',
    body: (r) => `
      <b>${escapeHtml(r.name)}</b>
      <span class="sl">${escapeHtml(r.slug)}</span>
      ${r.tracked ? `<span class="chip" title="a source polls its release feed">${icon('feed', 10)}</span>` : ''}
      ${r.curated ? '' : '<span class="chip announce" title="added by discovery, not by hand">new</span>'}`,
  },
  {
    cls: 'lin', head: 'Part of',
    help: 'The branch above it in the taxonomy — the tree this vocabulary is built on',
    body: (r, x) => lineage(r.slug, x.parentOf, x.nameOf, x.kindOf),
  },
  {
    cls: 'catcell', head: 'Kind', sort: 'category',
    help: 'Which of the categories it belongs to: a language, a database, a practice',
    body: (_r, x) => `<span class="catlabel">${escapeHtml(x.cat.label.toLowerCase())}</span>`,
  },
  {
    cls: 'actcell', head: 'Status',
    help: 'How recently the archive has seen news about it',
    body: (r) => activityBadge(r),
  },
  {
    cls: 'pth', head: 'Address', sort: 'broken', narrow: true,
    help: 'Where to actually get it, and whether that address answered when it was last checked',
    body: (r) => addressCell(r),
  },
  {
    cls: 'mini', head: 'Aliases', sort: 'aliases', right: true,
    help: 'Other spellings that resolve to this entry, so a story saying "Postgres" '
      + 'and one saying "PostgreSQL" land on the same page',
    body: (_r, x) => String(x.aliases.length || '·'),
    cellTitle: (_r, x) => x.aliases.length
      ? `${x.aliases.length} other spellings resolve here: ${x.aliases.join(', ')}`
      : 'only the exact name resolves to this entry',
  },
  {
    cls: 'mini', head: 'Beneath', sort: 'children', right: true,
    help: 'How many entries sit under it in the tree. A leaf has none',
    body: (r) => String(r.children || '·'),
    cellTitle: (r) => r.children
      ? `${r.children} entries sit under it in the tree`
      : 'a leaf — nothing sits under it',
  },
  {
    cls: 'num', head: '30 days', sort: 'activity', narrow: true, right: true,
    help: 'Stories collected about it in the last 30 days',
    body: (r) => r.recent.toLocaleString('en-US'),
    cellTitle: (r) => `${r.recent.toLocaleString('en-US')} stories in the last 30 days`,
  },
  {
    cls: 'num', head: 'All time', sort: 'stories', narrow: true, right: true,
    help: 'Every story the archive holds about it, since collection began',
    body: (r) => r.stories.toLocaleString('en-US'),
    cellTitle: (r) => `${r.stories.toLocaleString('en-US')} stories in the archive`,
  },
  {
    cls: 'mini', head: 'First', sort: 'firstseen', right: true,
    // The distinction the sort comment below makes, restated where a reader
    // meets it: this is about the technology, not about this project.
    help: 'The month it first appeared in the archive, as YY-MM — when the technology '
      + 'showed up in the news, not when somebody added the row',
    body: (r) => r.first_seen ? escapeHtml(r.first_seen.slice(2, 7)) : '·',
    cellTitle: (r) => r.first_seen
      ? `first seen in the archive in ${r.first_seen.slice(0, 7)}`
      : 'has never appeared in the archive',
  },
  {
    cls: 'lnk', head: 'Links',
    help: 'Documentation, repository and release feed, where the registry has them',
    body: (_r, x) => x.links,
  },
];

/**
 * The header. Sticky, because a label that scrolls away has explained a number
 * once and left every screenful after it unlabelled.
 */
export function registryHead(f: Filters): string {
  return `<div class="reghead">${COLUMNS.map((c) => {
    const cls = `hc${c.right ? ' r' : ''}${c.narrow ? '' : ' nw'}`;
    if (!c.head) return `<span class="${cls}"></span>`;
    if (!c.sort) {
      return `<span class="${cls}" title="${escapeHtml(c.help)}">${escapeHtml(c.head)}</span>`;
    }
    const on = f.sort === c.sort;
    return `<a class="${cls}${on ? ' on' : ''}"
      href="${escapeHtml(toQuery(f, { sort: c.sort, offset: 0 }))}"
      title="${escapeHtml(`${c.help}. Sorts by: ${SORTS[c.sort]!.label.toLowerCase()}`)}"
      ${on ? 'aria-current="true"' : ''}>${escapeHtml(c.head)}${
      on ? '<i class="sortmark" aria-hidden="true"></i>' : ''}</a>`;
  }).join('')}</div>`;
}

export function registryRow(
  r: RegistryRow,
  f: Filters,
  parentOf: Map<string, string | null>,
  nameOf: Map<string, string>,
  kids: { slug: string; name: string; kind: Kind }[],
  resources: Resource[],
  kindOf: Map<string, Kind>,
): string {
  const cat = category(r.category);
  const aliases = r.aliases.filter((a) => a.toLowerCase() !== r.slug.toLowerCase());

  const links = [
    r.docs_url ? `<a href="${escapeHtml(r.docs_url)}" target="_blank" rel="noreferrer">docs</a>` : '',
    r.repo_url ? `<a href="${escapeHtml(r.repo_url)}" target="_blank" rel="noreferrer">repo</a>` : '',
    r.release_feed_url
      ? `<a href="${escapeHtml(r.release_feed_url)}" target="_blank" rel="noreferrer">feed</a>` : '',
  ].filter(Boolean).join('');

  const detail = `
    <dl class="rec">
      ${r.description ? `<dt>What it is</dt><dd>${escapeHtml(r.description)}</dd>` : ''}
      ${learning(resources)}
      <dt>Slug</dt><dd class="mono">${escapeHtml(r.slug)}
        <span class="muted">— the URL, the filter value, and the only tag a model may return</span></dd>
      <dt>Aliases</dt><dd>${aliases.length
        ? aliases.map((a) => `<span class="chip">${escapeHtml(a)}</span>`).join(' ')
        : '<span class="muted">none — only the exact name resolves to this entry</span>'}</dd>
      <dt>Position</dt><dd>${ancestry(r.slug, parentOf, nameOf, kindOf)}</dd>
      <dt>Beneath it</dt><dd>${kids.length
        ? kids.map((k) => `<a class="chip" href="${KIND_PATH[k.kind]}?sq=${
            encodeURIComponent(k.slug)}">${escapeHtml(k.name)}</a>`).join(' ')
        : '<span class="muted">nothing — this is a leaf</span>'}</dd>
      <dt>Added</dt><dd>${addedLine(r)}</dd>
      <dt>Collection</dt><dd>${r.tracked
        ? '<span class="ok">a source polls its release feed directly</span>'
        : r.release_feed_url
          ? '<span class="muted">has a feed URL, but no source is polling it</span>'
          : '<span class="muted">picked up from coverage only — no feed of its own</span>'}</dd>
      <dt>Status</dt><dd>${activityBadge(r)}
        <span class="muted">${escapeHtml(ACTIVITY[r.activity]?.title ?? '')}</span>
        · project status recorded as <strong>${escapeHtml(r.status)}</strong></dd>
      <dt>Activity</dt><dd>${r.stories > 0
        ? `${r.stories.toLocaleString('en-US')} stories, ${r.recent.toLocaleString('en-US')} in the last 30 days` +
          (r.first_seen ? ` · first ${escapeHtml(r.first_seen)}` : '') +
          (r.last_seen ? ` · latest ${escapeHtml(r.last_seen)}` : '')
        : '<span class="muted">never seen — curated ahead of collection, which is the point of a closed vocabulary</span>'}</dd>
      <dt>Open</dt><dd class="acts">
        <a class="btn primary" href="/trend/${encodeURIComponent(r.slug)}">Full detail</a>
        <a class="btn" href="/all?stack=${encodeURIComponent(r.slug)}">News about it</a>
        <a class="btn" href="/search?q=${encodeURIComponent(r.slug)}">Search</a>
        ${/* "More <category>" means: stop looking at this one thing, show me its
              neighbours. It has to CLEAR THE SEARCH to do that.

              Reported 2026-08-29 from /stacks?sq=datab&cat=data, with Databricks
              open: the button rendered `/stacks?sq=datab&cat=data`, which is the
              page it was clicked on. Nothing happened, because setting the
              category it was already set to and keeping the term that narrowed
              the list to one row is not a change of view.

              A no-op link is worse than a missing one -- a missing button is
              understood in a moment, and a dead button gets clicked twice. */ ''}
        <a class="btn" href="${escapeHtml(toQuery(f, {
          categories: [r.category], offset: 0, search: '',
        }))}">See all ${escapeHtml(cat.label.toLowerCase())}</a>
      </dd>
    </dl>`;

  return `<details class="stackrec" style="--cat:${cat.color}">
    <summary>${COLUMNS.map((c) => {
      const title = c.cellTitle?.(r, { cat, aliases, links, parentOf, nameOf, kindOf });
      return `<span class="${c.cls}${c.narrow ? '' : ' nw'}"${
        title ? ` title="${escapeHtml(title)}"` : ''}>${
        c.body(r, { cat, aliases, links, parentOf, nameOf, kindOf })}</span>`;
    }).join('')}</summary>
    ${r.blurb ?? r.description
      ? `<div class="blurb rowblurb">${escapeHtml((r.blurb ?? r.description)!)}</div>` : ''}
    ${detail}
  </details>`;
}

const KIND_LABEL: Record<string, string> = {
  official: 'Official docs',
  tutorial: 'Tutorial',
  learning: 'Free learning',
  reference: 'Reference',
  community: 'Community',
};

const KIND_ORDER = ['official', 'tutorial', 'learning', 'reference', 'community'];

/**
 * Where to learn this.
 *
 * Three questions rather than one link, because they are different documents
 * with different audiences: the reference is complete and a poor place to start,
 * the tutorial is the way in, and the best free material is frequently not the
 * vendor's -- The Rust Book, Go by Example and MDN all beat the thing they
 * document.
 */
function learning(resources: Resource[]): string {
  if (resources.length === 0) return '';

  const byKind = new Map<string, Resource[]>();
  for (const r of resources) {
    const list = byKind.get(r.kind) ?? [];
    list.push(r);
    byKind.set(r.kind, list);
  }

  const rows = KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => {
    const links = byKind.get(kind)!.map((r) => {
      // A curated link whose check failed still shows, and says so, rather than
      // vanishing on the strength of one failed request.
      const unproven = r.origin === 'curated'
        && (r.http_status === null || r.http_status >= 400);
      return `<a class="res" href="${escapeHtml(r.url)}" target="_blank" rel="noreferrer"
        ${unproven ? 'title="this link did not answer when last checked"' : ''}>
        ${escapeHtml(r.title)}
        ${r.provider && r.provider !== 'official'
          ? `<span class="by">${escapeHtml(r.provider)}</span>` : ''}
        ${unproven ? '<span class="by warn">unverified</span>' : ''}
      </a>`;
    }).join('');
    return `<dt>${escapeHtml(KIND_LABEL[kind] ?? kind)}</dt><dd class="reslist">${links}</dd>`;
  }).join('');

  return rows;
}

function pager(f: Filters, shown: number, total: number): string {
  if (total <= PAGE) return '';
  const prev = f.offset > 0
    ? `<a href="${escapeHtml(toQuery(f, { offset: Math.max(0, f.offset - PAGE) }))}">← previous</a>`
    : '<span>← previous</span>';
  const next = f.offset + PAGE < total
    ? `<a href="${escapeHtml(toQuery(f, { offset: f.offset + PAGE }))}">next →</a>`
    : '<span>next →</span>';
  return `<div class="pager">${prev}
    <span>${(f.offset + 1).toLocaleString('en-US')}–${(f.offset + shown).toLocaleString('en-US')}
      of ${total.toLocaleString('en-US')}</span>${next}</div>`;
}

/**
 * How much of the registry is actually filled in.
 *
 * Four of these columns are empty for every row. That is not a rendering bug and
 * hiding it would make it one: it is the curation backlog, and the only way to
 * work through it is to be able to see it.
 */
function completenessPanel(c: Record<string, string>): string {
  const total = Number(c.total ?? 0) || 1;
  const fields: { key: string; label: string; note: string }[] = [
    { key: 'aliases', label: 'Aliases', note: 'what makes "k8s" resolve to Kubernetes' },
    { key: 'repo', label: 'Repository', note: 'source of the release feed' },
    { key: 'feed', label: 'Release feed', note: 'polled directly for versions' },
    { key: 'docs', label: 'Documentation', note: 'linked from every row' },
    { key: 'description', label: 'Description', note: 'not yet written for any entry' },
    { key: 'homepage', label: 'Homepage', note: 'not yet recorded' },
    { key: 'changelog', label: 'Changelog', note: 'not yet recorded' },
    { key: 'first_release', label: 'First release', note: 'would date the technology' },
  ];

  const rows = fields.map((fld) => {
    const have = Number(c[fld.key] ?? 0);
    const pct = Math.round((have / total) * 100);
    return `<div class="row">
      <span class="t">${escapeHtml(fld.label)}
        <span class="muted" style="font-size:11px">${escapeHtml(fld.note)}</span></span>
      <span class="bar"><i style="width:${pct}%"></i></span>
      <span class="n">${have.toLocaleString('en-US')} <small>${pct}%</small></span>
    </div>`;
  }).join('');

  return `<h2 class="sec">${icon('scale', 14)} Registry completeness</h2>
    <p class="note">Every entry has a slug, a name and a category — those are enforced by the schema.
      Everything below is curation, and four of them have not been started. Shown rather than hidden:
      an empty column is a backlog, and a backlog you cannot see does not get worked through.</p>
    ${panel('Populated fields', `<div class="lst">${rows}</div>`, { icon: 'table', flush: true })}`;
}

/**
 * Accept or reject a proposal.
 *
 * Runs as the application role, like the settings page: an operator surface that
 * writes has to run as the same NOBYPASSRLS role everything else does, or the
 * one place with write access is also the one place with no isolation.
 */
export async function decideCandidate(body: URLSearchParams): Promise<string> {
  const action = body.get('action') ?? '';
  const db = { query: q };

  if (action !== 'add' && !body.get('term')?.trim()) return 'error=no+term';
  const term = body.get('term')?.trim() ?? '';

  if (action === 'promote') {
    const slug = await promoteCandidate(db, term);
    return slug ? `added=${encodeURIComponent(slug)}` : 'error=not+pending';
  }
  if (action === 'add') {
    const name = body.get('name')?.trim() ?? '';
    if (!name) return 'error=a+name+is+required';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) return 'error=that+name+has+no+slug';

    const clash = await q<{ slug: string }>(
      `SELECT slug FROM stack_alias_lookup WHERE alias = $1 LIMIT 1`, [slug]);
    if (clash.length) return `error=already+known+as+${encodeURIComponent(clash[0]!.slug)}`;

    const aliases = (body.get('aliases') ?? '')
      .split(',').map((a) => a.trim()).filter(Boolean);
    const category = CATEGORIES.some((c) => c.id === body.get('category'))
      ? body.get('category')! : 'tooling';
    const kind = KINDS.some((k) => k.id === body.get('kind')) ? body.get('kind')! : 'tool';
    const homepage = body.get('homepage')?.trim() || null;

    await q(
      `INSERT INTO stacks (slug, name, aliases, category, kind, homepage_url,
                           curated, origin, discovered_at)
       VALUES ($1, $2, $3::text[], $4, $5, $6, true, 'manual', now())`,
      [slug, name, aliases, category, kind, homepage]);

    // Everything already collected has to be re-examined, or a technology added
    // today reads "never seen" while the stories mentioning it sit right there.
    await q(`UPDATE stories SET stacks_tagged_at = NULL
              WHERE superseded_by IS NULL AND collected_at > now() - interval '180 days'`);

    return `added=${encodeURIComponent(slug)}`;
  }

  if (action === 'reject') {
    const done = await rejectCandidate(db, term);
    return done ? `rejected=${encodeURIComponent(term)}` : 'error=not+pending';
  }
  return 'error=unknown+action';
}

/**
 * The URL builders, exposed for tests.
 *
 * `toQuery` decides what every facet link and every action button points at, so
 * a link that goes nowhere is a bug in this function's callers rather than in
 * the markup. See tests/registry-links.test.ts.
 */
export const __test = { toQuery, toggled };

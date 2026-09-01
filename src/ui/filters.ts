// Filter state.
//
// Every facet is a SET, not a single value: ?stack=rust&stack=go&source=LWN
// reads as "about Rust or Go, from LWN". Selecting a second value adds to the
// selection rather than replacing it, which is the whole difference between a
// filter and a switch.
//
// The state lives in the query string and nowhere else (spec 6.10). Every
// combination is therefore a shareable link, back/forward works for free, and a
// saved view is just a stored URL. There is one parser and one serializer, so
// the reader, the rail and the facet panel cannot drift apart.
//
// The STREAM is the exception, and deliberately so. News, releases and community
// are not values of one filter you would ever combine -- they are different
// reading surfaces with different rhythms -- so each has its own path, and the
// query string carries only what genuinely combines.

import type { ReadingPrefs } from '../settings.ts';
import { READING_DEFAULTS } from '../settings.ts';
import { FIELDS } from '../vocab/fields.ts';
import { CATEGORY_IDS } from './categories-vocab.ts';
import { MONEY, moneySql } from '../vocab/money.ts';

export interface Filters {
  /** Path this selection lives under: /news, /releases, /community, /all. */
  base: string;
  q: string;
  /** Reading stream: news | releases | community | all. Derived from `base`. */
  kind: string;
  source: string[];
  stack: string[];
  /**
   * What KIND of thing the news is about: a technology, a tool, a company, an
   * earning platform. One answer at a time -- "technology or company" is not a
   * question a reader asks, which is exactly why this is not a facet.
   */
  about: string;
  /**
   * Which event classes to show: launch, release, change, article.
   *
   * Empty means the default, which is EVENTS -- everything except `article`.
   * That default is the archive's whole editorial position stated as a filter:
   * it collects what happened to a technology, and writing about a technology
   * is a different thing that a reader can ask for explicitly.
   */
  kind2: string[];
  /**
   * Fields, narrowing within the ones you follow.
   *
   * This was single-valued, on the argument that "a field is a question with
   * one answer". Sat in a rail headed MY FIELDS, next to two groups that do
   * multi-select, it was not read that way: clicking Security after AI & ML
   * silently dropped AI & ML, and the reader is told the two cannot be chosen
   * together when in fact one is being thrown away.
   *
   * A reader who follows five fields and wants two of them is asking a normal
   * question. Multi-valued and unioned, exactly like `stack`.
   */
  field: string[];
  /**
   * The vocabulary's own categories: languages, frameworks, databases, and the
   * sixteen others.
   *
   * A FIELD is an area of work -- Security, Cloud, AI & ML -- and a story lands
   * in one because of what it is about. A CATEGORY is what KIND of thing the
   * technology is, which is a different question entirely: "everything about
   * databases" and "everything about security" cut the same archive along
   * different axes, and a reader wanting the first was being offered only the
   * second.
   *
   * These existed as 2,330 entries across nineteen categories, filterable on
   * the registry and nowhere else. Nothing new is imported here; what was
   * already known is simply reachable from the reader.
   */
  category: string[];
  /**
   * Months since a technology in this story was first seen anywhere.
   *
   * The page's second question, which until now was only answerable by reading
   * the rail: "what is NEW". A story about Python and a story about a tool
   * nobody had heard of last month are both news, and only one of them is news
   * about something new. Deterministic -- `stack_totals.first_month` is
   * computed from the whole archive including the rolled-up years, so it means
   * first seen EVER rather than first seen in what is currently held.
   */
  fresh: number | null;
  /** Category of the technologies a story is about: language, db, tooling… */
  type: string[];
  /** Companies the story is about. */
  company: string[];
  /** Category of those companies: chipmaker, ai-lab, hyperscaler… */
  ctype: string[];
  /** Earning platforms the story is about. */
  platform: string[];
  /** Earning channel of those platforms: freelance, creator, bounty… */
  channel: string[];
  country: string[];
  /**
   * The money lens: cost, licence, end of life.
   *
   * Not an event class and deliberately not modelled as one. A price change IS
   * a change -- the event classifier is right about that -- and it is the kind
   * of change with a number attached, which is the whole reason this archive is
   * read. Union within, like every other multi-select: cost and licence means
   * either.
   */
  money: string[];
  /**
   * An explicit published-date range, as YYYY-MM-DD, either end optional.
   *
   * Separate from `days`, which is a relative window and answers "recently".
   * These answer "that week in particular", which a relative window cannot: by
   * the time you have read the answer, "7 days ago" means a different day.
   */
  from: string;
  to: string;
  coverageMax: number | null;
  /** Only stories about a technology with at most this many stories overall. */
  rareMax: number | null;
  minImportance: number | null;
  days: number;
  /**
   * Show only what has not been opened.
   *
   * A river's second question after "what is there" is "what is new to ME",
   * and until there was a read mark the archive could not answer it. Off by
   * default: a reader arriving at a filtered page expects the filter they
   * chose, not one the site chose for them.
   */
  unread: boolean;
  sort: string;
  offset: number;
  /** Rows per page, from the operator's reading preferences. */
  pageSize: number;
  /**
   * Taxonomy roots this page is limited to, from the reading preferences.
   *
   * This is the only difference between the News section and the Explore
   * section, and it is deliberately not a filter the reader sets per page: it
   * is a standing statement about what they care about. It is applied on News
   * and never on Explore, so "where did that story go" always has the same
   * answer -- it is in Explore.
   *
   * Empty means no restriction. That is the same as all fourteen selected to a
   * query and the opposite of it to a person, which is why the default is
   * empty rather than none.
   */
  focus: string[];
  /**
   * Technologies whose releases this reader asked for, from the preferences.
   *
   * Not a filter the page sets, for the same reason `focus` is not: it is a
   * standing statement, and it is applied on News and never on Explore.
   *
   * The asymmetry with `focus` is the point. An empty `focus` means "no
   * preference, show everything"; an empty `tracked` means "no releases".
   * Reading both emptinesses the same way would put 320 repositories' patch
   * versions into the river by default, which is what made this necessary:
   * 195 releases against 1 launch and 27 changes, measured the day the release
   * feeds went in.
   */
  tracked: string[];
  /**
   * The reader asked to see past their own filter on this page.
   *
   * Separate from `focus` being empty, because those are different states that
   * a list cannot distinguish: empty means "no preference set", off means "a
   * preference exists and I am ignoring it here". Collapsing them loses the
   * off state the moment you turn a page.
   */
  focusOff: boolean;
}

export type MultiKey =
  | 'source' | 'stack' | 'type' | 'company' | 'ctype' | 'platform' | 'channel'
  | 'country' | 'kind2' | 'field' | 'money' | 'category';

export const MULTI_KEYS: MultiKey[] = [
  'source', 'stack', 'type', 'company', 'ctype', 'platform', 'channel', 'country',
  'kind2', 'field', 'money', 'category',
];

/** The stream pages, in reading order. One path each, never a filter value. */
export const STREAMS: { path: string; kind: string; label: string; icon: string; blurb: string }[] = [
  {
    path: '/news', kind: 'news', label: 'News', icon: 'stream',
    blurb: 'What happened in the fields you follow: launches, releases and changes, from every source.',
  },
  // The page's second question, given a page.
  //
  // "What happened" and "what is new" are different questions, and the second
  // one was answerable only by setting two controls. It is a stream rather than
  // a saved preset because it is defined by what the items ARE -- an event about
  // a technology this archive had never seen before this quarter -- which is
  // the same test that defines the other three.
  {
    // Called "Newcomers" and not "First seen".
    //
    // "First seen" describes the RECORD -- the month a row in stack_totals got
    // its first value -- and asks the reader to care about the archive's
    // bookkeeping. "Newcomers" describes the THINGS, which is what the page is
    // a list of. It also stays honest where the obvious alternatives do not:
    // "Emerging" and "Rising" claim momentum this measures nothing about, and
    // "Debuts" collides with `debuts?`, which eventful.ts already reads as a
    // launch verb.
    path: '/new', kind: 'new', label: 'Newcomers', icon: 'gem',
    blurb: 'Launches, releases and changes for technologies this archive had never seen '
      + 'anywhere until the last three months.',
  },
  {
    path: '/all', kind: 'all', label: 'Everything', icon: 'layers',
    blurb: 'One river, every stream, nothing held back.',
  },
];

const BY_PATH = new Map(STREAMS.map((s) => [s.path, s]));

export function streamFor(path: string): { path: string; kind: string; label: string; icon: string; blurb: string } {
  return BY_PATH.get(path) ?? STREAMS[0]!;
}

export function isStreamPath(path: string): boolean {
  return BY_PATH.has(path);
}

/**
 * Parse a reader URL.
 *
 * Preferences supply the answer only where the URL is silent -- a link someone
 * shared must render the same for everyone who opens it, so anything present in
 * the query string always wins over anything configured in /settings.
 */
export function parseFilters(url: URL, prefs: ReadingPrefs = READING_DEFAULTS): Filters {
  const n = (key: string): number | null => {
    const raw = url.searchParams.get(key);
    if (raw === null || raw === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  const many = (key: string): string[] =>
    [...new Set(url.searchParams.getAll(key).map((v) => v.trim()).filter(Boolean))];
  // Shape-checked rather than parsed: a malformed date must become "no filter",
  // not a query error and not a silent 1970.
  const date = (raw: string | null): string =>
    raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : '';

  const base = isStreamPath(url.pathname) ? url.pathname : `/${(prefs.kind === 'all' ? 'all' : prefs.kind)}`;
  const stream = streamFor(base);

  // Everything is the Explore section's page, and Explore never narrows. The
  // rule lives here rather than in the caller so that any route reaching the
  // reader gets it -- including a saved link from before the split.
  const focusOff = url.searchParams.get('focus') === 'off';
  // Everything is the Explore section's page, and Explore never narrows.
  const focus = base === '/all' || focusOff ? [] : prefs.fields;

  const min = n('min');
  const days = n('days');

  return {
    base,
    kind: stream.kind,
    q: url.searchParams.get('q')?.trim() ?? '',
    source: many('source'),
    stack: many('stack'),
    about: ABOUT.some((a) => a.value === url.searchParams.get('about'))
      ? url.searchParams.get('about')! : '',
    kind2: [...new Set(url.searchParams.getAll('kind2')
      .filter((v) => EVENT_KINDS.some((k) => k.value === v)))],
    field: [...new Set(url.searchParams.getAll('field')
      .filter((v) => FIELDS.some((x) => x.slug === v)))],
    category: [...new Set(url.searchParams.getAll('category')
      .filter((v) => CATEGORY_IDS.has(v)))],
    type: many('type'),
    company: many('company'),
    ctype: many('ctype'),
    platform: many('platform'),
    channel: many('channel'),
    country: many('country'),
    money: [...new Set(url.searchParams.getAll('money')
      .filter((v) => MONEY.some((m) => m.value === v)))],
    from: date(url.searchParams.get('from')),
    to: date(url.searchParams.get('to')),
    fresh: n('fresh'),
    coverageMax: n('coverage'),
    rareMax: n('rare'),
    minImportance: min ?? (prefs.minImportance > 0 ? prefs.minImportance : null),
    days: days ?? prefs.days,
    unread: url.searchParams.get('unread') === '1',
    sort: url.searchParams.get('sort') ?? prefs.sort,
    offset: Math.max(0, n('offset') ?? 0),
    pageSize: prefs.pageSize,
    focus,
    // Releases are a News rule. Explore is the archive and never hides a thing
    // that happened; Newcomers is about technologies the archive has just met,
    // which by definition nobody is tracking yet -- filtering it by a list of
    // things you already depend on would empty the one tab whose job is to show
    // you what you do not know.
    tracked: stream.kind === 'news' ? prefs.tracked : [],
    focusOff,
  };
}

export function toQuery(f: Filters, override: Partial<Filters> = {}): string {
  const m = { ...f, ...override };
  const p = new URLSearchParams();
  if (m.q) p.set('q', m.q);
  for (const key of MULTI_KEYS) for (const v of m[key]) p.append(key, v);
  if (m.unread) p.set('unread', '1');
  if (m.about) p.set('about', m.about);
  if (m.from) p.set('from', m.from);
  if (m.to) p.set('to', m.to);
  if (m.fresh !== null) p.set('fresh', String(m.fresh));
  if (m.coverageMax !== null) p.set('coverage', String(m.coverageMax));
  if (m.rareMax !== null) p.set('rare', String(m.rareMax));
  if (m.minImportance !== null) p.set('min', String(m.minImportance));
  if (m.days) p.set('days', String(m.days));
  if (m.sort && m.sort !== 'newest') p.set('sort', m.sort);
  if (m.offset) p.set('offset', String(m.offset));
  // Carried so that turning the focus off survives paging and re-filtering.
  // Only the "off" state is written: the on state is the preference, and
  // pinning it into every URL would freeze today's choice into saved links.
  if (m.focusOff) p.set('focus', 'off');
  const s = p.toString();
  return s ? `${m.base}?${s}` : m.base;
}

/** The same selection, read on a different stream. */
export function onStream(f: Filters, path: string): string {
  return toQuery(f, { base: path, offset: 0 });
}

/** Add a value if absent, remove it if present. Paging always resets. */
export function toggled(f: Filters, key: MultiKey, value: string): string {
  const current = f[key];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return toQuery(f, { [key]: next, offset: 0 } as Partial<Filters>);
}

export function without(f: Filters, key: MultiKey, value: string): string {
  return toQuery(f, { [key]: f[key].filter((v) => v !== value), offset: 0 } as Partial<Filters>);
}

export function isActive(f: Filters, key: MultiKey, value: string): boolean {
  return f[key].includes(value);
}

export function activeCount(f: Filters): number {
  return MULTI_KEYS.reduce((n, k) => n + f[k].length, 0)
    + (f.q ? 1 : 0)
    + (f.fresh !== null ? 1 : 0)
    + (f.coverageMax !== null ? 1 : 0)
    + (f.rareMax !== null ? 1 : 0)
    + (f.about ? 1 : 0)
    + (f.minImportance !== null ? 1 : 0)
    + (f.days ? 1 : 0)
    + (f.from ? 1 : 0) + (f.to ? 1 : 0);
}

/**
 * The event classes, in the order a reader scans them.
 *
 * `article` is last and is the one thing not shown by default. That is the
 * archive's editorial position expressed as a default rather than as a rule:
 * writing about a technology is still collected when a source is worth reading
 * for it, and it is one click away, but it is not what the list is for.
 */
export const EVENT_KINDS: { value: string; label: string; blurb: string }[] = [
  { value: 'launch', label: 'Launches', blurb: 'A thing that did not exist before now does.' },
  { value: 'release', label: 'Releases', blurb: 'A new version of something that already existed.' },
  { value: 'change', label: 'Changes', blurb: 'Deprecations, licence changes, shutdowns, advisories.' },
  { value: 'market', label: 'Market', blurb: 'Funding, acquisitions, and which way adoption is moving.' },
  { value: 'article', label: 'Articles', blurb: 'Writing about a technology rather than a report of an event.' },
];

/** Everything except `article`: what the reader shows when nothing is chosen. */
export const EVENT_DEFAULT = EVENT_KINDS.filter((k) => k.value !== 'article').map((k) => k.value);

/**
 * Toggle one event class, starting from what the rail is SHOWING as chosen.
 *
 * The plain toggled() reads `f.kind2`, which is empty when the default is in
 * force -- while the rail lights Launches, Releases and Changes, because that is
 * what the default means. So the two disagreed about the starting point, and
 * every first click on that group did something other than what it said:
 *
 *   click Articles     -- three lit entries go dark, because [] + article is
 *                         a selection of exactly one
 *   click Changes      -- a lit entry stays lit and the other two go dark, for
 *                         the same reason
 *
 * Starting from the effective set fixes both: what you see selected is what the
 * next click adds to or removes from. Turning the last one off would leave a
 * page that can hold nothing, so it returns to the default instead -- and a set
 * that IS the default is written as no parameter at all, which keeps one URL
 * for one view.
 */
export function toggledKind(f: Filters, value: string): string {
  const base = f.kind2.length ? f.kind2 : EVENT_DEFAULT;
  let next = base.includes(value) ? base.filter((v) => v !== value) : [...base, value];
  if (next.length === 0) next = EVENT_DEFAULT;
  const isDefault = next.length === EVENT_DEFAULT.length
    && EVENT_DEFAULT.every((v) => next.includes(v));
  return toQuery(f, { kind2: isDefault ? [] : next, offset: 0 });
}

/**
 * The kinds of thing news can be about.
 *
 * Single-valued and deliberately so. These sit with Sort, Window and Coverage --
 * the questions with one answer -- rather than in the Refine panel, which is for
 * facets that combine. Ticking "technology AND company" reads like a set union
 * and means nothing: every story is about a technology.
 */
export const ABOUT: { value: string; label: string; sql: string }[] = [
  { value: '', label: 'Anything', sql: '' },
  // "A technology" used to mean any tag at all, which included the editors and
  // the practices; it now means a thing that ships. `stacks.kind` carries the
  // distinction, so neither of these has to guess from a category any more --
  // the old rule read `category IN ('tooling','devops')` and so counted Argo CD
  // as a tool and Figma as not one.
  {
    value: 'tech',
    // "A technology" for `kind = 'stack'` was the registry's umbrella word used
    // for one of the three things under it, so the same filter read "Stacks" in
    // the rail and "A technology" in the dropdown. A stack is a stack.
    label: 'A stack',
    sql: `EXISTS (SELECT 1 FROM stacks k
           WHERE k.slug = ANY(s.stacks) AND k.kind = 'stack')`,
  },
  {
    value: 'tool',
    label: 'A tool',
    sql: `EXISTS (SELECT 1 FROM stacks k
           WHERE k.slug = ANY(s.stacks) AND k.kind = 'tool')`,
  },
  { value: 'company', label: 'A company', sql: `array_length(s.companies, 1) > 0` },
  { value: 'platform', label: 'A platform', sql: `array_length(s.platforms, 1) > 0` },
];

/**
 * Ordering, on PUBLICATION date.
 *
 * The date that matters is when a thing was published, not when this system
 * noticed it. Those differ by minutes for a fast feed and by hours for a slow
 * one, and sorting on collection time silently reorders the news by how often
 * we happen to poll each source -- a blog checked hourly appears to lag a blog
 * checked every fifteen minutes, which is a fact about the collector and not
 * about the world.
 *
 * coalesce, because a feed that gives no date still has to sort somewhere, and
 * the moment we saw it is the best available estimate of when it appeared.
 *
 * `velocity` is the deliberate exception: it measures how fast coverage is
 * accumulating SINCE WE STARTED WATCHING, so its denominator has to be the
 * observation window. Against publication time, a story published last year and
 * picked up today would read as having no velocity at all.
 */
const AT = 'coalesce(s.published_at, s.collected_at)';

export const SORTS: Record<string, string> = {
  newest: `${AT} DESC`,
  // The newest THING, rather than the newest story about a thing. Joined
  // through unnest rather than `t.slug = ANY(s.stacks)`, which cannot use the
  // unique index and re-scans 2,330 rows per candidate story -- the same shape
  // that made `field=languages` take 90 seconds. An array holds eight slugs at
  // most, so this is eight index lookups.
  firstseen: `(SELECT max(t.first_month) FROM unnest(s.stacks) AS st
                 JOIN stack_totals t ON t.slug = st) DESC NULLS LAST, ${AT} DESC`,
  importance: `s.importance DESC NULLS LAST, ${AT} DESC`,
  rarest: `(SELECT min(sf.stories) FROM stack_frequency sf WHERE sf.slug = ANY(s.stacks))
             ASC NULLS LAST, ${AT} DESC`,
  velocity: 's.coverage_count / GREATEST(EXTRACT(epoch FROM (now() - s.collected_at)) / 3600.0, 0.25) DESC',
  coverage: `s.coverage_count DESC, ${AT} DESC`,
};

export const SORT_LABELS: Record<string, string> = {
  newest: 'Newest first',
  firstseen: 'Newcomers first',
  importance: 'Importance',
  rarest: 'Rarest technology first',
  velocity: 'Rising fastest',
  coverage: 'Most covered',
};

/**
 * WHERE clause for the current selection.
 *
 * Sets are matched with = ANY(...), which is the difference that makes
 * multi-select real: two technologies means both, not the last one clicked.
 */
export function buildWhere(f: Filters): { sql: string; params: unknown[] } {
  // `coalesce(is_tech, true)` and not `is_tech IS NOT FALSE` for the same
  // reason either way: NULL means nobody has judged this story, and unjudged is
  // not the same as rejected. Almost the whole archive is NULL -- the
  // classifier gate has been shut since collection began -- so reading NULL as
  // "not technology" would empty the reader.
  //
  // FALSE is a decision: either the topic filter marked it (see topical.ts and
  // `npm run topics`) or the classifier did. Both mean the same thing to a
  // reader, so both are hidden here rather than in five separate pages.
  //
  // `dismissed_at IS NULL` is the third of these and the only one the reader
  // sets by hand. It is not a delete: the row stays so the rollups keep adding
  // up, and it stops being shown everywhere at once, which is what deleting
  // means to somebody reading. See src/ui/dismiss.ts and migration 0054.
  const clauses = [
    's.superseded_by IS NULL', 'coalesce(s.is_tech, true)', 's.dismissed_at IS NULL'];

  // What has not been opened. Not a default: a reader arriving at a filtered
  // page expects the filter they chose, not one the site chose for them.
  if (f.unread) clauses.push('s.read_at IS NULL');

  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;

  // Events by default; articles only when asked for.
  //
  // `event_kind IS NULL` passes either way, and that is not a loophole -- it is
  // the same rule is_tech follows. NULL means unjudged, the archive predates the
  // classifier, and reading NULL as `article` would empty every page that
  // reaches back more than a few days.
  const kinds = f.kind2.length ? f.kind2 : EVENT_DEFAULT;
  if (kinds.length < EVENT_KINDS.length) {
    clauses.push(`(s.event_kind IS NULL OR s.event_kind = ANY(${p(kinds)}::text[]))`);
  }

  // News is not a SOURCE KIND any more, and that correction is the whole point
  // of this page.
  //
  // It used to read `src.kind IN ('news','research','status')`, which excluded
  // release feeds -- so the page whose job is "what is new in the fields I
  // follow" was structurally unable to show a release. Measured at the moment
  // it was changed: 371 events visible out of 2,073, with 819 release
  // announcements and 873 research items filtered out by where they arrived
  // from rather than by what they were.
  //
  // A Rust 1.90 release is news to somebody following Languages whether it
  // came from a release feed, The Register or a vendor blog. So News is now
  // defined by what an item IS -- an event, not a prerelease -- and the other
  // streams are slices of it for anyone who wants one.
  //
  // Releases and Community were streams too, and both were defined the OLD way:
  // `src.kind = 'releases'` and `src.kind = 'community'` -- where an item
  // arrived from. Releases is now a property of the item (`event_kind`), so the
  // rail's What happened · Releases answers it better: a Rust 1.90 release
  // reported by LWN is a release, and the source-kind form could not see it
  // because LWN is not a release feed. Community was the one honest use of
  // source kind -- "who decides what appears in this feed" -- and it has no
  // sources: the registry is nine professional outlets and none of them is a
  // board. Two tabs that could hold nothing, one of them duplicating a rail
  // entry with a narrower definition.
  if (f.kind === 'news') clauses.push(`NOT s.is_prerelease`);
  // A release is only news if you depend on the thing releasing.
  //
  // Every other event class is news on its own terms: a launch is a thing that
  // did not exist, a change is a deprecation, a shutdown or an advisory, and
  // both are rare enough to read every one. Releases are neither -- 320 curated
  // repositories publish a version most days, and a page that is 195 releases,
  // 1 launch and 27 changes has buried the two classes a reader cannot afford
  // to miss under the one they can.
  //
  // So releases are shown for the technologies named in reading.tracked and for
  // nothing else. IS DISTINCT FROM rather than <>, because event_kind is NULL
  // for anything unjudged and NULL must keep passing -- reading "not yet
  // classified" as "a release" would hide the unclassified archive.
  //
  // Nothing is lost: the stories are collected, tagged, searchable, counted in
  // the archive, and on Explore. What changes is what the river shows.
  if (f.kind === 'news') {
    clauses.push(f.tracked.length
      ? `(s.event_kind IS DISTINCT FROM 'release'
           OR s.stacks && (SELECT stack_expand(${p(f.tracked)}::text[])))`
      : `s.event_kind IS DISTINCT FROM 'release'`);
  }
  else if (f.kind === 'new') {
    // News, narrowed to the technologies the archive is meeting for the first
    // time. Three months is the same window the rail's "First seen recently"
    // group uses, so the tab and the group cannot disagree about what new
    // means. The `fresh` control still narrows inside it.
    clauses.push(`NOT s.is_prerelease`);
    clauses.push(`EXISTS (SELECT 1 FROM unnest(s.stacks) AS st
                            JOIN stack_totals t ON t.slug = st
                           WHERE t.first_month >= date_trunc('month', now())
                                 - interval '2 months')`);
  }

  // Readable in English -- which is not the same as "written in English". A
  // story with a translated title qualifies, so if title translation is ever
  // switched on, the non-English archive reappears on its own rather than
  // needing this line changed back.
  clauses.push(`(s.lang = 'en' OR s.title_en IS NOT NULL)`);

  if (f.q) {
    // Full text first, so word order and stemming work, then the literal
    // fragment, because product names and version strings are exactly what
    // English stemming has never heard of.
    const term = p(f.q);
    clauses.push(`(
      to_tsvector('english',
        coalesce(s.title_en, s.title_original) || ' ' || coalesce(s.summary_en, ''))
        @@ websearch_to_tsquery('english', ${term})
      OR coalesce(s.title_en, s.title_original) ILIKE '%' || ${term} || '%'
      OR s.canonical_url ILIKE '%' || ${term} || '%')`);
  }
  if (f.source.length) clauses.push(`src.name = ANY(${p(f.source)}::text[])`);
  // The money lens, on the TITLE and nothing else -- the same rule the event
  // classifier follows, and for the same reason: the first paragraph of a
  // release note mentions pricing, and matching it turns a lens into a smear.
  // The patterns are literals from the vocabulary rather than parameters
  // because a regex is not a value: passing it as $n would make Postgres treat
  // the whole pattern as one, and there is nothing user-supplied in them.
  if (f.money.length) {
    const lens = f.money
      .map((v) => moneySql(v, 'coalesce(s.title_en, s.title_original)'))
      .filter((sql): sql is string => sql !== null);
    if (lens.length) clauses.push(`(${lens.join(' OR ')})`);
  }
  if (f.country.length) clauses.push(`s.country = ANY(${p(f.country)}::text[])`);
  // Following several stacks means the union of all their subtrees.
  //
  // Every expansion below is wrapped in a scalar subquery, and the parentheses
  // are the whole point. stack_expand() is STABLE, which lets the planner
  // choose to call it once per candidate row; an uncorrelated subquery is an
  // InitPlan, which it must run exactly once. On `field=languages` -- 668 slugs
  // beneath one root -- that is the difference between 99ms and a page that
  // does not return. 0040 made each call cheap; this makes there be one call.
  if (f.stack.length) clauses.push(`s.stacks && (SELECT stack_expand(${p(f.stack)}::text[]))`);

  // One field, chosen on this page. Narrows within the standing focus rather
  // than replacing it: picking Security while following Security and Cloud
  // shows Security, and the Cloud stories are one click away.
  // Several fields union, they do not intersect: "AI & ML and Security" means
  // stories in either, the same as two technologies mean stories about either.
  // stack_expand() takes the whole set in one call, so the closure is walked
  // once however many are chosen.
  if (f.field.length) clauses.push(`s.stacks && (SELECT stack_expand(${p(f.field)}::text[]))`);

  // The fields the reader follows, expanded through the taxonomy: choosing
  // Security gets CVEs, cryptography and identity, not only stories literally
  // tagged "security". Applied last so it narrows whatever else is selected,
  // and never present at all on Explore -- see `focus` in parseFilters.
  // Category membership is a property of the VOCABULARY, not of the taxonomy
  // tree, so this is a lookup rather than a recursive descent: every slug whose
  // category is one of the chosen ones, in a single scan of a 2,330-row table
  // that Postgres runs once for the statement.
  if (f.category.length) {
    clauses.push(`s.stacks && (SELECT coalesce(array_agg(k.slug), '{}')
                                 FROM stacks k WHERE k.category = ANY(${p(f.category)}::text[]))`);
  }

  if (f.focus.length) clauses.push(`s.stacks && (SELECT stack_expand(${p(f.focus)}::text[]))`);

  // On publication date, not collection date. "Everything from the 3rd" means
  // what was published that day; a backfilled story published in 2019 and
  // collected today would otherwise land under today.
  if (f.from) clauses.push(`coalesce(s.published_at, s.collected_at) >= ${p(f.from)}::date`);
  // Inclusive of the end day: a reader typing the same date twice means "that
  // day", and an exclusive bound would return nothing.
  if (f.to) clauses.push(`coalesce(s.published_at, s.collected_at) < ${p(f.to)}::date + 1`);

  // Type asks what KIND of thing a story is about, which is a property of the
  // technologies tagged on it rather than of the story. "Databases" is not a
  // list of slugs someone has to know in advance -- it is every entry in the
  // vocabulary whose category says so, which is what makes it worth having as a
  // filter separate from the technology facet.
  const about = ABOUT.find((a) => a.value === f.about);
  if (about?.sql) clauses.push(about.sql);

  if (f.type.length) {
    clauses.push(`EXISTS (SELECT 1 FROM stacks k
       WHERE k.slug = ANY(s.stacks) AND k.category = ANY(${p(f.type)}::text[]))`);
  }

  // Companies and platforms are tagged into arrays by their own cheap passes, so
  // both filter with an indexed overlap rather than a join. Their CATEGORIES need
  // the join, but only against 76 and 56 rows respectively.
  if (f.company.length) clauses.push(`s.companies && ${p(f.company)}::text[]`);
  if (f.ctype.length) {
    clauses.push(`EXISTS (SELECT 1 FROM companies c
       WHERE c.slug = ANY(s.companies) AND c.category = ANY(${p(f.ctype)}::text[]))`);
  }
  if (f.platform.length) clauses.push(`s.platforms && ${p(f.platform)}::text[]`);
  if (f.channel.length) {
    clauses.push(`EXISTS (SELECT 1 FROM platforms pl
       WHERE pl.slug = ANY(s.platforms) AND pl.channel_type_id = ANY(${p(f.channel)}::text[]))`);
  }
  if (f.coverageMax !== null) clauses.push(`s.coverage_count <= ${p(f.coverageMax)}`);
  // "Is this about something NEW." Same join shape and same reason as the
  // firstseen sort: through unnest, so the unique index on stack_totals(slug)
  // is used once per slug instead of the matview being scanned once per story.
  if (f.fresh !== null) {
    clauses.push(`EXISTS (SELECT 1 FROM unnest(s.stacks) AS st
                            JOIN stack_totals t ON t.slug = st
                           WHERE t.first_month >= date_trunc('month', now())
                                 - make_interval(months => ${p(f.fresh)}::int))`);
  }
  // Niche means a rarely-written-about TECHNOLOGY, not a story few outlets ran.
  // The two are different questions and this is the one a feed cannot otherwise
  // answer: the long tail of a 1,600-entry vocabulary is invisible under every
  // other ordering.
  if (f.rareMax !== null) {
    clauses.push(`EXISTS (SELECT 1 FROM stack_frequency sf
       WHERE sf.slug = ANY(s.stacks) AND sf.stories <= ${p(f.rareMax)})`);
  }
  if (f.minImportance !== null) clauses.push(`s.importance >= ${p(f.minImportance)}`);
  // Also on publication date, for the same reason the sort is: "the last 24
  // hours" should mean the news of the last day, not the backlog we happened to
  // fetch in it.
  if (f.days) clauses.push(`${AT} > now() - ${p(`${f.days} days`)}::interval`);

  return { sql: `WHERE ${clauses.join(' AND ')}`, params };
}

/**
 * What an importance score means, in words.
 *
 * The number on a row is a 0-10 judgement of CONSEQUENCE -- how much a story
 * changes what a working engineer has to do -- and nothing on the page said so:
 * a bare "8" in the margin reads as a rating, and a rating of what was anyone's
 * guess. The bands here are the ones the scorer was actually given (see the
 * importance_triage prompt in llm/jobs.ts) and the ones assignTier() splits on,
 * so the badge, the filter and the delivery tier all describe the same thing.
 *
 * null is "not scored yet", never 0. Scoring happens after classification, so a
 * story can sit unjudged for a whole cycle, and reading that as "unimportant"
 * would be the one wrong answer.
 */
export function importanceTitle(n: number | null): string {
  if (n === null) return 'not scored yet — importance is judged after classification';
  if (n >= 8) return `importance ${n} of 10 · critical — a breaking change, an exploited `
    + 'vulnerability, a shutdown or a forced migration';
  if (n >= 6) return `importance ${n} of 10 · notable — a release, a deprecation with a `
    + 'runway, or a tool with real adoption';
  if (n >= 4) return `importance ${n} of 10 · moderate — above commentary, below anything `
    + 'you must act on';
  return `importance ${n} of 10 · background — commentary, a tutorial, a funding round, `
    + 'a benchmark or an opinion';
}

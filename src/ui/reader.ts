// The reader.
//
// A chronological river grouped by day: one loud title per row, one quiet
// metadata line, a two-line summary, and the coverage sparkline that is this
// system's visual signature -- how a story spread across outlets over time,
// drawn from snapshots nothing else keeps.
//
// Filters are multi-select. Facet counts are computed under the CURRENT
// selection, so a count of zero never appears next to something clickable.

import { q, one } from './db.ts';
import { favouriteState, favouriteOne, favButton, type FavState } from './favourites.ts';
import { dismissButton } from './dismiss.ts';
import { readButton } from './readstate.ts';
import {
  escapeHtml, table, barChart, seriesTable, truncate, wrap, pageHead, empty,
  relativeTime, dayLabel, sparkline, stat, shortcutsBar, subnav, icon, type Point,
} from './html.ts';
import {
  parseFilters, toQuery, toggled, without, isActive, activeCount,
  buildWhere, SORTS, SORT_LABELS, MULTI_KEYS, STREAMS, streamFor, ABOUT,
  EVENT_KINDS, EVENT_DEFAULT, toggledKind, importanceTitle,
  type Filters, type MultiKey,
} from './filters.ts';
import { crumbsFor, backFrom } from './nav.ts';
import { railCounts, newsRailTail, unreadHere, type RailCounts } from './rail.ts';
import { railGroup, type RailItem } from './html.ts';
import { FIELDS } from '../vocab/fields.ts';
import { MONEY, moneySql } from '../vocab/money.ts';
import { CATEGORIES } from './stacks.ts';
import { READING_DEFAULTS, type ReadingPrefs } from '../settings.ts';

interface Row {
  id: string; title: string; original: string; summary: string | null;
  /** Opened at some point. Dims the row; never hides it. */
  read?: boolean;
  url: string; source: string; lang: string; country: string | null;
  coverage: number; importance: number | null; stacks: string[];
  /** When it was published, falling back to when we first saw it. */
  at: string;
  /** Whether that fallback was used, so the row can say "collected" instead. */
  dated: boolean;
  collected: string;
  prerelease: boolean; source_kind: string;
}

interface Facet { value: string; n: string }

/** Category slug to the label the catalogue already uses for it. */
const CATEGORY_LABEL: Record<string, string> =
  Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

/**
 * Name to slug, for the facets whose label and filter value differ.
 *
 * Loaded once and cached: 76 companies and 56 platforms change roughly never,
 * and looking them up per render would be a join on every page of the reader.
 */
let entityCache: { at: number; companies: Map<string, string>; platforms: Map<string, string> } | null = null;

async function entitySlugs(): Promise<{ companies: Map<string, string>; platforms: Map<string, string> }> {
  if (entityCache && Date.now() - entityCache.at < 60_000) return entityCache;
  const [companies, platforms] = await Promise.all([
    q<{ slug: string; name: string }>(`SELECT slug, name FROM companies`).catch(() => []),
    q<{ slug: string; name: string }>(`SELECT slug, name FROM platforms`).catch(() => []),
  ]);
  entityCache = {
    at: Date.now(),
    companies: new Map(companies.map((c) => [c.name, c.slug])),
    platforms: new Map(platforms.map((p) => [p.name, p.slug])),
  };
  return entityCache;
}

export interface ReaderPage {
  body: string;
  /** This section's rail. Built here because it is counts under this query. */
  rail: string;
}

// --- the News rail ----------------------------------------------------------
//
// Three axes worth browsing -- what kind of thing, which field, which
// technology -- each counted under the selection currently applied.
//
// It lives here rather than in rail.ts because the counts come from the
// reader's own WHERE clause, and a rail that disagrees with the list beside it
// is worse than no rail. But every page in this section shows it, not just the
// list: opening an article used to swap the rail for a two-entry stub, so the
// menu you were navigating by vanished at the exact moment you clicked
// something in it, and came back when you pressed Back. A sidebar that changes
// under you is a sidebar you stop trusting. See renderNewsRail below for how a
// page that is not the list gets one.

export interface NewStack {
  slug: string;
  n: string;
  first_seen: string;
}

interface RailParts {
  total: number;
  /** The same, with the field selection lifted: what "All fields" leads to. */
  totalNoField: number;
  /** Technologies whose first appearance anywhere in the archive is recent. */
  newStacks: NewStack[];
  /** Counts per event class, ignoring the event filter itself. */
  eventRow: Record<string, string> | null;
  moneyRow: Record<string, string> | null;
  stacks: Facet[];
  fieldCount: Map<string, number>;
  /**
   * Counts per vocabulary category, with the category selection lifted.
   *
   * A FIELD is an area of work; a CATEGORY is what kind of thing a technology
   * is. "Everything about databases" and "everything about security" cut the
   * same archive along different axes, and only the second was reachable from
   * the reader.
   */
  categoryCount: Map<string, number>;
  aboutRow: Record<string, string> | null;
  search: URLSearchParams;
}

/**
 * The rail, which is NOT the same on the two pages that share this renderer.
 *
 * That was the bug. News and Explore ran the same query builder and were given
 * the same menu, which made them look like one page with a filter applied --
 * and they are not. They answer different questions and the rail is where the
 * difference has to be visible, because the rail is what a reader navigates by.
 *
 *   NEWS     what happened in the fields I follow, and what is NEW.
 *            My fields, newly-appeared technologies, what happened, what I kept.
 *            This is the page a real-time notification would be built on.
 *
 *   EXPLORE  interrogate the whole archive along any axis.
 *            Type, every field, the technologies present in this selection.
 */
/**
 * The group's "everything" row: Anything, All fields.
 *
 * It looks like a sibling of the options beneath it and it is not one. Every
 * one of these filters means "all of them" when it is empty, so this row is the
 * state of having chosen NOTHING in the group -- and clicking it clears the
 * group rather than adding to it. Drawn as a checkbox it read as a fifth thing
 * to tick alongside the other four, which is why it gets `all` and not a box.
 */
function allItem(label: string, href: string, n: number, on: boolean): RailItem {
  return { href, label, count: n, active: on, sub: true, all: true };
}

function newsRail(
  f: Filters, parts: RailParts, counts: RailCounts, mode: 'news' | 'explore',
  unreadN = 0,
): string {
  const { total, totalNoField, stacks, fieldCount, categoryCount, aboutRow, newStacks } = parts;

  const fields = (f.focus.length ? FIELDS.filter((x) => f.focus.includes(x.slug)) : FIELDS)
    .map((x) => ({
      label: x.label,
      href: toggled(f, 'field', x.slug),
      n: fieldCount.get(x.slug) ?? 0,
      on: isActive(f, 'field', x.slug),
    }))
    .sort((a, b) => b.n - a.n);

  // What kind of thing the story is about, in the words the top bar uses.
  //
  // News is for new stacks, tools and platforms, and the page had no way to say
  // which of the three you meant -- the distinction existed only as Explore's
  // Type facet, phrased as "A technology" and "An earning platform". Same
  // filter, named after the tabs it corresponds to.
  const ABOUT_AS_TABS: Record<string, string> = {
    tech: 'Stacks', tool: 'Tools', platform: 'Platforms',
  };
  const kindOfThing: RailItem[] = ABOUT.filter((a) => ABOUT_AS_TABS[a.value])
    .map((a) => {
      const n = Number(aboutRow?.[a.value] ?? 0);
      const on = f.about === a.value;
      return {
        href: toQuery(f, { about: on ? '' : a.value, offset: 0 }),
        label: ABOUT_AS_TABS[a.value]!,
        count: n, active: on, sub: true, muted: n === 0 && !on,
      };
    });

  const abouts = ABOUT.filter((a) => a.sql).map((a) => ({
    label: a.label.replace(/^An? /, ''),
    href: toQuery(f, { about: f.about === a.value ? '' : a.value, offset: 0 }),
    n: Number(aboutRow?.[a.value] ?? 0),
    on: f.about === a.value,
  })).filter((x) => x.n > 0 || x.on);

  // An entry that leads to an empty page is worse than a missing one, so
  // anything at zero is not offered.
  const railItem = (
    label: string, href: string, n: number, on: boolean, muted = false,
  ): RailItem => ({ href, label, count: n, active: on, sub: true, muted });

  const typeItems: RailItem[] = [
    allItem('Anything', toQuery(f, { about: '', offset: 0 }), total, !f.about),
    ...abouts.map((a) => railItem(a.label, a.href, a.n, a.on)),
  ];

  // Explore's Field group is all fourteen, so a zero there is noise and is
  // dropped. News shows the five you follow, which is a fixed menu: an entry
  // that vanishes because the technology you just picked has nothing in it is
  // the menu losing a destination you may want to go back to.
  const fieldRows = (keepZeros: boolean) => (keepZeros ? fields : fields.filter((x) => x.n > 0 || x.on))
    .map((x) => railItem(x.label, x.href, x.n, x.on, x.n === 0 && !x.on));
  const fieldItems: RailItem[] = fields.length
    ? [
        allItem('All fields', toQuery(f, { field: [], offset: 0 }), totalNoField, !f.field.length),
        ...fieldRows(false),
      ]
    : [];

  // WHAT KIND OF THING, from the vocabulary's own nineteen categories.
  //
  // These were filterable on the registry and nowhere else, which meant the
  // reader could ask "what happened in Security" but not "what happened to
  // databases" -- and the archive knew the answer to both. Zeroes are dropped
  // for the same reason they are dropped from Explore's fields: an entry that
  // leads to an empty page is worse than a missing one.
  const categoryItems: RailItem[] = CATEGORIES
    .map((c) => ({
      label: c.label,
      href: toggled(f, 'category', c.id),
      n: categoryCount.get(c.id) ?? 0,
      on: isActive(f, 'category', c.id),
    }))
    .filter((x) => x.n > 0 || x.on)
    .sort((a, b) => b.n - a.n)
    .map((x) => railItem(x.label, x.href, x.n, x.on));

  // The technologies these stories are actually about. Not the whole 1,361-entry
  // vocabulary -- the ones present in what is on screen, most first, which is
  // the only version of this list that is short enough to read.
  const stackItems: RailItem[] = stacks.slice(0, 18).map((x) => ({
    href: toggled(f, 'stack', x.value),
    label: x.value,
    count: Number(x.n),
    active: isActive(f, 'stack', x.value),
    sub: true,
  }));

  // What happened, as the first thing in the rail -- because it is the first
  // question this archive answers. Counted WITHOUT the event filter applied, so
  // "Articles 412" is a real offer rather than a zero next to a link.
  const selected = f.kind2.length ? f.kind2 : EVENT_DEFAULT;
  // All four, always. There are exactly four kinds of thing that can happen and
  // the group is the archive's editorial position made visible; dropping the
  // empty ones made the group change SHAPE as you filtered, which reads as the
  // menu rewriting itself rather than as "nothing of that kind here".
  const kindItems: RailItem[] = EVENT_KINDS.map((k) => {
    const n = Number(parts.eventRow?.[k.value] ?? 0);
    const on = selected.includes(k.value);
    return {
      href: toggledKind(f, k.value), label: k.label, count: n, active: on,
      sub: true, muted: n === 0 && !on,
      // Releases on News are the ones you track, and a count that means
      // something narrower than its label has to say so where the number is.
      // "Releases 0" beside 195 collected releases reads as a broken page.
      note: mode === 'news' && k.value === 'release' && f.tracked.length === 0
        ? 'none tracked' : undefined,
    };
  });

  if (mode === 'explore') {
    return [
      railGroup('About', typeItems, { checkbox: true }),
      railGroup('Field', fieldItems, { checkbox: true, limit: 10 }),
      railGroup('Kind of technology', categoryItems, {
        checkbox: true, limit: 10,
        note: 'What the thing IS, rather than what area it belongs to. '
          + 'Combines with everything else.' }),
      // The long one. On a broad page this runs to a couple of hundred
      // technologies, which buries every group under it.
      railGroup('Also in these stories', stackItems, {
        checkbox: true, limit: 12,
        note: 'Everything the stories on this page are tagged with.' }),
      railGroup('What happened', kindItems, {
        checkbox: true, note: 'The four kinds of thing this archive records.' }),
      newsRailTail({ path: f.base, search: parts.search }, counts, unreadN),
    ].join('');
  }

  // Technologies whose first appearance ANYWHERE in the archive is recent --
  // computed from stack_totals.first_month, which reaches back through the
  // rolled-up years rather than only through the month of whole stories. A slug
  // first seen last month is genuinely new; one that has been in the archive
  // since 2017 is not, however many stories it has this week.
  const newItems: RailItem[] = newStacks.map((x) => ({
    href: toggled(f, 'stack', x.slug),
    label: x.slug,
    // The month it first appeared, which is the entire reason it is listed.
    // Without it the group was a list of slugs under a heading nobody could
    // check: "new" according to what, measured from when?
    note: x.first_seen,
    count: Number(x.n),
    active: isActive(f, 'stack', x.slug),
    sub: true,
  }));

  // The fields this reader follows, not all fourteen. On News the standing
  // preference IS the page; offering the other ten would be offering ten lists
  // that this page deliberately does not show.
  const mine: RailItem[] = fields.length
    ? [
        allItem('All fields', toQuery(f, { field: [], offset: 0 }), totalNoField, !f.field.length),
        ...fieldRows(true),
      ]
    : [];

  // What it costs, what it saves. Every one of these is also a `change` to the
  // event classifier, which is right and not enough: these are the changes with
  // a number attached, and they are the reason the archive is read rather than
  // skimmed.
  const moneyItems: RailItem[] = MONEY.map((m) => {
    const n = Number(parts.moneyRow?.[m.value] ?? 0);
    const on = f.money.includes(m.value);
    return {
      href: toggled(f, 'money', m.value), label: m.label, count: n, active: on,
      sub: true, muted: n === 0 && !on,
    };
  });

  return [
    railGroup('What happened', kindItems, {
      checkbox: true,
      note: 'The four kinds of thing this archive records. '
        + 'Releases appear for the technologies you track.' }),
    railGroup('Money', moneyItems, {
      checkbox: true,
      note: 'The changes with a number attached: what starts costing, what changes licence, '
        + 'and what you will have to migrate off.' }),
    railGroup('About', kindOfThing, {
      checkbox: true,
      note: 'Stacks ship. Tools are operated and never ship. Platforms are where a thing runs or is sold.' }),
    railGroup(f.focus.length ? 'My fields' : 'Fields', mine, {
      checkbox: true, limit: 10,
      note: 'Pick more than one to widen. Combined with anything else, it narrows to both.' }),
    railGroup('Kind of technology', categoryItems, {
      checkbox: true, limit: 8,
      note: 'What the thing IS: a language, a database, a framework. '
        + 'A different question from which field it belongs to.' }),
    railGroup('Newcomers', newItems, {
      limit: 8,
      note: 'Technologies this archive had never seen until the month beside them.' }),
    // No longer truncated to twelve and silently losing the rest -- the tail is
    // behind a disclosure that says how many it is holding.
    railGroup('Also in these stories', stackItems, {
      checkbox: true, limit: 12,
      note: 'Everything the stories on this page are tagged with.' }),
    newsRailTail({ path: f.base, search: parts.search }, counts, unreadN),
  ].join('');
}

/**
 * Technologies that have only just appeared.
 *
 * `stack_totals.first_month` is computed over the whole archive including the
 * rolled-up years, so "first seen in August" means first seen ever -- not
 * "first seen in the month of stories we currently hold", which would describe
 * every technology equally and mean nothing.
 *
 * Restricted to things that SHIP. `stacks.kind` separates a stack or a tool
 * from a concept, and a list of new technologies that opens with `algorithm`,
 * `protocol` and `education` is a list nobody reads twice.
 *
 * Narrowed to the reader's fields when they have any, through stack_closure --
 * a new Kubernetes operator is not news to somebody following Frontend.
 */
async function newStacksFor(f: Filters, limit = 12): Promise<NewStack[]> {
  // Counted under the page's own selection, less the one key this group
  // toggles. The number used to come from stack_totals -- a lifetime total over
  // the whole archive -- while every other number in the rail was "how many
  // stories you get if you click this". They disagreed in public:
  // `adversarial-attacks` sat in NEW TECHNOLOGIES saying 3 and in RELATED
  // STACKS saying 1, same slug, same rail, and clicking `kyverno 2` produced an
  // empty page because its two stories are articles the stream does not show.
  //
  // `stack` is excluded from the WHERE precisely because it is what these links
  // set. Leaving it in would collapse the group onto whatever is already
  // selected, which is what RELATED STACKS is for; taking it out means the
  // count is what you get having clicked, from wherever you are. Selections
  // union, so with something already chosen the real answer is only ever
  // larger.
  const { sql: where, params } = buildWhere({ ...f, stack: [] });
  return q<NewStack>(
    `WITH sel AS MATERIALIZED (
       SELECT st FROM stories s JOIN sources src ON src.id = s.source_id,
              LATERAL unnest(s.stacks) AS st ${where}
     )
     SELECT t.slug, count(*)::text AS n, to_char(t.first_month, 'Mon') AS first_seen
       FROM stack_totals t
       JOIN stacks k ON k.slug = t.slug AND k.kind IN ('stack', 'tool')
       JOIN sel ON sel.st = t.slug
      WHERE t.first_month >= date_trunc('month', now()) - interval '2 months'
        -- Still narrowed to the reader's fields through the closure, and not
        -- merely to stories that happen to be in them: a story about a
        -- Kubernetes operator can also mention a frontend build tool, and the
        -- build tool is not news to somebody following Infrastructure.
        AND ($${params.length + 1}::text[] = '{}' OR EXISTS (
              SELECT 1 FROM stack_closure c
               WHERE c.slug = ANY($${params.length + 1}::text[])
                 AND t.slug = ANY(c.members)))
      GROUP BY t.slug, t.first_month
      ORDER BY t.first_month DESC, count(*) DESC, t.slug
      LIMIT ${limit}`,
    [...params, f.focus]).catch(() => []);
}

/**
 * How new a technology has to be to count as new.
 *
 * Months, against `stack_totals.first_month`, which reaches through the
 * rolled-up years -- so "this month" means first seen EVER this month and not
 * "first seen in the stories we happen to be holding", which would describe
 * every technology in the archive equally and mean nothing.
 *
 * Three steps and no more. A slider from 1 to 24 would look more capable and
 * answer no question anybody has: the useful distinctions are "brand new",
 * "arrived this quarter" and "arrived this year".
 */
const FRESH_WITHIN: { value: string; label: string }[] = [
  { value: '', label: 'Any in this quarter' },
  { value: '0', label: 'This month' },
];

/** The counts the rail needs, and nothing the list needs. */
async function railParts(f: Filters, search: URLSearchParams): Promise<RailParts> {
  const { sql: where, params } = buildWhere(f);
  const { sql: whereNoKind, params: paramsNoKind } =
    buildWhere({ ...f, kind2: EVENT_KINDS.map((k) => k.value) });
  // Fields are counted with the FIELD filter lifted, for the same reason the
  // event classes are counted with the event filter lifted. Counted under the
  // current selection, "Security 253" next to a chosen AI & ML means "in both" --
  // while the link next to it means "in either", because fields union like every
  // other menu in this rail. A number describing one operation beside a link
  // performing another is the menu lying about where it goes.
  const { sql: whereNoField, params: paramsNoField } = buildWhere({ ...f, field: [] });
  const { sql: whereNoCategory, params: paramsNoCategory } = buildWhere({ ...f, category: [] });
  // And About, for the same reason: "Tools 12" beside a chosen Stacks would
  // mean "in both", which is not what the link next to it does.
  const { sql: whereNoAbout, params: paramsNoAbout } = buildWhere({ ...f, about: '' });
  // And the money lens, counted with itself lifted, for the third time and the
  // same reason: a number beside a link has to be what the link gives you.
  const { sql: whereNoMoney, params: paramsNoMoney } = buildWhere({ ...f, money: [] });
  const [totalRow, noFieldRow, stacks, fieldRow, categoryRow, aboutRow, eventRow, moneyRow, newStacks] =
    await Promise.all([
    one<{ n: string }>(
      `SELECT count(*)::text AS n FROM stories s JOIN sources src ON src.id = s.source_id ${where}`,
      params),
    one<{ n: string }>(
      `SELECT count(*)::text AS n FROM stories s JOIN sources src ON src.id = s.source_id ${whereNoField}`,
      paramsNoField),
    q<Facet>(
      `SELECT st AS value, count(*)::text AS n
         FROM stories s JOIN sources src ON src.id = s.source_id, LATERAL unnest(s.stacks) AS st
         -- Tie-broken by name, and the same tie-break the list uses. Without
         -- it two equal counts come back in whatever order the plan produced,
         -- so the eighteenth entry of the rail changed between the list and the
         -- article opened from it -- a menu quietly rewriting one of its own
         -- rows as you click through it.
         ${where} GROUP BY 1 ORDER BY count(*) DESC, st LIMIT 40`, params),
    // MATERIALIZED for the reason spelled out at the same query in
    // renderReader: stack_expand() in a join condition is a recursive descent
    // per story rather than per field, and it does not merely go slow.
    q<{ slug: string; n: string }>(
      `WITH sel AS MATERIALIZED (
         SELECT s.id, s.stacks FROM stories s JOIN sources src ON src.id = s.source_id ${whereNoField}
       ),
       fam AS MATERIALIZED (
         SELECT f.slug, stack_expand(ARRAY[f.slug]::text[]) AS members
           FROM unnest($${paramsNoField.length + 1}::text[]) AS f(slug)
       )
       SELECT fam.slug, count(*)::text AS n
         FROM fam JOIN sel ON sel.stacks && fam.members
        GROUP BY 1 ORDER BY count(*) DESC`,
      [...paramsNoField, FIELDS.map((x) => x.slug)]),
    // Same shape as the field counts above, and lifted for the same reason: a
    // number beside a link has to be what the link gives you, not what you are
    // already looking at.
    q<{ slug: string; n: string }>(
      `WITH sel AS MATERIALIZED (
         SELECT s.id, s.stacks FROM stories s JOIN sources src ON src.id = s.source_id ${whereNoCategory}
       ),
       cat AS MATERIALIZED (
         SELECT k.category, array_agg(k.slug) AS members
           FROM stacks k WHERE k.category IS NOT NULL GROUP BY 1
       )
       SELECT cat.category AS slug, count(*)::text AS n
         FROM cat JOIN sel ON sel.stacks && cat.members
        GROUP BY 1 ORDER BY count(*) DESC`,
      paramsNoCategory),
    one<Record<string, string>>(
      `WITH sel AS (
         SELECT s.* FROM stories s JOIN sources src ON src.id = s.source_id ${whereNoAbout}
       )
       SELECT ${ABOUT.filter((a) => a.sql)
         .map((a) => `count(*) FILTER (WHERE ${a.sql})::text AS "${a.value}"`)
         .join(', ')}
         FROM sel s`,
      paramsNoAbout),
    // Counted with the event filter REMOVED, which is the whole point of the
    // group it feeds: a rail entry offering "Articles" has to say how many
    // there are, and under the current selection that number is always zero
    // because the current selection is what excludes them.
    one<Record<string, string>>(
      `SELECT ${EVENT_KINDS.map((k) =>
        `count(*) FILTER (WHERE s.event_kind = '${k.value}')::text AS "${k.value}"`).join(', ')}
         FROM stories s JOIN sources src ON src.id = s.source_id ${whereNoKind}`,
      paramsNoKind),
    one<Record<string, string>>(
      `SELECT ${MONEY.map((m) =>
        `count(*) FILTER (WHERE ${moneySql(m.value, 'coalesce(s.title_en, s.title_original)')})::text AS "${m.value}"`).join(', ')}
         FROM stories s JOIN sources src ON src.id = s.source_id ${whereNoMoney}`,
      paramsNoMoney),
    newStacksFor(f),
  ]);

  return {
    total: Number(totalRow?.n ?? 0),
    totalNoField: Number(noFieldRow?.n ?? 0),
    eventRow,
    moneyRow,
    newStacks,
    stacks,
    fieldCount: new Map(fieldRow.map((r) => [r.slug, Number(r.n)])),
    categoryCount: new Map(categoryRow.map((r) => [r.slug, Number(r.n)])),
    aboutRow,
    search,
  };
}

// Four queries for a menu is worth it on the list, which was running them
// anyway. It is not worth it per article, so the result is held briefly and
// keyed by the exact question it answers -- reading six stories out of one list
// asks once.
const railCache = new Map<string, { at: number; html: string }>();
const RAIL_TTL_MS = 20_000;

/**
 * The News rail for a page that is not the list: an article, a story record,
 * the search results, the favourites shelf.
 *
 * `listUrl` is where the reader came FROM, so the rail is the one they were
 * just using, with the same filters lit up and the same counts. Its entries
 * link back into that list, which is the other half of the point: the rail
 * stops being a menu that only works on one page.
 */
export async function renderNewsRail(
  listUrl: URL, prefs: ReadingPrefs = READING_DEFAULTS,
): Promise<string> {
  const f = parseFilters(listUrl, prefs);

  const key = `${f.base}?${listUrl.searchParams.toString()}|${f.focus.join(',')}`;
  const hit = railCache.get(key);
  if (hit && Date.now() - hit.at < RAIL_TTL_MS) return hit.html;

  const html = newsRail(
    f, await railParts(f, listUrl.searchParams), await railCounts(),
    f.base === '/all' ? 'explore' : 'news');

  // Bounded, because the key contains a query string and a query string is
  // whatever anyone types.
  if (railCache.size > 32) railCache.clear();
  railCache.set(key, { at: Date.now(), html });
  return html;
}

export async function renderReader(
  url: URL, prefs: ReadingPrefs = READING_DEFAULTS,
): Promise<ReaderPage> {
  const f = parseFilters(url, prefs);
  const stream = streamFor(f.base);
  // The two sections share this renderer and differ in what they are FOR, so
  // they differ in what they offer. News is a river you read: the controls are
  // field, time, order, severity. Explore is an archive you interrogate: the
  // controls are which dimension, and how widely carried. Offering both sets on
  // both pages is what made every page look the same and none of them look
  // like the answer to a question.
  const mode: 'news' | 'explore' = f.base === '/all' ? 'explore' : 'news';
  const { sql: where, params } = buildWhere(f);
  const order = SORTS[f.sort] ?? SORTS.newest;
  const PAGE = f.pageSize;

  // Every WHERE variant, built before a single query runs.
  //
  // THE LIST AND ITS COUNTS MUST BE READ AT ONE MOMENT. They used to be two
  // batches with three awaits between them, and under load that is long enough
  // for the page to contradict itself: reported from a real screenshot taken
  // while 320 new sources were being tagged, the header said "4 stories" and
  // the rail beside it said "Releases 193". Neither number was wrong when it
  // was taken; they were taken a minute apart, because the tagger fills
  // `stories.stacks` asynchronously and a story is invisible to a field filter
  // until it is tagged.
  //
  // One Promise.all closes the window to the width of the slowest query. It is
  // not a snapshot -- these run on separate pooled connections, so they can
  // still differ by milliseconds -- and the honest fix for that is a
  // REPEATABLE READ transaction, which would serialise eight parallel queries
  // onto one connection and cost more page time than the defect costs
  // correctness.
  const { sql: whereNoKind, params: paramsNoKind } =
    buildWhere({ ...f, kind2: EVENT_KINDS.map((k) => k.value) });
  // See railParts: a field count has to be the count you get by clicking it.
  const { sql: whereNoField, params: paramsNoField } = buildWhere({ ...f, field: [] });
  const { sql: whereNoCategory, params: paramsNoCategory } = buildWhere({ ...f, category: [] });
  // And About, for the same reason: "Tools 12" beside a chosen Stacks would
  // mean "in both", which is not what the link next to it does.
  const { sql: whereNoAbout, params: paramsNoAbout } = buildWhere({ ...f, about: '' });
  // And the money lens, counted with itself lifted, for the third time and the
  // same reason: a number beside a link has to be what the link gives you.
  const { sql: whereNoMoney, params: paramsNoMoney } = buildWhere({ ...f, money: [] });

  const [rows, totalRow, sources, stacks, companies, platforms, countries,
         fieldRow, categoryRow, aboutRow, eventRow, moneyRow, newStacks, noFieldRow]
    = await Promise.all([
    q<Row>(
      `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title,
              s.title_original AS original, s.summary_en AS summary,
              s.canonical_url AS url, src.name AS source, s.lang::text, s.country,
              s.coverage_count AS coverage, s.importance,
              s.collected_at::text AS collected,
              coalesce(s.published_at, s.collected_at)::text AS at,
              (s.published_at IS NOT NULL) AS dated,
              s.stacks,
              s.is_prerelease AS prerelease, src.kind::text AS source_kind,
              (s.read_at IS NOT NULL) AS read
         FROM stories s JOIN sources src ON src.id = s.source_id
         ${where} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${f.offset}`, params),
    one<{ n: string }>(
      `SELECT count(*)::text AS n FROM stories s JOIN sources src ON src.id = s.source_id ${where}`,
      params),
    facet('src.name', where, params, 80),
    q<Facet>(
      `SELECT st AS value, count(*)::text AS n
         FROM stories s JOIN sources src ON src.id = s.source_id, LATERAL unnest(s.stacks) AS st
         ${where} GROUP BY 1 ORDER BY count(*) DESC, st LIMIT 120`, params),
    q<Facet>(
      `SELECT c.name AS value, count(DISTINCT s.id)::text AS n
         FROM stories s JOIN sources src ON src.id = s.source_id
         JOIN companies c ON c.slug = ANY(s.companies)
         ${where} GROUP BY 1 ORDER BY count(DISTINCT s.id) DESC LIMIT 60`, params),
    q<Facet>(
      `SELECT pl.name AS value, count(DISTINCT s.id)::text AS n
         FROM stories s JOIN sources src ON src.id = s.source_id
         JOIN platforms pl ON pl.slug = ANY(s.platforms)
         ${where} GROUP BY 1 ORDER BY count(DISTINCT s.id) DESC LIMIT 40`, params),
    facet('s.country', where, params, 40),
    // --- the counts beside the list, read in the same batch as the list -----
    // Each wraps the page's own WHERE with exactly one dimension lifted, so
    // every number in the rail is the number you get by clicking it.
    q<{ slug: string; n: string }>(
      // Both CTEs are MATERIALIZED on purpose, and the second one is the whole
      // point. Written the obvious way --
      //   JOIN sel ON sel.stacks && stack_expand(ARRAY[f.slug])
      // -- the planner calls stack_expand once per candidate row rather than
      // once per field: fourteen recursive descents of the taxonomy times every
      // story in the selection. On the community stream, 20,000 stories, that
      // stopped answering entirely rather than merely being slow.
      //
      // Expanding fourteen times into a fourteen-row table and joining on array
      // overlap is the same answer in 600ms. This is the second time this exact
      // shape has cost a page; the rule is that stack_expand() belongs in a
      // materialised CTE and never in a join condition.
      `WITH sel AS MATERIALIZED (
         SELECT s.id, s.stacks FROM stories s JOIN sources src ON src.id = s.source_id ${whereNoField}
       ),
       fam AS MATERIALIZED (
         SELECT f.slug, stack_expand(ARRAY[f.slug]::text[]) AS members
           FROM unnest($${paramsNoField.length + 1}::text[]) AS f(slug)
       )
       SELECT fam.slug, count(*)::text AS n
         FROM fam JOIN sel ON sel.stacks && fam.members
        GROUP BY 1 ORDER BY count(*) DESC`,
      [...paramsNoField, FIELDS.map((x) => x.slug)]),
    // Same shape as the field counts above, and lifted for the same reason: a
    // number beside a link has to be what the link gives you, not what you are
    // already looking at.
    q<{ slug: string; n: string }>(
      `WITH sel AS MATERIALIZED (
         SELECT s.id, s.stacks FROM stories s JOIN sources src ON src.id = s.source_id ${whereNoCategory}
       ),
       cat AS MATERIALIZED (
         SELECT k.category, array_agg(k.slug) AS members
           FROM stacks k WHERE k.category IS NOT NULL GROUP BY 1
       )
       SELECT cat.category AS slug, count(*)::text AS n
         FROM cat JOIN sel ON sel.stacks && cat.members
        GROUP BY 1 ORDER BY count(*) DESC`,
      paramsNoCategory),
    one<Record<string, string>>(
      `WITH sel AS (
         SELECT s.* FROM stories s JOIN sources src ON src.id = s.source_id ${whereNoAbout}
       )
       SELECT ${ABOUT.filter((a) => a.sql)
         .map((a) => `count(*) FILTER (WHERE ${a.sql})::text AS "${a.value}"`)
         .join(', ')}
         FROM sel s`,
      paramsNoAbout),
    one<Record<string, string>>(
      `SELECT ${EVENT_KINDS.map((k) =>
        `count(*) FILTER (WHERE s.event_kind = '${k.value}')::text AS "${k.value}"`).join(', ')}
         FROM stories s JOIN sources src ON src.id = s.source_id ${whereNoKind}`,
      paramsNoKind),
    one<Record<string, string>>(
      `SELECT ${MONEY.map((m) =>
        `count(*) FILTER (WHERE ${moneySql(m.value, 'coalesce(s.title_en, s.title_original)')})::text AS "${m.value}"`).join(', ')}
         FROM stories s JOIN sources src ON src.id = s.source_id ${whereNoMoney}`,
      paramsNoMoney),
    // Only News shows these, so only News pays for the query.
    mode === 'news' ? newStacksFor(f) : Promise.resolve([] as NewStack[]),
    f.field.length
      ? one<{ n: string }>(
          `SELECT count(*)::text AS n FROM stories s
             JOIN sources src ON src.id = s.source_id ${whereNoField}`, paramsNoField)
      // No field chosen means the count with the field lifted IS the list
      // total, and asking the database to say so again would be a query that
      // can only agree with one it already ran.
      : Promise.resolve(null),
  ]);

  const total = Number(totalRow?.n ?? 0);
  const entities = await entitySlugs();

  // What the date picker may offer. Whole stories exist for one month, so a
  // picker that let you choose last March would be a control that can only
  // return nothing -- the honest bound is what is actually held.
  const heldRow = await one<{ first: string; last: string }>(
    `SELECT to_char(min(coalesce(published_at, collected_at)), 'YYYY-MM-DD') AS first,
            to_char(max(coalesce(published_at, collected_at)), 'YYYY-MM-DD') AS last
       FROM stories WHERE superseded_by IS NULL`);
  const held = { first: heldRow?.first ?? '', last: heldRow?.last ?? '' };

  const fieldCount = new Map(fieldRow.map((r) => [r.slug, Number(r.n)]));
  const categoryCount = new Map(categoryRow.map((r) => [r.slug, Number(r.n)]));

  // Where the favourite button posts back to, so a star does not lose your place.
  const here = url.pathname + url.search;

  // Favourite state for exactly the rows on this page, in one query. Same shape
  // as the coverage curves below and for the same reason.
  const favs = await favouriteState(rows.map((r) => r.id));

  // Coverage curves for exactly the rows on this page: one query, not forty.
  const curves = new Map<string, number[]>();
  if (rows.length > 0) {
    const curveRows = await q<{ story_id: string; counts: number[] }>(
      `SELECT story_id::text, array_agg(count ORDER BY captured_at)::int[] AS counts
         FROM coverage_snapshots WHERE story_id = ANY($1::uuid[])
        GROUP BY story_id`,
      [rows.map((r) => r.id)],
    );
    for (const c of curveRows) curves.set(c.story_id, c.counts);
  }

  // The streams are PAGES, so switching stream is navigation and keeps whatever
  // you had refined; the views are pages too, and sit on their own row.
  // The streams belong to News and are offered there. Explore used to list them
  // too -- News, Releases, Community, Everything -- which put three of another
  // top-level section's pages inside this one, the same way the Stacks page
  // used to offer Tools. Explore is one river; entering it by stream is what
  // the News tab is for.
  const tabs = mode === 'explore' ? ''
    : subnav(STREAMS
          .filter((st) => st.path !== '/all')
        .map((st) => ({
          href: toQuery(f, { base: st.path, offset: 0 }),
          label: st.label, icon: st.icon, active: st.path === f.base })));

  // `hint` is not decoration. A control whose options are numbers -- 8+, 6+,
  // 4+ -- says nothing about what the number counts, and the one place a reader
  // will look for that is the control itself.
  const single = (name: string, current: string, label: string,
                  options: { value: string; label: string }[], hint?: string) =>
    `<label for="f-${name}"${hint ? ` title="${escapeHtml(hint)}"` : ''}>${escapeHtml(label)}</label>
     <select id="f-${name}" name="${name}"${hint ? ` title="${escapeHtml(hint)}"` : ''} onchange="this.form.submit()">
       ${options.map((o) => `<option value="${escapeHtml(o.value)}"${
         current === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
     </select>`;

  // Sort, window and the thresholds stay single-valued: they are questions with
  // one answer. Everything describing the CONTENT is multi-select, in Refine.
  //
  // The Window options differ by section for a reason that is easy to miss: on
  // News the archive is what RETENTION_KEEP_MONTHS holds -- two months -- so a
  // 90-day option would still be a lie, and "all time" is a real answer rather
  // than a synonym for 30 days. Explore reaches the whole rollup, where longer
  // windows mean something.
  const windows = [
    { value: '0', label: 'All time' }, { value: '1', label: '24 hours' },
    { value: '7', label: '7 days' }, { value: '30', label: '30 days' },
  ];

  // Only the fields being followed, because offering the other ten would be
  // offering ten empty lists. With no preference set, all fourteen are fair.
  const fieldChoices = (f.focus.length ? FIELDS.filter((x) => f.focus.includes(x.slug)) : FIELDS)
    .map((x) => ({ value: x.slug, label: x.label }));

  // Which outlet, as a first-class control rather than the fourth group inside a
  // collapsed panel. The list is the outlets that actually have stories under
  // the CURRENT selection, most first, so it never offers a choice that leads
  // to an empty page.
  //
  // Single-select, while `source` is a multi-value filter. That is not a
  // contradiction, it is the common case made cheap: "just Hacker News" is one
  // click here, and "these five" is what Refine is for. When Refine has been
  // used, this collapses to an honest summary rather than a dropdown that can
  // only misrepresent the selection.
  const sourceChoices = sources.slice(0, 40)
    .map((x) => ({ value: x.value, label: `${truncate(x.value, 28)} · ${
      Number(x.n).toLocaleString('en-US')}` }));

  const sourceControl = f.source.length > 1
    ? `<span class="manysel" title="${escapeHtml(f.source.join(', '))}">
         <span class="lbl">Sources</span>
         <b>${f.source.length} selected</b>
         <a href="${escapeHtml(toQuery(f, { source: [], offset: 0 }))}">clear</a>
       </span>`
    : single('source', f.source[0] ?? '', 'Source',
        [{ value: '', label: `All sources · ${total.toLocaleString('en-US')}` },
         ...sourceChoices]);

  // Every key rendered as a real INPUT above, so hidden() leaves those alone --
  // and only those. When several sources are selected the control above is a
  // static chip, not an input, so `source` has to stay in the hidden state or
  // changing the sort order would quietly drop the whole selection.
  const sourceIsAnInput = f.source.length <= 1;

  // A <select> holds one value, so it can express one field and not two. Past
  // that it becomes the same static chip the sources control becomes -- and
  // like that one it stops being an input, so the key has to go back into the
  // hidden state or changing the sort would drop the whole selection.
  const fieldIsAnInput = f.field.length <= 1;
  const fieldControl = fieldIsAnInput
    ? single('field', f.field[0] ?? '', 'Field',
        [{ value: '', label: f.focus.length ? 'All my fields' : 'Every field' },
         ...fieldChoices])
    : `<span class="manysel" title="${escapeHtml(f.field.map((v) =>
          FIELDS.find((x) => x.slug === v)?.label ?? v).join(', '))}">
         <span class="lbl">Fields</span>
         <b>${f.field.length} selected</b>
         <a href="${escapeHtml(toQuery(f, { field: [], offset: 0 }))}">clear</a>
       </span>`;

  // Two tabs, two different recencies, and each offers only the one it is about.
  //
  //   News       when the STORY appeared      -> Window
  //   Newcomers  when the TECHNOLOGY appeared -> Arrived
  //
  // Offering both on both invited reading "last 24 hours" as a statement about
  // how new the technology is, which is the one confusion this page cannot
  // afford. It also removes a control that could not do what it said: on
  // /new the stream is already the last quarter, so an Arrived option of
  // "this year" was ANDed against it and changed nothing.
  const firstSeen = f.kind === 'new';
  const asControls = new Set<string>([
    ...(sourceIsAnInput ? ['source'] : []),
    ...(mode === 'news' && fieldIsAnInput ? ['field'] : []),
    ...(mode === 'news' ? ['about'] : ['from', 'to']),
    ...(firstSeen ? ['fresh'] : []),
    ...(firstSeen ? ['days'] : []),
  ]);

  // The list already ran every count this needs, so it builds its own rail from
  // what it has rather than asking again. Every other page in the section gets
  // the same markup out of renderNewsRail().
  const [counts, unreadN] = await Promise.all([
    railCounts(),
    // The same buildWhere the list above just ran, with unread=1 added, so the
    // badge is by construction the number of rows behind its own link.
    unreadHere({ path: f.base, search: url.searchParams }, prefs),
  ]);
  const railHtml = newsRail(
    f,
    { total, totalNoField: Number(noFieldRow?.n ?? total), eventRow, moneyRow, stacks, fieldCount, categoryCount,
      aboutRow, newStacks, search: url.searchParams },
    counts, mode, unreadN);

  const controls = `<form method="get" action="${escapeHtml(f.base)}" class="row">
      ${hidden(f, asControls)}
      ${mode === 'news' && fieldChoices.length > 1 ? fieldControl : ''}
      ${mode === 'news' ? single('about', f.about, 'About',
        ABOUT.map((a) => ({ value: a.value, label: a.label }))) : ''}
      ${firstSeen ? single('fresh', f.fresh === null ? '' : String(f.fresh),
        'Arrived', FRESH_WITHIN) : ''}
      ${sourceControl}
      ${single('sort', f.sort, 'Sort',
        Object.entries(SORT_LABELS).map(([value, label]) => ({ value, label })))}
      ${firstSeen ? '' : single('days', String(f.days || 0), 'Window', windows)}
      ${mode === 'explore' ? `<label for="f-from">Dates</label>
        <input id="f-from" class="dt" type="date" name="from" value="${escapeHtml(f.from)}"
          max="${escapeHtml(f.to || held.last)}" min="${escapeHtml(held.first)}"
          onchange="this.form.submit()" aria-label="published on or after">
        <span class="dtsep">to</span>
        <input class="dt" type="date" name="to" value="${escapeHtml(f.to)}"
          min="${escapeHtml(f.from || held.first)}" max="${escapeHtml(held.last)}"
          onchange="this.form.submit()" aria-label="published on or before">` : ''}
      ${mode === 'explore'
        ? single('coverage', f.coverageMax === null ? '' : String(f.coverageMax), 'Coverage', [
            { value: '', label: 'Any' }, { value: '2', label: '≤2 outlets' },
            { value: '5', label: '≤5 outlets' }, { value: '15', label: '≤15 outlets' }])
        : ''}
      ${single('min', f.minImportance === null ? '' : String(f.minImportance), 'Importance', [
        { value: '', label: 'Any importance' },
        { value: '8', label: 'Critical 8+ — act on it' },
        { value: '6', label: 'Notable 6+ — worth knowing' },
        { value: '4', label: 'Moderate 4+ — above commentary' }],
        'How much a story changes what you do, scored 0–10 when it is classified. '
        + '8+ breaking change, exploited vulnerability, shutdown, forced migration, licence change. '
        + '6+ notable release, deprecation with a runway, a tool with real adoption. '
        + '0–3 commentary, tutorial, funding round, benchmark, opinion. '
        + 'Each option is a floor, so 6+ includes the 8s. Unscored stories are hidden.')}
      <noscript><button class="btn" type="submit">Apply</button></noscript>
    </form>`;

  const grouped = f.sort === 'newest';
  let lastDay = '';
  const river = rows.map((r) => {
    let marker = '';
    if (grouped) {
      const label = dayLabel(r.at);
      if (label !== lastDay) {
        lastDay = label;
        marker = `<div class="daymark">${escapeHtml(label)}</div>`;
      }
    }
    return marker + storyRow(r, f, here, favs.get(r.id) ?? 'none', curves.get(r.id));
  }).join('');

  const heading = f.stack.length === 1 ? f.stack[0]!
    : f.stack.length > 1 ? `${f.stack.length} technologies`
    : f.source.length === 1 ? f.source[0]!
    : f.q ? `“${f.q}”`
    : stream.label;

  // The focus filter is the one narrowing a reader did not do on this page, so
  // it is the one that most needs saying out loud. A page that quietly hides
  // most of the archive is indistinguishable from a page with no data -- and
  // the fix has to be one click, not a trip to Settings.
  const focusNote = f.focus.length
    ? `<p class="notice focus">${icon('layers', 15)}<span>
        Showing <strong>${f.focus.map((slug) =>
          escapeHtml(FIELDS.find((x) => x.slug === slug)?.label ?? slug)).join('</strong>, <strong>')}</strong>
        and everything beneath ${f.focus.length === 1 ? 'it' : 'them'}.
        <a href="${escapeHtml(toQuery(f, { focusOff: true, offset: 0 }))}">See everything here</a>
        · <a href="/all">go to Explore</a>
        · <a href="/settings#reading">change which fields you follow</a></span></p>`
    : f.focusOff
      ? `<p class="notice focus">${icon('layers', 15)}<span>
          Showing everything — the fields you follow are switched off for this page.
          <a href="${escapeHtml(toQuery(f, { focusOff: false, offset: 0 }))}">Apply them again</a></span></p>`
      : '';

  // Releases are the one class News hides by default, so News says so -- once,
  // quietly, with both ways out. A page that silently drops the most numerous
  // thing it collects is indistinguishable from a page that is broken, and the
  // reader has no way to tell which without reading the source.
  const releaseNote = mode !== 'news' ? ''
    : f.tracked.length === 0
      ? `<p class="notice focus">${icon('feed', 15)}<span>
          Releases are shown for technologies you track, and you track none yet — so this
          page is launches and changes. <a href="/settings#reading">Choose what to track</a>
          · <a href="/all?kind2=release">see every release in Explore</a></span></p>`
      : `<p class="notice focus">${icon('feed', 15)}<span>
          Releases from <strong>${f.tracked.slice(0, 6).map(escapeHtml).join('</strong>, <strong>')}</strong>${
            f.tracked.length > 6 ? ` and ${f.tracked.length - 6} more` : ''}.
          Launches and changes are shown for everything.
          <a href="/settings#reading">Change what you track</a>
          · <a href="/all?kind2=release">every release in Explore</a></span></p>`;

  // The one control that hides rows for a reason a reader cannot see on the
  // page. Every other filter tests something stored with the story; this one
  // tests a JUDGEMENT, and it is NULL until the story has been classified and
  // scored. NULL fails `importance >= n`, so choosing any floor silently drops
  // every unscored story -- which, after a reset, is all of them. The rail
  // already counts them, so saying it out loud costs no query.
  const scoreNote = f.minImportance !== null && counts.unscored > 0
    ? `<p class="notice focus">${icon('scale', 15)}<span>
        Importance is a 0–10 judgement of how much a story changes what you do —
        <strong>${counts.unscored.toLocaleString('en-US')}</strong>
        ${counts.unscored === 1 ? 'story has' : 'stories have'} not been scored yet,
        and a floor of ${f.minImportance}+ hides ${counts.unscored === 1 ? 'it' : 'them'} all.
        <a href="${escapeHtml(toQuery(f, { minImportance: null, offset: 0 }))}">Show any importance</a></span></p>`
    : '';

  // Every dimension in force gets named, because the alternative is a page that
  // says "0 stories in opentofu or oracle-cloud" while the thing that emptied it
  // -- a field chosen in the rail -- is not mentioned at all. Values inside one
  // dimension are joined with "or" and the dimensions with a comma, which is the
  // shape of the query: union within, intersection across.
  const said: string[] = [];
  if (f.field.length) {
    said.push(`in ${f.field
      .map((v) => `<strong>${escapeHtml(FIELDS.find((x) => x.slug === v)?.label ?? v)}</strong>`)
      .join(' or ')}`);
  }
  if (f.stack.length) {
    said.push(`about ${f.stack.map((v) => `<strong>${escapeHtml(v)}</strong>`).join(' or ')}`
      + ' and everything beneath');
  }
  const subtitle = `${total.toLocaleString('en-US')} ${total === 1 ? 'story' : 'stories'}`
    + (said.length ? ` ${said.join(', ')}` : '')
    + ` · ${escapeHtml((SORT_LABELS[f.sort] ?? 'newest').toLowerCase())}`;

  const body = wrap(`
    ${pageHead(heading, subtitle, {
      crumbs: crumbsFor(f.base, heading),
    })}
    <p class="note">${escapeHtml(stream.blurb)}</p>
    ${focusNote}
    ${releaseNote}
    ${scoreNote}
    <div class="filters">
      ${tabs}
      ${controls}
      ${facetPanel(f, { sources, stacks, companies, platforms, countries }, entities)}
      ${activePills(f)}
    </div>
    ${rows.length === 0
      ? empty(total === 0 && activeCount(f) === 0
          ? 'Nothing collected yet. Run <code>npm run live</code> to start.'
          : 'No stories match this combination of filters.')
      : river}
    ${pagination(f, rows.length, total)}
    ${rows.length ? shortcutsBar() : ''}
  `);

  return { body, rail: railHtml };
}

async function facet(column: string, where: string, params: unknown[], limit: number): Promise<Facet[]> {
  return q<Facet>(
    `SELECT ${column} AS value, count(*)::text AS n
       FROM stories s JOIN sources src ON src.id = s.source_id
       ${where} AND ${column} IS NOT NULL
      GROUP BY 1 ORDER BY count(*) DESC LIMIT ${limit}`, params);
}

/**
 * Carry multi-select state through the single-select form submissions.
 *
 * `asControls` names the keys this form renders as real inputs. They must be
 * left out here, or the form submits the same name twice -- once from the
 * select the reader just changed and once from a hidden input holding the old
 * value, which reads back as both being selected.
 */
function hidden(f: Filters, asControls: ReadonlySet<string> = new Set()): string {
  const parts: string[] = [];
  if (f.q) parts.push(`<input type="hidden" name="q" value="${escapeHtml(f.q)}">`);
  if (f.rareMax !== null) parts.push(`<input type="hidden" name="rare" value="${f.rareMax}">`);
  // Carried, not offered: the section that has no Field select must still not
  // silently drop one that arrived in the URL.
  if (f.from && !asControls.has('from')) {
    parts.push(`<input type="hidden" name="from" value="${escapeHtml(f.from)}">`);
  }
  if (f.to && !asControls.has('to')) {
    parts.push(`<input type="hidden" name="to" value="${escapeHtml(f.to)}">`);
  }
  // Explore renders neither of these as a control -- About lives in its rail as
  // the Type group, and First seen is a News question. Both still have to
  // survive a sort change made from Explore, or the ordering control silently
  // clears a filter set somewhere else.
  if (f.about && !asControls.has('about')) {
    parts.push(`<input type="hidden" name="about" value="${escapeHtml(f.about)}">`);
  }
  if (f.fresh !== null && !asControls.has('fresh')) {
    parts.push(`<input type="hidden" name="fresh" value="${f.fresh}">`);
  }
  if (f.focusOff) parts.push('<input type="hidden" name="focus" value="off">');
  for (const key of MULTI_KEYS) {
    if (asControls.has(key)) continue;
    for (const v of f[key]) {
      parts.push(`<input type="hidden" name="${key}" value="${escapeHtml(v)}">`);
    }
  }
  return parts.join('');
}

/**
 * The facet panel. Two ways to the same URL: click one chip to toggle a single
 * value, or open this and tick as many as you want across four dimensions. It is
 * a plain form, so it works with JavaScript disabled.
 */
function facetPanel(
  f: Filters,
  data: {
    sources: Facet[]; stacks: Facet[];
    companies: Facet[]; platforms: Facet[]; countries: Facet[];
  },
  entities: { companies: Map<string, string>; platforms: Map<string, string> },
): string {
  // Companies and platforms are filtered by SLUG and displayed by name, so the
  // group needs to know that the value it submits is not the label it shows.
  const group = (
    key: MultiKey, label: string, items: Facet[],
    rename?: (v: string) => string, valueOf?: Map<string, string>,
  ) => {
    if (items.length === 0) return '';
    // A list long enough to scroll is a list long enough to need searching. The
    // options are already on the page, so this narrows what is rendered rather
    // than asking the server again -- and a ticked option is never hidden, or
    // you would lose a selection you can no longer see.
    const search = items.length > 8
      ? `<input class="fsearch" type="search" placeholder="filter ${escapeHtml(label.toLowerCase())}…"
           aria-label="filter ${escapeHtml(label.toLowerCase())}" autocomplete="off">`
      : '';
    return `<div class="fgroup">
      <h4>${escapeHtml(label)}${f[key].length ? `<span class="on-n">${f[key].length}</span>` : ''}
        <span class="fcount">${items.length}</span></h4>
      ${search}
      <div class="fopts">${items.map((i) => {
        const on = isActive(f, key, valueOf?.get(i.value) ?? i.value);
        const label = rename ? rename(i.value) : i.value;
        const value = valueOf?.get(i.value) ?? i.value;
        return `<label class="fopt${on ? ' on' : ''}" data-term="${escapeHtml(label.toLowerCase())}">
          <input type="checkbox" name="${key}" value="${escapeHtml(value)}"${on ? ' checked' : ''}>
          <span class="fname">${escapeHtml(truncate(label, 26))}</span>
          <span class="fn">${Number(i.n).toLocaleString('en-US')}</span>
        </label>`;
      }).join('')}<p class="fnone" hidden>Nothing matches.</p></div>
    </div>`;
  };

  // Never open by default. A view arrives with a preset applied -- /niche sets a
  // rarity threshold -- and opening the panel because a filter EXISTS meant the
  // page loaded with a wall of checkboxes over the stories it was asked for. The
  // count on the summary already says filters are active; that is the job of a
  // badge, not of an open panel.
  const selected = activeCount(f);
  return `<details class="refine">
    <summary>${icon('layers', 14)}<span>Refine</span>${
      selected ? `<span class="on-n">${selected}</span>` : ''
    }<span class="hint">combine as many as you like</span></summary>
    <form method="get" action="${escapeHtml(f.base)}" class="fform">
      ${f.q ? `<input type="hidden" name="q" value="${escapeHtml(f.q)}">` : ''}
      ${f.about ? `<input type="hidden" name="about" value="${escapeHtml(f.about)}">` : ''}
      ${f.sort !== 'newest' ? `<input type="hidden" name="sort" value="${escapeHtml(f.sort)}">` : ''}
      ${f.days ? `<input type="hidden" name="days" value="${f.days}">` : ''}
      ${f.coverageMax !== null ? `<input type="hidden" name="coverage" value="${f.coverageMax}">` : ''}
      ${f.rareMax !== null ? `<input type="hidden" name="rare" value="${f.rareMax}">` : ''}
      ${f.minImportance !== null ? `<input type="hidden" name="min" value="${f.minImportance}">` : ''}
      <div class="fgrid">
        ${group('stack', 'Technology', data.stacks)}
        ${group('company', 'Company', data.companies, undefined, entities.companies)}
        ${group('platform', 'Platform', data.platforms, undefined, entities.platforms)}
        ${group('source', 'Source', data.sources)}
        ${group('country', 'Country', data.countries)}
      </div>
      <div class="factions">
        <button class="btn primary" type="submit">Apply filters</button>
        <a class="btn" href="${escapeHtml(
          toQuery({ ...f, source: [], stack: [], type: [], company: [], ctype: [],
            platform: [], channel: [], country: [], offset: 0 }))}">Clear facets</a>
      </div>
    </form>
  </details>`;
}

function activePills(f: Filters): string {
  const pills: string[] = [];
  const add = (label: string, value: string, href: string) =>
    pills.push(`<span class="pill on">${escapeHtml(label)} <b>${escapeHtml(value)}</b>
      <a href="${escapeHtml(href)}" title="remove" aria-label="remove ${escapeHtml(value)}">×</a></span>`);

  if (f.q) add('search', f.q, toQuery(f, { q: '', offset: 0 }));
  for (const v of f.stack) add('tech', v, without(f, 'stack', v));
  if (f.about) {
    add('about', ABOUT.find((a) => a.value === f.about)?.label ?? f.about,
      toQuery(f, { about: '', offset: 0 }));
  }
  for (const v of f.type) add('type', CATEGORY_LABEL[v] ?? v, without(f, 'type', v));
  for (const v of f.company) add('company', v, without(f, 'company', v));
  for (const v of f.ctype) add('company type', v, without(f, 'ctype', v));
  for (const v of f.platform) add('platform', v, without(f, 'platform', v));
  for (const v of f.channel) add('channel', v, without(f, 'channel', v));
  for (const v of f.source) add('source', truncate(v, 24), without(f, 'source', v));
  for (const v of f.country) add('country', v, without(f, 'country', v));
  if (f.coverageMax !== null) add('coverage', `≤${f.coverageMax}`, toQuery(f, { coverageMax: null, offset: 0 }));
  if (f.rareMax !== null) {
    add('rarity', `≤${f.rareMax} stories`, toQuery(f, { rareMax: null, offset: 0 }));
  }
  if (f.minImportance !== null) add('importance', `≥${f.minImportance}`, toQuery(f, { minImportance: null, offset: 0 }));
  if (f.fresh !== null) {
    add('arrived', f.fresh === 0 ? 'this month'
      : f.fresh === 11 ? 'within a year' : `within ${f.fresh + 1} months`,
      toQuery(f, { fresh: null, offset: 0 }));
  }
  if (f.days) add('window', `${f.days}d`, toQuery(f, { days: 0, offset: 0 }));
  if (f.from || f.to) {
    add('dates', f.from && f.to ? `${f.from} → ${f.to}` : f.from ? `from ${f.from}` : `to ${f.to}`,
      toQuery(f, { from: '', to: '', offset: 0 }));
  }
  for (const v of f.field) {
    add('field', FIELDS.find((x) => x.slug === v)?.label ?? v, without(f, 'field', v));
  }

  if (pills.length === 0) return '';
  return `<div class="pills">${pills.join('')}
    <a class="pill" href="${escapeHtml(toQuery({
      ...f, q: '', about: '', field: [], from: '', to: '', source: [], stack: [], type: [], company: [], ctype: [],
      platform: [], channel: [], country: [],
      fresh: null, coverageMax: null, rareMax: null, minImportance: null, days: 0, offset: 0,
    }))}" style="color:var(--link)">clear all</a></div>`;
}

/**
 * A row of filter chips with live counts.
 *
 * Chips rather than a dropdown for the two dimensions a reader actually browses
 * by. A select hides its options until you open it and tells you nothing about
 * what is behind each one; a row of chips shows the whole shape of the archive
 * at a glance -- that AI has 80 stories today and Astro has 2 is the useful
 * fact, and it is invisible in a dropdown.
 *
 * Counts are computed under the CURRENT selection, so a chip showing a number
 * always leads somewhere, and a chip showing zero is not rendered at all.
 */
function chipRow(
  label: string,
  allLabel: string,
  allHref: string,
  active: boolean,
  items: { label: string; href: string; n: number; on: boolean; hue?: number }[],
): string {
  if (items.length === 0) return '';
  return `<div class="chiprow">
    <span class="crlab">${escapeHtml(label)}</span>
    <div class="crset">
      <a class="fchip${active ? '' : ' on'}" href="${escapeHtml(allHref)}">${
        escapeHtml(allLabel)}</a>
      ${items.map((i) => `<a class="fchip${i.on ? ' on' : ''}" href="${escapeHtml(i.href)}"${
        i.hue === undefined ? '' : ` style="--hue:${i.hue}"`}>${
        i.hue === undefined ? '' : '<i class="dot"></i>'}${escapeHtml(i.label)}
        <span class="cn">${i.n.toLocaleString('en-US')}</span></a>`).join('')}
    </div>
  </div>`;
}

function storyRow(r: Row, f: Filters, here: string, fav: FavState, curve?: number[]): string {
  const critical = (r.importance ?? 0) >= 8;
  const notable = (r.importance ?? 0) >= 6;
  const stacks = r.stacks.slice(0, 3)
    .map((s) => `<a class="chip${isActive(f, 'stack', s) ? ' on' : ''}"
      href="${escapeHtml(toggled(f, 'stack', s))}">${escapeHtml(s)}</a>`).join(' ');

  // The signature element: how this story spread across outlets over time.
  const spark = curve && curve.length > 1
    ? sparkline(curve, { width: 54, height: 15, label: `coverage: ${curve.join(' → ')} outlets` })
    : '';

  return `<article class="item${critical ? ' crit' : ''}${r.read ? ' seen' : ''}">
    <div>
      <h2><a href="/story/${escapeHtml(r.id)}">${escapeHtml(r.title)}</a></h2>
      ${r.summary ? `<p class="sum">${escapeHtml(r.summary)}</p>` : ''}
      <div class="meta">
        <a class="src" href="${escapeHtml(toggled(f, 'source', r.source))}">${escapeHtml(r.source)}</a>
        <span class="dot"></span>
        <span title="${escapeHtml(r.dated
          ? `published ${r.at}`
          : `no publication date in the feed — first collected ${r.collected}`)}">${
          escapeHtml(relativeTime(r.at))}${r.dated ? '' : ' <i>seen</i>'}</span>
        ${r.country ? `<span class="dot"></span>
        <span class="lang">${escapeHtml(r.country)}</span>` : ''}
        <span class="dot"></span>
        <span title="outlets carrying this story">${r.coverage} ${r.coverage === 1 ? 'outlet' : 'outlets'}</span>
        ${r.source_kind === 'releases' ? '<span class="chip">release</span>' : ''}
        ${r.prerelease ? '<span class="chip">prerelease</span>' : ''}
        ${stacks}
        <a class="readbtn" href="/read/${escapeHtml(r.id)}" data-url="${escapeHtml(r.url)}"
          title="read the article here (v)">${icon('book', 12)}read</a>
      </div>
    </div>
    <div class="side">
      <span class="sev${critical ? ' hi' : notable ? ' mid' : ''}"
        title="${escapeHtml(importanceTitle(r.importance))}">${r.importance ?? '–'}</span>
      ${readButton(r.id, r.read ? 'read' : 'unread', here)}
      ${favButton(r.id, fav, here)}
      ${dismissButton(r.id, 'live', here)}
      ${spark}
    </div>
  </article>`;
}

function pagination(f: Filters, shown: number, total: number): string {
  if (total === 0) return '';
  const size = f.pageSize;
  const prev = f.offset > 0
    ? `<a href="${escapeHtml(toQuery(f, { offset: Math.max(0, f.offset - size) }))}">← Newer</a>`
    : '<span>← Newer</span>';
  const next = f.offset + size < total
    ? `<a href="${escapeHtml(toQuery(f, { offset: f.offset + size }))}">Older →</a>`
    : '<span>Older →</span>';
  return `<div class="pager">${prev}
    <span>${(f.offset + 1).toLocaleString('en-US')}–${(f.offset + shown).toLocaleString('en-US')}
      of ${total.toLocaleString('en-US')}</span>${next}</div>`;
}

export async function renderStory(
  id: string,
  referer: string | null = null,
): Promise<string> {
  const s = await one<{
    id: string; title: string; original: string; summary: string | null; url: string;
    source: string; source_url: string; lang: string; country: string | null;
    author: string | null; published: string | null; collected: string;
    coverage: number; importance: number | null; niche: string | null;
    novelty: string | null; depth: string | null; stacks: string[];
    body_chars: number; roles: string[]; superseded: string | null;
    source_id: string;
  }>(
    `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title,
            s.title_original AS original, s.summary_en AS summary, s.canonical_url AS url,
            src.name AS source, src.url AS source_url, s.source_id::text,
            s.lang::text, s.country, s.author,
            s.published_at::text AS published, s.collected_at::text AS collected,
            s.coverage_count AS coverage, s.importance, s.niche::text, s.novelty::text,
            s.depth::text, s.stacks, s.body_chars, src.roles::text[] AS roles,
            s.superseded_by::text AS superseded
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE s.id = $1::uuid`, [id]);

  if (!s) return wrap(pageHead('Not found', 'No story with that id.'));

  const own = s.source_id;
  const at = s.published ?? s.collected;

  const [members, aliases, curve, engagement, nearby, related] = await Promise.all([
    // One row per outlet and address, not one per sighting.
    //
    // "Also carried by" answers "who else ran this", and the answer is a set.
    // A member row was being written on every poll, so this table rendered the
    // same Register URL thirty-seven times down the page -- and even with that
    // fixed at the source, the page should not be the thing that depends on it
    // being fixed. `seen` is the FIRST sighting, which is the number this
    // column always meant.
    //
    // The story's own source is excluded, because a publisher is not another
    // outlet's coverage of itself. Those rows are real and are shown below under
    // their actual meaning -- a second address for the same item -- rather than
    // dressed up as corroboration. See 0047.
    q(`SELECT src.name AS source, m.url, min(m.match_layer) AS layer,
              min(m.seen_at)::text AS seen
         FROM story_members m JOIN sources src ON src.id = m.source_id
        WHERE m.story_id = $1::uuid AND m.source_id <> $2::uuid
        GROUP BY src.name, m.url
        ORDER BY 4`, [id, own]),

    // The same publisher at a different URL: the feed link and the page's
    // rel=canonical disagreeing, usually over a tracking parameter. Worth
    // showing because it is how the same article came to be stored eight times
    // in one morning, and worth showing HERE rather than under coverage.
    q<{ url: string; seen: string }>(
      `SELECT m.url, min(m.seen_at)::text AS seen
         FROM story_members m
        WHERE m.story_id = $1::uuid AND m.source_id = $2::uuid
        GROUP BY m.url ORDER BY 2`, [id, own]),
    q<{ label: string; count: number; at: string }>(
      `SELECT offset_label AS label, count, captured_at::text AS at
         FROM coverage_snapshots WHERE story_id = $1::uuid ORDER BY captured_at`, [id]),
    q(`SELECT engagement_type::text AS type, value, offset_label AS at_offset,
              captured_at::text AS captured
         FROM engagement_snapshots WHERE story_id = $1::uuid ORDER BY captured_at`, [id]),

    // WHAT THIS PAGE IS FOR
    //
    // A changelog entry is one line long. Reproducing that line under a heading,
    // beside four scores and a chart of a single number, is a worse version of
    // the publisher's own page -- which is a fair description of what this was.
    //
    // What this archive holds and the publisher's page does not is everything
    // AROUND the entry: the same product's previous and next changes, and the
    // same technology as other people shipped it. "The Realtime API went GA"
    // matters differently if it was repriced last week, and that is a question
    // only something holding both can answer.
    //
    // Both queries are bounded and indexed -- stories_source_idx and the GIN
    // stories_stacks_idx -- and run inside the Promise.all that was already
    // here, so the page costs the same round trip it did before.
    q<{ id: string; title: string; at: string; side: string }>(
      `(SELECT id::text, coalesce(title_en, title_original) AS title,
               coalesce(published_at, collected_at)::text AS at, 'earlier' AS side
          FROM stories
         WHERE source_id = $2::uuid AND superseded_by IS NULL AND id <> $1::uuid
           AND coalesce(published_at, collected_at) <= $3::timestamptz
         ORDER BY coalesce(published_at, collected_at) DESC LIMIT 4)
       UNION ALL
       (SELECT id::text, coalesce(title_en, title_original),
               coalesce(published_at, collected_at)::text, 'later'
          FROM stories
         WHERE source_id = $2::uuid AND superseded_by IS NULL AND id <> $1::uuid
           AND coalesce(published_at, collected_at) > $3::timestamptz
         ORDER BY coalesce(published_at, collected_at) ASC LIMIT 3)`, [id, own, at]),

    // ONE SHARED TAG IS NOT A RELATIONSHIP.
    //
    // Matching on `stacks && stacks` returned, for a story tagged `openai` and
    // `api`: an Amazon Cognito TOTP endpoint, a Bind vulnerability notice and an
    // Apigee point release. Every one of them a correct match on `api`, and not
    // one of them related to anything. A section like that is worse than no
    // section -- it teaches the reader that the page's suggestions are noise.
    //
    // Inverse document frequency was the obvious reach and it does not help at
    // this corpus size: `api` sits on 41 of 543 stories, which IDF scores as
    // perfectly discriminating. The tag is not rare, it is BROAD, and rarity
    // does not measure breadth.
    //
    // So the requirement is agreement rather than weighting: share at least two
    // tags where the story has two to share. `openai` + `api` then means other
    // OpenAI API stories, not everything with an endpoint. It returns nothing
    // fairly often, and the section hides itself when it does -- an empty space
    // being the honest rendering of "nothing here is related".
    s.stacks.length
      ? q<{ id: string; title: string; source: string; at: string; shared: number }>(
        `SELECT * FROM (
           SELECT s.id::text AS id, coalesce(s.title_en, s.title_original) AS title,
                  src.name AS source,
                  coalesce(s.published_at, s.collected_at)::text AS at,
                  cardinality(ARRAY(SELECT unnest(s.stacks)
                                    INTERSECT SELECT unnest($2::text[]))) AS shared
             FROM stories s JOIN sources src ON src.id = s.source_id
            WHERE s.superseded_by IS NULL AND s.id <> $1::uuid
              AND s.stacks && $2::text[] AND s.source_id <> $3::uuid
         ) r
         WHERE r.shared >= $4::int
         ORDER BY r.shared DESC, r.at DESC
         LIMIT 6`,
        [id, s.stacks, own, Math.min(2, s.stacks.length)])
      : Promise.resolve([]),
  ]);

  const points: Point[] = curve.map((c) => ({
    label: c.label, value: Number(c.count),
    title: `${c.label}: ${c.count} outlets (${c.at.slice(0, 16)})`,
  }));

  // A chart of one number is not a chart.
  //
  // The curve exists to show how a story SPREAD -- one outlet at +1h, nine by
  // +24h is the shape worth a picture. A story carried by a single outlet with
  // a single snapshot renders as one bar occupying the full height of the
  // panel, which says nothing and looks like a rendering fault. It also cannot
  // become interesting later: coverage of 1 at +7d is a story nobody else
  // picked up.
  //
  // So the panel appears when there is a shape: two or more captures, or a
  // story more than one outlet carried. Otherwise the coverage stat card above
  // has already said "1 outlet", which is the entire content of the chart.
  const curveWorthDrawing = points.length >= 2 || s.coverage > 1;

  // The four model scores, shown only where there IS a score.
  //
  // Rendered unconditionally they were four cards reading "—", which is worse
  // than absence: an empty box on a detail page reads as a value that failed to
  // load rather than as work that has not run. Scoring happens after
  // classification, so on a fresh archive every story looks broken.
  const scored = [
    s.importance !== null ? stat('Importance', s.importance, 'of 10',
      'A model’s judgement, 0 to 10, of whether this changes what you would build on. '
      + '8 or above is the queue worth acting on.') : '',
    s.niche !== null ? stat('Niche', fmt(s.niche), 'inverse coverage',
      'The inverse of coverage: 1.00 means no other outlet carried it. High is not '
      + 'better, it is narrower — a first-party changelog scores 1.00 by construction.') : '',
    s.novelty !== null ? stat('Novelty', fmt(s.novelty), '',
      'How much this differs from what this source has already published. Near 0 means '
      + 'the same announcement in different words.') : '',
    s.depth !== null ? stat('Depth', fmt(s.depth), '',
      'How much substance the body carries for its length. Low means an announcement '
      + 'with nothing behind it.') : '',
  ].filter(Boolean);

  const stacks = s.stacks.map((st) =>
    `<a class="chip" href="/trend/${encodeURIComponent(st)}">${escapeHtml(st)}</a>`).join(' ');

  // Whether this one is exempt from retention, and the control that changes it.
  const fav = await favouriteOne(s.id);

  const meta = [
    `<a href="${escapeHtml(s.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(s.source)}</a>`,
    escapeHtml(s.lang) + (s.country ? ` · ${escapeHtml(s.country)}` : ''),
    s.author ? escapeHtml(s.author) : '',
    `collected ${escapeHtml(relativeTime(s.collected))} ago`,
    s.published ? `published ${escapeHtml(s.published.slice(0, 10))}` : '',
    s.superseded ? '<span class="accent">superseded</span>' : '',
  ].filter(Boolean).join(' · ');

  const back = backFrom(referer, { href: '/news', label: 'News', phrase: 'News' },
    ['/story/', '/read/']);

  const timeline = placeInTimeline(nearby, { id: s.id, title: s.title, at });

  return wrap(`
    <p class="backlink"><a href="${escapeHtml(back.href)}">${
      icon('arrow-left', 13)} Back to ${escapeHtml(back.phrase)}</a></p>
    ${pageHead(s.title, meta, {
      // No eyebrow trail here. It said NEWS / STORY -- where you are, which the
      // title beside it already says -- and it was carrying the only way back
      // off this page in ten-pixel dim capitals. One link, saying where it
      // goes, in the place the reader looks for it. Filters and all: back to
      // the list you were actually on, not a bare /news that discards the
      // narrowing you just did. From another story, or from nowhere, News is
      // the honest default.
      crumbs: [],
      actions: `<a class="btn primary" href="/read/${escapeHtml(s.id)}">
          ${icon('book', 13)} Read here</a>
        ${favButton(s.id, fav, `/story/${s.id}`, false)}
        ${dismissButton(s.id, 'live', `/story/${s.id}`)}
        <a class="btn" href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer">
          Original ${icon('external', 12)}</a>`,
    })}
    <p style="margin:0 0 var(--s-4)">
      <a href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer"
         style="color:var(--link)">${escapeHtml(truncate(s.url, 110))} ${icon('external', 12)}</a></p>
    ${s.title !== s.original ? `<p class="dim" style="margin:-8px 0 var(--s-4);font-size:13px">
      Original title: ${escapeHtml(s.original)}</p>` : ''}
    ${s.summary
      ? `<p style="max-width:72ch;font-size:15px;line-height:1.62">${escapeHtml(s.summary)}</p>`
      : '<p class="muted" style="font-size:13px">No summary yet — summaries are written post-filter, at delivery time.</p>'}

    <div class="cards">
      ${stat('Coverage', s.coverage, s.coverage === 1 ? 'outlet' : 'outlets',
        'How many separate outlets carried this story. The publisher’s own alternate '
        + 'URLs are not counted — one outlet is one outlet, however many addresses it '
        + 'published at.')}
      ${scored.length ? scored.join('') : ''}
      <div class="card" data-tip="Stacks and tools matched from a closed vocabulary by string comparison. A model never invents one, so a technology missing from the vocabulary stays untagged rather than being guessed at."><h3>Technologies</h3>${
        stacks || '<span class="muted">unclassified</span>'}<span class="vh">Stacks and tools matched from a closed vocabulary by string comparison, never invented by a model.</span></div>
    </div>
    ${scored.length ? '' : `<p class="note">Importance, niche, novelty and depth are model
      scores, and this story has not been scored yet — they appear here once it has.</p>`}

    ${curveWorthDrawing ? `<h2 class="sec">Coverage curve</h2>
    <p class="note">Captured at +1h, +6h, +24h and +7d. It cannot be reconstructed later.</p>
    ${barChart(points, { height: 110 })}${seriesTable(points)}` : ''}

    ${timeline.length > 1 ? `<h2 class="sec">Around this, from ${escapeHtml(s.source)}</h2>
    <p class="note">The same publisher's entries either side of this one. A change
      reads differently when you can see what preceded it.</p>
    <ol class="rel">${timeline.map((r) => r.here
      ? `<li class="here"><span class="when">${escapeHtml(r.at.slice(0, 10))}</span>
           <span>${escapeHtml(r.title)}</span> <span class="pill muted">this one</span></li>`
      : `<li><span class="when">${escapeHtml(r.at.slice(0, 10))}</span>
           <a href="/story/${escapeHtml(r.id)}">${escapeHtml(r.title)}</a></li>`).join('')}</ol>` : ''}

    ${related.length ? `<h2 class="sec">Elsewhere on ${s.stacks.slice(0, 3).map((st) =>
      `<a class="chip" href="/trend/${encodeURIComponent(st)}">${escapeHtml(st)}</a>`).join(' ')}</h2>
    <p class="note">What other outlets have published about the same technologies.</p>
    <ol class="rel">${related.map((r) => `<li>
        <span class="when">${escapeHtml(r.at.slice(0, 10))}</span>
        <a href="/story/${escapeHtml(r.id)}">${escapeHtml(r.title)}</a>
        <span class="muted">${escapeHtml(r.source)}</span></li>`).join('')}</ol>` : ''}

    ${members.length ? `<h2 class="sec">Also carried by</h2>
    ${table([{ name: 'source' }, { name: 'url' }, { name: 'layer' }, { name: 'seen' }], members)}` : ''}

    ${aliases.length ? `<h2 class="sec">Also published at</h2>
    <p class="note">The same item from ${escapeHtml(s.source)} at another address —
      a feed link and a page's canonical disagreeing. Not another outlet, and not
      counted as coverage.</p>
    ${table([{ name: 'url' }, { name: 'seen' }], aliases)}` : ''}

    ${engagement.length ? `<h2 class="sec">Engagement</h2>
      <p class="note">Recorded per type and never summed across them.</p>
      ${table([{ name: 'type' }, { name: 'value' }, { name: 'at_offset' }, { name: 'captured' }], engagement)}` : ''}
  `);
}

export interface TimelineEntry { id: string; title: string; at: string }

/**
 * One story placed among its neighbours, newest first.
 *
 * The queries return "earlier" and "later" as two lists, which is how they are
 * cheapest to ask for and the worst way to read them: two headed tables that the
 * reader has to interleave mentally to answer "what came just before this". So
 * they are merged into one column with this entry marked in place.
 *
 * Sorting is on the ISO timestamp STRING rather than a parsed Date. These come
 * from Postgres as `timestamptz::text`, a fixed-width, zero-padded, UTC-offset
 * format that sorts lexicographically in exactly timestamp order -- and doing it
 * this way means a row with an unparseable date sorts predictably instead of
 * becoming NaN and taking the comparator's transitivity with it.
 *
 * Ties keep the order the database returned, which for entries published the
 * same day is the only ordering that exists.
 */
export function placeInTimeline<T extends TimelineEntry>(
  neighbours: T[],
  self: TimelineEntry,
): Array<TimelineEntry & { here: boolean }> {
  return [
    ...neighbours
      .filter((n) => n.id !== self.id)
      .map((n) => ({ id: n.id, title: n.title, at: n.at, here: false })),
    { ...self, here: true },
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

function fmt(v: string | null): string {
  return v === null ? '—' : Number(v).toFixed(2);
}

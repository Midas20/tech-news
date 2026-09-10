// The left rail, and the counts behind it.
//
// The rail is NAVIGATION and nothing else. It used to carry filter toggles too --
// languages, technologies, "rising fastest" -- which looked identical to the real
// destinations next to them and behaved nothing like them: several could not be
// combined at all, so a menu that invited you to stack things quietly replaced
// your selection instead. Every one of those has moved: into the Refine panel if
// it combines, into its own page if it does not.
//
// What is left is a menu of places, scoped to the section you are in, and every
// entry carries its own count -- because a menu of bare labels tells you where
// you can go, and a menu of counts tells you where there is something to see.
//
// All counts come from ONE query, cached for a few seconds, so a detailed menu
// costs a single round trip per page rather than fifteen.

import { q, qOwner } from './db.ts';
import { buildWhere, parseFilters } from './filters.ts';
import type { ReadingPrefs } from '../settings.ts';
import { railGroup, escapeHtml, type RailItem } from './html.ts';
import { icon } from './theme.ts';
import { FIELDS, fieldCounts } from './fields.ts';
import { topCompanies } from './companies.ts';
import { CATEGORIES } from './stacks.ts';
import {
  SECTIONS, sectionFor, isOn, EXPLORE_ITEMS, REGISTRY_ITEMS,
  ANALYSE_ITEMS, SYSTEM_ITEMS, ADMIN_ITEMS, REPORT_ITEMS,
  type NavItem,
} from './nav.ts';
import { GROUPS } from '../settings.ts';

export interface RailCounts {
  day: number;
  week: number;
  unscored: number;
  total: number;
  news: number;
  fields: { slug: string; label: string; icon: string; n: number }[];
  companies: { slug: string; name: string; n: number }[];
  sourcesHealthy: number;
  sourcesFailing: number;
  sourcesPaused: number;
  jobsPending: number;
  candidates: number;
  tables: number;
  stacks: number;
  tools: number;
  concepts: number;
  platforms: number;
  favourites: number;
  deleted: number;
}

let cache: { at: number; value: RailCounts } | null = null;

/**
 * Longer than the browser's poll, which is the whole point.
 *
 * This was 5s against a 15s poll, so the cache never once hit: every tick of
 * every open tab re-ran the whole count set -- a dozen aggregates over 38,578
 * stories, 5,760 times a day per visible tab, to move a number that changes
 * when the collector runs every 30 seconds.
 *
 * At 30s a poll finds a warm cache roughly every other tick and no number on
 * screen is more than half a minute stale, which is well inside the honesty of
 * a badge that already says "collected 18m ago". Found on 2026-09-05 looking
 * for what spent a database's data-transfer quota.
 */
const TTL_MS = 30_000;

/**
 * The days a report exists for, newest first.
 *
 * Read straight rather than through src/analysis/briefing.ts's reportIndex: that
 * one joins every day to all of its field briefings so a page can list them, and
 * a rail needs a date and a number. Cached with the other rail counts because it
 * is drawn on every page of the section.
 */
const DAYS_TTL_MS = 60_000;
let dayCache: { at: number; value: Array<{ day: string; fields: number }> } | null = null;

export async function reportDays(
  limit = 30,
): Promise<Array<{ day: string; fields: number }>> {
  if (dayCache && Date.now() - dayCache.at < DAYS_TTL_MS) return dayCache.value;
  const rows = await q<{ day: string; fields: number }>(
    `SELECT DISTINCT ON (day) day::text AS day, coalesce(fields, 0) AS fields
       FROM daily_reports
      WHERE generator LIKE 'content-%'
      ORDER BY day DESC, generated_at DESC
      LIMIT $1`, [limit]).catch(() => []);
  const value = rows.map((r) => ({ day: r.day, fields: Number(r.fields) }));
  dayCache = { at: Date.now(), value };
  return value;
}

export async function railCounts(): Promise<RailCounts> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  // Split along the privilege boundary, deliberately. Content counts run as the
  // application role; the job queue and provider budgets are revoked from it, so
  // the operational counts run on the owner connection. A single query would
  // have to be granted more than the app should ever hold.
  const [summary] = await q<Record<string, string>>(`
    SELECT
      (SELECT count(*) FROM stories WHERE superseded_by IS NULL AND coalesce(is_tech, true)
         AND coalesce(published_at, collected_at) > now() - interval '24 hours') AS day,
      (SELECT count(*) FROM stories WHERE superseded_by IS NULL AND coalesce(is_tech, true)
         AND coalesce(published_at, collected_at) > now() - interval '7 days')  AS week,
      (SELECT count(*) FROM stories WHERE superseded_by IS NULL AND coalesce(is_tech, true)
         AND importance IS NULL)                                            AS unscored,
      (SELECT count(*) FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND coalesce(s.is_tech, true) AND src.kind IN ('news','research','status')
          AND NOT s.is_prerelease)                                          AS news,
      (SELECT count(*) FROM stories WHERE superseded_by IS NULL AND coalesce(is_tech, true))            AS total,
      (SELECT count(*) FROM stacks WHERE kind = 'stack')                     AS stacks,
      (SELECT count(*) FROM stacks WHERE kind = 'tool')                      AS tools,
      (SELECT count(*) FROM stacks WHERE kind = 'concept')                   AS concepts,
      (SELECT count(*) FROM platforms WHERE retired_at IS NULL)              AS platforms,
      (SELECT count(*) FROM sources WHERE health = 'healthy')               AS sources_healthy,
      (SELECT count(*) FROM sources WHERE health IN ('degraded','failing','dead')) AS sources_failing,
      (SELECT count(*) FROM sources WHERE health = 'paused')                AS sources_paused,
      (SELECT count(*) FROM source_candidates WHERE evaluated_at IS NULL)   AS candidates,
      (SELECT count(*) FROM favourites WHERE unfavourited_at IS NULL)        AS favourites,
      (SELECT count(*) FROM stories
        WHERE dismissed_at IS NOT NULL AND superseded_by IS NULL)          AS deleted
  `);

  const [ops] = await qOwner<Record<string, string>>(`
    SELECT
      (SELECT count(*) FROM jobs WHERE status = 'pending')                  AS jobs_pending,
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v')
          AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)) AS tables
  `);

  const [fields, firms] = await Promise.all([
    fieldCounts().catch(() => new Map()),
    topCompanies(8).catch(() => []),
  ]);

  const n = (key: string) => Number(summary?.[key] ?? 0);
  const value: RailCounts = {
    day: n('day'), week: n('week'), unscored: n('unscored'), total: n('total'),
    news: n('news'),
    stacks: n('stacks'), tools: n('tools'), concepts: n('concepts'),
    platforms: n('platforms'),
    fields: FIELDS.map((f) => ({ ...f, n: fields.get(f.slug)?.total ?? 0 }))
      .filter((f) => f.n > 0)
      .sort((a, b) => b.n - a.n),
    companies: firms,
    sourcesHealthy: n('sources_healthy'), sourcesFailing: n('sources_failing'),
    sourcesPaused: n('sources_paused'),
    jobsPending: Number(ops?.jobs_pending ?? 0),
    candidates: n('candidates'),
    favourites: n('favourites'),
    deleted: n('deleted'),
    tables: Number(ops?.tables ?? 0),
  };

  cache = { at: Date.now(), value };
  return value;
}

export interface RailState {
  path: string;
  search: URLSearchParams;
}


function toItem(
  state: RailState, item: NavItem, count?: number | null, countKey?: string,
): RailItem {
  return {
    href: item.href,
    label: item.label,
    icon: item.icon,
    ...(count === undefined ? {} : { count }),
    ...(countKey ? { countKey } : {}),
    active: isOn(state.path, item),
  };
}

/**
 * The rail for the section you are in.
 *
 * Only one section's pages are ever listed. The top bar already says which
 * section you are in and gets you to the others, so repeating all five here
 * would be the same mistake in a different place: a long menu that hides the
 * one list you are actually reading.
 */
export async function renderRail(
  state: RailState, adminExtra = '', prefs?: ReadingPrefs,
  role: 'admin' | 'user' | null = null,
): Promise<string> {
  const c = await railCounts();
  const section = sectionFor(state.path);

  if (section.id === 'explore') {
    // A field's row points at the river; the report is one click further in,
    // from /reports or from the button on the field page. Two rows per field
    // here would double the length of the rail to say the same fourteen names
    // twice, which is the shape that made Reports a bad section in the first
    // place.
    const fields: RailItem[] = c.fields.slice(0, 8).map((f) => ({
      href: `/field/${encodeURIComponent(f.slug)}`,
      label: f.label,
      count: f.n,
      sub: true,
      active: state.path === `/field/${f.slug}`,
    }));
    const companies: RailItem[] = c.companies.map((f) => ({
      href: `/company/${encodeURIComponent(f.slug)}`,
      label: f.name,
      count: f.n,
      sub: true,
      active: state.path === `/company/${f.slug}`,
    }));
    return [
      railGroup('Explore', EXPLORE_ITEMS.map((i) => toItem(state, i))),
      railGroup('Fields', [...fields,
        { href: '/fields', label: 'All fields', sub: true, all: true,
          active: state.path === '/fields' }]),
      railGroup('Companies', [...companies,
        { href: '/companies', label: 'All companies', sub: true, all: true,
          active: state.path === '/companies' }]),
    ].join('');
  }

  // One registry, one rail. The four lists sit together with their counts, and
  // the categories hang underneath -- the same shape Explore uses for fields and
  // companies, so the two sections that browse a vocabulary browse it the same
  // way.
  //
  // The category rows point at /technology/<id>, which spans all three `kind`s.
  // Narrowing to the categories WITHIN one list is what that list's own facet
  // panel is for; a rail that changed meaning depending on which of four pages
  // you were on was the reason the three-tab version needed two rails.
  if (section.id === 'registry') {
    const COUNT_KEY: Record<string, keyof RailCounts> = {
      '/stacks': 'stacks', '/tools': 'tools',
      '/concepts': 'concepts', '/platforms': 'platforms',
    };
    return [
      railGroup('Registry', REGISTRY_ITEMS.map((i) => {
        const key = COUNT_KEY[i.href];
        // The catalogue spans every kind, so its badge is the sum of the three
        // that share the `stacks` table. Platforms are a different table and a
        // different question, and are deliberately not added in.
        if (i.href === '/technologies') {
          return toItem(state, i, c.stacks + c.tools + c.concepts);
        }
        return toItem(state, i, key ? (c[key] as number) : undefined, key);
      })),
      railGroup('Categories', CATEGORIES.map((cat) => ({
        href: `/technology/${cat.id}`,
        label: cat.label,
        sub: true,
        active: state.path === `/technology/${cat.id}`,
      }))),
    ].join('');
  }

  if (section.id === 'new') {
    // Every field, plus the fields themselves. The page carries its own subnav
    // too; this is the rail because the section has a tab and a tab with no
    // rail looks broken next to five that have one.
    return [
      railGroup("What's new", [toItem(state, {
        href: '/emerging', label: 'Every field', icon: 'spark',
        blurb: 'Names that entered the archive in the last 90 days.',
      })]),
      railGroup('By field', FIELDS.map((f) => toItem(state, {
        href: `/emerging/${f.slug}`, label: f.label, icon: f.icon,
      }))),
    ].join('');
  }

  if (section.id === 'analyse') {
    return railGroup('Analyse', ANALYSE_ITEMS.map((i) => toItem(state, i)));
  }

  if (section.id === 'reports') {
    // THE RAIL THIS SECTION DID NOT HAVE THE FIRST TIME.
    //
    // Reports was a tab on 2026-08-30 and lost it the same day, because its rail
    // was fourteen links to fourteen field reports -- the index it duplicates,
    // wearing a menu. What earns the tab back is that a report is now written
    // every morning and kept, so there are two axes to move along: down the days
    // and across the fields. Neither is reachable from the other without this.
    //
    // The days come from the database rather than from a constant, because a
    // rail offering a day nobody wrote is a menu that lies about what exists.
    const items = role === 'admin'
      ? REPORT_ITEMS
      // The composed briefing is administrators only -- it states what the
      // archive cannot support as readily as what it can, and it names the model
      // that wrote it. A rail entry a reader cannot open is worse than no entry,
      // so it goes here as well as at the route: one decision, both places.
      : REPORT_ITEMS.filter((i) => i.href !== '/trends/report');

    const days = await reportDays();
    const dayItems: RailItem[] = days.map((r) => ({
      href: `/reports/${r.day}`,
      label: new Date(`${r.day}T00:00:00Z`).toLocaleDateString('en-GB',
        { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      count: r.fields,
      // NO countKey, AND THAT IS THE FIX. `countKey` names an entry in the
      // global `railCounts()` payload that the fifteen-second poller re-stamps
      // onto every matching element. `counts.fields` exists -- and it is the
      // ARRAY of fields for the News rail, not a number -- so every dated row
      // here was overwritten with Number([...]) === NaN a few seconds after the
      // page loaded. The screenshot that reported it showed "NaN" against 10,
      // 9 and 8 Sept.
      //
      // A per-day count cannot be keyed globally in the first place: one key
      // would paint the same number onto all ten rows. This number is written
      // once, server-side, and is correct until the page is reloaded.
      sub: true,
      active: state.path === `/reports/${r.day}`,
    }));

    const fieldItems: RailItem[] = FIELDS.map((f) => ({
      href: `/field/${encodeURIComponent(f.slug)}/report`,
      label: f.label,
      sub: true,
      // A dated report for this field lights its row too: you are still reading
      // that field, and a rail that goes blank when you open something is a rail
      // that stops telling you where you are.
      active: state.path.startsWith(`/field/${f.slug}/report`),
    }));

    return [
      railGroup('Reports', items.map((i) => toItem(state, i))),
      railGroup('Recent', dayItems, {
        limit: 10,
        note: days.length === 0
          ? 'No report has been written yet.'
          : 'One report a morning, over the stories that arrived since the last.' }),
      railGroup('By field', fieldItems, { limit: 8,
        note: 'The latest briefing for one field, with its earlier ones under it.' }),
    ].join('');
  }

  if (section.id === 'system') {
    const settingGroups: RailItem[] = GROUPS.map((g) => ({
      href: `/settings#${g.id}`,
      label: g.label,
      sub: true,
    }));
    return [
      railGroup('Operations', [
        ...SYSTEM_ITEMS.map((i) => toItem(state, i)),
        { href: '/sources?health=paused', label: 'Paused sources', count: c.sourcesPaused, icon: 'feed' },
      ].map((i) => (i.href === '/admin/health'
        ? { ...i, count: c.sourcesFailing, alert: c.sourcesFailing > 0 }
        : i.href === '/sources' ? { ...i, count: c.sourcesHealthy } : i))),
      railGroup('Settings', settingGroups),
      railGroup('Database', [
        ...ADMIN_ITEMS.map((i) => toItem(state, i)),
      ].map((i) => (i.href === '/admin' ? { ...i, count: c.tables }
        : i.href === '/admin/t/jobs' ? { ...i, count: c.jobsPending }
        : i.href === '/admin/t/source_candidates' ? { ...i, count: c.candidates } : i))),
      adminExtra,
    ].join('');
  }

  // --- News -----------------------------------------------------------------
  //
  // The reader supplies this section's rail, because the useful things to put
  // in it -- which types, which fields, which technologies -- are counts under
  // the CURRENT selection, and only the page that built the query knows what
  // that is. Computing them again here would mean two queries that can disagree
  // with each other, and a rail that disagrees with the list beside it is worse
  // than no rail.
  //
  // What is left here is the tail: the presets, which are the only destinations
  // on this section not reachable from the content or the top bar.
  return newsRailTail(state, c, await unreadHere(state, prefs));
}

/**
 * The favourites shelf, and nothing above it any more.
 *
 * There was a VIEWS group here -- Today, Critical, Rising fastest, Niche
 * technologies -- and three of the four were the controls sitting directly
 * above the list, saved under a name:
 *
 *   Today            days=1                  = Window · 24 hours
 *   Critical         min=8                   = Importance · Critical 8+
 *   Rising fastest   sort=velocity, days=7   = Sort · Rising fastest + Window · 7 days
 *
 * A menu is not a filter bar. That principle already removed one copy of this
 * mistake from the rail; this was the other copy, offering a second way to set
 * controls that were never hidden. Critical had a further problem: it filters on
 * `importance >= 8`, a classifier score that is NULL whenever classification is
 * off, so the entry led to an empty page more often than not.
 *
 * The fourth, Niche technologies, was the only one setting something with no
 * control -- `rare=3`, a threshold on how often a technology appears anywhere.
 * That question is now asked better and deterministically by First seen, which
 * is a control on News: a technology first seen this month is new, where "three
 * stories or fewer" is a proxy for it that drifts as the archive grows.
 */
/**
 * How many stories the unread link would actually show.
 *
 * Counted through the SAME buildWhere the page uses, on the SAME URL, with
 * `unread=1` added -- so the badge is by construction the number of rows behind
 * the link. Hand-writing the predicate here instead gave 598 against a page
 * showing 580: the reader hides articles by default and the badge did not know,
 * so eighteen of them could never be cleared by reading. A count nobody can
 * clear is worse than no count.
 */
export async function unreadHere(
  state: RailState, prefs?: ReadingPrefs,
): Promise<number> {
  const params = new URLSearchParams(state.search);
  params.set('unread', '1');
  // The reading preferences MUST come through. Without them parseFilters falls
  // back to defaults, and the News stream's rules -- which releases are shown,
  // which fields are followed -- are preferences. Omitting them produced 427
  // unread on a page holding 377 stories, a badge larger than the list it
  // counts.
  const { sql, params: values } = buildWhere(
    parseFilters(new URL(`http://local${state.path}?${params}`), prefs));
  const [row] = await q<{ n: string }>(
    `SELECT count(*)::text AS n FROM stories s
       JOIN sources src ON src.id = s.source_id ${sql}`, values);
  return Number(row?.n ?? 0);
}

export function newsRailTail(state: RailState, c: RailCounts, unreadN = 0): string {
  // Where the reader got to, above what they kept: it is the question a river
  // raises every visit, and the other two are things you do to one story.
  const on = state.search.get('unread') === '1';
  // Keeps every other filter and toggles this one, so it composes with the rest
  // of the rail instead of resetting the page.
  const next = new URLSearchParams(state.search);
  if (on) next.delete('unread'); else next.set('unread', '1');
  const qs = next.toString();

  const unread: RailItem[] = [{
    href: qs ? `${state.path}?${qs}` : state.path,
    label: 'Unread only', icon: 'circle',
    count: unreadN, countKey: 'unread', active: on,
  }];

  const kept: RailItem[] = [{
    href: '/favourites', label: 'Favourites', icon: 'star',
    count: c.favourites, countKey: 'favourites',
    active: state.path === '/favourites',
  }];

  // Deleted only appears once something has been. An empty bin in the menu of
  // every reader who has never used it is a permanent advertisement for a
  // feature that is a correction, not a destination.
  if (c.deleted > 0 || state.path === '/deleted') {
    kept.push({
      href: '/deleted', label: 'Deleted', icon: 'trash',
      count: c.deleted, countKey: 'deleted',
      active: state.path === '/deleted',
    });
  }

  return [
    railGroup('Reading', unread, {
      note: 'Opening a story marks it read. The mark never hides anything.',
    }),
    // One press rather than one per story, which is what a reader wants after a
    // week away. Only offered when there is something to catch up on.
    unreadN > 0
      ? `<form class="readall" method="post" action="/read-all">
           <input type="hidden" name="return" value="${escapeHtml(
             state.path + (state.search.toString() ? `?${state.search}` : ''))}">
           <button type="submit">${icon('check', 12)}Mark all ${
             unreadN.toLocaleString('en-US')} read</button>
         </form>`
      : '',
    railGroup('Kept and removed', kept),
  ].join('');
}

/**
 * Freshness indicator for the top bar: how long since anything was COLLECTED.
 *
 * The one place collection time is the right clock. Everything a reader sees is
 * dated by publication, but this badge answers "is the collector alive", and a
 * publication date cannot answer that -- a feed serving week-old posts would
 * show as a week stale while the collector was working perfectly.
 */
export async function statusBadge(): Promise<string> {
  const [row] = await q<{ last: string | null; recent: string }>(
    `SELECT max(collected_at)::text AS last,
            count(*) FILTER (WHERE collected_at > now() - interval '1 hour')::text AS recent
       -- Not filtered by is_tech, unlike every count above. This badge answers
       -- "is the collector alive", and a cycle that collected nothing but
       -- shopping listicles still proves it ran.
       FROM stories WHERE superseded_by IS NULL`);

  if (!row?.last) return '<span class="live down"><i></i> no data</span>';

  const ageMin = Math.round((Date.now() - Date.parse(row.last)) / 60000);
  const cls = ageMin < 30 ? '' : ageMin < 180 ? 'stale' : 'down';
  const label = ageMin < 1 ? 'live now' : ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`;
  return `<span class="live ${cls}" title="most recent story collected"><i></i> ${label}</span>`;
}

/** The primary section tabs in the top bar. */
export function topNav(path: string): string {
  const current = sectionFor(path);
  return `<nav class="nav">${SECTIONS.map((s) =>
    `<a href="${s.home}" class="${s.id === current.id ? 'on' : ''}" title="${s.blurb}">
      ${icon(s.icon, 14)}<span>${s.label}</span></a>`).join('')}</nav>`;
}

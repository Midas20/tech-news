// Navigation.
//
// The rail used to hold two different kinds of thing wearing the same clothes:
// destinations ("Sources", "Companies") and filter toggles ("Rising fastest",
// "Japanese"). They looked identical and behaved nothing alike -- and worse,
// several of the toggles were mutually exclusive, so a menu that invited you to
// combine things quietly replaced your selection instead.
//
// The split here is absolute:
//
//   NAVIGATION  changes the page you are on.        Lives in the top bar + rail.
//   FILTERS     change what that page shows.        Live in the page body only.
//
// Anything that cannot be combined with its neighbours is not a filter, so it
// gets a page: the streams, and the named views underneath them.
//
// The five sections answer five different questions, and each owns a different
// slice of the same archive:
//
//   NEWS      what is happening in the fields I follow      filtered by preference
//   ANALYSE   what is rising and falling over years
//   EXPLORE   what is happening at all                      never filtered
//   REGISTRY  what can this archive name, and where do I get it
//   SYSTEM    is the machine healthy
//
// News and Explore share a renderer and differ only in whether the focus filter
// applies. That is the whole distinction, and it is worth being blunt about:
// Explore is News with the blinkers off.
//
// This list has been five, then seven, and is five again. It went to seven when
// the registry was split into a tab each for stacks, tools and platforms; two of
// those owned exactly one page, `concept` never got a tab despite being the
// third peer of `kind`, and Analyse -- the only section reading the data the
// retention contract keeps forever -- was sixth. A top bar is a claim about what
// a product is for, and that one was making the wrong claim.

import { STREAMS } from './filters.ts';

export interface NavItem {
  href: string;
  label: string;
  icon?: string;
  blurb?: string;
  /** Extra paths that should light this entry up. */
  match?: string[];
}

export interface NavSection {
  id: string;
  label: string;
  icon: string;
  /** Where the top-bar tab goes. */
  home: string;
  blurb: string;
  /** Path prefixes owned by this section. */
  owns: string[];
  /**
   * Paths a prefix cannot express.
   *
   * A field's report lives at '/field/<slug>/report', underneath the prefix that
   * owns the field rivers, so no amount of prefix ordering separates them --
   * Reports would have to claim '/field/' and take the rivers with it. Tested
   * before the prefixes, so the more specific rule wins.
   */
  claims?: RegExp[];
}

export const SECTIONS: NavSection[] = [
  {
    id: 'news', label: 'News', icon: 'stream', home: '/news',
    blurb: 'The fields you follow, and nothing else.',
    owns: ['/news', '/new', '/story/', '/read/', '/search',
      '/favourites', '/deleted'],
  },
  // WHAT'S NEW SITS SECOND, BECAUSE IT IS WHAT THE ARCHIVE IS FOR.
  //
  // Stated on 2026-09-09: "the purpose of the project is to find new market
  // that will appear in short period". Every other section narrows a closed
  // vocabulary of 2,460 things somebody already knew about, and a market that
  // is about to appear is by definition not in it -- so the reports found AWS
  // and Microsoft every morning while Booley, aic-agent and PocketBase Cloud
  // went into a footnote and were forgotten. This section reads the ledger that
  // migration 0074 added.
  //
  // A TAB AND NOT A RAIL ENTRY, despite this project's history with tabs -- one
  // was added and removed on the same day in August, and the Reports tab below
  // had to be asked for twice before it was found. Something described as the
  // purpose of the product does not go two levels down.
  {
    id: 'new', label: "What's new", icon: 'spark', home: '/emerging',
    blurb: 'Tools, platforms and companies that were not in the taxonomy last month.',
    owns: ['/emerging'],
  },
  // REPORTS SITS THIRD, AND IT USED TO BE AN ENTRY UNDER EXPLORE.
  //
  // It was a tab on 2026-08-30, demoted the same day -- "this page isn't enough
  // to be individual menu" -- and the demotion was right at the time: it owned
  // fourteen links to fourteen field reports, which is a rail holding nothing
  // but the index it duplicates.
  //
  // What changed is that there is now something to navigate. A report is
  // written every morning and kept, so the section has two axes -- eighteen days
  // down one, fourteen fields across the other -- and a rail that answers "what
  // did we say about cloud last Tuesday" without going through a list of
  // everything. That is a section.
  //
  // It takes /trends/report with it. The composed whole-archive briefing was in
  // Analyse because that is where the movement report lived, and it is a report;
  // having reports in two tabs is how a reader learns to check both.
  {
    id: 'reports', label: 'Reports', icon: 'book', home: '/reports',
    blurb: 'What happened, written each morning from the stories that arrived.',
    // '/new' is a report and belongs in this tab, not in Explore. It is the one
    // report that is not about a field -- see src/ui/whatsnew.ts -- and putting
    // it anywhere else would file "what is new" under a category, which is the
    // exact shape it exists to escape.
    owns: ['/reports', '/trends/report', '/new'],
    // '/field/<slug>/report' and '/field/<slug>/report/<day>', which live under
    // Explore's '/field/' prefix and are not Explore's pages.
    claims: [/^\/field\/[^/]+\/report(\/|$)/],
  },
  // ANALYSE SITS FOURTH, AND THAT IS THE POINT OF THE WHOLE PRODUCT.
  //
  // The retention contract deletes stories and keeps `stack_month` forever, so
  // the month-by-month series is the one artefact here that is not reproducible
  // from anywhere else. It was the sixth of seven tabs, behind three lists of
  // vocabulary -- the navigation said the archive was a catalogue with a chart
  // attached, and it is a chart with a catalogue attached.
  {
    id: 'analyse', label: 'Analyse', icon: 'trending', home: '/trends',
    blurb: 'What rose and what fell, month by month, for as far back as it goes.',
    owns: ['/trends', '/trend/'],
  },
  {
    id: 'explore', label: 'Explore', icon: 'layers', home: '/all',
    blurb: 'Everything collected, however you want to enter it.',
    owns: ['/all', '/categories', '/fields', '/field/', '/reports', '/companies', '/company/'],
  },
  // ONE REGISTRY, FOUR LISTS.
  //
  // This was briefly three tabs -- Stacks, Tools, Platforms -- on the argument
  // that a dependency you ship, a thing you operate and a place you deploy to
  // are three different questions. They are. They are also three filters over
  // one renderer: /stacks, /tools and /concepts are `renderRegistry(url, kind)`
  // called with a different kind, and the tabs cost what tabs cost.
  //
  // Two of the three owned a single page each, so two of seven top-level tabs
  // opened a section whose rail had one entry in it. And `concept` -- the third
  // peer of `kind` in src/vocab/kinds.ts -- had no tab at all and lived in the
  // Stacks rail, so the top bar disagreed with the vocabulary about how many
  // kinds of thing there are.
  //
  // The kinds still differ. They differ one rail-click apart, which is the
  // distance the difference is worth.
  {
    id: 'registry', label: 'Registry', icon: 'table', home: '/stacks',
    blurb: 'Everything the archive can name: what ships, what you work with, '
      + 'what you cannot install, and where it all runs.',
    owns: ['/stacks', '/tools', '/concepts', '/technologies', '/technology/',
      '/platforms', '/platform/'],
  },
  {
    id: 'system', label: 'System', icon: 'pulse', home: '/sources',
    blurb: 'What is collecting, what is failing, and every knob that changes it.',
    owns: ['/sources', '/settings', '/admin'],
  },
];

/**
 * Which section a path belongs to.
 *
 * An entry owns its own path AND everything under it, which is not the same as a
 * string prefix: '/admin' must claim '/admin/t/jobs' without '/all' claiming
 * '/allocations'. Getting this wrong is invisible until a page quietly shows the
 * wrong menu -- /admin/t/source_candidates was doing exactly that, offering the
 * reading rail on a database page.
 */
export function sectionFor(path: string): NavSection {
  if (path === '/') return SECTIONS[0]!;
  for (const s of SECTIONS) {
    if (s.claims?.some((re) => re.test(path))) return s;
    if (s.owns.some((p) => {
      const base = p.endsWith('/') ? p.slice(0, -1) : p;
      return path === base || path.startsWith(`${base}/`);
    })) return s;
  }
  return SECTIONS[0]!;
}

/**
 * The eyebrow above a page title, derived from the top bar rather than typed.
 *
 * Every one of these was written by hand and they drifted the moment the
 * navigation changed: /stacks said "Explore / Stacks" after Stacks became its
 * own tab, /platforms said "Stacks & tools / Platforms" after that section
 * stopped existing, and three pages still said "Read" -- a section renamed to
 * News. A breadcrumb that names a section the top bar does not have is worse
 * than no breadcrumb, because it is a claim about where you are.
 *
 * Empty when the page IS its section's home: the tab is already lit, and
 * "STACKS" over an <h1> reading "Stacks" is the title twice.
 */
export function crumbsFor(path: string, label: string): { label: string; href?: string }[] {
  const section = sectionFor(path);
  if (path === section.home) return [];
  const trail: { label: string; href?: string }[] = [{ label: section.label, href: section.home }];
  // Nothing more to add when the page's own name IS the section's -- a detail
  // page under /platform/ says "Platforms", and "Platforms / Platforms / Patreon"
  // is the section twice. The caller appends the specific thing.
  if (label === section.label) return trail;
  // A detail page passes the LIST it came from, which is a real destination and
  // gets a link; a list page passes its own name, which does not.
  const item = [...REGISTRY_ITEMS, ...EXPLORE_ITEMS, ...SYSTEM_ITEMS, ...ANALYSE_ITEMS,
    ...REPORT_ITEMS].find((i) => i.label === label);
  trail.push(item ? { label, href: item.href } : { label });
  return trail;
}

/** True when this rail entry is the page you are looking at, or owns it. */
export function isOn(path: string, item: NavItem): boolean {
  if (path === item.href) return true;
  return item.match?.some((m) => {
    // A SUFFIX rule, for the one distinction a prefix cannot make. Every report
    // lives at '/field/<slug>/report', underneath the entry that owns the field
    // rivers -- so without this both entries light, or the wrong one does.
    if (m.startsWith('*')) return path.endsWith(m.slice(1));
    // And the same distinction from the other side: '/field/' claims the field
    // rivers, not the reports written from them -- including the dated ones,
    // which is why this is a segment test and not endsWith('/report').
    if (/\/report(\/|$)/.test(path)) return false;
    const base = m.endsWith('/') ? m.slice(0, -1) : m;
    return path === base || path.startsWith(`${base}/`);
  }) ?? false;
}

export const STREAM_ITEMS: NavItem[] = STREAMS.map((s) => ({
  href: s.path, label: s.label, icon: s.icon, blurb: s.blurb,
}));

export const EXPLORE_ITEMS: NavItem[] = [
  { href: '/all', label: 'Everything', icon: 'stream',
    blurb: 'Every story collected, in one river, with no field filter applied.' },
  // Named 'Categories', not 'By category'. The registry's /technologies entry
  // had that name too, and crumbsFor() resolves a label to the first item
  // carrying it -- so one of the two was going to link to the other's page. The
  // pages are not alike: this one counts STORIES by category and links into the
  // reader, /technologies lists the VOCABULARY. This is also the name the page
  // already passes to crumbsFor(), so the breadcrumb now links instead of
  // rendering as dead text.
  { href: '/categories', label: 'Categories', icon: 'grid',
    blurb: 'Technology, company, platform or field — every count a link into the reader.' },
  { href: '/fields', label: 'Fields', icon: 'layers', match: ['/field/'],
    blurb: 'One page per domain, from the roots of the taxonomy.' },
  { href: '/companies', label: 'Companies', icon: 'gem', match: ['/company/'],
    blurb: 'What a vendor announced, kept apart from what was written about it.' },
];

// The analysis rail. These were three literals inside renderRail(); they are
// here with the others so crumbsFor() can name them and notfound.ts can suggest
// them, which is the whole reason the other four lists live in this file.
//
// Two of the three point outside the section on purpose. A field river and a
// field report are Explore's pages, but "how much of this is there, over time"
// is an analysis question no matter which renderer answers it.
export const ANALYSE_ITEMS: NavItem[] = [
  { href: '/trends', label: 'Technology trends', icon: 'trending',
    blurb: 'What this archive collected, month by month, for as far back as it goes.' },
  { href: '/fields', label: 'Volume by field', icon: 'layers',
    blurb: 'How much each domain produced, as a series rather than a list.' },
];

/**
 * The Reports rail.
 *
 * Two entries and then two axes. The days and the fields are built from the
 * database in src/ui/rail.ts, because a rail listing reports that do not exist
 * is worse than no rail -- this section is one of the few whose menu is a fact
 * about the data rather than about the code.
 */
export const REPORT_ITEMS: NavItem[] = [
  { href: '/reports', label: 'Every report', icon: 'book',
    blurb: 'Every briefing written so far, by day and by field.' },
  // Administrators only, filtered out in rail.ts and refused at the route.
  { href: '/trends/report', label: 'Latest briefing', icon: 'spark',
    blurb: 'The most recent morning, whole: every field, with the stories cited.' },
];

// One vocabulary, four lists. The split is by what a thing IS to you -- a
// dependency you ship, a tool you operate, an idea you cannot install, or a
// place you deploy to -- which is the distinction `category` was never able to
// carry. Three of the four are one renderer with a different `kind`; the fourth
// reads a different table and belongs here anyway, because the question it
// answers is the same question: what can this archive name?
//
// These were three separate lists feeding three separate tabs. The rail is
// where a difference this size is supposed to live.
export const REGISTRY_ITEMS: NavItem[] = [
  { href: '/stacks', label: 'Stacks', icon: 'table',
    blurb: 'What a product is built from. It ships, and the product stops without it.' },
  { href: '/tools', label: 'Tools', icon: 'wrench',
    blurb: 'What a person works with — editors, CLIs, CI, assistants. Never ships.' },
  { href: '/concepts', label: 'Concepts', icon: 'layers',
    blurb: 'Practices and fields. Nothing to install.' },
  { href: '/platforms', label: 'Platforms', icon: 'building', match: ['/platform/'],
    blurb: 'Where a thing is deployed, sold or paid for. Every row carries a real address.' },
  { href: '/technologies', label: 'By category', icon: 'grid', match: ['/technology/'],
    blurb: 'The whole vocabulary grouped into nineteen categories, across every kind.' },
];

export const SYSTEM_ITEMS: NavItem[] = [
  { href: '/sources', label: 'Sources', icon: 'feed', blurb: 'Every feed, its health and its yield.' },
  { href: '/admin/health', label: 'Collection health', icon: 'pulse' },
  { href: '/settings', label: 'Settings', icon: 'sliders', blurb: 'Every knob the running code actually reads.' },
];

export const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin', label: 'All tables', icon: 'table' },
  // The scheduler, which is what actually runs this system. Above the job queue
  // because "did collection run" is asked far more often than "what is queued".
  { href: '/admin/jobs', label: 'Scheduled work', icon: 'pulse' },
  { href: '/admin/t/jobs', label: 'Job queue', icon: 'queue' },
  { href: '/admin/t/source_candidates', label: 'Discovered domains', icon: 'search' },
  { href: '/admin/rls', label: 'Tenant isolation', icon: 'shield' },
];

// ---------------------------------------------------------------------------
// Coming back
// ---------------------------------------------------------------------------

/**
 * Where "back" goes, WITH the filters intact.
 *
 * The read and story pages worked out where you came from by parsing the
 * referer and keeping `pathname`. A filtered list is `/news?kind2=change` --
 * every filter lives in the query string, which is exactly the part that was
 * dropped. So narrowing News to a stack, opening a story and coming back landed
 * on an unfiltered News, and the work of narrowing had to be redone each time.
 * The reader reads this as the site forgetting; it is the site discarding.
 *
 * The path is still matched against a fixed list rather than echoed, because a
 * referer is supplied by whoever links here. What is new is that the query is
 * carried along with it -- unvalidated, deliberately: the filter parser already
 * ignores parameters it does not recognise, and this value is only ever used as
 * a relative same-origin href. It cannot name another host, because the host is
 * taken from the allowlisted path and never from the referer.
 *
 * `label` is a breadcrumb noun; `phrase` completes "Back to ...". The same
 * destination needs both, and the two are not interchangeable -- "Back to
 * Reader" and "the reader / Story" both read like a bug.
 */
export interface BackTarget { href: string; label: string; phrase: string }

const BACK_NAMED: Record<string, { label: string; phrase: string }> = {
  '/all': { label: 'Explore', phrase: 'the reader' },
  '/news': { label: 'News', phrase: 'News' },
  '/new': { label: 'Newcomers', phrase: 'Newcomers' },
  '/favourites': { label: 'Favourites', phrase: 'Favourites' },
  '/deleted': { label: 'Deleted', phrase: 'Deleted' },
  '/search': { label: 'Search', phrase: 'the search results' },
};

const BACK_PREFIXED: [string, { label: string; phrase: string }][] = [
  ['/story/', { label: 'Story', phrase: 'the story record' }],
  ['/field/', { label: 'Fields', phrase: 'where you were' }],
  ['/company/', { label: 'Companies', phrase: 'where you were' }],
  ['/platform/', { label: 'Platforms', phrase: 'where you were' }],
  ['/trend/', { label: 'Trends', phrase: 'where you were' }],
];

/** A referer long enough to be an attack and not a filter is not a filter. */
const MAX_QUERY = 512;

export function backFrom(
  referer: string | null,
  fallback: BackTarget,
  ignore: string[] = [],
): BackTarget {
  if (!referer) return fallback;
  try {
    const u = new URL(referer, 'http://localhost');
    const path = u.pathname;
    if (ignore.some((p) => path === p || path.startsWith(p))) return fallback;
    const query = u.search.length > 1 && u.search.length <= MAX_QUERY ? u.search : '';

    const named = BACK_NAMED[path];
    if (named) return { href: path + query, ...named };

    for (const [prefix, names] of BACK_PREFIXED) {
      if (path.startsWith(prefix)) return { href: path + query, ...names };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

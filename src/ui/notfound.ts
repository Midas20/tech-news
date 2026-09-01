// The 404 page.
//
// A 404 used to be one line here: "That page does not exist." That was true and
// useless, and it became actively misleading the day retention started
// deleting stories. Most 404s on this site are now one of three quite different
// events, and telling someone the wrong one wastes their time:
//
//   1. A LINK TO A PRUNED STORY. /story/<uuid> for something collected in May.
//      The story was real, it was collected, and its analysis is still here --
//      what is gone is the row. Saying "does not exist" about something the
//      system deliberately deleted is the least helpful true sentence
//      available, so this case says what happened and where the trace went.
//   2. A MISTYPED OR STALE PATH. /stack, /favorites, /trend with no slug.
//      A suggestion is worth more than an apology, and the route table is
//      small enough to search exhaustively.
//   3. SOMETHING GENUINELY UNKNOWN. Then, and only then, the short answer.
//
// Nothing here queries by the id in the URL, because there is nothing left to
// query: the row is gone, and that is the whole point. What it CAN do is read
// the retention window and say, accurately, what happens to a story of that age.

import { one } from './db.ts';
import { getConfig } from '../config.ts';
import { escapeHtml, wrap, pageHead, icon } from './html.ts';
import {
  STREAM_ITEMS, EXPLORE_ITEMS, STACK_ITEMS, TOOL_ITEMS, PLATFORM_ITEMS,
  SYSTEM_ITEMS,
} from './nav.ts';

/** Everything this server will actually answer on, for the did-you-mean. */
const KNOWN: { path: string; label: string }[] = [
  ...STREAM_ITEMS.map((i) => ({ path: i.href, label: i.label })),
  ...EXPLORE_ITEMS.map((i) => ({ path: i.href, label: i.label })),
  ...STACK_ITEMS.map((i) => ({ path: i.href, label: i.label })),
  // Tools and Platforms are their own sections now; without these the 404
  // page stopped being able to suggest two of the seven top-level pages.
  ...TOOL_ITEMS.map((i) => ({ path: i.href, label: i.label })),
  ...PLATFORM_ITEMS.map((i) => ({ path: i.href, label: i.label })),
  ...SYSTEM_ITEMS.map((i) => ({ path: i.href, label: i.label })),
  { path: '/favourites', label: 'Favourites' },
  { path: '/trends', label: 'Trends' },
  { path: '/search', label: 'Search' },
  { path: '/', label: 'Overview' },
];

/**
 * Levenshtein distance, capped.
 *
 * Two rows of ints rather than a full matrix: the strings here are short route
 * names and this runs on a page nobody wanted to reach, so the cheap version is
 * the right one.
 */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * The closest routes to what was asked for.
 *
 * Threshold scales with length, so "/stak" finds "/stacks" while "/x" does not
 * match everything three letters long. A wrong suggestion is worse than none:
 * it sends someone confidently to the wrong page.
 */
export function suggestions(path: string, limit = 3): { path: string; label: string }[] {
  const want = path.replace(/\/+$/, '').toLowerCase() || '/';
  const scored = KNOWN
    .map((k) => ({ ...k, d: distance(want, k.path.toLowerCase()) }))
    .filter((k) => k.d <= Math.max(2, Math.floor(k.path.length / 3)))
    .sort((a, b) => a.d - b.d || a.path.length - b.path.length);

  // A path that merely CONTAINS a known route -- /stacks/rust -- is a better
  // guess than anything edit distance will find, so it goes first.
  const prefix = KNOWN
    .filter((k) => k.path !== '/' && want.startsWith(k.path.toLowerCase()))
    .sort((a, b) => b.path.length - a.path.length);

  const seen = new Set<string>();
  return [...prefix, ...scored]
    .filter((k) => (seen.has(k.path) ? false : (seen.add(k.path), true)))
    .slice(0, limit);
}

/** What the retention window currently means, in words the page can use. */
async function window(): Promise<{ months: number; kept: string | null; archived: number }> {
  const months = getConfig().retention.keepMonths;
  const r = await one<{ oldest: string | null; archived: string }>(
    `SELECT to_char(min(published_at), 'YYYY-MM-DD') AS oldest,
            (SELECT count(*) FROM rollup_log)::text AS archived
       FROM stories`).catch(() => null);
  return { months, kept: r?.oldest ?? null, archived: Number(r?.archived ?? 0) };
}

export interface NotFoundOpts {
  path: string;
  /** A story or reading URL whose id parsed, so the row is simply not here. */
  story?: boolean;
  /** Something looked up by slug that is not in the vocabulary. */
  missing?: { what: string; value: string };
}

export async function renderNotFound(opts: NotFoundOpts): Promise<string> {
  const near = suggestions(opts.path);
  const links = (items: { path: string; label: string }[]) =>
    items.map((n) => `<a class="btn" href="${escapeHtml(n.path)}">${escapeHtml(n.label)}</a>`)
      .join(' ');

  if (opts.story) {
    const w = await window();
    return wrap(`
      ${pageHead('That story is no longer held',
        'The link was valid. The row it pointed at has been reduced to analysis.')}
      <div class="notice">
        <p>This site keeps whole stories for
          <strong>${w.months === 1 ? 'one month' : `${w.months} months`}</strong>${
          w.kept ? `, currently back to <strong>${escapeHtml(w.kept)}</strong>` : ''}.
          Older ones are not thrown away — before anything is deleted, each month is
          reduced to per-technology, per-company and per-platform totals, plus the three
          most widely carried headlines for every technology that month. That covers
          <strong>${w.archived} months</strong> of history.</p>
        <p class="dim">So this story still counts towards every trend it was part of.
          What is gone is the ability to open it here — the original is still at its
          publisher, if the link you followed came from somewhere that kept it.</p>
      </div>
      <p class="acts">
        <a class="btn primary" href="/trends">${icon('trending', 13)} Technology trends</a>
        <a class="btn" href="/search">${icon('search', 13)} Search what is held</a>
        <a class="btn" href="/favourites">${icon('star', 13)} Favourites</a>
        <a class="btn" href="/all">${icon('stream', 13)} The reader</a>
      </p>
      <p class="note">To stop this happening to something you care about, star it. Anything
        on the favourites list is exempt from retention for as long as it stays there.</p>`);
  }

  if (opts.missing) {
    return wrap(`
      ${pageHead(`No ${escapeHtml(opts.missing.what)} called “${escapeHtml(opts.missing.value)}”`,
        'It is not in the vocabulary, and nothing here invents one.')}
      <p class="note">The registry is a closed vocabulary on purpose: an entry exists because
        it was curated or because discovery proposed it and it was accepted. A slug that is
        not in it has never been seen, rather than being hidden.</p>
      <p class="acts">
        <a class="btn primary" href="/search?q=${encodeURIComponent(opts.missing.value)}">
          ${icon('search', 13)} Search for “${escapeHtml(opts.missing.value)}”</a>
        <a class="btn" href="/stacks">Stacks</a>
        <a class="btn" href="/tools">Tools</a>
        <a class="btn" href="/concepts">Concepts</a>
        <a class="btn" href="/technologies">By category</a>
      </p>`);
  }

  return wrap(`
    ${pageHead('Not found', `Nothing answers on ${escapeHtml(opts.path)}.`)}
    ${near.length ? `<div class="notice">
        <p>Closest ${near.length === 1 ? 'match' : 'matches'}:</p>
        <p class="acts">${links(near)}</p>
      </div>` : ''}
    <p class="note">Every page on this site is reachable from the top bar and the rail —
      there are no hidden routes, so a path that is not one of these is a typo or a link
      from a version that no longer exists.</p>
    <p class="acts">
      <a class="btn primary" href="/">${icon('pulse', 13)} Overview</a>
      <a class="btn" href="/all">${icon('stream', 13)} The reader</a>
      <a class="btn" href="/trends">${icon('trending', 13)} Trends</a>
      <a class="btn" href="/search">${icon('search', 13)} Search</a>
    </p>`);
}

export const __test = { suggestions, distance };

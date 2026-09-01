// Favourites: the one thing retention is not allowed to take.
//
// Everything else here is a river. Stories arrive, they are held for as long as
// RETENTION_KEEP_MONTHS says -- two months since 2026-08-26 --
// and then they become a row in `stack_month` -- which is the right trade for
// news and the wrong one for the handful of things a person deliberately kept.
// A favourite is a claim on a story row, and `npm run retain` honours it.
//
// Un-favouriting does not delete. It writes `unfavourited_at` and starts a
// clock, because the click that releases a two-year-old story is the same size
// as the click that saved it, and only one of them is reversible if the row
// goes immediately. Inside the window the entry stays on this page, greyed,
// with the time remaining and a way back. Outside it, the next retention run
// takes both the favourite and the story.
//
// There is no user column. This reader binds to loopback and has no login, so
// inventing an owner for these rows would be inventing a fact. `saved_items`
// exists for the tenant-scoped Slack surface and is a different table for a
// different audience.

import { q, one } from './db.ts';
import { getConfig } from '../config.ts';
import { escapeHtml, wrap, pageHead, icon, empty, relativeTime } from './html.ts';
import { crumbsFor } from './nav.ts';
import { importanceTitle } from './filters.ts';

export type FavState = 'kept' | 'released' | 'none';

export interface FavRow {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source: string;
  collected: string;
  published: string | null;
  importance: number | null;
  stacks: string[];
  saved_at: string;
  unfavourited_at: string | null;
}

/** How long a released favourite -- and its story -- survives the release. */
export function graceHours(): number {
  return getConfig().retention.favouriteGraceHours;
}

/**
 * The state of many stories at once.
 *
 * Called with exactly the ids on the page being rendered, so a fifty-story
 * river costs one query rather than fifty. Ids that are not in the table are
 * simply absent from the map, which reads as 'none'.
 */
export async function favouriteState(ids: string[]): Promise<Map<string, FavState>> {
  const out = new Map<string, FavState>();
  if (ids.length === 0) return out;
  const rows = await q<{ story_id: string; released: boolean }>(
    `SELECT story_id::text, (unfavourited_at IS NOT NULL) AS released
       FROM favourites WHERE story_id = ANY($1::uuid[])`, [ids]);
  for (const r of rows) out.set(r.story_id, r.released ? 'released' : 'kept');
  return out;
}

export async function favouriteOne(id: string): Promise<FavState> {
  return (await favouriteState([id])).get(id) ?? 'none';
}

/** How many are currently kept. For the rail count. */
export async function favouriteCount(): Promise<number> {
  const r = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM favourites WHERE unfavourited_at IS NULL`);
  return Number(r?.n ?? 0);
}

/**
 * Save or release one story.
 *
 * Both directions are one statement with no read first, so two clicks racing
 * each other cannot interleave into a lost update. Saving an already-released
 * story clears the tombstone and keeps the original `saved_at`: the story was
 * never actually gone, and pretending it was just saved would throw away the
 * only record of how long it has been kept.
 */
export async function setFavourite(id: string, keep: boolean): Promise<FavState> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('not a story id');

  if (keep) {
    // Only for a story that still exists. Favouriting an id that retention
    // already took would create a claim on nothing, which the sweeper would
    // then have to clean up -- easier to never write it.
    const rows = await q<{ story_id: string }>(
      `INSERT INTO favourites (story_id)
       SELECT s.id FROM stories s WHERE s.id = $1::uuid
       ON CONFLICT (story_id) DO UPDATE SET unfavourited_at = NULL
       RETURNING story_id::text`, [id]);
    return rows.length ? 'kept' : 'none';
  }

  const rows = await q<{ story_id: string }>(
    `UPDATE favourites SET unfavourited_at = now()
      WHERE story_id = $1::uuid AND unfavourited_at IS NULL
      RETURNING story_id::text`, [id]);
  return rows.length ? 'released' : await favouriteOne(id);
}

/**
 * The button.
 *
 * A form, not a link: this changes something, and a GET that changes something
 * gets fired by every prefetcher and link-checker that walks the page. The
 * `return` field is what makes it work without JavaScript -- the POST redirects
 * back to where you were standing, filters and all. theme.ts upgrades it in
 * place when scripting is on.
 */
export function favButton(id: string, state: FavState, here: string, compact = true): string {
  const kept = state === 'kept';
  // One word for this idea, everywhere. "Keep" and "Kept" were a second name
  // for the same shelf, so the button, the rail and the page each called it
  // something slightly different.
  const label = kept ? 'Favourite — click to remove'
    : state === 'released' ? 'Removed — click to favourite again'
    : 'Add to favourites';
  return `<form class="fav${kept ? ' on' : ''}${state === 'released' ? ' off' : ''}"
      method="post" action="/favourite">
    <input type="hidden" name="id" value="${escapeHtml(id)}">
    <input type="hidden" name="keep" value="${kept ? '0' : '1'}">
    <input type="hidden" name="return" value="${escapeHtml(here)}">
    <button type="submit" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"
      aria-pressed="${kept}">${icon('star', compact ? 13 : 15)}${
      compact ? '' : `<span>${kept ? 'Favourite' : 'Favourite'}</span>`}</button>
  </form>`;
}

/** Whole hours left before a released favourite lapses, or 0 if it already has. */
export function hoursLeft(unfavouritedAt: string, now = Date.now()): number {
  const lapses = new Date(unfavouritedAt).getTime() + graceHours() * 3600_000;
  return Math.max(0, Math.ceil((lapses - now) / 3600_000));
}

function row(r: FavRow, now: number): string {
  const released = r.unfavourited_at !== null;
  const left = released ? hoursLeft(r.unfavourited_at!, now) : 0;
  const stacks = r.stacks.slice(0, 4)
    .map((s) => `<a class="chip" href="/all?stack=${encodeURIComponent(s)}">${escapeHtml(s)}</a>`)
    .join(' ');

  const fate = released
    ? `<span class="lapse${left === 0 ? ' now' : ''}">${left === 0
        ? 'removed at the next retention run'
        : `deletes in ${left} ${left === 1 ? 'hour' : 'hours'}`}</span>`
    : `<span class="held">kept ${escapeHtml(relativeTime(r.saved_at))}</span>`;

  return `<article class="item fav-item${released ? ' lapsing' : ''}">
    <div>
      <h2><a href="/story/${escapeHtml(r.id)}">${escapeHtml(r.title)}</a></h2>
      ${r.summary ? `<p class="sum">${escapeHtml(r.summary)}</p>` : ''}
      <div class="meta">
        <span class="src">${escapeHtml(r.source)}</span>
        <span class="dot"></span>
        <span title="${escapeHtml(r.collected)}">${escapeHtml(relativeTime(r.collected))}</span>
        <span class="dot"></span>
        ${fate}
        ${stacks}
        <a class="readbtn" href="/read/${escapeHtml(r.id)}"
          title="read the article here">${icon('book', 12)}read</a>
      </div>
    </div>
    <div class="side">
      <span class="sev${(r.importance ?? 0) >= 8 ? ' hi' : (r.importance ?? 0) >= 6 ? ' mid' : ''}"
        title="${escapeHtml(importanceTitle(r.importance))}">${r.importance ?? '–'}</span>
      ${favButton(r.id, released ? 'released' : 'kept', '/favourites', false)}
    </div>
  </article>`;
}

/**
 * The shelf.
 *
 * Kept first, then anything on its way out, because the second group is a
 * countdown and burying it under the first is how you find out it lapsed by
 * noticing the story is gone.
 */
export async function renderFavourites(url: URL): Promise<string> {
  const showLapsing = url.searchParams.get('show') !== 'kept';

  const rows = await q<FavRow>(
    `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title,
            s.summary_en AS summary, s.canonical_url AS url, src.name AS source,
            s.collected_at::text AS collected, s.published_at::text AS published,
            s.importance, s.stacks,
            f.saved_at::text, f.unfavourited_at::text
       FROM favourites f
       JOIN stories s ON s.id = f.story_id
       JOIN sources src ON src.id = s.source_id
      ${showLapsing ? '' : 'WHERE f.unfavourited_at IS NULL'}
      ORDER BY (f.unfavourited_at IS NOT NULL), f.saved_at DESC
      LIMIT 500`);

  const now = Date.now();
  const kept = rows.filter((r) => r.unfavourited_at === null);
  const lapsing = rows.filter((r) => r.unfavourited_at !== null);
  const hours = graceHours();
  const months = getConfig().retention.keepMonths;

  const oldest = kept.reduce<string | null>((acc, r) => {
    if (!r.published) return acc;
    return !acc || r.published < acc ? r.published : acc;
  }, null);

  const subtitle = `${kept.length} favourited`
    + (lapsing.length ? ` · ${lapsing.length} on the way out` : '')
    + (oldest ? ` · reaching back to ${escapeHtml(oldest.slice(0, 10))}` : '');

  return wrap(`
    ${pageHead('Favourites', subtitle, {
      crumbs: crumbsFor('/favourites', 'Favourites'),
    })}
    <p class="note">Stories here are exempt from retention: everything else is held for
      ${months === 1 ? 'a month' : `${months} months`}
      and then survives only as monthly analysis, but these stay whole for as long as they
      are on this list. Take one off and it is deleted ${hours === 24 ? 'a day'
        : `${hours} hours`} later — until then it sits below, and clicking the star
      again puts it back.</p>

    ${kept.length === 0 && lapsing.length === 0
      ? empty('No favourites yet. The star on any story adds it here.', 'star')
      : ''}

    ${kept.length ? `<h2 class="sect">Favourites</h2>
      ${kept.map((r) => row(r, now)).join('')}` : ''}

    ${lapsing.length ? `<h2 class="sect">Removed — deleting soon</h2>
      <p class="note">Still here, still readable. The next retention run takes whatever
        has run out of time.</p>
      ${lapsing.map((r) => row(r, now)).join('')}` : ''}
  `);
}

export const __test = { hoursLeft, row };

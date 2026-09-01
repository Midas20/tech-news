// Where the reader got to.
//
// A river without a read mark starts at the top every visit and leaves telling
// new from seen to memory. This is the third per-story state, and it is
// deliberately the weakest of the three:
//
//   favourite   keep this, exempt it from retention
//   delete      I do not want this, take it out of every list
//   read        I have seen this
//
// A read story stays where it is, in every list, marked. It is not a filter on
// the archive and not a soft delete -- "I read that" is not "I do not want
// that", and conflating them is how a reader loses something it meant to keep.
//
// MARKING HAPPENS ON OPENING, which is a state change on a GET and worth being
// honest about. Every feed reader does it because it is what readers expect,
// and the alternative -- a button you must press after reading -- is a button
// nobody presses. The cost is that a browser prefetching /read/<id> would mark
// something unread as read. The manual toggle is the way back, and it is on
// every row for exactly that reason.

import { q, one } from './db.ts';
import { escapeHtml } from './html.ts';
import { icon } from './theme.ts';

export type ReadState = 'unread' | 'read';

const ID = /^[0-9a-f-]{36}$/i;

export async function readState(id: string): Promise<ReadState> {
  if (!ID.test(id)) return 'unread';
  const row = await one<{ at: string | null }>(
    `SELECT read_at::text AS at FROM stories WHERE id = $1::uuid`, [id]);
  return row?.at ? 'read' : 'unread';
}

/**
 * Mark one story read or unread. Returns the state it ended in.
 *
 * Two statements rather than one with the assignment interpolated: SQL built by
 * string concatenation is the habit that eventually concatenates something that
 * came from a request, and these are two different operations anyway.
 */
export async function setRead(id: string, read: boolean): Promise<ReadState> {
  if (!ID.test(id)) throw new Error('not a story id');
  if (read) {
    await q(
      `UPDATE stories SET read_at = coalesce(read_at, now()) WHERE id = $1::uuid`, [id]);
    return 'read';
  }
  await q(`UPDATE stories SET read_at = NULL WHERE id = $1::uuid`, [id]);
  return 'unread';
}

/**
 * Mark read on the way to rendering the article.
 *
 * `coalesce(read_at, now())` rather than `now()`: re-opening something keeps
 * the moment it was first read, which is the only thing this column is for.
 */
export async function markRead(id: string): Promise<void> {
  if (!ID.test(id)) return;
  await q(
    `UPDATE stories SET read_at = coalesce(read_at, now())
      WHERE id = $1::uuid AND read_at IS NULL`, [id]);
}

/** How many collected stories have not been opened. */
export async function unreadCount(): Promise<number> {
  const row = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM stories
      WHERE read_at IS NULL AND dismissed_at IS NULL AND superseded_by IS NULL
        AND coalesce(is_tech, true)`);
  return Number(row?.n ?? 0);
}

/** Mark everything currently unread as read. The "I am caught up" gesture. */
export async function markAllRead(): Promise<number> {
  const rows = await q<{ id: string }>(
    `UPDATE stories SET read_at = now()
      WHERE read_at IS NULL AND dismissed_at IS NULL AND superseded_by IS NULL
      RETURNING id::text`);
  return rows.length;
}

/**
 * The toggle.
 *
 * Quieter than the star and louder than the delete: it is the control a reader
 * uses most often and the one whose state they most need to see at a glance,
 * so unlike delete it is visible without hovering.
 */
export function readButton(id: string, state: ReadState, here: string): string {
  const read = state === 'read';
  const label = read ? 'Read — click to mark unread' : 'Mark as read';
  return `<form class="rd${read ? ' on' : ''}" method="post" action="/read-state">
    <input type="hidden" name="id" value="${escapeHtml(id)}">
    <input type="hidden" name="read" value="${read ? '0' : '1'}">
    <input type="hidden" name="return" value="${escapeHtml(here)}">
    <button type="submit" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"
      aria-pressed="${read}">${icon(read ? 'check' : 'circle', 13)}</button>
  </form>`;
}

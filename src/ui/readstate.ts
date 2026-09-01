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

/**
 * READ STATE BELONGS TO AN ACCOUNT.
 *
 * This used to be `stories.read_at` -- one timestamp per story, so opening an
 * article marked it read for everybody who would ever sign in. It was written
 * when the reader ran on loopback and there was one person, and 0070 moved it
 * to `story_reads`, a row per account per story.
 *
 * Every function here now takes the account first. That is deliberately not
 * optional: an omitted argument would silently mean "somebody", and the whole
 * point is that there is no such reader.
 */
export async function readState(accountId: string, id: string): Promise<ReadState> {
  if (!ID.test(id) || !ID.test(accountId)) return 'unread';
  const row = await one<{ at: string | null }>(
    `SELECT read_at::text AS at FROM story_reads
      WHERE account_id = $1::uuid AND story_id = $2::uuid`, [accountId, id]);
  return row?.at ? 'read' : 'unread';
}

/**
 * Mark one story read or unread, for one account. Returns the state it ended in.
 */
export async function setRead(accountId: string, id: string, read: boolean): Promise<ReadState> {
  if (!ID.test(id) || !ID.test(accountId)) throw new Error('not a story id');
  if (read) {
    // ON CONFLICT DO NOTHING keeps the moment it was FIRST read, which is the
    // only thing this timestamp is for. Re-opening does not reset it.
    await q(
      `INSERT INTO story_reads (account_id, story_id) VALUES ($1::uuid, $2::uuid)
       ON CONFLICT DO NOTHING`, [accountId, id]);
    return 'read';
  }
  await q(`DELETE FROM story_reads WHERE account_id = $1::uuid AND story_id = $2::uuid`,
          [accountId, id]);
  return 'unread';
}

/** Mark read on the way to rendering the article. */
export async function markRead(accountId: string, id: string): Promise<void> {
  if (!ID.test(id) || !ID.test(accountId)) return;
  await q(
    `INSERT INTO story_reads (account_id, story_id) VALUES ($1::uuid, $2::uuid)
     ON CONFLICT DO NOTHING`, [accountId, id]);
}

/** How many collected stories THIS ACCOUNT has not opened. */
export async function unreadCount(accountId: string): Promise<number> {
  if (!ID.test(accountId)) return 0;
  const row = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM stories s
      WHERE NOT EXISTS (SELECT 1 FROM story_reads r
                         WHERE r.account_id = $1::uuid AND r.story_id = s.id)
        AND s.dismissed_at IS NULL AND s.superseded_by IS NULL
        AND coalesce(s.is_tech, true)`, [accountId]);
  return Number(row?.n ?? 0);
}

/** Mark everything currently unread as read, for this account. */
export async function markAllRead(accountId: string): Promise<number> {
  if (!ID.test(accountId)) return 0;
  const rows = await q<{ id: string }>(
    `INSERT INTO story_reads (account_id, story_id)
     SELECT $1::uuid, s.id FROM stories s
      WHERE s.dismissed_at IS NULL AND s.superseded_by IS NULL
        AND NOT EXISTS (SELECT 1 FROM story_reads r
                         WHERE r.account_id = $1::uuid AND r.story_id = s.id)
     ON CONFLICT DO NOTHING
     RETURNING story_id::text AS id`, [accountId]);
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

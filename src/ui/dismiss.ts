// Getting rid of a story.
//
// WHY THIS IS NOT A DELETE, in one place, because the button says delete and
// somebody will come looking for the DELETE statement.
//
// The archive's contract is that news lives a month and analysis lives for
// ever. `stack_totals`, `coverage_snapshots` and the month rollups are derived
// from stories, and a settled month is never recomputed. Remove the row after
// its month is rolled up and every aggregate counts something that is not
// there; remove it before, and a number the reader has already read silently
// changes. Neither is a delete. Both are corruption with a friendly name.
//
// So the row stays and stops being shown -- the same shape `superseded_by`
// already uses for a merge and `is_tech` for off-topic. What the reader gets is
// what the reader asked for: it is gone from every view, and it can come back.
//
// A favourite is released on the way out. Keeping a story and getting rid of it
// are contradictory instructions and the newer one wins; leaving it starred on
// a shelf the reader cannot see is the worse of the two.

import { q, one } from './db.ts';
import { escapeHtml } from './html.ts';
import { icon } from './theme.ts';

export type DismissState = 'live' | 'dismissed';

const ID = /^[0-9a-f-]{36}$/i;

export async function dismissState(id: string): Promise<DismissState> {
  if (!ID.test(id)) return 'live';
  const row = await one<{ at: string | null }>(
    `SELECT dismissed_at::text AS at FROM stories WHERE id = $1::uuid`, [id]);
  return row?.at ? 'dismissed' : 'live';
}

/**
 * Dismiss a story, or bring it back.
 *
 * Returns the state it ended in, so a caller that lost a race reports what is
 * true rather than what it asked for.
 */
export async function setDismissed(
  id: string, gone: boolean, reason?: string,
): Promise<DismissState> {
  if (!ID.test(id)) throw new Error('not a story id');

  if (gone) {
    const rows = await q<{ id: string }>(
      `UPDATE stories SET dismissed_at = now(), dismissed_reason = $2
        WHERE id = $1::uuid AND dismissed_at IS NULL
        RETURNING id::text`, [id, reason?.slice(0, 500) || null]);
    // Already dismissed is success, not a failure: the reader wanted it gone
    // and it is gone.
    if (rows.length === 0) return await dismissState(id);
    await q(`UPDATE favourites SET unfavourited_at = now()
              WHERE story_id = $1::uuid AND unfavourited_at IS NULL`, [id]);
    return 'dismissed';
  }

  await q(`UPDATE stories SET dismissed_at = NULL, dismissed_reason = NULL
            WHERE id = $1::uuid`, [id]);
  return 'live';
}

export async function dismissedCount(): Promise<number> {
  const row = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM stories
      WHERE dismissed_at IS NOT NULL AND superseded_by IS NULL`);
  return Number(row?.n ?? 0);
}

/**
 * The button.
 *
 * A form and a POST, matching the star beside it: it changes something, and it
 * has to work with JavaScript off. `return` brings the reader back to the exact
 * list they were reading, which is the whole point of dismissing from a row
 * rather than from a settings page.
 */
export function dismissButton(id: string, state: DismissState, here: string): string {
  const gone = state === 'dismissed';
  const label = gone
    ? 'Deleted — click to put it back'
    : 'Delete this story: hide it from every list';
  return `<form class="dis${gone ? ' on' : ''}" method="post" action="/dismiss">
    <input type="hidden" name="id" value="${escapeHtml(id)}">
    <input type="hidden" name="gone" value="${gone ? '0' : '1'}">
    <input type="hidden" name="return" value="${escapeHtml(here)}">
    <button type="submit" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${
      icon(gone ? 'undo' : 'trash', 13)}</button>
  </form>`;
}

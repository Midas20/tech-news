// Which months the archive still keeps whole.
//
// One rule, read by three things that each used to carry their own copy:
//
//   collect/ingest.ts   what it will accept        isTooOld, isArchived
//   maintain/rollup.ts  what it will settle        currentMonth
//   maintain/retain.ts  what it will delete        the SQL cutoff
//
// They agreed on the arithmetic and disagreed on the boundary, and that gap
// cost the archive a month. `retain` measures from the start of a calendar
// month keepMonths back, so with keepMonths=2 on 28 August the window is July
// and August. `rollup` refused only the CURRENT month, so it settled July --
// and a settled month is closed to ingest, so every source spent a month
// fetching July's items and keeping none of them. Measured on 2026-08-28: 557
// July items sitting in 50 live feeds, one July story in the archive.
//
// The rule that removes the gap is a sentence, not a special case:
//
//   A MONTH INSIDE THE RETENTION WINDOW IS OPEN. It may be collected into, it
//   may not be rolled up, and it may not be pruned.
//
// The current-month exemption that used to be written by hand falls out of it:
// the current month is always inside the window, because the window ends at
// the month you are standing in.
//
// KEEP_FOREVER (keepMonths = 0) is the window with no far edge, set on the
// user's instruction of 2026-08-29: "don't remove anyone anymore". It is not a
// bigger number -- a bigger number still has a date on which something is
// deleted -- so it is its own value, and each of the three readers is told what
// it means in its own terms:
//
//   collect   nothing is ever too old to accept, at any publication date
//   rollup    unchanged: every month before this one still settles into analysis
//   retain    deletes no stories at all, and says so in its report
//
// AND IT REOPENS EVERY SETTLED MONTH TO INGEST. This was written the other way
// first -- keep-forever spared the past but left it closed -- and that was
// wrong, measured 2026-08-29: May, June and July were all in `rollup_log`, so
// setting keepMonths to 0 narrowed the collectable window from four months to
// one and refused 86,000 items every six hours as `already_archived`. The
// instruction being served was "collect news in may, june, july, august".
//
// The reason a settled month was ever closed is that its stories were about to
// be PRUNED: storing into it would put a row in a month whose totals are final
// and whose contents are leaving. Under KEEP_FOREVER nothing leaves, so that
// reason is gone. What remains is that the month's analysis is stale until it
// is rolled again -- and stale analysis can be recomputed, while a refused
// story is gone for good.

/**
 * The first month the archive still keeps whole, as a UTC month start.
 *
 * Calendar months, not a rolling ninety days: with a rolling window the
 * archive holds a few hours of news at midnight on the 1st. `keepMonths - 1`
 * because the current month is one of them -- keepMonths=1 means this month
 * only, keepMonths=2 means this month and last.
 */
export const KEEP_FOREVER = 0;

/** Is this configuration the window with no far edge? */
export function keepsForever(keepMonths: number): boolean {
  return keepMonths === KEEP_FOREVER;
}

export function retentionCutoff(keepMonths: number, now: Date = new Date()): Date {
  // A window with no far edge has no cutoff. Returning the start of the current
  // month keeps `isOpenMonth` meaning what rollup needs it to mean -- this month
  // is open, every earlier one may settle -- while `isTooOld` short-circuits
  // before it ever asks, so nothing is refused for its age.
  if (keepsForever(keepMonths)) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (keepMonths - 1), 1));
}

/** A date as the UTC month it falls in, 'YYYY-MM'. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Is this month still open -- inside the window, still collectable, not yet
 * settled?
 *
 * Accepts a Date or a 'YYYY-MM' string, because the collector holds publication
 * dates and the rollup holds month keys, and converting at every call site is
 * how the two drifted apart in the first place.
 */
export function isOpenMonth(
  month: Date | string, keepMonths: number, now: Date = new Date(),
): boolean {
  const start = typeof month === 'string'
    ? new Date(`${month.slice(0, 7)}-01T00:00:00Z`)
    : new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  return start.getTime() >= retentionCutoff(keepMonths, now).getTime();
}

/**
 * Older than the archive is allowed to be.
 *
 * The complement of isOpenMonth for a single item, kept as its own name because
 * the collector asks it about an item's publication date and reads better for
 * saying so. An undated item is treated as current: refusing it would drop live
 * news from every feed that omits a date.
 */
/**
 * Is this month closed to new stories?
 *
 * A month is closed when it has been settled into analysis AND its stories are
 * subject to deletion. Under KEEP_FOREVER the second half is never true, so no
 * month is ever closed -- see the note at the top of this file.
 */
export function isClosedToIngest(
  monthIsRolled: boolean, keepMonths: number,
): boolean {
  if (keepsForever(keepMonths)) return false;
  return monthIsRolled;
}

export function isTooOld(
  publishedAt: Date | null | undefined, keepMonths: number, now: Date = new Date(),
): boolean {
  if (!publishedAt) return false;
  // Nothing is too old for an archive that deletes nothing. This is the half of
  // KEEP_FOREVER that widens the beat rather than merely sparing it: a report
  // about how a market grew wants the months before the ones already held.
  if (keepsForever(keepMonths)) return false;
  return publishedAt.getTime() < retentionCutoff(keepMonths, now).getTime();
}

/**
 * How many months of partitions to keep behind the current one.
 *
 * NOT the same number as the retention window, and the difference is the whole
 * point. `stories` is partitioned by month and a missing partition FAILS an
 * insert rather than degrading it, so this number has to cover what is
 * COLLECTED. The window covers what is KEPT, and under KEEP_FOREVER it stops
 * describing collection at all: `ensure_partitions(0, 3)` would build nothing
 * behind this month, and the first story published in August that arrived in
 * September would fail to land, with an error nobody is watching for.
 *
 * That is the same shape as the bug migration 0062 fixed -- two places that
 * must agree about a range, only one of which was told when it changed -- so it
 * is written once, here, and read by both schedulers.
 *
 * The backstop is generous on purpose: an unnecessary partition costs an empty
 * table, and being wrong the other way costs collected news.
 */
export function partitionMonthsBack(keepMonths: number, backstop = 24): number {
  return keepsForever(keepMonths) ? backstop : Math.max(keepMonths, 1);
}

/**
 * The offset the SQL cutoffs subtract, as a number of months.
 *
 * `keepMonths - 1` everywhere, EXCEPT that KEEP_FOREVER would make it -1 --
 * subtracting a negative interval, which moves the boundary FORWARD into next
 * month and settles the month still being collected into. That is the 0060 bug
 * exactly, arriving from the other direction: the rollup and the collector
 * disagreeing about which month is finished.
 *
 * Clamped at 0, which puts the boundary at the start of the current month and
 * makes the SQL agree with isOpenMonth(month, 0) -- this month open, every
 * earlier month free to settle.
 */
export function monthOffset(keepMonths: number): number {
  return Math.max(keepMonths - 1, 0);
}

// The window the archive keeps whole.
//
// Three parts of the system decide what "old" means, and they used to decide it
// separately:
//
//   collect/ingest.ts   what it will accept
//   maintain/rollup.ts  what it will settle
//   maintain/retain.ts  what it will delete
//
// They agreed on the arithmetic and disagreed on the boundary. `retain` counts
// calendar months back from this one; `rollup` refused only the CURRENT month,
// so with RETENTION_KEEP_MONTHS=2 it settled July while retention was still
// keeping July -- and a settled month is closed to ingest. The collector spent
// two days refusing half its own window while every source reported itself
// healthy, because `items_kept: 0` from a working feed looks exactly like a
// quiet one.
//
// Measured on 2026-08-28, before the fix: 557 July items on offer across the 50
// live feeds, and one July story held.
//
// So the tests below are mostly one assertion said three ways: a month inside
// the window is open, and every gate agrees it is open.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  keepsForever, partitionMonthsBack, monthOffset, isClosedToIngest,
  retentionCutoff, isOpenMonth, isTooOld, monthKey,
} from '../src/lib/retention.ts';
import { __test as ingestTest } from '../src/collect/ingest.ts';

const { isArchived } = ingestTest;
const NOW = new Date('2026-08-28T00:00:00Z');

describe('the window', () => {
  it('is calendar months, not a rolling ninety days', () => {
    // A rolling window leaves the archive holding a few hours of news at
    // midnight on the 1st. keepMonths counts the month you are standing in.
    expect(retentionCutoff(2, NOW).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(retentionCutoff(1, NOW).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(retentionCutoff(3, NOW).toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('crosses a year boundary by month arithmetic, not by subtraction', () => {
    const jan = new Date('2027-01-10T00:00:00Z');
    expect(retentionCutoff(2, jan).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('holds two months open when keepMonths is two', () => {
    expect(isOpenMonth('2026-08', 2, NOW)).toBe(true);
    expect(isOpenMonth('2026-07', 2, NOW)).toBe(true);
    expect(isOpenMonth('2026-06', 2, NOW)).toBe(false);
  });

  it('holds only this month open when keepMonths is one', () => {
    expect(isOpenMonth('2026-08', 1, NOW)).toBe(true);
    expect(isOpenMonth('2026-07', 1, NOW)).toBe(false);
  });

  it('answers for a Date and a month key alike', () => {
    // The collector holds publication dates and the rollup holds month keys.
    // Converting at every call site is how the two drifted apart.
    expect(isOpenMonth(new Date('2026-07-31T23:59:59Z'), 2, NOW)).toBe(true);
    expect(isOpenMonth(new Date('2026-06-30T23:59:59Z'), 2, NOW)).toBe(false);
  });

  it('zero-pads the month, so June is not 2026-6', () => {
    expect(monthKey(new Date('2026-06-10T00:00:00Z'))).toBe('2026-06');
  });
});

describe('older than the archive is allowed to be', () => {
  it('refuses a story from before the window', () => {
    // A feed carrying its whole history -- Vercel's carries 1,524 entries --
    // walks straight through the gaps in rollup_log, and what lands is
    // unreachable in both directions: too old to read, and un-prunable, since
    // retention will not delete a story from a month no rollup recorded.
    // Measured after one full re-read: 17 rows, oldest 2006-02-15.
    expect(isTooOld(new Date('2006-02-15T00:00:00Z'), 2, NOW)).toBe(true);
    expect(isTooOld(new Date('2026-06-30T23:59:59Z'), 2, NOW)).toBe(true);
  });

  it('keeps everything inside the window', () => {
    expect(isTooOld(new Date('2026-07-01T00:00:00Z'), 2, NOW)).toBe(false);
    expect(isTooOld(new Date('2026-08-28T00:00:00Z'), 2, NOW)).toBe(false);
    expect(isTooOld(new Date('2026-07-01T00:00:00Z'), 1, NOW)).toBe(true);
  });

  it('treats an undated item as current', () => {
    // Refusing these would drop live news from every feed with no date, which
    // is a much worse failure than admitting the occasional old one.
    expect(isTooOld(null, 2, NOW)).toBe(false);
    expect(isTooOld(undefined, 2, NOW)).toBe(false);
  });

  it('agrees with isOpenMonth on the boundary, to the second', () => {
    // The two are complements. If they ever disagree, a story is either
    // collected into a month the pruner deletes or refused from one it keeps.
    for (const iso of ['2026-06-30T23:59:59Z', '2026-07-01T00:00:00Z',
                       '2026-07-31T23:59:59Z', '2026-08-01T00:00:00Z']) {
      const d = new Date(iso);
      expect(isTooOld(d, 2, NOW), iso).toBe(!isOpenMonth(d, 2, NOW));
    }
  });
});

describe('a month that has been rolled up', () => {
  const rolled = new Set(['2026-06', '2026-07', '2026-08']);

  it('is refused once it has left the window', () => {
    expect(isArchived(rolled, new Date('2026-06-15T00:00:00Z'), 2, NOW)).toBe(true);
  });

  it('is NOT refused while it is still inside the window', () => {
    // The regression this whole file exists for. July was rolled up by hand on
    // 2026-08-26 to satisfy the delete guard, and with keepMonths=2 that closed
    // half the archive's window: 557 items on offer, one story held.
    expect(isArchived(rolled, new Date('2026-07-15T00:00:00Z'), 2, NOW)).toBe(false);
  });

  it('is never the month in progress, which the old rule got right', () => {
    expect(isArchived(rolled, new Date('2026-08-20T00:00:00Z'), 2, NOW)).toBe(false);
    expect(isArchived(rolled, new Date('2026-08-20T00:00:00Z'), 1, NOW)).toBe(false);
  });

  it('still closes July when the window really is one month', () => {
    // Not "never refuse July" -- refuse it exactly when retention has let go of
    // it. With keepMonths=1 the old behaviour is the correct behaviour.
    expect(isArchived(rolled, new Date('2026-07-15T00:00:00Z'), 1, NOW)).toBe(true);
  });

  it('admits a month the rollup skipped, however old', () => {
    // Not a cutoff: rollup_log has gaps -- 215 rows between 2006-02 and 2026-08
    // -- and a date comparison would wrongly reject a month it never recorded.
    // isTooOld is what refuses those, separately and for a different reason.
    expect(isArchived(rolled, new Date('2026-05-20T00:00:00Z'), 2, NOW)).toBe(false);
  });

  it('treats an undated item as current', () => {
    expect(isArchived(rolled, null, 2, NOW)).toBe(false);
    expect(isArchived(rolled, undefined, 2, NOW)).toBe(false);
  });
});

describe('the rollup', () => {
  const src = readFileSync(new URL('../src/maintain/rollup.ts', import.meta.url), 'utf8');

  it('refuses to settle a month that is still open', () => {
    // The other end of the same rule. Fixing only the collector would leave the
    // next rollup free to close July again on the next run.
    expect(src).toContain('await isOpen(db, opts.month)');
  });

  it('picks up only months outside the window', () => {
    expect(src).toContain("make_interval(months => $1::int)");
    // Was the literal `keepMonths - 1`. It is monthOffset() now, because that
    // expression evaluates to -1 under KEEP_FOREVER and a negative interval
    // moves the boundary forward into next month. Same rule, one place.
    expect(src).toContain('monthOffset(getConfig().retention.keepMonths)');
  });

  it('asks the database for the time, not the process', () => {
    // The pruner computes its cutoff in SQL. An hour of clock skew on the 1st
    // would settle a month the pruner still protects.
    expect(src).toContain("SELECT now()::text AS now");
  });
});

describe('the partitions', () => {
  // stories is partitioned by month, and a missing partition does not degrade
  // an insert -- it fails it. Both callers passed a literal 1 month back, which
  // was a promise the archive could not keep the moment the window widened:
  // opening it to four months to collect May 2026 found that stories_2026_05
  // did not exist and nothing would ever have created it.
  it('reach back as far as the window does, not a fixed month', () => {
    for (const f of ['../src/run/jobs.ts', '../src/workers/cron.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).toContain("ensure_partitions($1, 3)");
      expect(src, f).toContain('getConfig().retention.keepMonths');
      expect(src, f).not.toContain('ensure_partitions(1, 3)');
    }
  });
});

describe('a URL claimed by a story that no longer exists', () => {
  const src = readFileSync(new URL('../src/db/repos/stories.ts', import.meta.url), 'utf8');

  it('does not count as held', () => {
    // 71,274 of 73,286 url keys pointed at deleted stories two days after the
    // registry was emptied. Each one refused its address as a duplicate,
    // permanently: 374 items inside the window could never be collected again.
    const at = src.indexOf('export async function findManyByUrl');
    expect(src.slice(at, at + 2000))
      .toContain('EXISTS (SELECT 1 FROM stories s WHERE s.id = k.story_id)');
  });

  it('does not count as held on the single lookup either', () => {
    const at = src.indexOf('export async function findByUrl');
    expect(src.slice(at, at + 700))
      .toContain('EXISTS (SELECT 1 FROM stories s WHERE s.id = k.story_id)');
  });

  it('is swept by retention however the story was deleted', () => {
    // story_keys was cleaned by joining to the stories retention itself was
    // deleting, so every OTHER way of deleting a story left its claims behind:
    // a registry reset, a merge, a hand-written DELETE. Sweeping by absence as
    // well costs one statement and closes all of them.
    const retain = readFileSync(new URL('../src/maintain/retain.ts', import.meta.url), 'utf8');
    const after = retain.slice(retain.indexOf('const afterStories'));
    expect(after).toContain('DELETE FROM story_keys k');
    expect(after).toContain('NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = k.story_id)');
  });

  it('is taken over by the next claim rather than lost', () => {
    // Deleting stories is normal -- retention does it every month -- so the
    // collector has to survive it, not be repaired afterwards by a migration.
    const at = src.indexOf('export async function claimUrls');
    const body = src.slice(at, at + 2000);
    expect(body).toContain('ON CONFLICT (key_hash) DO UPDATE');
    expect(body).toContain('WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = story_keys.story_id)');
  });
});

// The window with no far edge.
//
// Asked for on 2026-08-29: "don't remove anyone anymore". It is deliberately a
// separate value rather than a large keepMonths, because a large number still
// names a date on which something is deleted, and the instruction was that no
// such date exists.
//
// The danger this guards is specific and was three days away when it was
// written. RETENTION_KEEP_MONTHS was 4, the archive held May through August,
// and `retain` runs unattended at 03:40 daily. On 1 September the window would
// have rolled to June-September and May's 325 stories would have been deleted
// by a scheduled job, with nobody watching and no way back.
describe('keeping everything', () => {
  it('treats 0 as keep-forever, not as an invalid month count', () => {
    expect(keepsForever(0)).toBe(true);
    expect(keepsForever(1)).toBe(false);
    expect(keepsForever(4)).toBe(false);
  });

  it('finds nothing too old to collect, at any age', () => {
    // The half that widens the beat: a report about how a market grew wants the
    // months before the ones already held.
    const now = new Date('2026-08-29T00:00:00Z');
    for (const old of ['2026-05-01', '2025-01-01', '2009-06-01', '1999-12-31']) {
      expect(isTooOld(new Date(`${old}T00:00:00Z`), 0, now), old).toBe(false);
    }
    // And the same dates under a real window are still refused, so this is a
    // property of the setting rather than a hole in the function.
    expect(isTooOld(new Date('2026-04-01T00:00:00Z'), 4, now)).toBe(true);
  });

  it('leaves the rollup boundary alone, so analysis keeps being written', () => {
    // Keep-forever must not mean "every month is open", which would stop rollup
    // settling anything and quietly end the analysis that outlives the stories.
    const now = new Date('2026-08-29T00:00:00Z');
    expect(isOpenMonth('2026-08', 0, now), 'this month is open').toBe(true);
    expect(isOpenMonth('2026-07', 0, now), 'last month may settle').toBe(false);
    expect(isOpenMonth('2026-01', 0, now), 'and so may any earlier one').toBe(false);
  });

  it('is what the pruner is told, and the pruner refuses to delete', () => {
    const src = readFileSync(new URL('../src/maintain/retain.ts', import.meta.url), 'utf8');
    // The delete loop does not run at all -- not a cutoff so old it matches
    // nothing, which would match something again next month.
    expect(src).toContain('for (; !forever;)');
    // And no month is stamped as pruned when nothing was pruned from it.
    expect(src).toContain('for (const m of forever ? [] : safe)');
    // 0 is accepted where it used to throw.
    expect(src).toContain('opts.keepMonths < 0');
    expect(src).not.toContain('opts.keepMonths < 1');
  });

  it('says so in the log line, rather than reading as a quiet night', () => {
    const src = readFileSync(new URL('../src/maintain/retain.ts', import.meta.url), 'utf8');
    expect(src).toContain('none deleted (keep forever)');
  });

  it('is the default, so forgetting to configure it cannot lose a month', () => {
    const src = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
    expect(src).toContain("num(env, 'RETENTION_KEEP_MONTHS', 0)");
  });
});

// Partitions follow COLLECTION, not the window.
//
// The third instance of one shape: two places that must agree about a range,
// only one of which is told when it changes. 0060 was the collector and the
// pruner; 0062 was the partition maker and the window; this is the partition
// maker and the window coming apart again, in the other direction, the moment
// the window stopped describing collection at all.
describe('the partition range under keep-forever', () => {
  it('does not follow the window to zero', () => {
    // ensure_partitions(0, 3) builds nothing behind this month, and a missing
    // partition fails the INSERT rather than degrading it.
    expect(partitionMonthsBack(0)).toBeGreaterThanOrEqual(12);
  });

  it('still follows a real window when one is set', () => {
    expect(partitionMonthsBack(4)).toBe(4);
    expect(partitionMonthsBack(2)).toBe(2);
    expect(partitionMonthsBack(1)).toBe(1);
  });

  it('is what both schedulers actually pass', () => {
    for (const f of ['../src/run/jobs.ts', '../src/workers/cron.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).toContain('partitionMonthsBack(getConfig().retention.keepMonths)');
      expect(src, f).not.toMatch(/ensure_partitions\(\$1, 3\)',\s*\n?\s*\[getConfig\(\)\.retention\.keepMonths\]/);
    }
  });
});

// The SQL offset and the JS boundary, which must not disagree again.
describe('the month offset the SQL cutoffs use', () => {
  it('never goes negative, which would settle the month being collected', () => {
    // keepMonths - 1 is -1 under KEEP_FOREVER, and subtracting a negative
    // interval moves the boundary FORWARD into next month -- so `pendingMonths`
    // would hand the rollup the CURRENT month. That is the 0060 bug arriving
    // from the other direction.
    expect(monthOffset(0)).toBe(0);
    expect(monthOffset(1)).toBe(0);
    expect(monthOffset(2)).toBe(1);
    expect(monthOffset(4)).toBe(3);
  });

  it('agrees with isOpenMonth about which month is still open', () => {
    // Offset 0 puts the SQL boundary at the start of this month; isOpenMonth
    // says this month is open and every earlier one may settle. Same sentence,
    // two dialects -- which is the whole point of lib/retention.ts.
    const now = new Date('2026-08-29T00:00:00Z');
    expect(monthOffset(0)).toBe(0);
    expect(isOpenMonth('2026-08', 0, now)).toBe(true);
    expect(isOpenMonth('2026-07', 0, now)).toBe(false);
  });

  it('is what both cutoffs actually call', () => {
    for (const f of ['../src/maintain/rollup.ts', '../src/maintain/retain.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).toContain('monthOffset(');
      expect(src, f).not.toMatch(/keepMonths - 1\]/);
    }
  });
});

// Keep-forever must not narrow what can be COLLECTED.
//
// The regression, 2026-08-29: setting RETENTION_KEEP_MONTHS=0 to stop deletion
// also closed May, June and July to ingest, because all three sit in
// `rollup_log` and isOpenMonth(m, 0) is true only for the current month. The
// collectable window went from four months to one, and 86,000 items every six
// hours were refused as `already_archived` -- while the standing instruction
// was "collect news in may, june, july, august".
//
// A settled month was only ever closed because its stories were about to be
// PRUNED. Nothing is pruned now, so the reason is gone. What is left is a stale
// rollup, and a stale rollup can be recomputed while a refused story cannot.
describe('a settled month under keep-forever', () => {
  it('is open to ingest again', () => {
    expect(isClosedToIngest(true, 0)).toBe(false);
  });

  it('is still closed when a real window is set, because pruning still happens', () => {
    expect(isClosedToIngest(true, 4)).toBe(true);
    expect(isClosedToIngest(true, 1)).toBe(true);
  });

  it('is not closed if it was never rolled', () => {
    expect(isClosedToIngest(false, 4)).toBe(false);
  });

  it('is what isArchived actually asks', () => {
    const src = readFileSync(new URL('../src/collect/ingest.ts', import.meta.url), 'utf8');
    expect(src).toContain('isClosedToIngest(true, keepMonths)');
  });

  it('and the collector marks it dirty so the analysis is redone', () => {
    // The trade this makes: a late arrival leaves the month understating
    // itself. Marked rather than recomputed inline, because rolling a month is
    // minutes of work and a poll cycle is seconds.
    const src = readFileSync(new URL('../src/collect/ingest.ts', import.meta.url), 'utf8');
    expect(src).toContain('UPDATE rollup_log SET dirty_at = now()');
  });

  it('but a PRUNED month is never re-rolled, dirty or not', () => {
    // Written the other way first, and it would have destroyed the one thing
    // the retention contract cannot re-derive. rollMonth is a delete-then-
    // insert; for a pruned month the surviving rows are a FRAGMENT of what the
    // analysis was computed from. 2026-04 holds 333 stories and its stack_month
    // says 23,561, because it was rolled while the archive still had them.
    // Re-rolling would have replaced the record with the fragment.
    const src = readFileSync(new URL('../src/maintain/rollup.ts', import.meta.url), 'utf8');
    expect(src).toContain('A PRUNED MONTH IS NEVER RE-ROLLED');
    expect(src).not.toContain('AND l.dirty_at IS NULL)');
  });

  it('so dirty_at is a record of understatement, not a trigger', () => {
    // The cost that leaves: a late arrival into a pruned month is held and
    // displayed but not counted in that month's analysis. An understatement of
    // history, recoverable by looking at the stories -- where the alternative
    // was an unrecoverable loss.
    const src = readFileSync(new URL('../src/collect/ingest.ts', import.meta.url), 'utf8');
    expect(src).toContain('UPDATE rollup_log SET dirty_at = now()');
  });
});

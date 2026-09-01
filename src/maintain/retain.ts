// Keep the window. Delete the rest, once the analysis is safe.
//
// The body of scripts/retain.ts, moved here so the scheduler and the command run
// the same code -- see the note at the top of rollup.ts for why that matters.
//
// The order is not negotiable: roll up, verify, then delete. Stories are the
// only copy, so this refuses to touch any month that `rollup_log` does not
// record, and re-checks that the month's aggregate rows actually exist rather
// than trusting the log alone.
//
// FAVOURITES ARE EXEMPT. A story on the favourites list is never deleted, at any
// age. A story taken OFF the list is deleted once its grace window has passed --
// which is what `lapsedOnly` is for: the window expires on its own schedule
// rather than on retention's, and a daily sweep is what makes "deleted a day
// later" true rather than "deleted at the next monthly prune".
//
// WHAT CHANGED WHEN THIS BECAME AUTOMATIC
//
// `VACUUM FULL` rewrites a table under an ACCESS EXCLUSIVE lock -- every read of
// `stories` blocks for its duration. That is a fine trade for a command a person
// runs while watching it, and an outage when a scheduler starts it at 03:40
// without telling anybody. So reclamation is now a choice:
//
//   'vacuum'  plain VACUUM. Marks pages reusable, never blocks a reader, hands
//             nothing back to the platform. What the scheduler uses.
//   'full'    VACUUM FULL. Returns the bytes, blocks the site. What the command
//             still does, because a person asked for it and is waiting.
//   'none'    neither.
//
// The size on disk therefore stops falling on its own. That is the correct
// trade: the archive's contract is about what is HELD, not about what the
// platform bills, and a site that stops answering for a minute every night to
// save a few megabytes is a worse system than one that does not.

import type { Db } from '../db/client.ts';
import { keepsForever, monthOffset } from '../lib/retention.ts';

export interface RetainOptions {
  /**
   * How many calendar months are held whole. `0` is KEEP_FOREVER: the
   * housekeeping below still runs, and not one story is deleted.
   */
  keepMonths: number;
  graceHours: number;
  /** Sweep only stories whose favourite lapsed, whatever their age. */
  lapsedOnly?: boolean;
  /** Report what would go and delete nothing. */
  dryRun?: boolean;
  /** See the note above. Defaults to 'vacuum': never blocks a reader. */
  reclaim?: 'none' | 'vacuum' | 'full';
}

export interface MonthStanding {
  month: string;
  stories: number;
  spared: number;
  rolled: boolean;
  hasTotals: boolean;
  stacks: number;
}

export interface RetainReport {
  cutoff: string;
  /** KEEP_FOREVER was in force: no story was considered for deletion. */
  keptForever?: boolean;
  months: MonthStanding[];
  /** Months past the window whose analysis does not exist yet. Blocks the run. */
  unrolled: MonthStanding[];
  eligible: number;
  pruned: number;
  fetchLogTrimmed: number;
  rejectsTrimmed: number;
  orphanJobs: number;
  children: Record<string, number>;
  sizeBefore: string;
  sizeAfter: string;
  storiesHeld: number;
  favourites: number;
  refused?: string;
  dryRun: boolean;
}

/**
 * The exemption, as one SQL fragment used by every delete in this file.
 *
 * Written once and interpolated rather than repeated, because the failure mode
 * of repeating it is that one of the six child deletes forgets -- and that one
 * silently strips the coverage curve and dedup keys off a story the user
 * explicitly asked to keep, leaving a favourite that renders as a stub.
 *
 * $2 is the grace window in hours.
 */
const PROTECTED = `EXISTS (
  SELECT 1 FROM favourites f
   WHERE f.story_id = %ID%
     AND (f.unfavourited_at IS NULL
          OR f.unfavourited_at > now() - make_interval(hours => $2::int))
)`;
const protectedBy = (idExpr: string) => PROTECTED.replace('%ID%', idExpr);

/** Stories this run may take: old enough, rolled up, and not spoken for. */
function doomedWhere(lapsedOnly: boolean, idExpr = 's.id', dateCol = 's.published_at'): string {
  return lapsedOnly
    // The sweep. Age is irrelevant here: what makes a story deletable is that
    // its favourite lapsed, and a lapsed favourite on a story inside the keep
    // window simply means the story goes back to being ordinary -- it is not
    // deleted early. So the sweep takes lapsed favourites OUTSIDE the window,
    // which is exactly the set that was only ever surviving because of the star.
    ? `${dateCol} < $1::date AND NOT ${protectedBy(idExpr)}
       AND EXISTS (SELECT 1 FROM favourites f2 WHERE f2.story_id = ${idExpr})`
    : `${dateCol} < $1::date AND NOT ${protectedBy(idExpr)}`;
}

export async function retain(db: Db, opts: RetainOptions): Promise<RetainReport> {
  const lapsedOnly = opts.lapsedOnly ?? false;
  const dryRun = opts.dryRun ?? false;
  const reclaim = opts.reclaim ?? 'vacuum';

  if (!Number.isFinite(opts.keepMonths) || opts.keepMonths < 0) {
    throw new Error('keepMonths must be 0 (keep forever) or a positive number of months.');
  }
  // KEEP_FOREVER. The guard is here rather than at the call site because this
  // is the only function in the project that deletes a story, and a rule about
  // what is never deleted belongs where the deleting happens -- not in the
  // three schedulers and two scripts that call it.
  const forever = keepsForever(opts.keepMonths);

  const [cut] = await db.query<{ cutoff: string }>(
    `SELECT (date_trunc('month', now()) - make_interval(months => $1::int))::date::text AS cutoff`,
    [monthOffset(opts.keepMonths)]);
  const cutoff = cut!.cutoff;
  const p: [string, number] = [cutoff, opts.graceHours];

  const report: RetainReport = {
    cutoff, keptForever: forever, months: [], unrolled: [], eligible: 0, pruned: 0,
    fetchLogTrimmed: 0, rejectsTrimmed: 0, orphanJobs: 0, children: {},
    sizeBefore: '', sizeAfter: '', storiesHeld: 0, favourites: 0, dryRun,
  };

  const [sizeBefore] = await db.query<{ p: string }>(
    'SELECT pg_size_pretty(pg_database_size(current_database())) AS p');
  report.sizeBefore = sizeBefore?.p ?? '';

  // --- the operational log ----------------------------------------------------
  //
  // fetch_log is not archive, it is telemetry, and nothing reads it past 24
  // hours -- the health page, the drop breakdown and the interval tuner all
  // window to a day. Left alone it is the fastest-growing table here.
  //
  // Two weeks, not one day, because the window that gets READ is not the window
  // worth KEEPING: a source that started failing last Tuesday is a question
  // somebody asks on Friday, and the row costs 274 bytes.
  if (!dryRun) {
    const trimmed = await db.query<{ x: number }>(
      `DELETE FROM fetch_log WHERE fetched_at < now() - interval '14 days' RETURNING 1 AS x`);
    report.fetchLogTrimmed = trimmed.length;

    // story_rejects is the same kind of thing: a note about something
    // deliberately not kept, read to check the topic filter is not eating a beat
    // you wanted. Windowed on last_seen, so an item a feed keeps re-serving
    // stays visible for as long as it keeps arriving.
    const rejects = await db.query<{ x: number }>(
      `DELETE FROM story_rejects WHERE last_seen < now() - interval '30 days' RETURNING 1 AS x`)
      .catch(() => [] as { x: number }[]);
    report.rejectsTrimmed = rejects.length;
  }

  // --- what is safe to delete -------------------------------------------------
  //
  // A month may be pruned only if its analysis already exists. Checked against
  // the rollup TABLES, not only against rollup_log: the log says a run happened,
  // the tables say it produced something. A month whose stories were all
  // untagged legitimately produces no stack_month rows, so month_totals -- which
  // every month gets -- is the row that must be there.
  const months = await db.query<{
    month: string; stories: string; spared: string;
    rolled: boolean; has_totals: boolean; stacks: string;
  }>(
    `SELECT to_char(date_trunc('month', s.published_at), 'YYYY-MM') AS month,
            count(*) FILTER (WHERE NOT ${protectedBy('s.id')})::text AS stories,
            count(*) FILTER (WHERE ${protectedBy('s.id')})::text AS spared,
            (l.month IS NOT NULL) AS rolled,
            (t.month IS NOT NULL) AS has_totals,
            coalesce(max(sm.n), 0)::text AS stacks
       FROM stories s
       LEFT JOIN rollup_log l   ON l.month = date_trunc('month', s.published_at)::date
       LEFT JOIN month_totals t ON t.month = date_trunc('month', s.published_at)::date
       LEFT JOIN LATERAL (
         SELECT count(*) AS n FROM stack_month x
          WHERE x.month = date_trunc('month', s.published_at)::date
       ) sm ON true
      WHERE ${doomedWhere(lapsedOnly, 's.id')}
         OR (s.published_at < $1::date AND ${protectedBy('s.id')})
      GROUP BY 1, 4, 5
      ORDER BY 1`, p);

  report.months = months.map((m) => ({
    month: m.month, stories: Number(m.stories), spared: Number(m.spared),
    rolled: m.rolled, hasTotals: m.has_totals, stacks: Number(m.stacks),
  }));
  report.unrolled = report.months.filter((m) => !m.rolled || !m.hasTotals);
  const safe = report.months.filter((m) => m.rolled && m.hasTotals);
  report.eligible = safe.reduce((n, m) => n + m.stories, 0);

  // The refusal that makes the whole contract true. Not an exception: a
  // scheduled run that finds an unrolled month has to report and stop, and the
  // rollup job that runs before it is what clears the condition.
  if (report.unrolled.length && !lapsedOnly) {
    report.refused = `${report.unrolled.length} month(s) past the window have no rollup `
      + `(${report.unrolled.map((m) => m.month).join(', ')}). Stories are the only copy of `
      + `themselves, so nothing was deleted.`;
    report.sizeAfter = report.sizeBefore;
    return report;
  }

  if (dryRun || report.eligible === 0) {
    report.sizeAfter = report.sizeBefore;
    await countHeld(db, report);
    return report;
  }

  // --- delete ------------------------------------------------------------------
  //
  // The order is stories first, children second, which is the opposite of the
  // usual one -- and it is the database that insists. 0037 replaced the blanket
  // append-only trigger with two rules: a story may go once its month is rolled
  // up and it is not a favourite, and a CHILD row may go only once its parent
  // story is already gone.

  // Group one: no parent-story trigger, so these can go first. Pure bookkeeping
  // -- dedup hashes, a fetch schedule, queue rows -- none of it evidence.
  const beforeStories: [string, string][] = [
    ['snapshot_schedule',
      `DELETE FROM snapshot_schedule ss USING stories s
        WHERE s.id = ss.story_id AND ${doomedWhere(lapsedOnly, 's.id')}`],
    ['story_keys',
      `DELETE FROM story_keys k USING stories s
        WHERE s.id = k.story_id AND ${doomedWhere(lapsedOnly, 's.id')}`],
    ['jobs',
      `DELETE FROM jobs j
        WHERE EXISTS (SELECT 1 FROM stories s
                       WHERE s.id = (j.payload->>'storyId')::uuid
                         AND ${doomedWhere(lapsedOnly, 's.id')})`],
    // The lapsed claims. Before the stories, so the protection predicate still
    // reads true for them while the deletes that must respect it are running.
    ['favourites',
      `DELETE FROM favourites f USING stories s
        WHERE s.id = f.story_id AND ${doomedWhere(lapsedOnly, 's.id')}`],
  ];

  // Group two: orphans only. Run after the stories are gone, and matched on the
  // absence of a parent rather than on the retention predicate -- by then there
  // is no story left to ask about.
  const afterStories: [string, string][] = [
    // Swept a second time, by absence rather than by the retention predicate.
    //
    // Group one only removes a key whose story THIS RUN is deleting, which
    // leaves every other way of deleting a story -- a registry reset, a merge,
    // a hand-written DELETE -- with its claims still standing. And a standing
    // claim is not inert bookkeeping like an orphan member row: findManyByUrl
    // reads it as "we already hold this address", so the URL is refused as a
    // duplicate on every future poll, permanently and silently.
    //
    // Measured on 2026-08-28: 73,286 url keys, 71,274 of them orphaned, and 374
    // items inside the retention window that no source could collect. Repaired
    // by 0061; kept repaired here.
    ['story_keys',
      `DELETE FROM story_keys k
        WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = k.story_id)`],
    ['story_members',
      `DELETE FROM story_members m
        WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = m.story_id)`],
    ['coverage_snapshots',
      `DELETE FROM coverage_snapshots c
        WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = c.story_id)`],
    ['engagement_snapshots',
      `DELETE FROM engagement_snapshots e
        WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = e.story_id)`],
  ];

  const sweep = async (tables: [string, string][], params: unknown[]) => {
    for (const [name, sql] of tables) {
      try {
        const r = await db.query<{ x: number }>(`${sql} RETURNING 1 AS x`, params);
        report.children[name] = r.length;
      } catch (e) {
        report.children[name] = -1;
        report.children[`${name}:error`] = 0;
        throw new Error(`${name}: ${(e as Error).message}`);
      }
    }
  };

  await sweep(beforeStories, p);

  // In batches: one delete of 160,000 rows is a long transaction holding a lot
  // of WAL on a database that is already short of room.
  //
  // Skipped whole under KEEP_FOREVER. Not "with a cutoff so old it matches
  // nothing" -- a cutoff that matches nothing today matches something next
  // month, and this has to be a rule rather than a coincidence.
  for (; !forever;) {
    const r = await db.query<{ x: number }>(
      `DELETE FROM stories WHERE id IN (
         SELECT id FROM stories WHERE ${doomedWhere(lapsedOnly, 'id', 'published_at')} LIMIT 5000
       ) RETURNING 1 AS x`, p);
    if (r.length === 0) break;
    report.pruned += r.length;
  }

  await sweep(afterStories, []);

  // A `pruned_at` on a month is what tells the rest of the system that month is
  // finished with. Stamping it while deleting nothing would be a lie the pruner
  // tells the collector.
  for (const m of forever ? [] : safe) {
    await db.query(
      `INSERT INTO rollup_log (month, stories_seen, stacks_written, pairs_written,
                               stories_pruned, pruned_at)
       VALUES (to_date($1, 'YYYY-MM'), 0, 0, 0, $2, now())
       ON CONFLICT (month) DO UPDATE
          SET stories_pruned = coalesce(rollup_log.stories_pruned, 0) + excluded.stories_pruned,
              pruned_at = now()`, [m.month, m.stories]);
  }

  // Orphans from somewhere else entirely. The deletes above clean up after THIS
  // run; they cannot clean up after a different one. `npm run reset:sources`
  // empties the registry by deleting stories directly, and every job queued for
  // one of them survives as a ghost -- and a queue is the one structure where
  // dead entries cost live ones, because they are ahead in line.
  const dead = await db.query<{ x: number }>(
    `DELETE FROM jobs j WHERE NOT EXISTS (
       SELECT 1 FROM stories s WHERE s.id = (j.payload->>'storyId')::uuid)
     RETURNING 1 AS x`);
  report.orphanJobs = dead.length;

  await reclaimSpace(db, reclaim);

  // The derived views read `stories` for the live half and the rollup tables for
  // the rest. Every month pruned here was already rolled, so nothing they report
  // should change -- refreshing anyway is how you find out cheaply if that
  // assumption was ever wrong, rather than by reading a page next week.
  await db.query('SELECT refresh_stack_frequency()').catch(() => undefined);

  const [after] = await db.query<{ p: string }>(
    'SELECT pg_size_pretty(pg_database_size(current_database())) AS p');
  report.sizeAfter = after?.p ?? '';
  await countHeld(db, report);
  return report;
}

async function countHeld(db: Db, report: RetainReport): Promise<void> {
  const [left] = await db.query<{ n: string; f: string }>(
    `SELECT (SELECT count(*) FROM stories)::text AS n,
            (SELECT count(*) FROM favourites WHERE unfavourited_at IS NULL)::text AS f`);
  report.storiesHeld = Number(left?.n ?? 0);
  report.favourites = Number(left?.f ?? 0);
}

/** See the note at the top of this file about why 'full' is not the default. */
export async function reclaimSpace(db: Db, how: 'none' | 'vacuum' | 'full'): Promise<string[]> {
  if (how === 'none') return [];
  const done: string[] = [];
  const verb = how === 'full' ? 'VACUUM FULL' : 'VACUUM';
  for (const t of ['stories', 'story_keys', 'story_members', 'snapshot_schedule', 'jobs']) {
    try {
      await db.query(`${verb} ${t}`);
      done.push(t);
    } catch { /* a lock we did not get is not a failure of the prune */ }
  }
  return done;
}

/** One line for a log or a job note. */
export function summarise(r: RetainReport): string {
  if (r.refused) return `refused: ${r.refused}`;
  if (r.dryRun) return `${r.eligible} would go, ${r.months.length} month(s) past the window`;
  // Said every run, not only the interesting ones. A job whose log line is
  // "nothing to prune" reads the same whether it is configured to keep
  // everything or merely had a quiet night, and those are not the same fact.
  if (r.keptForever) {
    const bits = [`${r.storiesHeld} stories held, none deleted (keep forever)`];
    if (r.fetchLogTrimmed) bits.push(`${r.fetchLogTrimmed} fetch_log`);
    if (r.rejectsTrimmed) bits.push(`${r.rejectsTrimmed} rejects`);
    if (r.orphanJobs) bits.push(`${r.orphanJobs} orphan jobs`);
    return `${bits.join(', ')}; db ${r.sizeAfter}`;
  }
  if (r.pruned === 0 && r.fetchLogTrimmed === 0) return 'nothing to prune';
  const bits = [`${r.pruned} stories`];
  if (r.fetchLogTrimmed) bits.push(`${r.fetchLogTrimmed} fetch_log`);
  if (r.rejectsTrimmed) bits.push(`${r.rejectsTrimmed} rejects`);
  if (r.orphanJobs) bits.push(`${r.orphanJobs} orphan jobs`);
  return `${bits.join(', ')} removed; ${r.storiesHeld} held, db ${r.sizeAfter}`;
}

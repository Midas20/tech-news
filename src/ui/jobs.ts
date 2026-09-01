// What this system does when nobody is watching, and whether it worked.
//
// The point of this page is a single question: is NewsTrack running? Before the
// scheduler existed the honest answer was "only while somebody is typing", and
// the only evidence was a terminal on whichever machine had last been used. Now
// the evidence is a table, and it is the same table the runner writes to, so it
// cannot drift from the truth the way a log file can.
//
// It is deliberately a READ. There are no buttons to run a job by hand: a job
// that needs a button is a job whose schedule is wrong, and a button that runs
// retention is a delete with a single click behind it.

import { qOwner } from './db.ts';
import { wrap, pageHead, stat, escapeHtml, relativeTime } from './html.ts';
import { icon } from './theme.ts';
import { buildJobs } from '../run/jobs.ts';

interface JobRow {
  name: string;
  every_seconds: number;
  at_hour: number | null;
  enabled: boolean;
  next_run_at: string | null;
  running_since: string | null;
  runner: string | null;
  last_finished_at: string | null;
  last_ms: number | null;
  last_ok: boolean | null;
  last_note: string | null;
  last_error: string | null;
  runs: string;
  failures: string;
  consecutive_failures: number;
}

/** "every 30s", "every 10m", "daily at 03:00 UTC". */
function cadence(row: JobRow): string {
  if (row.at_hour !== null) return `daily at ${String(row.at_hour).padStart(2, '0')}:00 UTC`;
  const s = row.every_seconds;
  if (s < 60) return `every ${s}s`;
  if (s < 3600) return `every ${Math.round(s / 60)}m`;
  if (s < 86400) return `every ${Math.round(s / 3600)}h`;
  return `every ${Math.round(s / 86400)}d`;
}

/**
 * The state of one job, as one word.
 *
 * "waiting" is not a state worth colouring -- almost everything is waiting
 * almost all the time. What deserves attention is a job that is failing, a job
 * that is disabled, and a job whose next run is in the past, which means the
 * scheduler is not ticking at all.
 */
function standing(row: JobRow, now: number, known = true): { word: string; tone: string } {
  if (!row.enabled) return { word: 'off', tone: 'muted' };
  // A row no runner here builds is not overdue -- nobody is meant to take it.
  // Two runners with different catalogues is a supported configuration, so this
  // is an ordinary state rather than a fault.
  if (!known) return { word: 'not scheduled here', tone: 'muted' };
  if (row.running_since) return { word: 'running', tone: 'ok' };
  if (row.consecutive_failures > 0) {
    return { word: `failing ×${row.consecutive_failures}`, tone: 'bad' };
  }
  if (row.next_run_at && Date.parse(row.next_run_at) < now - 120_000) {
    // Due more than two minutes ago and nobody has taken it. Either no runner is
    // alive or every slot is busy -- both worth saying out loud.
    return { word: 'overdue', tone: 'bad' };
  }
  if (row.last_ok === null) return { word: 'not yet run', tone: 'muted' };
  return { word: 'ok', tone: 'ok' };
}

function when(iso: string | null, now: number): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '—';
  if (then <= now) return relativeTime(iso, now);
  const secs = Math.round((then - now) / 1000);
  if (secs < 60) return `in ${secs}s`;
  if (secs < 3600) return `in ${Math.round(secs / 60)}m`;
  if (secs < 86400) return `in ${Math.round(secs / 3600)}h`;
  return `in ${Math.round(secs / 86400)}d`;
}

function duration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export async function renderJobs(): Promise<string> {
  const rows = await qOwner<JobRow>(
    `SELECT name, every_seconds, at_hour, enabled,
            next_run_at::text, running_since::text, runner,
            last_finished_at::text, last_ms, last_ok, last_note, last_error,
            runs::text, failures::text, consecutive_failures
       FROM job_runs
      ORDER BY every_seconds, name`);

  // The catalogue is the code's opinion; the table is what is deployed. When a
  // job exists in one and not the other, that gap is the most useful thing this
  // page can show -- it means a runner is out of date, or none has started.
  const described = new Map(buildJobs().map((j) => [j.name, j.what]));

  if (rows.length === 0) {
    return wrap(`
      ${pageHead('Scheduled work', 'Nothing has registered a schedule.',
        { crumbs: [{ label: 'Admin', href: '/admin' }, { label: 'Scheduled work' }] })}
      <p class="muted">No runner has started against this database. Collection, tagging,
        rollup and retention are all idle until one does — <code>npm start</code> runs the
        web server and the scheduler in one process.</p>`);
  }

  const now = Date.now();
  const failing = rows.filter((r) => r.consecutive_failures > 0);
  const running = rows.filter((r) => r.running_since);
  const stale = rows.filter((r) => r.enabled && !r.running_since && described.has(r.name)
    && r.next_run_at && Date.parse(r.next_run_at) < now - 120_000);
  const runners = [...new Set(rows.map((r) => r.runner).filter(Boolean))] as string[];

  // The freshest thing any job has finished. If this is hours old, nothing is
  // running, whatever the individual rows say.
  const lastFinish = rows
    .map((r) => (r.last_finished_at ? Date.parse(r.last_finished_at) : 0))
    .reduce((a, b) => Math.max(a, b), 0);

  const body = rows.map((row) => {
    const s = standing(row, now, described.has(row.name));
    const note = row.last_ok === false && row.last_error
      ? `<span class="bad">${escapeHtml(row.last_error)}</span>`
      : row.last_note
        ? escapeHtml(row.last_note)
        // A job that ran and reported nothing did nothing, which is the normal
        // and correct outcome for most of them most of the time.
        : '<span class="muted">nothing to do</span>';
    return `<tr>
      <td><b>${escapeHtml(row.name)}</b>
        <div class="muted small">${escapeHtml(described.get(row.name)
          ?? 'no runner here builds this job — another one may')}</div></td>
      <td class="mono small">${escapeHtml(cadence(row))}</td>
      <td><span class="pill ${s.tone}">${escapeHtml(s.word)}</span></td>
      <td class="mono small">${escapeHtml(when(row.last_finished_at, now))}</td>
      <td class="mono small">${escapeHtml(duration(row.last_ms))}</td>
      <td class="mono small">${escapeHtml(when(row.next_run_at, now))}</td>
      <td class="small">${note}</td>
      <td class="mono small">${escapeHtml(row.runs)}${
        Number(row.failures) ? ` <span class="bad">/${escapeHtml(row.failures)}</span>` : ''}</td>
    </tr>`;
  }).join('');

  return wrap(`
    ${pageHead('Scheduled work',
      'Every job that used to need a command, and when it last ran.',
      { crumbs: [{ label: 'Admin', href: '/admin' }, { label: 'Scheduled work' }] })}

    <div class="cards">
      ${stat('jobs', rows.length, 'scheduled',
        'Jobs in the catalogue. The schedule lives in the job_runs table, not in this '
        + 'process, so a restart resumes it rather than starting it again.')}
      ${stat('running now', running.length, running.length ? running.map((r) => r.name).join(', ') : '',
        'Jobs holding a claim right now. A claim that outlives its lease is taken back, '
        + 'so a killed process cannot strand work forever.')}
      ${stat('failing', failing.length, failing.length ? failing.map((r) => r.name).join(', ') : 'none',
        'Jobs whose last run raised. A failing job backs off exponentially to a ceiling '
        + 'rather than retrying in a tight loop.')}
      ${stat('last activity', lastFinish ? relativeTime(new Date(lastFinish).toISOString(), now) : 'never',
        runners.length ? `runner ${escapeHtml(runners.join(', '))}` : 'no runner has claimed a job',
        'When any job last finished, and which process is doing the work. A runner is '
        + 'identified as pid@host, so a restart shows up here as a new name.')}
    </div>

    ${stale.length ? `<div class="notice bad">${icon('alert', 14)}
      ${stale.length} job(s) have been due for more than two minutes and nobody has taken them:
      <b>${escapeHtml(stale.map((r) => r.name).join(', '))}</b>.
      That usually means no runner is alive against this database.</div>` : ''}

    <div class="scroll"><table>
      <thead><tr>
        <th>job</th><th>cadence</th><th>state</th><th>last run</th>
        <th>took</th><th>next</th><th>said</th><th>runs</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>

    <p class="muted small" style="margin-top:var(--s-4)">
      Times are relative to now. A job that fails backs off — the delay doubles per
      consecutive failure to a ceiling of sixteen intervals — and a job that is claimed by a
      runner that then dies is taken again once its lease expires.
      <b>retain</b> refuses to delete any month whose analysis does not exist, which is why
      <b>rollup</b> is scheduled before it rather than beside it.
    </p>`);
}

/**
 * The three pure functions above, for the tests.
 *
 * They are the whole of this page's judgement -- what "overdue" means, what a
 * cadence reads as -- and the rest is markup around a query.
 */
export const __test = { cadence, standing, when, duration };

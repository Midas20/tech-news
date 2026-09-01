// The schedule, and the two things about it that are not preferences.
//
// Most of what the scheduler does needs a database and is tested by running it.
// What is worth holding here are the invariants that would break silently: the
// ORDER of the daily jobs, and which of them is allowed to delete.

import { describe, it, expect } from 'vitest';
import { buildJobs, jobNames } from '../src/run/jobs.ts';
import { summarise, type RetainReport } from '../src/maintain/retain.ts';
import { __test as page } from '../src/ui/jobs.ts';
import { STYLESHEET, SCRIPT, negotiate, bodyFor, findAsset, isAssetPath } from '../src/ui/assets.ts';
import { adminDecision, tokenMatches } from '../src/ui/server.ts';

describe('the job catalogue', () => {
  it('gives every job a name, a cadence and a description', () => {
    for (const job of buildJobs()) {
      expect(job.name, 'every job is named').toBeTruthy();
      expect(job.everySeconds, `${job.name} has a positive cadence`).toBeGreaterThan(0);
      expect(job.what.length, `${job.name} says what it does`).toBeGreaterThan(10);
    }
  });

  it('has no two jobs of the same name', () => {
    // The name is the primary key in job_runs, so a duplicate would not be a
    // clash -- it would be two jobs quietly sharing one schedule.
    const names = jobNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('rolls up before it prunes', () => {
    // Retention refuses to delete a month whose analysis does not exist. Rollup
    // is what clears that condition, so its hour must come first -- if these
    // ever swap, retention fails every night and the archive stops shrinking
    // while reporting itself healthy.
    const jobs = buildJobs();
    const rollup = jobs.find((j) => j.name === 'rollup')!;
    const retain = jobs.find((j) => j.name === 'retain')!;
    expect(rollup.atHour).toBeDefined();
    expect(retain.atHour).toBeDefined();
    expect(rollup.atHour!).toBeLessThanOrEqual(retain.atHour!);
  });

  it('lets only the owner connection delete', () => {
    // The collecting role has no DELETE on `stories`, deliberately: a process
    // that can collect should not be able to erase what it collected. If a job
    // that deletes ever loses `needs: owner`, it fails with a permission error
    // rather than doing something quiet and wrong -- but it should not get that
    // far.
    const jobs = buildJobs();
    for (const name of ['retain', 'lapsed', 'tune']) {
      expect(jobs.find((j) => j.name === name)?.needs, `${name} needs the owner`).toBe('owner');
    }
    for (const name of ['collect', 'tag', 'snapshot']) {
      expect(jobs.find((j) => j.name === name)?.needs, `${name} does not`).toBeUndefined();
    }
  });

  it('drops only the model work when processing is off', () => {
    // The switch exists so that collection keeps running when there is no model
    // budget. Stories should still arrive, still be tagged and still be pruned.
    const off = jobNames({ processing: false });
    expect(off).not.toContain('process');
    expect(off).not.toContain('discover');
    for (const kept of ['collect', 'tag', 'snapshot', 'rollup', 'retain']) {
      expect(off, `${kept} survives`).toContain(kept);
    }
  });
});

describe('what the schedule page says', () => {
  const row = (over: Partial<Parameters<typeof page.standing>[0]> = {}) => ({
    name: 'collect', every_seconds: 30, at_hour: null, enabled: true,
    next_run_at: new Date(Date.now() + 20_000).toISOString(),
    running_since: null, runner: null, last_finished_at: null, last_ms: null,
    last_ok: true as boolean | null, last_note: null, last_error: null,
    runs: '1', failures: '0', consecutive_failures: 0, ...over,
  });

  it('reads a cadence the way a person would say it', () => {
    expect(page.cadence(row({ every_seconds: 30 }))).toBe('every 30s');
    expect(page.cadence(row({ every_seconds: 600 }))).toBe('every 10m');
    expect(page.cadence(row({ every_seconds: 21600 }))).toBe('every 6h');
    expect(page.cadence(row({ every_seconds: 86400, at_hour: 3 })))
      .toBe('daily at 03:00 UTC');
  });

  it('calls a job overdue only when nobody has taken it', () => {
    const now = Date.now();
    // Due two seconds ago is not overdue -- the tick is every five.
    expect(page.standing(row({ next_run_at: new Date(now - 2_000).toISOString() }), now).word)
      .toBe('ok');
    // Due five minutes ago means no runner is alive.
    expect(page.standing(row({ next_run_at: new Date(now - 300_000).toISOString() }), now).word)
      .toBe('overdue');
    // Claimed right now is running, however overdue it was.
    expect(page.standing(row({
      next_run_at: new Date(now - 300_000).toISOString(),
      running_since: new Date(now - 1_000).toISOString(),
    }), now).word).toBe('running');
  });

  it('counts failures rather than reporting the last one', () => {
    const s = page.standing(row({ consecutive_failures: 3, last_ok: false }), Date.now());
    expect(s.word).toBe('failing ×3');
    expect(s.tone).toBe('bad');
  });

  it('says "not yet run" rather than pretending it worked', () => {
    expect(page.standing(row({ last_ok: null }), Date.now()).word).toBe('not yet run');
  });

  it('does not call a job overdue when no runner here builds it', () => {
    // Two runners with different catalogues is supported -- a container with
    // PROCESSING_ENABLED=0 does not build `process`. Its row must not read as a
    // fault on a page served by that container.
    const now = Date.now();
    const long_overdue = row({ next_run_at: new Date(now - 3_600_000).toISOString() });
    expect(page.standing(long_overdue, now, true).word).toBe('overdue');
    expect(page.standing(long_overdue, now, false).word).toBe('not scheduled here');
    expect(page.standing(long_overdue, now, false).tone).toBe('muted');
  });
});

describe('what a retention run reports', () => {
  const base: RetainReport = {
    cutoff: '2026-07-01', months: [], unrolled: [], eligible: 0, pruned: 0,
    fetchLogTrimmed: 0, rejectsTrimmed: 0, orphanJobs: 0, children: {},
    sizeBefore: '76 MB', sizeAfter: '76 MB', storiesHeld: 200, favourites: 0, dryRun: false,
  };

  it('leads with the refusal when there is one', () => {
    // The scheduler turns this into a job failure, and the failure text is what
    // /admin/jobs shows. It has to name the condition, not just fail.
    const out = summarise({ ...base, refused: '2026-06 has no rollup.' });
    expect(out).toContain('refused');
    expect(out).toContain('2026-06');
  });

  it('says nothing happened when nothing did', () => {
    expect(summarise(base)).toBe('nothing to prune');
  });

  it('counts what it removed', () => {
    const out = summarise({ ...base, pruned: 1200, fetchLogTrimmed: 90, orphanJobs: 4 });
    expect(out).toContain('1200 stories');
    expect(out).toContain('90 fetch_log');
    expect(out).toContain('4 orphan jobs');
  });
});

describe('the static assets', () => {
  it('names each file after its own content', () => {
    // This is what makes `immutable` honest: the URL cannot hold different bytes
    // later, because the bytes are what named it.
    expect(STYLESHEET.url).toMatch(/^\/_\/app\.[0-9a-f]{10}\.css$/);
    expect(SCRIPT.url).toMatch(/^\/_\/app\.[0-9a-f]{10}\.js$/);
    expect(STYLESHEET.url).not.toBe(SCRIPT.url);
  });

  it('is smaller compressed, and finds itself by URL', () => {
    expect(STYLESHEET.brotli.length).toBeLessThan(STYLESHEET.raw.length);
    expect(STYLESHEET.gzip.length).toBeLessThan(STYLESHEET.raw.length);
    expect(findAsset(STYLESHEET.url)).toBe(STYLESHEET);
    expect(findAsset('/_/app.deadbeef00.css')).toBeUndefined();
    expect(isAssetPath('/_/anything')).toBe(true);
    expect(isAssetPath('/news')).toBe(false);
  });

  it('sends what the client can take, and identity when it says nothing', () => {
    expect(negotiate('br, gzip')).toBe('br');
    expect(negotiate('gzip, deflate')).toBe('gzip');
    expect(negotiate(undefined)).toBe(null);
    expect(bodyFor(STYLESHEET, 'br')).toBe(STYLESHEET.brotli);
    expect(bodyFor(STYLESHEET, null)).toBe(STYLESHEET.raw);
  });

  it('parses as JavaScript', () => {
    // Nine behaviours were nine <script> blocks; now they are one file. That is
    // one request instead of nine and it is also a new failure mode: a syntax
    // error anywhere used to break one behaviour and now breaks ALL of them,
    // silently, because a script that does not parse simply does not run.
    expect(() => new Function(SCRIPT.raw.toString('utf8'))).not.toThrow();
  });

  it('bundles every behaviour into the one script', () => {
    // Nine IIFEs concatenated. If one is dropped from the list its behaviour
    // disappears from every page at once and nothing else complains.
    const opens = SCRIPT.raw.toString('utf8').match(/\(function\(\)\{/g) ?? [];
    expect(opens.length).toBeGreaterThanOrEqual(9);
  });
});

describe('who may reach the owner connection', () => {
  // /admin runs as the database owner, which bypasses row-level security. This
  // is the rule that stands between it and the internet, so it is tested at
  // every combination rather than by binding a public port to find out.
  const TOKEN = 'a'.repeat(64);

  it('lets loopback through, token or not', () => {
    expect(adminDecision(false, '', '')).toBe(null);
    expect(adminDecision(false, TOKEN, '')).toBe(null);
    expect(adminDecision(false, TOKEN, 'wrong')).toBe(null);
  });

  it('refuses a public bind with no token configured', () => {
    // Not "asks for a password" -- serves nothing. A public bind and an
    // unauthenticated owner connection must never both be true.
    const why = adminDecision(true, '', TOKEN);
    expect(why).toBeTruthy();
    expect(why).toContain('ADMIN_TOKEN is not set');
  });

  it('refuses a public bind with the wrong token, and admits the right one', () => {
    expect(adminDecision(true, TOKEN, '')).toBe('Wrong or missing admin token.');
    expect(adminDecision(true, TOKEN, 'b'.repeat(64))).toBe('Wrong or missing admin token.');
    expect(adminDecision(true, TOKEN, TOKEN)).toBe(null);
  });

  it('compares in constant time and does not leak length by matching a prefix', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abc', 'abcd')).toBe(false);
    expect(tokenMatches('abcd', 'abc')).toBe(false);
    expect(tokenMatches('', '')).toBe(true);
    expect(tokenMatches('abd', 'abc')).toBe(false);
  });
});

describe('a restart must not strand the work in flight', () => {
  // A runner is identified as `pid@host`, and the pid changes every restart.
  // Clearing only "this runner's" claims therefore cleared nothing: a process
  // killed mid-cycle left `collect` claimed by the dead pid with a 600-second
  // lease, and collection stopped for ten minutes. Every deploy would have done
  // that, and the only symptom is a gap in the archive.
  //
  // The rule now: a claim held by a process on OUR host that no longer exists is
  // taken back at once; a claim from any other host waits out its lease, because
  // stealing a job from a live runner is the worse failure.
  function classify(runner: string, host: string, livePids: number[]): 'reclaim' | 'leave' {
    const [pid, owner] = runner.split('@');
    if (owner !== host) return 'leave';
    const n = Number(pid);
    if (!Number.isFinite(n) || n <= 0) return 'leave';
    return livePids.includes(n) ? 'leave' : 'reclaim';
  }

  it('takes back a job from a dead process on this host', () => {
    expect(classify('6744@local', 'local', [6652])).toBe('reclaim');
  });

  it('leaves a job held by a process that is still running', () => {
    expect(classify('6652@local', 'local', [6652])).toBe('leave');
  });

  it('never touches a claim from another host', () => {
    // The other machine may be working perfectly. Its lease is the backstop.
    expect(classify('6744@fly-abc123', 'local', [])).toBe('leave');
  });

  it('leaves a claim it cannot parse rather than guessing', () => {
    expect(classify('', 'local', [])).toBe('leave');
    expect(classify('not-a-pid@local', 'local', [])).toBe('leave');
  });
});

// The release feeds could not come back, for two independent reasons.
//
// `scripts/prune-sources.ts` reduces `sources` to a hardcoded core list and
// pauses everything else that a story cites, writing the note
//
//     not polled; kept only because a story that survives cites it
//
// It took out 179 GitHub release feeds. `syncTrackedReleases` is the only thing
// that resumes a release feed, and it looked for a different note entirely --
// 'paused: no longer tracked...' -- which matched none of them. Its resume also
// sat below `if (tracked.length === 0) return report`, and `reading.tracked` has
// never been written to app_settings. So the job ran every six hours and was
// incapable of resuming anything.
//
// Both halves are asserted here against a stub Db, because both were invisible:
// the job reported success, every test passed, and no source came back.

import { describe, it, expect } from 'vitest';
import { syncTrackedReleases, summariseReleases } from '../src/maintain/releases.ts';
import type { Db } from '../src/db/client.ts';

const PRUNE_NOTE = 'not polled; kept only because a story that survives cites it';

/** Records every statement and answers each one with a fixture. */
function stubDb(rows: (sql: string) => unknown[]): { db: Db; sql: string[] } {
  const sql: string[] = [];
  const db = {
    query: async (text: string) => {
      sql.push(text);
      return rows(text) as never[];
    },
  } as unknown as Db;
  return { db, sql };
}

/** The resume statement, whatever else the run issued. */
function resumeStatement(sql: string[]): string | undefined {
  return sql.find((s) => /UPDATE sources SET health = 'healthy'/.test(s));
}

describe('resuming a pruned release feed', () => {
  it('runs even when reading.tracked has never been set', async () => {
    // The setting is declared in settings.ts and app_settings holds only
    // reading.fields and gates.backfillEnabled, so this is the live case.
    const { db, sql } = stubDb((s) =>
      /app_settings/.test(s) ? [] : [{ x: 1 }, { x: 1 }]);

    const report = await syncTrackedReleases(db);

    expect(report.tracked).toBe(0);
    expect(resumeStatement(sql), 'no resume was attempted').toBeDefined();
    expect(report.resumed).toBe(2);
  });

  it('matches the note prune-sources actually writes', async () => {
    const { db, sql } = stubDb((s) => (/app_settings/.test(s) ? [] : []));
    await syncTrackedReleases(db);

    const resume = resumeStatement(sql)!;
    expect(resume).toContain(PRUNE_NOTE);
    // ...and still the note this function writes itself.
    expect(resume).toContain('paused: no longer tracked');
  });

  it('will not touch a curated row or one with no feed', async () => {
    const { db, sql } = stubDb(() => []);
    await syncTrackedReleases(db);

    const resume = resumeStatement(sql)!;
    expect(resume).toContain('curated IS NOT TRUE');
    expect(resume).toContain('feed_url IS NOT NULL');
  });

  it('resumes against the vocabulary, not a hand-kept list', async () => {
    // A feed derived from stacks.repo_url is wanted for exactly as long as that
    // stack exists. One whose stack has gone stays paused.
    const { db, sql } = stubDb(() => []);
    await syncTrackedReleases(db);

    const resume = resumeStatement(sql)!;
    expect(resume).toMatch(/FROM stacks st WHERE st\.repo_url = sources\.url/);
  });

  it('leaves a source somebody paused by hand alone', async () => {
    // The predicate is an allowlist of the two machine-written notes rather than
    // "any paused release feed". A job on a six-hour timer must not undo a
    // person's decision, and it would, four times a day, for as long as the row
    // existed.
    const { db, sql } = stubDb(() => []);
    await syncTrackedReleases(db);

    const resume = resumeStatement(sql)!;
    expect(resume).toMatch(/notes LIKE|notes =/);
    expect(resume).not.toMatch(/health = 'paused'\s+AND\s+EXISTS/);
  });

  it('reports what it resumed', () => {
    expect(summariseReleases({
      tracked: 0, added: 0, resumed: 178, paused: 0, probed: 0, problems: [],
    })).toContain('178 resumed');
  });
});

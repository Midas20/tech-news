// Every report is kept, and both ways of reaching one have to agree.
//
// Asked for on 2026-09-01: the report must "list that compose each report for
// each day and each fields". Two axes onto one grid -- days down, fields across
// -- and the failures worth guarding are the ones that make the grid lie:
// a day appearing twice, a day's fields arriving in an order nobody chose, or a
// briefing being served under the wrong date.

import { describe, it, expect } from 'vitest';
import { reportIndex, briefingsOn, archiveFor } from '../src/analysis/briefing.ts';
import { FIELDS } from '../src/vocab/fields.ts';

/**
 * A query stub that answers by matching the table named in the SQL.
 *
 * Crude on purpose: the point of these tests is the shaping code around the
 * queries, and a stub that parses SQL properly would be testing the stub.
 */
function stub(tables: { daily?: unknown[]; fields?: unknown[] }) {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    seen.push({ sql, params });
    return (sql.includes('field_briefings')
      ? tables.fields ?? [] : tables.daily ?? []) as T[];
  };
  return { query: query as never, seen };
}

const day = (over: Record<string, unknown> = {}) => ({
  day: '2026-09-01', title: 'A title', generated_at: '2026-09-01T07:00:00Z',
  generator: 'content-v2', covered_from: '2026-08-31T07:00:00Z',
  covered_to: '2026-09-01T07:00:00Z', fields: 3, themes: 9, stories_read: 40,
  sources: 12, payload: { quiet: ['mobile'] }, ...over,
});

const brief = (over: Record<string, unknown> = {}) => ({
  day: '2026-09-01', field: 'ai', provider: 'gemini-flash-lite',
  covered_from: '2026-08-31T07:00:00Z', covered_to: '2026-09-01T07:00:00Z',
  headline: 'Something happened', summary: 'A sentence.', gaps: 'What it could not say.',
  stories_read: 40, sources: 12, independent: 9,
  payload: { themes: [{ title: 't', body: 'b', evidence: [] }], watch: ['w'], figures: [] },
  ...over,
});

describe('a day appears once', () => {
  it('asks the database for one row per day rather than de-duplicating after', async () => {
    // 1 September held a content-v1 row over fourteen rolling days AND a
    // content-v2 row over one, because daily_reports is keyed (day,
    // window_days) and forbid_delete keeps the old one. The index listed the
    // day twice, with two sets of totals and identical fields underneath.
    const s = stub({ daily: [day()], fields: [brief()] });
    await reportIndex(30, s.query);
    const sql = s.seen[0]!.sql;
    expect(sql).toContain('DISTINCT ON (day)');
    expect(sql).toMatch(/ORDER BY day DESC, generated_at DESC/);
  });

  it('takes the newest report for a day, not the newest generator name', async () => {
    // A filter on the generator string would need remembering at v3. Ordering
    // by when it was written does not.
    const s = stub({ daily: [day()], fields: [brief()] });
    await archiveFor(null, s.query);
    expect(s.seen[0]!.sql).toContain('DISTINCT ON (day)');
    expect(s.seen[0]!.sql).not.toContain("generator = 'content-v2'");
  });
});

describe('the grid', () => {
  it('puts every field of a day under that day', async () => {
    const s = stub({
      daily: [day()],
      fields: [brief({ field: 'ai' }), brief({ field: 'security' })],
    });
    const [d] = await reportIndex(30, s.query);
    expect(d?.briefings.map((b) => b.field)).toEqual(['ai', 'security']);
  });

  it('orders a day\'s fields the way the taxonomy does, not the way rows arrive', async () => {
    // Row order out of Postgres is not defined without an ORDER BY, and a
    // listing whose rows move between refreshes is not a listing.
    const s = stub({
      daily: [day()],
      fields: [brief({ field: 'mobile' }), brief({ field: 'ai' }), brief({ field: 'security' })],
    });
    const [d] = await reportIndex(30, s.query);
    const order = FIELDS.map((f) => f.slug);
    const got = d!.briefings.map((b) => b.field);
    expect(got).toEqual([...got].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(got[0]).toBe('ai');
  });

  it('names the fields that had too little to write from', async () => {
    const s = stub({ daily: [day()], fields: [brief()] });
    const [d] = await reportIndex(30, s.query);
    expect(d?.quiet).toEqual(['mobile']);
  });

  it('asks for the fields of exactly the days it listed', async () => {
    const s = stub({
      daily: [day({ day: '2026-09-01' }), day({ day: '2026-08-31' })],
      fields: [brief()],
    });
    await reportIndex(30, s.query);
    expect(s.seen[1]!.params[0]).toEqual(['2026-09-01', '2026-08-31']);
  });

  it('does not go looking for fields when no day was written', async () => {
    const s = stub({ daily: [], fields: [] });
    expect(await reportIndex(30, s.query)).toEqual([]);
    expect(s.seen).toHaveLength(1);
  });
});

describe('reading one day back', () => {
  it('sorts a day\'s briefings into the taxonomy order', async () => {
    const s = stub({ fields: [brief({ field: 'os' }), brief({ field: 'ai' })] });
    const got = await briefingsOn('2026-09-01', s.query);
    expect(got.map((b) => b.field)).toEqual(['ai', 'os']);
  });

  it('derives first-party from what it read, rather than storing it twice', async () => {
    // stories_read and independent are stored; firstParty is their difference.
    // Storing all three is how two of them start to disagree.
    const [b] = await briefingsOn('2026-09-01',
      stub({ fields: [brief({ stories_read: 40, independent: 9 })] }).query);
    expect(b?.read).toMatchObject({ read: 40, independent: 9, firstParty: 31 });
  });

  it('survives a payload written by an older generator', async () => {
    // A row from a version that did not store watch or figures must render as a
    // briefing with none, not throw on the way to the page.
    const [b] = await briefingsOn('2026-09-01',
      stub({ fields: [brief({ payload: {} })] }).query);
    expect(b?.themes).toEqual([]);
    expect(b?.watch).toEqual([]);
    expect(b?.figures).toEqual([]);
  });

  it('passes the day as a parameter rather than building it into the SQL', async () => {
    const s = stub({ fields: [brief()] });
    await briefingsOn('2026-09-01', s.query);
    expect(s.seen[0]!.params).toEqual(['2026-09-01']);
    expect(s.seen[0]!.sql).not.toContain('2026-09-01');
  });

  it('returns nothing for a day nobody wrote, rather than the nearest one', async () => {
    // Serving today's report under yesterday's address is a lie about which
    // report you are reading.
    expect(await archiveFor('2020-01-01', stub({ daily: [] }).query)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { placeInTimeline } from '../src/ui/reader.ts';

const self = { id: 'self', title: 'This one', at: '2026-08-28 10:00:00+00' };

describe('placeInTimeline', () => {
  it('puts the story among its neighbours, newest first', () => {
    const out = placeInTimeline([
      { id: 'a', title: 'later', at: '2026-08-29 09:00:00+00' },
      { id: 'b', title: 'earlier', at: '2026-08-21 09:00:00+00' },
    ], self);
    expect(out.map((r) => r.id)).toEqual(['a', 'self', 'b']);
  });

  it('marks exactly one entry as the current story', () => {
    const out = placeInTimeline([
      { id: 'a', title: 'x', at: '2026-08-29 09:00:00+00' },
    ], self);
    expect(out.filter((r) => r.here).map((r) => r.id)).toEqual(['self']);
  });

  it('returns just the story when it has no neighbours', () => {
    expect(placeInTimeline([], self)).toEqual([{ ...self, here: true }]);
  });

  it('never lists the story twice when a query also returns it', () => {
    // The neighbour queries exclude it by id, but a page that renders the same
    // entry above and below "this one" is a specific kind of nonsense, so the
    // guard lives here too rather than only in the SQL.
    const out = placeInTimeline([
      { id: 'self', title: 'This one', at: '2026-08-28 10:00:00+00' },
      { id: 'a', title: 'x', at: '2026-08-21 09:00:00+00' },
    ], self);
    expect(out.map((r) => r.id)).toEqual(['self', 'a']);
    expect(out).toHaveLength(2);
  });

  it('orders same-day entries without reordering them arbitrarily', () => {
    // Three entries stamped the same day is the normal case for a changelog.
    // Equal keys must be left alone, not shuffled by an unstable comparator.
    const same = '2026-08-21 00:00:00+00';
    const out = placeInTimeline([
      { id: 'p', title: 'p', at: same },
      { id: 'q', title: 'q', at: same },
      { id: 'r', title: 'r', at: same },
    ], self);
    expect(out.map((r) => r.id)).toEqual(['self', 'p', 'q', 'r']);
  });

  it('sorts as timestamps, not as parsed dates', () => {
    // Postgres timestamptz::text is fixed-width and zero-padded, so string
    // order IS timestamp order. A single-digit month would break a naive
    // comparator; this format never produces one.
    const out = placeInTimeline([
      { id: 'sep', title: 'sep', at: '2026-09-01 00:00:00+00' },
      { id: 'aug', title: 'aug', at: '2026-08-09 00:00:00+00' },
    ], self);
    expect(out.map((r) => r.id)).toEqual(['sep', 'self', 'aug']);
  });
});

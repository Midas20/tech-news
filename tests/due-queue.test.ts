// The due queue's ordering.
//
// This encodes the bug it was written for. Ordering by (poll_interval_seconds,
// next_fetch_at) is a strict priority queue, and a strict priority queue starves
// every class below the first one that can saturate the server. In production
// the 30-minute tier was 167 sources needing ~334 polls an hour against a supply
// of 96, so 164 sources at ranks 127-404 were never fetched once -- not slowly,
// never. The ordering is now lateness in units of each source's own interval.

import { describe, it, expect } from 'vitest';

/** The SQL ordering, in JS, so the property can be tested without a database. */
function score(now: number, nextFetchAt: number, intervalSeconds: number): number {
  return ((now - nextFetchAt) / 1000) / Math.max(intervalSeconds, 60);
}

interface Src { name: string; due: number; interval: number; fetched: boolean }

function nextTick(sources: Src[], now: number, limit: number): Src[] {
  return [...sources]
    .filter((s) => s.due <= now)
    .sort((a, b) => score(now, b.due, b.interval) - score(now, a.due, a.interval)
      || a.due - b.due)
    .slice(0, limit);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = 1_000 * HOUR;

describe('due-queue ordering', () => {
  it('ranks by lateness relative to the promised interval', () => {
    // Half-hourly, one hour late: two intervals behind.
    const hot = score(NOW, NOW - HOUR, 1800);
    // Daily, six hours late: a quarter of an interval behind.
    const cold = score(NOW, NOW - 6 * HOUR, 86400);
    expect(hot).toBeGreaterThan(cold);
    expect(hot).toBeCloseTo(2, 5);
    expect(cold).toBeCloseTo(0.25, 5);
  });

  it('serves a starved source ahead of a punctual fast one', () => {
    const sources: Src[] = [
      { name: 'fast-a', due: NOW - 5 * MIN, interval: 1800, fetched: true },
      { name: 'fast-b', due: NOW - 5 * MIN, interval: 1800, fetched: true },
      { name: 'starved', due: NOW - 9 * HOUR, interval: 3600, fetched: false },
    ];
    expect(nextTick(sources, NOW, 1)[0]!.name).toBe('starved');
  });

  it('does not starve the slow tier, however large the fast tier is', () => {
    // The production shape: a fast tier that alone exceeds the whole budget.
    const sources: Src[] = [];
    for (let i = 0; i < 167; i++) {
      sources.push({ name: `fast${i}`, due: NOW - 5 * MIN, interval: 1800, fetched: true });
    }
    for (let i = 0; i < 164; i++) {
      sources.push({ name: `never${i}`, due: NOW - 9 * HOUR, interval: 3600, fetched: false });
    }
    const taken = nextTick(sources, NOW, 8);
    expect(taken.every((s) => !s.fetched)).toBe(true);
  });

  it('the old ordering would have taken none of them', () => {
    const sources: Src[] = [];
    for (let i = 0; i < 167; i++) {
      sources.push({ name: `fast${i}`, due: NOW - 5 * MIN, interval: 1800, fetched: true });
    }
    for (let i = 0; i < 164; i++) {
      sources.push({ name: `never${i}`, due: NOW - 9 * HOUR, interval: 3600, fetched: false });
    }
    const old = [...sources]
      .filter((s) => s.due <= NOW)
      .sort((a, b) => a.interval - b.interval || a.due - b.due)
      .slice(0, 8);
    expect(old.every((s) => s.fetched)).toBe(true);
  });

  it('hands the starved source back into the rotation once served', () => {
    // After a fetch its next_fetch_at moves forward, so its lateness resets to
    // zero and it stops jumping the queue. Without this the fix would just
    // invert the starvation.
    const served: Src = { name: 'was-starved', due: NOW + 3600_000, interval: 3600, fetched: true };
    const punctual: Src = { name: 'fast', due: NOW - 5 * MIN, interval: 1800, fetched: true };
    expect(nextTick([served, punctual], NOW, 5).map((s) => s.name)).toEqual(['fast']);
  });

  it('never divides by an interval smaller than a minute', () => {
    // greatest(poll_interval_seconds, 60) in SQL: a zero or negative interval
    // must not produce Infinity and monopolise every tick forever.
    expect(Number.isFinite(score(NOW, NOW - HOUR, 0))).toBe(true);
    expect(Number.isFinite(score(NOW, NOW - HOUR, -10))).toBe(true);
  });

  it('breaks ties by which came due first', () => {
    const a: Src = { name: 'earlier', due: NOW - 2 * HOUR, interval: 3600, fetched: true };
    const b: Src = { name: 'later', due: NOW - 2 * HOUR, interval: 3600, fetched: true };
    expect(nextTick([b, a], NOW, 2).length).toBe(2);
  });

  it('takes nothing that is not yet due', () => {
    const future: Src = { name: 'future', due: NOW + HOUR, interval: 1800, fetched: true };
    expect(nextTick([future], NOW, 8)).toEqual([]);
  });
});

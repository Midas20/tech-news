import { describe, it, expect } from 'vitest';
import { mapWithConcurrency, mapSettled } from '../src/lib/pool.ts';
import { PolitenessGate } from '../src/collect/fetcher.ts';

describe('mapWithConcurrency', () => {
  it('never exceeds the limit', async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 40 }, (_, i) => i), 6, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 3));
      running--;
    });
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });

  it('preserves input order in the results', async () => {
    // Deliberately finishes out of order: later items resolve first.
    const out = await mapWithConcurrency([30, 20, 10, 0], 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it('is genuinely faster than sequential for I/O-shaped work', async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const started = Date.now();
    await mapWithConcurrency(items, 6, async () => { await new Promise((r) => setTimeout(r, 20)); });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(12 * 20 * 0.6);
  });

  it('mapSettled keeps a failed task from aborting the batch', async () => {
    const out = await mapSettled([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(out).toEqual([1, null, 3]);
  });
});

describe('PolitenessGate', () => {
  it('spaces repeat hits on ONE domain', async () => {
    const gate = new PolitenessGate(40);
    const started = Date.now();
    await gate.wait('example.com');
    await gate.wait('example.com');
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });

  it('does not make different domains wait for each other', async () => {
    // This is what makes fan-out safe: concurrency means many hosts at once,
    // never one host harder.
    const gate = new PolitenessGate(200);
    const started = Date.now();
    await Promise.all([
      gate.wait('a.example'), gate.wait('b.example'),
      gate.wait('c.example'), gate.wait('d.example'),
    ]);
    expect(Date.now() - started).toBeLessThan(120);
  });
});

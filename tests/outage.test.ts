// How the archive behaves when its database says no.
//
// On 2026-09-05 the Neon project ran out of data transfer and every query
// failed, including SELECT 1. Two things went wrong that were not the quota:
//
//   1. The scheduler retried on its five-second cadence, forever. 17,280
//      attempts a day against a dependency that had already refused, and an
//      identical log line for every one of them.
//   2. Every visitor to the site was shown the provider's billing message. The
//      same path renders SQL errors and connection failures, on a deployment
//      bound to 0.0.0.0 from a public repository.
//
// Neither is about quotas. Both are about what a service does when something
// underneath it is broken, which is why they are tested together.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const scheduler = readFileSync(
  new URL('../src/run/scheduler.ts', import.meta.url), 'utf8');
const server = readFileSync(
  new URL('../src/ui/server.ts', import.meta.url), 'utf8');

/**
 * The backoff, lifted out of the class so it can be checked without a database,
 * a clock, or a scheduler. Kept in step with `nextDelayMs` by the test below,
 * which asserts the real one is written the same way.
 */
function delay(failures: number, tickSeconds = 5, maxMs = 5 * 60_000): number {
  const base = tickSeconds * 1000;
  if (failures === 0) return base;
  return Math.min(base * 2 ** Math.min(failures, 10), maxMs);
}

describe('a scheduler whose database is down', () => {
  it('keeps its exact cadence while nothing is wrong', () => {
    expect(delay(0)).toBe(5000);
  });

  it('backs off instead of hammering', () => {
    expect(delay(1)).toBe(10_000);
    expect(delay(2)).toBe(20_000);
    expect(delay(3)).toBe(40_000);
  });

  it('stops at five minutes, so a fixed database is picked up quickly', () => {
    // The cap matters as much as the growth. A scheduler that has backed off to
    // an hour stays down long after the thing it waited for came back.
    expect(delay(20)).toBe(5 * 60_000);
    expect(delay(100)).toBe(5 * 60_000);
  });

  it('cannot overflow its own exponent', () => {
    // 2 ** 1000 is Infinity, and Math.min(Infinity, cap) is the cap -- but only
    // because the exponent is clamped first. Without the clamp this is a
    // NaN-or-Infinity delay handed to setTimeout, which fires immediately.
    for (const n of [50, 500, 5000]) {
      expect(Number.isFinite(delay(n)), `${n} failures produced a bad delay`).toBe(true);
      expect(delay(n)).toBe(5 * 60_000);
    }
  });

  it('turns one day of a dead database into tens of attempts, not thousands', () => {
    // The behaviour the log actually showed: 24h / 5s = 17,280 attempts.
    let elapsed = 0; let attempts = 0;
    while (elapsed < 24 * 3600 * 1000) { elapsed += delay(attempts); attempts += 1; }
    expect(attempts).toBeLessThan(300);
    expect(attempts).toBeGreaterThan(200);
  });

  it('is implemented that way and not merely described that way', () => {
    expect(scheduler).toContain('MAX_BACKOFF_MS');
    expect(scheduler).toMatch(/private failures = 0/);
    expect(scheduler).toMatch(/Math\.min\(this\.failures, 10\)/);
    // The counter has to reset, or a scheduler that recovers stays slow.
    expect(scheduler).toMatch(/this\.failures = 0/);
  });

  it('says when it recovers, because the failure was worth a line', () => {
    expect(scheduler).toContain('recovered after');
  });

  it('does not log every attempt once it is clearly broken', () => {
    expect(scheduler).toMatch(/this\.failures <= 3 \|\| this\.failures % 10 === 0/);
  });
});

describe('an error page shown to a stranger', () => {
  it('gives a visitor no internal detail', () => {
    expect(server).toContain('Something went wrong at our end');
  });

  it('still gives it to an administrator, who can act on it', () => {
    expect(server).toMatch(/seenRole === 'admin'/);
  });

  it('always writes it to the log, whoever asked', () => {
    // The detail must not be lost, only withheld. A 500 nobody can diagnose is
    // worse than one that leaks.
    expect(server).toMatch(/console\.error\(`\$\{path\}: \$\{message\}`\)/);
  });

  it('reads the role from outside the try, or the handler cannot see it', () => {
    // `role` is declared inside the try block, so the catch has no access to it
    // and every error would render as if for a stranger -- including for the
    // administrator trying to find out what broke.
    expect(server).toMatch(/let seenRole: 'admin' \| 'user' \| null = null;/);
    const hoist = server.indexOf('let seenRole');
    const tryAt = server.indexOf('\n  try {');
    expect(hoist).toBeGreaterThan(0);
    expect(hoist).toBeLessThan(tryAt);
  });
});

describe('the scheduler asks no more often than a job can use', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const jobs = readFileSync(new URL('../src/run/jobs.ts', import.meta.url), 'utf8');

  const tick = Number(main.match(/SCHEDULER_TICK_SECONDS', (\d+)\)/)?.[1]);
  const cadences = [...jobs.matchAll(/everySeconds: ([^,]+),/g)]
    // eslint-disable-next-line no-eval
    .map((m) => Number(eval(m[1]!)));

  it('reads a tick and some cadences at all', () => {
    expect(tick).toBeGreaterThan(0);
    expect(cadences.length).toBeGreaterThan(5);
  });

  it('does not poll faster than the quickest job could possibly need', () => {
    // Five seconds against a thirty-second job is 17,280 round trips a day to
    // learn nothing, on a database billed by data transfer.
    expect(tick).toBeLessThanOrEqual(Math.min(...cadences));
  });

  it('still polls often enough to serve that job', () => {
    // A tick slower than the fastest cadence turns "every 30s" into "whenever".
    expect(tick).toBeLessThanOrEqual(Math.min(...cadences));
    expect(tick).toBeGreaterThanOrEqual(10);
  });
});

describe('the browser poll finds a warm cache', () => {
  const rail = readFileSync(new URL('../src/ui/rail.ts', import.meta.url), 'utf8');
  const theme = readFileSync(new URL('../src/ui/theme.ts', import.meta.url), 'utf8');

  it('caches counts for longer than the interval that asks for them', () => {
    // At 5s against a 15s poll the cache never hit once: every tick of every
    // visible tab re-ran a dozen aggregates over the whole archive.
    const ttl = Number(rail.match(/const TTL_MS = ([\d_]+)/)?.[1]?.replace(/_/g, ''));
    const every = Number(theme.match(/var EVERY = (\d+)/)?.[1]);
    expect(ttl).toBeGreaterThan(0);
    expect(every).toBeGreaterThan(0);
    expect(ttl, 'the counts cache expires before the next poll').toBeGreaterThan(every);
  });

  it('stops polling for a tab nobody is looking at', () => {
    expect(theme).toContain('if (document.hidden) return;');
  });
});

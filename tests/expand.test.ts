// Expanding the registry, and the rule that every entry carries its evidence.
//
// The registry has been cut and grown three times in this project's life, and
// twice the cut was made from an argument about what a publisher is like rather
// than from what it published. seeds/expand.ts exists to make that impossible:
// every line carries the count that decided it, measured by fetching the live
// feed and putting every item through the whole gauntlet.
//
// These tests do not check the network. They check that the FILE keeps the
// discipline -- that nothing lands in the registry without a number and a
// reason behind it, and that the refusals stay written down.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { UNPAUSE, ADD, REFUSED } from '../seeds/expand.ts';

const ALL = [...UNPAUSE, ...ADD];

describe('every source in the expansion', () => {
  it('carries a measured count', () => {
    // Not a guess about the publisher: what it actually published in the
    // window, counted through the same gauntlet a poll uses.
    for (const c of ALL) {
      expect(c.kept, c.name).toBeGreaterThan(0);
      expect(Number.isInteger(c.kept), c.name).toBe(true);
    }
  });

  it('carries a reason a person can disagree with', () => {
    for (const c of ALL) {
      expect(c.why.length, c.name).toBeGreaterThan(20);
    }
  });

  it('carries a fallback share, including when it is bad', () => {
    // The number that says how much of a source survives only because the
    // publisher is first-party. Recorded even at 100%, because hiding it would
    // make the thin additions look like the strong ones.
    for (const c of ALL) {
      expect(c.fallback, c.name).toBeGreaterThanOrEqual(0);
      expect(c.fallback, c.name).toBeLessThanOrEqual(100);
    }
    expect(ADD.some((c) => c.fallback >= 90), 'a thin one is admitted openly').toBe(true);
    expect(ADD.some((c) => c.fallback === 0), 'and a clean one is there to compare it to').toBe(true);
  });

  it('has a real feed address, not a page to be discovered', () => {
    // Unlike seed:announce, these feeds were fetched and parsed during the
    // audition, so writing the address is a fact rather than a guess.
    for (const c of ALL) {
      expect(c.feed, c.name).toMatch(/^https:\/\//);
      expect(c.url, c.name).toMatch(/^https:\/\//);
    }
  });

  it('is listed once', () => {
    const names = ALL.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const feeds = ALL.map((c) => c.feed);
    expect(new Set(feeds).size).toBe(feeds.length);
  });
});

describe('the refusals', () => {
  it('are kept, with the number that decided each', () => {
    // A decision with no record is one somebody re-litigates in six months.
    expect(REFUSED.length).toBeGreaterThanOrEqual(10);
    for (const r of REFUSED) expect(r.why.length, r.name).toBeGreaterThan(20);
  });

  it('include the ones that would have produced the most', () => {
    // The whole point of auditioning on output: the three biggest producers
    // offered were all refused, and volume was the reason to look harder, not
    // a reason to take them.
    const big = REFUSED.filter((r) => r.kept >= 40).map((r) => r.name);
    expect(big).toContain('Vercel Blog');
    expect(big).toContain('Temporal blog');
    expect(big).toContain('Prisma blog');
  });

  it('do not overlap with what was added', () => {
    const added = new Set(ALL.map((c) => c.name));
    for (const r of REFUSED) expect(added.has(r.name), r.name).toBe(false);
  });
});

describe('the script that applies it', () => {
  const src = readFileSync(new URL('../scripts/expand-sources.ts', import.meta.url), 'utf8');

  it('never deletes and never pauses', () => {
    // `npm run audit -- --pause` is the command that goes the other way.
    // Keeping the two apart is what makes this one safe to run.
    expect(src).not.toMatch(/DELETE FROM sources/i);
    expect(src).not.toMatch(/SET health = 'paused'/i);
  });

  it('only wakes a source that is actually paused', () => {
    expect(src).toContain("AND health = 'paused'");
  });

  it('does not overwrite a source that already exists', () => {
    expect(src).toContain('ON CONFLICT (url) DO NOTHING');
  });

  it('is a dry run unless told otherwise', () => {
    expect(src).toContain("process.argv.includes('--apply')");
    expect(src).toContain('dry run');
  });

  it('clears the conditional headers when it wakes one', () => {
    // A publisher that thinks we already have the feed sends 304 and the
    // source comes back healthy and silent -- which looks exactly like a
    // source with nothing to say.
    expect(src).toContain('last_etag = NULL');
    expect(src).toContain('last_modified = NULL');
  });

  it('writes why it did it into the source itself', () => {
    // The note survives in the database, so the registry explains itself to
    // whoever reads it next without this file in front of them.
    expect(src).toContain('unpaused 2026-08-28 on audition');
    expect(src).toContain('added 2026-08-28 on audition');
  });
});

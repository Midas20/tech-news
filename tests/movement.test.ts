// The report has to survive its own archive growing.
//
// On 2026-09-01 the last 90 days held 8,195 stories from 325 sources and the
// prior 90 held 4,205 from 213: 179 release feeds had been resumed, 61
// first-party channels seeded, and a backfill had walked GitHub release history
// back to January 2024. A verdict built on raw counts would have reported the
// entire vocabulary as growing ~2x — measuring this repository's commit history
// and calling it the industry.
//
// So the comparison is on SHARE of the window. These tests fix that property in
// place, because the failure is silent: the page would look right, read
// confidently, and be wrong about everything.

import { describe, it, expect } from 'vitest';
import {
  verdictFor, recommend, firstPartyOnly, reportWindow,
  MIN_NOW, MIN_PREV, MIN_TOTAL, type Movement,
} from '../src/ui/movement.ts';

function row(over: Partial<Movement> = {}): Movement {
  return {
    entity: 'technology', slug: 'x', name: 'X', kind: 'stack', category: 'lang',
    nowN: 40, prevN: 20, nowShare: 0.04, prevShare: 0.02, ratio: 2,
    verdict: 'surging', label: 'Growing very strongly',
    sources: 5, independent: 2,
    launches: 4, releases: 30, changes: 4, market: 2, articles: 0,
    exemplars: [], ...over,
  };
}

describe('a verdict is a share movement', () => {
  it('calls an unchanged share steady', () => {
    // The whole point: if the archive doubles and a technology doubles with it,
    // its share is flat and the honest answer is "steady".
    expect(verdictFor(1).verdict).toBe('steady');
    expect(verdictFor(0.95).verdict).toBe('steady');
    expect(verdictFor(1.2).verdict).toBe('steady');
  });

  it('reserves the top band for a doubled share', () => {
    expect(verdictFor(2).verdict).toBe('surging');
    expect(verdictFor(1.99).verdict).toBe('growing');
  });

  it('reads a halved share as decline', () => {
    expect(verdictFor(0.79).verdict).toBe('fading');
    expect(verdictFor(0.49).verdict).toBe('collapsing');
  });

  it('never returns undefined, whatever the arithmetic produced', () => {
    for (const r of [0, -1, Number.MAX_VALUE]) {
      expect(verdictFor(r).verdict).toBeTruthy();
      expect(verdictFor(r).label).toBeTruthy();
    }
  });
});

describe('the floors', () => {
  it('require a baseline as well as a present', () => {
    // MIN_PREV is the one that stops a resumed feed reading as a market event:
    // AT Protocol was 495 stories against 1, which is 254x and means nothing.
    expect(MIN_PREV).toBeGreaterThan(1);
    expect(MIN_NOW).toBeGreaterThan(1);
    expect(MIN_TOTAL).toBeGreaterThanOrEqual(MIN_NOW + MIN_PREV);
  });
});

describe('what gets recommended', () => {
  it('refuses a technology only its own makers describe', () => {
    // A vendor is authoritative about what it shipped and worthless as evidence
    // that anyone wanted it.
    const only = row({ independent: 0, sources: 6 });
    expect(recommend([only])).toEqual([]);
    expect(firstPartyOnly([only]).map((r) => r.slug)).toEqual(['x']);
  });

  it('ranks corroboration above speed', () => {
    const fast = row({ slug: 'fast', ratio: 9, independent: 1 });
    const corroborated = row({ slug: 'solid', ratio: 1.3, verdict: 'growing', independent: 4 });
    expect(recommend([fast, corroborated]).map((r) => r.row.slug)).toEqual(['solid', 'fast']);
  });

  it('only recommends what is actually growing', () => {
    for (const v of ['steady', 'fading', 'collapsing', 'unbaselined'] as const) {
      expect(recommend([row({ verdict: v })])).toEqual([]);
    }
  });

  it('says when the movement is only version traffic', () => {
    // 30 releases and 2 events is a project shipping, not a market moving, and
    // the recommendation has to admit that rather than imply adoption.
    const [rec] = recommend([row({ releases: 30, launches: 1, changes: 1, market: 0 })]);
    expect(rec!.why).toMatch(/release traffic/);

    const [event] = recommend([row({ releases: 2, launches: 10, changes: 8, market: 4 })]);
    expect(event!.why).toMatch(/launches, changes and market moves/);
  });

  it('grades strength by how many independent sources agree', () => {
    expect(recommend([row({ independent: 4 })])[0]!.strength).toBe('strong');
    expect(recommend([row({ independent: 2 })])[0]!.strength).toBe('moderate');
    expect(recommend([row({ independent: 1 })])[0]!.strength).toBe('weak');
  });
});

describe('the window', () => {
  it('only accepts windows the report offers', () => {
    // It reaches SQL through make_interval, so this is an allowlist.
    for (const good of ['30', '90', '180', '365']) {
      expect(reportWindow(good)).toBe(Number(good));
    }
    for (const bad of [null, '', '7', '99999', 'abc', '90; DROP TABLE stories']) {
      expect(reportWindow(bad)).toBe(90);
    }
  });
});

// Choosing what to read is allowed to use counts. Saying what happened is not.
//
// That line is the whole design after 2026-09-01 ("don't count news, it is fake
// value because we can't collect all news"), and this file guards the half of it
// that lives in code: the selection. If the caps here fail, a field's briefing
// gets written from one publisher's changelog and reads as an account of the
// industry.

import { describe, it, expect } from 'vitest';
import {
  diversify, provenance, shape, subjectsOf, CAPS, KIND_RANK, HARD_SUBJECT_MULTIPLE,
  type Item, type RawItem,
} from '../src/analysis/corpus.ts';

let n = 0;
function item(over: Partial<Item> = {}): Item {
  n += 1;
  return {
    id: `id-${n}`, title: `story ${n}`, summary: 'x'.repeat(80),
    url: `https://example.test/${n}`, source: `source-${n}`, sourceType: null,
    rung: 'announcement', independent: true, kind: 'launch', when: '2026-09-01',
    stacks: [`stack-${n}`], companies: [], platforms: [], importance: 5,
    ...over,
  };
}

describe('one publisher cannot speak for a field', () => {
  it('caps how many stories a single source contributes', () => {
    const flood = Array.from({ length: 20 }, () => item({ source: 'Loud Vendor Blog' }));
    const kept = diversify(flood);
    expect(kept).toHaveLength(CAPS.perSource);
  });

  it('lets other sources through once one is capped', () => {
    const mixed = [
      ...Array.from({ length: 10 }, () => item({ source: 'Loud' })),
      ...Array.from({ length: 3 }, () => item({ source: 'Quiet' })),
    ];
    const kept = diversify(mixed);
    expect(kept.filter((i) => i.source === 'Loud')).toHaveLength(CAPS.perSource);
    expect(kept.filter((i) => i.source === 'Quiet')).toHaveLength(3);
  });
});

describe('one project cannot speak for a field', () => {
  it('caps how many stories share a subject', () => {
    const flood = Array.from({ length: 20 }, () => item({ stacks: ['solana'] }));
    expect(diversify(flood)).toHaveLength(CAPS.perSubject);
  });

  it('admits a story whose other subject still has room', () => {
    // The soft cap asks whether a story brings anything this selection lacks,
    // not whether every tag on it is fresh. A piece about Rust and WebAssembly
    // is the only WebAssembly evidence there is.
    const kept = diversify([
      ...Array.from({ length: 3 }, () => item({ stacks: ['rust'] })),
      item({ stacks: ['rust', 'wasm'] }),
    ]);
    expect(kept).toHaveLength(4);
  });

  it('stops a project talking past its cap on a generous tag cloud', () => {
    // The escape hatch the soft cap leaves open, and the reason for the hard
    // one: every story names solana plus one tag nobody has used yet, so the
    // soft rule would admit all of them.
    const kept = diversify([
      ...Array.from({ length: 3 }, () => item({ stacks: ['solana'] })),
      ...Array.from({ length: 8 }, (_, i) => item({ stacks: ['solana', `alt-${i}`] })),
    ]);
    const solana = kept.filter((i) => i.stacks.includes('solana'));
    expect(solana.length).toBe(CAPS.perSubject * HARD_SUBJECT_MULTIPLE);
    expect(solana.length).toBeLessThan(11);
  });

  it('does not count the field root against any cap', () => {
    // Ask for cloud and nearly everything is tagged cloud. Counting the root
    // would end the corpus at three stories.
    const kept = diversify(
      Array.from({ length: 12 }, (_, i) =>
        item({ stacks: ['cloud', `svc-${i}`], source: `src-${i}` })),
      CAPS, ['cloud']);
    expect(kept).toHaveLength(12);
  });

  it('does not let untagged stories crowd each other out silently', () => {
    // They share the '(untagged)' bucket by design -- forty stories about
    // nothing identifiable is not a field briefing.
    const kept = diversify(Array.from({ length: 10 }, () => item({ stacks: [] })));
    expect(kept).toHaveLength(CAPS.perSubject);
  });
});

describe('routine version traffic cannot fill a briefing', () => {
  it('caps releases even when nothing else competes', () => {
    const kept = diversify(Array.from({ length: 30 }, (_, i) =>
      item({ kind: 'release', source: `src-${i}`, stacks: [`s-${i}`] })));
    expect(kept).toHaveLength(CAPS.maxReleases);
  });

  it('does not cap launches or market moves the same way', () => {
    const kept = diversify(Array.from({ length: 12 }, (_, i) =>
      item({ kind: 'market', source: `src-${i}`, stacks: [`s-${i}`] })));
    expect(kept).toHaveLength(12);
  });

  it('ranks a market move above a release', () => {
    expect(KIND_RANK.market).toBeGreaterThan(KIND_RANK.release!);
    expect(KIND_RANK.release).toBeGreaterThan(KIND_RANK.article!);
  });
});

describe('the caps only ever remove', () => {
  it('never reorders what it keeps', () => {
    const given = Array.from({ length: 30 }, (_, i) =>
      item({ source: `src-${i % 3}`, stacks: [`s-${i % 5}`] }));
    const kept = diversify(given);
    const order = kept.map((k) => given.indexOf(k));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('stops at the total', () => {
    const given = Array.from({ length: 500 }, (_, i) =>
      item({ source: `src-${i}`, stacks: [`s-${i}`] }));
    expect(diversify(given)).toHaveLength(CAPS.total);
  });
});

describe('provenance describes the reading, never the field', () => {
  it('separates independent from first-party', () => {
    const p = provenance([
      item({ independent: true, source: 'A' }),
      item({ independent: true, source: 'B' }),
      item({ independent: false, source: 'C' }),
    ]);
    expect(p).toMatchObject({ read: 3, independent: 2, firstParty: 1, sources: 3 });
  });

  it('counts distinct sources, not stories', () => {
    const p = provenance([
      item({ source: 'Same' }), item({ source: 'Same' }), item({ source: 'Other' }),
    ]);
    expect(p.read).toBe(3);
    expect(p.sources).toBe(2);
  });
});

describe('what a source type means travels with the story', () => {
  const raw = (t: string | null): RawItem => ({
    id: 'x', title: 't', summary: 's', url: 'u', source: 'S',
    source_type: t as never, kind: 'launch', when: '2026-09-01',
    stacks: [], companies: [], platforms: [], importance: null, sourceType: null,
  });

  it('marks a vendor speaking about itself as not independent', () => {
    expect(shape(raw('PRIMARY_VENDOR')).independent).toBe(false);
  });

  it('defaults an unknown type to the weakest reading', () => {
    // Assuming independence for a source we cannot classify would let an
    // unrecognised vendor feed corroborate itself.
    const s = shape(raw(null));
    expect(s.independent).toBe(false);
    expect(s.rung).toBe('announcement');
  });

  it('never invents an importance', () => {
    expect(shape(raw('PRIMARY_VENDOR')).importance).toBeNull();
  });
});

describe('subjects', () => {
  it('orders by how much of the corpus discusses each', () => {
    const got = subjectsOf([
      item({ stacks: ['rust', 'wasm'] }),
      item({ stacks: ['rust'] }),
      item({ stacks: ['go'] }),
    ]);
    expect(got[0]).toBe('rust');
    expect(got).toContain('go');
  });

  it('honours the limit', () => {
    expect(subjectsOf(Array.from({ length: 40 }, (_, i) =>
      item({ stacks: [`s-${i}`] })), 5)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// One story per publisher per title per day
// ---------------------------------------------------------------------------
//
// "the amount of news that you analysis is still low" (2026-09-11) was answered
// by reading four times as much, which made an existing flaw four times more
// expensive: at a per-publisher cap of 25, a hundred of an August corpus's 499
// slots were the same story twice.

describe('a story the feed published twice is read once', () => {
  const item = (over: Partial<Item> = {}): Item => ({
    id: Math.random().toString(36).slice(2), title: 'Vercel Connect is now GA',
    summary: 'x'.repeat(80), url: 'https://example.com', source: 'Vercel Blog',
    sourceType: 'PRIMARY_VENDOR', kind: 'launch', when: '2026-08-24',
    stacks: ['vercel'], companies: [], platforms: [], importance: 5,
    independent: false, ...over,
  } as Item);

  it('drops a republished item under a new identifier', () => {
    const out = diversify([item(), item()]);
    expect(out).toHaveLength(1);
  });

  it('keeps two posts with the same title on different days', () => {
    // GitHub's status feed published four separate posts titled "Incident with
    // Actions" in August, about four different incidents. Keying on title alone
    // would silently drop three real outages.
    const out = diversify([
      item({ title: 'Incident with Actions', source: 'GitHub status', when: '2026-08-18' }),
      item({ title: 'Incident with Actions', source: 'GitHub status', when: '2026-08-26' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps the same headline from two different publishers', () => {
    // Two outlets covering one launch is corroboration, which is the opposite
    // of duplication and the thing this archive is short of.
    const out = diversify([
      item({ source: 'Vercel Blog' }),
      item({ source: 'InfoQ', independent: true }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('ignores case and surrounding space when comparing titles', () => {
    const out = diversify([item({ title: '  Vercel Connect is now GA ' }), item()]);
    expect(out).toHaveLength(1);
  });
});

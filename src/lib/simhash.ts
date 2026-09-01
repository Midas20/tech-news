// SimHash over normalized text -- dedup layer 2. Catches near-identical rewrites:
// the same wire story reworded by four outlets, the same release note reformatted.
//
// 64 bits, stored as a signed bigint so it fits a Postgres int8 column. Candidate
// lookup uses 4 x 16-bit bands: two documents within a Hamming distance of 3 must
// share at least one band, so a GIN index on the band array turns an O(n) scan
// into a handful of index probes. That is the whole reason a vector store is not
// needed here.

import { features } from './text.ts';

const MASK64 = (1n << 64n) - 1n;

/** FNV-1a 64-bit. Fast, dependency-free, and good enough for feature hashing. */
export function fnv1a64(s: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    hash ^= BigInt(s.charCodeAt(i) & 0xff);
    hash = (hash * 0x100000001b3n) & MASK64;
  }
  return hash;
}

export function simhash(text: string): bigint {
  const bag = features(text);
  if (bag.size === 0) return 0n;

  const weights = new Int32Array(64);
  for (const [feature, count] of bag) {
    const h = fnv1a64(feature);
    for (let bit = 0; bit < 64; bit++) {
      const set = (h >> BigInt(bit)) & 1n;
      weights[bit]! += set === 1n ? count : -count;
    }
  }

  let out = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (weights[bit]! > 0) out |= 1n << BigInt(bit);
  }
  return out;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = (a ^ b) & MASK64;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

/**
 * Four 16-bit bands, each tagged with its position so band 0 = 0x0000 never
 * collides with band 1 = 0x0000. Returned as signed 32-bit ints for int[] storage.
 */
export function simhashBands(h: bigint): number[] {
  const bands: number[] = [];
  for (let i = 0; i < 4; i++) {
    const band = Number((h >> BigInt(i * 16)) & 0xffffn);
    bands.push((i << 16) | band);
  }
  return bands;
}

/** Postgres int8 is signed; JS bigints from simhash are not. Convert both ways. */
export function toSigned64(h: bigint): bigint {
  return h >= 1n << 63n ? h - (1n << 64n) : h;
}

export function fromSigned64(h: bigint): bigint {
  return h < 0n ? h + (1n << 64n) : h;
}

/** Distance <= 3 over 64 bits is the standard near-duplicate threshold. */
export const NEAR_DUPLICATE_DISTANCE = 3;

export function isNearDuplicate(a: bigint, b: bigint, threshold = NEAR_DUPLICATE_DISTANCE): boolean {
  return hammingDistance(a, b) <= threshold;
}

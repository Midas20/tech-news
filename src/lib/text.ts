// Text normalization, shingling and the ingest length gate.
//
// CJK is handled separately throughout. A 150-character Chinese post carries
// roughly as much information as a 400-character English one, so one global
// length threshold would either flood the pipeline with English stubs or throw
// away substantial Japanese and Chinese writing.

const CJK_RANGES =
  /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;

const CJK_GLOBAL =
  /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g;

import { getConfig } from '../config.ts';

/** Defaults; the operative values come from config (MIN_CONTENT_CHARS_*). */
export const MIN_LENGTH_LATIN = 400;
export const MIN_LENGTH_CJK = 150;

export function hasCJK(s: string): boolean {
  return CJK_RANGES.test(s);
}

/** Share of characters that are CJK. Mixed-script posts are common in JA and ZH. */
export function cjkRatio(s: string): number {
  if (!s) return 0;
  const matches = s.match(CJK_GLOBAL);
  return matches ? matches.length / s.length : 0;
}

export function isCJKText(s: string): boolean {
  return cjkRatio(s) > 0.15;
}

export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeForCompare(s: string): string {
  return normalize(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip HTML without a DOM. Used on feed summaries, which are small and messy. */
export function stripHtml(html: string): string {
  return normalize(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d))),
  );
}

/**
 * Feature shingles for SimHash. Word trigrams for Latin scripts, character
 * bigrams for CJK -- there are no spaces to tokenize on in Chinese or Japanese,
 * and word-segmenting them properly would mean shipping a dictionary.
 */
export function shingles(text: string, size = 3): Map<string, number> {
  const out = new Map<string, number>();
  const cleaned = normalizeForCompare(text);
  if (!cleaned) return out;

  const units = isCJKText(cleaned)
    ? Array.from(cleaned.replace(/\s+/g, ''))
    : cleaned.split(' ');
  const window = isCJKText(cleaned) ? 2 : size;

  if (units.length < window) {
    out.set(units.join(' '), 1);
    return out;
  }
  for (let i = 0; i <= units.length - window; i++) {
    const key = units.slice(i, i + window).join(isCJKText(cleaned) ? '' : ' ');
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/**
 * Feature set for SimHash. Unigrams plus bigrams, not trigrams.
 *
 * This matters more than it looks. Inserting two words ("has been released"
 * versus "released") shifts every trigram that spans the insertion, so a pair of
 * outlets reporting one release lands 25 bits apart -- past any sane threshold.
 * Unigrams carry the topical mass and bigrams keep enough word order to stop
 * unrelated stories about the same technology from colliding.
 */
export function features(text: string): Map<string, number> {
  const cleaned = normalizeForCompare(text);
  if (!cleaned) return new Map();
  if (isCJKText(cleaned)) return shingles(cleaned, 2);

  const out = new Map<string, number>();
  for (const [gram, count] of shingles(cleaned, 1)) {
    out.set(gram, (out.get(gram) ?? 0) + count * 2);
  }
  for (const [gram, count] of shingles(cleaned, 2)) {
    out.set(gram, (out.get(gram) ?? 0) + count);
  }
  return out;
}

export function wordCount(text: string): number {
  const cleaned = normalizeForCompare(text);
  if (!cleaned) return 0;
  if (isCJKText(cleaned)) return cleaned.replace(/\s+/g, '').length;
  return cleaned.split(' ').filter(Boolean).length;
}

/**
 * Token-set overlap between two titles, 0..1. Free, and it is the same evidence
 * the model would be shown -- so it belongs in front of the model, not after it.
 * CJK titles compare on character bigrams, since there are no spaces to split.
 */
export function titleOverlap(a: string, b: string): number {
  const tokens = (s: string): Set<string> => {
    const cleaned = normalizeForCompare(s);
    if (!cleaned) return new Set();
    if (isCJKText(cleaned)) return new Set(shingles(cleaned, 2).keys());
    return new Set(cleaned.split(' ').filter((t) => t.length > 2));
  };
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

export interface LengthVerdict {
  passes: boolean;
  length: number;
  threshold: number;
  script: 'cjk' | 'latin';
}

export function checkLength(text: string): LengthVerdict {
  const cleaned = normalize(text);
  const cjk = isCJKText(cleaned);
  const { minCharsCJK, minCharsLatin } = getConfig().filters;
  const threshold = cjk ? minCharsCJK : minCharsLatin;
  return {
    passes: cleaned.length >= threshold,
    length: cleaned.length,
    threshold,
    script: cjk ? 'cjk' : 'latin',
  };
}

/** ~400 characters, cut on a sentence boundary where one is available. */
export function truncateSummary(text: string, max = 400): string {
  const cleaned = normalize(text);
  if (cleaned.length <= max) return cleaned;
  const slice = cleaned.slice(0, max);
  const boundary = Math.max(
    slice.lastIndexOf('. '), slice.lastIndexOf('。'),
    slice.lastIndexOf('! '), slice.lastIndexOf('? '),
  );
  return boundary > max * 0.6 ? slice.slice(0, boundary + 1) : slice.trimEnd() + '…';
}

import { describe, it, expect } from 'vitest';
import { canonicalizeUrl, hasAffiliateMarkers, registrableDomain } from '../src/lib/url.ts';
import { detectLanguage, passesLanguageGate } from '../src/lib/lang.ts';
import { checkLength, shingles, truncateSummary, isCJKText } from '../src/lib/text.ts';
import { simhash, hammingDistance, simhashBands, toSigned64, fromSigned64 } from '../src/lib/simhash.ts';
import { contentHash, toHex, stableStringify } from '../src/lib/hash.ts';
import { AUTO_MERGE_DISTANCE, ASK_MODEL_MAX_DISTANCE } from '../src/process/dedup.ts';

describe('canonicalizeUrl', () => {
  it('treats tracking-decorated and bare URLs as one page', async () => {
    const a = canonicalizeUrl('https://example.com/post?utm_source=hn&utm_medium=social');
    const b = canonicalizeUrl('http://www.example.com/post/');
    expect(a?.url).toBe(b?.url);
    expect(a?.hadTracking).toBe(true);
  });

  it('sorts query parameters so ordering cannot fork identity', () => {
    expect(canonicalizeUrl('https://x.com/a?b=2&a=1')?.url)
      .toBe(canonicalizeUrl('https://x.com/a?a=1&b=2')?.url);
  });

  it('folds AMP variants onto the article', () => {
    expect(canonicalizeUrl('https://news.example/story/amp')?.url)
      .toBe('https://news.example/story');
  });

  it('keeps meaningful query parameters', () => {
    expect(canonicalizeUrl('https://example.com/search?q=rust')?.url)
      .toBe('https://example.com/search?q=rust');
  });

  it('rejects non-http schemes', () => {
    expect(canonicalizeUrl('mailto:someone@example.com')).toBeNull();
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('affiliate detection', () => {
  it('flags affiliate markers on the raw URL', () => {
    expect(hasAffiliateMarkers('https://host.example/vps?aff=1234')).toBe(true);
    expect(hasAffiliateMarkers('https://blog.example/go/provider')).toBe(true);
    expect(hasAffiliateMarkers('https://blog.example/posts/why-i-left')).toBe(false);
  });

  it('must run before canonicalization, which strips the evidence', () => {
    const raw = 'https://host.example/vps?ref=someone';
    expect(hasAffiliateMarkers(raw)).toBe(true);
    expect(hasAffiliateMarkers(canonicalizeUrl(raw)!.url)).toBe(false);
  });
});

describe('registrableDomain', () => {
  it('handles two-level TLDs', () => {
    expect(registrableDomain('blog.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('www.example.com')).toBe('example.com');
    expect(registrableDomain('tech.blog.example.co.jp')).toBe('example.co.jp');
  });
});

describe('language detection', () => {
  it('detects Japanese from kana even when mostly Han and Latin', () => {
    const r = detectLanguage('PostgreSQL 18 のリリースについて解説します。新機能は多数あります。');
    expect(r.lang).toBe('ja');
  });

  it('detects Chinese from Han without kana', () => {
    const r = detectLanguage('开源社区发布了新版本数据库引擎，性能提升明显，支持向量检索功能。');
    expect(r.lang).toBe('zh');
  });

  it('separates German from English', () => {
    expect(detectLanguage(
      'Die Entwickler haben eine neue Version veröffentlicht, die nicht mit der alten kompatibel ist und auch mehr Speicher benötigt.',
    ).lang).toBe('de');
    expect(detectLanguage(
      'The maintainers have released a new version that is not compatible with the old one and also requires more memory from the host.',
    ).lang).toBe('en');
  });

  it('drops languages outside the gate', () => {
    const fr = detectLanguage(
      'Les développeurs ont publié une nouvelle version pour les serveurs dans le cadre du projet avec des correctifs.',
    );
    expect(passesLanguageGate(fr)).toBe(false);
    const ru = detectLanguage('Разработчики выпустили новую версию базы данных с исправлениями.');
    expect(passesLanguageGate(ru)).toBe(false);
  });
});

describe('length gate', () => {
  it('uses a lower threshold for CJK', () => {
    const cjk = '数'.repeat(200);
    const latin = 'a '.repeat(100);
    expect(isCJKText(cjk)).toBe(true);
    expect(checkLength(cjk).threshold).toBe(150);
    expect(checkLength(cjk).passes).toBe(true);
    expect(checkLength(latin).threshold).toBe(400);
    expect(checkLength(latin).passes).toBe(false);
  });
});

describe('simhash', () => {
  it('auto-merges a repost that differs only in boilerplate', () => {
    const body = 'Postgres 18 is out. The release reworks vacuum scheduling and the parallel query planner. ';
    const a = simhash(body.repeat(6));
    const b = simhash('Share this article. ' + body.repeat(6) + ' Subscribe to our newsletter.');
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(AUTO_MERGE_DISTANCE);
  });

  it('leaves a reworded copy above the auto-merge line, for the model to settle', () => {
    const a = simhash('Postgres 18 released with faster vacuum and better parallel query planning support');
    const b = simhash('Postgres 18 has been released with faster vacuum and improved parallel query planning support');
    const d = hammingDistance(a, b);
    expect(d).toBeGreaterThan(AUTO_MERGE_DISTANCE);
    expect(d).toBeLessThanOrEqual(ASK_MODEL_MAX_DISTANCE);
  });

  it('gives unrelated stories a large distance', () => {
    const a = simhash('Postgres 18 released with faster vacuum and parallel query planning');
    const b = simhash('Rust 1.90 stabilises async closures and improves compile times for large crates');
    expect(hammingDistance(a, b)).toBeGreaterThan(15);
  });

  it('is stable for identical input', () => {
    expect(simhash('the same text twice')).toBe(simhash('the same text twice'));
  });

  it('produces four position-tagged bands', () => {
    const bands = simhashBands(simhash('some representative story text here'));
    expect(bands).toHaveLength(4);
    expect(new Set(bands.map((b) => b >>> 16)).size).toBe(4);
  });

  it('round-trips through signed 64-bit storage', () => {
    const h = simhash('a story with a high bit set somewhere in its hash value');
    expect(fromSigned64(toSigned64(h))).toBe(h);
  });
});

describe('shingles', () => {
  it('uses character bigrams for CJK, where there are no spaces to split on', () => {
    const s = shingles('数据库引擎发布');
    expect([...s.keys()][0]).toHaveLength(2);
  });

  it('uses word trigrams for Latin scripts', () => {
    const s = shingles('the quick brown fox jumps');
    expect(s.has('the quick brown')).toBe(true);
  });
});

describe('content hashing', () => {
  it('ignores whitespace and case differences', async () => {
    const a = await contentHash('Title', 'Some   body\n\ntext');
    const b = await contentHash('title', 'some body text');
    expect(toHex(a)).toBe(toHex(b));
  });

  it('separates genuinely different bodies', async () => {
    const a = await contentHash('Title', 'body one');
    const b = await contentHash('Title', 'body two');
    expect(toHex(a)).not.toBe(toHex(b));
  });
});

describe('stableStringify', () => {
  it('is key-order independent so cache keys do not fork', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 4, c: 3 }] }))
      .toBe(stableStringify({ a: [2, { c: 3, d: 4 }], b: 1 }));
  });
});

describe('truncateSummary', () => {
  it('cuts on a sentence boundary when one is close enough', () => {
    const text = 'Sentence one is reasonably long and carries real detail. '.repeat(8);
    const out = truncateSummary(text, 400);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.endsWith('.')).toBe(true);
  });

  it('falls back to an ellipsis when the only boundary is far too early', () => {
    const text = 'Short. ' + 'x'.repeat(500);
    expect(truncateSummary(text, 400).endsWith('…')).toBe(true);
  });
});

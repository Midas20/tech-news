import { describe, it, expect } from 'vitest';
import { titleOverlap } from '../src/lib/text.ts';
import { TITLE_OVERLAP_FLOOR, TITLE_OVERLAP_CERTAIN } from '../src/process/dedup.ts';

describe('titleOverlap — the free gate in front of the model', () => {
  it('scores two outlets on one event above the certainty line', () => {
    const o = titleOverlap(
      'Postgres 18 released with faster vacuum and parallel query planning',
      'Postgres 18 release brings faster vacuum and parallel query planning',
    );
    expect(o).toBeGreaterThanOrEqual(TITLE_OVERLAP_CERTAIN);
  });

  it('leaves a genuinely ambiguous pair in the band that reaches the model', () => {
    const o = titleOverlap(
      'Critical OpenSSL flaw allows remote code execution',
      'OpenSSL patches remote code execution vulnerability in SOCKS5 handshake',
    );
    expect(o).toBeGreaterThanOrEqual(TITLE_OVERLAP_FLOOR);
    expect(o).toBeLessThan(TITLE_OVERLAP_CERTAIN);
  });

  it('rejects unrelated stories that merely collided in a hash band', () => {
    // This is the case that produced 9,763 useless candidate pairs on real data:
    // topically similar corpora share simhash bands constantly.
    const o = titleOverlap(
      'Kubernetes 1.34 deprecates in-tree cloud providers',
      'Rust 1.90 stabilises async closures',
    );
    expect(o).toBeLessThan(TITLE_OVERLAP_FLOOR);
  });

  it('handles CJK titles, which have no spaces to tokenize on', () => {
    const same = titleOverlap('数据库引擎发布新版本支持向量检索', '数据库引擎发布新版本支持向量索引');
    const different = titleOverlap('数据库引擎发布新版本', '前端框架的渲染性能优化实践');
    expect(same).toBeGreaterThan(different);
    expect(different).toBeLessThan(TITLE_OVERLAP_FLOOR);
  });

  it('returns 0 rather than dividing by zero on empty input', () => {
    expect(titleOverlap('', 'anything at all')).toBe(0);
  });
});

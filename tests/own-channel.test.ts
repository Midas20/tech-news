// A company writing about its own work bypasses the event gate.
//
// The classifier reads a headline for the shape of an event, and a company
// engineering blog does not write in that shape. Measured over 24 hours it
// refused 390 of ClickHouse's posts and kept 1, refused all 93 of OpenAI's and
// all 112 of Vercel's. Thirty-seven channels were being fetched and thrown
// away.
//
// The flag that carries this has to survive two separate SELECTs before it
// reaches the decision, and if either one drops the column nothing errors --
// the bypass just quietly stops working and the channels go silent again. That
// is what most of this file is about.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { allowsArticles } from '../src/collect/ingest.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('which sources may publish an article', () => {
  it('admits a source whose whole output is technology', () => {
    expect(allowsArticles({ tech_only: true })).toBe(true);
  });

  it('admits a company writing about its own work', () => {
    // Belt and braces: a company channel is tech-only by construction, and
    // this covers one seeded without the flag.
    expect(allowsArticles({ company_slug: 'cloudflare' })).toBe(true);
  });

  it('refuses everything else, which is the press', () => {
    // The three non-tech-only rows in the registry are InfoQ, The New Stack
    // and The Register: outlets that cover the industry as an industry, where
    // the event test is the only thing keeping funding rounds and breaches out.
    expect(allowsArticles({ tech_only: false, company_slug: null })).toBe(false);
    expect(allowsArticles({})).toBe(false);
  });

  it('is not fooled by an empty string or a null', () => {
    expect(allowsArticles({ company_slug: '' })).toBe(false);
    expect(allowsArticles({ tech_only: null })).toBe(false);
  });
});

describe('the flag reaching the gate', () => {
  // Two queries load a source for collection. Both must carry the column.
  const queries = [
    ['src/db/repos/sources.ts', read('../src/db/repos/sources.ts')],
    ['src/collect/cycle.ts', read('../src/collect/cycle.ts')],
  ] as const;

  it('is selected by every query that loads a source for polling', () => {
    for (const [name, src] of queries) {
      expect(src.includes('tech_only'), `${name} must select tech_only`).toBe(true);
      // Find each SELECT that pulls the collector's column set, and require
      // company_slug among them. Keyed on consecutive_failures because that is
      // the neighbouring column in both, and a query that has one and not the
      // other is the exact failure this guards.
      const selects = src.split('consecutive_failures').slice(1);
      expect(selects.length, `${name} should load sources`).toBeGreaterThan(0);
      const carries = src.includes('company_slug');
      expect(carries, `${name} must select company_slug`).toBe(true);
    }
  });

  it('is on the row type, so dropping it from the SELECT fails to typecheck', () => {
    expect(read('../src/db/repos/sources.ts')).toContain('company_slug: string | null;');
  });
});

describe('the gate itself', () => {
  const ingest = read('../src/collect/ingest.ts');

  it('lets a tech-only source past not_an_event and nothing else', () => {
    // The refusal must still apply to every other source: this is a narrowing
    // of one gate, not its removal.
    expect(ingest).toContain('!isEvent(verdict.kind) && !allowsArticles(source)');
  });

  it('leaves the off-topic gate alone', () => {
    // A company blogging about its hiring is still refused. The bypass is
    // written after the topical check and must not reach it.
    const offTopic = ingest.indexOf("drops.record('off_topic')");
    const bypass = ingest.indexOf('allowsArticles(source)');
    expect(offTopic).toBeGreaterThan(0);
    expect(bypass).toBeGreaterThan(offTopic);
  });
});

// A wall is not brevity.
//
// Measured 2026-08-29, chasing "the count of AI is very small". The OpenAI blog
// had been in the registry for its whole life, polled hourly, reporting itself
// healthy — and had produced ZERO stories. Ever.
//
//   fetch_log: status 200, items_seen 1157, items_kept 0
//   drop_reasons: { already_archived: 1069, too_short: 48, off_topic: 39, ... }
//   24-hour total: 8,097 `too_short` drops from that one source
//
// openai.com answers 403 to this collector, and its feed carries 110–160
// character summaries. The article fetch that exists precisely to rescue a thin
// feed item came back refused, so every item failed the 400-character bar.
//
// The shortness was OURS. A publisher who writes two sentences has told us
// something; a publisher whose server refuses us has told us nothing, and
// treating those the same lost the best-known source in the busiest field.
describe('a first-party announcement behind a wall', () => {
  const src = readFileSync(new URL('../src/collect/ingest.ts', import.meta.url), 'utf8');

  it('remembers that the page refused, rather than only that the text was short', () => {
    expect(src).toContain('pageBlocked');
    expect(src).toContain("if (page.kind !== 'ok') { c.pageBlocked = true; return; }");
  });

  it('needs all three conditions, not any one of them', () => {
    // On the beat by construction, the subject of its own announcement, and
    // asked-for-and-refused. Any two without the third is a hole.
    const at = src.indexOf('const walledAnnouncement');
    const clause = src.slice(at, at + 220);
    expect(clause).toContain('c.pageBlocked === true');
    expect(clause).toContain('source.tech_only');
    expect(clause).toContain("source.roles.includes('PRIMARY')");
    expect(clause).toContain('&&');
  });

  it('drops the bar to zero rather than lowering it a little', () => {
    // The title IS the record here, and classifyEvent() reads the title and
    // nothing else — so the item is classified exactly as it would have been
    // with a full body. Half a bar would be a number nobody could justify.
    expect(src).toContain('walledAnnouncement ? 0 : opts.minLength');
  });

  it('leaves a source that answered normally on the ordinary bar', () => {
    // The regression this must not become: a blanket lowering that admits thin
    // items from every hand-picked source.
    expect(src).not.toMatch(/const walledAnnouncement = Boolean\(source\.tech_only\)/);
  });

  it('makes the same argument release feeds already make', () => {
    // RELEASE_MIN_LENGTH = 0 because "release notes are events, not essays".
    // This is the announcement case of that sentence, and the comment says so
    // rather than leaving the next reader to wonder if it is a special case.
    expect(src).toContain('RELEASE_MIN_LENGTH');
  });
});

// Two sources that produced nothing while reporting themselves healthy.
//
// The fixtures below are cut from the real documents on 2026-08-27. They are
// small on purpose: what is being held is the SHAPE -- the boundary marker in
// Google Cloud's digest, the stable class prefix in OpenAI's page -- because
// that shape is the whole of the contract with a publisher who never agreed to
// one. When either changes, these fail here rather than silently in production.

import { describe, it, expect } from 'vitest';
import { splitGoogleCloudDigest, parseOpenAiChangelog } from '../src/collect/changelogs.ts';
import { bandCandidates } from '../src/db/repos/stories.ts';
import { parseDate } from '../src/collect/feed.ts';

// A day-digest, exactly as it arrives inside one <content> element.
const GCP_DAY = `
<h2 class="release-note-product-title">Cloud Trace</h2>
<h3>Feature</h3>
<p>The following remote MCP server automatically generates a trace span for
<code>tools/call</code> operations.</p>
<ul><li>Datastream</li></ul>
<p>These spans can help you understand the behavior of your agentic applications.</p>
<h2 class="release-note-product-title">BigQuery</h2>
<h3>Security</h3>
<p>An Improper Input Validation vulnerability was discovered in the JDBC driver.</p>
<h2 class="release-note-product-title">Cloud Run</h2>
<h3>Deprecated</h3>
<p>Support for the legacy deployment API ends on January 15, 2027.</p>`;

describe('Google Cloud release notes: one entry per day, not per change', () => {
  const day = new Date('2026-08-27T00:00:00Z');

  it('splits the digest on the boundary the publisher already marked', () => {
    const items = splitGoogleCloudDigest(GCP_DAY, day);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.title.split(' —')[0])).toEqual(['Cloud Trace', 'BigQuery', 'Cloud Run']);
  });

  it('gives every note its own URL, which is the entire bug', () => {
    // The feed links every entry to the same page with a different fragment, and
    // fragments are stripped when canonicalising -- so thirty changes collapsed
    // onto one URL and twenty-seven were refused as duplicates, every hour.
    const items = splitGoogleCloudDigest(GCP_DAY, day);
    const links = items.map((i) => i.link);
    expect(new Set(links).size).toBe(items.length);
    for (const link of links) {
      expect(link).toContain('date=2026-08-27');
      // Query parameters survive canonicalisation; fragments do not.
      expect(link).not.toContain('#');
    }
  });

  it('keeps the kind in the title, where the classifiers read', () => {
    // classifyEvent and the money lens read the TITLE and nothing else, so
    // "Deprecated" has to survive into it or an end-of-life notice is filed as
    // an ordinary change and never reaches the money lens.
    const items = splitGoogleCloudDigest(GCP_DAY, day);
    const cloudRun = items.find((i) => i.title.startsWith('Cloud Run'))!;
    expect(cloudRun.title).toContain('Deprecated');
    expect(cloudRun.title).toContain('ends on January 15, 2027');
    expect(items.find((i) => i.title.startsWith('BigQuery'))!.title).toContain('Security');
  });

  it('separates two notes for the same product on the same day', () => {
    // Not observed in the live feed -- 338 items, 338 distinct links -- but the
    // failure being fixed is silent collapse, so this is structural rather than
    // a bet on tomorrow's data.
    const twice = `${GCP_DAY}
      <h2 class="release-note-product-title">BigQuery</h2>
      <h3>Fixed</h3><p>A second BigQuery note on the same day.</p>`;
    const items = splitGoogleCloudDigest(twice, day);
    expect(items).toHaveLength(4);
    expect(new Set(items.map((i) => i.link)).size).toBe(4);
  });

  it('reports nothing rather than guessing when the markup changes', () => {
    // The h2 class is the contract. If Google renames it, the adapter must find
    // zero and throw -- the caller turns that into a source error. Returning a
    // best-effort paragraph would look like a quiet news day forever.
    expect(splitGoogleCloudDigest('<p>no headings here</p>', day)).toHaveLength(0);
  });
});

// One entry from the changelog page. The class hashes (_10t5o_1, _f3xd6_19) are
// rebuilt whenever the stylesheet is, which is why the selectors match prefixes.
const OPENAI_ENTRY = `<div class="mt-5"><div class="grid grid-cols-[3rem_1fr] items-start gap-x-4 gap-y-2">
<div><div class="_Badge_10t5o_1" data-variant="outline">Aug 21</div></div>
<div><div class="flex flex-wrap gap-2 mb-2">
<div class="_Badge_10t5o_1" data-variant="soft"><span class="capitalize">Update</span></div>
<div class="_Badge_10t5o_1" data-variant="soft">gpt-5.6-sol</div></div>
<div class="_MarkdownContent_abpsh_1 _ChangelogMarkdown_f3xd6_19"><p>GPT-5.6 Sol now costs $4 per
million input tokens and $20 per million output tokens, representing 20% lower input pricing.</p>
</div></div></div></div>`;

describe('OpenAI changelog: an announcement channel with no feed', () => {
  const now = new Date('2026-08-27T12:00:00Z');

  it('reads the entry a marketing feed could never give', () => {
    const items = parseOpenAiChangelog(OPENAI_ENTRY, now);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.title).toContain('gpt-5.6-sol');
    expect(item.title).toContain('Update');
    expect(item.title).toContain('costs $4 per million input tokens');
    expect(item.publishedAt?.toISOString().slice(0, 10)).toBe('2026-08-21');
  });

  it('carries the words the money lens is looking for', () => {
    // This is the point of the swap. `openai.com/news/rss.xml` kept 0 of 3,395
    // items in 24 hours because it publishes customer stories; a price change is
    // exactly what the archive exists to catch.
    const [item] = parseOpenAiChangelog(OPENAI_ENTRY, now);
    expect(item!.title.toLowerCase()).toMatch(/pricing|costs|\$/);
  });

  it('gives each entry a distinct URL even though the page has no anchors', () => {
    const two = OPENAI_ENTRY + OPENAI_ENTRY.replace(
      'GPT-5.6 Sol now costs $4 per', 'Something entirely different happened, namely');
    const items = parseOpenAiChangelog(two, now);
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.link)).size).toBe(2);
  });

  it('drops a repeat of the identical entry rather than storing it twice', () => {
    expect(parseOpenAiChangelog(OPENAI_ENTRY + OPENAI_ENTRY, now)).toHaveLength(1);
  });

  it('reads a bare "Aug 21" as the most recent one, not next year', () => {
    // The page prints no year. Reading December's entry as this December while
    // standing in January would date it eleven months in the future, where the
    // retention window refuses it as too_old and it is silently lost.
    const december = OPENAI_ENTRY.replace('Aug 21', 'Dec 15');
    const [item] = parseOpenAiChangelog(december, new Date('2026-01-10T00:00:00Z'));
    expect(item!.publishedAt?.toISOString().slice(0, 10)).toBe('2025-12-15');
  });

  it('finds nothing when the page stops being server-rendered', () => {
    expect(parseOpenAiChangelog('<div id="root"></div>', now)).toHaveLength(0);
  });
});

describe('near-duplicate search looks at other sources only', () => {
  // Layer 2 asks "did somebody ELSE carry this story" -- that is what coverage
  // means. Two items from one publisher are two announcements by construction,
  // and turning fuzzy similarity loose on one changelog eats the payload and
  // keeps the boilerplate: "GKE (2026-R35) version updates" was merged into
  // "(2026-R34)", two different release rounds a week apart.
  function spy() {
    const seen: { sql: string; params: unknown[] }[] = [];
    return {
      seen,
      db: { async query(sql: string, params: unknown[] = []) { seen.push({ sql, params }); return []; } },
    };
  }

  it('excludes the source the story came from', async () => {
    const { db, seen } = spy();
    await bandCandidates(db, [1, 2], new Date('2026-08-27'), 'story-id', 'source-id');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.sql).toContain('source_id IS DISTINCT FROM');
    expect(seen[0]!.params).toContain('source-id');
  });

  it('still searches everything when the source is unknown', async () => {
    // A null source must widen the search rather than silently match nothing --
    // `source_id <> NULL` is NULL, which would return no candidates at all and
    // turn dedup off without a word.
    const { db, seen } = spy();
    await bandCandidates(db, [1], new Date('2026-08-27'), 'story-id', null);
    expect(seen[0]!.sql).toContain('IS NULL OR');
    expect(seen[0]!.params[4]).toBe(null);
  });
});

describe('an identical title is not always the same story', () => {
  // Layer 3 hashes the ENGLISH title, so it catches one story carried by two
  // outlets in two languages -- which is what it is for, and which still merges.
  //
  // The same title from the SAME source on a DIFFERENT DAY is something else: a
  // changelog publishing boilerplate. Google Cloud posts "Agent Platform
  // Workbench - Change: Installed latest packages from upstream dependencies"
  // repeatedly, and each is a different day's update. Three such pairs were
  // merged here, two weeks apart in each case, and each merge lost a day.
  function shouldMerge(
    a: { source: string; day: string }, b: { source: string; day: string },
  ): boolean {
    const sameSource = a.source === b.source;
    const sameDay = a.day === b.day;
    return !(sameSource && !sameDay);
  }

  it('merges the same title from two different outlets', () => {
    expect(shouldMerge(
      { source: 'reuters', day: '2026-08-27' },
      { source: 'bbc', day: '2026-08-27' })).toBe(true);
    // Even on different days: two outlets filing the same story a day apart is
    // still one story.
    expect(shouldMerge(
      { source: 'reuters', day: '2026-08-27' },
      { source: 'bbc', day: '2026-08-28' })).toBe(true);
  });

  it('refuses to merge one changelog with itself across days', () => {
    expect(shouldMerge(
      { source: 'gcp', day: '2026-08-13' },
      { source: 'gcp', day: '2026-08-27' })).toBe(false);
  });

  it('still merges a repost from one source on the same day', () => {
    // Same source, same day, same title is a genuine duplicate -- a feed
    // serving one item under a second URL.
    expect(shouldMerge(
      { source: 'gcp', day: '2026-08-27' },
      { source: 'gcp', day: '2026-08-27' })).toBe(true);
  });
});

// A date the archive could not have fetched.
//
// Found 2026-08-29 while checking a reasonable question -- "the last AI news is
// 6 hours ago, is it correct?" It was correct; Saturday averages 1.6 AI stories
// against ~14 on a Tuesday, and the collector was fetching every few seconds.
// But sitting above the newest real story was a Cloudflare changelog entry
// dated 2026-08-30 00:00, four hours in the future, fetched at 17:57 the day
// before.
//
// A date-only feed value parses as midnight UTC, so a publisher who stamps
// tomorrow's date lands ahead of the clock. Every page orders by
// coalesce(published_at, collected_at), so the row pins itself to the top of
// every newest-first list until midnight catches up -- and relativeTime()
// clamps a negative age to zero, so it reads "now" and hides why.
describe('a publication date from the future', () => {
  const NOW = Date.parse('2026-08-29T17:57:00Z');

  it('is refused, because nothing is published after it is fetched', () => {
    expect(parseDate('2026-08-30', NOW)).toBeNull();
    expect(parseDate('2026-08-30T00:00:00Z', NOW)).toBeNull();
  });

  it('leaves a small allowance for two clocks disagreeing', () => {
    // Skew between machines is real; genuinely future news is not.
    expect(parseDate('2026-08-29T18:30:00Z', NOW)).not.toBeNull();
    expect(parseDate('2026-08-29T19:30:00Z', NOW)).toBeNull();
  });

  it('still accepts every date in the past', () => {
    expect(parseDate('2026-08-29T13:58:00Z', NOW)).not.toBeNull();
    expect(parseDate('2014-01-01T00:00:00Z', NOW)).not.toBeNull();
  });

  it('still refuses the decades-out ones the year check was for', () => {
    expect(parseDate('2087-01-01', NOW)).toBeNull();
    expect(parseDate('1970-01-01', NOW)).toBeNull();
  });

  it('becomes absent rather than clamped to now', () => {
    // This function's existing contract: published_at is allowed to be missing
    // and collected_at is what the system trusts. A clamped date would claim
    // the story was published at the instant it was fetched.
    expect(parseDate('2026-08-30', NOW)).toBeNull();
  });
});

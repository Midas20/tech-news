import { describe, it, expect } from 'vitest';
import { parseFeed, parseDate } from '../src/collect/feed.ts';
import { gateItem, isPodcastFeed, hasMediaEnclosure, DropCounter } from '../src/collect/filters.ts';
import { discoverFeedLinks } from '../src/collect/fetcher.ts';
import { extractArticle, extractReadable } from '../src/collect/extract.ts';
import { validate, extractJson } from '../src/llm/schema.ts';
import { JOBS } from '../src/llm/jobs.ts';
import { pickCanonical } from '../src/process/dedup.ts';
import { RELEASE_MIN_LENGTH, qualifyReleaseTitle } from '../src/collect/pipeline.ts';
import { nicheScore, noveltyScore, depthScore, assignTier } from '../src/process/score.ts';
import { validateFields, type Taxonomy } from '../src/process/taxonomy.ts';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Tech</title>
    <item>
      <title>Postgres 18 released</title>
      <link>https://example.com/pg18?utm_source=rss</link>
      <guid>https://example.com/pg18</guid>
      <dc:creator>A. Maintainer</dc:creator>
      <pubDate>Tue, 12 Aug 2025 09:00:00 GMT</pubDate>
      <description>Short teaser.</description>
      <content:encoded><![CDATA[<p>The release includes <a href="https://other.example/vacuum">vacuum changes</a>.</p>]]></content:encoded>
    </item>
    <item>
      <title>Podcast episode 12</title>
      <link>https://example.com/ep12</link>
      <enclosure url="https://example.com/ep12.mp3" type="audio/mpeg" length="1000"/>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Releases</title>
  <entry>
    <title>v2.0.0</title>
    <link rel="alternate" href="/releases/v2"/>
    <id>tag:example,2025:v2</id>
    <updated>2025-08-12T09:00:00Z</updated>
    <summary>Breaking change to the config format.</summary>
  </entry>
</feed>`;

describe('feed parsing', () => {
  it('parses RSS, canonicalizes links and keeps outbound links for discovery', () => {
    const feed = parseFeed(RSS, 'https://example.com/feed');
    expect(feed?.format).toBe('rss');
    expect(feed?.items).toHaveLength(2);

    const first = feed!.items[0]!;
    expect(first.title).toBe('Postgres 18 released');
    expect(first.link).toBe('https://example.com/pg18');   // tracking stripped
    expect(first.author).toBe('A. Maintainer');
    expect(first.publishedAt?.toISOString()).toBe('2025-08-12T09:00:00.000Z');
    expect(first.outboundLinks).toContain('https://other.example/vacuum');
    expect(first.content).toContain('vacuum changes');
  });

  it('resolves relative Atom links against the feed URL', () => {
    const feed = parseFeed(ATOM, 'https://example.com/releases.atom');
    expect(feed?.format).toBe('atom');
    expect(feed?.items[0]?.link).toBe('https://example.com/releases/v2');
  });

  it('parses JSON Feed', () => {
    const json = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Lobsters',
      items: [{ id: '1', title: 'A story', url: 'https://example.com/s', content_text: 'body' }],
    });
    const feed = parseFeed(json, 'https://lobste.rs/hottest.json');
    expect(feed?.format).toBe('jsonfeed');
    expect(feed?.items[0]?.title).toBe('A story');
  });

  it('accepts a bare JSON array, which is what Lobsters actually serves', () => {
    const json = JSON.stringify([
      { short_id: 'abc', title: 'Link post', url: 'https://example.com/x',
        description: '<p>body</p>', created_at: '2025-08-12T09:00:00-05:00',
        submitter_user: 'someone' },
      { short_id: 'def', title: 'Self post', url: '',
        comments_url: 'https://lobste.rs/s/def', description: '<p>text</p>',
        created_at: '2025-08-12T10:00:00-05:00' },
    ]);
    const feed = parseFeed(json, 'https://lobste.rs/hottest.json');
    expect(feed?.format).toBe('jsonfeed');
    expect(feed?.items[0]?.link).toBe('https://example.com/x');
    expect(feed?.items[0]?.author).toBe('someone');
    // A self-post has no external URL; the discussion page IS the story.
    expect(feed?.items[1]?.link).toBe('https://lobste.rs/s/def');
  });

  it('survives an entity-heavy feed instead of failing the whole source', () => {
    const entities = Array.from({ length: 400 }, (_, i) =>
      `<item><title>Tom &amp; Jerry ${i} &#8212; part &amp; parcel</title>` +
      `<link>https://example.com/${i}</link><description>a &amp; b</description></item>`,
    ).join('');
    const feed = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel>${entities}</channel></rss>`, 'https://example.com/feed');
    expect(feed?.items).toHaveLength(400);
    expect(feed?.items[0]?.title).toContain('&');
  });

  it('returns null rather than throwing on rubbish', () => {
    expect(parseFeed('<html><body>not a feed</body></html>', 'https://x.example')).toBeNull();
  });
});

describe('parseDate', () => {
  it('treats implausible dates as absent, because collected_at is the trusted field', () => {
    expect(parseDate('Tue, 12 Aug 1970 09:00:00 GMT')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate('2025-08-12T09:00:00Z')?.getUTCFullYear()).toBe(2025);
  });
});

describe('ingest gates', () => {
  const feed = parseFeed(RSS, 'https://example.com/feed')!;

  it('drops media items', () => {
    expect(hasMediaEnclosure(feed.items[1]!)).toBe(true);
    expect(gateItem(feed.items[1]!, 'x'.repeat(500)).reason).toBe('media_enclosure');
  });

  it('drops items below the length threshold', () => {
    const g = gateItem(feed.items[0]!, 'too short');
    expect(g.keep).toBe(false);
    expect(g.reason).toBe('too_short');
  });

  it('keeps a substantial English item and records its language', () => {
    const body = 'The release includes vacuum changes and query planner improvements. '.repeat(10);
    const g = gateItem(feed.items[0]!, body);
    expect(g.keep).toBe(true);
    expect(g.lang).toBe('en');
  });

  it('recognises a podcast feed rather than dropping items one by one', () => {
    const items = [0, 1, 2, 3].map(() => ({ ...feed.items[1]! }));
    expect(isPodcastFeed(items)).toBe(true);
    expect(isPodcastFeed(feed.items)).toBe(false); // 1 of 2 is not a majority
  });

  it('counts drops for the observation-week histogram', () => {
    const counter = new DropCounter();
    counter.record('too_short');
    counter.record('too_short');
    counter.record('lang_gate');
    expect(counter.toJSON()).toEqual({ too_short: 2, lang_gate: 1 });
    expect(counter.total).toBe(3);
  });
});

describe('feed autodiscovery', () => {
  it('reads rel=alternate links and resolves them', () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="alternate" type="application/atom+xml" href="https://cdn.example/atom">
      <link rel="stylesheet" href="/style.css">
    </head></html>`;
    expect(discoverFeedLinks(html, 'https://example.com/blog')).toEqual([
      'https://example.com/feed.xml',
      'https://cdn.example/atom',
    ]);
  });
});

describe('article extraction', () => {
  it('prefers the article body over navigation and respects rel=canonical', () => {
    const html = `<html><head>
        <link rel="canonical" href="https://example.com/real-post">
        <meta property="og:title" content="Real title">
      </head><body>
        <nav><a href="/a">one</a><a href="/b">two</a><a href="/c">three</a></nav>
        <article><p>${'Substantial body text about databases. '.repeat(20)}</p>
          <p>More detail <a href="https://ref.example/x">with a reference</a>.</p></article>
        <footer><a href="/privacy">privacy</a></footer>
      </body></html>`;

    const out = extractArticle(html, 'https://example.com/post?utm_source=x');
    expect(out.canonicalUrl).toBe('https://example.com/real-post');
    expect(out.title).toBe('Real title');
    expect(out.text).toContain('Substantial body text');
    expect(out.text).not.toContain('privacy');
    expect(out.outboundLinks).toContain('https://ref.example/x');
  });
});

describe('page furniture', () => {
  // A GitHub release page, in the shape it actually arrives: the notes -- which
  // are the thing worth collecting -- behind a banner the server emits on every
  // render whether anything failed or not.
  const release = `<html><head><meta property="og:title" content="Consul v2.0.2"></head>
    <body><main>
      <div><p>Uh oh!</p><p>There was an error while loading. Please reload this page.</p></div>
      <ul>
        <li>Notifications You must be signed in to change notification settings</li>
        <li>Fork 4.6k</li><li>Star 30k</li>
      </ul>
      <p>Choose a tag to compare</p><p>Sorry, something went wrong.</p><p>No results found</p>
      <h2>SECURITY:</h2>
      <p>${'Upgrade the alpine base image to address the advisory. '.repeat(12)}</p>
    </main></body></html>`;

  it('never reaches the collector text', () => {
    const out = extractArticle(release, 'https://github.com/hashicorp/consul/releases/tag/v2.0.2');
    expect(out.text).not.toMatch(/uh oh/i);
    expect(out.text).not.toMatch(/error while loading/i);
    expect(out.text).not.toMatch(/signed in to change notification/i);
    expect(out.text).not.toMatch(/star 30k|fork 4\.6k/i);
    // ...and the release notes underneath survive, which is the whole point.
    expect(out.text).toContain('SECURITY');
    expect(out.text).toContain('alpine base image');
  });

  it('never reaches the reading page', () => {
    const out = extractReadable(release, 'https://github.com/hashicorp/consul/releases/tag/v2.0.2');
    const texts = out.blocks.map((b) => b.text);
    for (const gone of ['Uh oh!', 'There was an error while loading. Please reload this page.',
      'Choose a tag to compare', 'Sorry, something went wrong.', 'No results found',
      'Star 30k', 'Fork 4.6k']) expect(texts).not.toContain(gone);
    expect(texts).toContain('SECURITY:');
  });

  it('matches a whole block and never a substring', () => {
    // The words appear inside real prose. Prose is not furniture.
    const html = `<html><body><article>
      <p>${'The spinner says Loading while there was an error while loading the shard map, '
         + 'so we log it instead of asking anyone to please reload this page. '.repeat(6)}</p>
      </article></body></html>`;
    const out = extractArticle(html, 'https://example.com/post');
    expect(out.text).toContain('error while loading the shard map');
    expect(out.text).toContain('please reload this page');
  });
});

describe('schema validation', () => {
  it('accepts well-formed classifier output', () => {
    const value = { results: [{ index: 0, is_tech: true, fields: ['rust'], confidence: 0.9 }] };
    expect(validate(value, JOBS.classify!.schema).ok).toBe(true);
  });

  it('rejects output a weaker model might produce', () => {
    const bad = validate({ results: [{ index: 0, is_tech: 'yes', fields: 'rust' }] }, JOBS.classify!.schema);
    expect(bad.ok).toBe(false);
  });

  it('enforces the 0-10 importance range', () => {
    expect(validate({ results: [{ index: 0, importance: 42 }] }, JOBS.importance_triage!.schema).ok).toBe(false);
    expect(validate({ results: [{ index: 0, importance: 7 }] }, JOBS.importance_triage!.schema).ok).toBe(true);
  });
});

describe('extractJson', () => {
  it('recovers JSON from fences and surrounding prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":1} -- hope that helps')).toEqual({ a: 1 });
    expect(extractJson('no json at all')).toBeNull();
  });
});

describe('canonical selection when merging', () => {
  const base = { collected_at: '2025-08-12T09:00:00Z', never_canonical: false, weight_content: '0.9' };

  it('never lets a coverage-only outlet win', () => {
    const techradar = { id: 'tr', ...base, never_canonical: true, weight_content: '0.1', collected_at: '2025-08-12T08:00:00Z' };
    const lwn = { id: 'lwn', ...base };
    expect(pickCanonical(techradar, lwn).id).toBe('lwn');
    expect(pickCanonical(lwn, techradar).id).toBe('lwn');
  });

  it('falls back to first observation when standing is equal', () => {
    const early = { id: 'early', ...base, collected_at: '2025-08-12T08:00:00Z' };
    const late = { id: 'late', ...base };
    expect(pickCanonical(late, early).id).toBe('early');
  });
});

describe('score axes', () => {
  it('makes niche the inverse of coverage', () => {
    expect(nicheScore(1)).toBe(1);
    expect(nicheScore(3)).toBeLessThan(nicheScore(1));
    expect(nicheScore(20)).toBeLessThan(0.05);
  });

  it('keeps niche and importance independent, so a widely covered CVE still ships', () => {
    const cve = { importance: 9, niche: nicheScore(30), novelty: 0.9, stacks: ['security'] };
    expect(cve.niche).toBeLessThan(0.1);
    expect(assignTier(cve)).toBe('critical');
  });

  it('routes rare-but-quiet stories to the niche-first tier', () => {
    expect(assignTier({ importance: 3, niche: 0.9, novelty: 0.8, stacks: ['rust'] })).toBe('niche_first');
  });

  it('sends widely covered low-consequence items to the digest tail', () => {
    expect(assignTier({ importance: 2, niche: 0.1, novelty: 0.2, stacks: [] })).toBe('background');
  });

  it('decays novelty with age and with publication lag', () => {
    const now = new Date('2025-08-12T12:00:00Z');
    const fresh = noveltyScore({
      coverageCount: 1, collectedAt: new Date('2025-08-12T11:00:00Z'), publishedAt: null,
      bodyChars: 900, sourceWeightContent: 1, sourceIsPrimary: false, domainFirstSeenDays: 10, now,
    });
    const stale = noveltyScore({
      coverageCount: 1, collectedAt: new Date('2025-08-09T11:00:00Z'),
      publishedAt: new Date('2025-07-01T00:00:00Z'),
      bodyChars: 900, sourceWeightContent: 1, sourceIsPrimary: false, domainFirstSeenDays: 900, now,
    });
    expect(fresh).toBeGreaterThan(stale);
  });

  it('scores a primary source deeper than a thin aggregator repost', () => {
    const common = { coverageCount: 1, collectedAt: new Date(), publishedAt: null, domainFirstSeenDays: null };
    const primary = depthScore({ ...common, bodyChars: 4000, sourceWeightContent: 1, sourceIsPrimary: true });
    const repost = depthScore({ ...common, bodyChars: 300, sourceWeightContent: 0.1, sourceIsPrimary: false });
    expect(primary).toBeGreaterThan(repost);
  });
});

describe('closed vocabulary', () => {
  const taxonomy: Taxonomy = {
    resolve: (raw) => {
      const map: Record<string, string> = {
        react: 'react', reactjs: 'react', 'react.js': 'react', rust: 'rust',
      };
      const key = raw.trim().toLowerCase();
      return map[key] ?? map[key.replace(/[.\s_]+/g, '')] ?? null;
    },
    slugs: () => ['react', 'rust'],
    expand: async (s) => s,
  };

  it('folds alias variants onto one slug and discards inventions', () => {
    const out = validateFields(taxonomy, ['React', 'reactjs', 'react.js', 'Rust', 'quantum-blockchain']);
    expect(out.accepted.sort()).toEqual(['react', 'rust']);
    expect(out.rejected).toEqual(['quantum-blockchain']);
  });
});

describe('feeds that are a whole history, not a week', () => {
  it('parses a changelog with more entity expansions than a week of posts has', () => {
    // Cloudflare publishes its entire changelog in one 7.3 MB document: 1,174
    // entries and 200,055 entity expansions, which the old 200,000 cap rejected
    // by 55. The fetch logged `unparseable feed`, the source stayed marked
    // healthy, and it produced nothing at all.
    const items = Array.from({ length: 300 }, (_, i) =>
      `<item><title>Change ${i} &amp; more &amp; more &#8212; ${'&amp;'.repeat(200)}</title>`
      + `<link>https://example.com/${i}</link><description>a &amp; b</description></item>`,
    ).join('');
    const feed = parseFeed(
      `<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`,
      'https://example.com/changelog.xml');
    expect(feed?.items).toHaveLength(300);
  });

  it('still refuses a document larger than the byte cap', () => {
    // The cap that bounds memory is size, and it did not move.
    expect(parseFeed(`<?xml version="1.0"?><rss>${'x'.repeat(20_000_001)}</rss>`, 'https://x.example'))
      .toBeNull();
  });
});

describe('a release with no notes is still a release', () => {
  it('lets a title-only entry through the length gate', () => {
    // Vercel, Notion and every tags.atom feed publish a title, a link and a
    // date, and no body. The event is the title; judging it by an article's
    // yardstick silently emptied the entire first-party layer.
    const titleOnly = gateItem(
      { title: 'Muse Image now available on AI Gateway', link: 'https://vercel.com/changelog/muse',
        guid: null, summary: '', content: '', author: null, publishedAt: new Date(),
        enclosureTypes: [], categories: [], outboundLinks: [] },
      '', { minLengthOverride: RELEASE_MIN_LENGTH });
    expect(titleOnly.keep).toBe(true);
  });

  it('holds the ordinary bar when no override is given', () => {
    // The relaxation belongs to release feeds alone. A press item with two
    // sentences of teaser is still a stub, and the article fetch exists for it.
    const stub = gateItem(
      { title: 'Something happened somewhere', link: 'https://news.example/x',
        guid: null, summary: '', content: 'Two words.', author: null, publishedAt: new Date(),
        enclosureTypes: [], categories: [], outboundLinks: [] },
      'Two words.');
    expect(stub.keep).toBe(false);
    expect(stub.reason).toBe('too_short');
  });
});

describe('a tag needs its subject supplied', () => {
  it('names the project on a monorepo tag, not just a bare version', () => {
    // Measured in the river after the derived feeds went in: "pkg/machinery/
    // v1.13.9" and "@sveltejs/package@3.0.0-next.7" name no project at all, and
    // the old rule only recognised "^v4.2.0".
    expect(qualifyReleaseTitle('v1.14.0', 'Talos releases')).toBe('Talos v1.14.0');
    expect(qualifyReleaseTitle('pkg/machinery/v1.13.9', 'Talos releases'))
      .toBe('Talos pkg/machinery/v1.13.9');
    expect(qualifyReleaseTitle('v2.4.1', 'Git tags')).toBe('Git v2.4.1');
  });

  it('leaves a title that is already a sentence alone', () => {
    expect(qualifyReleaseTitle('Kubernetes 1.32: Penelope', 'Kubernetes releases'))
      .toBe('Kubernetes 1.32: Penelope');
    expect(qualifyReleaseTitle('Temporal v1.32.0-162.1', 'Temporal releases'))
      .toBe('Temporal v1.32.0-162.1');
  });

  it('does not say the project name twice', () => {
    // "Next.js next.js@16.4.0" is worse than the tag on its own.
    expect(qualifyReleaseTitle('next.js@16.4.0', 'Next.js releases')).toBe('next.js@16.4.0');
  });
});

describe('an article that is a table', () => {
  const TABLE_PAGE = `<html><head><title>Security updates for Thursday</title></head>
    <body><div class="ArticleText"><table>
      <tr><td>Dist.</td><td>ID</td><td>Package</td><td>Date</td></tr>
      <tr><td>AlmaLinux</td><td>ALSA-2026:60215</td><td>assertj-core</td><td>2026-08-27</td></tr>
      <tr><td>Debian</td><td>DSA-5901</td><td>bubblewrap</td><td>2026-08-27</td></tr>
    </table></div></body></html>`;

  it('reads rows when there is not a paragraph on the page', () => {
    // LWN's security updates are a table and nothing else. The reader collected
    // paragraphs, found none, and told the reader the page was "probably
    // rendered by JavaScript, or behind a wall" — about a page it had already
    // fetched and could read perfectly well.
    const r = extractReadable(TABLE_PAGE, 'https://lwn.net/Articles/1090938');
    expect(r.blocks.length).toBeGreaterThanOrEqual(3);
    expect(r.blocks.every((b) => b.kind === 'li')).toBe(true);
    expect(r.blocks[1]?.text).toContain('assertj-core');
    expect(r.blocks[1]?.text).toContain('AlmaLinux');
  });

  it('falls back to the container text rather than claiming there is none', () => {
    // Whatever a page is made of, if the container holds readable text the
    // reader shows it. A layout nobody anticipated costs the structure, not the
    // article.
    const odd = `<html><body><main><span>${'A sentence about a technology. '.repeat(12)}</span></main></body></html>`;
    const r = extractReadable(odd, 'https://example.com/x');
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]?.kind).toBe('p');
    expect(r.words).toBeGreaterThan(50);
  });

  it('still says nothing is readable when nothing is', () => {
    const empty = `<html><body><div id="app"></div></body></html>`;
    expect(extractReadable(empty, 'https://example.com/y').blocks).toHaveLength(0);
  });
});

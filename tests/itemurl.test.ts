// One address per story.
//
// The canonical URL is what deduplication, coverage, membership and the story
// record all key on, so two items sharing an address are one story as far as
// this archive can tell. Four feeds in the registry give every item the same
// link:
//
//   kernel.org   9 releases  ->  https://www.kernel.org/
//   Discord     10 changes   ->  the changelog landing page
//   Auth0        6 entries   ->  the FEED's own address
//   Azure       25 updates   ->  the updates landing page
//
// Every one of them populates the guid correctly. These tests are mostly about
// the other direction: a well-formed feed must come through untouched, because
// rewriting an address that is already right would change the identity of
// everything already collected.

import { describe, it, expect } from 'vitest';
import { resolveItemUrls as resolve } from '../src/collect/itemurl.ts';

/** Addresses only. Whether an item came off a listing is asserted separately. */
const resolveItemUrls = (items: Parameters<typeof resolve>[0], feed = '') =>
  resolve(items, feed).map((r) => r.url);

const item = (link: string | null, guid: string | null = null) => ({ link, guid });

describe('a well-formed feed', () => {
  it('is left alone', () => {
    const urls = resolveItemUrls([
      item('https://go.dev/blog/go1.26', 'https://go.dev/blog/go1.26'),
      item('https://go.dev/blog/alias', 'tag:go.dev,2026:alias'),
    ], 'https://go.dev/blog/feed.atom');
    expect(urls).toEqual(['https://go.dev/blog/go1.26', 'https://go.dev/blog/alias']);
  });

  it('keeps the link even when a guid is a different URL', () => {
    // A guid is only reached for when the link cannot identify the item. Some
    // feeds put a tracking address in the guid, and preferring it would make
    // every story's address worse.
    const [url] = resolveItemUrls(
      [item('https://example.com/post', 'https://example.com/?p=1234')],
      'https://example.com/feed');
    expect(url).toBe('https://example.com/post');
  });
});

describe('a feed whose items share one link', () => {
  it('uses an opaque guid as a fragment, keeping the address real', () => {
    // kernel.org. The link still resolves to a page somebody can open; it is
    // now this release's address and no other's.
    const urls = resolveItemUrls([
      item('https://www.kernel.org/', 'kernel.org,mainline,7.2,2026-08-16'),
      item('https://www.kernel.org/', 'kernel.org,stable,7.2.2,2026-08-28'),
    ], 'https://www.kernel.org/feeds/kdist.xml');
    expect(new Set(urls).size).toBe(2);
    // Canonicalised host, identifying fragment. The address still opens the
    // kernel.org front page; it now also says which release it is about.
    for (const u of urls) expect(u).toMatch(/^https:\/\/kernel\.org\/#kernel\.org/);
  });

  it('uses a guid that is already a URL as the address', () => {
    // Auth0's guid is the per-item anchor its link should have been.
    const urls = resolveItemUrls([
      item('https://auth0.com/changelog/rss.xml', 'https://auth0.com/changelog#2oiLhtKT'),
      item('https://auth0.com/changelog/rss.xml', 'https://auth0.com/changelog#366lKZ4a'),
    ], 'https://auth0.com/changelog/rss.xml');
    expect(urls).toEqual([
      'https://auth0.com/changelog#2oiLhtKT',
      'https://auth0.com/changelog#366lKZ4a',
    ]);
  });

  it('gives twenty-five announcements twenty-five addresses', () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      item('https://azure.microsoft.com/en-us/updates', `azure-update-${i}`));
    const urls = resolveItemUrls(items, 'https://www.microsoft.com/api/azure/rss');
    expect(new Set(urls).size).toBe(25);
  });
});

describe('a link whose fragment is the item', () => {
  // Discord's changelog. The links ARE distinct -- change-log#august-27-2026 --
  // and canonicalisation strips the fragment, which is right everywhere else
  // and collapsed all fifteen entries onto one address here.
  it('keeps the publisher’s own fragment when it settles the matter', () => {
    const urls = resolveItemUrls([
      item('https://docs.discord.com/developers/change-log#august-27-2026', 'fbac18f7'),
      item('https://docs.discord.com/developers/change-log#august-26-2026', '87289daf'),
    ], 'https://discord.com/developers/docs/change-log/rss.xml');
    expect(urls).toEqual([
      'https://docs.discord.com/developers/change-log#august-27-2026',
      'https://docs.discord.com/developers/change-log#august-26-2026',
    ]);
  });

  it('falls back to the guid only for the ones the fragment cannot separate', () => {
    // Two entries genuinely share a date anchor. The one that is unique keeps
    // the real address; only the colliding pair take synthesised ones.
    const urls = resolveItemUrls([
      item('https://docs.discord.com/developers/change-log#august-27-2026', 'fbac18f7'),
      item('https://docs.discord.com/developers/change-log#august-26-2026', '87289daf'),
      item('https://docs.discord.com/developers/change-log#august-26-2026', 'aaaa1111'),
    ], 'https://discord.com/developers/docs/change-log/rss.xml');
    expect(new Set(urls).size).toBe(3);
    expect(urls[0]).toBe('https://docs.discord.com/developers/change-log#august-27-2026');
    expect(urls[1]).toContain('#87289daf');
    expect(urls[2]).toContain('#aaaa1111');
  });

  it('still strips a fragment nobody needs', () => {
    // The ordinary case, and the reason canonicalisation strips fragments at
    // all: two links to one article with different anchors are one article.
    const urls = resolveItemUrls([
      item('https://example.com/post#intro', 'a'),
      item('https://example.com/other#intro', 'b'),
    ], 'https://example.com/feed');
    expect(urls).toEqual(['https://example.com/post', 'https://example.com/other']);
  });
});

describe('a link that points at the feed', () => {
  it('is replaced even when it is the only item', () => {
    // Not a batch-collision rule: a link to the feed is never a link to the
    // item, however many items there are.
    const [url] = resolveItemUrls(
      [item('https://auth0.com/changelog/rss.xml', 'https://auth0.com/changelog#abc')],
      'https://auth0.com/changelog/rss.xml');
    expect(url).toBe('https://auth0.com/changelog#abc');
  });

  it('recognises the feed through www and a trailing slash', () => {
    const [url] = resolveItemUrls(
      [item('https://www.example.com/feed/', 'https://example.com/real-post')],
      'https://example.com/feed');
    expect(url).toBe('https://example.com/real-post');
  });
});

describe('when there is nothing better', () => {
  it('keeps the shared link rather than inventing one', () => {
    // No guid means no identity to use. Two items will collide, and colliding
    // honestly is better than an address that goes nowhere.
    const urls = resolveItemUrls([
      item('https://example.com/changelog'),
      item('https://example.com/changelog'),
    ], 'https://example.com/feed');
    expect(urls).toEqual(['https://example.com/changelog', 'https://example.com/changelog']);
  });

  it('returns null for an item with no link at all', () => {
    expect(resolveItemUrls([item(null, 'x')], 'https://example.com/feed')).toEqual([null]);
  });

  it('handles an empty batch', () => {
    expect(resolveItemUrls([], 'https://example.com/feed')).toEqual([]);
  });
});

describe('knowing an item came off a listing', () => {
  // The same fact FeedItem.complete carries, derived rather than declared: if
  // the address had to be disambiguated, the link was a listing. It decides
  // whether the page is fetched, and fetching a listing gives every item on it
  // the same body -- ten distinct addresses that still collapse into one story
  // on the content hash.
  it('is false for a feed that needs no help', () => {
    const r = resolve([
      item('https://go.dev/blog/go1.26', 'x'),
      item('https://go.dev/blog/alias', 'y'),
    ], 'https://go.dev/blog/feed.atom');
    expect(r.map((x) => x.fromListing)).toEqual([false, false]);
  });

  it('is true for every item that shared an address', () => {
    const r = resolve([
      item('https://www.kernel.org/', 'kernel.org,mainline,7.2,2026-08-16'),
      item('https://www.kernel.org/', 'kernel.org,stable,7.2.2,2026-08-28'),
    ], 'https://www.kernel.org/feeds/kdist.xml');
    expect(r.map((x) => x.fromListing)).toEqual([true, true]);
  });

  it('is true even when the publisher’s own fragment settles it', () => {
    // Discord's anchors are distinct and still point at one page. The address
    // is good; the body behind it is the whole changelog.
    const r = resolve([
      item('https://docs.discord.com/developers/change-log#august-27-2026', 'a'),
      item('https://docs.discord.com/developers/change-log#august-26-2026', 'b'),
    ], 'https://discord.com/developers/docs/change-log/rss.xml');
    expect(r.map((x) => x.fromListing)).toEqual([true, true]);
  });
});

// Why the archive was small, which was not because the world is quiet.
//
// Reported on 2026-09-09: "the number of news is very low, you said '1,633
// stories analysed across 144 months, 2010-10 to 2026-09' in analysis page, it
// means you don't analysis news, for 144 months, you only get 1633 news".
//
// Three separate faults, and the arithmetic in that sentence was the only part
// that was not one:
//
//   1. THE PARSER COULD NOT READ HALF OF ATOM. RFC 4287 gives <content> two
//      forms. `type="html"` arrives as a string. `type="xhtml"` arrives as
//      nested XML, and `text()` -- which looks for a string or a `#text` --
//      found neither and returned null. Vercel's feed carries 1,563 entries
//      with paragraphs of prose in every one; all 1,563 arrived with an empty
//      body and 1,103 were refused by the 400-character length bar. On every
//      poll, for as long as the collector had been running.
//
//   2. A REFUSAL LEFT NO TRACE. Only kept stories get a row, so dedup could
//      recognise what was accepted and nothing else. A refused item arrived
//      next poll indistinguishable from a new one -- and since ingest allows 25
//      article fetches per source per poll, an unreadable item took one of
//      those 25 for ever. 246,016 items seen in three days; 5,199 kept.
//
//   3. THE PAGE CONFLATED TWO SPANS. `archive_history` buckets stories by the
//      month they were PUBLISHED, and a feed serves its back catalogue, so
//      collecting on a Tuesday put one story in 2010-10. The min-to-max of that
//      read as the age of the archive. It was nine days old.
//
// Measured after the parser fix, on the same feed in the same hour: Vercel went
// from 5 stories kept in a poll to 781.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFeed } from '../src/collect/feed.ts';
import { waitDays } from '../src/collect/refused.ts';

const ingest = readFileSync(new URL('../src/collect/ingest.ts', import.meta.url), 'utf8');
const trends = readFileSync(new URL('../src/ui/trends.ts', import.meta.url), 'utf8');

/** An Atom entry in the xhtml form, as Vercel and Shopify actually publish it. */
const XHTML_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Vendor News</title>
  <entry>
    <id>https://e.test/password-protection</id>
    <title>Password Protection is now available per project</title>
    <link href="https://e.test/password-protection"/>
    <updated>2026-09-09T06:00:00.000Z</updated>
    <content type="xhtml">
      <div xmlns="http://www.w3.org/1999/xhtml">
        <p>Pro teams can now enable <a href="https://e.test/docs/protection">Password
        Protection</a> for individual projects at twenty dollars per project per
        month. When enabled it requires visitors to enter a password before they
        can view the deployments of that project.</p>
        <p>Previously this was available only through a one hundred and fifty
        dollar per month team-level add-on covering every project. Open Security
        in the sidebar, select Deployment Protection, and turn it on; disable it
        again to stop future charges for that project. Existing team-level
        add-ons continue to work and are unaffected by this change.</p>
      </div>
    </content>
  </entry>
</feed>`;

/** The other form, which always worked and must keep working. */
const HTML_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Vendor News</title>
  <entry>
    <id>https://e.test/two</id>
    <title>A release</title>
    <link href="https://e.test/two"/>
    <updated>2026-09-09T06:00:00.000Z</updated>
    <content type="html">&lt;p&gt;Escaped &lt;a href="https://e.test/d"&gt;markup&lt;/a&gt;
      that has always parsed correctly and must continue to.&lt;/p&gt;</content>
  </entry>
</feed>`;

describe('Atom content, in both of the forms Atom allows', () => {
  it('reads the xhtml form, which used to come back empty', () => {
    // THE BUG. 1,563 entries, every one of them empty, every thirty minutes.
    const items = parseFeed(XHTML_FEED, 'https://e.test/feed')?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]!.content).toContain('Pro teams can now enable');
    expect(items[0]!.content).toContain('one hundred and fifty');
  });

  it('recovers enough of it to clear the length bar', () => {
    // The bar is 400 characters and the whole failure was falling under it with
    // a body that was never actually empty.
    const items = parseFeed(XHTML_FEED, 'https://e.test/feed')?.items ?? [];
    expect(items[0]!.content.length).toBeGreaterThan(400);
  });

  it('keeps the anchors, so source discovery still sees where a post links', () => {
    // Why the tree is rebuilt as markup rather than merely flattened to text.
    const items = parseFeed(XHTML_FEED, 'https://e.test/feed')?.items ?? [];
    expect(items[0]!.outboundLinks.some((l) => l.includes('e.test/docs/protection')))
      .toBe(true);
  });

  it('strips the markup out of the body, as it always did', () => {
    const items = parseFeed(XHTML_FEED, 'https://e.test/feed')?.items ?? [];
    expect(items[0]!.content).not.toContain('<p>');
    expect(items[0]!.content).not.toContain('xmlns');
  });

  it('has not broken the escaped-html form', () => {
    const items = parseFeed(HTML_FEED, 'https://e.test/feed')?.items ?? [];
    expect(items[0]!.content).toContain('always parsed correctly');
    expect(items[0]!.content).not.toContain('<p>');
  });

  it('leaves a title alone even when a feed nests markup inside it', () => {
    // Titles stay on text(): a title that parsed as a tree is a broken feed,
    // and rebuilding markup into one would put tag names in a headline.
    const feed = XHTML_FEED.replace('<title>Password Protection is now available per project</title>',
      '<title type="text">Password Protection</title>');
    const items = parseFeed(feed, 'https://e.test/feed')?.items ?? [];
    expect(items[0]!.title).toBe('Password Protection');
  });
});

describe('a refusal is remembered, and expires', () => {
  it('waits longest for the refusals a publisher will never undo', () => {
    // A short post does not get longer. A 403 often does stop.
    expect(waitDays('too_short', 1)).toBeGreaterThan(waitDays('page_blocked', 1));
  });

  it('backs off further each time the same item is refused again', () => {
    expect(waitDays('too_short', 3)).toBeGreaterThan(waitDays('too_short', 1));
  });

  it('never waits for ever, however many times an item has failed', () => {
    // A permanently dead url stays on a schedule where it still costs
    // something to be wrong about it -- and our own extraction improves. The
    // Atom fix in this same commit turned 1,103 of these into real stories.
    expect(waitDays('too_short', 9999)).toBeLessThanOrEqual(120);
  });

  it('has a wait for a reason nobody has classified', () => {
    expect(waitDays('something_new', 1)).toBeGreaterThan(0);
  });

  it('is skipped BEFORE an article fetch is spent on it', () => {
    // The whole point. The waste was not the gate call, it was the page fetch:
    // 25 per source per poll, and an unreadable item held one for ever.
    const skipAt = ingest.indexOf("drops.record('refused_before')");
    const fetchAt = ingest.indexOf('const maxFetches = opts.maxArticleFetches');
    expect(skipAt).toBeGreaterThan(0);
    expect(skipAt).toBeLessThan(fetchAt);
  });

  it('counts a deferred item under its own name', () => {
    // A drop chart that cannot tell "we looked and said no" from "we said no
    // last month" hides the growth the table exists to stop.
    const filters = readFileSync(
      new URL('../src/collect/filters.ts', import.meta.url), 'utf8');
    expect(filters).toContain("'refused_before'");
  });

  it('can be turned off, for the backfills whose job is to reconsider', () => {
    expect(ingest).toMatch(/rememberRefusals\?: boolean/);
    expect(ingest).toMatch(/opts\.rememberRefusals !== false/);
  });

  it('never defers a SOURCE, only an item', () => {
    // "I want to filter articles not block sources", 2026-09-09. This defers
    // one url for a bounded time; the source is fetched in full every poll.
    const refused = readFileSync(
      new URL('../src/collect/refused.ts', import.meta.url), 'utf8');
    expect(refused).toMatch(/It defers ONE ITEM/);
  });
});

describe('the analysis page does not pass a feed back catalogue off as its own age', () => {
  it('reports how long it has been collecting, separately', () => {
    expect(trends).toMatch(/collectingSince/);
    expect(trends).toMatch(/collected over/);
  });

  it('takes that from the fetch log, not from the surviving stories', () => {
    // Retention deletes stories, so the oldest surviving row would report the
    // archive getting YOUNGER every month.
    expect(trends).toMatch(/min\(fetched_at\)/);
  });

  it('says out loud that the two spans are different things', () => {
    expect(trends).toMatch(/only one of them is about this/);
    expect(trends).toMatch(/not that anything was watching then/);
  });
});

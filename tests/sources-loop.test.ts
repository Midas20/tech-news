// The registry has to change, and it must not change in the wrong direction.
//
// Asked for on 2026-08-31: "I don't want to get news from fixed sources, the
// source list have to be change to get good news".
//
// Two properties hold this together, and the second one is the one that is easy
// to lose in a refactor:
//
//   1. The loop only ever ADDS. "Don't remove anyone anymore" is a standing
//      instruction, and a loop that pruned what it judged quiet would break it
//      every night with nobody watching.
//
//   2. The gauntlet is NOT sufficient to admit a source unattended. Measured
//      live: howtogeek.com keeps 10 of 10 and thenextweb.com 8 of 10, on items
//      like "A $25 power bank is all you need to stay online during a power
//      outage". Both clear every filter the archive has. What keeps them out
//      today is a blocklist of hosts, and a blocklist is not a rule -- it is a
//      memory of every mistake made so far.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { looksLikeLinkblog } from '../src/collect/audition.ts';

const SOURCE = readFileSync(new URL('../src/maintain/sources.ts', import.meta.url), 'utf8');
const AUDITION = readFileSync(new URL('../src/collect/audition.ts', import.meta.url), 'utf8');

describe('the loop that changes the registry', () => {
  it('never pauses, retires or deletes', () => {
    // The whole file, checked for the verbs. `verdict = 'rejected'` is about a
    // CANDIDATE that was never a source; nothing may touch a row in `sources`
    // except the INSERT.
    expect(SOURCE).not.toMatch(/UPDATE\s+sources/i);
    expect(SOURCE).not.toMatch(/DELETE\s+FROM\s+sources/i);
    expect(SOURCE).not.toMatch(/health\s*=\s*'paused'/i);
    expect(SOURCE).toMatch(/INSERT INTO sources/);
  });

  it('promotes only what it can prove is a first party', () => {
    // The branch that separates a vendor from a magazine. Losing it would let
    // the loop admit consumer press on the strength of the gauntlet alone.
    expect(SOURCE).toContain('isFirstParty');
    expect(SOURCE).toMatch(/const owns = await isFirstParty/);
    expect(SOURCE).toMatch(/if \(!owns\)[\s\S]{0,400}'deferred'/);
  });

  it('records what it could not decide, rather than guessing', () => {
    // 'deferred' is the schema's own word, and it already meant this: not
    // refused, not accepted, waiting on a judgement the job is not entitled to
    // make. A proposal carries its numbers so the person deciding has them.
    expect(SOURCE).toContain("'deferred'");
    expect(SOURCE).toMatch(/kept.*technical.*referrers/s);
  });

  it('judges a found domain as CONTENT, never PRIMARY', () => {
    // PRIMARY is what relaxes the topic filter for a first party. Nothing is
    // known about a domain the archive merely found in an outbound link, and
    // auditioning under the generous flag is how something gets admitted that
    // would fail under the strict one it is then filed with.
    expect(SOURCE).toMatch(/primary: false/);
  });

  it('needs several unrelated sources to have pointed at a domain', () => {
    // One source linking somewhere repeatedly is a habit, not a signal.
    expect(SOURCE).toMatch(/MIN_REFERRERS = [3-9]/);
  });
});

describe('the audition is the collector, not an approximation of it', () => {
  it('fetches the article when the feed body is too short', () => {
    // The bug that inverted the first run: judging on feed text alone refused
    // nearly everything for length, because most feeds carry one line. OpenAI
    // scored 0 of 142, vLLM 0 of 33 -- both sources ingest keeps.
    expect(AUDITION).toContain('function bodyFor');
    expect(AUDITION).toMatch(/if \(checkLength\(feedBody\)\.passes\) return feedBody;/);
  });

  it('runs the same gates in the same order as ingest', () => {
    const order = ['judgeTopic', 'isBuildNoise', 'classifyEvent', 'gateItem'];
    let at = -1;
    for (const fn of order) {
      const next = AUDITION.indexOf(fn, at + 1);
      expect(next, `${fn} out of order`).toBeGreaterThan(at);
      at = next;
    }
  });

  it('counts the last 90 days, not the lifetime', () => {
    // blog.ethereum.org offered 636 items and three were recent. Ranked on
    // lifetime output it was the strongest candidate seen, at 33x its real rate.
    expect(AUDITION).toContain('AUDITION_WINDOW_MS = 90');
  });

  it('keeps undated items, because ingest keeps them', () => {
    expect(AUDITION).toMatch(/!i\.publishedAt \|\| i\.publishedAt\.getTime\(\) >= cutoff/);
  });

  it('recognises a feed by parsing it, not by its file extension', () => {
    // simonwillison.net serves Atom from /atom/everything/ with no extension,
    // and the suffix test reported "no feed" for a feed already parsed.
    expect(AUDITION).toMatch(/if \(page\.ok && parseFeed\(page\.body, site\)\?\.items\?\.length\) return site;/);
  });
});

describe('a linkblog is not a first party', () => {
  // Learned the hard way, on 2026-08-31, about an hour after the tracked
  // channel first ran. It promoted daringfireball.net as "Markdown (first
  // party)" -- the domain IS the home of Markdown -- and within the hour the
  // archive had twenty stories from it, eleven of them somebody else's page:
  // American cheese, a Trump story, a screen-saver revival, and a McSweeney's
  // satire the user flagged as unnecessary.
  //
  // PRIMARY is the flag that RELAXES the topic filter, and the channel granted
  // it "by construction". By construction was an assumption.

  it('measures scatter against the links, not the registered homepage', () => {
    // Stripe Engineering is registered under stripe.com and publishes on
    // stripe.dev. Comparing links to the homepage scores that first party 0%.
    // Comparing the links WITH EACH OTHER scores it 100% and needs no homepage.
    expect(AUDITION).toContain('export function scatter');
    expect(AUDITION).toMatch(/linkDomains\.size \/ items/);
    expect(AUDITION).not.toMatch(/scatter[\s\S]{0,200}opts\.site/);
  });

  it('records the domain of every sampled item, not only the kept ones', () => {
    // Whether a feed links away from itself is a property of the feed. The
    // items the gauntlet refused are evidence about it too.
    const at = AUDITION.indexOf('r.linkDomains.set');
    expect(at).toBeGreaterThan(0);
    expect(AUDITION.slice(at - 400, at)).toContain('for (const item of sample)');
  });

  it('refuses a scattered feed before counting how much it kept', () => {
    // Order matters: a linkblog scores WELL, because it is recommending things
    // worth reading. Daring Fireball kept 6 of 12 and cleared the bar.
    for (const channel of SOURCE.split('export async function').slice(1)) {
      if (!channel.includes('KEEP_BAR')) continue;
      expect(channel.indexOf('looksLikeLinkblog'), 'scatter must be checked first')
        .toBeLessThan(channel.indexOf('KEEP_BAR'));
    }
  });

  it('applies the judgement in both channels', () => {
    expect(SOURCE.match(/looksLikeLinkblog\(result\)/g)?.length).toBe(2);
  });

  it('does not call a two-post blog a linkblog', () => {
    // Scatter is distinct domains over items, so an honest first party with two
    // recent posts scores 50% on its own single domain. Both guards protect
    // that end: too few items to judge, and one or two domains is a company
    // with properties (notion.so + notion.com, stripe.com + stripe.dev).
    expect(AUDITION).toMatch(/if \(items < SCATTER_MIN_ITEMS\) return false;/);
    expect(AUDITION).toMatch(/if \(r\.linkDomains\.size <= 2\) return false;/);
  });

  it('caps scatter well below a linkblog and well above a multi-property firm', () => {
    // Calibrated on the whole registry over 120 days: 100 of 103 sources put
    // every story on one domain. Google DeepMind spreads 283 stories over five
    // Google properties and Notion 439 over two -- about 2%. The linkblog sat
    // at 55%. The cap goes in the gap, nearer the honest end.
    const cap = /SCATTER_CAP = ([\d./ ]+);/.exec(AUDITION)?.[1] ?? '';
    const value = Number(eval(cap));
    expect(value).toBeGreaterThan(0.05);
    expect(value).toBeLessThan(0.45);
  });
});

describe('the second channel, which is the one that pays', () => {
  it('asks the vocabulary who publishes, not the link graph', () => {
    // The outbound-link pool is good at finding THINGS the archive should
    // track and poor at finding sources: 32 domains examined, nothing promoted,
    // nothing deferred, because vendor blogs link to docs, repositories,
    // standards and social. The top of that pool is github.io, youtube.com,
    // wikipedia.org, apache.org.
    expect(SOURCE).toContain('auditionTracked');
    expect(SOURCE).toMatch(/FROM stacks s LEFT JOIN vol/);
    expect(SOURCE).toMatch(/FROM platforms p LEFT JOIN pvol/);
  });

  it('claims PRIMARY here, and only here', () => {
    // A domain found in a link is judged CONTENT because nothing is known about
    // it. A domain that IS the vocabulary entry is a first party by
    // construction, which is what the role means.
    expect(SOURCE).toMatch(/primary: false/);
    expect(SOURCE).toMatch(/primary: true/);
  });

  it('compares registrable domains, so a blog subdomain counts as polled', () => {
    // Comparing full hostnames reported www.rust-lang.org as unpolled while
    // blog.rust-lang.org was being read every fifteen minutes. It inflated the
    // gap from 1,011 to 1,121 and would have wasted a run on sources already
    // held.
    expect(SOURCE).toContain('REGISTRABLE');
    expect(SOURCE).toMatch(/\[\^\.\]\+\[\.\]\[\^\.\]\+\$/);
  });

  it('takes the busiest first, not the alphabet', () => {
    expect(SOURCE).toMatch(/ORDER BY mentions DESC/);
  });

  it('refuses a feed it already polls under another name', () => {
    // A homepage and a blog can be different domains: typescriptlang.org is the
    // home of a stack whose posts arrive from devblogs.microsoft.com.
    expect(SOURCE).toMatch(/its feed is already polled/);
  });
});

// The judgement itself, run on numbers rather than on the shape of the file.
describe('looksLikeLinkblog, on measured feeds', () => {
  const feed = (pairs: Array<[string, number]>) => ({
    feed: 'f', offered: 0, recent: 0, undated: 0, kept: 0, technical: 0,
    reasons: new Map<string, number>(), keptTitles: [],
    linkDomains: new Map(pairs),
  });

  it('refuses Daring Fireball as measured live', () => {
    // 2026-08-31, twelve sampled items: finalist.works, daringfireball.net,
    // 9to5mac.com, mcsweeneys.net, youtube.com, x.com, notus.org, reuters.com,
    // morphing.cloud, github.io.
    expect(looksLikeLinkblog(feed([
      ['finalist.works', 2], ['daringfireball.net', 3], ['9to5mac.com', 1],
      ['mcsweeneys.net', 1], ['youtube.com', 1], ['x.com', 1], ['notus.org', 1],
      ['reuters.com', 1], ['morphing.cloud', 1], ['github.io', 1],
    ]))).toBe(true);
  });

  it('keeps the three promotions that were not linkblogs', () => {
    expect(looksLikeLinkblog(feed([['isocpp.org', 12]]))).toBe(false);
    expect(looksLikeLinkblog(feed([['opensource.org', 10]]))).toBe(false);
    expect(looksLikeLinkblog(feed([['atproto.com', 8]]))).toBe(false);
  });

  it('keeps a company that publishes on more than one domain', () => {
    // Google DeepMind: 283 stories over five Google properties.
    expect(looksLikeLinkblog(feed([
      ['deepmind.google', 8], ['blog.google', 2], ['research.google', 1], ['arxiv.org', 1],
    ]))).toBe(false);
  });

  it('keeps a first party with only two recent posts', () => {
    // One domain, two items: the ratio alone calls this 50% scattered.
    expect(looksLikeLinkblog(feed([['vllm.ai', 2]]))).toBe(false);
  });
});

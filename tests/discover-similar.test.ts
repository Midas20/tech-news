// Finding sources by asking what a source we already trust is like.
//
// sitelike.org answers "what sites are like this one". It is a CANDIDATE
// GENERATOR and nothing else -- pointed at astro.build it returns docusaurus.io
// and getzola.org next to a dozen personal blogs, and pointed at a cloud
// changelog it returns salon.com. The audition is what decides, and the first
// draft of that audition was wrong in a way worth pinning down forever.
//
// IT JUDGED STRANGERS AS FRIENDS. Candidates were put through the gauntlet as
// first-party technology channels, the way seeds/expand.ts judges a hand-picked
// one -- which turns on the fallback rule: a post from a vendor's own channel
// that the grammar cannot place is a change. Safe for Vercel. Catastrophic for
// a domain nobody has looked at. Measured on the first run:
//
//   18 kept  100% fallback  salon.com           "The high cost of MAGA manhood"
//   14 kept  100% fallback  101greatgoals.com   "Crystal Palace 1-4 Manchester City"
//    4 kept  100% fallback  bellona.org         floating nuclear power
//    2 kept  100% fallback  ilgp.org            the Illinois Green Party
//
// Every one a "change", about nothing, from a source the archive had never
// heard of. After the fix the same run passed two candidates -- nextjs.org and
// netlify.com, both at 0% fallback, both genuinely missing from the registry.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyEvent, isEvent } from '../src/collect/eventful.ts';

const src = readFileSync(new URL('../scripts/discover-similar.ts', import.meta.url), 'utf8');
const audition = src.slice(src.indexOf('--- 3. audition'));

describe('a candidate nobody has vetted', () => {
  it('is auditioned as a stranger, not as a first party', () => {
    expect(audition).toContain('firstParty: false');
    expect(audition).not.toContain('firstParty: true');
  });

  it('gets no PRIMARY role in the topical gate either', () => {
    // PRIMARY skips the commerce and consumer rules entirely -- correct for a
    // vendor announcing a price, wrong for a domain off a similar-sites list.
    expect(audition).toContain("sourceRoles: ['CONTENT']");
    expect(audition).not.toContain("'CONTENT', 'PRIMARY'");
  });

  it('is filed the way it was judged', () => {
    // The audition and the row it produces have to agree about what this source
    // is, or the measurement describes a source that never gets created.
    expect(src).toContain("'{CONTENT}'::source_role[]");
    expect(src).toContain('curated, tech_only');
    expect(src).toMatch(/false, false, \$4/);
  });
});

describe('what the stranger rule actually excludes', () => {
  // The four titles that got through, judged both ways. These are the test:
  // as a first party every one is an event; as a stranger not one of them is.
  const REAL = [
    'The high cost of MAGA manhood',
    'Crystal Palace 1-4 Manchester City: Report, result and goals',
    'The Illinois Green Party calls for a true government of, by and for the people',
    'Floating nuclear power was a Russian curiosity. Now others want in',
  ];

  it('would have kept all four as a first party', () => {
    for (const t of REAL) {
      const v = classifyEvent(t, { sourceKind: 'news', firstParty: true });
      expect(isEvent(v.kind), t).toBe(true);
      expect(v.matched, t).toBe('first-party post');
    }
  });

  it('keeps none of them as a stranger', () => {
    for (const t of REAL) {
      expect(isEvent(classifyEvent(t, { sourceKind: 'news' }).kind), t).toBe(false);
    }
  });

  it('still keeps a real announcement from a stranger', () => {
    // The rule must not be "refuse everything unfamiliar". These two are what
    // the fixed run actually surfaced, from nextjs.org and netlify.com.
    for (const t of ['August 2026 Security Release',
                     'New Netlify projects are now private by default']) {
      expect(isEvent(classifyEvent(t, { sourceKind: 'news' }).kind), t).toBe(true);
    }
  });
});

describe('a stranger must show technology, not merely fail to show football', () => {
  // judgeTopic is a BLOCKLIST. Its job for a curated source is to catch what
  // strays off the beat, and anything no rule names is kept -- right when
  // somebody chose the source, wrong when nobody has. These four cleared every
  // reject rule and every one of them is a stranger's headline about nothing.
  it('requires a known stack or a technical title', () => {
    expect(audition).toContain('detectStacks(');
    expect(audition).toContain('!isTechnicalTitle(t)');
  });

  it('does not treat the absence of a rejection as evidence', () => {
    // The rule reads: no stack AND not technical -> skip. Both halves.
    const at = audition.indexOf('detectStacks(');
    expect(audition.slice(at, at + 200)).toContain('length === 0');
    expect(audition.slice(at, at + 200)).toContain('&& !isTechnicalTitle(t)) continue;');
  });
});

describe('a domain that redirects into one we already poll', () => {
  it('is that source under another name, not a discovery', () => {
    // aws.com resolves to aws.amazon.com and arrived as a 73-item "discovery"
    // of AWS What's New, which the archive already holds 101 stories from.
    expect(src).toContain('known.has(host(res.url))');
  });
});

describe('crawling strangers', () => {
  it('survives a host that breaks Node’s HTTP stack', () => {
    // A socket closed mid-body raises an assertion inside undici, on a stream
    // callback, with no promise to reject -- so a try/catch around the fetch
    // does not see it. It killed a run at 1,246 candidates after twenty
    // minutes of work.
    expect(src).toContain("process.on('uncaughtException', fault)");
    expect(src).toContain("process.on('unhandledRejection', fault)");
  });

  it('counts what it swallowed rather than hiding it', () => {
    // A handler that silently absorbs everything turns a real bug into a quiet
    // one. This one prints the first few and reports the total.
    expect(src).toContain('network faults survived');
  });

  it('says what it did not probe', () => {
    // No silent caps: a run that covers 400 of 1,246 candidates must not read
    // as a run that covered everything.
    expect(src).toContain('not probed this run');
  });

  it('probes the domains the most seeds agreed on first', () => {
    // A site in three neighbourhoods is a better bet than one in a single one.
    expect(src).toContain('.sort((a, b) => b[1].length - a[1].length)');
  });
});

describe('the discovery script', () => {
  it('gates on language, because a similar site is often not in English', () => {
    // zenn.dev came back at 20 kept on the first run. Good writing, and the
    // reader cannot read it.
    expect(audition).toContain('detectLanguage');
    expect(audition).toContain('allowed.includes');
  });

  it('seeds from sources that produce, not from sources that are famous', () => {
    // A seed picked for fame returns a neighbourhood of famous things, which is
    // how a registry fills with outlets nobody reads for the beat.
    expect(src).toContain('HAVING count(st.id) >= 5');
    expect(src).toContain('ORDER BY count(st.id) DESC');
  });

  it('never proposes something already in the registry', () => {
    expect(src).toContain('!known.has(d)');
  });

  it('prefers the feed a site advertises over a guessed path', () => {
    expect(src).toContain('discoverFeedLinks');
    expect(src.indexOf('discoverFeedLinks')).toBeLessThan(src.indexOf('COMMON_FEED_PATHS.slice'));
  });

  it('only inserts, and only on --apply', () => {
    expect(src).not.toMatch(/DELETE FROM sources/i);
    expect(src).not.toMatch(/UPDATE sources/i);
    expect(src).toContain('ON CONFLICT (url) DO NOTHING');
    expect(src).toContain('dry run');
  });
});

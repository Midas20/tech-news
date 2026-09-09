// Filtering items, rather than silencing whatever produced them.
//
// Asked for on 2026-09-09: "The news count is very low, I think you block many
// sources, I want to filter articles not block sources."
//
// The premise turned out to be half right, and the measurement is worth keeping
// because it is the thing that told us which half. Of 477 sources, 435 were
// healthy and 420 had been polled successfully in the previous 24 hours. Almost
// nothing was blocked. But 42 were producing nothing, for two different reasons
// and neither of them a policy:
//
//   21 paused    "adapter not implemented yet" -- arXiv, CISA, crates.io, the Go
//                package index, GitHub Security Advisories. Not blocked. Unbuilt.
//   21 degraded  "no feed could be discovered" -- OpenAI, Anthropic, Google
//                Cloud, HashiCorp, Grafana, Netflix, PostgreSQL, VentureBeat.
//                Autodiscovery could not find a feed those sites do publish.
//
// Fifteen of the twenty-one were recovered by probing the feed each site
// actually serves; the next poll brought in 237 stories in one cycle against 0
// to 37 before. Those URLs are in the seeds now, so a fresh install -- the
// desktop build seeding a new machine -- does not have to rediscover them.
//
// And there WAS one rule that silenced a source on the strength of its items,
// which is exactly the thing the request names. It is gone.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SOURCE_SEEDS } from '../seeds/sources.ts';
import { COMPANY_SEEDS } from '../seeds/companies.ts';

const pipeline = readFileSync(
  new URL('../src/collect/pipeline.ts', import.meta.url), 'utf8');
const filters = readFileSync(
  new URL('../src/collect/filters.ts', import.meta.url), 'utf8');

describe('a feed is filtered, never silenced for what it contains', () => {
  it('does not pause a source for carrying media', () => {
    // The rule that was removed: more than half the items carrying an audio or
    // video enclosure paused the whole source. A feed that mixes a podcast with
    // written posts lost the posts too, permanently, on one poll's evidence.
    expect(pipeline).not.toMatch(/pauseSource\([^)]*podcast/);
    expect(pipeline).not.toContain("error: 'paused: podcast feed'");
  });

  it('still refuses the media items themselves, one at a time', () => {
    // The gate that does the real work, and always did. Removing the feed-level
    // rule is only safe because this one is per item.
    expect(filters).toMatch(/hasMediaEnclosure\(item\)\) return \{ keep: false/);
  });

  it('records the media ratio instead of acting on it', () => {
    // Still worth a person's attention on /admin/sources. Not worth a sentence
    // passed automatically.
    expect(pipeline).toContain('mostly_media');
    expect(pipeline).toMatch(/const mediaShare = isPodcastFeed/);
  });

  it('leaves the failure paths that are about the SOURCE alone', () => {
    // A 404, an unparseable body or a missing feed are facts about the source,
    // not about its articles. Those still count as failures -- this change is
    // not "never mark a source unhealthy".
    expect(pipeline).toContain("'unparseable feed'");
    expect(pipeline).toContain("'no feed could be discovered'");
  });

  it('does not treat a 429 as the source breaking', () => {
    // Rate limiting is the source working correctly.
    expect(pipeline).toMatch(/a 429 is the source working correctly/);
  });
});

describe('the feeds autodiscovery could not find', () => {
  /** Every name that carries an explicit feed, from either seed file. */
  const seeded = new Map<string, string>();
  for (const s of SOURCE_SEEDS) if (s.feedHint) seeded.set(s.name, s.feedHint);
  for (const c of COMPANY_SEEDS) {
    for (const a of c.announce ?? []) if (a.feed) seeded.set(a.name, a.feed);
  }

  // Probed against the live sites on 2026-09-09; each one parsed and returned
  // items. They are listed by name so a rename cannot quietly drop one.
  const RECOVERED = [
    'Netflix Tech Blog', 'PostgreSQL news', 'Grafana Blog', 'Fly.io blog',
    'HashiCorp Blog', 'TechRadar Computing', 'heise online', 'Qiita',
    'ITmedia NEWS', 'InfoQ Japan', 'WHATWG', 'LowEndTalk', 'OpenAI blog',
    'Google Cloud Blog', 'AWS Security Bulletins',
  ];

  it('are written down, so a fresh install does not rediscover nothing', () => {
    // The desktop build seeds a brand new database on first run. Without these
    // it would reproduce the same 21 dead sources on every new machine.
    for (const name of RECOVERED) {
      expect(seeded.get(name), `${name} has no seeded feed`).toBeTruthy();
    }
  });

  it('point at a feed rather than at the page it was found on', () => {
    for (const name of RECOVERED) {
      const url = seeded.get(name)!;
      expect(url, name).toMatch(/^https:\/\//);
      // Every one of these ends in a feed path rather than a section index --
      // the mistake that produced the original nulls was storing the human page.
      expect(url, `${name} looks like a page, not a feed`)
        .toMatch(/(feed|rss|atom|\.xml|index\.xml|news\.rss)/i);
    }
  });

  it('does not hardcode a feed for a site that publishes none', () => {
    // Anthropic serves no RSS. A guessed URL there would be a 404 on every poll
    // forever, which is worse than an honest "no feed discovered".
    for (const name of ['Anthropic news', 'Anthropic engineering']) {
      expect(seeded.get(name), `${name} should have no invented feed`).toBeUndefined();
    }
  });

  it('keeps autodiscovery as the default for everything else', () => {
    // A hardcoded feed URL is a thing that rots silently. These are exceptions,
    // and they should stay a small minority of the registry.
    const withHint = SOURCE_SEEDS.filter((s) => s.feedHint).length;
    expect(withHint).toBeLessThan(SOURCE_SEEDS.length / 2);
  });
});

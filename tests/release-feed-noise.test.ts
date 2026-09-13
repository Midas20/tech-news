// A release feed's own entries are not build noise.
//
// Every entry in a github releases.atom feed is addressed
// github.com/<owner>/<repo>/releases/tag/<version>, and isBuildNoise refused
// that address on sight, before reading anything. Applied to an aggregator that
// is the right call -- a bot posting a tag page is not news. Applied to the
// release feed itself it refuses the channel, and that is what happened: 179
// registered GitHub release feeds fetched successfully, stored nothing, and
// were pruned for producing nothing.
//
// Measured over 100 entries from ten repositories, the blanket rule refused
// 100. The finer rules refuse 22 of those on their own. The other 78 carry
// between 123 and 1,430 characters of release notes.
//
// What has to stay true: the noise rules still refuse machine-written tags from
// a release feed, and a tag page cited by anything else is refused as before.

import { describe, it, expect } from 'vitest';
import { isBuildNoise, isTagPage } from '../src/vocab/buildnoise.ts';

const TAG = 'https://github.com/angular/angular/releases/tag/22.1.4';
const NOTES = 'Fixes a regression in the router where a guard returning a '
  + 'UrlTree during a redirect would leave the outlet in a detached state. '
  + 'Also restores tree-shaking of unused animation triggers in production '
  + 'builds, which had regressed in 22.1.0.';

describe('a tag page from a release feed', () => {
  it('is refused when anything else cites it', () => {
    // Unchanged: this is the case the rule was written for.
    expect(isTagPage(TAG)).toBe(true);
    expect(isBuildNoise('Angular 22.1.4', NOTES, { url: TAG }))
      .toEqual({ noise: true, why: 'tag_page' });
  });

  it('is admitted when the release feed itself is the source', () => {
    expect(isBuildNoise('Angular 22.1.4', NOTES, { url: TAG, fromReleaseFeed: true }))
      .toEqual({ noise: false });
  });

  it('still refuses a bare version with no notes, from a release feed', () => {
    // The machine-writing-to-tags case. 41 characters of notes on a "v8.2.2" is
    // the shape the blanket rule was reaching for, and the finer rule has it.
    const v = isBuildNoise('v8.2.2', 'See the full diff on the compare page.',
      { url: 'https://github.com/vitejs/vite/releases/tag/v8.2.2', fromReleaseFeed: true });
    expect(v.noise).toBe(true);
    expect(v.why).toBe('no_content');
  });

  it('still refuses a prerelease tag from a release feed', () => {
    const v = isBuildNoise('v3.0.0-rc1', NOTES,
      { url: 'https://github.com/x/y/releases/tag/v3.0.0-rc1', fromReleaseFeed: true });
    expect(v).toEqual({ noise: true, why: 'prerelease' });
  });

  it('still refuses an automated release from a release feed', () => {
    const v = isBuildNoise('Elixir v1.18', 'Automated release for latest v1.18',
      { url: 'https://github.com/elixir-lang/elixir/releases/tag/v1.18', fromReleaseFeed: true });
    expect(v).toEqual({ noise: true, why: 'templated' });
  });

  it('still refuses a machine commit title from a release feed', () => {
    const v = isBuildNoise('chore(deps): bump actions/checkout', NOTES,
      { url: TAG, fromReleaseFeed: true });
    expect(v).toEqual({ noise: true, why: 'machine' });
  });

  it('defaults to the old behaviour when the flag is absent', () => {
    // Every existing caller passes no flag and must be unaffected.
    expect(isBuildNoise('Angular 22.1.4', NOTES, { url: TAG }).why).toBe('tag_page');
  });

  it('does not change anything for a URL that is not a tag page', () => {
    const url = 'https://blog.rust-lang.org/2026/08/01/Rust-1.99.0.html';
    expect(isBuildNoise('Announcing Rust 1.99.0', NOTES, { url }))
      .toEqual(isBuildNoise('Announcing Rust 1.99.0', NOTES, { url, fromReleaseFeed: true }));
  });
});

// ---------------------------------------------------------------------------
// The rule was right. Nothing ever asked it the question.
// ---------------------------------------------------------------------------
//
// 2026-09-12, against "The news scope still low". The tests above passed the
// whole time. `fromReleaseFeed` was wired to `source.kind === 'releases'` and
// no row in the registry has ever had that value -- 325 GitHub release feeds,
// every one filed as 'news' by the seed scripts. So the flag was false for
// every source that needed it, 323 feeds stored nothing, and the suite was
// green because it tested the rule and never the wiring.
//
// These test the wiring: the thing a unit test of a pure function cannot see.

import { readFileSync } from 'node:fs';
import { isReleaseFeed } from '../src/vocab/buildnoise.ts';

const ingest = readFileSync(new URL('../src/collect/ingest.ts', import.meta.url), 'utf8');
const audition = readFileSync(new URL('../src/collect/audition.ts', import.meta.url), 'utf8');

describe('recognising a release feed by its address', () => {
  it('knows the shapes the registry actually holds', () => {
    for (const url of [
      'https://github.com/oven-sh/bun/releases.atom',
      'https://github.com/apache/echarts/releases.atom',
      'https://github.com/PrefectHQ/prefect/tags.atom',
      'https://gitlab.com/gitlab-org/gitlab/-/releases.rss',
    ]) expect(isReleaseFeed(url), url).toBe(true);
  });

  it('does not mistake an editorial feed for a build log', () => {
    for (const url of [
      'https://go.dev/blog/feed.atom',
      'https://elixir-lang.org/blog/feed.xml',
      'https://github.blog/feed/',
      'https://example.com/releases-roundup.atom',
      null, undefined, '',
    ]) expect(isReleaseFeed(url), String(url)).toBe(false);
  });
});

describe('the escape hatch is not left to a column nobody sets', () => {
  it('ingest asks the feed address, not only source.kind', () => {
    // The regression that silenced 325 sources was exactly this line reading
    // one of the two and not the other.
    expect(ingest).toMatch(/fromReleaseFeed:\s*source\.kind === 'releases'\s*\|\|\s*isReleaseFeed\(source\.feed_url\)/);
  });

  it('the audition refuses what ingest refuses, and no more', () => {
    // A release feed auditioning under the blanket rule keeps zero of thirty
    // and is rejected before it is ever added -- the same bug, one step
    // earlier, and the one that would have kept the fix from sticking.
    expect(audition).toMatch(/isReleaseFeed\(r\.feed\)/);
    expect(audition).toMatch(/isBuildNoise\([^)]*fromReleaseFeed[^)]*\)/);
  });
});

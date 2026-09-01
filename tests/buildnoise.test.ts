// Telling a release from a build.
//
// Three hundred repository release feeds went into the registry and the archive
// filled with this:
//
//   Release v1.18-latest · elixir-lang/elixir   "Automated release for latest v1.18."
//   YugabyteDB 2026.1.2.0-b90 / -b89 / -b88 / -b87 ...
//
// The count went up and the archive got worse. A releases.atom is a build log,
// and most of what it carries is a machine writing to a tag.
//
// The risk in a filter like this is the other direction: refusing a real
// release. Half these tests exist to hold that line.

import { describe, it, expect } from 'vitest';
import { isBuildNoise, isTagPage } from '../src/vocab/buildnoise.ts';

const noise = (t: string, b = '') => isBuildNoise(t, b).noise;
const why = (t: string, b = '') => isBuildNoise(t, b).why;

describe('a repository tag page', () => {
  // The surest rule of the lot, and the cheapest: the address says what the
  // thing is before anything has to read the title. Measured over the archive
  // it caught 330 stories from 108 feeds -- exactly the set, with no other rule
  // needed and nothing else caught.
  it('is recognised from the address alone', () => {
    expect(isTagPage('https://github.com/elixir-lang/elixir/releases/tag/v1.18-latest')).toBe(true);
    expect(isTagPage('https://github.com/pytorch/pytorch/releases/tag/trunk/abc123')).toBe(true);
    expect(isTagPage('http://www.github.com/a/b/releases/tag/x')).toBe(true);
  });

  it('does not catch a project writing for readers', () => {
    // A release ANNOUNCEMENT lives on the project's own site and is written for
    // people. Only the tag page is written for git.
    expect(isTagPage('https://elixir-lang.org/blog/2026/08/28/elixir-v1-18-0-released/')).toBe(false);
    expect(isTagPage('https://go.dev/blog/go1.26')).toBe(false);
    expect(isTagPage('https://www.postgresql.org/about/news/postgresql-18-released/')).toBe(false);
  });

  it('does not catch the rest of a repository', () => {
    expect(isTagPage('https://github.com/elixir-lang/elixir')).toBe(false);
    expect(isTagPage('https://github.com/elixir-lang/elixir/issues/1')).toBe(false);
    expect(isTagPage('https://github.blog/2026-08-actions-retention/')).toBe(false);
  });

  it('is checked before anything reads the title', () => {
    // Whatever wording a tag carries, and whether or not somebody wrote notes
    // on it, it is still a tag.
    const long = 'A really substantial changelog with well over twelve words in it, '
      + 'describing several genuine changes to the software in detail.';
    expect(isBuildNoise('Elixir v1.18.0', long,
      { url: 'https://github.com/elixir-lang/elixir/releases/tag/v1.18.0' }))
      .toEqual({ noise: true, why: 'tag_page' });
  });
});

describe('a machine-written title', () => {
  it('is refused whatever it says', () => {
    expect(why('Incrementing VERSION to 154.0.8029.1', 'x')).toBe('machine');
    expect(why('153.0.8010.20: Roll Chrome Win64 PGO Profile', 'x')).toBe('machine');
    expect(why('trunk/3601a4924cb23c555c61850d5fd1f0a010a06b5e: [MPS] Ignore bias', 'x')).toBe('machine');
    expect(why('viable/strict/1787914523: Fix integer overflow', 'x')).toBe('machine');
    expect(why('chore: release @cypress/webpack-preprocessor-v8.0.0', 'x')).toBe('machine');
    expect(why('v25.2.23: Merge pull request #3795 from DrewKimball/backport', 'x')).toBe('machine');
  });

  it('does not refuse a headline that merely mentions a fix', () => {
    const notes = 'Adds a new scheduler, fixes a memory leak in the parser, and '
      + 'deprecates the legacy transport entirely.';
    expect(noise('Fixing the thundering herd in our scheduler', notes)).toBe(false);
    expect(noise('Docs are now versioned', notes)).toBe(false);
  });
});

describe('a name and a version and nothing else', () => {
  it('is a tag with the project name on it', () => {
    expect(why('ComfyUI v0.34.2', '')).toBe('no_content');
    expect(why('Python v3.11.16', '')).toBe('no_content');
    expect(why('php-8.5.10', '')).toBe('no_content');
    expect(why('@tanstack/svelte-query@6.1.48', 'chore')).toBe('no_content');
  });

  it('keeps the same title when somebody wrote notes', () => {
    const notes = 'Adds a new scheduler, fixes a memory leak in the parser, and '
      + 'deprecates the legacy transport entirely.';
    expect(noise('ComfyUI v0.34.2', notes)).toBe(false);
  });

  it('does not catch a sentence with a version in it', () => {
    const notes = 'Adds a new scheduler, fixes a memory leak in the parser, and '
      + 'deprecates the legacy transport entirely.';
    expect(noise('PHP 8.6.0 Beta 1 is available for testing', notes)).toBe(false);
    expect(noise('Announcing Rust 1.90.0', '')).toBe(false);
  });
});

describe('what is not a release', () => {
  it('refuses a rolling tag', () => {
    expect(noise('Release v1.18-latest', 'Automated release for latest v1.18.')).toBe(true);
    expect(why('v1.18-latest', 'x')).toBe('prerelease');
    expect(noise('nightly')).toBe(true);
    expect(noise('edge')).toBe(true);
  });

  it('refuses a build suffix', () => {
    // The one that mattered by volume: -b90 reads as part of the number.
    expect(noise('YugabyteDB 2026.1.2.0-b90')).toBe(true);
    expect(noise('YugabyteDB 2025.2.7.0-b34')).toBe(true);
    expect(noise('2.31.0.0-b397: [PLAT-22200] Support capacity reservation')).toBe(true);
  });

  it('refuses a release candidate and a pre-release', () => {
    expect(noise('v3.2.0-rc1')).toBe(true);
    expect(noise('Kafka 4.0.0-beta2')).toBe(true);
    expect(noise('Node v25.0.0-alpha')).toBe(true);
    expect(noise('foo 1.2.3-canary.4')).toBe(true);
    expect(noise('bar 9.9.9-snapshot')).toBe(true);
  });

  it('refuses a templated body', () => {
    expect(why('Something 3.0', 'Automated release for 3.0.')).toBe('templated');
    expect(why('Something 3.0', 'See the changelog for details.')).toBe('templated');
    expect(why('Something 3.0', 'No release notes.')).toBe('templated');
  });

  it('refuses a bare version with nothing to say', () => {
    expect(why('v1.2.3', 'v1.2.3')).toBe('no_content');
    expect(why('2026.1.2.0', '')).toBe('no_content');
  });

  it('refuses an empty title outright', () => {
    expect(why('')).toBe('no_content');
    expect(why('   ')).toBe('no_content');
  });
});

describe('what is still a release', () => {
  const notes = 'Adds a new scheduler, fixes a memory leak in the parser, and '
    + 'deprecates the legacy transport. See the upgrade guide for details.';

  it('keeps a plain version with real notes', () => {
    // The archive's most common legitimate item. Whether patch releases belong
    // in the river is what Settings -> Releases you track decides; it is not
    // this file's question.
    expect(noise('webpack v5.110.1', notes)).toBe(false);
    expect(noise('PostgreSQL 18.1', notes)).toBe(false);
    expect(noise('Elixir v1.18.0', notes)).toBe(false);
  });

  it('keeps a named release', () => {
    expect(noise('Announcing Rust 1.90.0', notes)).toBe(false);
    expect(noise('Kubernetes v1.35: Timberwolf', notes)).toBe(false);
  });

  it('does not read a word in a headline as a version suffix', () => {
    // "beta", "preview" and "latest" are ordinary words. The rule only fires
    // when they are attached to the version, which is the difference between a
    // beta release and an announcement that something has left beta.
    expect(noise('Our new engine leaves beta today', notes)).toBe(false);
    expect(noise('A preview of what is coming in 2027', notes)).toBe(false);
    expect(noise('The latest thinking on database design', notes)).toBe(false);
    expect(noise('Postgres 18 is now generally available', notes)).toBe(false);
  });

  it('keeps a genuine beta when it is announced as one', () => {
    // A judgement call, recorded: "Postgres 18 beta 1" as a headline with real
    // notes is news that a beta exists. It is the TAG form -- 18.0-beta1 with
    // no notes -- that is a build.
    expect(noise('PostgreSQL 18 Beta 1 Released', notes)).toBe(false);
  });

  it('keeps a short but real changelog', () => {
    // One line is still a line somebody wrote.
    expect(noise('redis 8.4.2',
      'Fixes a crash when RESP3 push messages arrive during a failover handoff.')).toBe(false);
  });
});

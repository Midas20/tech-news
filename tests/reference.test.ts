import { describe, it, expect } from 'vitest';
import { confirm, urlKey, inceptionDate, titleFits, TECH_TYPES, PLATFORM_TYPES } from '../src/collect/reference.ts';

describe('urlKey', () => {
  it('ignores the differences that are not differences', () => {
    const k = 'github.com/rust-lang/rust';
    expect(urlKey('https://github.com/rust-lang/rust')).toBe(k);
    expect(urlKey('http://www.github.com/rust-lang/rust/')).toBe(k);
    expect(urlKey('https://github.com/rust-lang/rust.git')).toBe(k);
    expect(urlKey('https://GitHub.com/Rust-Lang/Rust')).toBe(k);
  });

  it('keeps the differences that are', () => {
    expect(urlKey('https://github.com/rust-lang/rust'))
      .not.toBe(urlKey('https://github.com/rust-lang/cargo'));
  });

  it('returns null rather than throwing', () => {
    expect(urlKey(null)).toBeNull();
    expect(urlKey('not a url')).toBeNull();
  });
});

describe('confirm', () => {
  const rust = { name: 'Rust', repo_url: 'https://github.com/rust-lang/rust', homepage_url: 'https://rust-lang.org' };

  it('accepts a candidate whose repository is the one we already hold', () => {
    expect(confirm(rust, { repos: ['https://github.com/rust-lang/rust'], sites: [], types: [], title: 'Rust (programming language)' }))
      .toBe('repo');
  });

  it('accepts a candidate whose official site is the one we already hold', () => {
    expect(confirm(rust, { repos: [], sites: ['https://www.rust-lang.org/'], types: [], title: 'Rust (programming language)' }))
      .toBe('website');
  });

  it('prefers the repository match, which is the stronger evidence', () => {
    expect(confirm(rust, { repos: ['https://github.com/rust-lang/rust'], sites: ['https://www.rust-lang.org/'], types: ['Q9143'], title: 'Rust (programming language)' })).toBe('repo');
  });

  it('falls back to the type when no URL is held to check against', () => {
    expect(confirm({ name: 'Rust', repo_url: null, homepage_url: null },
      { repos: [], sites: [], types: ['Q9143'], title: 'Rust (programming language)' })).toBe('typed');
  });

  it('REFUSES the video game', () => {
    // This is the case the whole gate exists for. Searching Wikipedia for
    // "Rust" returns the survival game first; it is an instance of video game,
    // its repository is nothing we hold, and it must not become the background
    // paragraph on a programming language page.
    expect(confirm(rust, { repos: ['https://github.com/facepunch/rust'], sites: ['https://rust.facepunch.com'], types: ['Q7889'], title: 'Rust (programming language)' })).toBeNull();
  });

  it('refuses a candidate with nothing to confirm it at all', () => {
    expect(confirm({ name: 'Rust', repo_url: null, homepage_url: null },
      { repos: [], sites: [], types: [], title: 'Rust (programming language)' })).toBeNull();
  });

  it('does not let an unrelated repository count as a match', () => {
    expect(confirm(rust, { repos: ['https://github.com/someone/else'], sites: [], types: [], title: 'Rust (programming language)' }))
      .toBeNull();
  });

  it('recognises the common technology types', () => {
    for (const q of ['Q9143', 'Q7397', 'Q21127166', 'Q9135']) {
      expect(TECH_TYPES.has(q)).toBe(true);
    }
    expect(TECH_TYPES.has('Q7889')).toBe(false);   // video game
    expect(TECH_TYPES.has('Q11446')).toBe(false);  // ship
  });
});

describe('inceptionDate', () => {
  const claim = (time: string, precision: number) => ({
    P571: [{ mainsnak: { datavalue: { value: { time, precision } } } }],
  });

  it('takes a full date at full precision', () => {
    expect(inceptionDate(claim('+2010-07-07T00:00:00Z', 11))).toBe('2010-07-07');
  });

  it('does not invent a day Wikidata did not give', () => {
    // Precision 10 is month-only, and Wikidata pads the day with 00. Reading
    // that as the 1st is a choice; reading it as a real day would be a claim.
    expect(inceptionDate(claim('+2010-07-00T00:00:00Z', 10))).toBe('2010-07-01');
  });

  it('does not invent a month either', () => {
    expect(inceptionDate(claim('+2010-00-00T00:00:00Z', 9))).toBe('2010-01-01');
  });

  it('returns null when there is no inception claim', () => {
    expect(inceptionDate({})).toBeNull();
    expect(inceptionDate({ P571: [] })).toBeNull();
  });

  it('returns null rather than a broken date for an unparseable time', () => {
    expect(inceptionDate(claim('sometime in the 90s', 11))).toBeNull();
  });
});

describe('platform confirmation uses a different allowlist', () => {
  const upwork = { name: 'Upwork', repo_url: null, homepage_url: 'https://www.upwork.com/', kind: 'platform' as const };

  it('accepts a platform by a platform type', () => {
    // Q5412217 is "freelance marketplace" and is meaningless to the technology
    // list, which is why two thirds of platforms were being refused.
    expect(confirm(upwork, { repos: [], sites: [], types: ['Q5412217'], title: 'Upwork' })).toBe('typed');
  });

  it('does not accept a platform merely for being a business', () => {
    // business / enterprise / organization / website are the commonest types on
    // these articles and would confirm almost any company a name search found.
    for (const broad of ['Q4830453', 'Q6881511', 'Q43229', 'Q35127', 'Q891723']) {
      expect(confirm(upwork, { repos: [], sites: [], types: [broad], title: 'Upwork' }), broad).toBeNull();
    }
  });

  it('still prefers a URL we already hold over any type', () => {
    expect(confirm(upwork, { repos: [], sites: ['https://upwork.com'], types: ['Q5412217'], title: 'Upwork' })).toBe('website');
  });

  it('does not let a platform type confirm a technology', () => {
    // The two lists are not interchangeable in either direction.
    expect(confirm({ name: 'Upwork', repo_url: null, homepage_url: null, kind: 'stack' },
      { repos: [], sites: [], types: ['Q5412217'], title: 'Upwork' })).toBeNull();
  });
});

describe('titleFits — a type confirms a category, not an identity', () => {
  it('accepts a title that names the thing, brackets included', () => {
    // The disambiguator is read as part of the title, not discarded.
    expect(titleFits('Apple App Store', 'App Store (Apple)')).toBe(true);
    expect(titleFits('Rust', 'Rust (programming language)')).toBe(true);
  });

  it('rejects every wrong match this gate was added for', () => {
    // All of these shipped, briefly, as confident descriptions on a page. Each
    // passed the type gate honestly -- they ARE package managers and
    // distribution platforms -- and each was a different product.
    const wrong: [string, string][] = [
      ['Maven Central', 'Apache Maven'],
      ['Artifact Hub', 'Helm (package manager)'],
      ['Go package index', 'Apk (file format)'],
      ['Buy Me a Coffee', 'Patreon'],
      ['Flathub', 'Flatpak'],
      ['GitLab CI/CD', 'Forgejo'],
      ['Adobe Stock', 'Adobe Creative Suite'],
      ['Deno Deploy', 'Deno (software)'],
      ['MetaCPAN', 'CPAN'],
    ];
    for (const [name, title] of wrong) {
      expect(titleFits(name, title), `${name} -> ${title}`).toBe(false);
    }
  });

  it('ignores punctuation and case', () => {
    expect(titleFits('Fly.io', 'Fly io')).toBe(true);
    expect(titleFits('crates.io', 'Crates.io')).toBe(true);
  });

  it('does not let a stopword decide a match', () => {
    expect(titleFits('Buy Me a Coffee', 'Buy Me a Coffee')).toBe(true);
  });

  it('rejects an empty or meaningless name rather than matching everything', () => {
    expect(titleFits('', 'Anything At All')).toBe(false);
    expect(titleFits('a', 'Anything At All')).toBe(false);
  });

  it('gates only type-only matches, never a URL match', () => {
    // PyPI legitimately resolves to "Python Package Index" -- a title that
    // shares not one word with it -- because the official site matched.
    const pypi = { name: 'PyPI', repo_url: null, homepage_url: 'https://pypi.org/', kind: 'platform' as const };
    expect(confirm(pypi, {
      repos: [], sites: ['https://pypi.org'], types: [], title: 'Python Package Index',
    })).toBe('website');
    expect(confirm(pypi, {
      repos: [], sites: [], types: ['Q1334294'], title: 'Python Package Index',
    })).toBeNull();
  });
});

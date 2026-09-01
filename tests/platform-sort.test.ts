import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { platformSort, PLATFORM_SORTS, PLATFORM_SORT_DEFAULT } from '../src/ui/platforms.ts';

describe('platformSort', () => {
  it('accepts the orders it offers', () => {
    for (const key of Object.keys(PLATFORM_SORTS)) {
      expect(platformSort(key)).toBe(key);
    }
  });

  it('falls back to the default for anything else', () => {
    expect(platformSort(null)).toBe(PLATFORM_SORT_DEFAULT);
    expect(platformSort('')).toBe(PLATFORM_SORT_DEFAULT);
    expect(platformSort('nonsense')).toBe(PLATFORM_SORT_DEFAULT);
  });

  it('never lets a request reach the ORDER BY', () => {
    // The sort key is looked up in a map and the map's VALUE is interpolated,
    // so a request can only ever select one of the strings written here. This
    // asserts the lookup, which is the thing standing between a query
    // parameter and an ORDER BY clause.
    const evil = "name; DROP TABLE platforms--";
    expect(platformSort(evil)).toBe(PLATFORM_SORT_DEFAULT);
    expect(PLATFORM_SORTS[platformSort(evil)]!.sql).not.toContain('DROP');
  });

  it('is not fooled by inherited properties', () => {
    // 'constructor' and 'toString' are on every object. A `key in map` check
    // would accept them and index to something that is not a sort at all.
    expect(platformSort('constructor')).toBe(PLATFORM_SORT_DEFAULT);
    expect(platformSort('toString')).toBe(PLATFORM_SORT_DEFAULT);
    expect(platformSort('__proto__')).toBe(PLATFORM_SORT_DEFAULT);
  });

  it('has a usable label and a non-empty clause for every order', () => {
    for (const [key, o] of Object.entries(PLATFORM_SORTS)) {
      expect(o.label, key).toBeTruthy();
      expect(o.sql.trim(), key).not.toBe('');
    }
  });

  it('never compares against NULL with a simple CASE', () => {
    // `CASE col WHEN NULL` silently never matches, because NULL = NULL is
    // unknown. The link-health order had exactly that bug, which sorted every
    // never-checked platform as if it were the most broken one in the registry.
    for (const [key, o] of Object.entries(PLATFORM_SORTS)) {
      expect(o.sql.replace(/\s+/g, ' '), key).not.toMatch(/WHEN NULL\b/i);
    }
  });
});

// Searching the platform registry.
//
// The registry passed 190 rows on 2026-08-29 and the page had no way to look
// anything up: a reader who knew the name still had to read a channel tab and
// scroll. These tests read the source rather than the database, the same way
// the expansion and discovery tests do, so they hold the RULES without needing
// a live archive.
describe('the platform search', () => {
  const src = readFileSync(new URL('../src/ui/platforms.ts', import.meta.url), 'utf8');

  it('uses sq, so it cannot fight the header search over one box', () => {
    // `q` is the archive-wide search in the masthead. Stacks, Sources and the
    // Registry all use `sq` for "filter this page", and a fourth convention
    // would be a fourth thing to remember.
    expect(src).toContain("url.searchParams.get('sq')");
    expect(src).toContain('name="sq"');
  });

  it('matches the address as well as the name', () => {
    // A person looking for a platform often knows the domain and not the
    // brand: "avax" is Avalanche and "jup.ag" is Jupiter, and neither string
    // appears in either name.
    expect(src).toContain('lower(p.name) LIKE');
    expect(src).toContain('lower(p.slug) LIKE');
    expect(src).toContain('lower(p.url) LIKE');
  });

  it('does not match the blurb', () => {
    // Those descriptions come from Wikidata and are written to disambiguate an
    // item in a list, so nearly every one contains "platform", "service" or
    // "software". Searching them returns the whole registry for a term that
    // felt specific when it was typed.
    expect(src).not.toMatch(/lower\(r\.short_description\) LIKE/);
  });

  it('binds the term once rather than per column', () => {
    // Three LIKEs against one placeholder. Pushing the same value three times
    // works and drifts the moment a fourth column is added.
    const at = src.indexOf('lower(p.name) LIKE');
    const clause = src.slice(at - 200, at + 200);
    expect(clause).toContain('const i = params.push(like)');
  });

  it('keeps the channel while searching, and offers a way out of it', () => {
    // Searching for Coinbase while standing in App and extension stores finds
    // nothing, and the registry does have it. An empty result that does not say
    // so reads as "not in the registry".
    expect(src).toContain('name="channel"');
    expect(src).toContain('Search every channel');
    // Only when a channel is actually narrowing the result -- there is nowhere
    // to send a reader whose term matches nothing anywhere.
    expect(src).toContain('search && channel ?');
  });

  it('says what it searched for when nothing came back', () => {
    expect(src).toContain('Nothing in the registry matches');
  });

  it('offers a way to clear it', () => {
    expect(src).toContain('>Clear</a>');
  });

  it('escapes the term everywhere it is echoed', () => {
    // It is reflected into the input value, the heading and the empty state.
    // Three places, three chances to write an unescaped one.
    for (const m of src.matchAll(/\$\{search\}/g)) expect(m[0], 'raw ${search}').toBe('');
    expect(src).toContain('escapeHtml(search)');
    expect(src).toContain('encodeURIComponent(search)');
  });
});

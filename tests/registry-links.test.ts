// Where the registry's buttons go.
//
// Reported 2026-08-29, from /stacks?sq=datab&cat=data with Databricks open:
// "I need more detail data but the more detail data don't work". The button
// labelled "More data" pointed at
//
//     /stacks?sq=datab&cat=data
//
// which is the page it was clicked on. Setting the category that is already set
// and keeping the search term that narrowed the list to one row is not a change
// of view, so nothing happened.
//
// A no-op link is worse than a missing one. A missing button is understood in a
// moment; a dead button gets clicked twice and then distrusted.

import { describe, it, expect } from 'vitest';
import { __test, type Filters } from '../src/ui/registry.ts';

const { toQuery } = __test;

const base: Filters = {
  kind: 'stack', search: '', categories: [], have: [],
  seen: 'any', origin: 'any', sort: 'activity', offset: 0,
};

describe('the "see all <category>" button', () => {
  // How the button builds its own href, mirroring the call site.
  const seeAll = (f: Filters, category: string) =>
    toQuery(f, { categories: [category], offset: 0, search: '' });

  it('escapes a search that narrowed the list to one row', () => {
    const f = { ...base, search: 'datab', categories: ['data'] };
    const href = seeAll(f, 'data');
    expect(href).not.toContain('sq=datab');
    expect(href).toContain('cat=data');
  });

  it('is never the page it was clicked on', () => {
    // The regression, stated as the property that was violated.
    const f = { ...base, search: 'datab', categories: ['data'] };
    const here = toQuery(f);
    expect(seeAll(f, 'data')).not.toBe(here);
  });

  it('still works when there was no search to clear', () => {
    const f = { ...base, categories: ['ai'] };
    expect(seeAll(f, 'data')).toContain('cat=data');
    expect(seeAll(f, 'data')).not.toContain('cat=ai');
  });

  it('returns to the first page of results', () => {
    const f = { ...base, search: 'datab', offset: 120 };
    expect(seeAll(f, 'data')).not.toContain('offset');
  });

  it('replaces the category rather than adding to it', () => {
    // "See all data" means data, not data-and-whatever-was-already-ticked.
    const f = { ...base, categories: ['ai', 'cloud'] };
    const href = seeAll(f, 'data');
    expect(href.match(/cat=/g)?.length).toBe(1);
  });
});

describe('toQuery in general', () => {
  it('omits defaults rather than spelling them out', () => {
    expect(toQuery(base)).toBe('/stacks');
  });

  it('keeps the kind it was given', () => {
    expect(toQuery({ ...base, kind: 'tool' })).toBe('/tools');
  });

  it('round-trips a search', () => {
    expect(toQuery({ ...base, search: 'redis' })).toContain('sq=redis');
  });
});

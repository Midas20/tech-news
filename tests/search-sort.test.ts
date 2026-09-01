// The search results had one order and no way to change it.
//
// /news and /all carry a Sort control with six orderings. /search hardcoded
// `ORDER BY rank DESC` and rendered no control at all, so a query matching 5,212
// stories offered exactly one view of them — and `?sort=` in the URL was read by
// nothing, which is worse than refusing it, because the address looks like it
// worked.
//
// The orderings are the reader's, imported rather than redefined: six names
// meaning six different things depending on which page you are on is the bug
// this avoids.

import { describe, it, expect } from 'vitest';
import { SEARCH_SORTS, SEARCH_SORT_LABELS, searchSort } from '../src/ui/search.ts';
import { SORTS, SORT_LABELS } from '../src/ui/filters.ts';

describe('choosing a search ordering', () => {
  it('defaults to relevance', () => {
    expect(searchSort(null)).toBe('relevance');
    expect(searchSort('')).toBe('relevance');
  });

  it('accepts every ordering the reader offers', () => {
    for (const name of Object.keys(SORTS)) {
      expect(searchSort(name), `${name} should be accepted`).toBe(name);
    }
  });

  it('refuses anything else', () => {
    // The value reaches an ORDER BY by string interpolation, so the allowlist is
    // the only thing between the query string and the query.
    for (const bad of ['', 'id', 'rank', 'DROP TABLE stories', 's.id; --', 'newest ']) {
      expect(searchSort(bad)).toBe('relevance');
    }
  });

  it('never interpolates anything but a known clause', () => {
    // Belt and braces on the above: whatever searchSort returns must index a
    // clause that was written in this repository, not assembled from input.
    const clause = SEARCH_SORTS[searchSort('anything at all')];
    expect(clause).toBeDefined();
    expect(Object.values(SEARCH_SORTS)).toContain(clause);
  });
});

describe('the orderings are the reader\'s', () => {
  it('adds relevance and nothing else', () => {
    const extra = Object.keys(SEARCH_SORTS).filter((k) => !Object.hasOwn(SORTS, k));
    expect(extra).toEqual(['relevance']);
  });

  it('keeps a label for every ordering', () => {
    for (const name of Object.keys(SEARCH_SORTS)) {
      expect(SEARCH_SORT_LABELS[name], `${name} has no label`).toBeTruthy();
    }
  });

  it('words the shared ones exactly as the reader does', () => {
    // Two pages calling the same ordering different things is how a reader
    // learns not to trust either.
    for (const [name, label] of Object.entries(SORT_LABELS)) {
      expect(SEARCH_SORT_LABELS[name]).toBe(label);
    }
  });

  it('drops relevance from the clause when another ordering is chosen', () => {
    // Kept as a tiebreak it would do nothing: rank is a float that is distinct
    // for almost every row, so "newest first" would silently stay rank-first.
    for (const [name, clause] of Object.entries(SEARCH_SORTS)) {
      if (name === 'relevance') continue;
      expect(clause, `${name} still orders by rank`).not.toMatch(/\brank\b/);
    }
  });
});

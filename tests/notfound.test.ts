// The did-you-mean on the 404 page.
//
// renderNotFound() reads the retention window from the database; the part worth
// pinning down is the suggestion, because a WRONG suggestion is worse than none
// -- it sends someone confidently to a page that is not what they wanted.

import { describe, it, expect } from 'vitest';
import { __test } from '../src/ui/notfound.ts';
import {
  crumbsFor, REGISTRY_ITEMS, EXPLORE_ITEMS, SYSTEM_ITEMS, ANALYSE_ITEMS,
} from '../src/ui/nav.ts';

const { suggestions, distance } = __test;
const paths = (p: string) => suggestions(p).map((s) => s.path);

describe('edit distance', () => {
  it('is zero for the same string', () => {
    expect(distance('/stacks', '/stacks')).toBe(0);
  });

  it('counts a substitution, an insertion and a deletion alike', () => {
    expect(distance('/stacks', '/stacke')).toBe(1);
    expect(distance('/stacks', '/stackss')).toBe(1);
    expect(distance('/stacks', '/stack')).toBe(1);
  });

  it('handles an empty side', () => {
    expect(distance('', '/news')).toBe(5);
    expect(distance('/news', '')).toBe(5);
  });
});

describe('suggestions', () => {
  it('finds the obvious typo', () => {
    expect(paths('/stak')).toContain('/stacks');
    expect(paths('/newz')).toContain('/news');
    expect(paths('/favorites')).toContain('/favourites');
  });

  it('prefers a route the path is built on top of', () => {
    // /stacks/rust is not a route, but /stacks is, and no edit distance would
    // rank it first.
    expect(paths('/stacks/rust')[0]).toBe('/stacks');
    expect(paths('/trends/rust')[0]).toBe('/trends');
  });

  it('ignores a trailing slash', () => {
    expect(paths('/tools/')).toContain('/tools');
  });

  it('is case-insensitive', () => {
    expect(paths('/Tools')).toContain('/tools');
  });

  it('offers nothing for something with no plausible match', () => {
    // Better silence than a confident wrong answer.
    expect(suggestions('/wp-admin/setup-config.php')).toHaveLength(0);
    expect(suggestions('/xmlrpc.php')).toHaveLength(0);
  });

  it('does not match everything short against a short path', () => {
    // "/x" is one edit from nothing useful; a loose threshold would return the
    // whole route table.
    expect(suggestions('/x').length).toBeLessThanOrEqual(1);
  });

  it('never repeats a route', () => {
    const out = paths('/stacks/');
    expect(new Set(out).size).toBe(out.length);
  });

  it('returns at most what it is asked for', () => {
    expect(suggestions('/stak', 2).length).toBeLessThanOrEqual(2);
  });
});

// The eyebrow is a claim about where you are, so it has to come from the same
// place the top bar comes from. Every one of these was hand-written once and
// every one of them was wrong after the navigation changed.
describe('breadcrumbs follow the top bar', () => {
  it('name the section that owns the page', () => {
    // All four registry lists sit under one section now, so each of them names
    // it. Stacks, Tools, Concepts and Platforms were three sections between
    // them, and two of those sections owned a single page.
    expect(crumbsFor('/concepts', 'Concepts').map((c) => c.label)).toEqual(['Registry', 'Concepts']);
    expect(crumbsFor('/tools', 'Tools').map((c) => c.label)).toEqual(['Registry', 'Tools']);
    expect(crumbsFor('/platforms', 'Platforms').map((c) => c.label)).toEqual(['Registry', 'Platforms']);
    expect(crumbsFor('/favourites', 'Favourites').map((c) => c.label)).toEqual(['News', 'Favourites']);
    expect(crumbsFor('/search', 'Search').map((c) => c.label)).toEqual(['News', 'Search']);
    expect(crumbsFor('/settings', 'Settings').map((c) => c.label)).toEqual(['System', 'Settings']);
    expect(crumbsFor('/categories', 'Categories').map((c) => c.label)).toEqual(['Explore', 'Categories']);
  });

  it('say nothing when the page IS the section', () => {
    // "REGISTRY" above an <h1> reading "Registry" is the title twice. Only the
    // section HOME earns silence -- /tools is one of four lists inside Registry
    // and does need to say where it is.
    for (const [path, label] of [['/stacks', 'Registry'], ['/news', 'News'],
      ['/all', 'Everything'], ['/trends', 'Analyse'],
      ['/sources', 'Sources']] as [string, string][]) {
      expect(crumbsFor(path, label)).toEqual([]);
    }
  });

  it('link the list a detail page came from', () => {
    // A platform detail page passes the name of the LIST it came from, and that
    // list is no longer a section, so the trail is section + list rather than
    // the bare list it used to be.
    const platform = crumbsFor('/platform/', 'Platforms');
    expect(platform.map((c) => c.label)).toEqual(['Registry', 'Platforms']);
    expect(platform[1]!.href).toBe('/platforms');

    const trail = crumbsFor('/technology/', 'By category');
    expect(trail.map((c) => c.label)).toEqual(['Registry', 'By category']);
    expect(trail[1]!.href).toBe('/technologies');
  });

  // Two entries carrying one name is the failure crumbsFor() cannot report:
  // it resolves a label to the first item that has it, so the loser silently
  // links to the winner's page. '/categories' and '/technologies' were both
  // called "By category".
  it('never gives two destinations the same name', () => {
    const all = [...REGISTRY_ITEMS, ...EXPLORE_ITEMS, ...SYSTEM_ITEMS, ...ANALYSE_ITEMS];
    const labels = all.map((i) => i.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

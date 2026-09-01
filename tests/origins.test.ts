// Where a vocabulary entry came from.
//
// `curated` is a boolean, so everything not hand-seeded was called DISCOVERED
// -- by the origin filter, by the growth panel, and by the row's own record.
// That was true of two entries and wrong about 1,615: the rest are published
// vocabularies loaded in bulk, which arrive with no coverage and often never
// get any. The visible symptom was a panel headed "recently added by the
// system" listing technologies with no news, which is what a reader clicks and
// finds an empty page.

import { describe, it, expect } from 'vitest';
import {
  DISCOVERED_ORIGINS, IMPORTED_ORIGINS, CURATED_ORIGINS, IMPORT_SOURCE, originClass,
} from '../src/vocab/origins.ts';
import { unquote, frontmatter } from '../src/lib/frontmatter.ts';

describe('origin classes', () => {
  it('calls an import an import and a discovery a discovery', () => {
    expect(originClass('topic_index')).toBe('imported');
    expect(originClass('linguist')).toBe('imported');
    expect(originClass('cncf')).toBe('imported');
    expect(originClass('github_release')).toBe('discovered');
    expect(originClass('title')).toBe('discovered');
    expect(originClass('repo_link')).toBe('discovered');
    expect(originClass('seed')).toBe('curated');
    expect(originClass('manual')).toBe('curated');
  });

  it('treats an origin it has never seen as curated, not as a discovery', () => {
    // The safe default. Claiming the archive found something it did not is the
    // failure being fixed here; the reverse only understates.
    expect(originClass('something_new')).toBe('curated');
  });

  it('puts every origin in exactly one class', () => {
    const all = [...DISCOVERED_ORIGINS, ...IMPORTED_ORIGINS, ...CURATED_ORIGINS];
    expect(new Set(all).size).toBe(all.length);
  });

  it('can name the list every import came from', () => {
    for (const o of IMPORTED_ORIGINS) {
      expect(IMPORT_SOURCE[o], `${o} should say which vocabulary it is`).toBeTruthy();
    }
  });

  it('agrees with what discovery actually writes', () => {
    // src/process/discover.ts types a candidate's origin as this union. If a
    // fourth is ever added, it must land in DISCOVERED_ORIGINS or the growth
    // panel will silently stop showing it.
    for (const o of ['github_release', 'title', 'repo_link']) {
      expect(DISCOVERED_ORIGINS).toContain(o);
    }
  });
});

describe('reading a quoted YAML scalar', () => {
  it('takes off a matched pair', () => {
    expect(unquote('"Animal Crossing"')).toBe('Animal Crossing');
    expect(unquote('"JSON:API"')).toBe('JSON:API');
    expect(unquote("'CC: Tweaked'")).toBe('CC: Tweaked');
  });

  it('leaves an unquoted value alone', () => {
    expect(unquote('Rust')).toBe('Rust');
    expect(unquote('C++')).toBe('C++');
  });

  it('leaves a lone quote where it is', () => {
    // Half a pair is a name containing a quote, not a quoted name. Stripping
    // one end would be the same class of bug pointing the other way.
    expect(unquote('"Hello')).toBe('"Hello');
    expect(unquote('6" pipe')).toBe('6" pipe');
  });

  it('does not eat a quote that belongs to the value', () => {
    expect(unquote('"the "best" one"')).toBe('the "best" one');
  });

  it('unescapes what YAML escaped', () => {
    expect(unquote('"say \\"hi\\""')).toBe('say "hi"');
  });

  it('unquotes through the reader, not only on its own', () => {
    // The bug was not in unquote -- there was no unquote. It was that the
    // reader stored the raw scalar, so this is the assertion that matters.
    const fm = frontmatter(
      '---\ntopic: animal-crossing\ndisplay_name: \"Animal Crossing\"\nshort_description: A game.\n---\nbody');
    expect(fm.display_name).toBe('Animal Crossing');
    expect(fm.topic).toBe('animal-crossing');
    expect(fm.short_description).toBe('A game.');
  });
});

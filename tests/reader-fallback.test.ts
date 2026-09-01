// What the reader shows when the link has rotted.
//
// Reported 2026-08-29 with a screenshot. A Google Cloud Blog post stored with a
// real headline and 4,099 words rendered as:
//
//   title:  "Google Cloud Blog"
//   body:   404. That's an error. The requested URL ... was not found
//   words:  26
//
// Google had moved the post and served an error page whose og:title is the site
// name. All three fields came from the live fetch and overwrote a correct
// archive record — the reader treated HTTP 200 as a promise that the article
// was still there.
//
// The rule this establishes: THE ARCHIVE OUTRANKS THE LIVE PAGE. The reading
// page is a view onto a request, and when the request stops agreeing with the
// archive, the archive is the thing that was verified once and the request is
// the thing that just failed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { __test } from '../src/ui/article.ts';

const { looksLikeAnErrorPage } = __test;
const src = readFileSync(new URL('../src/ui/article.ts', import.meta.url), 'utf8');

describe('recognising an error page', () => {
  it('catches the one that was reported', () => {
    expect(looksLikeAnErrorPage("404. That's an error.", [])).toBe(true);
    expect(looksLikeAnErrorPage(null,
      [{ text: "404. That's an error. The requested URL was not found on this server." }])).toBe(true);
  });

  it('catches the usual shapes', () => {
    for (const t of ['Page not found', 'Error 404', '403 Forbidden',
                     'Access Denied', '500 - Internal Server Error',
                     'Not Found']) {
      expect(looksLikeAnErrorPage(t, []), t).toBe(true);
    }
  });

  it('does not catch an article that is ABOUT errors', () => {
    // The reason it reads the title and the first block only: a real piece on
    // HTTP semantics says "404" in its body all day.
    for (const t of ['Deploy personal AI agents with Cloud Run instances',
                     'What a 404 response really means for SEO',
                     'Handling errors in Rust without panicking',
                     'Not Foundation: rethinking CSS frameworks']) {
      expect(looksLikeAnErrorPage(t, []), t).toBe(false);
    }
  });

  it('reads only the start of the first block, not the whole page', () => {
    // An article that happens to quote an error message further down is still
    // an article.
    const long = `${'A real paragraph about deployment. '.repeat(20)} 404 not found`;
    expect(looksLikeAnErrorPage('Deploying to Cloud Run', [{ text: long }])).toBe(false);
  });
});

describe('the archive outranks the live page', () => {
  it('keeps the stored title, always', () => {
    // `readable.title ?? base.title` is how "Google Cloud Blog" replaced a real
    // headline. The stored title came from the feed at collection time and is
    // what the reader clicked.
    expect(src).toContain('title: base.title,');
    expect(src).not.toContain('title: readable.title ?? base.title');
  });

  it('falls back when the page says it is an error', () => {
    expect(src).toContain('looksLikeAnErrorPage(readable.title, readable.blocks)');
    expect(src).toContain('the publisher has moved or removed it');
  });

  it('falls back when the page returns a fraction of what was collected', () => {
    // A consent wall, a login, or a stub left behind by a move.
    expect(src).toContain('liveChars < archived * 0.25');
  });

  it('compares characters with characters, because the archive stores characters', () => {
    // The bug this replaced. `stories.body_chars` has always held
    // bodyText.length; comparing it to readable.WORDS made the test true of
    // any prose at all -- six characters to the word -- so the reading page
    // refused nearly every article it had successfully fetched and blamed a
    // wall. "561 words" and "3,769" were the same InfoQ page.
    expect(src).toContain('const liveChars = readable.blocks.reduce');
    // The comparison itself, not the comment recording what it used to be.
    expect(src).not.toMatch(/if \(archived >= \d+ && readable\.words/);
    // Both sides now come off the same column, under its honest name.
    expect(src).toContain('s.body_chars');
  });

  it('only applies the shrinkage rule when there is something to compare to', () => {
    // A genuinely short post must stay readable. 1,800 characters is the same
    // bar the old `300` was reaching for, in the unit the number is actually in.
    expect(src).toContain('archived >= 1800');
  });

  it('says which number it is complaining about', () => {
    // "Only 26 characters came back from a page the archive read as 4,099" is
    // a sentence a reader can act on; "could not read the page" is not.
    expect(src).toContain('characters came back from a page the ');
  });
});

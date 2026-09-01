import { describe, it, expect } from 'vitest';
import { backFrom, type BackTarget } from '../src/ui/nav.ts';

const FALLBACK: BackTarget = { href: '/news', label: 'News', phrase: 'News' };
const at = (u: string) => `http://127.0.0.1:3000${u}`;

describe('backFrom', () => {
  it('keeps the filters, which is the entire point', () => {
    expect(backFrom(at('/news?kind2=change&stack=openai&sort=new'), FALLBACK).href)
      .toBe('/news?kind2=change&stack=openai&sort=new');
  });

  it('names the list it is going back to', () => {
    const t = backFrom(at('/favourites?stack=openai'), FALLBACK);
    expect(t).toEqual({ href: '/favourites?stack=openai', label: 'Favourites', phrase: 'Favourites' });
  });

  it('gives a breadcrumb noun and a sentence phrase that differ where they must', () => {
    // "Back to Explore" and "the reader / Story" both read like a bug.
    const t = backFrom(at('/all?stack=rust'), FALLBACK);
    expect(t.label).toBe('Explore');
    expect(t.phrase).toBe('the reader');
  });

  it('handles a list with no filters at all', () => {
    expect(backFrom(at('/news'), FALLBACK).href).toBe('/news');
  });

  it('falls back when there is no referer', () => {
    expect(backFrom(null, FALLBACK)).toEqual(FALLBACK);
  });

  it('falls back for a path it does not recognise', () => {
    expect(backFrom(at('/admin/jobs?x=1'), FALLBACK)).toEqual(FALLBACK);
  });

  it('falls back for the paths the caller asked to ignore', () => {
    // A story page must not offer "back" to another story page you never saw.
    expect(backFrom(at('/story/abc?k=1'), FALLBACK, ['/story/'])).toEqual(FALLBACK);
    expect(backFrom(at('/read/abc'), FALLBACK, ['/story/', '/read/'])).toEqual(FALLBACK);
  });

  it('still offers a story record when the caller has not ignored it', () => {
    const t = backFrom(at('/story/abc'), FALLBACK);
    expect(t.href).toBe('/story/abc');
    expect(t.phrase).toBe('the story record');
  });

  it('never lets a foreign referer name the host', () => {
    // The referer is supplied by whoever links here. Only the allowlisted path
    // and its query survive, so the href is always same-origin and relative.
    const t = backFrom('https://evil.example/news?kind2=change', FALLBACK);
    expect(t.href).toBe('/news?kind2=change');
    expect(t.href.startsWith('/')).toBe(true);
    expect(t.href).not.toContain('evil.example');
  });

  it('drops a query long enough to be something other than a filter', () => {
    expect(backFrom(at('/news?q=' + 'x'.repeat(600)), FALLBACK).href).toBe('/news');
  });

  it('keeps a query right up to the limit', () => {
    const q = '?q=' + 'x'.repeat(512 - 3);
    expect(backFrom(at('/news' + q), FALLBACK).href).toBe('/news' + q);
  });

  it('falls back rather than throwing on a malformed referer', () => {
    expect(backFrom('::::not a url', FALLBACK)).toEqual(FALLBACK);
  });

  it('ignores a bare "?" rather than emitting a trailing question mark', () => {
    expect(backFrom(at('/news?'), FALLBACK).href).toBe('/news');
  });

  it('matches prefixed sections and carries their filters', () => {
    expect(backFrom(at('/trend/rust?window=90'), FALLBACK).href).toBe('/trend/rust?window=90');
    expect(backFrom(at('/platform/npm'), FALLBACK).label).toBe('Platforms');
  });
});

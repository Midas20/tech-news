// The reading page's pure parts.
//
// renderRead() fetches and hits the database, so what is tested here is
// everything that decides what the page SAYS: how blocks become elements, how
// untrusted text is escaped, and what the copy button puts on the clipboard.

import { describe, it, expect } from 'vitest';
import { articleText, __test } from '../src/ui/read.ts';
import type { Block } from '../src/collect/extract.ts';
import type { ArticlePayload } from '../src/ui/article.ts';

const { body, backLink, minutes } = __test;

const p = (text: string): Block => ({ kind: 'p', text });
const li = (text: string): Block => ({ kind: 'li', text });

const payload = (blocks: Block[], extra: Partial<ArticlePayload> = {}): ArticlePayload => ({
  id: 'x', title: 'A Title', url: 'https://example.com/a', host: 'example.com',
  source: 'Example', author: 'A Writer', published: '2026-01-02', words: 12,
  blocks, ...extra,
});

describe('rendering article blocks', () => {
  it('maps each kind to the element it actually is', () => {
    const html = body([
      { kind: 'h', text: 'Heading' },
      p('Prose.'),
      { kind: 'quote', text: 'Quoted.' },
      { kind: 'code', text: 'const a = 1;' },
    ]);
    expect(html).toContain('<h2>Heading</h2>');
    expect(html).toContain('<p>Prose.</p>');
    expect(html).toContain('<blockquote>Quoted.</blockquote>');
    expect(html).toContain('<pre><code>const a = 1;</code></pre>');
  });

  it('gathers consecutive list items into one list', () => {
    // The extractor emits LI blocks one at a time; rendering each as its own
    // <ul> would produce a column of single-item lists.
    const html = body([li('one'), li('two'), p('after'), li('three')]);
    expect(html).toBe('<ul><li>one</li><li>two</li></ul><p>after</p><ul><li>three</li></ul>');
  });

  it('closes a trailing list', () => {
    expect(body([p('a'), li('b')])).toBe('<p>a</p><ul><li>b</li></ul>');
  });

  it('escapes text from the fetched page', () => {
    // Blocks are text by contract, but this is the one place content from a
    // stranger's server reaches a page, so it is escaped regardless.
    const html = body([p('<script>alert(1)</script> & "quoted"')]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('escapes inside every block kind, not just paragraphs', () => {
    for (const kind of ['h', 'li', 'quote', 'code'] as const) {
      expect(body([{ kind, text: '<img onerror=x>' }])).not.toContain('<img');
    }
  });

  it('renders nothing for no blocks rather than an empty element', () => {
    expect(body([])).toBe('');
  });
});

describe('the copy payload', () => {
  it('leads with the attribution, so a quote is never orphaned', () => {
    const text = articleText(payload([p('First.'), p('Second.')]));
    expect(text.split('\n')[0]).toBe('A Title');
    expect(text).toContain('Example · A Writer');
    expect(text).toContain('https://example.com/a');
  });

  it('marks up lists and quotes so structure survives the paste', () => {
    const text = articleText(payload([li('one'), { kind: 'quote', text: 'said' }]));
    expect(text).toContain('- one');
    expect(text).toContain('> said');
  });

  it('never leaves more than one blank line', () => {
    const text = articleText(payload([p('a'), p('b'), p('c')]));
    expect(text).not.toMatch(/\n{3}/);
  });

  it('copes with an article that could not be read', () => {
    const text = articleText(payload([], { problem: 'Refused with 403.' }));
    expect(text).toContain('A Title');
    expect(text).toContain('https://example.com/a');
  });
});

describe('the back link', () => {
  it('falls back to the reader when there is no referer', () => {
    expect(backLink(null)).toEqual({ href: '/all', label: 'the reader' });
  });

  it('names a stream it recognises', () => {
    expect(backLink('http://x/new')).toEqual({ href: '/new', label: 'Newcomers' });
    expect(backLink('http://x/news')).toEqual({ href: '/news', label: 'News' });
  });

  it('does not name a page that no longer exists', () => {
    // /niche, /today, /critical and /releases were all in this map after the
    // pages themselves were removed, so the back link offered a redirect and
    // called it by a name the app had stopped using.
    for (const gone of ['/niche', '/today', '/critical', '/releases', '/community']) {
      expect(backLink(`http://x${gone}`)).toEqual({ href: '/all', label: 'the reader' });
    }
  });

  it('goes back to the story record', () => {
    expect(backLink('http://x/story/abc').href).toBe('/story/abc');
  });

  it('never points back at another reading page', () => {
    // Following read -> read -> back would loop through articles.
    expect(backLink('http://x/read/abc').href).toBe('/all');
  });

  it('ignores a referer from somewhere else entirely', () => {
    expect(backLink('https://elsewhere.example/whatever').href).toBe('/all');
  });

  it('does not throw on a malformed referer', () => {
    expect(() => backLink('::::')).not.toThrow();
    expect(backLink('::::').href).toBe('/all');
  });
});

describe('reading time', () => {
  it('never claims less than a minute', () => {
    expect(minutes(0)).toBe(1);
    expect(minutes(5)).toBe(1);
  });

  it('scales with length', () => {
    expect(minutes(2300)).toBe(10);
  });
});

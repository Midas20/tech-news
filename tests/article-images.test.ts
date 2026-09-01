// Diagrams, and the rule they were not allowed to break.
//
// The reader has always been text-only, and the reason was good: no HTML from a
// stranger's server reaches the browser, so there is nothing to sanitize. The
// cost was that every diagram, chart and screenshot in every article was
// dropped, which on a technical article is often the part worth reading.
//
// An image does not require breaking the rule. What is taken from the page is
// ONE ABSOLUTE HTTPS URL; the reader builds its own <img> around it. Nothing is
// passed through. These tests pin that distinction, because the obvious
// "improvement" is to keep the original markup and it must never be made.

import { describe, it, expect } from 'vitest';
import { extractReadable } from '../src/collect/extract.ts';

const page = (body: string) => `<!doctype html><html><head><title>T</title></head>
  <body><article>${body}</article></body></html>`;

const PROSE = '<p>' + 'This is a long enough paragraph to make the container win. '.repeat(6) + '</p>';

function blocksOf(html: string) {
  return extractReadable(page(PROSE + html), 'https://example.com/post/1').blocks;
}

describe('images become blocks', () => {
  it('keeps an absolute https image', () => {
    const img = blocksOf('<img src="https://cdn.example.com/diagram.png" alt="The architecture">')
      .find((b) => b.kind === 'image');
    expect(img?.src).toBe('https://cdn.example.com/diagram.png');
    expect(img?.text).toBe('The architecture');
  });

  it('resolves a relative source against the page', () => {
    const img = blocksOf('<img src="/img/chart.png">').find((b) => b.kind === 'image');
    expect(img?.src).toBe('https://example.com/img/chart.png');
  });

  it('finds the real address of a lazy-loaded image', () => {
    // The common case on the sites this archive reads: `src` is a placeholder
    // and the address is in data-src or srcset. Reading only `src` produces a
    // page of grey squares.
    const lazy = blocksOf('<img src="data:image/gif;base64,R0lGOD" data-src="https://cdn.example.com/real.png">')
      .find((b) => b.kind === 'image');
    expect(lazy?.src).toBe('https://cdn.example.com/real.png');

    const set = blocksOf('<img srcset="https://cdn.example.com/w800.png 800w, https://cdn.example.com/w1600.png 1600w">')
      .find((b) => b.kind === 'image');
    expect(set?.src).toBe('https://cdn.example.com/w800.png');
  });

  it('refuses http, refuses a bare data URI, and refuses a tracking pixel', () => {
    // http on an https page is blocked by the browser anyway, and silently.
    expect(blocksOf('<img src="http://cdn.example.com/x.png">')
      .some((b) => b.kind === 'image')).toBe(false);
    expect(blocksOf('<img src="data:image/gif;base64,R0lGOD">')
      .some((b) => b.kind === 'image')).toBe(false);
    // 1x1 is a beacon, not a diagram.
    expect(blocksOf('<img src="https://t.example.com/p.gif" width="1" height="1">')
      .some((b) => b.kind === 'image')).toBe(false);
  });

  it('shows the same picture once', () => {
    const twice = blocksOf(
      '<img src="https://cdn.example.com/a.png"><img src="https://cdn.example.com/a.png">');
    expect(twice.filter((b) => b.kind === 'image')).toHaveLength(1);
  });

  it('keeps a caption as prose next to the picture', () => {
    const bs = blocksOf('<figure><img src="https://cdn.example.com/a.png"><figcaption>Figure 1</figcaption></figure>');
    expect(bs.some((b) => b.kind === 'image')).toBe(true);
    expect(bs.some((b) => b.text === 'Figure 1')).toBe(true);
  });
});

describe('an image is a URL, never markup', () => {
  it('carries no attribute from the page other than the address and the alt', () => {
    const img = blocksOf(
      '<img src="https://cdn.example.com/a.png" onerror="alert(1)" class="x" style="width:9px">')
      .find((b) => b.kind === 'image');
    expect(img?.src).toBe('https://cdn.example.com/a.png');
    expect(JSON.stringify(img)).not.toContain('onerror');
    expect(JSON.stringify(img)).not.toContain('style');
  });

  it('does not let a picture make a thin page look substantial', () => {
    // `thin` decides whether the reader offers to show the page at all. Alt
    // text is a label, not reading, so images contribute no words.
    const r = extractReadable(
      page('<p>short</p>' + '<img src="https://cdn.example.com/a.png" alt="a b c d e f g h i j">'),
      'https://example.com/post/1');
    expect(r.thin).toBe(true);
  });
});

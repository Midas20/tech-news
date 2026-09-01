// The registry row is a CSS grid, and a grid states the same fact twice: how
// many cells the markup emits, and how many columns the stylesheet declares.
// Nothing makes them agree, and when they disagree CSS does not complain -- it
// silently folds the surplus cell onto a second row, which reads as a broken
// row rather than as a broken rule.
//
// Both halves were wrong at once. Wide, the counter columns were narrower than
// the values they held, so "18-12came" wrapped at its hyphen and made its row
// taller than its neighbours. Narrow, the template declared four columns while
// five cells survived the display:none list, so the last count dropped a row.
//
// These tests read the real stylesheet and render a real row, with the widest
// values the archive can produce.

import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { CSS } from '../src/ui/theme.ts';
import { registryRow, registryHead, type RegistryRow, type Filters }
  from '../src/ui/registry.ts';

/** Split a grid-template-columns value into tracks, respecting minmax(...). */
function tracks(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** The wide and narrow track lists, which the stylesheet names once each. */
function template(which: 'wide' | 'narrow'): string[] {
  const name = which === 'wide' ? '--reg-cols' : '--reg-cols-narrow';
  const m = new RegExp(`${name}:([^;]*);`).exec(CSS);
  expect(m, `${name} should be defined`).toBeTruthy();
  return tracks(m![1]!.replace(/\s+/g, ' '));
}

// The widest row this archive can actually produce: six-figure story counts,
// a five-figure month, a first sighting from the oldest year on file.
const ROW: RegistryRow = {
  slug: 'programming-languages', name: 'Programming Languages', kind: 'concept',
  description: 'A grouping.', blurb: 'A grouping.', homepage_url: null,
  category: 'languages', status: 'active', parent: null,
  aliases: ['langs', 'programming language'],
  docs_url: 'https://example.com/docs', repo_url: 'https://example.com/repo',
  release_feed_url: 'https://example.com/feed',
  children: 561, stories: 123456, recent: 12345,
  activity: 'hot', last_story: '2026-08-26',
  go_url: 'https://example.com/', go_state: 'ok', go_final: null,
  first_seen: '2018-12-06', last_seen: '2026-08-01',
  tracked: true, curated: false, origin: 'github_release', discovered_at: '2026-01-02',
};

const F: Filters = {
  kind: 'concept', search: '', categories: [], have: [], seen: 'any',
  origin: 'any', sort: 'activity', offset: 0,
};

// linkedom's nodes are not lib.dom's, so these stay untyped on purpose.
// linkedom's nodes are not lib.dom's, so these stay untyped on purpose.
function cells(): any[] {
  const html = registryRow(ROW, F, new Map(), new Map(), [], [], new Map());
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const summary = document.querySelector('summary');
  expect(summary, 'the row should render a summary').toBeTruthy();
  return [...summary!.children] as any[];
}

function heads(): any[] {
  const { document } = parseHTML(`<html><body>${registryHead(F)}</body></html>`);
  return [...document.querySelector('.reghead')!.children] as any[];
}

const kept = (els: any[]) => els.filter((e) => ![...e.classList].includes('nw'));

describe('the registry row grid', () => {
  it('declares one column for every cell it renders', () => {
    expect(template('wide').length).toBe(cells().length);
  });

  it('declares one column for every cell the narrow breakpoint keeps', () => {
    expect(template('narrow').length).toBe(kept(cells()).length);
  });

  it('gives the header exactly the cells the rows have, wide and narrow', () => {
    // The defect this whole file exists for is two lists disagreeing. A header
    // is a third list, so it gets pinned the same way.
    expect(heads().length).toBe(cells().length);
    expect(kept(heads()).length).toBe(kept(cells()).length);
  });

  it('never lets a counter wrap onto a second line', () => {
    // A hyphen is a break opportunity where a digit is not, so "18-12" broke
    // and "12,345" did not. Only nowrap covers both.
    const rule = /\.stackrec \.mini,\.stackrec \.num\{([^}]*)\}/.exec(CSS);
    expect(rule, 'the counter rule should exist').toBeTruthy();
    expect(rule![1]).toContain('white-space:nowrap');
  });

  it('sizes every counter column for its value and for its own name', () => {
    // Fixed pixels were the original bug: they were guesses, and four of the
    // five were short. Each width is now max(widest value, header word), both
    // derived from the type scale.
    const vars = template('wide').filter((t) => t.startsWith('var(--w-'));
    expect(vars.length).toBe(5);
    for (const v of vars) {
      const name = /var\((--w-[a-z0-9]+)\)/.exec(v)![1]!;
      const def = new RegExp(`${name}:(max\([^;]*\));`).exec(CSS);
      expect(def, `${name} should be a max() of two budgets`).toBeTruthy();
      expect(def![1], `${name} should follow the type scale`).toContain('--mch');
      expect(def![1], `${name} should leave room for its header`).toContain('--hch');
    }
  });
});

describe('the registry header', () => {
  it('names every column that carries a number', () => {
    const named = heads().map((h) => h.textContent.trim()).filter(Boolean);
    expect(named).toContain('Aliases');
    expect(named).toContain('Beneath');
    expect(named).toContain('30 days');
    expect(named).toContain('All time');
    expect(named).toContain('First');
  });

  it('explains every column it names', () => {
    for (const h of heads()) {
      if (!h.textContent.trim()) continue;
      expect(h.getAttribute('title'), `${h.textContent} should say what it means`)
        .toBeTruthy();
    }
  });

  it('sorts by the column you click, keeping the filters you already set', () => {
    const filtered: Filters = { ...F, kind: 'stack', search: 'db', categories: ['data'] };
    const { document } = parseHTML(
      `<html><body>${registryHead(filtered)}</body></html>`);
    const links = [...document.querySelectorAll('.reghead a')] as any[];
    expect(links.length).toBeGreaterThan(4);
    for (const a of links) {
      const href = a.getAttribute('href')!;
      expect(href, 'the search should survive a re-sort').toContain('sq=db');
      expect(href, 'the category should survive a re-sort').toContain('cat=data');
      expect(href, 'a re-sort should return to the first page').not.toContain('offset=');
    }
  });

  it('marks the column the list is actually ordered by, and only that one', () => {
    const { document } = parseHTML(
      `<html><body>${registryHead({ ...F, sort: 'stories' })}</body></html>`);
    const on = [...document.querySelectorAll('.reghead a.on')] as any[];
    expect(on.length).toBe(1);
    expect(on[0].textContent.trim()).toBe('All time');
    expect(document.querySelectorAll('.sortmark').length).toBe(1);
  });
});

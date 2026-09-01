// The live registry search, exercised against the real page it runs on.
//
// The script is a string embedded in the HTML, so nothing typechecks it and a
// stray escape once turned a `\n` inside it into a real newline and broke the
// parse. These tests run it the way a browser does: parse the served markup,
// give it a DOM, type into the box, and check the right URL was requested and
// the right region replaced.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { REGISTRY_JS } from '../src/ui/theme.ts';

/** A stand-in for the two states of the page: unfiltered, and filtered. */
function page(search: string, rows: string[], total: number): string {
  const pills = search
    ? `<div class="pills" id="regpills"><span class="pill on">matching <b>${search}</b></span></div>`
    : `<div class="pills" id="regpills" hidden></div>`;
  return `<html><body>
    <form method="get" action="/tools" class="regsearch" data-live="/tools">
      <div class="rs-box">
        <input type="search" name="sq" value="${search}">
        <a class="rs-clear" href="/tools"${search ? '' : ' hidden'}>x</a>
      </div>
      <select name="seen"><option value="any" selected>Everything</option>
        <option value="seen">Seen</option></select>
      <select name="sort"><option value="activity" selected>Active</option>
        <option value="name">A-Z</option></select>
      <button type="submit">Search</button>
    </form>
    <span class="hint" id="regcount">${total} matching</span>
    <div id="reglist">${rows.map((r) => `<div class="rec">${r}</div>`).join('')}</div>
    ${pills}
  </body></html>`;
}

const ALL = ['Git', 'GitHub', 'Prettier', 'Figma'];
const GIT = ['Git', 'GitHub', 'GitHub Actions'];

let win: any;
let asked: string[];

function boot(html: string) {
  const dom = parseHTML(html);
  win = dom.window;
  asked = [];

  win.fetch = vi.fn((url: string) => {
    asked.push(url);
    const term = new URL(url, 'http://x').searchParams.get('sq') ?? '';
    const rows = term ? GIT : ALL;
    return Promise.resolve({ ok: true, text: () => Promise.resolve(page(term, rows, rows.length)) });
  });
  win.DOMParser = dom.DOMParser;
  win.URLSearchParams = URLSearchParams;
  win.FormData = class {
    #f: any;
    constructor(form: any) { this.#f = form; }
    * [Symbol.iterator]() {
      for (const el of this.#f.querySelectorAll('input[name],select[name]')) {
        yield [el.getAttribute('name'), el.value ?? ''];
      }
    }
  };
  win.history = { replaceState: vi.fn() };
  win.AbortController = class { signal = {}; abort() {} };
  win.setTimeout = (fn: () => void) => { fn(); return 0; };
  win.clearTimeout = () => {};

  new Function('window', 'document', 'URLSearchParams', 'FormData', 'AbortController',
    'setTimeout', 'clearTimeout', 'history', 'fetch', REGISTRY_JS)(
    win, win.document, URLSearchParams, win.FormData, win.AbortController,
    win.setTimeout, win.clearTimeout, win.history, win.fetch);

  return win.document;
}

async function type(doc: any, value: string) {
  const box = doc.querySelector('input[name=sq]');
  box.value = value;
  box.dispatchEvent(new win.Event('input', { bubbles: true }));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('live registry search', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('parses as a script at all', () => {
    expect(() => new Function(REGISTRY_JS)).not.toThrow();
  });

  it('queries the server when you type, instead of hiding rendered rows', async () => {
    const doc = boot(page('', ALL, 4));
    await type(doc, 'git');
    // The point of going to the server: only one page of rows is ever rendered,
    // so filtering what is on screen would search 100 of 1,361 entries.
    expect(asked).toEqual(['/tools?sq=git']);
  });

  it('replaces the list, the count and the pills', async () => {
    const doc = boot(page('', ALL, 4));
    expect(doc.querySelectorAll('#reglist .rec').length).toBe(4);

    await type(doc, 'git');

    expect(doc.querySelectorAll('#reglist .rec').length).toBe(3);
    expect(doc.getElementById('regcount').textContent).toContain('3 matching');
    expect(doc.getElementById('regpills').textContent).toContain('git');
  });

  it('stays inside the registry it was opened on', async () => {
    const doc = boot(page('', ALL, 4));
    await type(doc, 'git');
    expect(asked[0]!.startsWith('/tools')).toBe(true);
  });

  it('keeps the address bar in step, so reload and share still work', async () => {
    const doc = boot(page('', ALL, 4));
    await type(doc, 'git');
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/tools?sq=git');
  });

  it('does not drop a search for a word that matches a control default', async () => {
    // "any" is the default of the Coverage select and a real thing to type.
    const doc = boot(page('', ALL, 4));
    await type(doc, 'any');
    expect(asked).toEqual(['/tools?sq=any']);
  });

  it('omits untouched controls from the URL', async () => {
    const doc = boot(page('', ALL, 4));
    await type(doc, 'git');
    expect(asked[0]).not.toContain('seen=');
    expect(asked[0]).not.toContain('sort=');
  });

  it('carries a changed control along with the search', async () => {
    const doc = boot(page('', ALL, 4));
    const box = doc.querySelector('input[name=sq]');
    box.value = 'git';
    // linkedom's select.value is read-only, so move the selection itself.
    const sort = doc.querySelector('select[name=sort]');
    sort.querySelector('option[value=activity]').removeAttribute('selected');
    sort.querySelector('option[value=name]').setAttribute('selected', '');
    sort.dispatchEvent(new win.Event('change', { bubbles: true }));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(asked[0]).toContain('sq=git');
    expect(asked[0]).toContain('sort=name');
  });

  it('does not re-query when the term has not actually changed', async () => {
    const doc = boot(page('', ALL, 4));
    await type(doc, 'git');
    await type(doc, 'git');
    expect(asked.length).toBe(1);
  });

  it('shows and hides the clear button with the text', async () => {
    const doc = boot(page('', ALL, 4));
    expect(doc.querySelector('.rs-clear').hasAttribute('hidden')).toBe(true);
    await type(doc, 'git');
    expect(doc.querySelector('.rs-clear').hasAttribute('hidden')).toBe(false);
  });

  it('clearing goes back to the unfiltered list without leaving the page', async () => {
    const doc = boot(page('', ALL, 4));
    await type(doc, 'git');
    expect(doc.querySelectorAll('#reglist .rec').length).toBe(3);

    doc.querySelector('.rs-clear').dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(asked[asked.length - 1]).toBe('/tools');
    expect(doc.querySelectorAll('#reglist .rec').length).toBe(4);
  });
});

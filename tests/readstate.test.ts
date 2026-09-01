// Marking a story read.
//
// The third per-story state, and deliberately the weakest of the three:
//
//   favourite   keep this, exempt it from retention
//   delete      I do not want this, take it out of every list
//   read        I have seen this
//
// The risk in this feature is conflating the last two. "I read that" is not "I
// do not want that", and a read mark that hides a story is a soft delete
// wearing a friendlier name -- so most of these tests are about the mark NOT
// hiding anything.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildWhere, parseFilters } from '../src/ui/filters.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const where = (qs = '') => buildWhere(parseFilters(new URL(`http://x/all${qs}`))).sql;

describe('a read story', () => {
  it('is still shown, by default, in place', () => {
    // The whole point. Dismissal has a clause here; reading must not.
    expect(where()).not.toContain('read_at');
  });

  it('is still shown under every other filter', () => {
    for (const qs of ['?stack=rust', '?field=security', '?about=tool', '?sort=oldest']) {
      expect(where(qs), `${qs} must not hide read stories`).not.toContain('read_at');
    }
  });

  it('is hidden only when the reader asks for unread', () => {
    expect(where('?unread=1')).toContain('s.read_at IS NULL');
  });

  it('is not hidden by any other value of the parameter', () => {
    // `unread=0`, `unread=yes`, `unread=` are all "no". One spelling means on.
    for (const qs of ['?unread=0', '?unread=', '?unread=true', '?unread=yes']) {
      expect(where(qs), `${qs} should not filter`).not.toContain('read_at');
    }
  });

  it('still disappears when deleted, because that is a different question', () => {
    expect(where('?unread=1')).toContain('s.dismissed_at IS NULL');
  });
});

describe('the unread filter', () => {
  it('survives a round trip through the URL', () => {
    const f = parseFilters(new URL('http://x/all?unread=1&stack=rust'));
    expect(f.unread).toBe(true);
    expect(f.stack).toEqual(['rust']);
  });

  it('is off unless asked for', () => {
    // A reader arriving at a filtered page expects the filter they chose.
    expect(parseFilters(new URL('http://x/all')).unread).toBe(false);
  });
});

describe('the read mark itself', () => {
  const src = read('../src/ui/readstate.ts');

  it('keeps the moment it was first read', () => {
    // coalesce, not now(): re-opening something must not rewrite when it was
    // read, which is the only thing the column records.
    expect(src).toContain('coalesce(read_at, now())');
  });

  it('can be undone', () => {
    expect(src).toContain('read_at = NULL');
  });

  it('checks the id before it writes', () => {
    expect(src).toContain("throw new Error('not a story id')");
  });

  it('does not count deleted or superseded stories as unread', () => {
    // An unread badge that includes things the reader has already thrown away
    // is a number nobody can ever clear.
    const counter = src.slice(src.indexOf('export async function unreadCount'));
    expect(counter).toContain('dismissed_at IS NULL');
    expect(counter).toContain('superseded_by IS NULL');
  });
});

describe('the routes', () => {
  const server = read('../src/ui/server.ts');

  it('are POST, because they change something', () => {
    expect(server).toContain("req.method === 'POST' && path === '/read-state'");
    expect(server).toContain("req.method === 'POST' && path === '/read-all'");
  });

  it('refuse a return path that points off this site', () => {
    const at = server.indexOf("path === '/read-state'");
    expect(server.slice(at, at + 900)).toContain("back.startsWith('/') && !back.startsWith('//')");
  });
});

describe('opening an article', () => {
  it('marks it read on the way to rendering it', () => {
    // A button you must press after reading is a button nobody presses. The
    // cost is a state change on a GET, which the manual toggle undoes.
    expect(read('../src/ui/read.ts')).toContain('markRead(id)');
  });
});

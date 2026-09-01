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
// Read state belongs to an account since 0070, so the builder needs one.
const ACCOUNT = '11111111-2222-3333-4444-555555555555';
const where = (qs = '') =>
  buildWhere(parseFilters(new URL(`http://x/all${qs}`)), ACCOUNT).sql;

describe('a read story', () => {
  it('is still shown, by default, in place', () => {
    // The whole point. Dismissal has a clause here; reading must not.
    expect(where()).not.toContain('story_reads');
  });

  it('is still shown under every other filter', () => {
    for (const qs of ['?stack=rust', '?field=security', '?about=tool', '?sort=oldest']) {
      expect(where(qs), `${qs} must not hide read stories`).not.toContain('story_reads');
    }
  });

  it('is hidden only when the reader asks for unread', () => {
    // And it is THIS reader's unread, not the installation's. Before 0070 the
    // clause was `s.read_at IS NULL` against a single global timestamp, so one
    // person opening an article marked it read for everybody.
    expect(where('?unread=1')).toContain('story_reads');
    expect(where('?unread=1')).toContain('NOT EXISTS');
    expect(where('?unread=1')).toContain('r.account_id');
  });

  it('drops the filter rather than guessing when nobody is signed in', () => {
    // Showing everything is wrong in a way somebody notices. Showing another
    // account's unread list is wrong in a way nobody does.
    const anon = buildWhere(parseFilters(new URL('http://x/all?unread=1'))).sql;
    expect(anon).not.toContain('story_reads');
  });

  it('is not hidden by any other value of the parameter', () => {
    // `unread=0`, `unread=yes`, `unread=` are all "no". One spelling means on.
    for (const qs of ['?unread=0', '?unread=', '?unread=true', '?unread=yes']) {
      expect(where(qs), `${qs} should not filter`).not.toContain('story_reads');
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
    // The rule is unchanged and the mechanism is not. It used to be
    // `coalesce(read_at, now())` on a column; it is now ON CONFLICT DO NOTHING
    // on a row, which preserves the first read for the same reason: re-opening
    // something must not rewrite when it was read.
    expect(src).toContain('ON CONFLICT DO NOTHING');
    expect(src).not.toContain('UPDATE stories SET read_at');
  });

  it('can be undone', () => {
    expect(src).toMatch(/DELETE FROM story_reads[\s\S]{0,120}account_id/);
  });

  it('never writes read state without knowing whose it is', () => {
    // The defect this replaced: one timestamp per story meant opening an
    // article marked it read for every account that would ever exist. An
    // account argument that could be omitted would bring that straight back.
    for (const fn of ['readState', 'setRead', 'markRead', 'unreadCount', 'markAllRead']) {
      expect(src, `${fn} must take an account`).toContain(`function ${fn}(accountId`);
    }
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
    expect(read('../src/ui/read.ts')).toContain('markRead(accountId, id)');
  });
});

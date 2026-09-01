// Deleting a story.
//
// The word is "delete" and the operation is not one, and that gap is where the
// bugs would be. The row has to stay -- every aggregate in this archive is
// derived from stories and a settled month is never recomputed -- while
// disappearing from every list at once. So the two things worth pinning are
// that nothing anywhere issues a DELETE, and that the reader's base filter
// excludes dismissed rows so a new page cannot forget to.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildWhere } from '../src/ui/filters.ts';
import { parseFilters } from '../src/ui/filters.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('a deleted story', () => {
  it('is excluded by the reader’s base filter, so every list inherits it', () => {
    // Not by each page remembering. buildWhere is the one place that decides
    // what the reader can see, which is why superseded and off-topic live here
    // too.
    const { sql } = buildWhere(parseFilters(new URL('http://x/all')));
    expect(sql).toContain('s.dismissed_at IS NULL');
  });

  it('is excluded no matter what else was asked for', () => {
    for (const q of ['?stack=rust', '?field=security&sort=oldest', '?about=tool', '?q=db']) {
      const { sql } = buildWhere(parseFilters(new URL(`http://x/all${q}`)));
      expect(sql, `${q} should still hide deleted stories`).toContain('s.dismissed_at IS NULL');
    }
  });
});

describe('the delete path', () => {
  const dismiss = read('../src/ui/dismiss.ts');

  it('never issues a DELETE', () => {
    // The whole design. If this ever fails, the rollups are about to start
    // counting stories that are not there.
    expect(/\bDELETE\s+FROM\b/i.test(dismiss)).toBe(false);
  });

  it('is reversible', () => {
    expect(dismiss).toContain('dismissed_at = NULL');
  });

  it('releases a favourite on the way out', () => {
    // Keeping a story and deleting it are contradictory, and the newer
    // instruction wins. Leaving it starred on a shelf the reader cannot reach
    // is the worse of the two outcomes.
    expect(dismiss).toContain('UPDATE favourites SET unfavourited_at = now()');
  });

  it('checks the id before it writes', () => {
    expect(dismiss).toContain("throw new Error('not a story id')");
  });

  it('truncates a reason rather than trusting its length', () => {
    expect(dismiss).toContain('slice(0, 500)');
  });
});

describe('the route', () => {
  const server = read('../src/ui/server.ts');

  it('is POST only, because it changes something', () => {
    expect(server).toContain("req.method === 'POST' && path === '/dismiss'");
    expect(server).toContain("req.method === 'POST' && path === '/api/dismiss'");
  });

  it('refuses a return path that points off this site', () => {
    // Same rule as the star and the theme toggle: a redirect target taken from
    // a form field is an open redirect unless it is checked.
    const at = server.indexOf("path === '/dismiss'");
    const after = server.slice(at, at + 1200);
    expect(after).toContain("back.startsWith('/') && !back.startsWith('//')");
  });

  it('validates the id before touching the database', () => {
    const at = server.indexOf("path === '/dismiss'");
    const after = server.slice(at, at + 1200);
    expect(after).toContain('/^[0-9a-f-]{36}$/i.test(id)');
  });
});

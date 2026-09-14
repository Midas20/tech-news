// What changes when the port stops being loopback.
//
// Asked for on 2026-08-31: run the project on 162.246.23.43:3000. Two facts
// made that more than a configuration change, and both are tested here rather than
// discovered later:
//
//   1. The reader has NO login. There is no session and SESSION_SECRET is not
//      referenced anywhere in src/. Fine for a tool on loopback; on a public
//      bind it means anyone who finds the port can call /dismiss.
//
//   2. /admin runs on the database owner connection, which bypasses row-level
//      security by design.
//
// Both guards are pure functions so every combination can be checked here. The
// alternative is binding a public port and trying it, and "we tried it once and
// it seemed fine" is not the standard a control like this should be held to.

import { describe, it, expect } from 'vitest';
import { adminDecision, isLoopback, writeDecision } from '../src/ui/server.ts';
import { isPublicPath, mayView } from '../src/ui/auth.ts';

describe('recognising the machine itself', () => {
  it('accepts the loopback addresses Node actually reports', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    // A v4 loopback connection on a dual-stack listener arrives mapped.
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  });

  it('refuses everything else, including the public address it is bound to', () => {
    expect(isLoopback('162.246.23.43')).toBe(false);
    expect(isLoopback('::ffff:162.246.23.43')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
    expect(isLoopback('')).toBe(false);
    // The one that matters: a hostile client cannot simply say it is local.
    expect(isLoopback('127.0.0.1.evil.com')).toBe(false);
  });
});

describe('writes need an account, and shared state needs an administrator', () => {
  // This replaced a loopback test. The old rule -- "writes only from the
  // machine itself" -- was the best available when there was no login, and it
  // had a visible cost: the theme toggle posts a form, so on both deployed
  // sites it answered 403 and looked like a broken button.
  const anon = (m: string, p: string) => writeDecision(null, m, p);
  const user = (m: string, p: string) => writeDecision('user', m, p);
  const admin = (m: string, p: string) => writeDecision('admin', m, p);

  it('lets anybody read', () => {
    expect(anon('GET', '/')).toBeNull();
    expect(anon('GET', '/dismiss')).toBeNull();
    expect(user('HEAD', '/sources/intel')).toBeNull();
  });

  it('refuses every write with no session', () => {
    for (const path of ['/stacks', '/settings', '/favourite', '/read-state',
      '/read-all', '/dismiss', '/api/dismiss', '/api/favourite', '/me/theme']) {
      expect(anon('POST', path), `${path} must be refused`).toBeTruthy();
    }
  });

  it('lets a reader keep their own reading', () => {
    // The star returned 403 with "that changes something everybody sees",
    // which was true of the schema and false of the act: favourites had
    // PRIMARY KEY (story_id) and read_at was one timestamp. 0070 gave both an
    // owner; these are now nobody else's business.
    for (const path of ['/me/fields', '/me/theme', '/favourite', '/api/favourite',
      '/read-state', '/read-all']) {
      expect(user('POST', path), `${path} is personal`).toBeNull();
    }
  });

  it('still keeps a reader out of what changes the archive', () => {
    // Dismissing is moderation -- it removes a story from EVERY reader, which
    // is how eleven linkblog items were taken out at once. Settings and
    // vocabulary are installation-wide.
    for (const path of ['/settings', '/stacks', '/dismiss', '/api/dismiss']) {
      expect(user('POST', path), `${path} is shared state`).toBeTruthy();
    }
  });

  it('lets an administrator do all of it', () => {
    for (const path of ['/settings', '/stacks', '/dismiss', '/me/fields', '/api/favourite']) {
      expect(admin('POST', path), `${path} must be allowed`).toBeNull();
    }
  });

  it('tells a reader where their own settings are', () => {
    expect(user('POST', '/settings')).toMatch(/\/me/);
    expect(anon('POST', '/settings')).toMatch(/sign in/i);
  });
});

describe('what may be reached without signing in', () => {
  it('opens only the pages that exist to get you an account', () => {
    for (const p of ['/login', '/signup', '/logout', '/healthz']) {
      expect(isPublicPath(p), `${p} must be reachable`).toBe(true);
    }
    // Assets, or the login page has no stylesheet.
    expect(isPublicPath('/a/app.abc123.css')).toBe(true);
  });

  it('closes everything else, including anything added later', () => {
    // The list names what is OPEN. A route added tomorrow is protected by
    // default, and forgetting to list it shows up as a redirect to the login
    // page rather than as an exposure.
    for (const p of ['/', '/all', '/admin', '/settings', '/sources', '/me', '/reports']) {
      expect(isPublicPath(p), `${p} must be closed`).toBe(false);
    }
  });

  it('keeps a reader out of the admin surface on GET, not only on write', () => {
    // Without the GET check a reader could navigate to /admin and read every
    // tenant's rows off the owner connection.
    expect(mayView('user', '/admin')).toBe(false);
    expect(mayView('user', '/admin/t/stories')).toBe(false);
    expect(mayView('user', '/settings')).toBe(false);
    expect(mayView(null, '/')).toBe(false);
    expect(mayView('user', '/')).toBe(true);
    expect(mayView('user', '/sources/intel')).toBe(true);
    expect(mayView('admin', '/admin')).toBe(true);
    // "report page is visible to only admin" (2026-09-13): every report
    // surface, while a field's own river stays readable.
    for (const p of ['/reports', '/reports/month/2026-09', '/reports/2026-09-13',
      '/reports/periods', '/work', '/market', '/trends/report', '/field/ai/report',
      '/field/ai/report/2026-09-13', '/field/ai/report/2026-09-13/work/1']) {
      expect(mayView('user', p), p).toBe(false);
      expect(mayView('admin', p), p).toBe(true);
    }
    expect(mayView('user', '/field/ai')).toBe(true);
    expect(mayView('user', '/field/reporting')).toBe(true);
  });
});

describe('the owner connection never reaches the internet', () => {
  it('serves no admin at all on a public bind without a token', () => {
    expect(adminDecision(true, '', '')).toBeTruthy();
    expect(adminDecision(true, '', 'anything')).toBeTruthy();
  });

  it('requires the right token when one is set', () => {
    expect(adminDecision(true, 'secret', '')).toBeTruthy();
    expect(adminDecision(true, 'secret', 'wrong')).toBeTruthy();
    expect(adminDecision(true, 'secret', 'secret')).toBeNull();
  });

  it('leaves loopback alone', () => {
    expect(adminDecision(false, '', '')).toBeNull();
  });
});

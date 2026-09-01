// Passwords and sessions.
//
// The two places in this codebase where a bug is completely silent: a hash that
// always verifies and a signature that is never checked both look exactly like
// a working login until somebody tries the thing they were supposed to stop.
// So every negative case here is asserted directly rather than implied.

import { describe, it, expect, beforeAll } from 'vitest';
import {
  hashPassword, verifyPassword, issueSession, readSession, cookieFrom,
  validateSignup, safeEqual, sessionCookie, isSecureRequest, needsRehash,
} from '../src/ui/auth.ts';

beforeAll(() => { process.env.SESSION_SECRET ??= 'test-secret-that-is-long-enough'; });

describe('passwords', () => {
  it('verifies the right one and refuses the wrong one', async () => {
    const stored = await hashPassword('Password@026');
    expect(await verifyPassword('Password@026', stored)).toBe(true);
    expect(await verifyPassword('password@026', stored)).toBe(false);
    expect(await verifyPassword('Password@0266', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('never stores the password, and never the same hash twice', async () => {
    const a = await hashPassword('Password@026');
    const b = await hashPassword('Password@026');
    expect(a).not.toContain('Password@026');
    // Different salts, or the hash is a lookup table for whoever gets the dump.
    expect(a).not.toBe(b);
    expect(await verifyPassword('Password@026', b)).toBe(true);
  });

  it('stays inside the ceiling the stricter runtime enforces', async () => {
    // Cloudflare Workers refuses PBKDF2 above 100,000 iterations:
    //   "Pbkdf2 failed: iteration counts above 100000 are not supported"
    // Both runtimes read one database, so a hash written on the host has to
    // verify on the edge, which means one count for both -- the most the
    // stricter allows. Below OWASP's 210,000, and forced.
    const [scheme, algo, iters] = (await hashPassword('x')).split('$');
    expect(scheme).toBe('pbkdf2');
    expect(algo).toBe('sha256');
    expect(Number(iters)).toBeLessThanOrEqual(100_000);
    expect(Number(iters)).toBeGreaterThanOrEqual(100_000);
  });

  it('marks a hash written under other parameters for upgrade', async () => {
    // The accounts created before the ceiling was discovered carry 210,000 and
    // cannot verify on the edge at all. They are re-hashed the next time their
    // owner signs in, which is the only moment the plaintext exists.
    expect(needsRehash(await hashPassword('x'))).toBe(false);
    expect(needsRehash('pbkdf2$sha256$210000$abc$def')).toBe(true);
    expect(needsRehash('pbkdf2$sha512$100000$abc$def')).toBe(true);
    expect(needsRehash('bcrypt$2b$12$abc')).toBe(true);
  });

  it('refuses a malformed hash instead of throwing', async () => {
    // A corrupt row should fail the login, not take the page down.
    for (const bad of ['', 'x', 'bcrypt$2b$12$abc', 'pbkdf2$sha256$notanumber$a$b',
      'pbkdf2$sha512$210000$a$b', 'pbkdf2$sha256$1$a$b']) {
      expect(await verifyPassword('anything', bad), bad).toBe(false);
    }
  });
});

describe('sessions', () => {
  it('round-trips the account it was issued for', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(await readSession(await issueSession(id))).toBe(id);
  });

  it('refuses a cookie that was edited', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const token = await issueSession(id);
    const [, expires, mac] = token.split('.');

    // Somebody else's account id, same signature.
    expect(await readSession(`99999999-2222-3333-4444-555555555555.${expires}.${mac}`)).toBeNull();
    // A later expiry, same signature.
    expect(await readSession(`${id}.${Date.now() + 9e9}.${mac}`)).toBeNull();
    // No signature at all.
    expect(await readSession(`${id}.${expires}.`)).toBeNull();
    expect(await readSession(`${id}.${expires}`)).toBeNull();
  });

  it('refuses an expired cookie even though the signature is good', async () => {
    // Expiry is checked before the signature is trusted, so a valid old cookie
    // is still refused.
    const id = '11111111-2222-3333-4444-555555555555';
    const token = await issueSession(id);
    const [, , mac] = token.split('.');
    expect(await readSession(`${id}.${Date.now() - 1000}.${mac}`)).toBeNull();
  });

  it('refuses nothing at all', async () => {
    expect(await readSession(undefined)).toBeNull();
    expect(await readSession('')).toBeNull();
  });

  it('sets a cookie a script cannot read', () => {
    const c = sessionCookie('abc', 3600, true);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Secure');
  });

  it('omits Secure over plain http, or the login simply does not work', () => {
    // A browser silently discards a Secure cookie received over http, so
    // setting it unconditionally turned signing in at http://162.246.23.43:3000
    // into a form that posts, redirects, and lands back on the login page with
    // no error anywhere. curl stores it either way, which is why this needed
    // reasoning rather than a request to test it against.
    expect(sessionCookie('abc', 3600, false)).not.toContain('Secure');
    expect(sessionCookie('abc', 3600, false)).toContain('HttpOnly');
  });

  it('reads the scheme from a proxy header when there is one', () => {
    const u = new URL('http://example.com/');
    expect(isSecureRequest(u, {})).toBe(false);
    expect(isSecureRequest(u, { 'x-forwarded-proto': 'https' })).toBe(true);
    expect(isSecureRequest(u, { 'x-forwarded-proto': 'https, http' })).toBe(true);
    expect(isSecureRequest(new URL('https://example.com/'), {})).toBe(true);
  });
});

describe('reading a cookie header', () => {
  it('finds the one it wants among others', () => {
    expect(cookieFrom('a=1; nt_session=xyz; b=2', 'nt_session')).toBe('xyz');
    expect(cookieFrom('nt_session=xyz', 'nt_session')).toBe('xyz');
    // A value containing '=' survives, because base64 pads with it.
    expect(cookieFrom('nt_session=a.b.c==', 'nt_session')).toBe('a.b.c==');
    expect(cookieFrom('other=1', 'nt_session')).toBeUndefined();
    expect(cookieFrom(undefined, 'nt_session')).toBeUndefined();
  });

  it('does not match a name that merely ends the same way', () => {
    expect(cookieFrom('evil_nt_session=zzz', 'nt_session')).toBeUndefined();
  });
});

describe('signing up', () => {
  it('accepts a username and password with no email at all', () => {
    // Asked for explicitly: "signup with only username and password, the email
    // feature is optional".
    expect(validateSignup('reader', 'longenough', '')).toEqual([]);
  });

  it('checks an email only when one was typed', () => {
    expect(validateSignup('reader', 'longenough', 'a@b.co')).toEqual([]);
    expect(validateSignup('reader', 'longenough', 'nonsense')).toHaveLength(1);
  });

  it('refuses a username that could be mistaken for another', () => {
    for (const bad of ['ab', '', 'has space', 'e/vil', 'a'.repeat(33), '<script>']) {
      expect(validateSignup(bad, 'longenough', ''), bad).not.toEqual([]);
    }
  });

  it('sets a length floor on the password and nothing baroque', () => {
    // The expensive hash is doing the real work; a rule nobody can satisfy
    // without a password manager produces passwords on sticky notes.
    expect(validateSignup('reader', 'short', '')).toHaveLength(1);
    expect(validateSignup('reader', '8charact', '')).toEqual([]);
  });
});

describe('constant-time comparison', () => {
  it('agrees with ===, which is all it may differ from', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

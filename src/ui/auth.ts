// Who is asking, and what they are allowed to do about it.
//
// WEBCRYPTO THROUGHOUT, AND THAT IS THE CONSTRAINT THAT SHAPED THIS FILE.
// bcrypt, argon2 and scrypt-via-node:crypto are the obvious choices and none of
// them survives the trip: the first two are native modules, and this code has to
// run unchanged in a Cloudflare Worker as well as in Node. `crypto.subtle` is
// the one primitive both runtimes have, so passwords are PBKDF2-SHA256 and
// sessions are HMAC-SHA256, and neither needs a dependency.
//
// PBKDF2 is weaker per unit of work than argon2 -- it is cheap to attack on a
// GPU -- so the iteration count matters, and it is NOT the number this file
// wanted. OWASP recommends 210,000 for PBKDF2-SHA256. Cloudflare Workers
// refuses it:
//
//   Pbkdf2 failed: iteration counts above 100000 are not supported (requested 210000)
//
// which is a platform ceiling, not a preference. Both runtimes read and write
// one database, so a hash made on the host has to verify on the edge and the
// count cannot differ between them: 100,000 everywhere, which is the most the
// stricter of the two allows.
//
// The count is stored inside every hash, so raising it later costs nothing but
// a deploy -- and `needsRehash` below quietly upgrades an account the next time
// its owner signs in, which is how the 210,000 hashes written before this was
// discovered get migrated without anybody being locked out.
//
// SESSIONS ARE A SIGNED COOKIE, not a table. A Worker pays a round trip for
// every query, the account has to be loaded anyway to know its role and fields,
// and a stateless cookie means one query instead of two. The cost is that
// signing out cannot revoke a cookie that has already been issued; it expires
// instead, and that is written down here rather than discovered later.

import { q } from './db.ts';

export type Role = 'admin' | 'user';

export interface Account {
  id: string;
  username: string;
  email: string | null;
  role: Role;
  fields: string[];
  theme: 'auto' | 'dark' | 'light';
}

const ITERATIONS = 100_000;
const SESSION_HOURS = 24 * 14;
export const COOKIE = 'nt_session';

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Constant-time. A comparison that returns early leaks the answer one byte at a time. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$sha256$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

/**
 * Verify against a stored hash, reading the parameters back out of it.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row should
 * refuse the login, not take the page down.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, algo, iters, salt, hash] = stored.split('$');
    if (scheme !== 'pbkdf2' || algo !== 'sha256') return false;
    const n = Number(iters);
    if (!Number.isInteger(n) || n < 1000 || n > 5_000_000) return false;
    const computed = await pbkdf2(password, unb64(salt!), n);
    return safeEqual(b64(computed), hash!);
  } catch (err) {
    // A swallowed failure here is indistinguishable from a wrong password, and
    // that is exactly how a working login looks when the runtime refuses the
    // hash: the deployed site answered 401 for a password that was correct.
    // Refuse, but say why somewhere a human can read it.
    console.error(`verifyPassword failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Should this stored hash be replaced?
 *
 * True when it was written with a different cost than the one in force. Called
 * after a SUCCESSFUL verification -- the plaintext is in hand exactly once, at
 * that moment, and never again -- so an account written under the old
 * parameters is upgraded the next time its owner signs in.
 */
export function needsRehash(stored: string): boolean {
  const [scheme, algo, iters] = stored.split('$');
  return scheme !== 'pbkdf2' || algo !== 'sha256' || Number(iters) !== ITERATIONS;
}

// ---------------------------------------------------------------------------
// Sessions

function secret(): string {
  const s = process.env.SESSION_SECRET;
  // Refuse rather than fall back to a default. A signing key with a known
  // value is the same as no signing key, and it would fail silently -- every
  // cookie would verify, for everybody.
  if (!s || s.length < 16) throw new Error('SESSION_SECRET is not set (or is too short to sign with)');
  return s;
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64(new Uint8Array(mac)).replace(/=+$/, '');
}

export async function issueSession(accountId: string): Promise<string> {
  const expires = Date.now() + SESSION_HOURS * 3600_000;
  const payload = `${accountId}.${expires}`;
  return `${payload}.${await sign(payload)}`;
}

/** The account id a cookie proves, or null. Expiry is checked before the signature is trusted. */
export async function readSession(cookie: string | undefined): Promise<string | null> {
  if (!cookie) return null;
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;
  const [id, expires, mac] = parts as [string, string, string];
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  if (!safeEqual(await sign(`${id}.${expires}`), mac)) return null;
  return id;
}

export function cookieFrom(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}

/**
 * HttpOnly, SameSite=Lax, and Secure ONLY WHEN THE REQUEST WAS.
 *
 * The first version set `Secure` unconditionally, reasoning that a session
 * cookie in the clear is a session anybody on the path can take. True, and it
 * made the feature not work: a browser silently discards a Secure cookie
 * received over plain http, so signing in at http://162.246.23.43:3000 would
 * have posted the form, been redirected, and landed back on the login page
 * with no error anywhere. curl stores it regardless, which is exactly why this
 * had to be reasoned about rather than tested away.
 *
 * So it follows the connection. Over https -- the edge deployment, and any
 * proxy that terminates TLS -- the flag is set. Over http it is not, because
 * on that origin the alternative is not "more secure", it is "no login".
 */
export function sessionCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax;${
    secure ? ' Secure;' : ''} Max-Age=${maxAgeSeconds}`;
}

/**
 * Was this request encrypted?
 *
 * `x-forwarded-proto` is a claim made by whatever is in front, and there is
 * nothing in front of either deployment today -- but a Worker request always
 * arrives as https, and that is read from the URL rather than a header.
 */
export function isSecureRequest(url: URL, headers: Record<string, unknown>): boolean {
  const forwarded = String(headers['x-forwarded-proto'] ?? '').split(',')[0]!.trim();
  if (forwarded) return forwarded === 'https';
  return url.protocol === 'https:';
}

// ---------------------------------------------------------------------------
// Accounts

const SELECT_ACCOUNT = `SELECT id::text, username, email, role::text AS role, fields, theme
                          FROM accounts`;

export async function accountById(id: string): Promise<Account | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await q<Account>(`${SELECT_ACCOUNT} WHERE id = $1::uuid`, [id]);
  return rows[0] ?? null;
}

export async function accountByUsername(username: string): Promise<(Account & { password_hash: string }) | null> {
  const rows = await q<Account & { password_hash: string }>(
    `${SELECT_ACCOUNT.replace('FROM accounts', ', password_hash FROM accounts')}
      WHERE lower(username) = lower($1)`, [username]);
  return rows[0] ?? null;
}

export interface SignupProblem { field: 'username' | 'email' | 'password'; message: string }

/**
 * What a new account must satisfy.
 *
 * Deliberately modest. A rule nobody can satisfy without a password manager
 * produces passwords on sticky notes, and the expensive hash above is doing the
 * real work. Length is the requirement that matters.
 */
export function validateSignup(
  username: string, password: string, email: string,
): SignupProblem[] {
  const problems: SignupProblem[] = [];
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    problems.push({ field: 'username',
      message: '3 to 32 characters, using letters, digits, dot, dash or underscore.' });
  }
  if (password.length < 8) {
    problems.push({ field: 'password', message: 'At least 8 characters.' });
  }
  if (password.length > 512) {
    problems.push({ field: 'password', message: 'At most 512 characters.' });
  }
  // Optional means optional: an empty address is not an error. It is only
  // checked when something was actually typed.
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    problems.push({ field: 'email', message: 'That does not look like an email address.' });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Authorisation

/**
 * ROUTES ANYONE MAY REACH WITHOUT A SESSION.
 *
 * Everything not on this list requires one. Listing what is open, rather than
 * what is closed, is the direction that fails safe: a route added tomorrow is
 * protected by default, and forgetting to add something here shows up as a
 * redirect to the login page rather than as an exposure.
 */
const PUBLIC_PATHS = new Set(['/login', '/signup', '/logout', '/healthz']);

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path) || path.startsWith('/a/');
}

/**
 * WHAT A COMMON USER MAY CHANGE: their own two preferences and nothing else.
 *
 * Asked for as "for common user, only set his focus fields, and admin can
 * access to all features" -- read strictly, and the star proved it too strict:
 * saving an article is not a feature of the installation, it is the reader
 * keeping their own note.
 *
 * What stays admin-only is what genuinely changes the archive for everybody:
 * the settings page, vocabulary decisions, and DISMISSING a story -- which is
 * moderation, and is how eleven linkblog items were removed from everyone's
 * reader at once.
 *
 * Reading is not restricted by role. A common user sees the archive; they just
 * cannot change it for everyone else.
 */
const SELF_SERVICE = new Set([
  '/me/fields', '/me/theme',
  // READING IS PERSONAL, and it took a 403 on the star to notice.
  //
  // These were classified as shared state, which was accurate about the
  // SCHEMA and wrong about the act: `favourites` had PRIMARY KEY (story_id)
  // and `stories.read_at` was one timestamp, so a reader saving an article
  // really would have saved it for everybody. Migration 0070 gave both an
  // owner, and with an owner they are nobody else's business.
  '/favourite', '/api/favourite', '/read-state', '/read-all',
]);

export function mayWrite(role: Role | null, path: string): boolean {
  if (!role) return false;
  if (role === 'admin') return true;
  return SELF_SERVICE.has(path);
}

/** Admin-only surfaces, checked on GET as well as on write. */
export function mayView(role: Role | null, path: string): boolean {
  if (!role) return false;
  if (role === 'admin') return true;
  if (path.startsWith('/admin')) return false;
  // The settings page edits installation-wide configuration. A common user has
  // /me for the parts that are theirs.
  if (path === '/settings') return false;
  return true;
}

/**
 * The default administrator.
 *
 * Created once, on startup, and only when the table holds no admin at all --
 * so it cannot resurrect an account somebody deliberately changed or removed,
 * and running it twice does nothing. The password is the one that was asked
 * for; it is a known value in a public repository's history and should be
 * changed on first login, which the sign-in page says out loud.
 */
export async function ensureDefaultAdmin(
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>,
): Promise<'created' | 'exists'> {
  const existing = await query(`SELECT 1 FROM accounts WHERE role = 'admin' LIMIT 1`);
  if (existing.length) return 'exists';
  const hash = await hashPassword('Password@026');
  await query(
    `INSERT INTO accounts (username, password_hash, role, fields, theme)
     VALUES ('admin', $1, 'admin', '{}', 'dark')
     ON CONFLICT DO NOTHING`, [hash]);
  return 'created';
}

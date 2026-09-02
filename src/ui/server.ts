// The web UI: reader, trends, sources, and admin, on one loopback server.
//
//   npm run ui     ->  http://127.0.0.1:3000/
//
// One chrome for everything: fixed top bar with global search, a detailed left
// rail whose every entry carries a live count, and a single content column.
//
// The reader connects as the NOBYPASSRLS application role; admin uses the owner
// connection and says so on the page. Binds to 127.0.0.1 -- the admin views see
// every tenant's rows, so this must not be exposed.

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { loadDotEnv } from '../lib/dotenv.ts';
import { configureFromEnv } from '../config.ts';
import { findAsset, isAssetPath, negotiate, bodyFor, assetSummary } from './assets.ts';
import { renderJobs } from './jobs.ts';
import { page, escapeHtml, wrap, pageHead, table, railGroup } from './html.ts';
import { renderReader, renderStory, renderNewsRail } from './reader.ts';
import { renderRead } from './read.ts';
import { renderFavourites, setFavourite } from './favourites.ts';
import { setDismissed } from './dismiss.ts';
import { setRead, markAllRead } from './readstate.ts';
import { renderDeleted } from './deleted.ts';
import { renderNotFound } from './notfound.ts';
import { q } from './db.ts';
import { renderOverview } from './overview.ts';
import { renderTrends, renderTrend } from './trends.ts';
import {
  renderArchiveReport, renderFieldBriefing, renderReportIndex, renderReportDay,
  reportDay,
} from './briefing.ts';
import { renderRail, statusBadge, topNav, railCounts } from './rail.ts';
import { renderSources } from './sources.ts';
import { renderIntel } from './intel.ts';
import {
  accountById, accountByUsername, cookieFrom, COOKIE, isPublicPath, issueSession,
  hashPassword, mayView, mayWrite, readSession, sessionCookie, validateSignup,
  verifyPassword, isSecureRequest, needsRehash, type Account,
} from './auth.ts';
import { renderLogin, renderSignup, renderMe } from './signin.ts';
import { FIELDS } from '../vocab/fields.ts';
import { renderSearch, suggest } from './search.ts';
import { renderFields, renderField } from './fields.ts';

import { renderCompanies, renderCompany } from './companies.ts';
import { renderCatalogue, renderCategory, CATEGORIES } from './stacks.ts';
import { renderRegistry, decideCandidate } from './registry.ts';
import { renderPlatforms, renderPlatform } from './platforms.ts';
import { renderCategories } from './categories.ts';
import { renderSettings, saveSettings, currentPrefs } from './settings.ts';
import { readArticle } from './article.ts';
import { isStreamPath } from './filters.ts';
import { catalogue, adminNav, overview, health, rlsPanel, browse } from './admin.ts';

await loadDotEnv();

// The UI reads configuration for the same reason the collector does: the reading
// modal fetches pages with the configured user agent and timeout, and /settings
// has to show what the environment currently says.
configureFromEnv(process.env as Record<string, string | undefined>);

const PORT = Number(
  process.env.PORT ?? process.env.UI_PORT
  ?? (process.env.APP_URL ? new URL(process.env.APP_URL).port : '') ?? 3000,
) || 3000;

/**
 * Where to listen. Loopback unless told otherwise, and the default matters.
 *
 * A deployed container has to bind 0.0.0.0 or its platform's health check never
 * reaches it, so HOST exists -- but it is opt-in, because binding every
 * interface by default is how a development server ends up on the internet by
 * accident.
 */
const HOST = process.env.HOST ?? '127.0.0.1';
const PUBLIC = HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1';

/**
 * The admin surface, and the one thing about it that could not survive a deploy.
 *
 * /admin runs on the OWNER connection. That is deliberate and correct for a
 * loopback tool -- seeing every tenant's rows is the whole point of an admin
 * view -- and it is a data breach the moment the port is reachable, because the
 * owner role bypasses row-level security by design.
 *
 * So the rule is not "add a password", it is: the privilege and the exposure
 * cannot both be true. On a public bind, /admin serves nothing at all unless
 * ADMIN_TOKEN is set, and then only to a request that carries it. There is no
 * configuration in which an unauthenticated request reaches an owner-connection
 * query from off-host.
 */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

/** Constant-time, so the token cannot be probed a character at a time. */
export function tokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * May this request see /admin? null for yes, a reason for no.
 *
 * Pure and exported so the rule can be tested at every combination rather than
 * by binding a public port to find out. This is the control that stands between
 * an owner connection and the internet; "we tried it once and it seemed fine" is
 * not the standard it should be held to.
 */
export function adminDecision(
  isPublic: boolean, expected: string, provided: string,
): string | null {
  if (!isPublic) return null;
  if (!expected) {
    return 'This server is bound to a public interface and ADMIN_TOKEN is not set. '
      + 'The admin views run on the database owner connection, which bypasses row-level '
      + 'security, so they are served only over loopback or to a request carrying that token.';
  }
  return tokenMatches(provided, expected) ? null : 'Wrong or missing admin token.';
}

/**
 * IS THIS REQUEST FROM THE MACHINE ITSELF?
 *
 * Read from the socket and from nowhere else. `x-forwarded-for` is a claim made
 * by the client; trusting it here would mean anyone could assert they were
 * local and get the write routes back. If a reverse proxy is ever put in front
 * of this, that decision has to be made deliberately and not inherited from a
 * header that happened to be present.
 */
export function isLoopback(remote: string | undefined): boolean {
  if (!remote) return false;
  // Node reports IPv4-mapped IPv6 for a v4 loopback connection on a dual stack.
  const addr = remote.replace(/^::ffff:/, '');
  if (addr === '::1') return true;
  // The whole of 127.0.0.0/8 is loopback, but matched as four numbers rather
  // than by prefix: `startsWith('127.')` also accepts 127.0.0.1.evil.com. A
  // socket address is never a hostname, so that was not reachable -- but this
  // function is exported, and a guard that is only safe because of its caller
  // is a guard waiting for a second caller.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (!v4) return false;
  const parts = v4.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return false;
  return parts[0] === 127;
}

/**
 * The routes that change something.
 *
 * THIS USED TO BE A LOOPBACK TEST, and the note that stood here said what it
 * was: "not authentication and does not pretend to be -- the smallest rule that
 * makes a public bind safe without inventing a login the project has not
 * designed yet". The login now exists, so the rule is the real one: a write
 * needs an account, and a write to shared state needs an administrator.
 *
 * The loopback rule also had a visible cost, which is how it came up. The theme
 * toggle in the top bar posts to /settings, so on both deployed sites clicking
 * it answered 403. The button was never broken -- it was refused, because the
 * server could not tell an owner from a stranger.
 */
const MUTATING_PATHS = new Set([
  '/stacks', '/settings', '/favourite', '/read-state', '/read-all',
  '/dismiss', '/api/dismiss', '/api/favourite', '/undismiss', '/api/read-state',
  '/me/fields', '/me/theme',
]);

export function writeDecision(
  role: 'admin' | 'user' | null, method: string, path: string,
): string | null {
  if (method === 'GET' || method === 'HEAD') return null;
  if (!MUTATING_PATHS.has(path)) return null;
  if (mayWrite(role, path)) return null;
  return role
    ? 'That changes something everybody sees, and this account is a reader. '
      + 'Your own focus fields and theme are on /me.'
    : 'Sign in first.';
}

function adminRefusal(
  req: IncomingMessage, url: URL, role: 'admin' | 'user' | null,
): string | null {
  // A signed-in administrator IS the authorisation. The token predates the
  // login and stays for headless access -- a script, a health probe -- but a
  // person with an admin account should not have to paste a secret into a URL
  // to use the surface their role already grants.
  if (role === 'admin') return null;
  const provided = (req.headers['x-admin-token'] as string | undefined)
    ?? url.searchParams.get('token') ?? '';
  return adminDecision(PUBLIC, ADMIN_TOKEN, provided);
}

/**
 * One response, compressed if the client takes it, with an ETag either way.
 *
 * Both halves are about the same measurement: the News page is 240KB of HTML,
 * and there was no content-encoding header anywhere in this server. Gzip takes
 * it to a fraction of that on the wire, and the ETag means a reload that changed
 * nothing costs a 304 with no body at all -- which is the common case for a page
 * somebody is watching.
 *
 * gzip rather than brotli for HTML, and deliberately: this compresses on every
 * request, and brotli at a quality that beats gzip is several times the CPU for
 * a few percent of the bytes. The static assets, compressed once at startup, use
 * brotli precisely because that trade runs the other way.
 */
function send(
  req: IncomingMessage, res: ServerResponse,
  code: number, type: string, body: string,
  extra: Record<string, string> = {},
): void {
  const raw = Buffer.from(body, 'utf8');
  const etag = `W/"${createHash('sha256').update(raw).digest('hex').slice(0, 16)}"`;
  const headers: Record<string, string> = { 'content-type': type, etag, ...extra };

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return void res.end();
  }

  // Below about a kilobyte the header overhead is most of the saving.
  const accept = (req.headers['accept-encoding'] as string | undefined) ?? '';
  if (raw.length > 1024 && accept.toLowerCase().includes('gzip')) {
    const packed = gzipSync(raw, { level: 6 });
    headers['content-encoding'] = 'gzip';
    headers['vary'] = 'accept-encoding';
    headers['content-length'] = String(packed.length);
    res.writeHead(code, headers);
    return void res.end(packed);
  }

  headers['content-length'] = String(raw.length);
  res.writeHead(code, headers);
  res.end(raw);
}

/**
 * Which list a News-section page belongs to.
 *
 * The rail on this section is the LIST's rail -- counts along type, field and
 * technology under whatever is currently selected. Only the reader can build
 * that, so every other page in the section (an article, a story record, the
 * search results, the shelf) has to say which list it is a page OF.
 *
 * The referer answers that, and it is the same signal the back link already
 * uses. It is not trusted with anything: the path has to be one of the known
 * stream or view paths or it is discarded, and the query string it carries is
 * parsed by the same parseFilters() that reads the address bar. Anything
 * unrecognised -- a bookmark, a shared link, no referer at all -- falls back to
 * the section's own home, so the rail is present either way rather than
 * appearing only for people who arrived the expected way.
 */
function listOrigin(referer: string | null | undefined): URL {
  if (referer) {
    try {
      const u = new URL(referer, 'http://ui');
      if (isStreamPath(u.pathname)) return u;
    } catch { /* not a URL; fall through */ }
  }
  return new URL(lastList, 'http://ui');
}

/**
 * The last list actually rendered, as the fallback when the referer cannot say.
 *
 * The referer is missing more often than it looks: a reload of an article, a
 * bookmark, and -- the one that matters -- the redirect after starring
 * something, which arrives quoting the article's own address. Without this,
 * every one of those would swap the rail back to the unfiltered default, which
 * is the same disappearing-menu problem in a smaller window.
 *
 * Process-wide, deliberately. This server binds to loopback and serves one
 * person, so "the list they were last on" is a well-defined thing; two tabs on
 * two different streams would briefly disagree, and briefly disagreeing about a
 * menu is a far smaller cost than the menu vanishing.
 */
let lastList = '/news';

/** Read a form post. Bounded, because this server trusts nothing by default. */
async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const path = url.pathname;
  const state = { path, search: url.searchParams };

  try {
    // The stylesheet and the script. Content-hashed, so `immutable` is a
    // statement of fact rather than a hope: this URL cannot ever hold different
    // bytes, because the bytes are what named it.
    if (isAssetPath(path)) {
      const asset = findAsset(path);
      if (!asset) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return void res.end('no such asset');
      }
      if (req.headers['if-none-match'] === `"${asset.url}"`) {
        res.writeHead(304, {});
        return void res.end();
      }
      const encoding = negotiate(req.headers['accept-encoding'] as string | undefined);
      const body = bodyFor(asset, encoding);
      res.writeHead(200, {
        'content-type': asset.type,
        'cache-control': 'public, max-age=31536000, immutable',
        'content-length': String(body.length),
        etag: `"${asset.url}"`,
        ...(encoding ? { 'content-encoding': encoding, vary: 'accept-encoding' } : {}),
      });
      return void res.end(body);
    }

    // Liveness for a platform health check: is this process answering. It must
    // not touch the database -- a health check that fails when the database
    // blips gets the container killed during exactly the outage it should be
    // riding out. /admin/health is where the database's own state is reported.
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      return void res.end('ok');
    }

    // ---------------------------------------------------------------------
    // WHO IS ASKING. Resolved once, before any route runs.

    const sessionId = await readSession(cookieFrom(req.headers.cookie, COOKIE));
    const account: Account | null = sessionId ? await accountById(sessionId) : null;
    const role = account?.role ?? null;

    const redirect = (to: string, cookie?: string) => {
      res.writeHead(303, {
        location: to, 'cache-control': 'no-store',
        ...(cookie ? { 'set-cookie': cookie } : {}),
      });
      res.end();
    };

    // --- the pages that exist to get you an account ------------------------

    if (path === '/login' && req.method === 'GET') {
      if (account) return void redirect('/');
      return void send(req, res, 200, 'text/html; charset=utf-8',
        renderLogin({ next: url.searchParams.get('next') ?? '/',
          justSignedUp: url.searchParams.has('created') }), { 'cache-control': 'no-store' });
    }

    if (path === '/login' && req.method === 'POST') {
      const body = await readBody(req);
      const username = (body.get('username') ?? '').trim();
      const found = await accountByUsername(username);
      // The same message whether the account is missing or the password is
      // wrong. Saying which one turns the login form into a list of who has an
      // account here.
      const ok = found ? await verifyPassword(body.get('password') ?? '', found.password_hash) : false;
      if (!found || !ok) {
        return void send(req, res, 401, 'text/html; charset=utf-8',
          renderLogin({ error: 'That username and password do not match.', username,
            next: body.get('next') ?? '/' }), { 'cache-control': 'no-store' });
      }
      await q(`UPDATE accounts SET last_login_at = now() WHERE id = $1::uuid`, [found.id]);

      // Upgrade a hash written under different parameters. This is the only
      // moment the plaintext exists, so it is the only moment the upgrade can
      // happen. Failure here must not fail the login -- the password was
      // correct, and the old hash still works.
      if (needsRehash(found.password_hash)) {
        try {
          await q(`UPDATE accounts SET password_hash = $2 WHERE id = $1::uuid`,
                  [found.id, await hashPassword(body.get('password') ?? '')]);
        } catch { /* keep the old hash; the account still works */ }
      }
      // Read ONCE. Written as `(body.get('next') ?? '/').startsWith('/') ?
      // body.get('next')! : '/'` this tested the fallback and then returned the
      // original, so a login with no `next` redirected to the literal "/null".
      const next = body.get('next') ?? '';
      const to = next.startsWith('/') ? next : '/';
      return void redirect(to, sessionCookie(
        await issueSession(found.id), 14 * 24 * 3600, isSecureRequest(url, req.headers)));
    }

    if (path === '/signup' && req.method === 'GET') {
      if (account) return void redirect('/');
      return void send(req, res, 200, 'text/html; charset=utf-8', renderSignup(),
        { 'cache-control': 'no-store' });
    }

    if (path === '/signup' && req.method === 'POST') {
      const body = await readBody(req);
      const username = (body.get('username') ?? '').trim();
      const email = (body.get('email') ?? '').trim();
      const password = body.get('password') ?? '';
      const problems = validateSignup(username, password, email).map((p) => p.message);
      if (!problems.length) {
        try {
          // Always role 'user'. There is no path here that makes an
          // administrator, which is the point: the only admin is the seeded
          // one, and anybody else is promoted deliberately.
          await q(
            `INSERT INTO accounts (username, email, password_hash, role)
             VALUES ($1, nullif($2, ''), $3, 'user')`,
            [username, email, await hashPassword(password)]);
          return void redirect('/login?created=1');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          problems.push(/unique|duplicate/i.test(message)
            ? 'That username or email is already taken.'
            : 'Could not create the account.');
        }
      }
      return void send(req, res, 400, 'text/html; charset=utf-8',
        renderSignup({ problems, username, email }), { 'cache-control': 'no-store' });
    }

    if (path === '/logout') {
      return void redirect('/login', sessionCookie('', 0, isSecureRequest(url, req.headers)));
    }

    // --- everything else needs an account ----------------------------------

    if (!isPublicPath(path) && !account) {
      if (req.method !== 'GET') {
        res.writeHead(401, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
        return void res.end('Sign in first.');
      }
      return void redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
    }

    // Admin-only surfaces, refused on GET as well as on write. Without the GET
    // check a reader could simply navigate to /admin and read every tenant's
    // rows off the owner connection.
    if (account && !mayView(role, path)) {
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(page({
        title: 'Not for this account',
        body: wrap(`${pageHead('Not for this account',
          'That surface belongs to an administrator. Your focus fields and theme are on '
          + '<a href="/me">your account page</a>.')}`),
        nav: topNav(path), rail: '', theme: account.theme, here: path,
      }));
    }

    const writeRefusal = writeDecision(role, req.method ?? 'GET', path);
    if (writeRefusal) {
      res.writeHead(403, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      return void res.end(writeRefusal);
    }

    // --- the two things an account owns ------------------------------------

    if (path === '/me/fields' && req.method === 'POST') {
      const body = await readBody(req);
      const known = new Set(FIELDS.map((f) => f.slug));
      const chosen = body.getAll('fields').filter((f) => known.has(f));
      await q(`UPDATE accounts SET fields = $2::text[] WHERE id = $1::uuid`,
              [account!.id, chosen]);
      return void redirect('/me?saved=1');
    }

    if (path === '/me/theme' && req.method === 'POST') {
      const body = await readBody(req);
      const theme = body.get('theme') ?? 'dark';
      if (theme === 'auto' || theme === 'dark' || theme === 'light') {
        await q(`UPDATE accounts SET theme = $2 WHERE id = $1::uuid`, [account!.id, theme]);
      }
      // Back where the toggle was pressed, so the top-bar button does not send
      // the reader to a settings page they did not ask for.
      const back = body.get('return');
      return void redirect(back && back.startsWith('/') ? back : '/me');
    }

    // Accepting or rejecting a proposed vocabulary entry.
    if (req.method === 'POST' && path === '/stacks') {
      const body = await readBody(req);
      const result = await decideCandidate(body);
      res.writeHead(303, { location: `/stacks?${result}` });
      return void res.end();
    }

    if (req.method === 'POST' && path === '/settings') {
      const body = await readBody(req);
      const result = await saveSettings(body);

      // The top-bar theme toggle posts from wherever you were standing, and
      // expects to put you back there. Only same-origin paths, so the redirect
      // cannot be pointed at another site by a crafted form.
      const back = body.get('return') ?? '';
      if (back.startsWith('/') && !back.startsWith('//')) {
        res.writeHead(303, { location: back });
        return void res.end();
      }

      const anchor = result.group ? `#${result.group}` : '';
      res.writeHead(303, {
        location: `/settings?saved=${result.changed}&cleared=${result.cleared}${anchor}`,
      });
      return void res.end();
    }

    // Keeping a story, and letting it go. A POST because it changes something,
    // and a redirect back to where the star was clicked so the reader does not
    // lose its place -- the same shape as the theme toggle above, including the
    // same refusal to follow a return path that points off this site.
    if (req.method === 'POST' && path === '/favourite') {
      const body = await readBody(req);
      const id = body.get('id') ?? '';
      const keep = body.get('keep') === '1';
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        return void res.end('not a story id');
      }
      await setFavourite(account!.id, id, keep);
      const back = body.get('return') ?? '/favourites';
      const to = back.startsWith('/') && !back.startsWith('//') ? back : '/favourites';
      res.writeHead(303, { location: to });
      return void res.end();
    }

    // Where the reader got to. Same shape as the star and the bin: POST, a
    // checked return path, back to where it was clicked.
    if (req.method === 'POST' && path === '/read-state') {
      const body = await readBody(req);
      const id = body.get('id') ?? '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        return void res.end('not a story id');
      }
      await setRead(account!.id, id, body.get('read') === '1');
      const back = body.get('return') ?? '/all';
      const to = back.startsWith('/') && !back.startsWith('//') ? back : '/all';
      res.writeHead(303, { location: to });
      return void res.end();
    }

    // "I am caught up." One press rather than one per story, which is what a
    // reader wants after a week away.
    if (req.method === 'POST' && path === '/read-all') {
      const body = await readBody(req);
      await markAllRead(account!.id);
      const back = body.get('return') ?? '/news';
      const to = back.startsWith('/') && !back.startsWith('//') ? back : '/news';
      res.writeHead(303, { location: to });
      return void res.end();
    }

    // Getting rid of a story. Same shape as the star above -- POST, a checked
    // return path, a redirect back to where it was clicked -- because it is the
    // same gesture pointing the other way, and a reader who deletes six things
    // in a row should not lose their place six times.
    //
    // The row is not deleted; see src/ui/dismiss.ts for why that would break
    // every aggregate derived from it.
    if (req.method === 'POST' && path === '/dismiss') {
      const body = await readBody(req);
      const id = body.get('id') ?? '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        return void res.end('not a story id');
      }
      await setDismissed(id, body.get('gone') === '1', body.get('reason') ?? undefined);
      const back = body.get('return') ?? '/all';
      const to = back.startsWith('/') && !back.startsWith('//') ? back : '/all';
      res.writeHead(303, { location: to });
      return void res.end();
    }

    if (req.method === 'POST' && path === '/api/dismiss') {
      const body = await readBody(req);
      const id = body.get('id') ?? '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ problem: 'Not a story id.' }));
      }
      const state = await setDismissed(id, body.get('gone') === '1', body.get('reason') ?? undefined);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return void res.end(JSON.stringify({ state }));
    }

    // The same thing for the in-page toggle, which wants an answer rather than
    // a new page. Deliberately POST-only for the same reason as above.
    if (req.method === 'POST' && path === '/api/favourite') {
      const body = await readBody(req);
      const id = body.get('id') ?? '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ problem: 'Not a story id.' }));
      }
      const state = await setFavourite(account!.id, id, body.get('keep') === '1');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return void res.end(JSON.stringify({ state }));
    }

    // Live counts. The rail and the freshness badge are the two things on every
    // page that are wrong the moment collection stores something, and a river
    // whose numbers only move on reload does not look live -- it looks stopped.
    // railCounts() caches for five seconds, so polling this is cheap.
    if (path === '/api/counts') {
      const c = await railCounts();
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return void res.end(JSON.stringify({
        counts: c,
        badge: await statusBadge(),
      }));
    }

    // The rail for a list, re-rendered.
    //
    // /api/counts above serves the GLOBAL numbers -- total, today, favourites --
    // which is why only one entry on a News page was ever live: everything else
    // in that rail is counted under the query you are actually looking at, and
    // a global endpoint cannot know what that is.
    //
    // This returns the rendered rail HTML rather than a tidy JSON of numbers,
    // and that is deliberate. Counts and the markup around them have to come
    // from ONE producer or they drift apart -- the same reason the list and its
    // counts are read in a single batch. The client re-reads this and copies the
    // numbers across; there is no second place for a count to be computed.
    if (path === '/api/rail') {
      const raw = url.searchParams.get('for') ?? '/news';
      // Whatever arrives here is a path from the address bar of some tab, so it
      // is checked against the known streams rather than trusted.
      let listUrl: URL;
      try {
        listUrl = new URL(raw, 'http://ui');
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ problem: 'Not a list path.' }));
      }
      if (!isStreamPath(listUrl.pathname)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ problem: 'Not a list path.' }));
      }
      const prefs = await currentPrefs();
      const html = await renderNewsRail(account!.id, listUrl, prefs);
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      return void res.end(html);
    }

    if (path === '/api/suggest') {
      const term = url.searchParams.get('q')?.trim() ?? '';
      const items = term.length >= 2 ? await suggest(term) : [];
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return void res.end(JSON.stringify({ items }));
    }

    // The reading endpoint. Fetches the page now, returns typed text blocks, and
    // stores nothing -- see src/ui/article.ts.
    if (path === '/api/read') {
      const id = url.searchParams.get('id') ?? '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ problem: 'Not a story id.' }));
      }
      const article = await readArticle(id);
      res.writeHead(article ? 200 : 404, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=300',
      });
      return void res.end(JSON.stringify(article ?? { problem: 'No such story.' }));
    }

    // The named views were four saved filter settings with URLs of their own.
    // Three of them were the controls sitting directly above the list; the
    // fourth is answered better by Newcomers. They are gone, and every one of
    // them redirects to the settings it stood for -- which is both the kindest
    // thing to do to a saved link and the clearest possible statement of why
    // they were not necessary.
    const VIEW_REDIRECTS: Record<string, string> = {
      '/today': '/news?days=1',
      '/critical': '/news?min=8',
      '/rising': '/news?sort=velocity&days=7',
      '/niche': '/news?sort=rarest&rare=3',
      // Releases was `src.kind = 'releases'`. The event class says the same
      // thing about the item rather than about its feed, and says it about
      // every source rather than one kind of source.
      '/releases': '/news?kind2=release',
      // Community has no equivalent and needs none: it was "from a board", and
      // there are no boards in the registry. A saved link lands on News rather
      // than on a 404.
      '/community': '/news',
    };
    if (VIEW_REDIRECTS[path]) {
      res.writeHead(301, { location: VIEW_REDIRECTS[path]! });
      return void res.end();
    }

    // The reader used to live at /. Anything still carrying a query string there
    // is a link from before the split, and lands on the everything stream.
    if (path === '/' && url.search) {
      res.writeHead(301, { location: `/all${url.search}` });
      return void res.end();
    }

    // Admin pages carry the table catalogue in the rail underneath the standard
    // navigation, so the two surfaces are one app rather than two.
    const isAdminTable = path.startsWith('/admin/t/');
    let adminExtra = '';
    let tables: Awaited<ReturnType<typeof catalogue>> = [];
    if (path.startsWith('/admin')) {
      // Before catalogue(), which is the first owner-connection query. The check
      // has to precede the privilege, not accompany it.
      const refused = adminRefusal(req, url, role);
      if (refused) {
        return send(req, res, 403, 'text/html; charset=utf-8', page({
          title: 'Admin is not served here',
          rail: railGroup('', [{ href: '/', label: '← Back to news' }]),
          body: wrap(`${pageHead('Admin is not served here')}
            <p class="muted">${escapeHtml(refused)}</p>`),
        }), { 'cache-control': 'no-store' });
      }
      tables = await catalogue();
      adminExtra = adminNav(tables, isAdminTable
        ? decodeURIComponent(path.slice('/admin/t/'.length))
        : path === '/admin/health' ? 'health'
        : path === '/admin/jobs' ? 'jobs'
        : path === '/admin/rls' ? 'rls' : '');
    }

    // Preferences first, because the rail's unread badge is counted through
    // the same filter the page uses and that filter reads them. Fetched in
    // parallel with the rail, it counted against the defaults instead and
    // reported more unread stories than the page held.
    const prefs = await currentPrefs();
    const [rail, status] = await Promise.all([
      renderRail(state, adminExtra, prefs, role), statusBadge(),
    ]);
    // `railOverride` exists for the reader: its rail is counts under the query
    // it just ran, so only it can build one that agrees with the list beside it.
    const render = (title: string, body: string, code = 200, railOverride?: string) => {
      send(req, res, code, 'text/html; charset=utf-8', page({
        title, rail: railOverride ?? rail, body, status,
        nav: topNav(path),
        // THE ACCOUNT'S THEME, not the installation's. app_settings holds one
        // value for everybody, which was fine for a single operator on
        // loopback and wrong the moment two people sign in and one of them
        // prefers light. The stored setting remains the default for anyone
        // who has not chosen.
        who: account ? { username: account.username, role: account.role } : null,
        theme: account?.theme ?? prefs.theme,
        density: prefs.density,
        here: path + url.search,
        search: url.searchParams.get('q') ?? '',
        // Only the streams. Every other rail is either global — and already
        // live through /api/counts — or belongs to a list this page is not
        // standing on, where refreshing it against this URL would be wrong.
        liveRail: isStreamPath(path),
      }), {
        // Every page here is a view of a database that changes continuously. The
        // ETag makes a reload cheap; a max-age would make it wrong.
        'cache-control': 'no-cache',
        // A BOUNDARY FOR THE PICTURES.
        //
        // The reader now shows images from whatever site an article came from,
        // which is a new kind of request for this app to make. There was no CSP
        // at all before, so this is stricter than what it replaces rather than
        // looser: scripts and styles may come only from here, images from any
        // https origin, and nothing may frame the page or be framed by it.
        //
        // `img-src https:` is deliberately broad -- an article's diagrams live
        // on a CDN nobody can enumerate in advance -- and it still forbids
        // http, which is what stops a picture downgrading the page.
        'content-security-policy': [
          "default-src 'self'",
          "img-src https: data:",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src https://fonts.gstatic.com",
          "script-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'none'",
          "form-action 'self'",
        ].join('; '),
      });
    };

    // Three different 404s, because three different things went wrong. See
    // src/ui/notfound.ts -- the one that matters is a link to a story that
    // retention has since reduced to monthly analysis.
    const missing = async (opts: Parameters<typeof renderNotFound>[0]) =>
      render(opts.story ? 'No longer held' : 'Not found', await renderNotFound(opts), 404);

    if (path === '/') return render('Overview', await renderOverview());

    // The four streams, each its own page rather than a value of one filter.
    if (isStreamPath(path)) {
      const page = await renderReader(account!.id, url, prefs);
      lastList = path + url.search;
      return render(path.slice(1), page.body, 200, page.rail);
    }

    // The rest of the News section. These are pages OF a list rather than lists
    // themselves, and they keep the rail of the list they came from: opening an
    // article used to replace the whole menu with a two-entry stub, so the
    // navigation disappeared at the moment it was being used and came back on
    // the way out. The counts are held for twenty seconds, so reading six
    // stories out of one list costs one set of queries, not six.
    const from = typeof req.headers.referer === 'string' ? req.headers.referer : null;
    const keepRail = async () => {
      const origin = listOrigin(from);
      return renderNewsRail(account!.id, origin, prefs);
    };

    // The shelf. Everything on it is exempt from retention.
    // Everything the reader deleted, so it is undoable rather than a trapdoor.
    if (path === '/deleted') {
      return render('Deleted', await renderDeleted(url), 200, await keepRail());
    }

    if (path === '/favourites') {
      return render('Favourites', await renderFavourites(account!.id, url), 200, await keepRail());
    }

    if (path === '/search') {
      const term = url.searchParams.get('q')?.trim() ?? '';
      return render(term ? `Search: ${term}` : 'Search', await renderSearch(url),
        200, await keepRail());
    }

    // Reading an article is a page now, not a dialog on top of a list.
    if (path.startsWith('/read/')) {
      const id = decodeURIComponent(path.slice('/read/'.length));
      if (!/^[0-9a-f-]{36}$/i.test(id)) return missing({ path });
      // The referer picks the wording of the back link and which list's rail
      // stays up. It is matched against a fixed list of paths rather than
      // echoed, in both cases.
      const [body, rail] = await Promise.all([renderRead(account!.id, id, from), keepRail()]);
      return render('Reading', body, 200, rail);
    }

    if (path.startsWith('/story/')) {
      const id = decodeURIComponent(path.slice('/story/'.length));
      if (!/^[0-9a-f-]{36}$/i.test(id)) return missing({ path });
      // A well-formed id that finds nothing is the interesting case: the row
      // was almost certainly pruned, and saying "does not exist" about
      // something this system deliberately deleted is the least useful true
      // sentence available.
      const [held] = await q<{ n: string }>(
        'SELECT count(*)::text AS n FROM stories WHERE id = $1::uuid', [id]);
      if (Number(held?.n ?? 0) === 0) return missing({ path, story: true });
      const [body, rail] = await Promise.all([renderStory(account!.id, id, from), keepRail()]);
      return render('Story', body, 200, rail);
    }

    if (path === '/reports') {
      return render('Reports', await renderReportIndex());
    }
    // One day, listed. `reportDay` returns null for anything that is not a
    // calendar date, and the renderer says so rather than falling back to the
    // latest -- showing today's report under yesterday's address would be a lie
    // about which report you are reading.
    //
    // This lists the day's briefings rather than composing them, because the
    // composed view is administrators only a few routes down. Rendering it here
    // too would have been a gate with a door beside it.
    if (path.startsWith('/reports/')) {
      const day = reportDay(decodeURIComponent(path.slice('/reports/'.length)));
      if (!day) return missing({ path });
      return render(`Report ${day}`, await renderReportDay(day));
    }
    if (path === '/fields') return render('Fields', await renderFields());
    if (path.startsWith('/field/')) {
      const rest = path.slice('/field/'.length);
      // `/field/ai/report` before `/field/ai`, or the slug swallows the suffix.
      // `/field/ai/report/2026-09-01` before both, for the same reason one level
      // deeper: a field's briefing on a given day is its own page, so a reader
      // can link to what was said rather than to whatever is said now.
      const dated = rest.match(/^(.+)\/report\/([^/]+)$/);
      if (dated) {
        const day = reportDay(decodeURIComponent(dated[2]!));
        if (!day) return missing({ path });
        const slug = decodeURIComponent(dated[1]!);
        return render(`${slug} briefing ${day}`, await renderFieldBriefing(slug, day));
      }
      if (rest.endsWith('/report')) {
        const slug = decodeURIComponent(rest.slice(0, -'/report'.length));
        return render(`${slug} briefing`, await renderFieldBriefing(slug, null));
      }
      const slug = decodeURIComponent(rest);
      return render(slug, await renderField(slug));
    }
    if (path === '/technologies') return render('Technologies', await renderCatalogue(url));
    // Three registries, one renderer. The path says which list you are reading.
    if (path === '/stacks') return render('Stacks', await renderRegistry(url, 'stack'));
    if (path === '/tools') return render('Tools', await renderRegistry(url, 'tool'));
    if (path === '/concepts') return render('Concepts', await renderRegistry(url, 'concept'));
    if (path.startsWith('/technology/')) {
      const id = decodeURIComponent(path.slice('/technology/'.length));
      // This route takes a CATEGORY id, and the commonest way to arrive with
      // something else is a stack slug -- /technology/anthropic used to render
      // "Unknown category" at anyone who guessed. If it names a real entry, go
      // there instead of scolding.
      if (!CATEGORIES.some((c) => c.id === id)) {
        const [stack] = await q<{ slug: string }>(
          'SELECT slug FROM stacks WHERE slug = $1', [id]);
        if (stack) {
          res.writeHead(303, { location: `/trend/${encodeURIComponent(stack.slug)}` });
          return void res.end();
        }
        return missing({ path, missing: { what: 'category', value: id } });
      }
      return render(id, await renderCategory(id, url));
    }
    if (path === '/settings') return render('Settings', await renderSettings(url));
    if (path === '/categories') return render('Categories', await renderCategories(url));
    if (path === '/platforms') return render('Platforms', await renderPlatforms(url));
    if (path.startsWith('/platform/')) {
      const slug = decodeURIComponent(path.slice('/platform/'.length));
      return render(slug, await renderPlatform(slug));
    }
    if (path === '/companies') return render('Companies', await renderCompanies(url));
    if (path.startsWith('/company/')) {
      const slug = decodeURIComponent(path.slice('/company/'.length));
      return render(slug, await renderCompany(slug, url));
    }
    // Before '/trends' would not matter here (exact match), but the report is
    // the reason the section exists, so it reads first.
    if (path === '/trends/report') {
      // Administrators only, by the same rule /admin uses: a signed-in admin IS
      // the authorisation, and the token stays for headless access. The refusal
      // is here rather than only in the rail, because a rail that hides a link
      // is a menu and not a permission.
      const refused = adminRefusal(req, url, role);
      if (refused) {
        return send(req, res, 403, 'text/html; charset=utf-8', page({
          title: 'Intelligence briefing',
          rail: railGroup('', [{ href: '/trends', label: '← Technology trends' }]),
          body: wrap(`${pageHead('Administrators only')}
            <p class="muted">${escapeHtml(refused)}</p>`),
        }), { 'cache-control': 'no-store' });
      }
      return render('Intelligence briefing',
        await renderArchiveReport(reportDay(url.searchParams.get('day'))));
    }
    if (path === '/trends') return render('Trends', await renderTrends());
    if (path.startsWith('/trend/')) {
      const slug = decodeURIComponent(path.slice('/trend/'.length));
      const [stack] = await q<{ slug: string }>(
        'SELECT slug FROM stacks WHERE slug = $1', [slug]);
      if (!stack) return missing({ path, missing: { what: 'technology', value: slug } });
      return render(slug, await renderTrend(slug));
    }
    // The same registry, asked what it is MADE OF rather than whether it is
    // working. Kept under /sources rather than given a menu entry of its own:
    // it is a second question about one thing, not a second thing.
    if (path === '/me' && req.method === 'GET') {
      return void render('Your account', wrap(
        renderMe(account!, url.searchParams.has('saved'))));
    }

    if (path === '/sources/intel') return render('Source intelligence', await renderIntel(url));
    if (path === '/sources') return render('Sources', await renderSources(url));

    if (path === '/admin' || path === '/admin/') return render('Admin', await overview(tables));
    if (path === '/admin/health') return render('Collection health', await health());
    // What the system does when nobody is watching, and whether it worked.
    if (path === '/admin/jobs') return render('Scheduled work', await renderJobs());
    if (path === '/admin/rls') return render('Tenant isolation', await rlsPanel());
    if (isAdminTable) {
      const name = decodeURIComponent(path.slice('/admin/t/'.length));
      if (!tables.some((t) => t.name === name)) return missing({ path });
      return render(name, await browse(name, url));
    }
    if (path === '/admin/api/tables') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify(tables, null, 2));
    }

    return missing({ path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${path}: ${message}`);
    send(req, res, 500, 'text/html; charset=utf-8', page({
      title: 'Error',
      rail: railGroup('', [{ href: '/', label: '← Back to news' }]),
      body: wrap(`${pageHead('Something failed')}
        <pre class="mono" style="white-space:pre-wrap">${escapeHtml(message)}</pre>`),
    }), { 'cache-control': 'no-store' });
  }
}

/**
 * Start the web server. Returns it, so whoever started it can stop it.
 *
 * This used to listen at import time, which meant the only way to have the UI
 * was to have a process that was ONLY the UI. src/main.ts runs the web server
 * and the scheduler in one process, and that is not possible while starting the
 * server is a side effect of loading the module.
 */
export function startUi(): Server {
  const server = createHttpServer((req, res) => { void handle(req, res); });

  // A request that arrives during a rolling deploy and takes longer than the
  // platform's grace period is a 502 somebody sees. Keep-alive slightly above
  // the usual 60s proxy idle timeout is the standard way to lose that race in
  // the safe direction.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // Without this, a port already in use is an unhandled 'error' event and Node
  // prints a stack trace about node:net. The condition is almost always one of
  // two ordinary things, so say which.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use — another copy of this server is `
        + `probably running. Stop it, or set PORT to something else.`);
      process.exit(1);
    }
    if (err.code === 'EACCES') {
      console.error(`Not allowed to bind port ${PORT}. Ports below 1024 need privileges `
        + `most containers do not have; put a proxy in front instead.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, HOST, () => {
    const shown = PUBLIC ? `http://${HOST}:${PORT}/` : `http://127.0.0.1:${PORT}/`;
    console.log(`ui     ${shown}`);
    console.log(`       ${assetSummary()}`);
    if (PUBLIC && !ADMIN_TOKEN) {
      console.log('admin  NOT SERVED — public bind with no ADMIN_TOKEN (owner connection)');
    } else if (PUBLIC) {
      console.log('admin  /admin — requires the x-admin-token header or ?token=');
    } else {
      console.log(`admin  http://127.0.0.1:${PORT}/admin   (owner connection, bypasses RLS by design)`);
    }
  });
  return server;
}

// Still runnable on its own -- `npm run ui` -- but only when it is the thing
// that was run, rather than whenever the module is imported.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  startUi();
}

export { table };

// Sign in, sign up, and the one page a common user can actually change.
//
// These render standalone rather than through the usual chrome: the navigation
// rail lists surfaces you cannot reach without an account, and offering them to
// somebody who is not signed in is both confusing and a small information leak
// about what exists.

import { escapeHtml } from './html.ts';
import { FONTS_HREF, FAVICON, LOGO_SVG } from './theme.ts';
import { ASSET_URLS } from './assets.ts';
import { FIELDS } from '../vocab/fields.ts';
import type { Account } from './auth.ts';

/** A page with no navigation: nothing here is reachable yet. */
function bare(title: string, inner: string, theme: 'auto' | 'dark' | 'light' = 'dark'): string {
  return `<!doctype html>
<html lang="en"${theme !== 'auto' ? ` data-theme="${theme}"` : ''}><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · NewsTrack</title>
<link rel="icon" href="${FAVICON}">
<!-- FONTS_HREF is a bare URL, not a tag. Interpolated on its own it renders as
     visible text at the top of the page, which is exactly what it did on the
     deployed sign-in page. page() in html.ts has always wrapped it; this file
     is newer and did not. -->
<link rel="stylesheet" href="${FONTS_HREF}">
<link rel="stylesheet" href="${ASSET_URLS.css}">
</head><body>
<div class="signin">
  <div class="signin-card">
    <div class="signin-brand">${LOGO_SVG}<span>NewsTrack</span></div>
    ${inner}
  </div>
</div>
</body></html>`;
}

function errorList(problems: string[]): string {
  if (!problems.length) return '';
  return `<div class="signin-error">${problems.map((p) => escapeHtml(p)).join('<br>')}</div>`;
}

export function renderLogin(opts: {
  error?: string; username?: string; next?: string; justSignedUp?: boolean;
} = {}): string {
  const next = opts.next && opts.next.startsWith('/') ? opts.next : '/';
  return bare('Sign in', `
    <h1>Sign in</h1>
    ${opts.justSignedUp ? '<div class="signin-note">Account created. Sign in with it.</div>' : ''}
    ${errorList(opts.error ? [opts.error] : [])}
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <label for="u">Username</label>
      <input class="txt" id="u" name="username" autocomplete="username" autofocus
        value="${escapeHtml(opts.username ?? '')}" required>
      <label for="p">Password</label>
      <input class="txt" id="p" name="password" type="password" autocomplete="current-password" required>
      <button class="btn primary" type="submit">Sign in</button>
    </form>
    <p class="signin-alt">No account? <a href="/signup">Create one</a></p>
  `);
}

export function renderSignup(opts: {
  problems?: string[]; username?: string; email?: string;
} = {}): string {
  return bare('Create an account', `
    <h1>Create an account</h1>
    ${errorList(opts.problems ?? [])}
    <form method="post" action="/signup">
      <label for="u">Username</label>
      <input class="txt" id="u" name="username" autocomplete="username" autofocus
        value="${escapeHtml(opts.username ?? '')}" required>
      <label for="e">Email <span class="muted">— optional</span></label>
      <input class="txt" id="e" name="email" type="email" autocomplete="email"
        value="${escapeHtml(opts.email ?? '')}">
      <label for="p">Password</label>
      <input class="txt" id="p" name="password" type="password" autocomplete="new-password" required>
      <div class="signin-hint">At least 8 characters.</div>
      <button class="btn primary" type="submit">Create account</button>
    </form>
    <p class="signin-alt">Already have one? <a href="/login">Sign in</a></p>
  `);
}

/**
 * The account page.
 *
 * For a common user this is the ONLY thing they can change, so it says so
 * rather than leaving them to discover it by clicking something that refuses.
 */
export function renderMe(account: Account, saved = false): string {
  const chosen = new Set(account.fields);
  const boxes = FIELDS.map((f) => `
    <label class="fieldpick">
      <input type="checkbox" name="fields" value="${escapeHtml(f.slug)}"
        ${chosen.has(f.slug) ? 'checked' : ''}>
      <span>${escapeHtml(f.label)}</span>
    </label>`).join('');

  return `
    <div class="head"><div class="headrow"><div style="min-width:0">
      <h1>Your account</h1>
      <p>Signed in as <b>${escapeHtml(account.username)}</b>${
        account.email ? ` · ${escapeHtml(account.email)}` : ''} · ${
        account.role === 'admin' ? 'administrator' : 'reader'}</p>
    </div></div></div>

    ${saved ? '<p class="note ok">Saved.</p>' : ''}

    <h2>Focus fields</h2>
    <p class="note">The fields you follow. ${account.role === 'admin'
      ? 'As an administrator you can also reach every other surface.'
      : 'This is the setting that is yours; the rest of the archive is read-only to you.'}</p>
    <form method="post" action="/me/fields">
      <div class="pickgrid">${boxes}</div>
      <button class="btn primary mt-3" type="submit">Save fields</button>
    </form>

    <h2 class="mt-5">Theme</h2>
    <form method="post" action="/me/theme" class="row">
      ${(['auto', 'dark', 'light'] as const).map((t) => `
        <button class="btn${account.theme === t ? ' primary' : ''}" type="submit"
          name="theme" value="${t}">${t}</button>`).join('')}
    </form>

    <h2 style="margin-top:var(--s-5)">Session</h2>
    <form method="post" action="/logout">
      <button class="btn" type="submit">Sign out</button>
    </form>
  `;
}

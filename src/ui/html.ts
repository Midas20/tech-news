// Page shell and shared components.
//
// The design tokens, icons and keyboard layer live in theme.ts; this file is the
// assembly: one <head>, one chrome, and the handful of components every page is
// built from. Nothing here knows about news, sources or trends.

import { FONTS_HREF, FAVICON, LOGO_SVG, icon } from './theme.ts';
import { ASSET_URLS } from './assets.ts';

export { icon };

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface PageOpts {
  title: string;
  rail: string;
  body: string;
  search?: string;
  status?: string;
  /** Primary section navigation, already rendered. */
  nav?: string;
  /** Explicit theme choice. 'auto' leaves it to the operating system. */
  theme?: 'auto' | 'dark' | 'light';
  density?: 'comfortable' | 'compact';
  /** Who is signed in, shown in the top bar. */
  who?: { username: string; role: 'admin' | 'user' } | null;

  /** Where to come back to after the theme toggle posts. */
  here?: string;
  /**
   * This page's rail is counted under its own query, so it can be refreshed
   * from /api/rail. Set only for the streams; every other page's rail is either
   * global or belongs to a list it is not standing on.
   */
  liveRail?: boolean;
}

export function page(opts: PageOpts): string {
  const attrs = [
    opts.theme && opts.theme !== 'auto' ? ` data-theme="${opts.theme}"` : '',
    opts.density && opts.density !== 'comfortable' ? ` data-density="${opts.density}"` : '',
  ].join('');

  return `<!doctype html>
<html lang="en"${attrs}><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Tech intelligence: continuous collection, deduplication and per-technology trends.">
<title>${escapeHtml(opts.title)} · NewsTrack</title>
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_HREF}">
<link rel="stylesheet" href="${ASSET_URLS.css}">
</head><body${opts.liveRail ? ' data-live-rail' : ''}>
<!-- THE MENU TOGGLE, AND WHY IT IS A CHECKBOX.
     Below 900px the rail is hidden and below 720px the section tabs are too, so
     for a while the phone layout had no navigation at all: the header kept the
     wordmark, search and the theme switch, and every other destination in the
     product became unreachable except by searching for it or finding a link in
     the body. The rail is where Fields, Companies, Categories, the registry
     lists and every filter group live, so a tablet lost those as well.

     A checkbox because it has to work with scripting off, like the theme
     control and the filter links do. A details element would read better, but its
     content is hidden by the UA in a way author CSS cannot reliably reopen
     across browsers, and this element has to be BOTH a disclosure on a phone
     and plain always-visible markup on a desktop.

     It sits before the header so both the bar and the shell are later
     siblings, which is what lets one :checked selector reach the nav and the
     rail without either of them moving in the DOM. -->
<input type="checkbox" id="navtoggle" class="navtoggle"
       aria-label="Show navigation">
<header class="top">
  <label for="navtoggle" class="navbtn" title="Navigation">${icon('queue', 16)}</label>
  <a class="brand" href="/">${LOGO_SVG}<b>NewsTrack</b></a>
  ${opts.nav ?? ''}
  <div class="topright">
    <form class="searchbox" method="get" action="/search" role="search">
      ${icon('search', 14)}
      <input type="search" name="q" value="${escapeHtml(opts.search ?? '')}"
             placeholder="Search a technology, tool or platform…" autocomplete="off"
             spellcheck="false" aria-autocomplete="list" aria-controls="suggest">
      <kbd>/</kbd>
      <div id="suggest" class="suggest" role="listbox" hidden></div>
    </form>
    ${opts.status ?? ''}${themeToggle(opts.theme ?? 'dark', opts.here ?? '/')}${
      opts.who ? `<div class="whoami"><a href="/me" title="${
        opts.who.role === 'admin' ? 'Administrator' : 'Reader'}">${
        escapeHtml(opts.who.username)}</a></div>` : ''}
  </div>
</header>
<div class="shell">
  <nav class="rail">${opts.rail}</nav>
  <main>${opts.body}${CREDITS}</main>
</div>
<script src="${ASSET_URLS.js}" defer></script>
</body></html>`;
}

/**
 * Theme control in the top bar.
 *
 * A plain form, so it works with scripting off and -- more importantly -- so the
 * choice is SAVED rather than held in the tab. It writes the same setting the
 * settings page writes; there is one theme preference, not two.
 */
function themeToggle(theme: 'auto' | 'dark' | 'light', here: string): string {
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Switch to the dark theme' : 'Switch to the light theme';
  // POSTS TO /me/theme, NOT /settings.
  //
  // /settings is the installation-wide configuration page, and writing to it
  // needs an administrator -- so on both deployed sites this button answered
  // 403 for everybody else, and looked broken. The theme is a property of the
  // person reading, so it is saved against the account.
  return `<form class="themetoggle" method="post" action="/me/theme">
    <input type="hidden" name="theme" value="${next}">
    <input type="hidden" name="return" value="${escapeHtml(here)}">
    <button type="submit" title="${label}" aria-label="${label}">
      ${icon(next === 'dark' ? 'moon' : 'sun', 15)}</button>
  </form>`;
}

/**
 * Attribution for the vocabulary sources.
 *
 * Stack Overflow's tag synonyms are CC BY-SA 4.0, which requires attribution --
 * so this is a licence obligation rather than a courtesy, and it belongs on the
 * page rather than in a file nobody opens. The others ask for nothing and are
 * credited anyway: knowing where a name came from is the same question the
 * registry's `origin` column exists to answer.
 */
const CREDITS = `<footer class="credits">
  <span>Vocabulary from
    <a href="https://github.com/github/explore" target="_blank" rel="noreferrer">GitHub topics</a>,
    <a href="https://github.com/github-linguist/linguist" target="_blank" rel="noreferrer">Linguist</a>,
    the <a href="https://github.com/cncf/landscape" target="_blank" rel="noreferrer">CNCF landscape</a>,
    and <a href="https://stackoverflow.com/tags/synonyms" target="_blank" rel="noreferrer">Stack&nbsp;Overflow
    tag synonyms</a>. Technology background from
    <a href="https://www.wikipedia.org" target="_blank" rel="noreferrer">Wikipedia</a> and
    <a href="https://www.wikidata.org" target="_blank" rel="noreferrer">Wikidata</a> —
    <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC&nbsp;BY-SA&nbsp;4.0</a>.
  </span>
</footer>`;

export function wrap(inner: string): string {
  return `<div class="wrap">${inner}</div>`;
}

export interface Crumb {
  label: string;
  href?: string;
}

export interface HeadOpts {
  /** Where this page sits, shown above the title. */
  crumbs?: Crumb[];
  /** Buttons or links, right-aligned on the title line. */
  actions?: string;
}

export function pageHead(title: string, subtitle = '', opts: HeadOpts = {}): string {
  const crumbs = opts.crumbs?.length
    ? `<div class="eyebrow">${opts.crumbs.map((c, i) =>
        (i ? '<span class="sep">/</span>' : '') +
        (c.href ? `<a href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a>`
                : `<span>${escapeHtml(c.label)}</span>`)).join('')}</div>`
    : '';
  return `<div class="head">${crumbs}
    <div class="headrow">
      <div style="min-width:0">
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p>${subtitle}</p>` : ''}
      </div>
      ${opts.actions ? `<div class="actions">${opts.actions}</div>` : ''}
    </div>
  </div>`;
}

/** Pages within the current section, as tabs above the content. */
export function subnav(
  items: { href: string; label: string; icon?: string; count?: number | null; active?: boolean }[],
): string {
  if (items.length === 0) return '';
  return `<nav class="subnav">${items.map((i) =>
    `<a href="${escapeHtml(i.href)}" class="${i.active ? 'on' : ''}">
      ${i.icon ? icon(i.icon, 14) : ''}<span>${escapeHtml(i.label)}</span>
      ${i.count === undefined || i.count === null ? ''
        : `<span class="n">${i.count.toLocaleString('en-US')}</span>`}
    </a>`).join('')}</nav>`;
}

/** A headline number. `href` turns the whole card into a link. */
export function kpi(opts: {
  label: string; value: string | number; note?: string;
  href?: string; spark?: string; alert?: boolean;
  /** One sentence saying what this number is, shown on hover. */
  help?: string;
}): string {
  const inner = `<h3>${escapeHtml(opts.label)}</h3>
    <div class="v"${opts.alert ? ' style="color:var(--critical)"' : ''}>${
      typeof opts.value === 'number' ? opts.value.toLocaleString('en-US') : escapeHtml(opts.value)}</div>
    ${opts.note ? `<div class="d">${opts.note}</div>` : ''}
    ${opts.spark ? `<div class="bg">${opts.spark}</div>` : ''}${helpFor(opts.help)}`;
  return opts.href
    ? `<a class="kpi"${tipAttr(opts.help)} href="${escapeHtml(opts.href)}">${inner}</a>`
    : `<div class="kpi"${tipAttr(opts.help)}>${inner}</div>`;
}

/**
 * What a card means, for the two readers who need it differently.
 *
 * `data-tip` is the hover copy, drawn by CSS. The visually-hidden span is the
 * same sentence in the document, which is what assistive technology reads and
 * what makes the tooltip an enhancement rather than the only route to the
 * explanation -- a `title` attribute would have been neither reliably announced
 * nor styleable, and a JavaScript tooltip would put the meaning of a number
 * behind a script executing.
 */
function tipAttr(help?: string): string {
  return help ? ` data-tip="${escapeHtml(help)}"` : '';
}

function helpFor(help?: string): string {
  return help ? `<span class="vh">${escapeHtml(help)}</span>` : '';
}

export function panel(
  title: string, body: string,
  opts: { more?: { href: string; label: string }; icon?: string; flush?: boolean } = {},
): string {
  return `<section class="panel">
    <header>${opts.icon ? icon(opts.icon, 14) : ''}<h3>${escapeHtml(title)}</h3>
      ${opts.more ? `<a class="more" href="${escapeHtml(opts.more.href)}">${
        escapeHtml(opts.more.label)} &rarr;</a>` : ''}</header>
    <div class="body${opts.flush ? ' flush' : ''}">${body}</div>
  </section>`;
}

export function shortcutsBar(): string {
  return `<div class="shortcuts">
    <span><kbd>j</kbd><kbd>k</kbd> move</span>
    <span><kbd>v</kbd> read here</span>
    <span><kbd>enter</kbd> open the story</span>
    <span><kbd>o</kbd> open the original</span>
    <span><kbd>/</kbd> search</span>
    <span><kbd>esc</kbd> clear</span>
  </div>`;
}

// --- rail -------------------------------------------------------------------

export interface RailItem {
  href: string;
  label: string;
  count?: number | string | null;
  /**
   * Key into /api/counts, so the number can be refreshed without a reload.
   *
   * Named rather than positional: the rail is rebuilt per section and the same
   * count appears in different places, so "third link in the second group" is
   * not a stable address for it.
   */
  countKey?: string;
  active?: boolean;
  alert?: boolean;
  sub?: boolean;
  icon?: string;
  /** A short trailing word: when a technology was first seen, and the like. */
  note?: string;
  /**
   * Present, greyed, and not a link.
   *
   * For groups whose membership is FIXED -- the four event classes, the fields
   * you follow. Dropping a zero out of an open-ended facet list is right; doing
   * it to a fixed menu makes the menu look broken, because the entry that was
   * there a click ago has gone and there is no way back to it.
   */
  muted?: boolean;
  /**
   * The group's "everything" row: Anything, All fields, All companies.
   *
   * Not a checkbox, because it is not one of the options -- it is the state of
   * having chosen none of them, which is what this archive shows by default and
   * what every one of these filters means when it is empty. Drawing a box on it
   * put it in the same list as its own children and made "Anything" look like a
   * fifth kind of thing you could tick alongside the other four; readers ticked
   * it and nothing happened, because clicking it CLEARS the group.
   *
   * So: no box, a rule under it, and it lights up exactly when nothing beneath
   * it is chosen.
   */
  all?: boolean;
}

export interface RailGroupOpts {
  note?: string;
  /**
   * Draw a checkbox on every row.
   *
   * These rows are multi-select and always were -- clicking one adds it to the
   * selection rather than replacing it -- but a plain list of links does not say
   * so, and readers were treating them as radio buttons. The box is what says
   * "you may pick several".
   *
   * It is a styled indicator on a link, not an <input type="checkbox">. A real
   * checkbox cannot be a link, so it would need a form and a submit, and every
   * row would stop being a shareable address for the selection it produces --
   * which is a property this rail has and should keep. The link is also the only
   * version that works with JavaScript off. So: checkbox to look at and to
   * click, link underneath, `aria-current` telling assistive technology which
   * ones are on.
   */
  checkbox?: boolean;
  /**
   * Collapse the tail behind a disclosure once there are more rows than this.
   *
   * "Also in these stories" runs to a couple of hundred technologies on a broad
   * page. Rendering all of them buries the groups below it and makes the rail a
   * scroll rather than a menu.
   */
  limit?: number;
}

export function railGroup(
  title: string, items: RailItem[], opts: string | RailGroupOpts = '',
): string {
  if (items.length === 0) return '';
  const o: RailGroupOpts = typeof opts === 'string' ? { note: opts } : opts;
  const note = o.note ?? '';

  const render = (i: RailItem): string => {
    const inner = `${o.checkbox && !i.muted && !i.all
      ? '<span class="box" aria-hidden="true"></span>' : ''}${
      i.icon ? icon(i.icon) : ''}
      <span class="lbl">${escapeHtml(i.label)}</span>
      ${i.note ? `<span class="nt">${escapeHtml(i.note)}</span>` : ''}
      ${i.count === undefined || i.count === null ? '' :
        `<span class="n${i.alert ? ' alert' : ''}"${
          i.countKey ? ` data-count="${escapeHtml(i.countKey)}"` : ''}>${
          typeof i.count === 'number' ? i.count.toLocaleString('en-US') : escapeHtml(i.count)}</span>`}`;
    // Nothing to go to, so it is not a link. Kept visible so the menu keeps its
    // shape and the zero explains itself.
    return i.muted
      ? `<span class="off" title="nothing under the current selection">${inner}</span>`
      : `<a href="${escapeHtml(i.href)}" class="${[i.active ? 'on' : '', i.all ? 'all' : '']
        .filter(Boolean).join(' ')}"${i.all ? ' title="everything in this group — the default"' : ''}${
        i.active ? ' aria-current="true"' : ''}>${inner}</a>`;
  };

  // An active row is never hidden behind the disclosure. Collapsing the thing
  // somebody has already chosen makes the page look like it forgot.
  const limit = o.limit ?? 0;
  const overflow = limit > 0 && items.length > limit;
  const head = overflow
    ? [...items.filter((i) => i.active || i.all),
       ...items.filter((i) => !i.active && !i.all)].slice(0, limit)
    : items;
  const tail = overflow ? items.filter((i) => !head.includes(i)) : [];

  const wrap = (rows: string) =>
    items.some((i) => i.sub) ? `<div class="sub">${rows}</div>` : rows;

  return `<div class="group${o.checkbox ? ' checks' : ''}">${
    title ? `<h3>${escapeHtml(title)}</h3>` : ''}${
    note ? `<p class="gnote">${escapeHtml(note)}</p>` : ''}${
    wrap(head.map(render).join(''))}${
    tail.length
      // <details> rather than a button, so the tail opens with JavaScript off.
      // The label counts what is hidden: "more" alone does not say whether it
      // is three or three hundred, and that is the difference between opening
      // it and not bothering.
      ? `<details class="more"><summary><span class="op">Show ${
        tail.length.toLocaleString('en-US')} more</span><span class="cl">Show fewer</span></summary>${
        wrap(tail.map(render).join(''))}</details>`
      : ''}</div>`;
}

// --- components -------------------------------------------------------------

export function stat(
  label: string, value: string | number, note = '', help = '',
): string {
  return `<div class="card"${tipAttr(help)}><h3>${escapeHtml(label)}</h3>
    <div class="stat">${escapeHtml(value)}${
      note ? ` <small>${escapeHtml(note)}</small>` : ''}</div>${helpFor(help)}</div>`;
}

export function empty(message: string, iconName = 'feed'): string {
  return `<div class="empty">${icon(iconName, 28)}${message}</div>`;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** "3m", "5h", "2d" — absolute dates only once a story is older than a week. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days}d`;
  return new Date(t).toISOString().slice(0, 10);
}

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diff = (day(now) - day(d)) / 86400000;
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function cell(value: unknown, max = 140): string {
  if (value === null || value === undefined) return '<td class="null">null</td>';
  if (typeof value === 'number') return `<td class="num">${escapeHtml(value)}</td>`;
  if (typeof value === 'boolean') return `<td class="mono ${value ? 'ok' : 'muted'}">${value}</td>`;
  if (value instanceof Date) return `<td class="mono">${escapeHtml(value.toISOString())}</td>`;

  if (Array.isArray(value)) {
    if (value.length === 0) return '<td class="muted">—</td>';
    const shown = value.slice(0, 6).map((v) => `<span class="chip">${escapeHtml(v)}</span>`).join(' ');
    const more = value.length > 6 ? ` <span class="muted">+${value.length - 6}</span>` : '';
    return `<td title="${escapeHtml(value.join(', '))}">${shown}${more}</td>`;
  }

  if (typeof value === 'object') {
    const v = value as { type?: string; data?: number[] };
    if (v.type === 'Buffer' && Array.isArray(v.data)) {
      const hex = v.data.slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
      return `<td class="mono muted" title="${v.data.length} bytes">${hex}…</td>`;
    }
    const json = JSON.stringify(value);
    return `<td class="mono" title="${escapeHtml(json)}">${escapeHtml(truncate(json, max))}</td>`;
  }

  const str = String(value);
  const isUrl = /^https?:\/\//.test(str);
  const body = isUrl
    ? `<a href="${escapeHtml(str)}" target="_blank" rel="noreferrer">${escapeHtml(truncate(str, max))}</a>`
    : escapeHtml(truncate(str, max));
  const cls = /^[0-9a-f-]{36}$/i.test(str) || /^\d{4}-\d{2}-\d{2}/.test(str) ? ' class="mono"' : '';
  return `<td${cls} title="${escapeHtml(str.length > max ? str : '')}">${body}</td>`;
}

export function table(columns: { name: string; type?: string }[], rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '<p class="muted">No rows.</p>';
  const head = columns
    .map((c) => `<th>${escapeHtml(c.name)}${c.type ? `<br><span class="type">${escapeHtml(c.type)}</span>` : ''}</th>`)
    .join('');
  const body = rows.map((r) => `<tr>${columns.map((c) => cell(r[c.name])).join('')}</tr>`).join('');
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// --- charts -----------------------------------------------------------------
//
// One series, one hue, no legend (the heading names it), recessive axes, and the
// same numbers available as text underneath. Inline SVG: no script, no library.

export interface Point {
  label: string;
  value: number;
  title?: string;
}

export function barChart(points: Point[], opts: { height?: number; labelEvery?: number } = {}): string {
  if (points.length === 0) return '<p class="muted">No data yet.</p>';

  const h = opts.height ?? 120;
  // Room per bucket, wider when there are few. A handful of months should not
  // be four bars marooned in a chart built for a hundred.
  const per = points.length <= 12 ? 44 : 26;
  const w = Math.max(180, points.length * per);
  const max = Math.max(1, ...points.map((p) => p.value));
  const gap = 2;
  const bw = Math.max(3, w / points.length - gap);
  const axis = 18;

  const bars = points.map((p, i) => {
    const bh = Math.round((p.value / max) * (h - axis - 6));
    const x = i * (bw + gap);
    const y = h - axis - bh;
    const r = Math.min(4, bh, bw / 2);
    return `<rect x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${Math.max(bh, 1)}"
      rx="${r}" ry="${r}" fill="var(--series-1)"><title>${escapeHtml(p.title ?? `${p.label}: ${p.value}`)}</title></rect>`;
  }).join('');

  const every = opts.labelEvery ?? Math.max(1, Math.ceil(points.length / 6));
  const labels = points.map((p, i) => {
    if (i !== 0 && i !== points.length - 1 && i % every !== 0) return '';
    const x = i * (bw + gap) + bw / 2;
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    const px = i === 0 ? 0 : i === points.length - 1 ? w : x;
    return `<text x="${px.toFixed(1)}" y="${h - 5}" text-anchor="${anchor}"
      font-size="9" fill="var(--ink-4)">${escapeHtml(p.label)}</text>`;
  }).join('');

  return `<figure class="chart">
    <!-- max-width is the whole reason this is not grotesque. preserveAspectRatio
         "none" stretches the drawing -- bars, axis and label text alike -- to
         whatever width the container has, which is right for a hundred buckets
         squeezed into a column and catastrophic for eight: a 240-unit viewBox
         blown up to 1,600px is a 6.7x magnification, and it rendered as fat
         lozenges with the month labels stretched across the axis underneath
         them. Capping at one CSS pixel per unit means a short series is drawn at
         its natural size and only a long one is scaled, which is the direction
         that was ever wanted. -->
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img"
         style="max-width:${w}px" aria-label="volume over time, peak ${max}"
         preserveAspectRatio="none">
      <line x1="0" y1="${h - axis}" x2="${w}" y2="${h - axis}" stroke="var(--line)" stroke-width="1"/>
      ${bars}${labels}
    </svg>
    <figcaption>peak ${max} in one bucket</figcaption>
  </figure>`;
}

export function sparkline(values: number[], opts: { width?: number; height?: number; label?: string } = {}): string {
  if (values.length === 0) return '';
  const w = opts.width ?? 62;
  const h = opts.height ?? 16;
  const max = Math.max(1, ...values);
  const gap = 1;
  const bw = Math.max(1, w / values.length - gap);
  const bars = values.map((v, i) => {
    const bh = Math.max(1, Math.round((v / max) * (h - 2)));
    return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${h - bh}" width="${bw.toFixed(1)}"
      height="${bh}" rx="1" fill="var(--series-1)"/>`;
  }).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"
    aria-label="${escapeHtml(opts.label ?? `trend, peak ${max}`)}"><title>${
      escapeHtml(opts.label ?? values.join(', '))}</title>${bars}</svg>`;
}

export function seriesTable(points: Point[]): string {
  return `<details class="values"><summary>show values</summary>
    ${table([{ name: 'bucket' }, { name: 'stories' }],
      points.map((p) => ({ bucket: p.label, stories: p.value })))}</details>`;
}

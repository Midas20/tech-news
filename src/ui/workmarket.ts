// The work market on the report, and the page that says where to find work.
//
// 2026-09-13: "The report still focus on projects, I want clear report - which
// market like freelancing, jobs are changes, which market appear newly and we
// can use which platform to attend to this market and so on."
//
// So the report opens with three answers, in the order a person looking for
// work needs them:
//
//   1. How the market for work moved: how many companies are hiring, how many
//      people are looking, how much is remote, how much is contract.
//   2. Which kinds of work are new, growing or shrinking, and how crowded each
//      one is.
//   3. Where to go to take it.
//
// LATER THE SAME DAY: "all reports are combined by logic in a report page, and
// upgrade style, some style is very messy so user can't review info easily".
// The block was one function returning prose, a table whose row labels rendered
// as grey column headers, rows that `.mv-curve .muted{display:block}` broke out
// of the table, and platform lists that wrapped one link per line. It is now
// five pieces -- glance, kinds, skills, where, boards -- that src/ui/report.ts
// lays out as sections, drawn as tiles, pills, bars and chips so a reader can
// scan the answer before reading any of it.
//
// Every number is a share of public posts, compared with a year earlier. The
// collection lives in src/collect/workmarket.ts and the arithmetic in
// src/analysis/workmarket.ts.

import { escapeHtml, wrap } from './html.ts';
import { q } from './db.ts';
import { SPAN_LABEL, type Span } from '../analysis/period.ts';
import {
  workPicture, competition, type WorkPicture, type MarketMove, type MarketStatus,
} from '../analysis/workmarket.ts';
import { WORK_MARKETS, PLATFORM_KINDS, marketLabel } from '../vocab/workmarkets.ts';
import type { Query } from '../analysis/corpus.ts';

export interface PlatformRow {
  slug: string;
  name: string;
  url: string;
  kind: string;
  how: string;
  markets: string[];
  measured_by: string | null;
}

export async function workPlatforms(query: Query = q): Promise<PlatformRow[]> {
  return query<PlatformRow>(
    'SELECT slug, name, url, kind, how, markets, measured_by FROM work_platforms ORDER BY name')
    .catch((): PlatformRow[] => []);
}

const one = (n: number) => (Math.abs(n) >= 10 ? Math.round(n).toString() : n.toFixed(1));
const signed = (n: number) => `${n > 0 ? '+' : ''}${one(n)}`;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${one(n)}%`);

export function statusTag(s: MarketStatus): string {
  return `<span class="rp-pill st-${s}">${s}</span>`;
}

function competitionTag(pressure: number | null): string {
  const c = competition(pressure);
  if (!c) return '<span class="muted">—</span>';
  const tone = c === 'few candidates' ? 'good' : c === 'crowded' ? 'warn' : 'flat';
  return `<span class="rp-pill ${tone}">${c}</span>`;
}

/**
 * A headline number with what it was a year earlier.
 *
 * `better` says which direction helps a person looking for work, so the colour
 * means the same thing on every tile: more remote roles is good news, more job
 * seekers per role is not.
 */
export function tile(label: string, value: string, delta = ''): string {
  return `<div class="rp-tile">
    <div class="rp-tile-label">${label}</div>
    <div class="rp-tile-value">${value}</div>
    ${delta ? `<div class="rp-tile-delta">${delta}</div>` : ''}
  </div>`;
}

export function delta(
  now: number | null, before: number | null | undefined,
  opts: { better: 'up' | 'down' | 'none'; unit?: '%' | '' | 'pts'; relative?: boolean; was?: string },
): string {
  if (now === null || before === null || before === undefined) return '';
  const diff = opts.relative
    ? (before === 0 ? null : ((now - before) / before) * 100)
    : now - before;
  if (diff === null) return '';
  const flat = Math.abs(diff) < (opts.relative ? 1 : 0.5);
  const up = diff > 0;
  const tone = flat || opts.better === 'none' ? 'flat'
    : (up === (opts.better === 'up') ? 'good' : 'bad');
  const size = opts.relative ? `${Math.round(Math.abs(diff))}%`
    : opts.unit === 'pts' ? `${one(Math.abs(diff))} pts`
      : `${one(Math.abs(diff))}${opts.unit ?? ''}`;
  return `<span class="${tone}"><b>${flat ? '=' : up ? '▲' : '▼'} ${flat ? 'level' : size}</b></span>
    <span>${opts.was ?? `from ${one(before)}${opts.unit === 'pts' ? '%' : opts.unit ?? ''} a year earlier`}</span>`;
}

/** Specialised platforms first: an AI-training platform beats a general marketplace for AI training. */
const KIND_RANK: Record<string, number> = {
  'ai-work': 0, security: 0, bounty: 1, network: 2, marketplace: 3, board: 4, community: 5,
};

/**
 * Where to take one market's work.
 *
 * Measured boards first, ordered by how much of what they carry is in this
 * market -- that is evidence the work is there now. Then the platforms that
 * serve the market and publish nothing to measure, specialised before general.
 */
export function platformsFor(
  slug: string, all: PlatformRow[], p: WorkPicture,
): Array<{ name: string; url: string; note: string }> {
  const measured = p.boards
    .map((b) => ({ b, m: b.markets.find((x) => x.slug === slug) }))
    .filter((x): x is { b: typeof x.b; m: NonNullable<typeof x.m> } => Boolean(x.m) && (x.m?.n ?? 0) >= 2)
    .sort((x, y) => y.m.share - x.m.share)
    .slice(0, 3)
    .map(({ b, m }) => ({ name: b.label, url: b.url,
      note: `${one(m.share)}% of ${b.listings} new listings` }));
  const curated = all
    .filter((pl) => pl.kind !== 'board' && pl.kind !== 'community' && (pl.markets ?? []).includes(slug))
    .sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || a.name.localeCompare(b.name))
    .slice(0, 4)
    .map((pl) => ({ name: pl.name, url: pl.url,
      note: PLATFORM_KINDS[pl.kind]?.short ?? pl.kind }));
  if (slug === 'crypto-web3' && p.bounties) {
    curated.unshift({ name: 'Superteam Earn', url: 'https://earn.superteam.fun',
      note: `${p.bounties.open} open bounties` });
  }
  return [...measured, ...curated];
}

/** Platforms as chips: the name is the link, the note says why it is here. */
export function chips(xs: Array<{ name: string; url?: string; note?: string; on?: boolean }>): string {
  if (xs.length === 0) return '<span class="muted">—</span>';
  return `<ul class="rp-chips">${xs.map((x) => {
    const inner = `${escapeHtml(x.name)}${x.note ? ` <small>${escapeHtml(x.note)}</small>` : ''}`;
    const external = x.url && /^https?:/.test(x.url);
    return `<li>${x.url
      ? `<a class="rp-chip${x.on ? ' on' : ''}" href="${escapeHtml(x.url)}"${
        external ? ' rel="noopener" target="_blank"' : ''}>${inner}</a>`
      : `<span class="rp-chip">${inner}</span>`}</li>`;
  }).join('')}</ul>`;
}

/** Skills that are new or growing, largest rise first. */
function risers(skills: MarketMove[], limit = 4): MarketMove[] {
  return skills.filter((s) => (s.status === 'new' || s.status === 'growing') && s.posts >= 5)
    .sort((x, y) => (y.change ?? 0) - (x.change ?? 0)).slice(0, limit);
}

/** Share now against share a year earlier, on one scale for the whole table. */
function bar(now: number, before: number | null, max: number): string {
  const w = (v: number) => Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1);
  const label = `${one(now)}% now${before === null ? '' : `, ${one(before)}% a year earlier`}`;
  return `<span class="rp-bar" role="img" aria-label="${escapeHtml(label)}">
    <span class="rp-bar-now" style="width:${w(now)}%"></span>${before === null ? ''
    : `<span class="rp-bar-was" style="left:${w(before)}%"></span>`}</span>`;
}

const LEGEND = `<p class="rp-legend"><span><i class="now"></i>share now</span>
  <span><i class="was"></i>a year earlier</span></p>`;

function groups(p: WorkPicture) {
  return {
    fresh: p.markets.filter((m) => m.status === 'new'),
    growing: p.markets.filter((m) => m.status === 'growing'),
    shrinking: p.markets.filter((m) => m.status === 'shrinking')
      .sort((x, y) => (x.change ?? 0) - (y.change ?? 0)),
    scarce: p.markets.filter((m) => competition(m.pressure) === 'few candidates' && m.posts >= 8)
      .sort((x, y) => (y.pressure ?? 0) - (x.pressure ?? 0)),
    crowded: p.markets.filter((m) => competition(m.pressure) === 'crowded' && m.posts >= 8)
      .sort((x, y) => (x.pressure ?? 0) - (y.pressure ?? 0)),
  };
}

/** The market for work in one screen: a sentence, five figures, three lists. */
export function workGlance(p: WorkPicture, span: Span): string {
  if (!p.now) {
    return `<p class="rp-empty">No monthly hiring thread falls inside this ${SPAN_LABEL[span]}.</p>`;
  }
  const n = p.now;
  const b = p.before;
  const g = groups(p);
  const perRole = (s: typeof n | null) => (s && s.hiring > 0 ? s.seeking / s.hiring : null);
  const change = b && b.hiring > 0 ? Math.round(((n.hiring - b.hiring) / b.hiring) * 100) : null;

  const lede = `<p class="rp-lede"><b>${n.hiring} companies posted roles</b>${change === null ? ''
    : `, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% on a year earlier`}, and <b>${
    n.seeking} people posted that they want work</b>${b ? ` (${b.seeking} a year earlier)` : ''}.</p>`;

  const tiles = [
    tile('Companies hiring', String(n.hiring),
      delta(n.hiring, b?.hiring, { better: 'up', relative: true, was: b ? `on ${b.hiring} a year earlier` : '' })),
    perRole(n) === null ? '' : tile('Job seekers per role', perRole(n)!.toFixed(1),
      delta(perRole(n), perRole(b), { better: 'down', was: b && perRole(b) !== null
        ? `from ${perRole(b)!.toFixed(1)} a year earlier` : '' })),
    n.remote === null ? '' : tile('Roles that are remote', pct(n.remote),
      delta(n.remote, b?.remote, { better: 'up', unit: 'pts' })),
    n.contract === null ? '' : tile('Contract or freelance roles', pct(n.contract),
      delta(n.contract, b?.contract, { better: 'up', unit: 'pts' })),
    n.seekingContract === null ? '' : tile('Seekers open to contract', pct(n.seekingContract),
      delta(n.seekingContract, b?.seekingContract, { better: 'none', unit: 'pts' })),
  ].join('');

  const item = (m: MarketMove, value: string, kind = '') => `<li>
    <span class="rp-sig-name">${escapeHtml(m.label)}</span>${kind
    ? ` <span class="rp-sig-kind">${kind}</span>` : ''}
    <span class="rp-sig-val">${value}</span></li>`;
  const move = (m: MarketMove) => `${one(m.before ?? 0)}% → <b>${one(m.now)}%</b>`;
  const none = (text: string) => `<li class="rp-sig-none">${text}</li>`;

  const up = [
    ...g.fresh.map((m) => item(m, move(m), 'new')),
    ...g.growing.map((m) => item(m, move(m))),
    ...risers(p.skills).map((s) => item(s, move(s), 'skill')),
  ];
  const down = g.shrinking.slice(0, 6).map((m) => item(m, move(m)));
  const comp = [
    ...g.scarce.slice(0, 3).map((m) => item(m,
      `${one(m.now)}% of roles · ${one(m.supply ?? 0)}% of seekers`, 'few candidates')),
    ...g.crowded.slice(0, 3).map((m) => item(m,
      `${one(m.now)}% of roles · ${one(m.supply ?? 0)}% of seekers`, 'crowded')),
  ];

  const freelanceGone = p.lastFreelanceThread && n.days.every((d) => d > p.lastFreelanceThread!);
  const freelance = n.freelanceWork !== null
    ? `<p class="rp-callout"><b>Freelance thread:</b> ${n.freelanceWork} freelancers offered their
       services and ${n.freelanceHire ?? 0} clients asked for one${b?.freelanceWork != null
    ? ` (${b.freelanceWork} and ${b.freelanceHire ?? 0} a year earlier)` : ''}.</p>`
    : freelanceGone
      ? `<p class="rp-callout">Hacker News stopped its monthly “Freelancer? Seeking freelancer?” thread
         after ${escapeHtml(p.lastFreelanceThread!.slice(0, 7))}, so freelance demand is read from the
         contract share of roles above.</p>`
      : '';

  return `${lede}
    <div class="rp-tiles">${tiles}</div>
    <div class="rp-signals">
      <section class="rp-signal up"><h3>Growing or new</h3><ul>${up.join('')
    || none(b ? 'No kind of work grew by three points or more.' : 'No year-earlier thread to compare with.')}</ul></section>
      <section class="rp-signal down"><h3>Shrinking</h3><ul>${down.join('')
    || none('No kind of work shrank by three points or more.')}</ul></section>
      <section class="rp-signal comp"><h3>Competition</h3><ul>${comp.join('')
    || none('Every large kind of work is balanced between roles and seekers.')}</ul></section>
    </div>
    ${freelance}`;
}

/** Every kind of work: share now, a year earlier, and how crowded it is. */
export function workKinds(p: WorkPicture): string {
  if (!p.now || p.markets.length === 0) return '';
  const rows = [...p.markets].sort((x, y) => y.now - x.now);
  const max = Math.max(10, ...rows.flatMap((m) => [m.now, m.before ?? 0]));
  return `<div class="rp-scroll"><table class="rp-table">
    <thead><tr><th scope="col">Kind of work</th><th scope="col" class="num">Share of roles</th>
      <th scope="col" class="rp-barcol">Now against a year earlier</th><th scope="col" class="num">Change</th>
      <th scope="col" class="num">Share of seekers</th><th scope="col">Competition</th>
      <th scope="col" class="num">Remote</th></tr></thead>
    <tbody>${rows.map((m) => `<tr${m.posts < 5 ? ' class="thin"' : ''}>
      <th scope="row">${escapeHtml(m.label)} ${statusTag(m.status)}</th>
      <td class="num"><b>${pct(m.now)}</b></td>
      <td class="rp-barcol">${bar(m.now, m.before, max)}</td>
      <td class="num ${(m.change ?? 0) >= 0.5 ? 'up' : (m.change ?? 0) <= -0.5 ? 'down' : ''}">${
  m.change === null ? '—' : `${signed(m.change)} pts`}</td>
      <td class="num">${pct(m.supply)}</td>
      <td>${competitionTag(m.pressure)}</td>
      <td class="num">${pct(m.remote)}</td>
    </tr>`).join('')}</tbody>
  </table></div>${LEGEND}`;
}

/** The skills whose share of roles moved most. */
export function workSkills(p: WorkPicture): string {
  const skills = [...p.skills].filter((s) => s.change !== null && s.posts >= 3)
    .sort((x, y) => Math.abs(y.change ?? 0) - Math.abs(x.change ?? 0)).slice(0, 12);
  if (skills.length === 0) return '';
  const max = Math.max(10, ...skills.flatMap((s) => [s.now, s.before ?? 0]));
  return `<div class="rp-scroll"><table class="rp-table">
    <thead><tr><th scope="col">Skill</th><th scope="col" class="num">Share of roles</th>
      <th scope="col" class="rp-barcol">Now against a year earlier</th><th scope="col" class="num">Change</th>
      <th scope="col" class="num">Share of seekers</th></tr></thead>
    <tbody>${skills.map((s) => `<tr>
      <th scope="row">${escapeHtml(s.label)}${s.status === 'new' ? ` ${statusTag('new')}` : ''}</th>
      <td class="num"><b>${pct(s.now)}</b></td>
      <td class="rp-barcol">${bar(s.now, s.before, max)}</td>
      <td class="num ${(s.change ?? 0) > 0 ? 'up' : 'down'}">${signed(s.change ?? 0)} pts</td>
      <td class="num">${pct(s.supply)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

/** The kinds of work worth going after now, each with where to find it. */
export function workWhere(p: WorkPicture, all: PlatformRow[]): string {
  if (!p.now) return '';
  const g = groups(p);
  const targets = [
    ...g.fresh, ...g.growing,
    ...g.scarce.filter((m) => m.status !== 'new' && m.status !== 'growing'),
  ].filter((m, i, xs) => xs.findIndex((x) => x.slug === m.slug) === i).slice(0, 6);

  const card = (m: MarketMove) => `<article class="rp-card">
    <div class="rp-card-head"><h3>${escapeHtml(m.label)}</h3>${statusTag(m.status)}${
  competition(m.pressure) === 'few candidates' ? competitionTag(m.pressure) : ''}</div>
    <p class="rp-card-what">${escapeHtml(m.what)}</p>
    <dl class="rp-stats">
      <div><dt>Share of roles</dt><dd>${pct(m.now)}${m.before === null ? ''
    : `<small>${pct(m.before)} a year earlier</small>`}</dd></div>
      <div><dt>Share of seekers</dt><dd>${pct(m.supply)}</dd></div>
      <div><dt>Remote</dt><dd>${pct(m.remote)}</dd></div>
      <div><dt>Contract</dt><dd>${m.contract ? pct(m.contract) : '—'}</dd></div>
    </dl>
    <div><span class="rp-where-label">Where to find it</span>${chips(platformsFor(m.slug, all, p))}</div>
  </article>`;

  const every = `<details class="rp-fold"><summary>Every kind of work, and where to find it</summary>
    <div class="rp-fold-body"><div class="rp-scroll"><table class="rp-table">
      <thead><tr><th scope="col">Kind of work</th><th scope="col">Where to find it</th></tr></thead>
      <tbody>${WORK_MARKETS.map((wm) => `<tr><th scope="row">${escapeHtml(wm.label)}</th>
        <td>${chips(platformsFor(wm.slug, all, p))}</td></tr>`).join('')}</tbody>
    </table></div></div></details>`;

  return `${targets.length === 0 ? ''
    : `<div class="rp-cards">${targets.map(card).join('')}</div>`}
    ${every}`;
}

/** What the remote boards are carrying, and the open crypto bounties. */
export function workBoards(p: WorkPicture): string {
  if (p.boards.length === 0 && !p.bounties) return '';
  return `${p.boards.length === 0 ? '' : `<div class="rp-scroll"><table class="rp-table">
      <thead><tr><th scope="col">Board</th><th scope="col" class="num">New listings</th>
        <th scope="col" class="num">Open on the board</th><th scope="col">Most listings are in</th>
        <th scope="col" class="num">Contract</th></tr></thead>
      <tbody>${p.boards.map((bd) => `<tr>
        <th scope="row"><a href="${escapeHtml(bd.url)}" rel="noopener" target="_blank">${escapeHtml(bd.label)}</a></th>
        <td class="num">${bd.listings}</td>
        <td class="num">${bd.open === null ? '—' : bd.open.toLocaleString('en-US')}</td>
        <td>${bd.markets.length === 0 ? '—' : chips(bd.markets.slice(0, 3).map((m) => ({
    name: marketLabel(m.slug), note: `${one(m.share)}%` })))}</td>
        <td class="num">${pct(bd.contract)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`}
    ${p.bounties ? `<p class="rp-callout"><b>Crypto bounties:</b> ${p.bounties.open} open on
      <a href="https://earn.superteam.fun" rel="noopener" target="_blank">Superteam Earn</a>, worth
      ${p.bounties.reward.toLocaleString('en-US')} ${escapeHtml(p.bounties.tokens.join('/') || 'USD')} in total${
  p.bounties.medianSubmissions !== null
    ? `; the typical bounty already has ${p.bounties.medianSubmissions} submissions` : ''}.</p>` : ''}`;
}

/**
 * The whole work market as one block, for callers that want it in one piece.
 * The report lays the same pieces out as separate sections.
 */
export function workMarketBlock(p: WorkPicture, span: Span, all: PlatformRow[]): string {
  return `<h2 class="sect">The market for work</h2>
    ${workGlance(p, span)}
    ${p.now ? `<h2 class="sect">Which kinds of work are growing, new or shrinking</h2>
    ${workKinds(p)}
    <h3 class="sect">Skills that moved most</h3>
    ${workSkills(p)}
    <h2 class="sect">Where to take the work</h2>
    ${workWhere(p, all)}
    ${workBoards(p)}` : ''}`;
}

/** /work: where to find each kind of work, and what the measured platforms carry now. */
export async function renderWorkPage(query: Query = q): Promise<string> {
  const now = new Date();
  const range = {
    from: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    to: new Date(now.getTime() + 86_400_000).toISOString(),
    label: 'the last 30 days',
  };
  const [all, p] = await Promise.all([
    workPlatforms(query),
    workPicture(range, query).catch(() => null),
  ]);

  const mast = `<header class="rp-mast">
    <div class="rp-kicker">Report</div>
    <h1 class="rp-title">Where to find work</h1>
    <p class="rp-dek">Platforms for each kind of paid technical work, and what the measured ones
      are carrying now.</p>
    <div class="rp-controls"><nav class="rp-step"><a href="/reports">← This month’s report</a></nav></div>
  </header>`;

  if (all.length === 0) {
    return wrap(`<div class="rp">${mast}
      <p class="rp-empty">No platform has been added yet.</p></div>`);
  }

  const measured = (pl: PlatformRow): string => {
    if (!p || !pl.measured_by) return '';
    const bd = p.boards.find((x) => x.board === pl.measured_by);
    if (bd) {
      return `<p class="rp-callout"><b>${bd.listings} listings</b> in the last 30 days${
        bd.open ? ` · ${bd.open.toLocaleString('en-US')} open` : ''}${bd.markets.length ? `; most in ${
          bd.markets.slice(0, 3).map((m) => `${escapeHtml(marketLabel(m.slug))} (${one(m.share)}%)`).join(', ')}` : ''}.</p>`;
    }
    if (pl.measured_by === 'superteam' && p.bounties) {
      return `<p class="rp-callout"><b>${p.bounties.open} open bounties</b> worth ${
        p.bounties.reward.toLocaleString('en-US')} ${escapeHtml(p.bounties.tokens.join('/'))}${
        p.bounties.medianSubmissions !== null ? `; typical bounty has ${p.bounties.medianSubmissions} submissions` : ''}.</p>`;
    }
    if (pl.measured_by === 'hn-whoishiring' && p.now) {
      return `<p class="rp-callout"><b>Latest thread:</b> ${p.now.hiring} companies hiring,
        ${one(p.now.remote ?? 0)}% remote, ${p.now.seeking} people looking for work.</p>`;
    }
    return '';
  };

  const kinds = Object.entries(PLATFORM_KINDS)
    .map(([kind, k]) => ({ kind, k, mine: all.filter((pl) => pl.kind === kind) }))
    .filter((x) => x.mine.length > 0);

  const sections = kinds.map(({ kind, k, mine }) => `<section class="rp-section" id="kind-${escapeHtml(kind)}">
      <header class="rp-section-head"><h2>${escapeHtml(k.title)}</h2><p>${escapeHtml(k.blurb)}</p></header>
      <div class="rp-cards">${mine.map((pl) => `<article class="rp-card">
        <div class="rp-card-head"><h3><a href="${escapeHtml(pl.url)}" rel="noopener" target="_blank">${
  escapeHtml(pl.name)}</a></h3></div>
        <p class="rp-card-what">${escapeHtml(pl.how)}</p>
        <div><span class="rp-where-label">Kinds of work</span>${(pl.markets ?? []).includes('*')
    ? '<ul class="rp-chips"><li><span class="rp-chip">Every kind of technical work</span></li></ul>'
    : chips((pl.markets ?? []).map((m) => ({ name: marketLabel(m) })))}</div>
        ${measured(pl)}
      </article>`).join('')}</div>
    </section>`).join('');

  const byMarket = p ? `<section class="rp-section" id="by-kind">
      <header class="rp-section-head"><h2>By kind of work</h2>
        <p>Measured boards first, ordered by how much of what they carry is that kind of work; then
          the platforms that specialise in it.</p></header>
      <div class="rp-scroll"><table class="rp-table">
        <thead><tr><th scope="col">Kind of work</th><th scope="col">Where to find it</th></tr></thead>
        <tbody>${WORK_MARKETS.map((m) => `<tr><th scope="row">${escapeHtml(m.label)}</th>
          <td>${chips(platformsFor(m.slug, all, p))}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>` : '';

  const toc = `<nav class="rp-toc" aria-label="On this page">${p ? '<a href="#by-kind">By kind of work</a>' : ''}${
    kinds.map(({ kind, k }) => `<a href="#kind-${escapeHtml(kind)}">${escapeHtml(k.title)}</a>`).join('')}</nav>`;

  return wrap(`<div class="rp">${mast}${toc}${byMarket}${sections}</div>`);
}

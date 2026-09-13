// The work market on a report page, and the page that says where to find work.
//
// 2026-09-13: "The report still focus on projects, I want clear report - which
// market like freelancing, jobs are changes, which market appear newly and we
// can use which platform to attend to this market and so on."
//
// So a period report now opens with three answers, in the order a person
// looking for work needs them:
//
//   1. How the market for work moved: how many companies are hiring, how many
//      people are looking, how much is remote, how much is contract.
//   2. Which kinds of work are new, growing or shrinking, and how crowded each
//      one is.
//   3. Where to go to take it.
//
// Every number is a share of public posts, compared with a year earlier. The
// collection lives in src/collect/workmarket.ts and the arithmetic in
// src/analysis/workmarket.ts.

import { escapeHtml, wrap, pageHead, empty } from './html.ts';
import { crumbsFor } from './nav.ts';
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

const STATUS: Record<MarketStatus, string> = {
  new: 'new', growing: 'growing', steady: 'steady', shrinking: 'shrinking',
};

function statusTag(s: MarketStatus): string {
  return `<span class="mv-tag wm-${s}">${STATUS[s]}</span>`;
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

function links(xs: Array<{ name: string; url: string; note: string }>): string {
  if (xs.length === 0) return '<span class="muted">—</span>';
  return xs.map((x) => `<a href="${escapeHtml(x.url)}" rel="noopener" target="_blank">${
    escapeHtml(x.name)}</a> <span class="muted">(${escapeHtml(x.note)})</span>`).join(', ');
}

/** Skills that are new or growing, largest rise first. */
function risers(skills: MarketMove[], limit = 4): MarketMove[] {
  return skills.filter((s) => (s.status === 'new' || s.status === 'growing') && s.posts >= 5)
    .sort((x, y) => (y.change ?? 0) - (x.change ?? 0)).slice(0, limit);
}

function sentence(ms: MarketMove[], limit = 4): string {
  return ms.slice(0, limit).map((m) => `${escapeHtml(m.label)} (${one(m.before ?? 0)}% → ${one(m.now)}%)`)
    .join(', ');
}

/** The work market for one period, at the top of its report. */
export function workMarketBlock(p: WorkPicture, span: Span, all: PlatformRow[]): string {
  const label = SPAN_LABEL[span];
  if (!p.now) {
    return `<h2 class="sect">The market for work</h2>
      <p class="note">No monthly hiring thread falls inside this ${label}.</p>`;
  }
  const n = p.now;
  const b = p.before;
  const pair = (now: number | null, before: number | null | undefined, unit = '%') =>
    `<td class="num">${now === null ? '—' : `${one(now)}${unit}`}</td>
     <td class="num">${before === null || before === undefined ? '—' : `${one(before)}${unit}`}</td>`;
  const perPost = (s: typeof n | null) => (s && s.hiring > 0 ? s.seeking / s.hiring : null);

  const fresh = p.markets.filter((m) => m.status === 'new');
  const growing = p.markets.filter((m) => m.status === 'growing');
  const shrinking = p.markets.filter((m) => m.status === 'shrinking')
    .sort((x, y) => (x.change ?? 0) - (y.change ?? 0));
  const scarce = p.markets.filter((m) => competition(m.pressure) === 'few candidates' && m.posts >= 8)
    .sort((x, y) => (y.pressure ?? 0) - (x.pressure ?? 0));
  const crowded = p.markets.filter((m) => competition(m.pressure) === 'crowded' && m.posts >= 8)
    .sort((x, y) => (x.pressure ?? 0) - (y.pressure ?? 0));

  const headline: string[] = [];
  if (b) {
    const change = b.hiring > 0 ? Math.round(((n.hiring - b.hiring) / b.hiring) * 100) : null;
    headline.push(`<b>${n.hiring} companies posted roles</b>${change === null ? ''
      : `, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% on a year earlier`}, and <b>${
      n.seeking} people posted that they want work</b> (${b.seeking} a year earlier).`);
  } else {
    headline.push(`<b>${n.hiring} companies posted roles</b> and <b>${n.seeking} people posted that they want work</b>.`);
  }
  if (n.remote !== null) {
    headline.push(`<b>${one(n.remote)}% of roles are remote</b>${b?.remote != null
      ? ` (${one(b.remote)}% a year earlier)` : ''}, and <b>${one(n.contract ?? 0)}% are contract or
      freelance</b>${b?.contract != null ? ` (${one(b.contract)}%)` : ''}.`);
  }
  if (n.seekingContract !== null) {
    headline.push(`${one(n.seekingContract)}% of the people looking for work say they are open to
      contract or freelance work${b?.seekingContract != null ? ` (${one(b.seekingContract)}% a year earlier)` : ''}.`);
  }

  const moves: string[] = [];
  if (fresh.length) moves.push(`<b>New:</b> ${sentence(fresh)}.`);
  if (growing.length) moves.push(`<b>Growing:</b> ${sentence(growing)}.`);
  if (shrinking.length) moves.push(`<b>Shrinking:</b> ${sentence(shrinking)}.`);
  if (!fresh.length && !growing.length && !shrinking.length && b) {
    moves.push('No kind of work moved by three points or more against a year earlier.');
  }
  // NEW SKILLS, NAMED. A market can hold its share while what it asks for turns
  // over: AI engineering grew four points in September 2026 while MCP went from
  // nothing to 3.8% of roles and LLM evaluation to 5%.
  const risingSkills = risers(p.skills);
  if (risingSkills.length) {
    moves.push(`<b>Skills newly or increasingly asked for:</b> ${risingSkills.map((s) =>
      `${escapeHtml(s.label)} (${one(s.before ?? 0)}% → ${one(s.now)}% of roles)`).join(', ')}.`);
  }
  if (scarce.length) {
    moves.push(`<b>Fewest candidates per role:</b> ${scarce.slice(0, 3).map((m) =>
      `${escapeHtml(m.label)} (asked for in ${one(m.now)}% of roles, offered by ${one(m.supply ?? 0)}% of job seekers)`)
      .join(', ')}.`);
  }
  if (crowded.length) {
    moves.push(`<b>Most crowded:</b> ${crowded.slice(0, 3).map((m) =>
      `${escapeHtml(m.label)} (${one(m.now)}% of roles, ${one(m.supply ?? 0)}% of job seekers)`).join(', ')}.`);
  }

  const marketRow = (m: MarketMove) => `<tr${m.posts < 5 ? ' class="muted"' : ''}>
    <th scope="row">${escapeHtml(m.label)} ${statusTag(m.status)}</th>
    <td class="num">${one(m.now)}%</td>
    <td class="num">${m.before === null ? '—' : `${one(m.before)}%`}</td>
    <td class="num ${(m.change ?? 0) > 0 ? 'up' : (m.change ?? 0) < 0 ? 'down' : ''}">${
  m.change === null ? '—' : signed(m.change)}</td>
    <td class="num">${m.supply === null ? '—' : `${one(m.supply)}%`}</td>
    <td>${escapeHtml(competition(m.pressure) ?? '—')}</td>
    <td class="num">${m.remote === null ? '—' : `${one(m.remote)}%`}</td>
  </tr>`;

  const skills = [...p.skills].filter((s) => s.change !== null && s.posts >= 3)
    .sort((x, y) => Math.abs(y.change ?? 0) - Math.abs(x.change ?? 0)).slice(0, 10);

  const targets = [
    ...fresh, ...growing,
    ...scarce.filter((m) => m.status !== 'new' && m.status !== 'growing'),
  ].filter((m, i, xs) => xs.findIndex((x) => x.slug === m.slug) === i).slice(0, 6);

  const card = (m: MarketMove) => `<article class="pr-card">
      <p class="pr-claim">${escapeHtml(m.label)} ${statusTag(m.status)}</p>
      <p class="mv-body">${escapeHtml(m.what)} Asked for in ${one(m.now)}% of roles${
  m.before !== null ? ` (${one(m.before)}% a year earlier)` : ''}; offered by ${
  m.supply === null ? 'an unknown share' : `${one(m.supply)}%`} of job seekers${
  m.remote !== null ? `; ${one(m.remote)}% of these roles are remote` : ''}${
  m.contract ? `, ${one(m.contract)}% contract` : ''}.</p>
      <dl class="mv-facts"><dt>Where to find it</dt><dd>${links(platformsFor(m.slug, all, p))}</dd></dl>
    </article>`;

  const boards = p.boards.length === 0 ? '' : `
    <h3 class="sect">What the remote boards are carrying</h3>
    <div class="mv-scroll"><table class="mv-curve">
      <thead><tr><th>Board</th><th class="num">New listings</th><th class="num">Open on the board</th>
        <th>Most listings are in</th><th class="num">Contract</th></tr></thead>
      <tbody>${p.boards.map((bd) => `<tr>
        <th scope="row"><a href="${escapeHtml(bd.url)}" rel="noopener" target="_blank">${escapeHtml(bd.label)}</a></th>
        <td class="num">${bd.listings}</td>
        <td class="num">${bd.open === null ? '—' : bd.open.toLocaleString('en-US')}</td>
        <td>${bd.markets.slice(0, 3).map((m) => `${escapeHtml(marketLabel(m.slug))} ${one(m.share)}%`).join(', ') || '—'}</td>
        <td class="num">${bd.contract === null ? '—' : `${one(bd.contract)}%`}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${p.bounties ? `<p class="note"><b>Crypto bounties:</b> ${p.bounties.open} open on
      <a href="https://earn.superteam.fun" rel="noopener" target="_blank">Superteam Earn</a>, worth
      ${p.bounties.reward.toLocaleString('en-US')} ${escapeHtml(p.bounties.tokens.join('/') || 'USD')} in total${
  p.bounties.medianSubmissions !== null
    ? `; the typical bounty already has ${p.bounties.medianSubmissions} submissions` : ''}.</p>` : ''}`;

  const freelanceGone = p.lastFreelanceThread && n.days.every((d) => d > p.lastFreelanceThread!);
  const freelance = n.freelanceWork !== null
    ? `<p class="note"><b>Freelance thread:</b> ${n.freelanceWork} freelancers offered their services
       and ${n.freelanceHire ?? 0} clients asked for a freelancer${b?.freelanceWork != null
    ? ` (${b.freelanceWork} and ${b.freelanceHire ?? 0} a year earlier)` : ''}.</p>`
    : freelanceGone
      ? `<p class="note">Hacker News stopped its monthly “Freelancer? Seeking freelancer?” thread
         after ${escapeHtml(p.lastFreelanceThread!.slice(0, 7))}; freelance demand is read from the
         contract share of hiring posts instead.</p>`
      : '';

  return `
    <h2 class="sect">The market for work</h2>
    <div class="mv-lede">${headline.map((h) => `<p>${h}</p>`).join('')}</div>
    ${moves.length ? `<div class="mv-caveat">${moves.map((m) => `<p>${m}</p>`).join('')}</div>` : ''}

    <div class="mv-scroll"><table class="mv-curve">
      <thead><tr><th></th><th class="num">This ${escapeHtml(label)}</th>
        <th class="num">A year earlier</th></tr></thead>
      <tbody>
        <tr><th scope="row">Companies posting roles</th>${pair(n.hiring, b?.hiring, '')}</tr>
        <tr><th scope="row">People posting that they want work</th>${pair(n.seeking, b?.seeking, '')}</tr>
        <tr><th scope="row">Job seekers per role</th>${pair(perPost(n), perPost(b), '')}</tr>
        <tr><th scope="row">Roles that are remote</th>${pair(n.remote, b?.remote)}</tr>
        <tr><th scope="row">Roles that are contract or freelance</th>${pair(n.contract, b?.contract)}</tr>
        <tr><th scope="row">Job seekers open to contract work</th>${pair(n.seekingContract, b?.seekingContract)}</tr>
      </tbody>
    </table></div>
    ${freelance}

    <h2 class="sect">Which kinds of work are growing, new or shrinking</h2>
    <div class="mv-scroll"><table class="mv-curve">
      <thead><tr><th>Kind of work</th><th class="num">Share of roles</th><th class="num">A year earlier</th>
        <th class="num">Change (pts)</th><th class="num">Share of job seekers</th><th>Competition</th>
        <th class="num">Remote</th></tr></thead>
      <tbody>${p.markets.map(marketRow).join('')}</tbody>
    </table></div>

    ${skills.length === 0 ? '' : `<h3 class="sect">Skills that moved most</h3>
    <div class="mv-scroll"><table class="mv-curve">
      <thead><tr><th>Skill</th><th class="num">Share of roles</th><th class="num">A year earlier</th>
        <th class="num">Change (pts)</th><th class="num">Share of job seekers</th></tr></thead>
      <tbody>${skills.map((s) => `<tr><th scope="row">${escapeHtml(s.label)}</th>
        <td class="num">${one(s.now)}%</td><td class="num">${s.before === null ? '—' : `${one(s.before)}%`}</td>
        <td class="num ${(s.change ?? 0) > 0 ? 'up' : 'down'}">${signed(s.change ?? 0)}</td>
        <td class="num">${s.supply === null ? '—' : `${one(s.supply)}%`}</td></tr>`).join('')}</tbody>
    </table></div>`}

    ${targets.length === 0 ? '' : `<h2 class="sect">Where to take the work</h2>
    <div class="mv-items">${targets.map(card).join('')}</div>`}
    <p class="note"><a href="/work">Every platform, by kind of work</a></p>

    ${boards}

    <p class="note">Shares of posts in Hacker News’ monthly “Who is hiring?” and “Who wants to be
      hired?” threads (${escapeHtml(n.days.join(', '))}), against the same threads a year earlier.
      Share of job seekers is the other side of the same month: a kind of work asked for in more roles
      than job seekers offer it has fewer candidates per role.</p>`;
}

/**
 * The market for work in a few lines, for the top of /reports.
 *
 * The reports index used to open with the day's launches and funding. A
 * person looking for work opens it to learn whether their kind of work is
 * growing and where to go, so that is what it leads with now.
 */
export function workSummary(p: WorkPicture, label: string, monthKey: string): string {
  if (!p.now) return '';
  const n = p.now;
  const b = p.before;
  const change = b && b.hiring > 0 ? Math.round(((n.hiring - b.hiring) / b.hiring) * 100) : null;
  const growing = p.markets.filter((m) => m.status === 'new' || m.status === 'growing').slice(0, 4);
  const shrinking = p.markets.filter((m) => m.status === 'shrinking')
    .sort((x, y) => (x.change ?? 0) - (y.change ?? 0)).slice(0, 3);
  const scarce = p.markets.filter((m) => competition(m.pressure) === 'few candidates' && m.posts >= 8)
    .sort((x, y) => (y.pressure ?? 0) - (x.pressure ?? 0)).slice(0, 3);
  const item = (title: string, ms: MarketMove[], fmt: (m: MarketMove) => string) => (ms.length === 0 ? ''
    : `<li><b>${title}</b> ${ms.map((m) => `${escapeHtml(m.label)} ${fmt(m)}`).join(', ')}</li>`);
  return `
    <h2 class="sect">The market for work, ${escapeHtml(label)}</h2>
    <p class="mv-lede">${n.hiring} companies hiring${change === null ? ''
    : ` (${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% on a year earlier)`}, ${
  n.remote === null ? '' : `${one(n.remote)}% of roles remote, `}${n.seeking} people looking for work.</p>
    <ul class="mv-list">
      ${item('Growing or new:', growing, (m) => `(${one(m.before ?? 0)}% → ${one(m.now)}% of roles)`)}
      ${item('Skills newly asked for:', risers(p.skills, 3), (m) => `(${one(m.before ?? 0)}% → ${one(m.now)}%)`)}
      ${item('Shrinking:', shrinking, (m) => `(${one(m.before ?? 0)}% → ${one(m.now)}%)`)}
      ${item('Fewest candidates per role:', scarce, (m) => `(${one(m.now)}% of roles, ${one(m.supply ?? 0)}% of job seekers)`)}
    </ul>
    <div class="bf-fields">
      <a class="btn" href="/reports/month/${escapeHtml(monthKey)}">This month’s report</a>
      <a class="btn" href="/work">Where to find work</a>
    </div>`;
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
  const crumbs = crumbsFor('/work', 'Where to find work');

  if (all.length === 0) {
    return wrap(`${pageHead('Where to find work', 'No platform has been added yet.', { crumbs })}
      ${empty('The platform list is seeded with npm run seed:work.', 'book')}`);
  }

  const measured = (pl: PlatformRow): string => {
    if (!p || !pl.measured_by) return '';
    const bd = p.boards.find((x) => x.board === pl.measured_by);
    if (bd) {
      return `<p class="note">${bd.listings} listings posted in the last 30 days${
        bd.open ? ` (${bd.open.toLocaleString('en-US')} open on the board)` : ''}; most are in ${
        bd.markets.slice(0, 3).map((m) => `${escapeHtml(marketLabel(m.slug))} (${one(m.share)}%)`).join(', ') || '—'}.</p>`;
    }
    if (pl.measured_by === 'superteam' && p.bounties) {
      return `<p class="note">${p.bounties.open} open bounties worth ${
        p.bounties.reward.toLocaleString('en-US')} ${escapeHtml(p.bounties.tokens.join('/'))}${
        p.bounties.medianSubmissions !== null ? `; typical bounty has ${p.bounties.medianSubmissions} submissions` : ''}.</p>`;
    }
    if (pl.measured_by === 'hn-whoishiring' && p.now) {
      return `<p class="note">Latest thread: ${p.now.hiring} companies hiring, ${one(p.now.remote ?? 0)}% remote,
        ${p.now.seeking} people looking for work.</p>`;
    }
    return '';
  };

  const groups = Object.entries(PLATFORM_KINDS).map(([kind, k]) => {
    const mine = all.filter((pl) => pl.kind === kind);
    if (mine.length === 0) return '';
    return `<h2 class="sect">${escapeHtml(k.title)}</h2>
      <p class="note">${escapeHtml(k.blurb)}</p>
      <div class="mv-items">${mine.map((pl) => `<article class="pr-card">
        <p class="pr-claim"><a href="${escapeHtml(pl.url)}" rel="noopener" target="_blank">${escapeHtml(pl.name)}</a></p>
        <p class="mv-body">${escapeHtml(pl.how)}</p>
        <dl class="mv-facts"><dt>Kinds of work</dt><dd>${(pl.markets ?? []).includes('*')
    ? 'Every kind of technical work'
    : (pl.markets ?? []).map((m) => escapeHtml(marketLabel(m))).join(', ')}</dd></dl>
        ${measured(pl)}
      </article>`).join('')}</div>`;
  }).join('');

  const byMarket = p ? `<h2 class="sect">By kind of work</h2>
    <div class="mv-scroll"><table class="mv-curve">
      <thead><tr><th>Kind of work</th><th>Where to find it</th></tr></thead>
      <tbody>${WORK_MARKETS.map((m) => `<tr><th scope="row">${escapeHtml(m.label)}</th>
        <td>${links(platformsFor(m.slug, all, p))}</td></tr>`).join('')}</tbody>
    </table></div>` : '';

  return wrap(`
    ${pageHead('Where to find work',
    'Platforms for each kind of paid technical work, and what the measured ones are carrying now',
    { crumbs })}
    ${byMarket}
    ${groups}`);
}

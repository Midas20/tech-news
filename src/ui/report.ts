// The report: every report this archive writes, on one page, in the order a
// person looking for remote work needs them.
//
// 2026-09-13: "all reports are combined by logic in a report page, and upgrade
// style, some style is very messy so user can't review info easily".
//
// There were six places to look. /reports was an index of buttons with the work
// market in a few lines at the top; /reports/<span>/<key> was the period report;
// /reports/<day> listed a day's field briefings; /work listed platforms; each
// field had its own briefing; and the months, years and days were three more
// button walls. A reader had to know which one answered their question.
//
// Now there is one page, for any day, week, month or year, and it reads top to
// bottom as an answer:
//
//   1. The market for work       how hiring, seekers, remote and contract moved
//   2. Kinds of work             which grew, appeared or shrank, and how crowded
//   3. Skills                    what roles newly ask for
//   4. Where to take the work    the kinds worth going after, and the platforms
//   5. Hiring across the economy postings by sector, against the rest of hiring
//   6. What changed in technology the period's reading: work, openings, shifts
//   7. Field briefings           the newest word on each subject in the period
//   8. Every report              other periods, recent days, one field over time
//
// /reports opens it on the latest month, because the hiring threads the first
// four sections count are monthly. The span switcher and the previous/next links
// move the same page through time; nothing about the layout changes with them.
//
// Nothing here describes where the numbers came from beyond what a reader needs
// to read them ([[reports-say-nothing-about-sources]]): a unit, a comparison, a
// scale.

import { escapeHtml, wrap, truncate, icon } from './html.ts';
import { FIELDS } from '../vocab/fields.ts';
import {
  periodReport, periodIndex, latestDay, keyFor, rangeFor, SPAN_LABEL, SPANS,
  type Span, type PeriodReport, type PeriodRow, type Range,
} from '../analysis/period.ts';
import { periodReading } from '../analysis/periodread.ts';
import {
  briefingsIn, reportIndex, type StoredStrategy, type ReportDay, type PeriodBriefing,
} from '../analysis/briefing.ts';
import { workPicture, type WorkPicture } from '../analysis/workmarket.ts';
import { techOf, techGap, controlsOf, EDGE as LABOUR_EDGE, type LabourPicture } from '../analysis/labour.ts';
import { readingBlock, notRead, findingsBlock, downloadsBlock } from './period.ts';
import {
  workGlance, workKinds, workSkills, workWhere, workBoards, workPlatforms, tile, delta,
  type PlatformRow,
} from './workmarket.ts';

const DAY_MS = 86_400_000;

const SPAN_NAME: Record<Span, string> = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' };

/** The key of the period before or after this one. */
export function stepKey(span: Span, key: string, dir: -1 | 1): string {
  if (span === 'year') return String(Number(key) + dir);
  if (span === 'month') {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1 + dir, 1)).toISOString().slice(0, 7);
  }
  const at = new Date(`${keyFor(span, key)}T00:00:00Z`).getTime();
  return new Date(at + dir * (span === 'week' ? 7 : 1) * DAY_MS).toISOString().slice(0, 10);
}

/** The day inside this range that the other spans should open on. */
function anchorOf(range: Range, latest: string): string {
  const last = new Date(Date.parse(range.to) - DAY_MS).toISOString().slice(0, 10);
  return last < latest ? last : latest < range.from.slice(0, 10) ? range.from.slice(0, 10) : latest;
}

interface Section { id: string; nav: string; title: string; lede?: string; body: string }

function section(s: Section): string {
  return `<section class="rp-section" id="${s.id}">
    <header class="rp-section-head"><h2>${s.title}</h2>${s.lede ? `<p>${s.lede}</p>` : ''}</header>
    ${s.body}
  </section>`;
}

function masthead(span: Span, key: string, range: Range, latest: string): string {
  const anchor = anchorOf(range, latest);
  const seg = SPANS.map((s) => {
    const k = keyFor(s, anchor);
    return `<a href="/reports/${s}/${encodeURIComponent(k)}"${s === span
      ? ' class="on" aria-current="page"' : ''}>${SPAN_NAME[s]}</a>`;
  }).join('');

  const prev = stepKey(span, key, -1);
  const next = stepKey(span, key, 1);
  const prevRange = rangeFor(span, prev);
  const nextRange = rangeFor(span, next);
  const nextOpen = nextRange && nextRange.from.slice(0, 10) <= latest;

  const dek: Record<Span, string> = {
    day: 'The market for remote technical work as it stood on this day, where to take it, and what each field reported.',
    week: 'The market for remote technical work this week, where to take it, and what changed in technology.',
    month: 'How the market for remote technical work moved this month, where to take it, and what changed in technology.',
    year: 'How the market for remote technical work moved this year, where to take it, and what changed in technology.',
  };

  return `<header class="rp-mast">
    <div class="rp-kicker">${SPAN_NAME[span]} report</div>
    <h1 class="rp-title">${escapeHtml(range.label)}</h1>
    <p class="rp-dek">${dek[span]}</p>
    <div class="rp-controls">
      <nav class="rp-seg" aria-label="Report length">${seg}</nav>
      <nav class="rp-step" aria-label="Neighbouring reports">
        ${prevRange ? `<a rel="prev" href="/reports/${span}/${encodeURIComponent(prev)}">← ${
    escapeHtml(prevRange.label)}</a>` : ''}
        ${nextRange ? (nextOpen
    ? `<a rel="next" href="/reports/${span}/${encodeURIComponent(next)}">${escapeHtml(nextRange.label)} →</a>`
    : `<span aria-disabled="true">${escapeHtml(nextRange.label)} →</span>`) : ''}
      </nav>
    </div>
  </header>`;
}

/** Postings by sector, and technology against the rest of hiring. */
export function hiringBlock(p: LabourPicture, span: Span): string {
  if (p.days < LABOUR_EDGE * 2) return '';
  const tech = techOf(p);
  if (tech.length === 0) return '';
  const gap = techGap(p);
  const software = tech.find((m) => m.sector === 'Software Development');
  const remoteSw = p.remote.find((m) => m.sector === 'techsoftware');
  const signedPct = (n: number) => `${n >= 0 ? '+' : ''}${n}%`;
  const move = (n: number) => `<span class="${Math.abs(n) < 1 ? 'flat' : n > 0 ? 'good' : 'bad'}"><b>${
    Math.abs(n) < 1 ? '=' : n > 0 ? '▲' : '▼'} ${Math.abs(n)}%</b></span>`;

  const tiles = [
    software ? tile('Software postings', software.end.toFixed(1),
      `${move(software.changePct)} <span>across this ${SPAN_LABEL[span]}</span>`) : '',
    gap ? tile('Technology against the rest of hiring', signedPct(gap.gap),
      `<span>technology ${signedPct(gap.tech)}, other sectors ${signedPct(gap.control)}</span>`) : '',
    remoteSw ? tile('Software postings offering remote', `${remoteSw.end.toFixed(1)}%`,
      delta(remoteSw.end, remoteSw.start, { better: 'up', unit: 'pts',
        was: `from ${remoteSw.start.toFixed(1)}% at the start` })) : '',
    p.ai ? tile('All postings mentioning AI', `${p.ai.end.toFixed(2)}%`,
      `<span>from ${p.ai.start.toFixed(2)}% at the start</span>`) : '',
  ].join('');

  const max = Math.max(100, ...tech.flatMap((m) => [m.start, m.end]));
  const w = (v: number) => Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1);

  return `<div class="rp-tiles">${tiles}</div>
    <div class="rp-scroll"><table class="rp-table">
      <thead><tr><th scope="col">Sector</th><th scope="col" class="num">Start</th>
        <th scope="col" class="num">End</th><th scope="col" class="rp-barcol">Level, 100 = February 2020</th>
        <th scope="col" class="num">Change</th></tr></thead>
      <tbody>${tech.map((m) => `<tr>
        <th scope="row">${escapeHtml(m.sector)}</th>
        <td class="num">${m.start.toFixed(1)}</td>
        <td class="num"><b>${m.end.toFixed(1)}</b></td>
        <td class="rp-barcol"><span class="rp-bar" role="img" aria-label="${m.end.toFixed(1)}, from ${
  m.start.toFixed(1)}"><span class="rp-bar-now" style="width:${w(m.end)}%"></span>
          <span class="rp-bar-was" style="left:${w(m.start)}%"></span>
          <span class="rp-bar-mark" style="left:${w(100)}%"></span></span></td>
        <td class="num ${m.changePct >= 1 ? 'up' : m.changePct <= -1 ? 'down' : ''}">${signedPct(m.changePct)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="rp-legend"><span><i class="now"></i>end of the ${SPAN_LABEL[span]}</span>
      <span><i class="was"></i>start</span><span><i class="mark"></i>February 2020 level</span></p>
    ${gap === null ? '' : `<p class="rp-callout">${Math.abs(gap.gap) < 2
    ? `Technology moved with the rest of hiring this ${SPAN_LABEL[span]}: ${signedPct(gap.tech)} against
       ${signedPct(gap.control)} across ${controlsOf(p).length} other sectors.`
    : `Technology ${gap.gap > 0 ? 'outpaced' : 'fell behind'} the rest of hiring by
       <b>${Math.abs(gap.gap)} points</b>: ${signedPct(gap.tech)} against ${signedPct(gap.control)} across
       ${controlsOf(p).length} other sectors such as nursing, construction and accounting.`}</p>`}`;
}

function fieldsBlock(bs: PeriodBriefing[], span: Span): string {
  if (bs.length === 0) return '';
  const short = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `<div class="rp-fields">${bs.map((b) => {
    const f = FIELDS.find((x) => x.slug === b.field);
    return `<a class="rp-field" href="/field/${encodeURIComponent(b.field)}/report/${b.day}">
      <span class="rp-field-top">${f ? icon(f.icon, 14) : ''}${escapeHtml(b.label)}
        <time datetime="${b.day}">${short(b.day)}</time></span>
      <span class="rp-field-head">${escapeHtml(truncate(b.headline, 130))}</span>
      <span class="rp-field-more">${b.themes} finding${b.themes === 1 ? '' : 's'}${
  span !== 'day' && b.days > 1 ? ` · briefed on ${b.days} days this ${SPAN_LABEL[span]}` : ''}</span>
    </a>`;
  }).join('')}</div>`;
}

function archiveBlock(
  span: Span, key: string, months: PeriodRow[], years: PeriodRow[], days: ReportDay[],
): string {
  const link = (s: Span, rows: PeriodRow[]) => `<ul class="rp-chips">${rows.map((r) =>
    `<li><a class="rp-chip${s === span && r.key === key ? ' on' : ''}" href="/reports/${s}/${
      encodeURIComponent(r.key)}">${escapeHtml(r.label)}</a></li>`).join('')}</ul>`;
  const short = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return `<div class="rp-archive">
    ${months.length === 0 ? '' : `<div><h3>Months</h3>${link('month', months)}</div>`}
    ${years.length === 0 ? '' : `<div><h3>Years</h3>${link('year', years)}</div>`}
    ${days.length === 0 ? '' : `<div><h3>Recent days</h3><ul class="rp-daylist">${days.map((d) => `<li>
      <a href="/reports/${d.day}"${span === 'day' && d.day === key ? ' aria-current="page"' : ''}>
        <time datetime="${d.day}">${short(d.day)}</time>
        <span>${escapeHtml(d.title.replace(/\s+[—-]\s+\d+ fields? briefed.*$/, ''))}</span>
        <span class="n">${d.fields} field${d.fields === 1 ? '' : 's'}</span></a></li>`).join('')}</ul></div>`}
    <div><h3>One field over time</h3><ul class="rp-chips">${FIELDS.map((f) => `<li>
      <a class="rp-chip" href="/field/${encodeURIComponent(f.slug)}/report">${escapeHtml(f.label)}</a></li>`).join('')}</ul>
      <p class="rp-note"><a href="/reports/periods">Every week, month and year</a> ·
        <a href="/work">Every platform, by kind of work</a></p></div>
  </div>`;
}

/**
 * One report, for any period. Every section is omitted rather than rendered
 * empty when its period has nothing for it, and the contents bar lists only the
 * sections that are there.
 */
export async function renderReport(span: Span, rawKey: string): Promise<string> {
  const range = rangeFor(span, rawKey);
  if (!range) {
    return wrap(`<div class="rp"><header class="rp-mast"><div class="rp-kicker">Report</div>
      <h1 class="rp-title">No ${SPAN_LABEL[span]} at “${escapeHtml(rawKey)}”</h1>
      <p class="rp-dek">A day and a week are named YYYY-MM-DD, a month YYYY-MM, and a year YYYY.</p>
      <div class="rp-controls"><nav class="rp-step"><a href="/reports">← This month’s report</a></nav></div>
      </header></div>`);
  }
  const key = span === 'week' ? keyFor('week', rawKey) : rawKey;

  const [r, reading, work, platforms, briefs, latest, months, years, days] = await Promise.all([
    periodReport(span, key).catch((): PeriodReport | null => null),
    span === 'day' ? Promise.resolve(null) : periodReading(span, key).catch(() => null),
    workPicture(range).catch((): WorkPicture | null => null),
    workPlatforms(),
    briefingsIn(range).catch((): PeriodBriefing[] => []),
    latestDay().catch(() => new Date().toISOString().slice(0, 10)),
    periodIndex('month', undefined, 18).catch((): PeriodRow[] => []),
    periodIndex('year', undefined, 30).catch((): PeriodRow[] => []),
    reportIndex(8).catch((): ReportDay[] => []),
  ]);

  const label = SPAN_LABEL[span];
  const yearAgo = 'Compared with the same month a year earlier.';
  const sections: Section[] = [];

  if (work?.now) {
    sections.push({ id: 'work', nav: 'At a glance', title: 'The market for work',
      lede: `Roles posted and people looking for work in the monthly hiring threads. ${yearAgo}`,
      body: workGlance(work, span) });
    sections.push({ id: 'kinds', nav: 'Kinds of work', title: 'Which kinds of work are growing, new or shrinking',
      lede: 'Share of roles asking for each kind of work, and share of job seekers offering it. '
        + 'Fewer seekers than roles means fewer candidates for each role.',
      body: workKinds(work) });
    const skills = workSkills(work);
    if (skills) {
      sections.push({ id: 'skills', nav: 'Skills', title: 'Skills that moved most',
        lede: 'Share of roles naming each skill, largest moves first.', body: skills });
    }
    sections.push({ id: 'where', nav: 'Where to find work', title: 'Where to take the work',
      lede: 'The kinds of work that are new, growing or short of candidates, and the platforms that carry them.',
      body: `${workWhere(work, platforms as PlatformRow[])}
        ${work.boards.length || work.bounties ? `<h3 class="rp-h3">What the remote boards are carrying</h3>
        ${workBoards(work)}` : ''}` });
  } else if (work) {
    sections.push({ id: 'work', nav: 'At a glance', title: 'The market for work',
      body: workGlance(work, span) });
  }

  const hiring = r ? hiringBlock(r.labour, span) : '';
  if (hiring) {
    sections.push({ id: 'hiring', nav: 'Hiring overall', title: 'Hiring across the economy',
      lede: `Job postings in the United States by sector, indexed so that 100 is each sector’s level on
        1 February 2020, from the start of this ${label} to its end.`,
      body: hiring });
  }

  const news = reading
    ? readingBlock(reading.strategy as StoredStrategy, reading, span)
    : r ? `${findingsBlock(r, false)}${span === 'day' ? '' : notRead(r, span)}` : '';
  const installs = r ? downloadsBlock(r) : '';
  if (news.trim() || installs.trim()) {
    sections.push({ id: 'technology', nav: 'Technology', title: 'What changed in technology',
      lede: reading ? `What this ${label} changed, read against what came before it.` : '',
      body: `${news}${installs.trim() ? `<details class="rp-fold"><summary>What developers install more, and less</summary>
        <div class="rp-fold-body">${installs}</div></details>` : ''}` });
  }

  const fields = fieldsBlock(briefs, span);
  if (fields) {
    sections.push({ id: 'fields', nav: 'Field briefings', title: 'Field briefings',
      lede: span === 'day' ? 'What each field reported on this day.'
        : `The newest briefing each field has in this ${label}.`,
      body: fields });
  }

  sections.push({ id: 'archive', nav: 'Every report', title: 'Every report',
    body: archiveBlock(span, key, months, years, days) });

  const toc = `<nav class="rp-toc" aria-label="On this page">${sections.map((s) =>
    `<a href="#${s.id}">${s.nav}</a>`).join('')}</nav>`;

  return wrap(`<div class="rp">
    ${masthead(span, key, range, latest)}
    ${toc}
    ${sections.map(section).join('')}
  </div>`);
}

/** /reports: the latest month, which is the span the hiring threads are counted over. */
export async function renderReportHome(): Promise<string> {
  const latest = await latestDay().catch(() => new Date().toISOString().slice(0, 10));
  return renderReport('month', latest.slice(0, 7));
}

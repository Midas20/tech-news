// Week, month and year reports, and the day summary that leads /reports.
//
// Asked for on 2026-09-09: "at the top of list, you have to display report that
// summary all day's news and about new market and things like tool, platform
// and so on. And make weekly report and month report. And generate a year's
// report by collecting all news."
//
// One renderer for all four spans. They differ in how much they show and in
// what the caveats have to say, not in shape -- and building four pages that
// drift apart is how the same question gets four different answers.

import { wrap, pageHead, empty, escapeHtml, truncate } from './html.ts';
import { crumbsFor } from './nav.ts';
import { fieldLabel } from '../vocab/fields.ts';
import {
  periodReport, spanKeys, latestDay, SPAN_LABEL, SPANS,
  type Span, type PeriodReport, type PeriodMovement, type PeriodFinding,
} from '../analysis/period.ts';
import type { NewThing, NewName } from '../analysis/whatsnew.ts';

const NUM = new Intl.NumberFormat('en-US');

/** One story, as a line. First-party is marked, as it is everywhere else. */
function line(t: NewThing): string {
  return `<li>
    <a href="/read/${escapeHtml(t.id)}">${escapeHtml(truncate(t.title, 110))}</a>
    <span class="muted">${escapeHtml(t.source)} &middot; ${escapeHtml(t.when)}${
  t.independent ? '' : ' &middot; <span class="bf-fp">says so itself</span>'}</span>
  </li>`;
}

function nameCard(n: NewName): string {
  return `<li>
    <a href="/search?q=${encodeURIComponent(n.name)}">${escapeHtml(n.name)}</a>
    <span class="muted">${n.sources === 1 ? 'one source' : `${n.sources} sources`}
      &middot; ${escapeHtml(n.stories[0]!.when)}</span>
  </li>`;
}

/**
 * The curve table: the only magnitudes on the page.
 *
 * Every number here was published by PyPI, npm or crates.io and can be re-run
 * by anybody against the same public API. Nothing counted from this archive
 * appears as a number anywhere, because an archive count measures the feed list.
 */
function curves(ms: PeriodMovement[], span: Span): string {
  if (ms.length === 0) return '';
  const row = (m: PeriodMovement) => `<tr>
    <td><a href="/stack/${encodeURIComponent(m.slug)}">${escapeHtml(m.slug)}</a>
      <span class="muted">${escapeHtml(m.registry)}:${escapeHtml(m.package)}</span></td>
    <td class="num">${NUM.format(Math.round(m.before))}</td>
    <td class="num">${NUM.format(Math.round(m.after))}</td>
    <td class="num ${m.changePct >= 0 ? 'up' : 'down'}">${
  m.changePct >= 0 ? '+' : ''}${m.changePct}%</td>
  </tr>`;
  return `
    <h2 class="sect">What the public numbers did over this ${SPAN_LABEL[span]}</h2>
    <p class="note">Daily downloads from the registry that publishes each
      package, averaged over ${ms[0]!.edge} days at each end of the period.
      <b>Downloads are not users:</b> a CI run that installs a package every
      commit is counted, and a company mirroring it internally is not.
      These are the only figures on this page, and every one of them is
      published by somebody else.</p>
    <div class="mv-scroll"><table class="mv-curve">
      <thead><tr><th>Technology</th><th class="num">Start of period</th>
        <th class="num">End of period</th><th class="num">Change</th></tr></thead>
      <tbody>${ms.map(row).join('')}</tbody>
    </table></div>`;
}

function findings(fs: PeriodFinding[], span: Span): string {
  if (fs.length === 0) return '';
  return `
    <h2 class="sect">What the readings found</h2>
    <p class="note">The claims the daily readings made inside this
      ${SPAN_LABEL[span]}, in the words they were written in and not
      re-summarised. Each links to the field report that argued it, where the
      stories at both ends are.</p>
    <ul class="mv-elsewhere">${fs.map((f) => `<li>
      <a href="/field/${encodeURIComponent(f.field)}/report/${escapeHtml(f.day)}">${
  escapeHtml(truncate(f.text, 190))}</a>
      <span class="muted">${escapeHtml(fieldLabel(f.field))} &middot; ${
  escapeHtml(f.day)}</span></li>`).join('')}</ul>`;
}

/** The three lists, shared by the period page and the lead card. */
export function bodyOf(r: PeriodReport): string {
  const more = (shown: number, total: number) =>
    (total > shown ? ` <span class="muted">${total - shown} more not listed.</span>` : '');

  return `
    ${r.names.length === 0 ? '' : `
      <h2 class="sect">Names this archive had never seen</h2>
      <p class="note">Read out of the launch and funding headlines below, and in
        none of the registries this archive holds. A name two publishers reached
        for is corroborated; one is a claim. <b>This is a weaker test than it
        looks:</b> it only finds a name somebody put in a headline in a form a
        pattern recognises, so an absence here means nothing at all.</p>
      <ul class="mv-new-names">${r.names.map(nameCard).join('')}</ul>`}

    ${r.market.length === 0 ? '' : `
      <h2 class="sect">Money and ownership moved</h2>
      <p class="note">Who was funded, who bought whom, and at what number &mdash;
        the second of this archive&rsquo;s two collection targets.${
  more(r.market.length, r.totals.market)}</p>
      <ul class="bf-cites">${r.market.map(line).join('')}</ul>`}

    ${r.launches.length === 0 ? '' : `
      <h2 class="sect">Introduced, not updated</h2>
      <p class="note">The event classifier&rsquo;s verdict that a story
        introduces something rather than changing something that already
        existed.${more(r.launches.length, r.totals.launches)}</p>
      <ul class="bf-cites">${r.launches.map(line).join('')}</ul>`}

    ${curves(r.movements, r.span)}
    ${findings(r.findings, r.span)}`;
}

/** The other spans, as links, so a reader can widen or narrow the same view. */
function spanNav(span: Span, keys: Record<Span, string>): string {
  return `<div class="bf-fields">${SPANS.map((s) => `<a class="btn${
    s === span ? ' on' : ''}" href="/reports/${s}/${encodeURIComponent(keys[s])}">${
    s === 'day' ? 'This day' : `This ${SPAN_LABEL[s]}`}</a>`).join('')}</div>`;
}

/** The keys that cover the same instant at every span, for that nav. */
function siblingKeys(range: { from: string }): Record<Span, string> {
  const d = new Date(range.from);
  const day = d.toISOString().slice(0, 10);
  return { day, week: day, month: day.slice(0, 7), year: day.slice(0, 4) };
}

export async function renderPeriodReport(span: Span, key: string): Promise<string> {
  const r = await periodReport(span, key).catch(() => null);
  const crumbs = crumbsFor('/reports', 'Reports');

  if (!r) {
    return wrap(`${pageHead('Report', `No ${SPAN_LABEL[span]} at “${key}”`, { crumbs })}
      ${empty('That is not a period this archive can report on. A day and a week '
        + 'are named YYYY-MM-DD, a month YYYY-MM, and a year YYYY.', 'book')}`);
  }

  const nothing = r.launches.length + r.market.length + r.names.length
    + r.movements.length + r.findings.length === 0;

  return wrap(`
    ${pageHead(`${r.range.label}`,
    `Everything that appeared, moved or was read over this ${SPAN_LABEL[span]}`,
    { crumbs })}

    ${spanNav(span, siblingKeys(r.range))}

    <p class="note"><b>Nothing on this page was written by a model.</b> The
      lists are the pipeline&rsquo;s own verdicts about which stories introduce
      something rather than update it; the figures come from public package
      registries; the claims are quoted from the daily readings that already
      argued them. A ${SPAN_LABEL[span]} of stories does not fit in a prompt,
      and a report that needs a provider is a report that is missing on the day
      every provider is rate-limited &mdash; which is the day this was written.</p>

    ${nothing
    ? empty(`No launch, market move or public curve fell inside this ${SPAN_LABEL[span]}. `
      + 'That is a statement about what these sources published and what this '
      + 'archive caught, not about the industry.', 'sparkle')
    : bodyOf(r)}

    <h2 class="sect">What this cannot tell you</h2>
    <div class="mv-caveat">
      <p><b>Nothing here is counted.</b> How many launches this archive caught in
        a ${SPAN_LABEL[span]} is a fact about its feed list, so the lists are
        shown and never totalled into a trend. The only figures on the page are
        the download curves, and those are somebody else&rsquo;s measurements.</p>
      <p><b>A launch is a claim that something is new</b>, made by whoever
        published it. This page passes that claim on with its source attached
        and does not check it.</p>
      <p><b>The period is only as good as the collection under it.</b> A quiet
        ${SPAN_LABEL[span]} here may be a quiet ${SPAN_LABEL[span]} in the
        industry or a ${SPAN_LABEL[span]} when this archive was not
        collecting, and this page cannot tell you which.</p>
    </div>`);
}

/**
 * The lead card at the top of /reports.
 *
 * "at the top of list, you have to display report that summary all day's news
 * and about new market and things like tool, platform and so on."
 *
 * The reports index led with fourteen field links and then a list of days, so
 * the first thing on the page was navigation and the second was an archive. A
 * reader opening /reports wants to know what happened, and the answer to that
 * is not per-field: a launch belongs to whichever field its words matched, and
 * a funding round belongs to none of them.
 */
export async function leadCard(): Promise<string> {
  const day = await latestDay().catch(() => new Date().toISOString().slice(0, 10));
  const r = await periodReport('day', day).catch(() => null);
  if (!r) return '';
  const today = new Date().toISOString().slice(0, 10);

  const counts: string[] = [];
  if (r.names.length) counts.push(`${r.names.length} new name${r.names.length === 1 ? '' : 's'}`);
  if (r.market.length) counts.push(`${r.market.length} market move${r.market.length === 1 ? '' : 's'}`);
  if (r.launches.length) counts.push(`${r.launches.length} launch${r.launches.length === 1 ? '' : 'es'}`);
  if (r.movements.length) counts.push(`${r.movements.length} public curve${r.movements.length === 1 ? '' : 's'}`);

  return `
    <h2 class="sect">${day === today ? 'Today' : escapeHtml(r.range.label)},
      across every field</h2>
    <p class="note">What appeared rather than what happened inside a category
      &mdash; launches, funding and acquisitions, and names this archive had
      never seen. ${counts.length === 0
    ? 'Nothing was classified as new.'
    : `${escapeHtml(counts.join(', '))}.`}${day === today ? ''
    : ' <span class="muted">The most recent day this archive holds stories for; '
      + 'the archive works in UTC, so the calendar day turns over before the '
      + 'morning’s collection has run.</span>'}</p>
    <div class="bf-fields">
      <a class="btn" href="/reports/day/${day}">The whole day</a>
      <a class="btn" href="/reports/week/${day}">This week</a>
      <a class="btn" href="/reports/month/${day.slice(0, 7)}">This month</a>
      <a class="btn" href="/reports/year/${day.slice(0, 4)}">This year</a>
    </div>`;
}

/** The month and year keys a reader can open, for the index. */
export async function periodLinks(): Promise<string> {
  const [months, years] = await Promise.all([
    spanKeys('month', undefined, 12).catch(() => []),
    spanKeys('year', undefined, 20).catch(() => []),
  ]);
  if (months.length === 0 && years.length === 0) return '';
  const btns = (span: Span, ks: Array<{ key: string; label: string }>) =>
    ks.map((k) => `<a class="btn" href="/reports/${span}/${encodeURIComponent(k.key)}">${
      escapeHtml(k.label)}</a>`).join('');
  return `
    ${months.length === 0 ? '' : `
      <h2 class="sect">By month</h2>
      <p class="note">Every calendar month this archive holds stories for.</p>
      <div class="bf-fields">${btns('month', months)}</div>`}
    ${years.length === 0 ? '' : `
      <h2 class="sect">By year</h2>
      <p class="note">The whole year, composed from everything collected in it.
        The earliest years hold back-catalogue items that arrived with old
        publication dates, so they are thinner than a year of collection.</p>
      <div class="bf-fields">${btns('year', years)}</div>`}`;
}

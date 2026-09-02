// The analysis pages: what the archive read, what it concluded, and every
// report it has written.
//
// Replaces the movement report, which compared story counts between two windows
// and called the ratio a finding. Rejected on 2026-09-01 -- "don't count news,
// it is fake value because we can't collect all news" -- and the objection is
// unanswerable. This archive sees what 352 feeds carry. The denominator is every
// technology story published anywhere, which nobody has, so a share is a
// measurement of the feed list wearing the clothes of a market finding.
//
// WHAT THESE PAGES SHOW INSTEAD, in the order a reader needs it:
//
//   the finding    prose, written from the text of the stories.
//   the evidence   under EVERY finding, the stories it was drawn from. Not at
//                  the bottom of the page as a bibliography -- next to the
//                  claim, because a citation a reader has to go looking for is
//                  a citation they will not check.
//   what is known  public GitHub figures with the date they were measured. The
//                  only quantities on the page, and none of them are ours.
//   the gaps       what the stories did not settle, in the writer's own words.
//
// EVERY REPORT IS KEPT AND ADDRESSABLE. Asked for on 2026-09-01: the report must
// "list that compose each report for each day and each fields". So there are two
// axes and a page for each cell:
//
//   /reports                     every day, with its fields under it
//   /reports/<day>               one day, every field
//   /field/<slug>/report         one field, latest, with its own history
//   /field/<slug>/report/<day>   one field, one day
//   /trends/report               the latest day, whole (administrators)
//
// NOTHING IS GENERATED ON VIEW. Briefings are written once a day by the `report`
// job and read back here. Writing on view would cost a model call per refresh
// and, worse, would give two people looking at the same archive two different
// reports -- and a report that changes when you reload is not a report.

import { wrap, pageHead, empty, escapeHtml, truncate, icon } from './html.ts';
import { crumbsFor } from './nav.ts';
import { FIELDS, fieldLabel } from '../vocab/fields.ts';
import {
  archiveFor, briefingFor, latestForField, daysForField, reportIndex, reportDay,
  type StoredField, type StoredArchive, type StoredTheme, type FieldDay, type ReportDay,
} from '../analysis/briefing.ts';
import { describeFigure, type PublicFigure } from '../analysis/public.ts';

export { reportDay };

/** Paragraphs, from prose written with blank lines between them. */
function paras(body: string, cls = 'mv-body'): string {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p class="${cls}">${escapeHtml(p)}</p>`).join('');
}

/** A day, as a person says it. */
function niceDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** A stored timestamp, trimmed to the minute. */
function stamp(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

/**
 * The citations under one finding.
 *
 * First-party is marked, not hidden. A vendor announcing its own release is
 * authoritative about what shipped and worthless as evidence that anyone wanted
 * it, and a reader can only weigh a claim if they can see which of the two they
 * are being given.
 */
function citations(evidence: StoredTheme['evidence']): string {
  if (evidence.length === 0) return '';
  return `<ul class="bf-cites">${evidence.map((e) => `<li>
    <a href="/read/${escapeHtml(e.id)}">${escapeHtml(truncate(e.title, 120))}</a>
    <span class="muted">${escapeHtml(e.source)} &middot; ${escapeHtml(e.kind)}
      &middot; ${escapeHtml(e.when)}${e.independent ? ''
    : ' &middot; <span class="bf-fp">first-party</span>'}</span>
  </li>`).join('')}</ul>`;
}

function themeBlock(t: StoredTheme): string {
  return `<section class="bf-theme">
    <h4>${escapeHtml(t.title)}</h4>
    ${paras(t.body)}
    <details class="bf-ev"${t.evidence.length <= 3 ? ' open' : ''}>
      <summary>${t.evidence.length} ${t.evidence.length === 1 ? 'story' : 'stories'}
        behind this</summary>
      ${citations(t.evidence)}
    </details>
  </section>`;
}

/**
 * The public figures.
 *
 * Every number on these pages lives in this block, and every one of them was
 * measured by somebody else. That is the point: a reader can check a GitHub
 * topic count, and cannot check how many stories we happened to catch.
 */
function figuresBlock(figures: PublicFigure[]): string {
  if (!figures || figures.length === 0) {
    return `<p class="note">No public figure has been measured for the technologies in
      this briefing, so it states no size or adoption number at all.</p>`;
  }
  return `<p class="note">Measured outside this archive, by GitHub. These are the only
      quantities on this page &mdash; nothing here counts our own stories, because how
      much of a subject this archive happens to catch is a fact about the feed list.</p>
    <ul class="bf-figs">${figures.map((f) => `<li>
      <a href="/trend/${encodeURIComponent(f.slug)}">${escapeHtml(f.name)}</a>
      <span class="muted">${escapeHtml(describeFigure(f).replace(`${f.name}: `, ''))}</span>
    </li>`).join('')}</ul>`;
}

/** How much reading a briefing rests on. A fact about the evidence, not the field. */
function readLine(b: StoredField): string {
  const r = b.read;
  return `Written from ${r.read} ${r.read === 1 ? 'story' : 'stories'} across `
    + `${r.sources} ${r.sources === 1 ? 'source' : 'sources'}: `
    + `${r.independent} independent, ${r.firstParty} speaking for the subject. `
    + `Published between ${stamp(b.coveredFrom)} and ${stamp(b.coveredTo)}, capped so `
    + 'that no publisher and no project can speak for the field.';
}

function fieldSection(b: StoredField, open: boolean): string {
  const f = FIELDS.find((x) => x.slug === b.field);
  const href = `/field/${encodeURIComponent(b.field)}/report/${b.day}`;
  return `<section class="bf-field" id="${escapeHtml(b.field)}">
    <h3 class="bf-h">${f ? icon(f.icon, 16) : ''}
      <a href="${href}">${escapeHtml(b.label)}</a></h3>
    <p class="bf-head">${escapeHtml(b.headline)}</p>
    <p class="mv-lede">${escapeHtml(b.summary)}</p>
    ${open ? b.themes.map(themeBlock).join('') : `<details class="bf-more">
      <summary>${b.themes.length} finding${b.themes.length === 1 ? '' : 's'},
        with the stories behind them</summary>
      ${b.themes.map(themeBlock).join('')}</details>`}
    ${b.gaps ? `<p class="note bf-gap"><b>What these stories could not tell us.</b>
      ${escapeHtml(b.gaps)}</p>` : ''}
    <p class="note">${escapeHtml(readLine(b))}</p>
  </section>`;
}

function watchBlock(items: string[]): string {
  if (items.length === 0) return '';
  return `<ul class="mv-list">${items.map((w) =>
    `<li>${escapeHtml(w)}</li>`).join('')}</ul>`;
}

/** What a report covered, said rather than implied. */
function coverNote(a: { coveredFrom: string | null; coveredTo: string | null }): string {
  if (!a.coveredFrom || !a.coveredTo) return '';
  return `Everything published between ${escapeHtml(stamp(a.coveredFrom))} and
    ${escapeHtml(stamp(a.coveredTo))} that this archive caught and could read.`;
}

/**
 * Fields that had evidence and got no briefing anyway.
 *
 * A SEPARATE LINE FROM "quiet", and the separation is the point. On 2026-09-01 a
 * fortnight of back reports was generated; the model hit its rate limit after
 * four days and the remaining ten came back as fourteen quiet fields each. The
 * page would have told the reader that the industry was silent for ten days
 * while the archive held some 1,800 readable stories from them.
 *
 * So this says what actually happened, names the fields, and says how much went
 * unread -- because the size of a gap is the reader's business.
 */
function missingBlock(unwritten: StoredArchive['unwritten']): string {
  if (!unwritten || unwritten.length === 0) return '';
  const n = unwritten.length;
  const read = unwritten.reduce((t, u) => t + (u.read ?? 0), 0);
  const why = [...new Set(unwritten.map((u) => u.why))];
  return `<li><b>${n} field${n === 1 ? '' : 's'} had stories and no briefing.</b>
    ${unwritten.map((u) => escapeHtml(fieldLabel(u.field))).join(', ')} &mdash;
    ${read.toLocaleString('en-US')} ${read === 1 ? 'story was' : 'stories were'} selected
    and went unread. ${escapeHtml(why.join('; '))}. This is a gap in the archive's
    account of the period, not a quiet spell: something happened in
    ${n === 1 ? 'that field' : 'those fields'} and this report does not say what.</li>`;
}

/**
 * Said once, on every analysis page.
 *
 * A reader who does not know that this archive is a sample will read a briefing
 * as a survey of the industry. That misunderstanding is the one this rewrite
 * exists to prevent, so it is stated rather than buried in a footer.
 */
function limits(a: StoredArchive): string {
  const quiet = a.quiet.map((s) => fieldLabel(s));
  return `<ul class="mv-list">
    <li><b>This is a sample and the sample is not measured.</b> The archive holds what
      its sources publish. Everything technology publishes anywhere is the denominator,
      nobody has it, and so nothing here counts stories to make a point. A finding is
      something the text of several stories says; it is never something their number
      implies.</li>
    <li><b>Every finding is capped and cited.</b> No publisher contributes more than four
      stories to a field and no project more than three, so a project that ships daily
      cannot out-argue an industry. A finding that cited nothing was discarded before
      this page was written, not marked.</li>
    <li><b>Absence is not evidence.</b> ${quiet.length === 0
    ? 'Every field had enough text to read this period.'
    : `${quiet.length} field${quiet.length === 1 ? '' : 's'} produced too little to write
        from: ${quiet.map(escapeHtml).join(', ')}. That is a statement about coverage,
        not about ${quiet.length === 1 ? 'that field' : 'those fields'}.`}</li>
    ${missingBlock(a.unwritten)}
    <li><b>Written by a model, from the stories and nothing else.</b> It was given their
      text and forbidden to name anything absent from it. Open the citations under any
      claim and it is either there or it is not &mdash; which is the only guarantee
      worth offering.</li>
  </ul>`;
}

const NOT_YET = `The <code>report</code> job writes one briefing a day, reading everything
  that arrived since the day before. None has been written yet.`;

// ---------------------------------------------------------------------------
// One day, whole
// ---------------------------------------------------------------------------

/**
 * The archive on one day. `null` for the latest.
 *
 * Fields are ordered by how much independent corroboration each reading had
 * rather than by how much of it there was: a field where six unrelated outlets
 * agree is worth reading before one where a single vendor published forty times.
 */
export async function renderArchiveReport(day: string | null): Promise<string> {
  const a = await archiveFor(day).catch(() => null);

  if (!a || a.briefings.length === 0) {
    return wrap(`${pageHead('Intelligence briefing',
      'What the archive read, and what it concluded.',
      { crumbs: crumbsFor('/trends/report', 'Reports') })}
      ${empty(day ? `No report was written on ${escapeHtml(niceDay(day))}.` : NOT_YET,
    'book')}
      <p class="note" style="text-align:center">
        <a href="/reports">Every report written so far</a></p>`);
  }

  const ordered = [...a.briefings].sort(
    (x, y) => (y.read?.independent ?? 0) - (x.read?.independent ?? 0));
  const watch = ordered.flatMap((f) => f.watch.map((w) => `${f.label}: ${w}`));
  const providers = [...new Set(ordered.map((f) => f.provider).filter(Boolean))];
  const seen = new Set<string>();
  const uniqueFigures = ordered.flatMap((f) => f.figures ?? [])
    .filter((f) => (seen.has(f.slug) ? false : seen.add(f.slug)))
    .sort((x, y) => (y.projects ?? 0) - (x.projects ?? 0)).slice(0, 15);

  return wrap(`
    ${pageHead(a.title, 'What the archive read, field by field, and what it concluded',
    { crumbs: crumbsFor('/trends/report', niceDay(a.day)) })}
    <p class="note">${coverNote(a)}
      <a href="/reports">See every report written so far</a>.</p>

    <h2 class="sect">The findings</h2>
    <p class="note">${ordered.length} field${ordered.length === 1 ? '' : 's'} briefed on
      ${escapeHtml(a.day)}. Each finding carries the stories it was drawn from; open one
      and the claim is either in it or it is not.</p>
    ${ordered.map((f, i) => fieldSection(f, i < 2)).join('')}

    <h2 class="sect">What is actually known about size</h2>
    ${figuresBlock(uniqueFigures)}

    <h2 class="sect">What to watch</h2>
    ${watch.length === 0
    ? '<p class="note">Nothing this period was firm enough to follow.</p>'
    : watchBlock(watch)}

    <h2 class="sect">What this cannot tell you</h2>
    ${limits(a)}
    <p class="note">Written ${escapeHtml(a.day)} by
      ${providers.length ? escapeHtml(providers.join(', ')) : 'an unnamed model'},
      from the stories cited above and nothing else.</p>`);
}

// ---------------------------------------------------------------------------
// One field
// ---------------------------------------------------------------------------

/** A field's own history: every day it was briefed, newest first. */
function fieldHistory(slug: string, days: FieldDay[], current: string): string {
  const others = days.filter((d) => d.day !== current);
  if (others.length === 0) {
    return '<p class="note">This is the only briefing written for this field so far.</p>';
  }
  return `<ul class="bf-days">${others.map((d) => `<li>
    <a href="/field/${encodeURIComponent(slug)}/report/${d.day}">
      <span class="bf-when">${escapeHtml(niceDay(d.day))}</span>
      <span class="bf-what">${escapeHtml(truncate(d.headline, 100))}</span></a>
    <span class="muted">${d.themes} finding${Number(d.themes) === 1 ? '' : 's'} &middot;
      ${d.independent} independent of ${d.read} read</span>
  </li>`).join('')}</ul>`;
}

/**
 * One field, fully expanded. `null` for the day means its most recent briefing.
 *
 * Nothing is collapsed here -- the reader already chose the subject, so there is
 * no reason to make them choose again.
 */
export async function renderFieldBriefing(
  slug: string, day: string | null,
): Promise<string> {
  const field = FIELDS.find((f) => f.slug === slug);
  if (!field) return wrap(pageHead('Unknown field', 'Not a root of the taxonomy.'));

  const crumbs = crumbsFor(`/field/${slug}/report`, field.label);
  const b = await (day ? briefingFor(slug, day) : latestForField(slug)).catch(() => null);
  const history = await daysForField(slug, 30).catch((): FieldDay[] => []);

  if (!b) {
    return wrap(`
      ${pageHead(`${field.label}: briefing`,
      day ? `Nothing written for this field on ${niceDay(day)}.`
        : 'Nothing written for this field yet.', { crumbs })}
      ${empty(history.length > 0
    ? `No briefing for ${field.label} on that day. Too little arrived to write from, `
      + 'which is a statement about coverage rather than about the field.'
    : NOT_YET, 'book')}
      ${history.length > 0 ? `<h2 class="sect">Briefings for ${escapeHtml(field.label)}</h2>
        ${fieldHistory(slug, history, '')}` : ''}
      <p class="note" style="text-align:center">
        <a href="/field/${encodeURIComponent(slug)}">See the stories themselves</a></p>`);
  }

  return wrap(`
    ${pageHead(b.headline || `${field.label}: briefing`,
    `${field.label}, ${niceDay(b.day)}`, { crumbs })}
    <p class="note">${coverNote({ coveredFrom: b.coveredFrom, coveredTo: b.coveredTo })}</p>
    <p class="mv-lede">${escapeHtml(b.summary)}</p>

    <h2 class="sect">The findings</h2>
    ${b.themes.map(themeBlock).join('')}

    <h2 class="sect">What is actually known about size</h2>
    ${figuresBlock(b.figures ?? [])}

    ${b.watch.length === 0 ? '' : `<h2 class="sect">What to watch</h2>${watchBlock(b.watch)}`}

    <h2 class="sect">What this cannot tell you</h2>
    <ul class="mv-list">
      ${b.gaps ? `<li><b>In the writer's own words.</b> ${escapeHtml(b.gaps)}</li>` : ''}
      <li><b>${escapeHtml(readLine(b))}</b> Nothing above counts stories to make a point:
        what this archive happens to catch is a fact about its feed list, not about
        ${escapeHtml(field.label)}.</li>
    </ul>

    <h2 class="sect">Earlier briefings for ${escapeHtml(field.label)}</h2>
    ${fieldHistory(slug, history, b.day)}

    <p class="note">Written ${escapeHtml(b.day)} by
      ${escapeHtml(b.provider ?? 'an unnamed model')}, from the cited stories and nothing
      else. <a href="/field/${encodeURIComponent(slug)}">See the stories themselves</a>.</p>`);
}

// ---------------------------------------------------------------------------
// Every report ever written
// ---------------------------------------------------------------------------

/**
 * One day in the index, with its fields under it.
 *
 * Each row leads with what the briefing FOUND. The old index led with how many
 * stories a field produced, which is a number about the feed list and not an
 * answer to any question a reader has.
 */
function dayBlock(d: ReportDay, open: boolean): string {
  const rows = d.briefings.map((b) => {
    const f = FIELDS.find((x) => x.slug === b.field);
    return `<li>
      <a href="/field/${encodeURIComponent(b.field)}/report/${d.day}">
        <span class="bf-when">${f ? icon(f.icon, 14) : ''}
          ${escapeHtml(b.label)}</span>
        <span class="bf-what">${escapeHtml(truncate(b.headline, 100))}</span></a>
      <span class="muted">${b.themes} finding${b.themes === 1 ? '' : 's'}</span>
    </li>`;
  }).join('');

  return `<section class="bf-day">
    <h3 class="bf-h"><a href="/reports/${d.day}">${escapeHtml(niceDay(d.day))}</a></h3>
    <p class="bf-head">${escapeHtml(d.title)}</p>
    <p class="note">${d.fields} field${d.fields === 1 ? '' : 's'} briefed,
      ${d.themes} finding${d.themes === 1 ? '' : 's'}, written from ${d.read}
      ${d.read === 1 ? 'story' : 'stories'} across ${d.sources}
      ${d.sources === 1 ? 'source' : 'sources'}.${d.quiet.length
    ? ` Too little to write from in ${d.quiet.map(
      (s) => escapeHtml(fieldLabel(s))).join(', ')}.` : ''}${(d.unwritten ?? []).length
    ? ` <span class="bf-fp">Not written for ${d.unwritten.map(
      (u) => escapeHtml(fieldLabel(u.field))).join(', ')}</span> &mdash; there were
      stories and no briefing.` : ''}</p>
    ${open ? `<ul class="bf-days">${rows}</ul>`
    : `<details class="bf-more"><summary>${d.briefings.length}
        briefing${d.briefings.length === 1 ? '' : 's'}</summary>
        <ul class="bf-days">${rows}</ul></details>`}
  </section>`;
}

/**
 * One day, as an index rather than as the whole briefing.
 *
 * NOT the same page as `/trends/report`, and the difference is a permission.
 * The composed whole-archive view is administrators only -- it states what the
 * archive cannot support as readily as what it can. Rendering that same content
 * here would have handed it to every reader through a second address, which is
 * a gate with a door beside it.
 *
 * So a reader gets what a reader is entitled to: the day's title, what it read,
 * and a way into each field's briefing -- which has always been theirs.
 */
/**
 * One day, as an index rather than as the whole briefing.
 *
 * NOT the same page as `/trends/report`, and the difference is a permission. The
 * composed whole-archive view is administrators only -- it states what the
 * archive cannot support as readily as what it can. Rendering that same content
 * here would have handed it to every reader through a second address, which is a
 * gate with a door beside it.
 *
 * So a reader gets what a reader is entitled to: the day's title, what it read,
 * and a way into each field's briefing -- which has always been theirs.
 */
export async function renderReportDay(day: string): Promise<string> {
  const [d] = await reportIndex(1, undefined, day).catch((): ReportDay[] => []);

  if (!d) {
    return wrap(`${pageHead('Report', `Nothing was written on ${niceDay(day)}.`,
      { crumbs: crumbsFor(`/reports/${day}`, 'Reports') })}
      ${empty(`No report exists for ${escapeHtml(niceDay(day))}. The job writes one a `
    + 'day; a missing day is one it did not run, or one that had too little to read.',
    'book')}
      <p class="note" style="text-align:center">
        <a href="/reports">Every report written so far</a></p>`);
  }

  return wrap(`
    ${pageHead(d.title, `Everything briefed on ${niceDay(d.day)}`,
    { crumbs: crumbsFor(`/reports/${d.day}`, niceDay(d.day)) })}
    <p class="note">${coverNote(d)}</p>
    <h2 class="sect">The briefings</h2>
    ${dayBlock(d, true)}
    <p class="note" style="text-align:center">
      <a href="/reports">Every report written so far</a></p>`);
}

/**
 * Every report, by day and by field.
 *
 * Asked for on 2026-09-01 -- the report must "list that compose each report for
 * each day and each fields". Both axes are on one page rather than two, because
 * "what did we say about cloud last Tuesday" needs the day and the field
 * together, and a page per axis makes that two navigations.
 */
export async function renderReportIndex(): Promise<string> {
  const days = await reportIndex(30).catch((): ReportDay[] => []);

  if (days.length === 0) {
    return wrap(`${pageHead('Reports',
      'Every briefing this archive has written, by day and by field.',
      { crumbs: crumbsFor('/reports', 'Reports') })}
      ${empty(NOT_YET, 'book')}`);
  }

  const fieldLinks = FIELDS.map((f) => `<a class="btn"
    href="/field/${encodeURIComponent(f.slug)}/report">${icon(f.icon, 14)}
    ${escapeHtml(f.label)}</a>`).join('');

  return wrap(`
    ${pageHead('Reports',
    'Every briefing this archive has written. One report a day, one section per field, '
    + 'each written from the stories that arrived since the day before and citing them.',
    { crumbs: crumbsFor('/reports', 'Reports') })}

    <h2 class="sect">Follow one field</h2>
    <p class="note">The latest briefing for a field, with every earlier one under it.</p>
    <div class="bf-fields">${fieldLinks}</div>

    <h2 class="sect">Every report, by day</h2>
    ${days.map((d, i) => dayBlock(d, i === 0)).join('')}`);
}

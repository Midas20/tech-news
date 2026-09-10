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
  type StoredStrategy, type Citation, type Standing, type StoredWork, standingFor,
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
  // Everything this field has concluded before today. Null when there is only
  // one reading, which is the honest state for a young archive.
  const standing = b
    ? await standingFor(slug, b.day, 30).catch((): Standing | null => null)
    : null;

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

    ${/* ONE LEDE, NOT TWO. The page opened with the briefing's summary and then
        the reading's own one-liner directly underneath, two serif paragraphs
        saying overlapping things before any heading -- the single biggest cause
        of the page reading as a wall. The reading wins when there is one,
        because it is the conclusion rather than the recap; the briefing summary
        moves down to introduce the stories it actually describes. */
      b.strategy?.read
        ? `<p class="mv-lede">${escapeHtml(b.strategy.read)}</p>`
        : `<p class="mv-lede">${escapeHtml(b.summary)}</p>`}

    ${b.strategy
    ? strategyBlock(b.strategy, `/field/${encodeURIComponent(slug)}/report/${b.day}`)
    : noStrategy(b.strategyGap ?? 'none was written')}

    <h2 class="sect">The stories this was read from</h2>
    <p class="note">${b.strategy?.read ? `${escapeHtml(b.summary)} ` : ''}Everything
      here is an event, cited; nothing here is a conclusion.</p>
    ${b.themes.map(themeBlock).join('')}

    ${(b.figures ?? []).length === 0 ? '' : `
      <h2 class="sect">What is actually known about size</h2>
      ${figuresBlock(b.figures ?? [])}`}

    ${b.watch.length === 0 ? '' : `<h2 class="sect">What to watch</h2>${watchBlock(b.watch)}`}

    ${/* EVERY CAVEAT IN ONE BLOCK. They used to be scattered: a note under the
        reading, another under the history line, a third under the provider, and
        a bulleted list of its own down here. Sprinkled hedging reads as evasion
        and is skipped; gathered, it reads as a limit and gets read. */''}
    <h2 class="sect">What this cannot tell you</h2>
    <div class="mv-caveat">
      ${b.strategy?.limits ? `<p><b>On the reading.</b>
        ${escapeHtml(b.strategy.limits)}</p>` : ''}
      ${b.gaps ? `<p><b>On the stories.</b> ${escapeHtml(b.gaps)}</p>` : ''}
      <p><b>${escapeHtml(readLine(b))}</b> Nothing above counts stories to make a
        point: what this archive happens to catch is a fact about its feed list,
        not about ${escapeHtml(field.label)}.</p>
      ${b.strategy?.history ? `<p>The reading was set against
        ${b.strategy.history.n} earlier ${b.strategy.history.n === 1 ? 'story' : 'stories'}
        on the same subjects, published between
        ${escapeHtml(b.strategy.history.from)} and
        ${escapeHtml(b.strategy.history.to)}.</p>` : ''}
      ${b.strategy?.provider ? `<p>The reading was written by
        ${escapeHtml(b.strategy.provider)}.</p>` : ''}
    </div>

    ${standing ? standingBlock(standing, field.label)
    : `<h2 class="sect">What the recent readings have established</h2>
      <p class="note">Nothing yet. This is the first reading written for
      ${escapeHtml(field.label)}, so there is no run of earlier claims to set it
      against. This section fills as the readings accumulate.</p>`}

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

/**
 * The reading: what the stories mean, above what they say.
 *
 * PLACED FIRST ON THE PAGE, and that is the whole point of the section. The
 * complaint on 2026-09-09 was that a briefing repeated a Databricks conference
 * post -- "I need strategy info in report not repeat of news, The news is only
 * data that prove your analysis result". A reader who has to scroll past the
 * retelling to reach the reading is reading a news summary with an appendix.
 *
 * Every claim carries its citations inline, so the evidence is one click away
 * from the sentence it supports rather than in a list at the bottom.
 */
/**
 * The reading, as an INDEX rather than as the whole thing.
 *
 * Asked for on 2026-09-09: "the report have to simple with core content and
 * when user click each content, show detail page."
 *
 * The page had grown to 41KB of prose for one field. Every section was worth
 * having and all of them together were a wall, which is the failure mode of
 * adding good sections one at a time -- each addition is defensible and the sum
 * is unreadable. A reader arriving at a field report wants to know what changed
 * and what work there is, in a shape they can scan in twenty seconds, and then
 * to open the one item that matters to them.
 *
 * So this renders the CLAIM and one line of why, and nothing else. The
 * reasoning, both ends of the evidence, the falsifier and the citations move to
 * a page per item. Nothing is deleted and nothing is summarised by a model --
 * the detail page shows the same stored text this page truncates.
 */
function strategyBlock(s: StoredStrategy, base: string): string {
  const card = (
    kind: string, i: number, title: string, line: string, tag = '',
  ): string => `<a class="mv-item" href="${base}/${kind}/${i + 1}">
      <h3>${escapeHtml(title)}${tag}</h3>
      <p>${escapeHtml(truncate(line, 190))}</p>
    </a>`;

  // WHAT CHANGED, FIRST AND IN ONE SENTENCE. `moved` is written to be exactly
  // this: the change named in terms a reader can disagree with. The before and
  // after paragraphs, and the stories at both ends, are on its own page.
  const shift = !s.shift ? '' : `
    <h2 class="sect">What has changed in this field</h2>
    <a class="mv-item mv-lead" href="${base}/shift/1">
      <p class="mv-moved">${escapeHtml(s.shift.moved)}</p>
      <span class="mv-more">Then and now, with the stories at both ends</span>
    </a>`;

  const HORIZON: Record<StoredWork['horizon'], string> = {
    now: 'the work exists now',
    months: 'as the change lands',
    watch: 'plausible, unproven',
  };
  const work = !s.work?.length ? '' : `
    <h2 class="sect">Where the work is</h2>
    <p class="note">Things one person could start on remotely, with the evidence
      that somebody would pay for it.</p>
    <div class="mv-items">${s.work.map((w, i) => card('work', i, w.what, w.why,
    ` <span class="mv-tag ${w.horizon}">${escapeHtml(HORIZON[w.horizon] ?? w.horizon)}</span>`))
    .join('')}</div>`;

  const direction = s.direction.length === 0 ? '' : `
    <h2 class="sect">Where this is going</h2>
    <div class="mv-items">${s.direction.map((d, i) =>
    card('direction', i, d.claim, d.reasoning)).join('')}</div>`;

  const positioning = s.positioning.length === 0 ? '' : `
    <h2 class="sect">What each company appears to be betting on</h2>
    <div class="mv-items">${s.positioning.map((pz, i) =>
    card('positioning', i, pz.who, pz.bet,
      pz.firstParty ? ' <span class="mv-tag watch">says so itself</span>' : '')).join('')}</div>`;

  const tensions = !s.tensions?.length ? '' : `
    <h2 class="sect">Where the evidence argues with itself</h2>
    <div class="mv-items">${s.tensions.map((t, i) =>
    card('tension', i, t.what, t.sides)).join('')}</div>`;

  const openings = s.openings.length === 0 ? '' : `
    <h2 class="sect">What nobody has taken</h2>
    <div class="mv-items">${s.openings.map((o, i) =>
    card('opening', i, o.what, o.why)).join('')}</div>`;

  return `${shift}${curvesBlock(s)}${work}${direction}${positioning}`
    + `${tensions}${openings}${elsewhereBlock(s)}`;
}

/**
 * What the public numbers did.
 *
 * Kept on the index rather than moved to a detail page, because it is already
 * the compact form of itself: four rows with their dates. There is no longer
 * version of it to click through to.
 */
function curvesBlock(s: StoredStrategy): string {
  if (!s.outside?.movements.length) return '';
  return `
    <h2 class="sect">What the public numbers did</h2>
    <p class="note">Mean installs per day at each end of the window, from the
      registry that publishes the package. Measured by them, not by us, and
      anybody can re-run the query. <b>Downloads are not users</b> &mdash; they
      include continuous integration and mirrors.</p>
    <table class="mv-curve">
      <thead><tr><th>Technology</th><th>Then</th><th>Now</th><th>Move</th></tr></thead>
      <tbody>${s.outside.movements.map((m) => `<tr>
        <td>${escapeHtml(m.slug)}
          <span class="muted">${escapeHtml(m.registry)}:${escapeHtml(m.package)}</span></td>
        <td class="num">${m.before.toLocaleString('en-US')}
          <span class="muted">${escapeHtml(m.fromDay)}</span></td>
        <td class="num">${m.after.toLocaleString('en-US')}
          <span class="muted">${escapeHtml(m.toDay)}</span></td>
        <td class="num ${m.changePct >= 0 ? 'up' : 'down'}">
          ${m.changePct >= 0 ? '+' : ''}${m.changePct}%</td>
      </tr>`).join('')}</tbody>
    </table>`;
}

/** Coverage this archive does not hold. Folded away: it is background. */
function elsewhereBlock(s: StoredStrategy): string {
  if (!s.outside?.stories.length) return '';
  return `
    <details class="bf-more">
      <summary>${s.outside.stories.length} stories elsewhere that this archive
        never collected</summary>
      <p class="note">From the public Hacker News index, oldest first. Headlines
        and dates only &mdash; the bodies were not fetched, so nothing here is
        summarised. Points are attention on one site on one day.</p>
      <ul class="mv-elsewhere">${s.outside.stories.map((o) => `<li>
        <a href="${escapeHtml(o.url ?? '#')}" rel="noreferrer noopener"
           target="_blank">${escapeHtml(truncate(o.title, 110))}</a>
        <span class="muted">${escapeHtml(o.when)}${o.host ? ` &middot; ${escapeHtml(o.host)}` : ''}${
  o.score != null ? ` &middot; ${o.score} points` : ''}</span>
      </li>`).join('')}</ul>
    </details>`;
}

/** The kinds of finding that have a page of their own. */
export const ITEM_KINDS = [
  'shift', 'work', 'direction', 'positioning', 'tension', 'opening',
] as const;
export type ItemKind = typeof ITEM_KINDS[number];

export function isItemKind(x: string): x is ItemKind {
  return (ITEM_KINDS as readonly string[]).includes(x);
}

/**
 * One finding, in full, on its own page.
 *
 * WHAT THIS PAGE IS FOR, and it is not merely "the same text with more room".
 * The index shows a claim; this shows whether to believe it. So the order is
 * the order a sceptic reads in: the claim, the reasoning, THE EVIDENCE AT BOTH
 * ENDS side by side, and then what would show it wrong.
 *
 * Addressed by (day, kind, index) rather than by an id, because the reading is
 * stored as one jsonb document per field per day and its arrays have no ids of
 * their own. That makes the index positional and therefore stable only for a
 * stored report -- which is exactly the guarantee needed, since a stored report
 * never changes. A report re-run for the same day overwrites the whole document
 * and the links go with it.
 */
export async function renderReportItem(
  slug: string, day: string, kind: ItemKind, n: number,
): Promise<string> {
  const field = FIELDS.find((f) => f.slug === slug);
  if (!field) return wrap(pageHead('Unknown field', 'Not a root of the taxonomy.'));

  const b = await briefingFor(slug, day).catch(() => null);
  const base = `/field/${encodeURIComponent(slug)}/report/${day}`;
  const crumbs = crumbsFor(`${base}/${kind}/${n}`, field.label);
  const back = `<p class="note"><a href="${base}">&larr; ${escapeHtml(field.label)},
    ${escapeHtml(niceDay(day))}</a></p>`;

  const s = b?.strategy;
  if (!b || !s) {
    return wrap(`${pageHead('Nothing here',
      'No reading was stored for this field on this day.', { crumbs })}
      ${empty(NOT_YET, 'book')}${back}`);
  }

  const i = n - 1;
  const cited = (cs: Citation[] | undefined, heading: string, note = ''): string =>
    !cs?.length ? '' : `<div>
      <h3>${escapeHtml(heading)}</h3>
      ${note ? `<p class="note">${note}</p>` : ''}
      ${citations(cs)}
    </div>`;

  // Both ends beside each other, because a claim about change is only checkable
  // as a comparison and a reader should not have to hold one half in their head.
  const bothEnds = (then: Citation[] | undefined, now: Citation[]): string => `
    <div class="mv-then-now">
      ${cited(then, then?.length ? `Then, from ${then[0]!.when}` : 'Then')
    || `<div><h3>Then</h3><p class="note">This reading was written before the
        earlier end was stored, so only today&rsquo;s stories are linked.</p></div>`}
      ${cited(now, 'Now') || '<div><h3>Now</h3></div>'}
    </div>`;

  let title = '';
  let body = '';

  if (kind === 'shift' && s.shift) {
    title = 'What has changed in this field';
    body = `
      <p class="mv-moved">${escapeHtml(s.shift.moved)}</p>
      <div class="mv-then-now">
        <div>
          <h3>Then${s.shift.then.length
    ? ` &middot; ${escapeHtml(s.shift.then.map((c) => c.when).sort()[0]!)}` : ''}</h3>
          <p>${escapeHtml(s.shift.before)}</p>
          ${citations(s.shift.then)}
        </div>
        <div>
          <h3>Now${s.shift.now[0] ? ` &middot; ${escapeHtml(s.shift.now[0].when)}` : ''}</h3>
          <p>${escapeHtml(s.shift.after)}</p>
          ${citations(s.shift.now)}
        </div>
      </div>`;
  } else if (kind === 'work' && s.work?.[i]) {
    const w = s.work[i]!;
    const HORIZON: Record<StoredWork['horizon'], string> = {
      now: 'The work exists now.',
      months: 'It will as the change lands.',
      watch: 'Plausible, unproven.',
    };
    title = w.what;
    body = `
      <p class="mv-body">${escapeHtml(w.why)}</p>
      <dl class="mv-facts">
        ${w.skills ? `<dt>What it needs</dt><dd>${escapeHtml(w.skills)}</dd>` : ''}
        <dt>Timing</dt><dd>${escapeHtml(HORIZON[w.horizon] ?? w.horizon)}</dd>
      </dl>
      ${cited(w.evidence, 'The evidence that somebody would pay for this')}`;
  } else if (kind === 'direction' && s.direction[i]) {
    const d = s.direction[i]!;
    title = d.claim;
    body = `
      <p class="mv-body">${escapeHtml(d.reasoning)}</p>
      ${bothEnds(d.then, d.now)}
      ${d.falsifier ? `<div class="mv-caveat"><p><b>What would show this
        wrong.</b> ${escapeHtml(d.falsifier)}</p></div>` : ''}`;
  } else if (kind === 'positioning' && s.positioning[i]) {
    const pz = s.positioning[i]!;
    title = pz.who;
    body = `
      <p class="mv-body">${escapeHtml(pz.bet)}</p>
      ${pz.firstParty ? `<div class="mv-caveat"><p><b>Read from what they say
        about themselves.</b> Good evidence of what they have decided to sell,
        and none at all that anybody bought it.</p></div>` : ''}
      ${cited(pz.evidence, 'What this was read from')}`;
  } else if (kind === 'tension' && s.tensions?.[i]) {
    const t = s.tensions[i]!;
    title = t.what;
    body = `<p class="mv-body">${escapeHtml(t.sides)}</p>
      ${cited(t.evidence, 'The sources that disagree')}`;
  } else if (kind === 'opening' && s.openings[i]) {
    const o = s.openings[i]!;
    title = o.what;
    body = `
      <p class="mv-body">${escapeHtml(o.why)}</p>
      ${o.who ? `<dl class="mv-facts"><dt>Who could take it</dt>
        <dd>${escapeHtml(o.who)}</dd></dl>` : ''}
      ${cited(o.evidence, 'What this was read from')}`;
  }

  if (!title) {
    return wrap(`${pageHead('Nothing here',
      'That reading has no item at this position.', { crumbs })}
      ${empty('The report for this day does not contain it. It may have been '
      + 'written again since the link was made.', 'book')}${back}`);
  }

  return wrap(`
    ${pageHead(title, `${field.label}, ${niceDay(day)}`, { crumbs })}
    ${body}
    <div class="mv-caveat">
      <p><b>${escapeHtml(readLine(b))}</b></p>
      ${s.history ? `<p>The reading was set against ${s.history.n} earlier
        ${s.history.n === 1 ? 'story' : 'stories'}, from
        ${escapeHtml(s.history.from)} to ${escapeHtml(s.history.to)}.</p>` : ''}
      ${s.limits ? `<p><b>On the reading as a whole.</b>
        ${escapeHtml(s.limits)}</p>` : ''}
    </div>
    ${back}`);
}

/** Said plainly when there is no reading, so an absence is never a finding. */
function noStrategy(why: string): string {
  return `<p class="note"><b>No strategic reading for this field today.</b>
    ${escapeHtml(why)}. That is a statement about what this archive holds, not a
    statement that nothing changed.</p>`;
}

/**
 * What the recent readings have established, at the end of the report.
 *
 * Asked for on 2026-09-09: "at the end of report add report that show the
 * analysis result that earn from recent news". One morning is a reading; a
 * fortnight of mornings is a position. Each day was previously written and then
 * never referred to again, so the archive accumulated evidence and forgot its
 * own conclusions.
 *
 * Every claim here was validated and cited on the day it was made, so this
 * paraphrases nothing -- it lists them with their dates and their falsifiers and
 * lets the reader judge which have held. The falsifier is the point: a claim
 * from three weeks ago whose falsifier has since fired is the most useful line
 * on the page, and the reader can only see that if it is still written down.
 */
function standingBlock(st: Standing, label: string): string {
  const claims = st.claims.length === 0 ? '' : `
    <ul class="mv-list">
      ${st.claims.map((c) => `<li>
        <b>${escapeHtml(c.claim)}</b>
        <span class="muted">— read on ${escapeHtml(niceDay(c.day))}</span>
        ${c.falsifier ? `<div class="note">Would be shown wrong by:
          ${escapeHtml(c.falsifier)}</div>` : ''}
      </li>`).join('')}
    </ul>`;

  const openings = st.openings.length === 0 ? '' : `
    <h3 class="sect">Gaps named and still open</h3>
    <ul class="mv-list">
      ${st.openings.map((o) => `<li>${escapeHtml(o.what)}
        ${o.who ? `<span class="muted">— ${escapeHtml(o.who)}</span>` : ''}
        <span class="muted">(${escapeHtml(niceDay(o.day))})</span></li>`).join('')}
    </ul>`;

  return `
    <h2 class="sect">What the recent readings have established</h2>
    <p class="note">Every claim made about ${escapeHtml(label)} in the
      ${st.readings} earlier reading${st.readings === 1 ? '' : 's'} between
      ${escapeHtml(niceDay(st.from))} and ${escapeHtml(niceDay(st.to))}, with
      what would show each one wrong. Nothing here is re-summarised: these are
      the claims as they were written and cited on the day, so a reading that
      has since been overtaken is visible rather than quietly dropped.</p>
    ${claims}${openings}`;
}

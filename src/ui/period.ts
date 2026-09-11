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

import { wrap, pageHead, empty, escapeHtml, truncate, niceDay } from './html.ts';
import { crumbsFor } from './nav.ts';
import { periodReading, type StoredPeriodReading } from '../analysis/periodread.ts';
import type { StoredStrategy } from '../analysis/briefing.ts';
import { fieldLabel } from '../vocab/fields.ts';
import {
  periodReport, spanKeys, latestDay, periodIndex, keyFor, edgeFor,
  SPAN_LABEL, SPANS,
  type Span, type PeriodReport, type PeriodMovement, type PeriodFinding, type FindingCite,
  type PeriodRow, type CohortBreak,
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
 * The measurement moved, so no curve in this period means anything.
 *
 * A SUPPRESSED NUMBER HAS TO SAY IT IS SUPPRESSED. An empty section reads as
 * "nothing moved", which is the opposite of what happened and worse than either
 * the wrong number or the right one.
 */
function brokenCurves(shift: CohortBreak, span: Span): string {
  const dir = shift.medianPct < 0 ? 'fell' : 'rose';
  return `
    <h2 class="sect">What the public numbers did over this ${SPAN_LABEL[span]}</h2>
    <div class="mv-caveat">
      <p><b>No curve is shown for this ${SPAN_LABEL[span]}, because the
        measurement changed inside it.</b> On
        <b>${escapeHtml(shift.day)}</b>, ${shift.agreed} of ${shift.total}
        tracked packages ${dir} together by a median of
        ${Math.abs(shift.medianPct)}%, and stayed there.</p>
      <p>Unrelated projects do not gain or lose a third of their downloads in the
        same week. A move shared by every subject is a fact about the instrument,
        not about adoption &mdash; the registry changed how it counts, which is
        usually mirror or bot filtering. Each package&rsquo;s number would look
        like a plausible decline on its own, which is exactly why they are
        withheld together: there is no subset that survives a step in the
        instrument, so publishing the two that moved least would only be
        publishing the same error smaller.</p>
      <p>Periods that lie wholly on one side of
        ${escapeHtml(shift.day)} are unaffected and still show their curves.</p>
    </div>`;
}

/**
 * The curve table: the only magnitudes on the page.
 *
 * Every number here was published by PyPI, npm or crates.io and can be re-run
 * by anybody against the same public API. Nothing counted from this archive
 * appears as a number anywhere, because an archive count measures the feed list.
 */
/**
 * Why a period shows no curve when nothing is broken.
 *
 * Same argument as `brokenCurves`: an absent section reads as "nothing moved".
 * For a week the reason is permanent and worth stating once rather than leaving
 * a reader to wonder every time.
 */
function noCurves(span: Span, days: number): string {
  const why = edgeFor(days) === 0
    ? `A ${SPAN_LABEL[span]} is too short to measure one. Downloads run on a
       seven-day cycle &mdash; a Sunday is a third of a Tuesday &mdash; so a
       comparison is only meaningful across whole weeks, and two whole weeks do
       not fit inside one. Asking anyway produced a spurious 30&ndash;45% fall
       for <em>every</em> package in <em>every</em> week, which was the weekend
       and not the market.`
    : `The tracked packages do not yet have enough days inside this
       ${SPAN_LABEL[span]} for a comparison. A curve appears once the period
       holds two whole weeks of series at each end.`;
  return `
    <h2 class="sect">What the public numbers did over this ${SPAN_LABEL[span]}</h2>
    <p class="note"><b>No curve for this ${SPAN_LABEL[span]}.</b> ${why}</p>`;
}

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
    <p class="note">Mean daily downloads over ${ms[0]!.edge} days at each end,
      published by the registry. <b>Downloads are not users.</b></p>
    <div class="mv-scroll"><table class="mv-curve">
      <thead><tr><th>Technology</th><th class="num">Start of period</th>
        <th class="num">End of period</th><th class="num">Change</th></tr></thead>
      <tbody>${ms.map(row).join('')}</tbody>
    </table></div>`;
}

/**
 * The period's own reading, when it has one.
 *
 * 2026-09-10, against /reports/month/2026-07: "hey kidding me?" -- at a page
 * that explained at length why it had no analysis. The explanation rested on a
 * claim ("a period of stories does not fit in a prompt") that was true of the
 * year it was written about and had never been checked against a month. July
 * holds 360 readable stories; a daily briefing already reads 80.
 *
 * So a period is now read in its own right, once, against the stories that came
 * before it -- and this renders what it found. Same shape as a daily reading,
 * because it is produced by the same function over a longer window.
 *
 * NO DETAIL PAGES. A field reading's cards link to `/field/<f>/report/<day>/
 * <kind>/<n>`, which exists because a daily briefing is a stored row with a
 * route. A period is composed on demand, so the evidence is inline: the two
 * ends under each claim, and nothing deeper to click into.
 */
function readingBlock(s: StoredStrategy, r: StoredPeriodReading, span: Span): string {
  const claim = (title: string, body: string, then: unknown, now: unknown,
    compared: boolean, tag = '') => `<article class="pr-card">
      <p class="pr-claim">${escapeHtml(title)}${tag}</p>
      ${body ? `<p class="mv-body">${escapeHtml(truncate(body, 420))}</p>` : ''}
      ${pair(then, now, compared)}
    </article>`;

  /**
   * The evidence under a claim.
   *
   * TWO SHAPES, BECAUSE THERE ARE TWO KINDS OF CLAIM. A shift or a direction
   * asserts that something CHANGED, so it has two ends and both belong on the
   * page -- and a missing earlier end has to say so, or a one-sided claim reads
   * as a comparison that was made and won.
   *
   * Work, positioning and openings assert something about the present. They
   * were never paired and there is no earlier end to be missing. Rendering
   * "Before: no earlier story on this subject is held" under them, which the
   * first version did, reports a comparison as failed that was never attempted
   * -- inventing a gap in the evidence rather than describing one.
   */
  const pair = (then: unknown, now: unknown, compared: boolean): string => {
    const t = asCites(then);
    const n = asCites(now);
    if (t.length === 0 && n.length === 0) return '';
    if (!compared) {
      return `<div class="pr-ends pr-one"><div class="pr-end">
        <h4>Evidence</h4><ul>${endOf(n)}</ul></div></div>`;
    }
    return `<div class="pr-ends">
      ${t.length === 0
    ? `<div class="pr-end"><h4>Before</h4><p class="muted">No earlier story on
         this subject is held, so this rests on the present alone.</p></div>`
    : `<div class="pr-end"><h4>Before</h4><ul>${endOf(t)}</ul></div>`}
      ${n.length === 0 ? ''
    : `<div class="pr-end"><h4>In this ${escapeHtml(SPAN_LABEL[span])}</h4>
         <ul>${endOf(n)}</ul></div>`}
    </div>`;
  };

  const HORIZON: Record<string, string> = {
    now: 'the work exists now', months: 'as the change lands',
    watch: 'plausible, unproven',
  };

  const sections = [
    s.shift ? `<h2 class="sect">What changed over this ${SPAN_LABEL[span]}</h2>
      <div class="mv-items">${claim(s.shift.moved, s.shift.after ?? '',
    s.shift.then, s.shift.now, true)}</div>` : '',

    (s.work ?? []).length === 0 ? '' : `
      <h2 class="sect">Where the work is</h2>
      <p class="note">Things one person could start on remotely, with the
        evidence that somebody would pay for it.</p>
      <div class="mv-items">${s.work.map((w) => claim(w.what, w.why, [], w.evidence, false,
    ` <span class="mv-tag ${escapeHtml(w.horizon)}">${
      escapeHtml(HORIZON[w.horizon] ?? w.horizon)}</span>`)).join('')}</div>`,

    (s.direction ?? []).length === 0 ? '' : `
      <h2 class="sect">Where this is going</h2>
      <div class="mv-items">${s.direction.map((d) =>
    claim(d.claim, d.reasoning, d.then, d.now, true)).join('')}</div>`,

    (s.positioning ?? []).length === 0 ? '' : `
      <h2 class="sect">What each company appears to be betting on</h2>
      <div class="mv-items">${s.positioning.map((p) => claim(p.who, p.bet, [],
    p.evidence, false, p.firstParty
      ? ' <span class="mv-tag watch">says so itself</span>' : '')).join('')}</div>`,

    (s.openings ?? []).length === 0 ? '' : `
      <h2 class="sect">What nobody has taken</h2>
      <div class="mv-items">${s.openings.map((o) =>
    claim(o.what, o.why, [], o.evidence, false)).join('')}</div>`,
  ].filter(Boolean).join('');

  // WHOSE PERIOD THIS IS, ABOVE THE READING RATHER THAN IN ITS FOOTNOTES.
  //
  // These years were refused outright until 2026-09-10 on exactly this number.
  // Refusing was wrong -- a narrow corpus makes a reading partial, not false,
  // and partial is what `limits` is for -- but the number is real and burying it
  // under the analysis would be the other half of the same mistake. A reader who
  // sees "2019" as a heading will assume the year; this is what stops them.
  const narrow = (r.sourcesRead !== null && r.sourcesRead < 12)
    || (r.topShare !== null && r.topShare > 60);

  return `
    ${!narrow ? '' : `<div class="mv-caveat">
      <p><b>This is a reading of ${r.sourcesRead} publishers, not of the
        ${escapeHtml(SPAN_LABEL[span])}.</b> ${r.topShare}% of the
        ${r.storiesRead} stories behind it come from the three largest, because
        that is what this archive holds for the period &mdash; blogs with deep
        archives a backfill could walk. Everything below describes what those
        publishers did. It is not a survey of the industry and the difference
        matters most exactly where the two would disagree.</p>
    </div>`}
    ${s.read ? `<p class="mv-lede">${escapeHtml(s.read)}</p>` : ''}
    ${sections}
    ${s.limits ? `<p class="note"><b>What this cannot settle.</b>
      ${escapeHtml(s.limits)}</p>` : ''}
    <p class="note">Read from ${r.storiesRead} stories published in this
      ${escapeHtml(SPAN_LABEL[span])}${r.historyRead
  ? `, against ${r.historyRead} earlier ${r.historyRead === 1 ? 'story' : 'stories'}
      on the same subjects${r.historyFrom
    ? ` going back to ${escapeHtml(niceDay(r.historyFrom))}` : ''}` : ''}${
  r.provider ? `, by ${escapeHtml(r.provider)}` : ''}. The stories were
      diversified first, so no publisher and no project can speak for the
      ${escapeHtml(SPAN_LABEL[span])}.</p>`;
}

/**
 * Why this period has no reading of its own, in the numbers that decided it.
 *
 * "Generate all report of 10 years" (2026-09-10). The archive holds ten years
 * and eight of them cannot be read. That is not a bug and it is not a provider
 * outage: 1,392 of the 1,402 stories before 2025 come from five vendor blogs
 * whose archives a backfill could walk, so a 2019 report would be Shopify and
 * ClickHouse's 2019 posts wearing the title of a year in technology.
 *
 * AN UNREAD PERIOD THAT SAYS NOTHING IS INDISTINGUISHABLE FROM A BROKEN ONE.
 * The reader has to be able to tell "too few publishers stand behind this" from
 * "the model was rate-limited" from "this is being read shortly", because only
 * one of those resolves by waiting and only one of them is ever fixed by adding
 * sources.
 */
export function notRead(r: PeriodReport, span: Span): string {
  const c = r.readings;
  const label = escapeHtml(SPAN_LABEL[span]);
  const NUM2 = new Intl.NumberFormat('en-US');

  if (c.stories < 25) {
    return `<p class="note"><b>No reading for this ${label}:</b> the archive
      holds only ${NUM2.format(c.stories)} readable
      ${c.stories === 1 ? 'story' : 'stories'} inside it.</p>`;
  }

  // THE ONE CASE WORTH A SENTENCE OF EXPLANATION, because it is permanent and
  // because it is not what a reader would assume. Everything else here resolves
  // itself; this one never does, and the reason is the sources rather than the
  // period.
  if (c.sources < 12 || c.topPct > 60) {
    return `<p class="note"><b>No reading for this ${label}, and it is the
      sources rather than the ${label}.</b> Its ${NUM2.format(c.stories)}
      stories come from ${c.sources}
      ${c.sources === 1 ? 'publisher' : 'publishers'}, ${c.topPct}% of them from
      the three largest &mdash; a reading drawn from that would be those
      publishers&rsquo; ${label} presented as the industry&rsquo;s.</p>`;
  }

  // NOTHING ABOUT THE JOB. A reader does not have a scheduler and cannot act on
  // one; "the period-reading job takes one unread period an hour whenever a
  // provider is reachable" told them about this software instead of about the
  // month. It is pending, and that is the whole of what they need.
  return '<p class="note">Not read yet.</p>';
}

/** Citations as they come out of jsonb: shape-checked, never trusted. */
function asCites(v: unknown): FindingCite[] {
  return (Array.isArray(v) ? v : [])
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
    .map((c) => ({
      title: String(c.title ?? '').trim(),
      when: String(c.when ?? '').trim(),
      source: String(c.source ?? '').trim(),
      ...(typeof c.id === 'string' ? { id: c.id } : {}),
    }))
    .filter((c) => c.title !== '')
    .slice(0, 2);
}

/** One end of a comparison: the story, and when it said so. */
function endOf(cs: FindingCite[]): string {
  return cs.map((c) => `<li>${c.id
    ? `<a href="/read/${escapeHtml(c.id)}">${escapeHtml(truncate(c.title, 100))}</a>`
    : escapeHtml(truncate(c.title, 100))}
    <span class="muted">${escapeHtml(c.source)}${
  c.when ? ` &middot; ${escapeHtml(c.when)}` : ''}</span></li>`).join('');
}

/**
 * What changed, against what it changed from.
 *
 * "the report still looks like filter news by date. The core content [is] the
 * result that analysis the news in the period with old news that related to
 * each news" -- 2026-09-10.
 *
 * The claims were already here and the pairing was not, so the page read as a
 * run of assertions over a date range. A claim about change whose earlier end
 * is invisible cannot be told apart from a claim about today; showing both ends
 * is the difference between an analysis and a filter.
 *
 * THE EVIDENCE IS TWO STORIES, NOT A LIST OF THEM. The headline lists removed
 * from these pages earlier the same day were every story of the period in date
 * order, attached to no claim. These are at most two stories at each end of one
 * claim, and the relation between them is the finding. Everything further is on
 * the field report the claim links to.
 */
function findings(all: PeriodFinding[], span: Span): string {
  if (all.length === 0) return '';
  // BOTH ENDS DEFAULTED, because these come out of a jsonb column. Every reading
  // written from now on carries `then` and `now`, and a row written before this
  // change does not -- and a report page that throws on an old row is worse
  // than one that shows the claim without its earlier end.
  const fs = all.map((f) => ({ ...f, then: f.then ?? [], now: f.now ?? [] }));
  const paired = fs.filter((f) => f.then.length > 0).length;
  return `
    <h2 class="sect">What changed, and against what</h2>
    <p class="note">What the daily readings concluded inside this
      ${SPAN_LABEL[span]}, in their own words, each set against the earlier
      story it revises.${paired < fs.length ? ` ${fs.length - paired} of
      ${fs.length} had no earlier end in the archive and state only the
      present.` : ''}</p>
    <div class="mv-items">${fs.map((f) => `<article class="pr-card">
      <a class="pr-claim"
         href="/field/${encodeURIComponent(f.field)}/report/${escapeHtml(f.day)}">${
  escapeHtml(truncate(f.text, 220))}</a>
      <span class="muted">${escapeHtml(fieldLabel(f.field))} &middot; read
        ${escapeHtml(f.day)}</span>
      ${f.then.length === 0 && f.now.length === 0 ? '' : `<div class="pr-ends">
        ${f.then.length === 0
    ? `<div class="pr-end"><h4>Before</h4><p class="muted">No earlier story on
         this subject is held, so this claim rests on the present alone.</p></div>`
    : `<div class="pr-end"><h4>Before</h4><ul>${endOf(f.then)}</ul></div>`}
        ${f.now.length === 0 ? ''
    : `<div class="pr-end"><h4>Now</h4><ul>${endOf(f.now)}</ul></div>`}
      </div>`}
    </article>`).join('')}</div>`;
}

/** The three lists, shared by the period page and the lead card. */
export function bodyOf(r: PeriodReport): string {
  const more = (shown: number, total: number) =>
    (total > shown ? ` <span class="muted">${total - shown} more not listed.</span>` : '');

  return `
    ${/* THE ANALYSIS IS THE FIRST THING ON THE PAGE, not the last.
        It used to sit under the new names, the funding list, the launch list
        and the curve table -- so a reader met four inventories before reaching
        a single conclusion, and the page read as news filtered by date. What
        the readings concluded, each against the story it revises, is the report;
        the measurements below are what supports it. */''}
    ${/* ONE STATEMENT ABOUT MISSING ANALYSIS, NOT FOUR.
        Shown on 2026-09-10, a month page carried, in order: "Not read yet ...
        the period-reading job takes one unread period an hour"; "No model wrote
        any of this"; "What the readings found -- Nothing, and that is a fact
        about this archive rather than about the month" with three more
        sentences; a one-item list under two lines of disclaimer; and a
        paragraph explaining that twenty launches existed and were deliberately
        not listed. Five blocks, four of them about the page rather than the
        month. "Do you think this is correct report."

        It was not, and every one of those blocks was added by me, each
        individually defensible: an absence must say what it is. But the rule
        is that an absence says what it is ONCE. Stacked, they stop being
        honesty and become the thing they were meant to prevent -- a page that
        is mostly about itself.

        So: the daily-readings section is gone when the period has a reading of
        its own (it is a different and lesser thing, and having both meant two
        sections competing to explain the same silence), the launch-count
        paragraph is gone entirely (explaining a removal forever is worse than
        the removal), and the one-line disclaimers are gone from blocks small
        enough to judge at a glance. */''}
    ${r.findings.length > 0 ? findings(r.findings, r.span) : ''}

    ${r.names.length === 0 ? '' : `
      <h2 class="sect">Names this archive had never seen</h2>
      <ul class="mv-new-names">${r.names.map(nameCard).join('')}</ul>`}

    ${r.market.length === 0 ? '' : `
      <h2 class="sect">Money and ownership moved</h2>
      <p class="note">Who was funded, who bought whom, and at what number.${
  more(r.market.length, r.totals.market)}</p>
      <ul class="bf-cites">${r.market.map(line).join('')}</ul>`}

    ${r.shift ? brokenCurves(r.shift, r.span)
    : r.movements.length > 0 ? curves(r.movements, r.span)
      : noCurves(r.span, r.days)}`;
}

/** The other spans, as links, so a reader can widen or narrow the same view. */
function spanNav(span: Span, keys: Record<Span, string>): string {
  return `<div class="bf-fields">${SPANS.map((s) => `<a class="btn${
    s === span ? ' on' : ''}" href="/reports/${s}/${encodeURIComponent(keys[s])}">${
    s === 'day' ? 'This day' : `This ${SPAN_LABEL[s]}`}</a>`).join('')}</div>`;
}

/**
 * The keys that cover the same instant at every span, for that nav.
 *
 * Through `keyFor`, so the week key is the Monday of the week containing the
 * date rather than the date itself. Spelling it out here was fine while a week
 * was a trailing seven days and became wrong the moment weeks became a
 * partition: "This week" would have offered the week starting on whatever day
 * the current period happened to begin.
 */
function siblingKeys(range: { from: string }): Record<Span, string> {
  const day = new Date(range.from).toISOString().slice(0, 10);
  return {
    day: keyFor('day', day), week: keyFor('week', day),
    month: keyFor('month', day), year: keyFor('year', day),
  };
}

export async function renderPeriodReport(span: Span, key: string): Promise<string> {
  const [r, reading] = await Promise.all([
    periodReport(span, key).catch(() => null),
    span === 'day' ? Promise.resolve(null)
      : periodReading(span, key).catch(() => null),
  ]);
  const crumbs = crumbsFor('/reports', 'Reports');

  if (!r) {
    return wrap(`${pageHead('Report', `No ${SPAN_LABEL[span]} at “${key}”`, { crumbs })}
      ${empty('That is not a period this archive can report on. A day and a week '
        + 'are named YYYY-MM-DD, a month YYYY-MM, and a year YYYY.', 'book')}`);
  }

  // A suppressed curve block is content: the page has something to say even
  // when every list is empty, so it must not fall through to "nothing here".
  const nothing = !r.shift && r.launches.length + r.market.length + r.names.length
    + r.movements.length + r.findings.length === 0;

  return wrap(`
    ${pageHead(`${r.range.label}`,
    `Everything that appeared, moved or was read over this ${SPAN_LABEL[span]}`,
    { crumbs })}

    ${spanNav(span, siblingKeys(r.range))}

    ${/* THE PERIOD'S OWN READING, FIRST. Everything below it is the evidence
        and the measurements; this is the report. It is absent until the period
        has been read -- the `period-reading` job walks the recent spans -- and
        the page below stands on its own when it is. */
      reading ? readingBlock(reading.strategy as StoredStrategy, reading, span)
        : notRead(r, span)}

    ${/* THE CAVEATS WERE A QUARTER OF THIS PAGE. Measured 2026-09-10 on
        /reports/month/2026-06: 27% of the rendered text was explanation of what
        the page is, against 4% for what the readings found. Prose defending a
        page is not the page. Each of these still says its one thing; none of
        them says it twice. */''}
    <p class="note">${reading
    ? '<b>The reading above was written by a model, from the stories cited '
      + 'under it and nothing else.</b> Everything below it was not: the figures '
      + 'are from public package registries and the claims are quoted from the '
      + 'daily readings that argued them.'
    : '<b>No model wrote any of this.</b> The figures are from public package '
      + 'registries; the claims are quoted from the daily readings that argued '
      + 'them.'}</p>

    ${nothing
    ? empty(`No launch, market move or public curve fell inside this ${SPAN_LABEL[span]}. `
      + 'That is a statement about what these sources published and what this '
      + 'archive caught, not about the industry.', 'sparkle')
    : bodyOf(r)}

    <p class="note"><b>What this cannot tell you.</b> Nothing here is counted:
      what this archive catches is a fact about its feed list, so no total on
      this page becomes a trend. A quiet ${SPAN_LABEL[span]} may be a quiet
      ${SPAN_LABEL[span]} or a ${SPAN_LABEL[span]} this archive was not
      collecting, and it cannot tell you which.</p>`);
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

/**
 * Every week, month and year the archive holds, as one browsable index.
 *
 * "I want to look report from 2026-1-1 to today, I want you make report every
 * week, every month, every year." The period pages already composed on demand;
 * what was missing was any way to reach one that is not the current one.
 *
 * The counts are navigation. A reader choosing between fifty weeks needs to
 * know which have anything in them, and this archive's rule about never
 * counting its own stories is a rule about CLAIMS -- no period page turns these
 * into a trend, and the note says what they are.
 */
export async function renderPeriodIndex(): Promise<string> {
  const [weeks, months, years] = await Promise.all([
    periodIndex('week').catch((): PeriodRow[] => []),
    periodIndex('month').catch((): PeriodRow[] => []),
    periodIndex('year').catch((): PeriodRow[] => []),
  ]);
  const crumbs = crumbsFor('/reports', 'Reports');

  if (weeks.length + months.length + years.length === 0) {
    return wrap(`${pageHead('Every period', 'Nothing collected yet', { crumbs })}
      ${empty('This archive holds no stories, so there is no period to report on.',
    'book')}`);
  }

  const rows = (span: Span, ps: PeriodRow[]) => ps.map((p) => `<tr>
    <th scope="row"><a href="/reports/${span}/${encodeURIComponent(p.key)}">${
  escapeHtml(p.label)}</a></th>
    <td class="num">${NUM.format(p.stories)}</td>
    <td class="num">${p.launches === 0 ? '<span class="muted">—</span>' : NUM.format(p.launches)}</td>
    <td class="num">${p.market === 0 ? '<span class="muted">—</span>' : NUM.format(p.market)}</td>
  </tr>`).join('');

  const block = (span: Span, ps: PeriodRow[], title: string, note: string) =>
    (ps.length === 0 ? '' : `
      <h2 class="sect">${escapeHtml(title)}</h2>
      <p class="note">${note}</p>
      <div class="mv-scroll"><table class="mv-curve">
        <thead><tr><th>${span === 'week' ? 'Week' : span === 'month' ? 'Month' : 'Year'}</th>
          <th class="num">Stories held</th><th class="num">Launches</th>
          <th class="num">Market</th></tr></thead>
        <tbody>${rows(span, ps)}</tbody>
      </table></div>`);

  return wrap(`
    ${pageHead('Every period',
    'Every week, month and year this archive holds stories for', { crumbs })}

    <p class="note"><b>The counts are here to help you choose, not to be read as
      a trend.</b> They say how much this archive caught in a period, which is a
      fact about its feed list &mdash; no report on any of these pages totals
      them into a finding. Collection began on <b>8 September 2026</b>; anything
      dated before that arrived as back catalogue from a feed that still served
      it, so the earlier periods are what those feeds retained rather than a
      record of what was published.</p>

    ${block('week', weeks, 'By week',
    'Monday to Sunday. Two weeks never share a day, so a story is reported in '
      + 'exactly one of them and any two can be compared.')}

    ${block('month', months, 'By month',
    'Calendar months. A month report needs about fourteen days of a package '
      + 'series before it can show a curve, so the current month shows none '
      + 'until it is half over.')}

    ${block('year', years, 'By year',
    'Calendar years. The earliest hold back-catalogue items that arrived with '
      + 'old publication dates, so they are much thinner than a year of '
      + 'collection would be.')}`);
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

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

import { FLOOR, NEW_CEILING, NEW_GROWTH } from '../analysis/market.ts';
import { confidenceOf } from '../analysis/strategy.ts';
import {
  techOf, controlsOf, techGap, EDGE as LABOUR_EDGE, type LabourPicture,
} from '../analysis/labour.ts';
import { wrap, pageHead, empty, escapeHtml, truncate, niceDay } from './html.ts';
import { crumbsFor } from './nav.ts';
import { periodReading, type StoredPeriodReading } from '../analysis/periodread.ts';
import type { StoredStrategy } from '../analysis/briefing.ts';
import { fieldLabel } from '../vocab/fields.ts';
import {
  periodReport, spanKeys, latestDay, periodIndex, keyFor, edgeFor, rangeFor,
  SPAN_LABEL, SPANS,
  type Span, type PeriodReport, type PeriodMovement, type PeriodFinding, type FindingCite,
  type PeriodRow, type CohortBreak,
} from '../analysis/period.ts';

const NUM = new Intl.NumberFormat('en-US');

/** One story, as a line. First-party is marked, as it is everywhere else. */
/**
 * The measurement moved, so no curve in this period means anything.
 *
 * A SUPPRESSED NUMBER HAS TO SAY IT IS SUPPRESSED. An empty section reads as
 * "nothing moved", which is the opposite of what happened and worse than either
 * the wrong number or the right one.
 */
function brokenCurves(shift: CohortBreak, span: Span, survivors: number): string {
  const dir = shift.medianPct < 0 ? 'fell' : 'rose';
  const reg = escapeHtml(shift.registry);
  return `
    <div class="mv-caveat">
      <p><b>The ${reg} curves for this ${SPAN_LABEL[span]} are withheld,
        because the measurement changed inside it.</b> On
        <b>${escapeHtml(shift.day)}</b>, ${shift.agreed} of ${shift.total}
        tracked ${reg} packages ${dir} together by a median of
        ${Math.abs(shift.medianPct)}%, and stayed there.${survivors > 0
    ? ` The other registry did not move with them, so its ${survivors} curves
        are shown below.` : ''}</p>
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
      ${/* WHY THIS IS PER REGISTRY, and what it cost to learn. The first
           version of this check looked for a step across every tracked package
           at once. PyPI stepped on 2026-08-25 -- 57 of its 60 series, a median
           of -37% -- and npm did not, so agreement across the whole set was
           42%, under the 80% the check requires, and it found nothing. The
           August report published fastapi at -47%, ray at -48% and dbt at -47%
           as adoption. A registry publishes its own counts, so a registry is
           the cohort. */''}
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
function noCurves(span: Span, days: number, measured: { days: number; series: number }): string {
  const why = measured.series === 0
    ? `This archive's daily download series begins on 13 March 2026, and no
       tracked package has a single day of it inside this
       ${SPAN_LABEL[span]}. The instrument does not reach back here, which is a
       fact about when the collection started and not about the market.`
    : edgeFor(days) === 0
    ? `A ${SPAN_LABEL[span]} is too short to measure one. Downloads run on a
       seven-day cycle &mdash; a Sunday is a third of a Tuesday &mdash; so a
       comparison is only meaningful across whole weeks, and two whole weeks do
       not fit inside one. Asking anyway produced a spurious 30&ndash;45% fall
       for <em>every</em> package in <em>every</em> week, which was the weekend
       and not the market.`
    : `The tracked packages do not yet have enough days inside this
       ${SPAN_LABEL[span]} for a comparison. A curve appears once the period
       holds two whole weeks of series at each end.`;
  return `<p class="note"><b>No curve for this ${SPAN_LABEL[span]}.</b> ${why}</p>`;
}

/**
 * A ROW THAT DID NOT MOVE IS NOT A ROW.
 *
 * "Hey I don't want to look raw news content in report page" (2026-09-10). The
 * two story lists were the answer to that and this table was the other half of
 * the same problem: `movementsIn` has no cap, so the page printed every tracked
 * package sorted by absolute change, and a month page ended in a long tail of
 * `+0%` and `-1%`. At that size the move is the registry's weekly cycle and the
 * rounding, not adoption -- so those rows cost a reader scroll and told them
 * nothing, which is the definition of the thing this page keeps being asked to
 * stop doing.
 *
 * The floor alone was not enough. June 2026 tracks 147 packages and 86 of them
 * moved by more than a tenth across a month, which is a table longer than the
 * reading above it and still attached to no claim in it. So there is also a
 * cap: the moves a reader would actually scan for, and a sentence saying the
 * rest moved less. Both numbers are stated -- a table that quietly drops two
 * thirds of its subjects is making a different claim from one that says so.
 */
const MOVED = 10;
const SHOWN = 20;

/** One table of curves, with the registry alongside each package. */
function curveTable(ms: PeriodMovement[]): string {
  const row = (m: PeriodMovement) => `<tr>
    <td><a href="/stack/${encodeURIComponent(m.slug)}">${escapeHtml(m.slug)}</a>
      <span class="muted">${escapeHtml(m.registry)}:${escapeHtml(m.package)}</span></td>
    <td class="num">${NUM.format(Math.round(m.before))}</td>
    <td class="num">${NUM.format(Math.round(m.after))}</td>
    <td class="num ${m.changePct >= 0 ? 'up' : 'down'}">${
  m.changePct >= 0 ? '+' : ''}${m.changePct}%</td>
  </tr>`;
  return `<div class="mv-scroll"><table class="mv-curve">
      <thead><tr><th>Technology</th><th class="num">Start of period</th>
        <th class="num">End of period</th><th class="num">Change</th></tr></thead>
      <tbody>${ms.map(row).join('')}</tbody>
    </table></div>`;
}

/**
 * The verdict, in figures, before any prose.
 *
 * Asked for on 2026-09-11: a labour-market report whose first section is four
 * numbers with their sources, and "I want to make monthly report at this
 * level". The thing that makes that section work is not the layout. It is that
 * every number in it was measured by somebody who was not arguing a case, and
 * says who.
 *
 * NOTHING HERE IS WRITTEN BY A MODEL. Each figure is computed from a public
 * series -- Indeed Hiring Lab's postings trackers, or the registries' own
 * download counts -- and carries the name of whoever published it. The reading
 * below interprets them; this block cannot be argued with, only re-fetched.
 *
 * A FIGURE THAT CANNOT BE MEASURED IS OMITTED, NOT ESTIMATED. A period the
 * postings series does not reach shows fewer cards rather than four cards of
 * which two are guesses, and the block disappears entirely rather than render
 * an empty frame.
 */
export function verdictBlock(r: PeriodReport): string {
  const cards: string[] = [];
  const card = (value: string, label: string, source: string) => `
    <div class="vd-card">
      <div class="vd-value">${value}</div>
      <div class="vd-label">${label}</div>
      <div class="vd-source">${escapeHtml(source)}</div>
    </div>`;
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${n}%`;

  const tech = techOf(r.labour);
  const software = tech.find((m) => m.sector === 'Software Development');
  const gap = techGap(r.labour);
  const remoteSw = r.labour.remote.find((m) => m.sector === 'techsoftware');

  if (software) {
    cards.push(card(software.end.toFixed(1),
      `Software Development job postings, against February&nbsp;2020&nbsp;=&nbsp;100`,
      'Indeed Hiring Lab'));
    cards.push(card(pct(software.changePct),
      `Change across this ${SPAN_LABEL[r.span]}`, 'Indeed Hiring Lab'));
  }
  if (gap) {
    cards.push(card(pct(gap.gap),
      `Technology against the control sectors, same window`, 'Indeed Hiring Lab'));
  }
  if (remoteSw) {
    cards.push(card(`${remoteSw.end.toFixed(1)}%`,
      `Software postings mentioning remote or hybrid work`, 'Indeed Hiring Lab'));
  }
  if (r.labour.ai) {
    cards.push(card(`${r.labour.ai.end.toFixed(2)}%`,
      `All job postings mentioning AI`, 'Indeed Hiring Lab'));
  }

  // The download instrument's one-line answer to the harder question.
  const real = r.movements.filter((m) => m.after >= FLOOR || m.before >= FLOOR);
  if (!r.shift && real.length > 0) {
    const forming = real.filter((m) => m.before < NEW_CEILING
      && m.after >= FLOOR && m.changePct >= NEW_GROWTH);
    cards.push(card(String(forming.length),
      `New markets forming, of ${real.length} tracked packages`,
      'PyPI and npm download counts'));
  }

  if (cards.length === 0) return '';
  return `
    <section class="vd">
      <h2 class="sect">The verdict, in figures</h2>
      <p class="note">Measured by the people named under each number, not by
        this archive and not by anybody selling anything in it. Everything below
        this block is interpretation; this is the part that can be re-fetched.</p>
      <div class="vd-grid">${cards.join('')}</div>
    </section>`;
}

/**
 * Where the work is, which is the half of "market" this archive could not see.
 *
 * "the purpose of this project is finding new market and market change"
 * (2026-09-11), followed by a report on the IT labour market and "I want to
 * make monthly report at this level". That report runs on job postings. This
 * archive had none, and no amount of re-reading vendor blogs produces any: a
 * post is what a company chose to say, and a posting is what a company is
 * willing to pay for.
 *
 * So the numbers here are Indeed Hiring Lab's, fetched daily from their public
 * CSVs, indexed to 1 February 2020 = 100. Nothing in this section was written
 * by this repository or by anybody selling anything in it.
 *
 * THE CONTROL COLUMN IS THE WHOLE POINT. A technology sector falling means
 * nothing on its own -- postings fell across the economy after 2022 and one job
 * board's share of hiring drifts. What can be read is the DIFFERENCE between
 * the technology sectors and ten controls measured the same way by the same
 * publisher over the same window. In 2023 software postings fell 43.8% while
 * the control median fell 17.6%: the gap, not the fall, is the finding.
 */
export function labourBlock(p: LabourPicture, span: Span): string {
  const tech = techOf(p);
  const gap = techGap(p);
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${n}%`;
  const idx = (n: number) => n.toFixed(1);

  if (p.days < LABOUR_EDGE * 2) {
    return `
      <h2 class="sect">Where the work is</h2>
      <p class="note"><b>Not measurable over this ${SPAN_LABEL[span]}.</b> ${
  p.days === 0
    ? `The postings series holds no day inside it. Indeed Hiring Lab's
       trackers begin in 2019 and this archive fetched them on 11 September
       2026; a period outside that window has no postings data, which is a
       fact about the source and not about hiring.`
    : `It holds ${p.days} ${p.days === 1 ? 'day' : 'days'} of postings data,
       and a comparison needs ${LABOUR_EDGE} at each end so that a weekday is
       never measured against a weekend.`}</p>`;
  }

  const row = (m: { sector: string; start: number; end: number; changePct: number }) => `<tr>
    <td>${escapeHtml(m.sector)}</td>
    <td class="num">${idx(m.start)}</td>
    <td class="num">${idx(m.end)}</td>
    <td class="num ${m.changePct >= 0 ? 'up' : 'down'}">${pct(m.changePct)}</td>
  </tr>`;

  const software = tech.find((m) => m.sector === 'Software Development');
  const remoteSw = p.remote.find((m) => m.sector === 'techsoftware');

  return `
    <h2 class="sect">Where the work is</h2>
    <p class="note">Job postings on Indeed, indexed so that <b>100 is that
      sector on 1 February 2020</b>. A sector at 75 has three quarters of the
      postings it had then. These are postings, not jobs, and not hires.</p>

    ${software ? `<p class="note"><b>Software Development is at
      ${idx(software.end)}</b> &mdash; ${software.end >= 100
    ? `${Math.round(software.end - 100)}% above`
    : `${Math.round(100 - software.end)}% below`} its February 2020 level, and
      ${pct(software.changePct)} across this ${SPAN_LABEL[span]}.</p>` : ''}

    <div class="mv-scroll"><table class="mv-curve">
      <thead><tr><th>Sector</th><th class="num">Start of period</th>
        <th class="num">End of period</th><th class="num">Change</th></tr></thead>
      <tbody>${tech.map(row).join('')}</tbody>
    </table></div>

    ${gap === null ? '' : `<div class="mv-caveat">
      <p><b>Against the rest of the economy: ${pct(gap.gap)}.</b> The
        technology sectors moved ${pct(gap.tech)} across this
        ${SPAN_LABEL[span]} at the median; the ${controlsOf(p).length} control
        sectors &mdash; nursing, construction, accounting, legal and the rest,
        measured by the same publisher over the same days &mdash; moved
        ${pct(gap.control)}.</p>
      <p>${Math.abs(gap.gap) < 2
    ? `That is close to no difference, which means this ${SPAN_LABEL[span]}
       was about hiring in general rather than about technology.`
    : gap.gap > 0
      ? `Technology outpaced the rest of the economy by ${
        Math.abs(gap.gap)} points.`
      : `Technology fell behind the rest of the economy by ${
        Math.abs(gap.gap)} points.`}</p>
    </div>`}

    ${!remoteSw && !p.ai ? '' : `<h3 class="sect">Remote, and how much of it mentions AI</h3>
      <p class="note">${remoteSw ? `<b>${remoteSw.end.toFixed(1)}% of software
        postings mention remote or hybrid work`
    : ''}${remoteSw ? `</b>, from ${remoteSw.start.toFixed(1)}% at the start of
        this ${SPAN_LABEL[span]}. ` : ''}${p.ai
    ? `<b>${p.ai.end.toFixed(2)}% of all postings mention AI</b>, from
        ${p.ai.start.toFixed(2)}%.` : ''}</p>
      <p class="note">Remote here means the posting says so. It is a wider
        measure than "fully remote" and the two are often quoted against each
        other as if they were the same number.</p>`}

    <p class="note"><b>What this instrument can see.</b> Postings on one job
      board, in the United States. A posting is not a job and a job is not a
      hire; senior and specialist roles are filled through networks that never
      reach a board. Published by Indeed Hiring Lab under their own name and
      re-fetchable by anybody from their public repositories.</p>`;
}

/**
 * The market, measured: what is forming, what is fading, what merely moved.
 *
 * "The report is focusing on only analysing news, but the purpose of this
 * project is finding new market and market change" -- 2026-09-11, the second
 * time this has been said. The first time produced /market, a whole page built
 * from download counts and no stories at all. It did not change the reports,
 * which still ended in one undifferentiated table headed "what the public
 * numbers did" -- every package that moved by a tenth, sorted by size of move.
 *
 * A SORTED TABLE IS NOT AN ANSWER TO EITHER QUESTION. Sorting by absolute
 * change puts the biggest movers on top, and the biggest movers are almost
 * always large packages having an ordinary quarter. "What is forming" and "what
 * is dying" are different questions with different arithmetic, and the top of a
 * percentage list answers neither:
 *
 *   FORMING   small enough at the start to be genuinely new (under
 *             ${NEW_CEILING} a day), big enough now to be real (over ${FLOOR}),
 *             and up by more than ${NEW_GROWTH}%.
 *   FADING    down by a fifth or more, from a base that was real.
 *   MOVED     everything else that cleared the floor, capped and counted.
 *
 * The thresholds are `market.ts`'s, imported rather than reinvented, so this
 * page and /market cannot disagree about what a forming market is.
 *
 * FORMING GOES FIRST EVEN WHEN IT IS EMPTY. "Nothing formed" is the answer to
 * the harder half of the question and a reader cannot distinguish it from "we
 * did not look" unless the page says which. It usually is empty: across every
 * month this archive can measure, not one tracked package has cleared that bar.
 */
function marketBlock(ms: PeriodMovement[], span: Span): string {
  const real = ms.filter((m) => m.after >= FLOOR || m.before >= FLOOR);
  const forming = real
    .filter((m) => m.before < NEW_CEILING && m.after >= FLOOR
      && m.changePct >= NEW_GROWTH)
    .sort((a, b) => b.changePct - a.changePct);
  const fading = real.filter((m) => m.changePct <= -20)
    .sort((a, b) => a.changePct - b.changePct);
  const seen = new Set([...forming, ...fading].map((m) => m.slug));
  const moved = real.filter((m) => !seen.has(m.slug)
    && Math.abs(m.changePct) >= MOVED)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  const shown = moved.slice(0, SHOWN);

  return `
    <h3 class="sect">New markets forming</h3>
    ${forming.length === 0
    ? `<p class="note">Nothing formed in this ${SPAN_LABEL[span]}. Of the
        ${real.length} tracked packages with enough volume to judge, none went
        from under ${NUM.format(NEW_CEILING)} installs a day to over
        ${NUM.format(FLOOR)} while growing by ${NEW_GROWTH}% or more. That is
        the measurement, not a survey: a package registry cannot see anything
        sold rather than installed, which is most of a market.</p>`
    : `<p class="note">Under ${NUM.format(NEW_CEILING)} installs a day at the
        start, over ${NUM.format(FLOOR)} now, and up ${NEW_GROWTH}% or more
        &mdash; small enough to have been new, large enough to be real.</p>
      ${curveTable(forming)}`}

    <h3 class="sect">Markets fading</h3>
    ${fading.length === 0
    ? `<p class="note">No tracked package fell by a fifth or more across this
        ${SPAN_LABEL[span]}.</p>`
    : `<p class="note">Down a fifth or more from a base that was real. Losing a
        market is a market change too, and it is the half that gets written
        about least.</p>
      ${curveTable(fading)}`}

    ${shown.length === 0 ? '' : `
      <h3 class="sect">What else moved</h3>
      <p class="note">Everything else that moved by ${MOVED}% or more${
  moved.length === shown.length ? '' : `; the ${shown.length} largest of
      ${moved.length}, the rest moved less`}. Mean daily downloads over
      ${shown[0]!.edge} days at each end, published by the registry.
      <b>Downloads are not users.</b></p>
      ${curveTable(shown)}`}`;
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
export function readingBlock(s: StoredStrategy, r: StoredPeriodReading, span: Span): string {
  /*
   * THE REASONING IS NOT TRUNCATED, and that is the whole point of the note
   * four paragraphs up.
   *
   * "why does the end is ..." -- 2026-09-11, against /reports/month/2026-07,
   * where a shift paragraph stopped at "and Inkling Small ...". This body used
   * to render through `truncate(body, 420)`, copied from `strategyBlock` in
   * briefing.ts where it is correct: there, every card LINKS to
   * `/field/<f>/report/<day>/<kind>/<n>`, so 190 characters is a summary with
   * the rest one click away.
   *
   * A period has no such page -- it is composed on demand and the evidence is
   * inline, which is written down directly above. So the same call here is not
   * a summary. It is deletion, mid-sentence, of the only copy on the page, and
   * it is deletion of the reasoning specifically: the part that says why the
   * claim follows from the stories under it. Measured on 2026-09-11, 147 of
   * 313 bodies across the stored readings were over the cap -- 47% of the
   * analysis on these pages ended in an ellipsis that led nowhere.
   *
   * A long paragraph is a writing problem and is fixed by writing shorter, not
   * by hiding the end of it from the reader.
   */
  /*
   * THE FIELDS THAT WERE WRITTEN AND SHOWN TO NOBODY.
   *
   * "Make all report more detail" -- 2026-09-11. Four things were being stored
   * in every period reading and rendered on no page: what a piece of work needs
   * from whoever takes it, who could take an opening, what would show a
   * direction claim wrong, and the tensions section entire. Counted the same
   * day across the nineteen stored readings: 71 skills lines, 40 who-lines, 55
   * falsifiers and 19 tensions, none of which had ever reached a reader.
   *
   * They were not missing from the daily field report -- `cardBody` in
   * briefing.ts renders all four on /field/<f>/report/<day>/<kind>/<n>. This is
   * the same bug as the truncation above and from the same cause: the period
   * page was written against a card renderer whose other half is a detail page,
   * and a period has no detail page. Whatever is not on this block is nowhere.
   *
   * The two most usable lines in the whole reading are among them. "What it
   * needs" is the skills a reader would have to have; "who could take it" is
   * who it is for. This archive exists to find work a person can take, and
   * those are the two sentences that say whether they can take it.
   */
  /**
   * THE CONFIDENCE MARKER, ON THE CLAIM RATHER THAN IN THE FOOTNOTES.
   *
   * Asked for on 2026-09-11 by way of a labour-market report that carries one
   * of these on every assertion: "I want to make monthly report at this level".
   *
   * This archive has always said the same thing in prose -- every `limits`
   * paragraph is a long apology for how much of the evidence is a vendor
   * describing itself -- and prose at the bottom of a page does not reach the
   * reader who is halfway down it forming a view. An unmarked claim reads as a
   * measured one.
   *
   * Absent means `contested`, which is what most of this archive honestly is.
   */
  const MARK: Record<string, [string, string]> = {
    data: ['data', 'A published measurement, checkable against its source.'],
    contested: ['contested',
      'The sources disagree, or the only source has an interest in the answer.'],
    forecast: ['forecast', 'A projection, and therefore wrong in detail.'],
  };
  const mark = (c: unknown): string => {
    // NORMALISED THROUGH THE SAME FUNCTION THE VALIDATOR USES, so a stored
    // value this page does not recognise renders as `contested` rather than as
    // an unstyled marker asserting something nobody defined.
    const key = confidenceOf(c);
    const [label, why] = MARK[key]!;
    return ` <span class="mv-tag conf-${key}" title="${
      escapeHtml(why)}">${escapeHtml(label)}</span>`;
  };

  const facts = (label: string, v: unknown): string => {
    const t = String(v ?? '').trim();
    return t === '' ? ''
      : `<dl class="mv-facts"><dt>${label}</dt><dd>${escapeHtml(t)}</dd></dl>`;
  };

  interface Extras {
    /** Appended inside the claim line, e.g. the horizon. */
    tag?: string;
    /** Between the reasoning and the evidence: what this needs, who it is for. */
    facts?: string;
    /** Below the evidence, where a caveat about the claim belongs. */
    after?: string;
  }

  const claim = (title: string, body: string, then: unknown, now: unknown,
    compared: boolean, x: Extras = {}) => `<article class="pr-card">
      <p class="pr-claim">${escapeHtml(title)}${x.tag ?? ''}</p>
      ${body ? `<p class="mv-body">${escapeHtml(body)}</p>` : ''}
      ${x.facts ?? ''}
      ${pair(then, now, compared)}
      ${x.after ?? ''}
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

  // THE WORK FIRST, THE PROJECTS UNDER A FOLD.
  //
  // "The report still focus on projects" (2026-09-13). A reading has six
  // sections and four of them -- what changed, where it is going, what each
  // company is betting on, where the evidence argues -- are about what vendors
  // shipped. They stay, because a new market usually starts as somebody's
  // launch, but they are background to the question the page answers, so they
  // sit in one collapsed block after the work a person could take.
  const primary = [
    (s.work ?? []).length === 0 ? '' : `
      <h2 class="sect">Work the news points to</h2>
      <p class="note">Things one person could start on remotely, with the
        evidence that somebody would pay for it.</p>
      <div class="mv-items">${s.work.map((w) => claim(w.what, w.why, [], w.evidence,
    false, {
      tag: `${mark(w.confidence)} <span class="mv-tag ${escapeHtml(w.horizon)}">${
        escapeHtml(HORIZON[w.horizon] ?? w.horizon)}</span>`,
      facts: facts('What it needs', w.skills),
    })).join('')}</div>`,

    (s.openings ?? []).length === 0 ? '' : `
      <h2 class="sect">What nobody has taken</h2>
      <div class="mv-items">${s.openings.map((o) => claim(o.what, o.why, [],
    o.evidence, false, { tag: mark(o.confidence),
      facts: facts('Who could take it', o.who) })).join('')}</div>`,
  ].filter(Boolean).join('');

  const sections = [
    s.shift ? `<h2 class="sect">What changed over this ${SPAN_LABEL[span]}</h2>
      <div class="mv-items">${claim(s.shift.moved, s.shift.after ?? '',
    s.shift.then, s.shift.now, true)}</div>` : '',

    (s.direction ?? []).length === 0 ? '' : `
      <h2 class="sect">Where this is going</h2>
      <div class="mv-items">${s.direction.map((d) => claim(
    d.claim, d.reasoning, d.then, d.now, true, {
      tag: mark(d.confidence),
      // THE FALSIFIER BELOW THE EVIDENCE, not above it. A reader who has just
      // looked at both ends is the one in a position to judge whether the
      // thing that would refute this has already happened.
      after: d.falsifier ? `<div class="mv-caveat"><p><b>What would show this
        wrong.</b> ${escapeHtml(d.falsifier)}</p></div>` : '',
    })).join('')}</div>`,

    (s.positioning ?? []).length === 0 ? '' : `
      <h2 class="sect">What each company appears to be betting on</h2>
      <div class="mv-items">${s.positioning.map((p) => claim(p.who, p.bet, [],
    p.evidence, false, {
      tag: mark(p.confidence),
    })).join('')}</div>`,

    // THE TENSIONS, WHICH THIS PAGE HAS NEVER RENDERED. Every stored reading
    // has one and no reader has seen any of them. A tension is the place the
    // sources disagree, which is the one section that cannot be mistaken for
    // the vendors' own account of themselves -- it is where the reading stops
    // resolving the evidence and shows it still unresolved.
    (s.tensions ?? []).length === 0 ? '' : `
      <h2 class="sect">Where the evidence argues with itself</h2>
      <div class="mv-items">${s.tensions.map((t) => claim(t.what, t.sides, [],
    t.evidence, false, { tag: mark(t.confidence) })).join('')}</div>`,
  ].filter(Boolean).join('');

  // THE READING AND NOTHING ABOUT HOW IT WAS READ.
  //
  // This block used to open with "This is a reading of 44 publishers, not of
  // the year", close with the reading's `limits` paragraph and a line counting the
  // stories behind it, and mark every company bet "says so itself". Rejected on
  // 2026-09-13: "You have to say about new market and market change in report,
  // not source of report." The confidence marker on each claim already says how
  // much weight it carries, and the stories under it say where it came from.
  return `
    ${s.read ? `<p class="mv-lede">${escapeHtml(s.read)}</p>` : ''}
    ${primary}
    ${sections ? `<details class="bf-more"><summary>Background: what companies shipped
      and bet on this ${escapeHtml(SPAN_LABEL[span])}</summary>${sections}</details>` : ''}`;
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

  // TOO NARROW TO READ, SAID WITHOUT THE PUBLISHER ARITHMETIC. It used to
  // count the publishers and the top-three share; that is a sentence about the
  // sources, and a report page says nothing about its sources (2026-09-13).
  if (c.sources < 12 || c.topPct > 60) {
    return `<p class="note"><b>No reading for this ${label}.</b> Too little of
      the market is on record for it to be read.</p>`;
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

/** The daily findings, when the period has no reading of its own to replace them. */
export function findingsBlock(r: PeriodReport, hasReading: boolean): string {
  return hasReading || r.findings.length === 0 ? '' : findings(r.findings, r.span);
}

/**
 * What the download curves did over the period, with no heading of its own.
 * The combined report (src/ui/report.ts) folds it under the technology section.
 */
export function downloadsBlock(r: PeriodReport): string {
  return `${r.shift ? brokenCurves(r.shift, r.span, r.movements.length) : ''}
    ${r.movements.length > 0 ? marketBlock(r.movements, r.span)
    : r.shift ? '' : noCurves(r.span, r.days, r.measured)}`;
}

/** The findings, the postings and the curves, for callers that want one block. */
export function bodyOf(r: PeriodReport, hasReading: boolean): string {
  return `
    ${/* THE ANALYSIS IS THE FIRST THING ON THE PAGE, not the last.
        It used to sit under the new names, the funding list, the launch list
        and the curve table -- so a reader met four inventories before reaching
        a single conclusion, and the page read as news filtered by date. What
        the readings concluded, each against the story it revises, is the report;
        the measurements below are what supports it. */''}
    ${/* AND THEN THE INVENTORIES WENT ENTIRELY.

        "Hey I don't want to look raw news content in report page"
        (2026-09-10). Moving the analysis above the lists fixed the order and
        not the substance: a month page still ended with "Names this archive had
        never seen" (a name, a source count, a date), "Money and ownership
        moved" (a headline, a publisher, a date, linked to the story) and the
        curve table. Two of those three are the corpus with a heading on it,
        and one of them is a list of news links on a page that had already been
        told twice not to carry news links.

        A report is what reading the stories produced. The stories themselves
        are not evidence for it unless a claim cites them, and the reading cites
        its own at both ends. So the period report now carries the reading and
        the public numbers, and nothing else. Nothing is lost: launches, market
        moves and new names are what `whatsnew.ts` renders, which is the page
        that exists to be an inventory.

        The daily findings survive only where the period has no reading of its
        own. They are the same shape as a reading but lesser -- a day's claim
        with the story at each end -- and printing both meant two sections
        arguing the same month at different resolutions. When the period has
        been read, the reading is the answer. */''}
    ${findingsBlock(r, hasReading)}

    ${/* THE MARKET, UNDER ONE HEADING, whatever the instrument managed to
        see. A break, a period too short and a period the series does not reach
        are three different answers and each says which it is. */''}
    ${labourBlock(r.labour, r.span)}

    <h2 class="sect">What the market did over this ${SPAN_LABEL[r.span]}</h2>
    ${r.shift ? brokenCurves(r.shift, r.span, r.movements.length) : ''}
    ${r.movements.length > 0 ? marketBlock(r.movements, r.span)
    : r.shift ? '' : noCurves(r.span, r.days, r.measured)}
    <p class="note"><b>What this instrument can see.</b> Daily download counts
      for the packages this archive has verified &mdash; 152 of the 2,460
      technologies it tracks. Anything sold rather than installed has no curve
      at all: a hosted product, a database with a licence, a consultancy. Every
      number here was published by the registry and can be re-run by anybody
      against the same public API.</p>`;
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


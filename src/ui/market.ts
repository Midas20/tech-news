// The market page: measurement, with no story on it.
//
// Asked for on 2026-09-10: "The target of report is recognizing market change
// and finding new market."
//
// Every other page here is built from stories. This one is deliberately built
// from nothing but daily download counts published by PyPI and npm, so that
// there is one place in the archive where the answer does not depend on whether
// a journalist wrote something, on which 512 feeds happen to be subscribed, or
// on a model budget that is exhausted by lunchtime.
//
// It leads with FORMING rather than with the biggest movers, because "find a
// new market" is the harder half of the question and the top of a percentage
// list never answers it -- that list is always led by something going from
// forty installs a day to four hundred, which is one build server.

import { wrap, pageHead, empty, escapeHtml } from './html.ts';
import { crumbsFor } from './nav.ts';
import {
  marketPicture, marketCoverage, EDGE, FLOOR, NEW_CEILING, NEW_GROWTH,
  type Move, type MarketPicture,
} from '../analysis/market.ts';

const NUM = new Intl.NumberFormat('en-US');

/** A daily rate, at the precision the number deserves. */
function rate(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return NUM.format(Math.round(n));
}

function moveRows(ms: Move[]): string {
  return ms.map((m) => `<tr>
    <th scope="row"><a href="/stack/${encodeURIComponent(m.slug)}">${
  escapeHtml(m.slug)}</a>
      <span class="muted">${escapeHtml(m.registry)}:${escapeHtml(m.package)}</span></th>
    <td class="num">${rate(m.before)}</td>
    <td class="num">${rate(m.after)}</td>
    <td class="num ${m.changePct >= 0 ? 'up' : 'down'}">${
  m.changePct >= 0 ? '+' : '−'}${Math.abs(m.changePct)}%</td>
  </tr>`).join('');
}

function table(caption: string, ms: Move[], edge: number): string {
  return `<div class="mv-scroll"><table class="mv-curve">
    <caption class="sr-only">${escapeHtml(caption)}</caption>
    <thead><tr><th>Package</th>
      <th class="num">${edge} days before</th>
      <th class="num">Last ${edge} days</th>
      <th class="num">Change</th></tr></thead>
    <tbody>${moveRows(ms)}</tbody>
  </table></div>`;
}

export async function renderMarket(): Promise<string> {
  const [m, cov] = await Promise.all([
    marketPicture().catch((): MarketPicture => ({
      moves: [], forming: [], fading: [], shift: null, edge: EDGE, tooThin: 0,
      measuredTo: null })),
    marketCoverage().catch(() => ({ tracked: 0, resolved: 0, withRepo: 0, total: 0 })),
  ]);

  const crumbs = crumbsFor('/market', 'Market');

  // WHAT THIS INSTRUMENT CAN SEE, on the page rather than in a commit message.
  // A reader deciding how much weight to give "nothing is forming" needs to
  // know whether that is a fact about the market or about our coverage.
  const reach = `<p class="note"><b>How much this can see.</b>
    ${NUM.format(cov.tracked)} of ${NUM.format(cov.resolved)} verified packages
    have a curve, out of ${NUM.format(cov.withRepo)} technologies that carry a
    GitHub repository and ${NUM.format(cov.total)} in the registry altogether.
    Resolution walks the registry in the background at twenty every five
    minutes, so this widens on its own.
    <b>A package registry is not the market:</b> anything sold rather than
    installed &mdash; a hosted product, a licensed database, a consultancy
    &mdash; has no curve at all and is invisible here.</p>`;

  // A BREAK MOVED THE WINDOW; it did not blank the page. Said at the top,
  // because every percentage below rests on a shorter baseline than usual and a
  // reader has to know that before reading one.
  const broke = !m.shift ? '' : `
    <div class="mv-caveat">
      <p><b>The registry changed how it counts on
        ${escapeHtml(m.shift.day)}</b>, so everything below is measured only
        since that date. ${m.shift.agreed} of ${m.shift.total} tracked packages
        moved together by a median of ${Math.abs(m.shift.medianPct)}% on that
        day and stayed there &mdash; unrelated projects do not do that, so the
        step is in the instrument and any comparison spanning it is void.</p>
      <p><b>The cost is a weaker baseline:</b> ${m.edge} days at each end
        instead of ${EDGE}, which is noisier. The alternative was to show
        nothing until the break falls out of the window, and a short honest
        measurement beats seven weeks of an empty page.</p>
    </div>`;

  if (m.shift && m.moves.length === 0) {
    return wrap(`
      ${pageHead('Market', 'Measured from public download counts, not from news',
    { crumbs })}
      ${broke}
      ${empty('There is not yet a whole fortnight of series after that date, so '
        + 'there is nothing that can honestly be compared. This resolves itself '
        + 'as the days pass.', 'trending')}
      ${reach}`);
  }

  if (m.moves.length === 0) {
    return wrap(`
      ${pageHead('Market', 'Measured from public download counts, not from news',
    { crumbs })}
      ${empty(`No package yet has ${EDGE * 2} days of series to compare. `
        + 'Resolution and series collection walk the registry in the background; '
        + 'this page fills in on its own.', 'trending')}
      ${reach}`);
  }

  return wrap(`
    ${pageHead('Market', 'Measured from public download counts, not from news',
    { crumbs })}

    ${broke}

    <p class="note"><b>No story is read on this page.</b> Every figure is daily
      downloads published by the registry that ships the package, averaged over
      ${m.edge} days and compared with the ${m.edge} days before
      &mdash; a whole number of weeks at each end, because a Sunday is a third
      of a Tuesday. Anybody can re-run the same query against the same public
      API and get the same answer${m.measuredTo
    ? `, up to ${escapeHtml(m.measuredTo)}` : ''}.
      <b>Downloads are not users:</b> a CI run that installs on every commit is
      counted, and a company mirroring internally is not.</p>

    <h2 class="sect">Markets forming</h2>
    <p class="note">Growing from a small base &mdash; under
      ${rate(NEW_CEILING)} a day before, at least ${rate(FLOOR)} a day now, up
      at least ${NEW_GROWTH}%. <b>This is not the top of the percentage
      list</b>, and the difference is the whole point: a package going 40 a day
      to 400 is +900% and is one build server being switched on. A floor under
      the later end is what separates a market from a rounding error.</p>
    ${m.forming.length === 0
    ? `<p class="note">Nothing clears those thresholds today. With
        ${NUM.format(cov.tracked)} packages tracked, that is at least as much a
        statement about the coverage above as about the industry.</p>`
    : table('Markets forming', m.forming, m.edge)}

    <h2 class="sect">Losing ground</h2>
    <p class="note">Down a fifth or more over the same two windows. A market
      being left is as real a market change as one being entered, and it is the
      half that no vendor announces.</p>
    ${m.fading.length === 0
    ? '<p class="note">Nothing is down by a fifth or more.</p>'
    : table('Losing ground', m.fading, m.edge)}

    <h2 class="sect">Everything measured</h2>
    <p class="note">Every package with at least ${m.edge * 2} days of series and
      ${rate(FLOOR)} a day at one end or the other, by size of move.
      ${m.tooThin > 0 ? `${m.tooThin} more have a curve but not yet enough of
      one to compare.` : ''}</p>
    ${table('Everything measured', m.moves, m.edge)}

    ${reach}

    <h2 class="sect">What this cannot tell you</h2>
    <div class="mv-caveat">
      <p><b>A registry is not a market.</b> Hosted products, licensed databases,
        and anything a salesperson sells have no download curve. Three of the
        four largest movements in this industry are invisible to this page, and
        it cannot tell you which three.</p>
      <p><b>A package is not always its project.</b> Each one here was accepted
        only because the registry&rsquo;s own declared repository matched the
        repository the taxonomy holds &mdash; which is what stopped
        <code>npm:torch</code>, an unrelated project, from being published as
        PyTorch. It does not stop a small satellite package published by the
        right organisation from standing in for a large project, so the
        registry, the package name and both absolute rates are shown: a curve
        whose numbers look too small for the name it carries probably is.</p>
      <p><b>Growth is not revenue.</b> A tool can be installed everywhere and
        sold nowhere. This page finds where attention and dependency are moving,
        which is upstream of a market and not the same thing.</p>
    </div>`);
}

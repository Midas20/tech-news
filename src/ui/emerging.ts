// What's new: names this archive did not have a word for until recently.
//
// Asked for on 2026-09-09 -- "the purpose of the project is to find new market
// that will appear in short period". Every other page in this system narrows a
// closed vocabulary: /trends draws a series for a technology that has a row,
// /fields counts stories against `stack_expand`, /technologies lists the
// vocabulary itself. All of them are blind by construction to the thing that
// matters most here, because a market that is about to appear has no row yet.
//
// This page reads the other table. See migration 0074 for why it exists.
//
// TWO RULES GOVERN EVERYTHING BELOW, AND THEY ARE THE SAME RULE TWICE:
//
//   ORDERED BY WHEN, NEVER BY HOW MANY. The ledger knows how many of our
//   stories mention each name, and that number measures the feed list rather
//   than the industry. Sorting by it would manufacture exactly the fake ranking
//   the content-v2 rewrite exists to prevent -- "the fastest-growing new tool"
//   would mean "the one our sources happen to repeat". First seen is a fact
//   about the world, so first seen is the order.
//
//   CORROBORATION IS SHOWN AS EVIDENCE, NEVER AS SIZE. "Three unrelated sources"
//   is a statement about how well attested something is. It is not adoption, not
//   popularity, and not market share, and the copy on this page has to keep
//   saying so, because a number beside a name reads as a score unless the page
//   is explicit that it is not.

import { q } from './db.ts';
import { FIELDS } from '../vocab/fields.ts';
import {
  escapeHtml, wrap, pageHead, panel, empty, icon, relativeTime, subnav, kpi,
} from './html.ts';
import { crumbsFor } from './nav.ts';

interface Row {
  slug: string;
  name: string;
  kind: string;
  what: string | null;
  fields: string[];
  first_seen_at: string;
  last_seen_at: string;
  sources: number;
  independent_sources: number;
}

/** How far back "new" goes. A quarter: long enough to see a name recur. */
const WINDOW_DAYS = 90;

/**
 * The tracked newcomers, newest first.
 *
 * `status = 'tracked'` is the evidence gate from migration 0074: two sources
 * that do not speak for the thing. A candidate below that line is one press
 * release, and showing it would make this page a vendor feed.
 */
async function tracked(field: string | null, days = WINDOW_DAYS): Promise<Row[]> {
  const params: unknown[] = [days];
  let filter = '';
  if (field) {
    params.push(field);
    filter = 'AND fields && stack_expand(ARRAY[$2]::text[])';
  }
  return q<Row>(
    `SELECT slug, name, kind, what, fields, first_seen_at, last_seen_at,
            sources, independent_sources
       FROM emerging
      WHERE status = 'tracked'
        AND first_seen_at > now() - make_interval(days => $1)
        ${filter}
      ORDER BY first_seen_at DESC
      LIMIT 200`,
    params,
  );
}

/**
 * How many names are still waiting for a second source.
 *
 * Shown because the alternative is a page that looks empty when it is in fact
 * working: on a quiet week the honest statement is "nine names seen once,
 * none yet corroborated", not a blank panel.
 */
async function waiting(field: string | null): Promise<number> {
  const params: unknown[] = [WINDOW_DAYS];
  let filter = '';
  if (field) {
    params.push(field);
    filter = 'AND fields && stack_expand(ARRAY[$2]::text[])';
  }
  const [row] = await q<{ n: string }>(
    `SELECT count(*) AS n FROM emerging
      WHERE status = 'candidate'
        AND first_seen_at > now() - make_interval(days => $1) ${filter}`,
    params);
  return Number(row?.n ?? 0);
}

export async function renderEmerging(field: string | null = null): Promise<string> {
  const known = field ? FIELDS.find((f) => f.slug === field) ?? null : null;
  if (field && !known) {
    return wrap(pageHead('Unknown field', 'No such field in the taxonomy.'));
  }

  const [rows, pending] = await Promise.all([tracked(field), waiting(field)]);

  const tabs = subnav([
    { href: '/emerging', label: 'Every field', icon: 'spark', active: !field },
    ...FIELDS.map((f) => ({
      href: `/emerging/${f.slug}`, label: f.label, active: f.slug === field,
    })),
  ]);

  const title = known ? `What's new in ${known.label}` : "What's new";

  return wrap(`
    ${pageHead(title,
      `Named tools, platforms and companies first seen here in the last `
      + `${WINDOW_DAYS} days that are <strong>not</strong> in the technology `
      + `taxonomy. Newest first.`,
      { crumbs: crumbsFor('/emerging', 'What&rsquo;s new') })}
    ${tabs}
    <div class="kpis">
      ${kpi({
        label: 'Corroborated', value: rows.length,
        note: 'seen in more than one place',
        help: 'A name reaches this page when two separate publications have mentioned '
          + 'it, or one that does not speak for it has. That is a test of evidence, '
          + 'not of popularity — it excludes a single vendor announcing itself.',
      })}
      ${kpi({
        label: 'Awaiting a second source', value: pending,
        note: 'seen in exactly one place',
        help: 'Names mentioned so far by a single source that speaks for the thing '
          + 'itself. Held back deliberately: one press release is not a market.',
      })}
    </div>
    ${panel(
      known ? `${known.label} — first sightings` : 'First sightings',
      rows.length ? list(rows) : empty(
        pending
          ? `Nothing corroborated yet in this window. ${pending} name${
            pending === 1 ? ' is' : 's are'} waiting for a second source.`
          : 'Nothing new in this window.',
        'spark'),
      { icon: 'spark', flush: rows.length > 0 },
    )}
    <p class="muted small" style="margin-top:16px">
      <strong>What &ldquo;new&rdquo; means here, exactly.</strong> A name on this page
      is new <em>to this archive's vocabulary</em> — nothing more is claimed. That
      covers two different things, and the page cannot tell them apart on its own:
      something genuinely just launched, and something long established that the
      taxonomy simply never had a row for. Both are worth seeing, for opposite
      reasons — the first is the market appearing, the second is a gap in the
      vocabulary that ought to be filled. Once a name is added to the taxonomy it
      leaves this page.
    </p>
    <p class="muted small">
      The counts describe <em>this archive's own reading</em> — how many of the
      sources it polls carried a name. They are an evidence threshold and nothing
      else: they decide whether a name is shown, never in what order. They are not
      adoption, popularity or market size. Where a public, externally-measured
      figure exists it is quoted with the date it was taken, on the technology's
      own page.
    </p>
  `);
}

function list(rows: Row[]): string {
  return `<ul class="rows">${rows.map((r) => `
    <li class="row">
      <div class="row-main">
        <a class="row-title" href="/emerging/name/${encodeURIComponent(r.slug)}">${
          escapeHtml(r.name)}</a>
        <span class="badge">${escapeHtml(r.kind)}</span>
        ${r.what ? `<p class="row-sub">${escapeHtml(r.what)}</p>` : ''}
      </div>
      <div class="row-meta">
        <span title="${escapeHtml(new Date(r.first_seen_at).toISOString())}">
          first seen ${escapeHtml(relativeTime(r.first_seen_at))}</span>
        <span class="muted">${evidence(r)}</span>
      </div>
    </li>`).join('')}</ul>`;
}

/**
 * The evidence line, phrased as evidence.
 *
 * "3 unrelated sources", never "3 mentions". The first is a statement about
 * corroboration; the second invites the reader to compare it with a 5 further
 * down the page, which is the comparison this whole design refuses to support.
 */
function evidence(r: Row): string {
  const bits = [`${r.sources} source${r.sources === 1 ? '' : 's'}`];
  // Said only when it is true. "0 unrelated sources" beside every row trains a
  // reader to read the number as a score that everything is failing.
  if (r.independent_sources > 0) {
    bits.push(`${r.independent_sources} independent`);
  }
  return bits.join(', ');
}

// ---------------------------------------------------------------------------
// One name
// ---------------------------------------------------------------------------

interface Sighting {
  story_title: string | null;
  url: string | null;
  field: string | null;
  independent: boolean;
  published_at: string | null;
}

/**
 * Everything recorded about one newcomer.
 *
 * The citations come from `emerging_sightings`, which copied the title and URL
 * rather than referencing the story. That is what makes this page survive
 * retention: the story it cites may have been deleted months ago, and the
 * citation is still checkable because it is a URL.
 */
export async function renderEmergingName(slug: string): Promise<string> {
  const [row] = await q<Row>(
    `SELECT slug, name, kind, what, fields, first_seen_at, last_seen_at,
            sources, independent_sources
       FROM emerging WHERE slug = $1`, [slug]);

  if (!row) {
    return wrap(pageHead('Unknown name', 'This name is not in the ledger.'));
  }

  const sightings = await q<Sighting>(
    `SELECT story_title, url, field, independent, published_at
       FROM emerging_sightings WHERE slug = $1
      ORDER BY published_at DESC NULLS LAST`, [slug]);

  const independent = sightings.filter((s) => s.independent);
  const firstParty = sightings.filter((s) => !s.independent);

  return wrap(`
    ${pageHead(row.name,
      `${escapeHtml(row.kind)}${row.what ? ` — ${escapeHtml(row.what)}` : ''}`,
      { crumbs: crumbsFor('/emerging', "What's new") })}
    <div class="kpis">
      ${kpi({ label: 'First seen', value: relativeTime(row.first_seen_at),
        note: new Date(row.first_seen_at).toISOString().slice(0, 10),
        help: 'The earliest story in this archive that named it. Earlier sightings '
          + 'may exist elsewhere; this is when it reached the sources being polled.' })}
      ${kpi({ label: 'Most recent', value: relativeTime(row.last_seen_at),
        note: new Date(row.last_seen_at).toISOString().slice(0, 10),
        help: 'The latest story that named it. A name that stops appearing is as '
          + 'informative as one that keeps appearing.' })}
      ${kpi({ label: 'Unrelated sources', value: row.independent_sources,
        note: 'excluding anyone speaking for it',
        help: 'Sources whose type means they corroborate rather than announce. A '
          + 'vendor describing its own product is authoritative about what shipped '
          + 'and worth nothing as evidence that anyone else cares.' })}
    </div>
    ${panel('Corroborating sources', independent.length
      ? citations(independent)
      : empty('No independent source has mentioned this yet.', 'feed'),
      { icon: 'shield' })}
    ${panel('First-party mentions', firstParty.length
      ? citations(firstParty)
      : empty('Nothing first-party recorded.', 'feed'),
      { icon: 'feed' })}
    ${row.fields.length ? panel('Tagged alongside', `<p>${
      row.fields.slice(0, 20).map((f) =>
        `<a class="tag" href="/technology/${encodeURIComponent(f)}">${escapeHtml(f)}</a>`)
        .join(' ')}</p>`, { icon: 'layers' }) : ''}
  `);
}

function citations(rows: Sighting[]): string {
  return `<ul class="rows">${rows.map((s) => `
    <li class="row">
      <div class="row-main">
        ${s.url
          ? `<a class="row-title" href="${escapeHtml(s.url)}" rel="noreferrer noopener"
               target="_blank">${escapeHtml(s.story_title ?? s.url)}</a>`
          : `<span class="row-title">${escapeHtml(s.story_title ?? 'untitled')}</span>`}
      </div>
      <div class="row-meta">
        <span>${s.published_at
          ? escapeHtml(new Date(s.published_at).toISOString().slice(0, 10)) : ''}</span>
      </div>
    </li>`).join('')}</ul>`;
}

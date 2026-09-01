// The background panel shared by technology and platform pages.
//
// Both answer the same question about different kinds of subject, from the same
// two sources, under the same rule: every value is copied from somewhere with a
// URL attached, and nothing here is generated. A model would write a fluent
// paragraph about any of 2,330 technologies without consulting anything, and
// some of those paragraphs would be wrong in ways no reader could detect.

import { escapeHtml } from './html.ts';

export interface ReferenceRow {
  summary: string | null; developer: string | null; inception: string | null;
  license: string | null; written_in: string[] | null; latest_version: string | null;
  official_url: string | null; source_url: string | null; source_license: string | null;
  confidence: string | null; company_slug: string | null; note: string | null;
  checked: string | null;
}

/**
 * What the technology IS: the background paragraph and the handful of facts a
 * reader who has just met the name actually wants -- who makes it, when it
 * appeared, what licence it carries, what it is written in.
 *
 * Every value is copied from Wikidata or Wikipedia and carries the URL it came
 * from. None of it is generated: a model would write a fluent paragraph about
 * any of these 2,330 technologies without consulting anything, and some of those
 * paragraphs would be wrong in ways no reader of this page could detect.
 *
 * ATTRIBUTION IS RENDERED, NOT OPTIONAL. The summary is CC BY-SA 4.0 text, and
 * the licence requires naming the source and linking it. The database refuses to
 * hold a summary without both, and this prints them.
 *
 * The confidence a match was made with is shown when it is the weaker kind. A
 * technology confirmed only by "Wikidata says this is a piece of software" is a
 * different claim from one whose repository matched the one already recorded
 * here, and flattening the two would be the quiet kind of dishonesty.
 */
export function referencePanel(ref: ReferenceRow | null): string {
  if (!ref || (!ref.summary && !ref.developer && !ref.inception)) {
    return ref?.note
      // Why there is nothing, rather than a blank that looks like a bug. An
      // unconfirmed match is a deliberate refusal, not a gap waiting to fill.
      ? `<p class="muted" style="font-size:12px">No background recorded:
          ${escapeHtml(ref.note)}.</p>`
      : '';
  }

  const facts: [string, string][] = [];
  if (ref.developer) {
    facts.push(['Made by', ref.company_slug
      ? `<a href="/company/${encodeURIComponent(ref.company_slug)}">${escapeHtml(ref.developer)}</a>`
      : escapeHtml(ref.developer)]);
  }
  if (ref.inception) facts.push(['Appeared', escapeHtml(ref.inception.slice(0, 4))]);
  if (ref.license) facts.push(['Licence', escapeHtml(ref.license)]);
  if (ref.written_in?.length) {
    facts.push(['Written in', ref.written_in.map((w) => escapeHtml(w)).join(', ')]);
  }
  // NO VERSION HERE, deliberately. Wikidata carries P348 and it is frequently
  // years out of date -- it gave Kafka as 0.8.1.1 while Kafka was on 3.x. This
  // archive polls release feeds, so it already knows the current version from a
  // source that is authoritative and dated; printing a stale one beside that
  // would contradict the page a few sections further down. The column is kept
  // because it costs nothing and a later pass may find a use for the claim, but
  // a number that is probably wrong does not go in front of a reader.
  if (ref.official_url) {
    facts.push(['Official', `<a href="${escapeHtml(ref.official_url)}" target="_blank"
      rel="noreferrer">${escapeHtml(new URL(ref.official_url).hostname)}</a>`]);
  }

  return `<div class="ref">
    ${ref.summary ? `<p class="refsum">${escapeHtml(ref.summary)}</p>` : ''}
    ${facts.length ? `<dl class="reffacts">${facts.map(([k, v]) =>
      `<div><dt>${escapeHtml(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
    ${ref.source_url ? `<p class="refsrc">From
      <a href="${escapeHtml(ref.source_url)}" target="_blank" rel="noreferrer">Wikipedia</a>
      and <a href="https://www.wikidata.org" target="_blank" rel="noreferrer">Wikidata</a>${
        ref.source_license ? ` · ${escapeHtml(ref.source_license)}` : ''}${
        ref.confidence === 'typed'
          ? ' · matched by type only, not by a repository or site we already hold'
          : ''}</p>` : ''}
  </div>`;
}

/**
 * A collected link to something you can read about the subject.
 *
 * `kind` is the shelf it belongs on. `provider` is who publishes it, which
 * matters because "official" from the project itself and "official" from a
 * cloud vendor reselling it are different things to a reader deciding what to
 * trust.
 */
export interface ResourceRow {
  kind: string;
  title: string;
  url: string;
  provider: string | null;
  free: boolean | null;
  http_status: number | null;
}

/** Shelves, in the order somebody meeting a technology actually wants them. */
const SHELVES: Array<{ kind: string; label: string; blurb: string }> = [
  { kind: 'official', label: 'Official', blurb: 'Published by the project or its vendor' },
  { kind: 'reference', label: 'Reference', blurb: 'Specifications, API and standards' },
  { kind: 'learning', label: 'Learning', blurb: 'Courses and structured material' },
  { kind: 'tutorial', label: 'Tutorials', blurb: 'Worked examples' },
];

/**
 * DOCUMENTATION, WHICH WAS ALREADY COLLECTED AND SHOWN NOWHERE.
 *
 * `stack_resources` holds 1,892 links across 990 technologies -- 1,588 official,
 * 154 reference, 123 learning, 27 tutorials -- gathered by the `reference` job
 * and, until this, read by no page. The technology page showed a single `docs`
 * chip built from `stacks.docs_url`, a column populated for 24 of 2,338 rows.
 *
 * So the fix is not to fetch anything. It is to render what the archive already
 * knows, which is the cheapest kind of feature there is.
 *
 * A link whose last check FAILED is still shown, marked. Silence would be worse:
 * the reader cannot tell "we have nothing" from "we have something broken", and
 * only one of those is worth reporting to whoever maintains the entry.
 */
export function docsPanel(rows: ResourceRow[]): string {
  if (!rows.length) return '';

  const shelves = SHELVES.map((shelf) => {
    const items = rows.filter((r) => r.kind === shelf.kind);
    if (!items.length) return '';
    return `<div class="docshelf">
      <h3>${escapeHtml(shelf.label)} <span class="muted">${escapeHtml(shelf.blurb)}</span></h3>
      <ul class="doclist">${items.map((r) => {
        const dead = r.http_status !== null && r.http_status >= 400;
        return `<li>
          <a href="${escapeHtml(r.url)}" target="_blank" rel="noreferrer">${escapeHtml(r.title)}</a>
          ${r.provider ? `<span class="chip">${escapeHtml(r.provider)}</span>` : ''}
          ${r.free === false ? '<span class="chip warn">paid</span>' : ''}
          ${dead ? `<span class="chip warn" title="last check returned ${r.http_status}">unreachable</span>` : ''}
        </li>`;
      }).join('')}</ul>
    </div>`;
  }).filter(Boolean).join('');

  // A kind nobody planned for still gets a shelf rather than disappearing.
  const known = new Set(SHELVES.map((s) => s.kind));
  const others = rows.filter((r) => !known.has(r.kind));
  const extra = others.length
    ? `<div class="docshelf"><h3>Other</h3><ul class="doclist">${others.map((r) =>
        `<li><a href="${escapeHtml(r.url)}" target="_blank" rel="noreferrer">${
          escapeHtml(r.title)}</a></li>`).join('')}</ul></div>`
    : '';

  return `<section class="docs">
    <h2>Documentation &amp; reference</h2>
    ${shelves}${extra}
  </section>`;
}

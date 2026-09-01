// The source registry asked the other question.
//
// /sources answers "is my collection working" -- health, yield, last error.
// This answers "what is my collection MADE OF", which is a different question
// and the one the intelligence platform actually rests on. A registry can be
// perfectly healthy and still be unable to tell an announcement from an
// adoption, because everything in it is a vendor.
//
// THE ONE RULE THIS PAGE EXISTS TO HONOUR: a measured number and a guessed one
// must not look the same. Measured values render plainly, priors render in
// italic with their reason on hover, and anything unknown renders as a dash --
// never as a zero, and never as a plausible-looking default. A dash is
// information. A fabricated 60 is not.

import { q } from './db.ts';
import { escapeHtml, wrap, pageHead, stat, truncate } from './html.ts';
import { crumbsFor } from './nav.ts';
import { CATEGORIES, TARGET_MIX, TYPE_MEANING } from '../vocab/intel.ts';

interface IntelRow {
  id: string;
  name: string;
  url: string;
  source_type: string | null;
  status: string;
  categories: string[];
  tech_domains: string[];
  region: string | null;
  overall_score: number | null;
  authority_score: number | null;
  prior_reason: string | null;
  inclusion_reason: string | null;
  stories: number | null;
  signal_density: number | null;
  noise_score: number | null;
  originality: number | null;
  freshness: number | null;
  market_relevance: number | null;
  developer_relevance: number | null;
  enterprise_relevance: number | null;
  early_signal: number | null;
  availability: number | null;
  confirmations: number | null;
}

const TYPE_LABEL = new Map(TYPE_MEANING.map((m) => [m.type as string, m.label]));

/** A measured number, or a dash. Never a zero standing in for ignorance. */
function num(v: number | null, suffix = ''): string {
  if (v === null || v === undefined) return '<span class="muted" title="not enough evidence">—</span>';
  return `${v}${suffix}`;
}

export async function renderIntel(url: URL): Promise<string> {
  const type = url.searchParams.get('type') ?? '';
  const params: unknown[] = [];
  const where = type
    ? (type === 'unknown'
      ? 'WHERE s.source_type IS NULL'
      : `WHERE s.source_type = $${params.push(type)}::source_type`)
    : '';

  const [rows, byType, byCat, totals] = await Promise.all([
    q<IntelRow>(
      `SELECT s.id::text, s.name, s.url, s.source_type::text, s.status::text,
              s.categories, s.tech_domains, s.region, s.overall_score,
              s.authority_score, s.prior_reason, s.inclusion_reason,
              m.stories, m.signal_density, m.noise_score, m.originality, m.freshness,
              m.market_relevance, m.developer_relevance, m.enterprise_relevance,
              m.early_signal, m.availability, m.confirmations
         FROM sources s
         LEFT JOIN LATERAL (
           SELECT * FROM source_metrics
            WHERE source_id = s.id ORDER BY window_end DESC LIMIT 1
         ) m ON true
         ${where}
        ORDER BY s.overall_score DESC NULLS LAST, m.stories DESC NULLS LAST, s.name
        LIMIT 400`, params),
    q<{ t: string | null; n: string }>(
      `SELECT source_type::text AS t, count(*)::text AS n FROM sources
        GROUP BY 1 ORDER BY count(*) DESC`),
    q<{ c: string; n: string }>(
      `SELECT unnest(categories) AS c, count(*)::text AS n FROM sources
        WHERE cardinality(categories) > 0 GROUP BY 1 ORDER BY count(*) DESC`),
    q<{ approved: string; typed: string; measured: string; independent: string }>(
      `SELECT count(*) FILTER (WHERE status = 'APPROVED')::text AS approved,
              count(*) FILTER (WHERE source_type IS NOT NULL)::text AS typed,
              count(*) FILTER (WHERE overall_score IS NOT NULL)::text AS measured,
              count(*) FILTER (WHERE source_type IN
                ('MAJOR_JOURNALISM','TECHNICAL_JOURNALISM','SPECIALIST_PUBLICATION',
                 'REGIONAL_PUBLICATION','MARKET_ANALYSIS','RESEARCH'))::text AS independent
         FROM sources`),
  ]);

  const t = totals[0]!;
  const total = byType.reduce((a, r) => a + Number(r.n), 0);

  // THE PORTFOLIO GAP, WHICH IS THE POINT OF THE PAGE.
  //
  // Reported rather than corrected. Nothing here removes a source to hit a
  // target -- the gap is a shopping list, not an instruction.
  const catCount = new Map(byCat.map((r) => [r.c, Number(r.n)]));
  const gaps = TARGET_MIX.map((target) => {
    const have = catCount.get(target.slug) ?? 0;
    const share = total ? have / total : 0;
    const want = Math.round(target.low * total);
    const short = have < want;
    const label = CATEGORIES.find((c) => c.slug === target.slug)?.label ?? target.slug;
    return `<tr>
      <td>${escapeHtml(label)}</td>
      <td class="num">${have}</td>
      <td class="num ${short ? 'warn' : 'ok'}">${(share * 100).toFixed(0)}%</td>
      <td class="num muted">${(target.low * 100).toFixed(0)}–${(target.high * 100).toFixed(0)}%</td>
      <td class="mono ${short ? 'warn' : 'muted'}">${short ? `short ${want - have}` : 'met'}</td>
    </tr>`;
  }).join('');

  const tabs = [{ t: '', label: 'All' }, ...byType.map((r) => ({
    t: r.t ?? 'unknown',
    label: `${r.t ? TYPE_LABEL.get(r.t) ?? r.t.toLowerCase() : 'Unclassified'} ${r.n}`,
  }))].map((x) => {
    const href = x.t ? `/sources/intel?type=${encodeURIComponent(x.t)}` : '/sources/intel';
    const on = type === x.t;
    return `<a class="pill" href="${href}"${on ? ' style="border-color:var(--link);color:var(--ink)"' : ''}>${escapeHtml(x.label)}</a>`;
  }).join('');

  const body = rows.map((r) => {
    const label = r.source_type ? TYPE_LABEL.get(r.source_type) ?? r.source_type : null;
    // A prior is rendered in italic and carries its reason. A measurement is
    // rendered plainly. Somebody scanning the column must be able to see which
    // is which without reading documentation.
    const authority = r.authority_score === null
      ? '<span class="muted">—</span>'
      : `<i title="${escapeHtml(r.prior_reason ?? 'prior')}">${r.authority_score}</i>`;
    return `<tr>
      <td><a href="/all?source=${encodeURIComponent(r.name)}" style="font-weight:600">${escapeHtml(r.name)}</a>
        <div class="muted" style="font-size:var(--t-11)">${escapeHtml(truncate(r.url, 58))}</div></td>
      <td>${label
        ? `<span class="chip">${escapeHtml(label)}</span>`
        : '<span class="chip warn" title="not derivable from the record">unclassified</span>'}
        ${r.status !== 'APPROVED' ? `<div class="muted" style="font-size:var(--t-11)">${escapeHtml(r.status.toLowerCase())}</div>` : ''}</td>
      <td class="num" style="font-weight:600">${num(r.overall_score)}</td>
      <td class="num">${authority}</td>
      <td class="num">${num(r.signal_density, '%')}</td>
      <td class="num">${num(r.market_relevance, '%')}</td>
      <td class="num">${num(r.developer_relevance, '%')}</td>
      <td class="num">${num(r.early_signal, '%')}</td>
      <td class="num">${num(r.freshness)}</td>
      <td class="num">${num(r.originality, '%')}</td>
      <td class="num">${r.confirmations ?? '<span class="muted">—</span>'}</td>
      <td class="num muted">${r.stories?.toLocaleString('en-US') ?? '—'}</td>
    </tr>`;
  }).join('');

  return wrap(`
    ${pageHead('Source intelligence',
      `${t.typed} of ${total} classified · ${t.measured} measured · ${t.independent} independent of ${total}`,
      { crumbs: crumbsFor('/sources', 'Sources') })}

    <div class="cards">
      ${stat('classified', t.typed, `of ${total}`)}
      ${stat('measured', t.measured, 'have a score')}
      ${stat('independent', t.independent, 'not first-party')}
      ${stat('approved', t.approved, 'in the working set')}
    </div>

    <p class="note" style="margin:var(--s-3) 0">
      <b>Independent sources are what confirmation needs.</b>
      A registry made of first parties can report what was announced and cannot
      corroborate any of it: two vendors are never two confirmations.
      <span class="muted">Priors are shown in <i>italic</i> and carry their reason.
      A dash means not enough evidence — never zero.</span>
    </p>

    <h2>Portfolio against target</h2>
    <div class="scroll"><table>
      <thead><tr><th>category</th><th class="num">sources</th><th class="num">share</th>
        <th class="num">target</th><th>gap</th></tr></thead>
      <tbody>${gaps}</tbody></table></div>

    <h2 style="margin-top:var(--s-4)">By source</h2>
    <div class="pills" style="margin-bottom:var(--s-3)">${tabs}</div>

    ${rows.length === 0 ? '<div class="empty">No sources match.</div>' : `<div class="scroll"><table>
      <thead><tr><th>source</th><th>type</th><th class="num">score</th>
        <th class="num" title="PRIOR — a judgement, not a measurement">auth</th>
        <th class="num" title="kept ÷ judged, excluding items already seen">density</th>
        <th class="num" title="share attaching to a tracked technology, platform or company">market</th>
        <th class="num">dev</th>
        <th class="num" title="share of technologies where this source was among the first three to mention">early</th>
        <th class="num" title="100 = arrives within the hour, 0 = two days or worse">fresh</th>
        <th class="num" title="reported first rather than following">orig</th>
        <th class="num" title="stories another source independently reported too">conf</th>
        <th class="num">stories</th></tr></thead>
      <tbody>${body}</tbody></table></div>`}
  `);
}

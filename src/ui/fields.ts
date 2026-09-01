// Field pages: one page per domain.
//
// A single river is the wrong shape for a system that collects across sixteen
// domains. Someone reading about security is not, in that moment, interested in
// frontend tooling, and asking them to re-apply a filter every visit is asking
// them to do the navigation the product should have done.
//
// A field is simply a ROOT of the taxonomy, so this is not a parallel hierarchy
// -- it is the same tree, entered at the top. Everything beneath the root counts
// toward it, which is what makes "Security" mean CVEs, cryptography and identity
// rather than only stories literally tagged "security".

import { q, one } from './db.ts';
import { FIELDS } from '../vocab/fields.ts';
import {
  escapeHtml, wrap, pageHead, empty, relativeTime, sparkline, truncate,
  stat, icon, barChart, type Point,
} from './html.ts';
import { crumbsFor } from './nav.ts';

// Defined in src/vocab/fields.ts and re-exported here, so pages keep importing
// it from where they always have while settings and the collector can reach it
// without pulling a database pool in behind it.
export { FIELDS, FIELD_SLUGS, fieldLabel, type Field } from '../vocab/fields.ts';

export interface FieldCount {
  slug: string;
  total: number;
  week: number;
}

/** Counts for every field in one query, for the rail and the index. */
export async function fieldCounts(): Promise<Map<string, FieldCount>> {
  const rows = await q<{ slug: string; total: string; week: string }>(
    `SELECT f.slug,
            count(s.id)::text AS total,
            count(s.id) FILTER (
              WHERE coalesce(s.published_at, s.collected_at) > now() - interval '7 days'
            )::text AS week
       FROM unnest($1::text[]) AS f(slug)
       LEFT JOIN stories s
         ON s.superseded_by IS NULL
        AND s.stacks && stack_expand(ARRAY[f.slug]::text[])
      GROUP BY f.slug`,
    [FIELDS.map((f) => f.slug)],
  );
  return new Map(rows.map((r) => [r.slug, {
    slug: r.slug, total: Number(r.total), week: Number(r.week),
  }]));
}

export async function renderFields(): Promise<string> {
  const counts = await fieldCounts();

  const series = await q<{ slug: string; week: string; n: string }>(
    `SELECT f.slug,
            to_char(date_trunc('week', coalesce(s.published_at, s.collected_at)), 'MM-DD') AS week,
            count(*)::text AS n
       FROM unnest($1::text[]) AS f(slug)
       JOIN stories s
         ON s.superseded_by IS NULL
        AND s.stacks && stack_expand(ARRAY[f.slug]::text[])
        AND coalesce(s.published_at, s.collected_at) > now() - interval '16 weeks'
      GROUP BY f.slug, date_trunc('week', coalesce(s.published_at, s.collected_at))
      ORDER BY f.slug, date_trunc('week', coalesce(s.published_at, s.collected_at))`,
    [FIELDS.map((f) => f.slug)],
  );
  const bySlug = new Map<string, number[]>();
  for (const r of series) {
    const list = bySlug.get(r.slug) ?? [];
    list.push(Number(r.n));
    bySlug.set(r.slug, list);
  }

  const cards = FIELDS.map((f) => {
    const c = counts.get(f.slug);
    return `<a class="fieldcard" href="/field/${encodeURIComponent(f.slug)}">
      <div class="fc-top">${icon(f.icon, 16)}<span class="fc-name">${escapeHtml(f.label)}</span></div>
      <div class="fc-n">${(c?.total ?? 0).toLocaleString('en-US')}
        <small>${c?.week ? `${c.week} this week` : 'quiet'}</small></div>
      <div class="fc-spark">${sparkline(bySlug.get(f.slug) ?? [], { width: 150, height: 22 })}</div>
    </a>`;
  }).join('');

  return wrap(`
    ${pageHead('Fields',
      'One page per domain. A field is a root of the taxonomy, so everything beneath it counts toward it.',
      { crumbs: crumbsFor('/fields', 'Fields') })}
    <div class="fieldgrid">${cards}</div>`);
}

export async function renderField(slug: string): Promise<string> {
  const field = FIELDS.find((f) => f.slug === slug);
  const root = await one<{ slug: string; name: string; description: string | null }>(
    `SELECT slug, name, description FROM stacks WHERE slug = $1`, [slug]);

  if (!root) return wrap(pageHead('Unknown field', 'Not a root of the taxonomy.'));

  const [totals, children, recent, sources, companies, weekly] = await Promise.all([
    one<{ total: string; week: string; month: string; critical: string; since: string | null }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE coalesce(published_at, collected_at) > now() - interval '7 days')::text AS week,
              count(*) FILTER (WHERE coalesce(published_at, collected_at) > now() - interval '30 days')::text AS month,
              count(*) FILTER (WHERE importance >= 8)::text AS critical,
              min(coalesce(published_at, collected_at))::date::text AS since
         FROM stories
        WHERE superseded_by IS NULL AND stacks && stack_expand(ARRAY[$1]::text[])`, [slug]),
    q<{ slug: string; name: string; n: string }>(
      `SELECT st.slug, st.name, count(s.id)::text AS n
         FROM stacks st
         LEFT JOIN stories s ON s.stacks && ARRAY[st.slug] AND s.superseded_by IS NULL
        WHERE st.parent_id = (SELECT id FROM stacks WHERE slug = $1)
        GROUP BY st.slug, st.name ORDER BY count(s.id) DESC, st.name LIMIT 40`, [slug]),
    q<{ id: string; title: string; url: string; source: string; when: string;
        importance: number | null; coverage: number; companies: string[]; announcement: boolean }>(
      `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title, s.canonical_url AS url,
              src.name AS source,
              coalesce(s.published_at, s.collected_at)::text AS when,
              s.importance, s.coverage_count AS coverage, s.companies,
              (src.company_slug IS NOT NULL AND src.company_slug = ANY(s.companies)) AS announcement
         FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND s.stacks && stack_expand(ARRAY[$1]::text[])
        ORDER BY coalesce(s.published_at, s.collected_at) DESC LIMIT 30`, [slug]),
    q<{ name: string; n: string }>(
      `SELECT src.name, count(*)::text AS n
         FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND s.stacks && stack_expand(ARRAY[$1]::text[])
        GROUP BY src.name ORDER BY count(*) DESC LIMIT 10`, [slug]),
    q<{ slug: string; name: string; n: string }>(
      `SELECT c.slug, c.name, count(*)::text AS n
         FROM stories s, LATERAL unnest(s.companies) AS cs
         JOIN companies c ON c.slug = cs
        WHERE s.superseded_by IS NULL AND s.stacks && stack_expand(ARRAY[$1]::text[])
        GROUP BY c.slug, c.name ORDER BY count(*) DESC LIMIT 12`, [slug]),
    q<{ week: string; n: string }>(
      `WITH bounds AS (
         SELECT generate_series(date_trunc('week', now()) - interval '25 weeks',
                                date_trunc('week', now()), interval '1 week') AS week)
       SELECT to_char(b.week, 'MM-DD') AS week, count(s.id)::text AS n
         FROM bounds b
         LEFT JOIN stories s
           ON date_trunc('week', coalesce(s.published_at, s.collected_at)) = b.week
          AND s.superseded_by IS NULL
          AND s.stacks && stack_expand(ARRAY[$1]::text[])
        GROUP BY b.week ORDER BY b.week`, [slug]),
  ]);

  const points: Point[] = weekly.map((w) => ({
    label: w.week, value: Number(w.n), title: `week of ${w.week}: ${w.n} stories`,
  }));
  const total = Number(totals?.total ?? 0);

  const childChips = children.map((c) =>
    `<a class="chip" href="/all?stack=${encodeURIComponent(c.slug)}">${escapeHtml(c.slug)}
      ${Number(c.n) > 0 ? `<span class="chip-n">${c.n}</span>` : ''}</a>`).join(' ');

  const companyChips = companies.map((c) =>
    `<a class="chip" href="/company/${encodeURIComponent(c.slug)}">${escapeHtml(c.name)}
      <span class="chip-n">${c.n}</span></a>`).join(' ');

  return wrap(`
    ${pageHead(field?.label ?? root.name,
      `${total.toLocaleString('en-US')} stories across this field and everything beneath it` +
      (totals?.since ? ` · history from ${escapeHtml(totals.since)}` : ''),
      { crumbs: [...crumbsFor('/field/', 'Fields'), { label: field?.label ?? root.name }] })}
    <p style="margin:0 0 var(--s-4)">
      <a class="btn" href="/field/${encodeURIComponent(slug)}/report">Read the report</a>
      <span class="muted" style="margin-left:var(--s-2);font-size:var(--t-12)">the same stories,
        grouped and counted instead of listed</span>
    </p>

    <div class="cards">
      ${stat('Stories', total.toLocaleString('en-US'), '',
        'Everything in this field, including every technology nested beneath it.')}
      ${stat('Last 7 days', Number(totals?.week ?? 0), '',
        'Collected in the last seven days. Compare it with the 30-day figure to see '
        + 'whether the field is speeding up or going quiet.')}
      ${stat('Last 30 days', Number(totals?.month ?? 0), '',
        'Collected in the last thirty days. Retention holds two months, so this is '
        + 'most of what is still live.')}
      ${stat('Critical', Number(totals?.critical ?? 0), 'importance 8+ · act on it',
        'Stories scored 8 or above out of 10 for whether they change what you would '
        + 'build on.')}
      ${stat('Technologies', children.length, 'directly beneath',
        'Technologies sitting directly under this field in the taxonomy. Things nested '
        + 'deeper are counted in the stories total but not here.')}
    </div>

    <p class="row" style="--row-gap:var(--s-2)">
      <a class="btn primary" href="/all?stack=${encodeURIComponent(slug)}">Open in reader</a>
      <a class="btn" href="/all?stack=${encodeURIComponent(slug)}&min=8">Critical only</a>
      <a class="btn" href="/trend/${encodeURIComponent(slug)}">Trend detail</a>
    </p>

    <h2 class="sec">Volume by week published</h2>
    ${points.some((p) => p.value > 0) ? barChart(points, { height: 120 })
      : '<p class="muted">Nothing yet in this field.</p>'}

    ${childChips ? `<h2 class="sec">Technologies in this field</h2><p>${childChips}</p>` : ''}
    ${companyChips ? `<h2 class="sec">Companies active here</h2><p>${companyChips}</p>` : ''}

    ${sources.length ? `<h2 class="sec">Who covers it</h2>
      <p>${sources.map((s) => `<a class="chip" href="/all?source=${encodeURIComponent(s.name)}">
        ${escapeHtml(truncate(s.name, 28))} <span class="chip-n">${s.n}</span></a>`).join(' ')}</p>` : ''}

    <h2 class="sec">Latest</h2>
    ${recent.length === 0 ? empty('Nothing collected in this field yet.')
      : recent.map((r) => {
        const critical = (r.importance ?? 0) >= 8;
        return `<article class="item${critical ? ' crit' : ''}">
          <div>
            <h2><a href="/story/${escapeHtml(r.id)}">${escapeHtml(r.title)}</a></h2>
            <div class="meta">
              <span class="src">${escapeHtml(r.source)}</span>
              ${r.announcement ? '<span class="chip announce">announcement</span>' : ''}
              <span class="dot"></span>
              <span>${escapeHtml(relativeTime(r.when))}</span>
              <span class="dot"></span>
              <span>${r.coverage} ${r.coverage === 1 ? 'outlet' : 'outlets'}</span>
              ${r.companies.slice(0, 2).map((c) =>
                `<a class="chip" href="/company/${encodeURIComponent(c)}">${escapeHtml(c)}</a>`).join(' ')}
              <a class="readbtn" href="/read/${escapeHtml(r.id)}" data-url="${escapeHtml(r.url)}"
                title="read the article here">${icon('book', 12)}read</a>
            </div>
          </div>
          <div class="side"><span class="sev${critical ? ' hi' : ''}">${r.importance ?? '–'}</span></div>
        </article>`;
      }).join('')}`);
}

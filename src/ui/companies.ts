// Company pages.
//
// The distinction this page exists to make: what a company SAYS about itself
// versus what is written ABOUT it. A vendor's own blog is authoritative on fact
// and useless on judgement; an outlet is the reverse. Merging them into one list
// destroys the only thing a reader needs to know before believing a claim.
//
// An announcement is a story published BY a source belonging to the company
// (sources.company_slug), which is a fact about provenance, not a guess about
// tone.

import { q, one } from './db.ts';
import {
  escapeHtml, wrap, pageHead, empty, relativeTime, sparkline, truncate,
  stat, barChart, icon, type Point,
} from './html.ts';

interface CompanyRow {
  slug: string; name: string; category: string; country: string | null;
  ticker: string | null; total: string; announcements: string; week: string;
  last: string | null;
}

export async function renderCompanies(url: URL): Promise<string> {
  const category = url.searchParams.get('category') ?? '';

  const rows = await q<CompanyRow>(
    `SELECT c.slug, c.name, c.category, c.country, c.ticker,
            count(s.id)::text AS total,
            count(s.id) FILTER (WHERE src.company_slug = c.slug)::text AS announcements,
            count(s.id) FILTER (
              WHERE coalesce(s.published_at, s.collected_at) > now() - interval '7 days'
            )::text AS week,
            max(coalesce(s.published_at, s.collected_at))::text AS last
       FROM companies c
       LEFT JOIN stories s ON s.companies && ARRAY[c.slug] AND s.superseded_by IS NULL
       LEFT JOIN sources src ON src.id = s.source_id
      WHERE ($1 = '' OR c.category = $1)
      GROUP BY c.slug, c.name, c.category, c.country, c.ticker
      ORDER BY count(s.id) DESC, c.name`,
    [category],
  );

  const categories = await q<{ category: string; n: string }>(
    `SELECT category, count(*)::text AS n FROM companies GROUP BY 1 ORDER BY 2 DESC`);

  const series = await q<{ slug: string; n: string }>(
    `SELECT cs AS slug, count(*)::text AS n
       FROM stories s, LATERAL unnest(s.companies) AS cs
      WHERE s.superseded_by IS NULL
        AND coalesce(s.published_at, s.collected_at) > now() - interval '12 weeks'
      GROUP BY cs, date_trunc('week', coalesce(s.published_at, s.collected_at))
      ORDER BY cs, date_trunc('week', coalesce(s.published_at, s.collected_at))`);
  const bySlug = new Map<string, number[]>();
  for (const r of series) {
    const list = bySlug.get(r.slug) ?? [];
    list.push(Number(r.n));
    bySlug.set(r.slug, list);
  }

  const tabs = ['', ...categories.map((c) => c.category)].map((cat) => {
    const label = cat === '' ? 'All' : cat.replace('-', ' ');
    const n = cat === '' ? rows.length : Number(categories.find((c) => c.category === cat)?.n ?? 0);
    return `<a class="pill${category === cat ? ' on' : ''}"
      href="${cat ? `/companies?category=${encodeURIComponent(cat)}` : '/companies'}">
      ${escapeHtml(label)} <b>${n}</b></a>`;
  }).join('');

  const body = rows.map((r) => `<tr>
      <td><a href="/company/${encodeURIComponent(r.slug)}" style="font-weight:600">${escapeHtml(r.name)}</a>
        ${r.ticker ? `<span class="chip">${escapeHtml(r.ticker)}</span>` : ''}
        <div class="muted" style="font-size:11px">${escapeHtml(r.category)}${
          r.country ? ` · ${escapeHtml(r.country)}` : ''}</div></td>
      <td class="num">${Number(r.total).toLocaleString('en-US')}</td>
      <td class="num">${Number(r.announcements).toLocaleString('en-US')}</td>
      <td class="num">${Number(r.week).toLocaleString('en-US')}</td>
      <td>${sparkline(bySlug.get(r.slug) ?? [], { width: 70, height: 16 })}</td>
      <td class="mono">${r.last ? escapeHtml(relativeTime(r.last)) : '<span class="muted">—</span>'}</td>
    </tr>`).join('');

  return wrap(`
    ${pageHead('Companies',
      'What each company says about itself, and what is written about it — kept apart.')}
    <div class="pills" style="margin-bottom:var(--s-3)">${tabs}</div>
    <div class="scroll"><table>
      <thead><tr><th>company</th><th>stories</th><th>announcements</th>
        <th>last 7d</th><th>12-week trend</th><th>latest</th></tr></thead>
      <tbody>${body}</tbody></table></div>`);
}

export async function renderCompany(slug: string, url: URL): Promise<string> {
  const company = await one<{
    slug: string; name: string; category: string; country: string | null; ticker: string | null;
    homepage_url: string | null; newsroom_url: string | null; github_org: string | null;
    aliases: string[]; stacks: string[];
  }>(
    `SELECT slug, name, category, country, ticker, homepage_url, newsroom_url,
            github_org, aliases, stacks
       FROM companies WHERE slug = $1`, [slug]);

  if (!company) return wrap(pageHead('Unknown company', 'Not in the registry.'));

  const view = url.searchParams.get('view') ?? 'all';

  const [totals, channels, stories, weekly, stacks] = await Promise.all([
    one<{ total: string; announcements: string; coverage: string; week: string;
          critical: string; since: string | null }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE src.company_slug = $1)::text AS announcements,
              count(*) FILTER (WHERE src.company_slug IS DISTINCT FROM $1)::text AS coverage,
              count(*) FILTER (
                WHERE coalesce(s.published_at, s.collected_at) > now() - interval '7 days'
              )::text AS week,
              count(*) FILTER (WHERE s.importance >= 8)::text AS critical,
              min(coalesce(s.published_at, s.collected_at))::date::text AS since
         FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND s.companies && ARRAY[$1]`, [slug]),
    q<{ name: string; url: string; kind: string; health: string; n: string }>(
      `SELECT src.name, src.url, src.kind::text, src.health::text,
              count(s.id)::text AS n
         FROM sources src
         LEFT JOIN stories s ON s.source_id = src.id AND s.superseded_by IS NULL
        WHERE src.company_slug = $1
        GROUP BY src.name, src.url, src.kind, src.health
        ORDER BY count(s.id) DESC`, [slug]),
    q<{ id: string; title: string; url: string; source: string; when: string;
        importance: number | null; coverage: number; announcement: boolean; stacks: string[] }>(
      `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title, s.canonical_url AS url,
              src.name AS source, coalesce(s.published_at, s.collected_at)::text AS when,
              s.importance, s.coverage_count AS coverage, s.stacks,
              (src.company_slug = $1) AS announcement
         FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND s.companies && ARRAY[$1]
          AND ($2 = 'all'
               OR ($2 = 'announcements' AND src.company_slug = $1)
               OR ($2 = 'coverage' AND src.company_slug IS DISTINCT FROM $1))
        ORDER BY coalesce(s.published_at, s.collected_at) DESC LIMIT 40`, [slug, view]),
    q<{ week: string; n: string }>(
      `WITH bounds AS (
         SELECT generate_series(date_trunc('week', now()) - interval '25 weeks',
                                date_trunc('week', now()), interval '1 week') AS week)
       SELECT to_char(b.week, 'MM-DD') AS week, count(s.id)::text AS n
         FROM bounds b
         LEFT JOIN stories s
           ON date_trunc('week', coalesce(s.published_at, s.collected_at)) = b.week
          AND s.superseded_by IS NULL AND s.companies && ARRAY[$1]
        GROUP BY b.week ORDER BY b.week`, [slug]),
    q<{ slug: string; n: string }>(
      `SELECT st AS slug, count(*)::text AS n
         FROM stories s, LATERAL unnest(s.stacks) AS st
        WHERE s.superseded_by IS NULL AND s.companies && ARRAY[$1]
        GROUP BY st ORDER BY count(*) DESC LIMIT 12`, [slug]),
  ]);

  const points: Point[] = weekly.map((w) => ({
    label: w.week, value: Number(w.n), title: `week of ${w.week}: ${w.n} stories`,
  }));

  const views: [string, string, number][] = [
    ['all', 'Everything', Number(totals?.total ?? 0)],
    ['announcements', 'Announcements', Number(totals?.announcements ?? 0)],
    ['coverage', 'Coverage', Number(totals?.coverage ?? 0)],
  ];
  const segs = `<div class="segs">${views.map(([value, label, n]) =>
    `<a href="/company/${encodeURIComponent(slug)}${value === 'all' ? '' : `?view=${value}`}"
       class="${view === value ? 'on' : ''}">${escapeHtml(label)} <span class="muted">${n}</span></a>`).join('')}</div>`;

  const links = [
    company.homepage_url ? `<a href="${escapeHtml(company.homepage_url)}" target="_blank" rel="noreferrer">site ${icon('external', 11)}</a>` : '',
    company.github_org ? `<a href="https://github.com/${escapeHtml(company.github_org)}" target="_blank" rel="noreferrer">github</a>` : '',
  ].filter(Boolean).join(' · ');

  return wrap(`
    ${pageHead(company.name,
      `${escapeHtml(company.category)}${company.country ? ` · ${escapeHtml(company.country)}` : ''}` +
      `${company.ticker ? ` · ${escapeHtml(company.ticker)}` : ''}${links ? ` · ${links}` : ''}` +
      (totals?.since ? ` · history from ${escapeHtml(totals.since)}` : ''))}

    <div class="cards">
      ${stat('Stories', Number(totals?.total ?? 0).toLocaleString('en-US'), '',
        'Everything tagged to this company, its own announcements and other outlets '
        + 'writing about it together.')}
      ${stat('Announcements', Number(totals?.announcements ?? 0), 'first-party',
        'Stories from the company itself — its own blog, changelog or status page.')}
      ${stat('Coverage', Number(totals?.coverage ?? 0), 'third-party',
        'Stories about the company written by somebody else. Kept apart from its own '
        + 'announcements deliberately: a company saying a thing and the press reporting '
        + 'it are different evidence.')}
      ${stat('Last 7 days', Number(totals?.week ?? 0), '',
        'Collected in the last seven days.')}
      ${stat('Critical', Number(totals?.critical ?? 0), 'importance 8+ · act on it',
        'Stories scored 8 or above out of 10 for whether they change what you would '
        + 'build on.')}
    </div>

    ${channels.length === 0 ? `<div class="notice">${icon('alert', 14)}
      <span>No first-party channel is registered for ${escapeHtml(company.name)}, so everything here is
      third-party coverage. Add its blog or newsroom to <code>seeds/companies.ts</code> to separate
      what it says from what is said about it.</span></div>` : ''}

    <h2 class="sec">Volume by week published</h2>
    ${points.some((p) => p.value > 0) ? barChart(points, { height: 120 })
      : '<p class="muted">Nothing collected about this company yet.</p>'}

    ${stacks.length ? `<h2 class="sec">Technologies</h2>
      <p>${stacks.map((s) => `<a class="chip" href="/all?stack=${encodeURIComponent(s.slug)}">
        ${escapeHtml(s.slug)} <span class="chip-n">${s.n}</span></a>`).join(' ')}</p>` : ''}

    ${channels.length ? `<h2 class="sec">Official channels</h2>
      <p>${channels.map((c) => `<a class="chip" href="/all?source=${encodeURIComponent(c.name)}">
        ${escapeHtml(truncate(c.name, 34))} <span class="chip-n">${c.n}</span></a>`).join(' ')}</p>` : ''}

    <h2 class="sec">Stories</h2>
    ${segs}
    ${stories.length === 0 ? empty('Nothing here yet.')
      : stories.map((r) => {
        const critical = (r.importance ?? 0) >= 8;
        return `<article class="item${critical ? ' crit' : ''}">
          <div>
            <h2><a href="/story/${escapeHtml(r.id)}">${escapeHtml(r.title)}</a></h2>
            <div class="meta">
              <span class="src">${escapeHtml(r.source)}</span>
              ${r.announcement
                ? '<span class="chip announce">announcement</span>'
                : '<span class="chip">coverage</span>'}
              <span class="dot"></span>
              <span>${escapeHtml(relativeTime(r.when))}</span>
              <span class="dot"></span>
              <span>${r.coverage} ${r.coverage === 1 ? 'outlet' : 'outlets'}</span>
              ${r.stacks.slice(0, 2).map((s) =>
                `<a class="chip" href="/all?stack=${encodeURIComponent(s)}">${escapeHtml(s)}</a>`).join(' ')}
              <a class="readbtn" href="/read/${escapeHtml(r.id)}" data-url="${escapeHtml(r.url)}"
                title="read the article here">${icon('book', 12)}read</a>
            </div>
          </div>
          <div class="side"><span class="sev${critical ? ' hi' : ''}">${r.importance ?? '–'}</span></div>
        </article>`;
      }).join('')}`);
}

/** Companies with the most activity, for the rail. */
export async function topCompanies(limit = 10): Promise<{ slug: string; name: string; n: number }[]> {
  const rows = await q<{ slug: string; name: string; n: string }>(
    `SELECT c.slug, c.name, count(s.id)::text AS n
       FROM companies c
       JOIN stories s ON s.companies && ARRAY[c.slug] AND s.superseded_by IS NULL
      WHERE coalesce(s.published_at, s.collected_at) > now() - interval '30 days'
      GROUP BY c.slug, c.name ORDER BY count(s.id) DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({ slug: r.slug, name: r.name, n: Number(r.n) }));
}

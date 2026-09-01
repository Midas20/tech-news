// The source registry as a reading surface rather than a raw table.
//
// The question this page answers is "is my collection actually working", which
// the admin table cannot answer at a glance: it needs health, yield and recency
// side by side, ordered by what is broken rather than by name.

import { q } from './db.ts';
import { escapeHtml, wrap, pageHead, table, stat, relativeTime, truncate } from './html.ts';
import { crumbsFor } from './nav.ts';

interface SourceRow {
  id: string;
  name: string;
  url: string;
  feed_url: string | null;
  health: string;
  roles: string[];
  lang: string | null;
  country: string | null;
  interval_s: number;
  failures: number;
  last_success: string | null;
  stories: number;
  latest: string | null;
  last_error: string | null;
}

const HEALTH_ORDER = `CASE health
    WHEN 'failing' THEN 0 WHEN 'degraded' THEN 1 WHEN 'dead' THEN 2
    WHEN 'paused' THEN 3 ELSE 4 END`;

export async function renderSources(url: URL): Promise<string> {
  const filter = url.searchParams.get('health') ?? '';
  const search = url.searchParams.get('sq')?.trim() ?? '';

  const params: unknown[] = [];
  const clauses: string[] = [];
  if (filter) clauses.push(`s.health = $${params.push(filter)}::source_health`);
  if (search) clauses.push(`s.name ILIKE $${params.push(`%${search}%`)}`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const [rows, counts] = await Promise.all([
    q<SourceRow>(
      `SELECT s.id::text, s.name, s.url, s.feed_url, s.health::text, s.roles::text[] AS roles,
              s.lang::text, s.country, s.poll_interval_seconds AS interval_s,
              s.consecutive_failures AS failures, s.last_success_at::text AS last_success,
              s.last_error,
              coalesce(st.n, 0)::int AS stories, st.latest::text AS latest
         FROM sources s
         LEFT JOIN LATERAL (
           SELECT count(*) AS n, max(collected_at) AS latest
             FROM stories WHERE source_id = s.id AND superseded_by IS NULL
         ) st ON true
         ${where}
        ORDER BY ${HEALTH_ORDER}, coalesce(st.n, 0) DESC, s.name
        LIMIT 400`, params),
    q<{ health: string; n: string }>(
      `SELECT health::text, count(*)::text AS n FROM sources GROUP BY 1 ORDER BY 2 DESC`),
  ]);

  const producing = rows.filter((r) => r.stories > 0).length;

  // The database's words, said the way a person would. `health` is an enum and
  // its values are lowercase identifiers; printing them raw made a filter row
  // reading "healthy degraded failing paused dead" look like log output.
  const HEALTH_LABEL: Record<string, string> = {
    healthy: 'Healthy', degraded: 'Struggling', failing: 'Failing',
    paused: 'Paused', dead: 'Given up on',
  };
  const tabs = ['', 'healthy', 'degraded', 'failing', 'paused', 'dead'].map((h) => {
    const label = h === '' ? 'All' : HEALTH_LABEL[h] ?? h;
    const n = h === '' ? counts.reduce((a, c) => a + Number(c.n), 0)
      : Number(counts.find((c) => c.health === h)?.n ?? 0);
    const href = h === '' ? '/sources' : `/sources?health=${h}`;
    const on = filter === h;
    return `<a class="pill" href="${href}"${on ? ' style="border-color:var(--link);color:var(--ink)"' : ''}>
      ${escapeHtml(label)} <b>${n}</b></a>`;
  }).join('');

  const body = rows.map((r) => {
    const healthClass = r.health === 'healthy' ? 'ok'
      : r.health === 'paused' ? 'muted'
      : r.health === 'degraded' ? 'warn' : 'accent';
    return `<tr>
      <td><a href="/all?source=${encodeURIComponent(r.name)}" style="font-weight:600">${escapeHtml(r.name)}</a>
        <div class="muted" style="font-size:var(--t-11)">${escapeHtml(truncate(r.feed_url ?? r.url, 64))}</div></td>
      <td class="mono ${healthClass}">${escapeHtml(r.health)}${
        r.failures > 0 ? ` <span class="muted">×${r.failures}</span>` : ''}</td>
      <td>${r.roles.map((x) => `<span class="chip">${escapeHtml(x.toLowerCase())}</span>`).join(' ')}</td>
      <td class="mono">${escapeHtml(r.lang ?? '—')}${r.country ? ` · ${escapeHtml(r.country)}` : ''}</td>
      <td class="num">${r.stories.toLocaleString('en-US')}</td>
      <td class="mono">${r.latest ? escapeHtml(relativeTime(r.latest)) : '<span class="muted">never</span>'}</td>
      <td class="mono">${Math.round(r.interval_s / 60)}m</td>
      <td class="muted" style="font-size:var(--t-11)">${escapeHtml(truncate(r.last_error ?? '', 70))}</td>
    </tr>`;
  }).join('');

  return wrap(`
    ${pageHead('Sources',
      `${rows.length.toLocaleString('en-US')} shown · ${producing} producing stories`,
      { crumbs: crumbsFor('/sources', 'Sources') })}

    <div class="cards">
      ${counts.map((c) => stat(c.health, Number(c.n).toLocaleString('en-US'), 'sources')).join('')}
    </div>

    <form method="get" action="/sources" class="row" style="margin-bottom:var(--s-2)">
      ${filter ? `<input type="hidden" name="health" value="${escapeHtml(filter)}">` : ''}
      <input class="txt" type="search" name="sq" value="${escapeHtml(search)}"
        placeholder="filter by name…">
      <button class="btn primary" type="submit">Filter</button>
    </form>

    <div class="pills" style="margin-bottom:var(--s-3)">${tabs}
      <a class="pill" href="/sources/intel" title="what the registry is made of">Intelligence &rarr;</a></div>

    ${rows.length === 0 ? '<div class="empty">No sources match.</div>' : `<div class="scroll"><table>
      <thead><tr><th>source</th><th>health</th><th>roles</th><th>lang</th>
        <th>stories</th><th>latest</th><th>every</th><th>last error</th></tr></thead>
      <tbody>${body}</tbody></table></div>`}
  `);
}

export { table };

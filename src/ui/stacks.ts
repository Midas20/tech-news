// The technology catalogue.
//
// The taxonomy is a CLOSED vocabulary -- every entry hand-curated, each with a
// slug that is simultaneously its URL, its filter value and the tag a model is
// allowed to return. That makes it the one part of the system worth reading as a
// catalogue rather than as a filter dropdown: if a technology is not here, no
// amount of collection will ever surface it, and knowing what is missing is as
// useful as knowing what is covered.
//
// Category is the top-level split because it is the one property every entry
// has, it is closed (nineteen values, enforced by a CHECK constraint), and it
// cuts across the parent/child tree rather than repeating it. "Which databases
// do we track" is a question the hierarchy answers badly and this answers well.

import { q, one } from './db.ts';
import { escapeHtml, wrap, pageHead, empty, truncate, subnav, kpi } from './html.ts';
import { crumbsFor } from './nav.ts';


/**
 * The nineteen categories, in the order the CHECK constraint allows them and
 * grouped by what they are FOR rather than alphabetically.
 */
// Imported for local use and re-exported, because the pages that already
// import CATEGORIES from here should not all have to move.
import { CATEGORIES, type Category } from '../vocab/categories.ts';
export { CATEGORIES, type Category };


const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function category(id: string): Category {
  return BY_ID.get(id) ?? { id, label: id, color: '#8a929e', blurb: '' };
}

interface StackRow {
  slug: string;
  name: string;
  category: string;
  status: string;
  parent: string | null;
  parent_name: string | null;
  aliases: string[];
  children: number;
  docs_url: string | null;
  repo_url: string | null;
  release_feed_url: string | null;
  description: string | null;
  /** Wikidata's one-line description, for the row. See 0052. */
  blurb: string | null;
  curated: boolean;
  stories: number;
  recent: number;
  latest: string | null;
}

/**
 * One query for the whole catalogue view.
 *
 * Story counts use stack_expand, so a parent shows the weight of its entire
 * subtree: "languages" counts Rust, Go and TypeScript underneath it, which is the
 * number someone deciding whether to follow it actually needs.
 */
async function stackRows(where: string, params: unknown[], order: string, limit: number): Promise<StackRow[]> {
  return q<StackRow>(
    `SELECT st.slug, st.name, st.category, st.current_status AS status,
            p.slug AS parent, p.name AS parent_name, st.aliases,
            st.docs_url, st.repo_url, st.release_feed_url, st.description, st.curated,
            -- One line saying what it is. Wikidata writes these to disambiguate
            -- an item in a list, which is exactly what this is. See 0052.
            ref.short_description AS blurb,
            (SELECT count(*) FROM stacks k WHERE k.parent_id = st.id)::int AS children,
            coalesce(agg.n, 0)::int AS stories,
            coalesce(agg.recent, 0)::int AS recent,
            agg.latest::text AS latest
       FROM stacks st
       LEFT JOIN stacks p ON p.id = st.parent_id
       LEFT JOIN entity_reference ref
              ON ref.subject_kind = 'stack' AND ref.subject_id = st.id
       LEFT JOIN LATERAL (
         SELECT count(*) AS n,
                count(*) FILTER (
                  WHERE coalesce(s.published_at, s.collected_at) > now() - interval '30 days') AS recent,
                max(coalesce(s.published_at, s.collected_at)) AS latest
           FROM stories s
          WHERE s.superseded_by IS NULL AND s.stacks && stack_expand(ARRAY[st.slug]::text[])
       ) agg ON true
       ${where}
      ORDER BY ${order}
      LIMIT ${limit}`, params);
}

const SORTS: Record<string, string> = {
  activity: 'coalesce(agg.recent, 0) DESC, coalesce(agg.n, 0) DESC, st.name',
  stories: 'coalesce(agg.n, 0) DESC, st.name',
  name: 'st.name',
  newest: 'agg.latest DESC NULLS LAST, st.name',
};

const SORT_LABELS: Record<string, string> = {
  activity: 'Most active (30 days)',
  stories: 'Most covered, all time',
  name: 'Alphabetical',
  newest: 'Most recently seen',
};

function categoryCounts(): Promise<{ category: string; n: string; tracked: string; stories: string }[]> {
  return q(
    `SELECT st.category,
            count(*)::text AS n,
            count(*) FILTER (WHERE st.release_feed_url IS NOT NULL)::text AS tracked,
            coalesce(sum(agg.n), 0)::text AS stories
       FROM stacks st
       LEFT JOIN LATERAL (
         SELECT count(*) AS n FROM stories s
          WHERE s.superseded_by IS NULL AND s.stacks && ARRAY[st.slug]
       ) agg ON true
      GROUP BY st.category`);
}

export async function renderCatalogue(url: URL): Promise<string> {
  const search = url.searchParams.get('sq')?.trim() ?? '';
  const sort = SORTS[url.searchParams.get('sort') ?? ''] ? url.searchParams.get('sort')! : 'activity';

  const [counts, totals] = await Promise.all([
    categoryCounts(),
    one<{ stacks: string; aliases: string; feeds: string; repos: string; roots: string }>(
      `SELECT count(*)::text AS stacks,
              coalesce(sum(array_length(aliases, 1)), 0)::text AS aliases,
              count(*) FILTER (WHERE release_feed_url IS NOT NULL)::text AS feeds,
              count(*) FILTER (WHERE repo_url IS NOT NULL)::text AS repos,
              count(*) FILTER (WHERE parent_id IS NULL)::text AS roots
         FROM stacks`),
  ]);

  const byId = new Map(counts.map((c) => [c.category, c]));

  // A search from this page is a search of the vocabulary, not of the archive.
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    clauses.push(`(lower(st.name) LIKE $${params.push(like)}
       OR lower(st.slug) LIKE $${params.length}
       OR EXISTS (SELECT 1 FROM unnest(st.aliases) a WHERE lower(a) LIKE $${params.length}))`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await stackRows(where, params, SORTS[sort]!, search ? 200 : 60);

  const cards = CATEGORIES.map((c) => {
    const n = byId.get(c.id);
    if (!n) return '';
    return `<a class="catcard" href="/technology/${c.id}" style="--cat:${c.color}">
      <div class="cn">${escapeHtml(c.label)}</div>
      <div class="cd">${escapeHtml(c.blurb)}</div>
      <div class="cm">
        <span>${Number(n.n).toLocaleString('en-US')} tracked</span>
        <span>${Number(n.stories).toLocaleString('en-US')} stories</span>
      </div>
    </a>`;
  }).join('');

  return wrap(`
    ${pageHead('Technologies',
      `${Number(totals?.stacks ?? 0).toLocaleString('en-US')} technologies in a closed vocabulary, ` +
      `${Number(totals?.aliases ?? 0).toLocaleString('en-US')} aliases resolving into it. ` +
      'A tag a model returns that is not in here is discarded rather than stored.',
      {
        crumbs: crumbsFor('/technologies', 'By category'),
        actions: '<a class="btn" href="/stacks">Full registry</a>',
      })}

    ${subnav([
      { href: '/technologies', label: 'By category', icon: 'grid', active: true },
      { href: '/stacks', label: 'Full registry', icon: 'table' },
    ])}

    <div class="kpis">
      ${kpi({ label: 'Technologies', value: Number(totals?.stacks ?? 0) })}
      ${kpi({ label: 'Aliases', value: Number(totals?.aliases ?? 0), note: 'resolved to a slug' })}
      ${kpi({ label: 'Release feeds', value: Number(totals?.feeds ?? 0), note: 'polled directly' })}
      ${kpi({ label: 'Repositories', value: Number(totals?.repos ?? 0) })}
      ${kpi({ label: 'Roots', value: Number(totals?.roots ?? 0), note: 'top-level fields' })}
    </div>

    <h2 class="sec">By category</h2>
    <div class="catgrid">${cards}</div>

    <h2 class="sec">${search ? `Matching “${escapeHtml(search)}”` : 'Most active technologies'}</h2>
    ${searchBar(search, sort, '/technologies')}
    ${rows.length === 0 ? empty('Nothing in the vocabulary matches that.')
      : `<div class="stacklist">${rows.map(stackRow).join('')}</div>`}
    ${!search ? `<p class="note" style="margin-top:var(--s-2)">Showing the 60 most active.
      Open a category above for its full list.</p>` : ''}
  `);
}

export async function renderCategory(id: string, url: URL): Promise<string> {
  const cat = BY_ID.get(id);
  if (!cat) return wrap(pageHead('Unknown category', 'Not one of the nineteen.'));

  const search = url.searchParams.get('sq')?.trim() ?? '';
  const sort = SORTS[url.searchParams.get('sort') ?? ''] ? url.searchParams.get('sort')! : 'activity';

  const params: unknown[] = [id];
  const clauses = ['st.category = $1'];
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    clauses.push(`(lower(st.name) LIKE $${params.push(like)}
       OR lower(st.slug) LIKE $${params.length}
       OR EXISTS (SELECT 1 FROM unnest(st.aliases) a WHERE lower(a) LIKE $${params.length}))`);
  }

  const [rows, totals] = await Promise.all([
    stackRows(`WHERE ${clauses.join(' AND ')}`, params, SORTS[sort]!, 400),
    one<{ n: string; feeds: string; deprecated: string }>(
      `SELECT count(*)::text AS n,
              count(*) FILTER (WHERE release_feed_url IS NOT NULL)::text AS feeds,
              count(*) FILTER (WHERE current_status = 'deprecated')::text AS deprecated
         FROM stacks WHERE category = $1`, [id]),
  ]);

  const covered = rows.filter((r) => r.stories > 0).length;
  const quiet = rows.filter((r) => r.stories === 0);

  return wrap(`
    ${pageHead(cat.label, escapeHtml(cat.blurb), {
      crumbs: [...crumbsFor('/technology/', 'By category'), { label: cat.label }],
    })}

    ${subnav(CATEGORIES.map((c) => ({
      href: `/technology/${c.id}`, label: c.label, active: c.id === id,
    })))}

    <div class="kpis">
      ${kpi({ label: 'Tracked', value: Number(totals?.n ?? 0) })}
      ${kpi({ label: 'Seen in the archive', value: covered,
        note: `${Math.round((covered / Math.max(1, rows.length)) * 100)}% of this category` })}
      ${kpi({ label: 'Release feeds', value: Number(totals?.feeds ?? 0), note: 'polled directly' })}
      ${kpi({ label: 'Deprecated', value: Number(totals?.deprecated ?? 0) })}
    </div>

    ${searchBar(search, sort, `/technology/${id}`)}

    ${rows.length === 0 ? empty('Nothing in this category matches.')
      : `<div class="stacklist" style="--cat:${cat.color}">${rows.map(stackRow).join('')}</div>`}

    ${quiet.length && !search ? `<p class="note" style="margin-top:var(--s-3)">
      ${quiet.length} of these have never appeared in a story. That is a coverage gap,
      not an error: the vocabulary is curated ahead of collection on purpose, so a
      technology is recognised the first time it is mentioned rather than the first
      time someone notices it is missing.</p>` : ''}
  `);
}

function searchBar(search: string, sort: string, action: string): string {
  return `<form method="get" action="${action}" class="row" style="margin:0 0 var(--s-3);--row-gap:var(--s-2)">
    <input class="txt" type="search" name="sq" value="${escapeHtml(search)}"
      placeholder="name, slug or alias…">
    <label for="cat-sort">Sort</label>
    <select id="cat-sort" name="sort" onchange="this.form.submit()">
      ${Object.entries(SORT_LABELS).map(([v, l]) =>
        `<option value="${v}"${sort === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}
    </select>
    <button class="btn" type="submit">Search the vocabulary</button>
  </form>`;
}

function stackRow(r: StackRow): string {
  const cat = category(r.category);
  const aliases = r.aliases.filter((a) => a.toLowerCase() !== r.slug.toLowerCase());
  const links = [
    r.docs_url ? `<a href="${escapeHtml(r.docs_url)}" target="_blank" rel="noreferrer">docs</a>` : '',
    r.repo_url ? `<a href="${escapeHtml(r.repo_url)}" target="_blank" rel="noreferrer">repo</a>` : '',
    r.release_feed_url ? `<a href="${escapeHtml(r.release_feed_url)}" target="_blank" rel="noreferrer">feed</a>` : '',
  ].filter(Boolean).join('');

  return `<div class="stackrow" style="--cat:${cat.color}">
    <div style="min-width:0">
      <div class="nm">
        <span class="dotc"></span>
        <a href="/trend/${encodeURIComponent(r.slug)}"><b>${escapeHtml(r.name)}</b></a>
        <span class="sl">${escapeHtml(r.slug)}</span>
        <span class="statusdot ${escapeHtml(r.status)}" title="${escapeHtml(r.status)}"></span>
        ${r.children > 0 ? `<span class="chip">${r.children} beneath</span>` : ''}
      </div>
      <div class="al">
        <span class="catlabel">${escapeHtml(cat.label.toLowerCase())}</span>
        ${r.parent ? ` in <a href="/trend/${encodeURIComponent(r.parent)}">${escapeHtml(r.parent_name ?? r.parent)}</a>` : ''}
        ${aliases.length ? ` · also ${escapeHtml(truncate(aliases.join(', '), 60))}` : ''}
      </div>
      ${r.blurb ? `<div class="blurb">${escapeHtml(r.blurb)}</div>`
        : r.description ? `<div class="blurb">${escapeHtml(r.description)}</div>` : ''}
    </div>
    <div class="num" title="stories in the last 30 days">${r.recent.toLocaleString('en-US')}
      <small>30d</small></div>
    <div class="num cw" title="stories all time">${r.stories.toLocaleString('en-US')}
      <small>total</small></div>
    <div class="lnk">
      ${links}
      <a href="/all?stack=${encodeURIComponent(r.slug)}">read</a>
    </div>
  </div>`;
}

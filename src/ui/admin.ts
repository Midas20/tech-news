// Admin views: every table in the database, plus the operational panels that
// matter during the Phase 1 observation week.
//
// TWO THINGS TO BE CLEAR ABOUT
//
// 1. These views connect as the OWNER role, which carries BYPASSRLS. That is the
//    point -- an admin surface must see every tenant. It is also why the server
//    binds to loopback only and is not part of the deployed Worker.
// 2. Secret-bearing columns are never rendered. tenant_secrets holds workspace
//    bot tokens; it is listed with a row count and nothing else.

import { qOwner as adminQuery } from './db.ts';
import { table, stat, escapeHtml, wrap, pageHead, railGroup, type RailItem } from './html.ts';

export interface TableInfo {
  name: string;
  kind: 'table' | 'view';
  group: string;
  rows: number;
}

/** Tables whose contents are never rendered, whatever the query says. */
const SECRET_TABLES = new Set(['tenant_secrets']);
/** Columns redacted wherever they appear. */
const SECRET_COLUMNS = /(token|secret|password|api_key|_enc)$/i;

const PAGE_SIZE = 50;

const GROUPS: Record<string, string> = {
  sources: 'Collection', source_candidates: 'Collection', source_budgets: 'Collection',
  fetch_log: 'Collection', stacks: 'Collection',
  stories: 'Archive', story_keys: 'Archive', story_members: 'Archive',
  coverage_snapshots: 'Archive', engagement_snapshots: 'Archive', snapshot_schedule: 'Archive',
  tenants: 'Tenant', tenant_users: 'Tenant', tenant_secrets: 'Tenant', channels: 'Tenant',
  users: 'Tenant', deliveries: 'Tenant', delivery_feedback: 'Tenant', analyses: 'Tenant',
  saved_views: 'Tenant', saved_items: 'Tenant', thread_state: 'Tenant',
  tools: 'Registries', tool_signals: 'Registries', platforms: 'Registries',
  platform_facts: 'Registries', platform_signals: 'Registries',
  page_watches: 'Registries', page_diffs: 'Registries',
  jobs: 'Operational', llm_cache: 'Operational', provider_budgets: 'Operational',
  quality_samples: 'Operational', schema_migrations: 'Operational',
};

/**
 * The table catalogue, with live row counts. Partitions are folded into their
 * parent rather than listed -- stories_2026_08 is not a separate thing to browse.
 *
 * WHY THIS IS ONE QUERY AND NOT EIGHTY-SIX
 *
 * It used to be a loop: list the tables, then `SELECT count(*)` from each, one
 * round trip at a time. Every /admin page calls this to build its rail, so every
 * admin page paid for all of them -- measured at 1.75s for /admin, /admin/health
 * and /admin/jobs alike, against 50-500ms for every other page in the
 * application. The counting was never the cost; the eighty-six round trips were.
 *
 * query_to_xml runs a query from a string and returns its result, which is what
 * makes it possible to count every table inside a single statement. It is not a
 * trick to reach for often, and it earns its place here: the alternative that
 * IS one round trip is pg_class.reltuples, and that is an estimate which reads
 * as -1 for anything never analysed -- a navigation menu that says a table has
 * minus one rows is worse than a slow one.
 *
 * The loop survives as a fallback. If one view in the schema cannot execute, the
 * single statement fails as a whole while the loop degrades to -1 for that one
 * row, so the fast path is tried first and the correct-under-all-conditions path
 * catches it.
 */
let catalogueCache: { at: number; value: TableInfo[] } | null = null;
const CATALOGUE_TTL_MS = 10_000;

export async function catalogue(): Promise<TableInfo[]> {
  if (catalogueCache && Date.now() - catalogueCache.at < CATALOGUE_TTL_MS) {
    return catalogueCache.value;
  }

  const rows = await adminQuery<{ name: string; kind: string }>(`
    SELECT c.relname AS name,
           CASE c.relkind WHEN 'v' THEN 'view' ELSE 'table' END AS kind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r','p','v')
       AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
     ORDER BY c.relname`);

  const counts = await countAll(rows.map((r) => r.name));

  const out = rows.map((row) => ({
    name: row.name,
    kind: row.kind as 'table' | 'view',
    group: GROUPS[row.name] ?? (row.kind === 'view' ? 'Views' : 'Other'),
    rows: counts.get(row.name) ?? -1,
  }));
  catalogueCache = { at: Date.now(), value: out };
  return out;
}

/** Every count in one round trip, with the old loop as the safety net. */
async function countAll(names: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (names.length === 0) return out;

  try {
    const rows = await adminQuery<{ name: string; n: string }>(`
      SELECT c.relname AS name,
             (xpath('/row/cnt/text()',
                    query_to_xml(format('SELECT count(*) AS cnt FROM %I.%I',
                                        n.nspname, c.relname),
                                 false, true, '')))[1]::text AS n
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])`, [names]);
    for (const r of rows) out.set(r.name, Number(r.n ?? -1));
    if (out.size === names.length) return out;
  } catch {
    // One unrunnable view aborts the whole statement. Fall through.
    out.clear();
  }

  for (const name of names) {
    if (out.has(name)) continue;
    try {
      const c = await adminQuery<{ n: string }>(`SELECT count(*)::text AS n FROM "${name}"`);
      out.set(name, Number(c[0]?.n ?? 0));
    } catch {
      out.set(name, -1); // a view that cannot run says so rather than hiding
    }
  }
  return out;
}

/**
 * The table catalogue, as rail groups.
 *
 * This used to emit its own headings and links, which meant the one page with
 * the most navigation on it was the one page that did not look like the rest of
 * the application. It is the same component as every other rail group now.
 */
export function adminNav(tables: TableInfo[], active: string): string {
  const order = ['Collection', 'Archive', 'Tenant', 'Registries', 'Operational', 'Views', 'Other'];
  const groups = new Map<string, TableInfo[]>();
  for (const t of tables) {
    const list = groups.get(t.group) ?? [];
    list.push(t);
    groups.set(t.group, list);
  }

  const out: string[] = [];
  for (const group of order) {
    const list = groups.get(group);
    if (!list?.length) continue;
    const items: RailItem[] = list.map((t) => ({
      href: `/admin/t/${encodeURIComponent(t.name)}`,
      // A view is a different kind of thing from a table and the menu says so.
      label: t.kind === 'view' ? `${t.name} ·v` : t.name,
      count: t.rows < 0 ? '—' : t.rows,
      sub: true,
      active: t.name === active,
    }));
    out.push(railGroup(group, items));
  }
  return out.join('');
}

export async function overview(tables: TableInfo[]): Promise<string> {
  const find = (n: string) => tables.find((t) => t.name === n)?.rows ?? 0;

  const [funnel] = await adminQuery<{ seen: string; kept: string; fetches: string; errors: string; not_modified: string }>(
    `SELECT coalesce(sum(items_seen),0)::text AS seen,
            coalesce(sum(items_kept),0)::text AS kept,
            count(*)::text AS fetches,
            count(*) FILTER (WHERE error IS NOT NULL)::text AS errors,
            count(*) FILTER (WHERE not_modified)::text AS not_modified
       FROM fetch_log WHERE fetched_at > now() - interval '24 hours'`,
  );

  const langs = await adminQuery<{ lang: string; n: string }>(
    `SELECT lang::text, count(*)::text AS n FROM stories
      WHERE superseded_by IS NULL GROUP BY 1 ORDER BY 2 DESC`,
  );

  const drops = await adminQuery<{ reason: string; n: string }>(
    `SELECT k AS reason, sum(v::int)::text AS n
       FROM fetch_log, LATERAL jsonb_each_text(drop_reasons) AS d(k, v)
      WHERE fetched_at > now() - interval '24 hours'
      GROUP BY k ORDER BY sum(v::int) DESC LIMIT 10`,
  );

  const recent = await adminQuery(
    `SELECT coalesce(s.title_en, s.title_original) AS title, src.name AS source,
            s.lang::text, s.country, s.coverage_count AS coverage,
            s.collected_at::text AS collected
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE s.superseded_by IS NULL
      ORDER BY s.collected_at DESC LIMIT 25`,
  );

  const totalRows = tables.filter((t) => t.kind === 'table').reduce((n, t) => n + Math.max(0, t.rows), 0);

  const langBar = langs
    .map((l) => `<span class="chip">${escapeHtml(l.lang)} ${Number(l.n).toLocaleString('en-US')}</span>`)
    .join(' ');

  return wrap(`
    ${pageHead('Database',
      `Owner-level view — RLS bypassed by design · ${tables.length} relations · ` +
      `${totalRows.toLocaleString('en-US')} rows`,
      { crumbs: [{ label: 'System', href: '/sources' }, { label: 'Database' }] })}

    <div class="cards">
      ${stat('Stories (live)', find('stories').toLocaleString('en-US'), 'not superseded',
        'Story rows a reader can reach. A merged duplicate keeps its row and points at '
        + 'the winner, so it is held but not counted here.')}
      ${stat('Sources', find('sources').toLocaleString('en-US'), `${find('stacks')} stacks`,
        'Every source row, paused ones included. The registry is curated: a source '
        + 'reports that a technology changed, not that something happened at a company.')}
      ${stat('Fetches 24h', Number(funnel?.fetches ?? 0).toLocaleString('en-US'),
        `${Number(funnel?.not_modified ?? 0)} not-modified`,
        'Feed requests made in the last day. A high not-modified share is the system '
        + 'working: the source said nothing changed and sent no body.')}
      ${stat('Items seen 24h', Number(funnel?.seen ?? 0).toLocaleString('en-US'),
        `${Number(funnel?.kept ?? 0)} kept`,
        'Feed entries examined against entries stored. Most are dropped as already '
        + 'held, too short, or off-topic, and every drop is recorded with its reason.')}
      ${stat('Jobs queued', find('jobs').toLocaleString('en-US'), 'phase 2 backlog',
        'Per-story work waiting to be done — classification, scoring, snapshots. This is '
        + 'the work queue, not the scheduled jobs on /admin/jobs.')}
      ${stat('Candidate domains', find('source_candidates').toLocaleString('en-US'), 'discovery loop',
        'Domains seen linked from stories often enough to be worth considering as '
        + 'sources. Proposed only; nothing is added to the registry without a decision.')}
    </div>

    <div class="cards">
      <div class="card"><h2 class="sec">Languages in the archive</h2>${langBar || '<span class="muted">none yet</span>'}</div>
      <div class="card"><h2 class="sec">Top drop reasons (24h)</h2>
        ${drops.length === 0 ? '<span class="muted">none</span>' : drops
          .map((d) => `<span class="chip">${escapeHtml(d.reason)} ${Number(d.n).toLocaleString('en-US')}</span>`)
          .join(' ')}
      </div>
    </div>

    <h2 class="sec">Most recently collected</h2>
    ${table(
      [{ name: 'title' }, { name: 'source' }, { name: 'lang' }, { name: 'country' },
       { name: 'coverage' }, { name: 'collected' }],
      recent,
    )}`);
}

export async function health(): Promise<string> {
  const byHealth = await adminQuery<{ health: string; n: string }>(
    `SELECT health::text, count(*)::text AS n FROM sources GROUP BY 1 ORDER BY 2 DESC`,
  );

  const worst = await adminQuery(
    `SELECT name, health::text, consecutive_failures AS failures, roles::text[] AS roles,
            lang::text, poll_interval_seconds AS interval_s,
            last_error, last_success_at::text AS last_success
       FROM sources
      WHERE consecutive_failures > 0 OR health <> 'healthy'
      ORDER BY consecutive_failures DESC, name LIMIT 40`,
  );

  const producers = await adminQuery(
    `SELECT src.name, count(*)::int AS stories, max(s.collected_at)::text AS latest
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE s.superseded_by IS NULL
      GROUP BY src.name ORDER BY 2 DESC LIMIT 25`,
  );

  const silent = await adminQuery(
    `SELECT s.name, s.health::text, s.roles::text[] AS roles, s.feed_url,
            s.last_success_at::text AS last_success
       FROM sources s
      WHERE NOT EXISTS (SELECT 1 FROM stories st WHERE st.source_id = s.id)
        AND s.last_fetch_at IS NOT NULL
      ORDER BY s.name LIMIT 40`,
  );

  const funnel = await adminQuery(
    `SELECT day::text, seen, kept, fetches, not_modified, errors FROM ingest_funnel LIMIT 14`,
  );

  return wrap(`
    ${pageHead('Collection health',
      'What arrived, what survived, and what is quietly broken.',
      { crumbs: [{ label: 'System', href: '/sources' }, { label: 'Collection health' }] })}

    <div class="cards">
      ${byHealth.map((h) => stat(h.health, Number(h.n).toLocaleString('en-US'), 'sources',
        'Sources in this state. A source that fails repeatedly is paused with a recorded '
        + 'reason and kept, so the registry never loses why something stopped.')).join('')}
    </div>

    <h2 class="sec">Daily ingest funnel</h2>
    ${table([{ name: 'day' }, { name: 'fetches' }, { name: 'seen' }, { name: 'kept' },
             { name: 'not_modified' }, { name: 'errors' }], funnel)}

    <h2 class="sec">Sources failing</h2>
    ${table([{ name: 'name' }, { name: 'health' }, { name: 'failures' }, { name: 'roles' },
             { name: 'lang' }, { name: 'interval_s' }, { name: 'last_error' }, { name: 'last_success' }], worst)}

    <h2 class="sec">Fetched but never produced a story</h2>
    <p class="note">Not necessarily broken — a feed of teasers, an API with no
      adapter, or a source whose items all fail the length gate. Worth reading before trusting a silence.</p>
    ${table([{ name: 'name' }, { name: 'health' }, { name: 'roles' }, { name: 'feed_url' },
             { name: 'last_success' }], silent)}

    <h2 class="sec">Top producers</h2>
    ${table([{ name: 'name' }, { name: 'stories' }, { name: 'latest' }], producers)}`);
}

export async function rlsPanel(): Promise<string> {
  const tables = await adminQuery(
    `SELECT c.relname AS "table", c.relrowsecurity AS "rls enabled",
            c.relforcerowsecurity AS forced,
            (SELECT count(*) FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = c.relname)::int AS policies
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
        AND c.relrowsecurity
      ORDER BY c.relname`,
  );

  const roles = await adminQuery(
    `SELECT rolname AS role, rolcanlogin AS "can login", rolbypassrls AS "bypasses rls",
            rolsuper AS superuser
       FROM pg_roles
      WHERE rolname NOT LIKE 'pg\\_%'
      ORDER BY rolbypassrls DESC, rolname`,
  );

  const policies = await adminQuery(
    `SELECT tablename AS "table", policyname AS policy, roles::text[] AS roles,
            cmd AS command, qual AS using_expr
       FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename`,
  );

  return wrap(`
    ${pageHead('Tenant isolation',
      'Row-level security as the database actually reports it, not as the migrations intended it.',
      { crumbs: [{ label: 'System', href: '/sources' }, { label: 'Tenant isolation' }] })}

    <div class="notice">
      <strong>Two ways to skip RLS, not one.</strong> <code>FORCE ROW LEVEL SECURITY</code> closes the
      table-owner exemption. It does <em>not</em> close the <code>BYPASSRLS</code> role attribute, which
      skips row-level security entirely, on every table, silently. Any role below with
      <em>bypasses rls</em> = true is a role for which none of these policies exist.
      Run <code>node --experimental-strip-types scripts/verify-rls.ts</code> to test the isolation
      end-to-end as the application role.
    </div>

    <h2 class="sec">Roles</h2>
    ${table([{ name: 'role' }, { name: 'can login' }, { name: 'bypasses rls' }, { name: 'superuser' }], roles)}

    <h2 class="sec">Protected tables</h2>
    ${table([{ name: 'table' }, { name: 'rls enabled' }, { name: 'forced' }, { name: 'policies' }], tables)}

    <h2 class="sec">Policies</h2>
    ${table([{ name: 'table' }, { name: 'policy' }, { name: 'roles' }, { name: 'command' },
             { name: 'using_expr' }], policies)}`);
}

export async function browse(name: string, url: URL): Promise<string> {
  const columns = await adminQuery<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [name],
  );

  if (columns.length === 0) {
    return wrap(`${pageHead(name, 'No such relation.',
      { crumbs: [{ label: 'System', href: '/sources' }, { label: 'Database', href: '/admin' }] })}`);
  }

  if (SECRET_TABLES.has(name)) {
    const counted = await adminQuery<{ n: string }>(`SELECT count(*)::text AS n FROM "${name}"`);
    const n = counted[0]?.n ?? '0';
    return wrap(`
      ${pageHead(name, `${Number(n).toLocaleString('en-US')} rows`,
        { crumbs: [{ label: 'System', href: '/sources' }, { label: 'Database', href: '/admin' }] })}
      <div class="notice"><strong>Contents withheld.</strong> This table holds workspace-wide Slack bot
      tokens. Rendering them into a web page — even a local one — is how a credential ends up in a
      screenshot. Row count only.</div>
      ${table([{ name: 'column' }, { name: 'type' }],
        columns.map((c) => ({ column: c.column_name, type: c.data_type })))}`);
  }

  const visible = columns.filter((c) => !SECRET_COLUMNS.test(c.column_name));
  const redacted = columns.length - visible.length;

  // Only ever interpolate names that came back from the catalogue itself.
  const colNames = new Set(columns.map((c) => c.column_name));
  const requestedSort = url.searchParams.get('sort') ?? '';
  const sortCol = colNames.has(requestedSort) ? requestedSort : defaultSort(columns.map((c) => c.column_name));
  const dir = url.searchParams.get('dir') === 'asc' ? 'ASC' : 'DESC';
  const q = url.searchParams.get('q')?.trim() ?? '';
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));

  const textCols = visible
    .filter((c) => /char|text|uuid/.test(c.data_type))
    .map((c) => `"${c.column_name}"::text`);
  const where = q && textCols.length > 0
    ? `WHERE ${textCols.map((c) => `${c} ILIKE $1`).join(' OR ')}`
    : '';
  const params = where ? [`%${q}%`] : [];

  const select = visible.map((c) => renderColumn(c.column_name, c.data_type)).join(', ');
  const orderBy = sortCol ? `ORDER BY "${sortCol}" ${dir} NULLS LAST` : '';

  const rows = await adminQuery(
    `SELECT ${select} FROM "${name}" ${where} ${orderBy} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params,
  );
  const counted = await adminQuery<{ n: string }>(
    `SELECT count(*)::text AS n FROM "${name}" ${where}`, params,
  );
  const total = Number(counted[0]?.n ?? 0);

  const sortOptions = columns
    .map((c) => `<option value="${escapeHtml(c.column_name)}"${c.column_name === sortCol ? ' selected' : ''}>
      ${escapeHtml(c.column_name)}</option>`)
    .join('');

  const base = `/admin/t/${encodeURIComponent(name)}`;
  const keep = (o: number) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (sortCol) p.set('sort', sortCol);
    if (dir === 'ASC') p.set('dir', 'asc');
    if (o) p.set('offset', String(o));
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  return wrap(`
    ${pageHead(name,
      `${total.toLocaleString('en-US')} rows${q ? ` matching “${escapeHtml(q)}”` : ''} · ` +
      `showing ${rows.length ? offset + 1 : 0}–${offset + rows.length}` +
      (redacted ? ` · ${redacted} secret column${redacted > 1 ? 's' : ''} hidden` : ''),
      { crumbs: [{ label: 'System', href: '/sources' }, { label: 'Database', href: '/admin' }] })}

    <form method="get" action="${base}" class="row" style="margin-bottom:var(--s-3)">
      <input class="txt" type="search" name="q" value="${escapeHtml(q)}"
        placeholder="search text columns…">
      <label for="t-sort">Sort</label>
      <select id="t-sort" name="sort">${sortOptions}</select>
      <select name="dir">
        <option value="desc"${dir === 'DESC' ? ' selected' : ''}>newest first</option>
        <option value="asc"${dir === 'ASC' ? ' selected' : ''}>oldest first</option>
      </select>
      <button class="btn primary" type="submit">Apply</button>
      ${q || dir === 'ASC' ? `<a class="btn" href="${base}">Reset</a>` : ''}
    </form>

    ${table(visible.map((c) => ({ name: c.column_name, type: c.data_type })), rows)}

    <div class="pager">
      ${offset > 0 ? `<a href="${keep(Math.max(0, offset - PAGE_SIZE))}">← previous</a>` : '<span class="muted">← previous</span>'}
      <span class="muted">page ${Math.floor(offset / PAGE_SIZE) + 1} of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
      ${offset + PAGE_SIZE < total ? `<a href="${keep(offset + PAGE_SIZE)}">next →</a>` : '<span class="muted">next →</span>'}
    </div>`);
}

/** Newest-first wherever the table carries a time column; otherwise leave unsorted. */
function defaultSort(columns: string[]): string {
  for (const candidate of ['collected_at', 'fetched_at', 'captured_at', 'created_at',
    'observed_at', 'delivered_at', 'seen_at', 'due_at', 'updated_at', 'first_seen_at', 'id', 'name']) {
    if (columns.includes(candidate)) return candidate;
  }
  return columns[0] ?? '';
}

/**
 * Types the driver returns awkwardly are cast in SQL rather than patched in JS:
 * enums and timestamps come back as text, tsvector is never selected (it is a
 * derived index column and dumping it helps nobody).
 */
function renderColumn(name: string, type: string): string {
  if (type === 'tsvector') return `left("${name}"::text, 60) AS "${name}"`;
  if (type === 'USER-DEFINED' || type === 'ARRAY' || /timestamp|date|time/.test(type)) {
    return `"${name}"::text AS "${name}"`;
  }
  if (type === 'bigint' || type === 'numeric') return `"${name}"::text AS "${name}"`;
  return `"${name}"`;
}


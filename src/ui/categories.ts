// Reviewing news by category.
//
// The archive can be entered four ways and each lived on its own page with its
// own shape: technologies by category, companies by what kind of company,
// platforms by earning channel, domains by field. Every one of them answers "what
// KIND of thing is this news about", and having them scattered meant that
// question had no single answer.
//
// So this is one page, four sections, every row a count of STORIES rather than a
// count of registry entries -- because "43 databases" and "43 stories about
// databases" are different facts and only the second one is news. Every row links
// into the reader with the filter already applied, so the count and the list can
// never disagree.

import { q } from './db.ts';
import {
  escapeHtml, wrap, pageHead, panel, icon, subnav, kpi,
} from './html.ts';
import { CATEGORIES, category as categoryOf } from './stacks.ts';
import { CHANNELS } from '../../seeds/platforms.ts';
import { FIELDS } from './fields.ts';
import { ABOUT } from './filters.ts';
import { crumbsFor } from './nav.ts';

const WINDOWS: { value: string; label: string; days: number }[] = [
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
  { value: '', label: 'All time', days: 0 },
];

interface Bucket {
  key: string;
  label: string;
  n: number;
  href: string;
  note?: string;
}

/**
 * One window clause, shared by every count on the page.
 *
 * Bucketed on publication where it is known, like everything else that measures
 * time here -- 18,000 backfilled stories all arrived on the same afternoon and
 * would otherwise make every window identical.
 */
function windowClause(days: number): string {
  return days > 0
    ? `AND coalesce(s.published_at, s.collected_at) > now() - interval '${days} days'`
    : '';
}

export async function renderCategories(url: URL): Promise<string> {
  const raw = url.searchParams.get('days');
  const win = WINDOWS.find((w) => w.value === (raw ?? '30')) ?? WINDOWS[1]!;
  const w = windowClause(win.days);
  const q_ = (extra: string) => (win.days > 0 ? `${extra}&days=${win.days}` : extra);

  const [about, tech, companies, platforms, fields, totals] = await Promise.all([
    // One row per kind, counted the same way the reader filters them.
    q<{ key: string; n: string }>(
      ABOUT.filter((a) => a.sql).map((a) =>
        `SELECT '${a.value}' AS key, count(*)::text AS n FROM stories s
          WHERE s.superseded_by IS NULL AND ${a.sql} ${w}`).join(' UNION ALL ')),

    q<{ key: string; n: string }>(
      `SELECT k.category AS key, count(DISTINCT s.id)::text AS n
         FROM stories s JOIN stacks k ON k.slug = ANY(s.stacks)
        WHERE s.superseded_by IS NULL ${w}
        GROUP BY 1`),

    q<{ key: string; n: string }>(
      `SELECT c.category AS key, count(DISTINCT s.id)::text AS n
         FROM stories s JOIN companies c ON c.slug = ANY(s.companies)
        WHERE s.superseded_by IS NULL ${w}
        GROUP BY 1`),

    q<{ key: string; n: string }>(
      `SELECT p.channel_type_id AS key, count(DISTINCT s.id)::text AS n
         FROM stories s JOIN platforms p ON p.slug = ANY(s.platforms)
        WHERE s.superseded_by IS NULL ${w}
        GROUP BY 1`),

    q<{ key: string; n: string }>(
      `SELECT f.slug AS key, count(s.id)::text AS n
         FROM unnest($1::text[]) AS f(slug)
         LEFT JOIN stories s
           ON s.superseded_by IS NULL
          AND s.stacks && stack_expand(ARRAY[f.slug]::text[])
          ${w}
        GROUP BY 1`,
      [FIELDS.map((f) => f.slug)]),

    q<{ total: string; tagged: string; with_co: string; with_pl: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE array_length(stacks, 1) > 0)::text AS tagged,
              count(*) FILTER (WHERE array_length(companies, 1) > 0)::text AS with_co,
              count(*) FILTER (WHERE array_length(platforms, 1) > 0)::text AS with_pl
         FROM stories s WHERE s.superseded_by IS NULL ${w}`),
  ]);

  const map = (rows: { key: string; n: string }[]) =>
    new Map(rows.map((r) => [r.key, Number(r.n)]));

  const aboutN = map(about);
  const techN = map(tech);
  const coN = map(companies);
  const plN = map(platforms);
  const fieldN = map(fields);
  const t = totals[0];

  const techBuckets: Bucket[] = CATEGORIES
    .map((c) => ({
      key: c.id,
      label: c.label,
      n: techN.get(c.id) ?? 0,
      href: q_(`/all?type=${c.id}`),
      note: c.blurb,
    }))
    .filter((b) => b.n > 0)
    .sort((a, b) => b.n - a.n);

  const companyBuckets: Bucket[] = [...coN]
    .map(([key, n]) => ({
      key,
      label: key.replace(/-/g, ' '),
      n,
      href: q_(`/all?ctype=${encodeURIComponent(key)}`),
    }))
    .sort((a, b) => b.n - a.n);

  const platformBuckets: Bucket[] = CHANNELS
    .map((c) => ({
      key: c.id,
      label: c.label,
      n: plN.get(c.id) ?? 0,
      href: q_(`/all?channel=${c.id}`),
      note: c.blurb,
    }))
    .filter((b) => b.n > 0)
    .sort((a, b) => b.n - a.n);

  const fieldBuckets: Bucket[] = FIELDS
    .map((f) => ({
      key: f.slug,
      label: f.label,
      n: fieldN.get(f.slug) ?? 0,
      href: `/field/${f.slug}`,
    }))
    .filter((b) => b.n > 0)
    .sort((a, b) => b.n - a.n);

  const n = (v: string | undefined) => Number(v ?? 0);

  return wrap(`
    ${pageHead('Browse by category',
      'What kind of thing is the news about — a technology, a company, an earning platform, '
      + 'a whole field. Every number is a count of stories, and every one of them is a link '
      + 'into the reader with that filter applied.',
      { crumbs: crumbsFor('/categories', 'Categories') })}

    ${subnav(WINDOWS.map((x) => ({
      href: x.value ? `/categories?days=${x.value}` : '/categories?days=',
      label: x.label,
      icon: 'clock',
      active: x.value === win.value,
    })))}

    <div class="kpis">
      ${kpi({ label: 'Stories in window', value: n(t?.total) })}
      ${kpi({
        label: 'With a technology', value: n(t?.tagged),
        note: `${Math.round((n(t?.tagged) / Math.max(1, n(t?.total))) * 100)}% tagged`,
      })}
      ${kpi({ label: 'With a company', value: n(t?.with_co) })}
      ${kpi({ label: 'With a platform', value: n(t?.with_pl) })}
    </div>

    <h2 class="sec">${icon('layers', 14)} What the news is about</h2>
    <p class="note">One answer at a time — this is the question the reader answers with its
      <strong>About</strong> control, next to Sort and Window. The sections below narrow within it.</p>
    <div class="lst" style="border:1px solid var(--line);border-radius:var(--r-3);
      background:var(--surface);margin-bottom:var(--s-4)">
      ${ABOUT.filter((a) => a.value).map((a) => `
        <a class="row" href="${q_(`/all?about=${a.value}`)}">
          <span class="t">${escapeHtml(a.label)}</span>
          <span class="n">${(aboutN.get(a.value) ?? 0).toLocaleString('en-US')}</span>
        </a>`).join('')}
    </div>

    <div class="panels">
      ${bucketPanel('Technology', 'By what kind of technology the story is about.',
        techBuckets, 'tag', '/technologies')}
      ${bucketPanel('Company', 'By what kind of company. A vendor and a chipmaker are different news.',
        companyBuckets, 'gem', '/companies')}
      ${bucketPanel('Earning platform', 'By channel — where the work gets paid for.',
        platformBuckets, 'building', '/platforms')}
      ${bucketPanel('Field', 'The taxonomy entered at the top. Everything beneath a root counts toward it.',
        fieldBuckets, 'layers', '/fields')}
    </div>

    ${platformBuckets.length === 0 ? `<p class="notice">${icon('alert', 15)}<span>No story in this
      window mentions an earning platform. The seeded sources are technology outlets and these
      platforms are mostly written about by the business press — which is a gap in the source
      registry, not in the tagging.</span></p>` : ''}
  `);
}

function bucketPanel(
  title: string, blurb: string, buckets: Bucket[], iconName: string, more: string,
): string {
  if (buckets.length === 0) {
    return panel(title, `<p class="note" style="margin:0">Nothing in this window.</p>`,
      { icon: iconName });
  }
  const max = Math.max(1, ...buckets.map((b) => b.n));

  return panel(title, `<div class="lst">${buckets.map((b) => `
      <a class="row" href="${escapeHtml(b.href)}"${b.note ? ` title="${escapeHtml(b.note)}"` : ''}>
        <span class="t" style="text-transform:capitalize">${escapeHtml(b.label)}</span>
        <span class="bar"><i style="width:${Math.round((b.n / max) * 100)}%"></i></span>
        <span class="n">${b.n.toLocaleString('en-US')}</span>
      </a>`).join('')}</div>`,
  { icon: iconName, more: { href: more, label: 'Registry' }, flush: true });
}

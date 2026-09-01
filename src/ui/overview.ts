// The overview.
//
// The front page used to be the river, which meant the product had exactly one
// page and everything else was a filter applied to it. That is fine for reading
// and useless for the question people actually arrive with: what happened, is
// collection healthy, and where should I look first.
//
// So this answers those three in that order, and every number on it is a link to
// the page that explains it. Nothing here is a filter -- it is a table of
// contents with the counts filled in.

import { q, one } from './db.ts';
import {
  escapeHtml, wrap, pageHead, kpi, panel, icon, barChart, sparkline,
  relativeTime, truncate, empty, type Point,
} from './html.ts';
import { FIELDS } from './fields.ts';

interface Head {
  id: string;
  title: string;
  url: string;
  source: string;
  when: string;
  importance: number | null;
  coverage: number;
}

export async function renderOverview(): Promise<string> {
  const [
    totals, daily, critical, latest, fields, movers, sources, announcements, health,
  ] = await Promise.all([
    one<{
      total: string; today: string; hour: string; day: string; week: string;
      prev_week: string; critical: string; since: string | null; latest: string | null;
      companies: string; stacks: string;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE collected_at >= date_trunc('day', now()))::text AS today,
              count(*) FILTER (WHERE collected_at > now() - interval '1 hour')::text AS hour,
              count(*) FILTER (WHERE collected_at > now() - interval '24 hours')::text AS day,
              count(*) FILTER (WHERE coalesce(published_at, collected_at) > now() - interval '7 days')::text AS week,
              count(*) FILTER (WHERE coalesce(published_at, collected_at)
                     BETWEEN now() - interval '14 days' AND now() - interval '7 days')::text AS prev_week,
              count(*) FILTER (WHERE importance >= 8)::text AS critical,
              min(coalesce(published_at, collected_at))::date::text AS since,
              max(collected_at)::text AS latest,
              count(*) FILTER (WHERE array_length(companies, 1) > 0)::text AS companies,
              count(*) FILTER (WHERE array_length(stacks, 1) > 0)::text AS stacks
         FROM stories WHERE superseded_by IS NULL`),

    // Volume by day of publication, not of collection: a backfilled decade of
    // release notes would otherwise all land in "today".
    q<{ day: string; n: string }>(
      `WITH days AS (
         SELECT generate_series(date_trunc('day', now()) - interval '29 days',
                                date_trunc('day', now()), interval '1 day') AS day)
       SELECT to_char(d.day, 'MM-DD') AS day, count(s.id)::text AS n
         FROM days d
         LEFT JOIN stories s ON date_trunc('day', coalesce(s.published_at, s.collected_at)) = d.day
                            AND s.superseded_by IS NULL
        GROUP BY d.day ORDER BY d.day`),

    q<Head>(
      `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title, s.canonical_url AS url,
              src.name AS source, coalesce(s.published_at, s.collected_at)::text AS when,
              s.importance, s.coverage_count AS coverage
         FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND s.importance >= 8
        ORDER BY coalesce(s.published_at, s.collected_at) DESC LIMIT 6`),

    q<Head>(
      `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title, s.canonical_url AS url,
              src.name AS source, coalesce(s.published_at, s.collected_at)::text AS when,
              s.importance, s.coverage_count AS coverage
         FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND src.kind IN ('news','research','status')
          AND NOT s.is_prerelease
        ORDER BY s.collected_at DESC LIMIT 8`),

    q<{ slug: string; n: string }>(
      `SELECT f.slug, count(s.id)::text AS n
         FROM unnest($1::text[]) AS f(slug)
         LEFT JOIN stories s ON s.superseded_by IS NULL
              AND s.stacks && stack_expand(ARRAY[f.slug]::text[])
              AND coalesce(s.published_at, s.collected_at) > now() - interval '30 days'
        GROUP BY f.slug ORDER BY count(s.id) DESC LIMIT 8`,
      [FIELDS.map((f) => f.slug)]),

    // Rising: this week against the week before, for anything with enough
    // volume that the ratio is not noise.
    q<{ slug: string; now: string; before: string }>(
      `SELECT st AS slug,
              count(*) FILTER (WHERE coalesce(s.published_at, s.collected_at) > now() - interval '7 days')::text AS now,
              count(*) FILTER (WHERE coalesce(s.published_at, s.collected_at)
                     BETWEEN now() - interval '14 days' AND now() - interval '7 days')::text AS before
         FROM stories s, LATERAL unnest(s.stacks) AS st
        WHERE s.superseded_by IS NULL
          AND coalesce(s.published_at, s.collected_at) > now() - interval '14 days'
        GROUP BY st HAVING count(*) >= 4 ORDER BY 2 DESC LIMIT 40`),

    q<{ name: string; n: string; latest: string | null }>(
      `SELECT src.name, count(*)::text AS n, max(s.collected_at)::text AS latest
         FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND s.collected_at > now() - interval '7 days'
        GROUP BY src.name ORDER BY count(*) DESC LIMIT 8`),

    q<{ id: string; title: string; url: string; company: string; slug: string; when: string }>(
      `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title, s.canonical_url AS url,
              c.name AS company, c.slug,
              coalesce(s.published_at, s.collected_at)::text AS when
         FROM stories s
         JOIN sources src ON src.id = s.source_id
         JOIN companies c ON c.slug = src.company_slug
        WHERE s.superseded_by IS NULL
        ORDER BY coalesce(s.published_at, s.collected_at) DESC LIMIT 8`),

    one<{ healthy: string; failing: string; paused: string; due: string }>(
      `SELECT count(*) FILTER (WHERE health = 'healthy')::text AS healthy,
              count(*) FILTER (WHERE health IN ('degraded','failing','dead'))::text AS failing,
              count(*) FILTER (WHERE health = 'paused')::text AS paused,
              count(*) FILTER (WHERE next_fetch_at <= now() AND health <> 'paused')::text AS due
         FROM sources`),
  ]);

  const n = (v: string | null | undefined) => Number(v ?? 0);
  const week = n(totals?.week);
  const prev = n(totals?.prev_week);
  const delta = prev > 0 ? Math.round(((week - prev) / prev) * 100) : null;

  const points: Point[] = daily.map((d) => ({
    label: d.day, value: Number(d.n), title: `${d.day}: ${d.n} stories`,
  }));
  const dailyValues = points.map((p) => p.value);

  const rising = movers
    .map((m) => ({ slug: m.slug, now: Number(m.now), before: Number(m.before) }))
    .filter((m) => m.now >= 3)
    .map((m) => ({ ...m, lift: (m.now + 1) / (m.before + 1) }))
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 8);

  const fieldMax = Math.max(1, ...fields.map((f) => Number(f.n)));
  const fieldLabel = new Map(FIELDS.map((f) => [f.slug, f.label]));

  return wrap(`
    ${pageHead('Overview',
      `${n(totals?.total).toLocaleString('en-US')} stories in the archive` +
      (totals?.since ? `, back to ${escapeHtml(totals.since)}` : '') +
      (totals?.latest ? ` · last collected ${escapeHtml(relativeTime(totals.latest))}` : ''),
      {
        actions: `<a class="btn primary" href="/news">Open the reader</a>
                  <a class="btn" href="/news?min=8" title="stories scored 8 or above — act on it">Critical</a>`,
      })}

    <div class="kpis">
      ${kpi({
        label: 'Collected today', value: n(totals?.today), href: '/news?days=1',
        note: `${n(totals?.hour).toLocaleString('en-US')} in the last hour`,
        help: 'Stories stored since midnight UTC. Collection polls every 30 seconds, '
          + 'but each source is asked only as often as its own measured publishing rate, '
          + 'so a quiet hour is normal rather than a fault.',
      })}
      ${kpi({
        label: 'Published this week', value: week,
        help: 'Counted on the date the publisher gave, not the date we collected it, '
          + 'so a backfilled archive lands in the week it happened instead of today.',
        note: delta === null ? 'no prior week to compare'
          : `<b class="${delta < 0 ? 'down' : ''}">${delta > 0 ? '+' : ''}${delta}%</b> on the week before`,
        spark: sparkline(dailyValues, { width: 220, height: 26 }),
      })}
      ${kpi({
        label: 'Critical open', value: n(totals?.critical), href: '/news?min=8',
        alert: n(totals?.critical) > 0, note: 'scored 8 or above · act on it',
        help: 'Stories a model scored 8 or higher out of 10 for whether they change '
          + 'what you would build on. Most days this is zero, and zero is the normal state.',
      })}
      ${kpi({
        label: 'Sources healthy', value: n(health?.healthy), href: '/sources',
        help: 'Sources whose last poll succeeded. A source that fails is paused with a '
          + 'recorded reason and kept, never dropped quietly.',
        note: n(health?.failing) > 0
          ? `<b class="down">${n(health?.failing)} failing</b>`
          : 'nothing failing',
      })}
      ${kpi({
        label: 'Tagged with a company', value: n(totals?.companies), href: '/companies',
        note: 'of the whole archive',
        help: 'Stories matched to a company by name from a closed vocabulary. Never '
          + 'guessed by a model, so a company that is not in the list stays untagged.',
      })}
    </div>

    <h2 class="sec">${icon('pulse', 14)} Volume by day published</h2>
    <p class="note">Bucketed on publication date rather than collection date, so backfilled
      history lands where it happened instead of piling up under today.</p>
    ${barChart(points, { height: 120, labelEvery: 5 })}

    <div class="panels">
      ${panel('Critical right now', critical.length === 0
        ? '<p class="note" style="margin:0">Nothing scored 8 or above. That is the normal state.</p>'
        : `<div class="lst">${critical.map(headRow).join('')}</div>`,
        { icon: 'alert', more: { href: '/news?min=8', label: 'All critical' }, flush: critical.length > 0 })}

      ${panel('Latest news', latest.length === 0 ? empty('Nothing collected yet.')
        : `<div class="lst">${latest.map(headRow).join('')}</div>`,
        { icon: 'stream', more: { href: '/news', label: 'Open the reader' }, flush: true })}

      ${panel('Fields, last 30 days',
        `<div class="lst">${fields.map((f) => `
          <a class="row" href="/field/${encodeURIComponent(f.slug)}">
            <span class="t">${escapeHtml(fieldLabel.get(f.slug) ?? f.slug)}</span>
            <span class="bar"><i style="width:${Math.round((Number(f.n) / fieldMax) * 100)}%"></i></span>
            <span class="n">${Number(f.n).toLocaleString('en-US')}</span>
          </a>`).join('')}</div>`,
        { icon: 'layers', more: { href: '/fields', label: 'All fields' }, flush: true })}

      ${panel('Gaining ground', rising.length === 0
        ? '<p class="note" style="margin:0">Not enough volume this week to call anything a trend.</p>'
        : `<div class="lst">${rising.map((m) => `
          <a class="row" href="/trend/${encodeURIComponent(m.slug)}">
            <span class="t">${escapeHtml(m.slug)}</span>
            <span class="n">${m.before} → ${m.now}</span>
          </a>`).join('')}</div>`,
        { icon: 'trending', more: { href: '/trends', label: 'Trends' }, flush: rising.length > 0 })}

      ${panel('Company announcements', announcements.length === 0
        ? '<p class="note" style="margin:0">No first-party channels have published recently.</p>'
        : `<div class="lst">${announcements.map((a) => `
          <a class="row" href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">
            <span class="t">${escapeHtml(truncate(a.title, 58))}</span>
            <span class="n">${escapeHtml(a.company)}</span>
          </a>`).join('')}</div>`,
        { icon: 'gem', more: { href: '/companies', label: 'All companies' }, flush: announcements.length > 0 })}

      ${panel('Busiest sources, last 7 days',
        `<div class="lst">${sources.map((s) => `
          <a class="row" href="/all?source=${encodeURIComponent(s.name)}">
            <span class="t">${escapeHtml(truncate(s.name, 34))}</span>
            <span class="n">${Number(s.n).toLocaleString('en-US')}</span>
          </a>`).join('')}</div>`,
        { icon: 'feed', more: { href: '/sources', label: 'Source health' }, flush: true })}
    </div>

    <h2 class="sec">${icon('sliders', 14)} Collection</h2>
    <div class="kpis">
      ${kpi({ label: 'Due now', value: n(health?.due), note: 'sources past their next poll',
        help: 'Sources whose own interval says they should have been polled by now. A '
          + 'few is normal between ticks; a growing number means collection is behind.' })}
      ${kpi({ label: 'Paused', value: n(health?.paused), href: '/sources?health=paused',
        help: 'Sources not being polled, each with a recorded reason. Paused is kept, '
          + 'never deleted, so why it stopped is still answerable later.' })}
      ${kpi({ label: 'Failing', value: n(health?.failing), href: '/admin/health',
        alert: n(health?.failing) > 0,
        help: 'Sources whose recent polls have been erroring. They keep being retried '
          + 'with a widening backoff until they are paused with a reason.' })}
      ${kpi({ label: 'Tagged with a technology', value: n(totals?.stacks), href: '/technologies',
        help: 'Stories matched to at least one stack or tool from a closed vocabulary. '
          + 'An untagged story cannot appear on News, whatever it says.' })}
    </div>
  `);
}

function headRow(h: Head): string {
  return `<a class="row" href="${escapeHtml(h.url)}" target="_blank" rel="noreferrer"
    title="${escapeHtml(h.title)}">
    <span class="t">${escapeHtml(truncate(h.title, 62))}</span>
    <span class="n">${escapeHtml(relativeTime(h.when))}</span>
  </a>`;
}

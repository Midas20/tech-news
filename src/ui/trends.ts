// Trends: what is happening to a technology over time.
//
// This page used to count rows in `stories` for everything, which worked
// precisely as long as `stories` held the whole archive. It no longer does:
// 0033 keeps a month of whole stories and reduces everything older to monthly
// aggregate, so a query that counts rows now answers "this month" while looking
// exactly like it answers "ever".
//
// So the seam runs through every number here, and it is the same seam
// everywhere -- the `stack_history` and `archive_history` views from 0035, which
// stitch live months and rolled months together without double counting the
// overlap. What that buys is the thing this page was always for: a series that
// runs back to 2013 on a database holding one month of news.
//
// ONE resolution: monthly, over the whole archive. This is what survives, so
// this is what the series is drawn at.
//
// There used to be a second chart underneath it -- the live window at week
// resolution, eight buckets, with a caption explaining that week resolution
// exists only while the stories do. It was a strict subset of the chart above
// it at a finer grain, so the only thing it added to the page was an
// explanation of how retention works, which is not something a reader came here
// to learn. The stories in that window are listed under "Recent" further down,
// which is the useful form of the same fact.

import { q, one } from './db.ts';
import { getConfig } from '../config.ts';
import { referencePanel, docsPanel, type ReferenceRow, type ResourceRow } from './reference.ts';
import { escapeHtml, table, barChart, sparkline, truncate, wrap, pageHead, icon,
  stat, relativeTime, empty, type Point } from './html.ts';

/** Months of history drawn on a stack page. Ten years, if it is there. */
const MONTHS = 120;

/**
 * The whole-archive monthly series for one technology, or for everything.
 *
 * Bucketed on EVENT time -- when the thing was published -- not on when this
 * system happened to collect it. Backfilled history is collected today and
 * published years ago; on collection time every backfilled release would land
 * in the current month and the trend would be a fiction.
 *
 * Empty months are preserved as zeros. A gap that renders as a missing bar and
 * a gap that renders as no bar at all look identical on a chart and mean
 * opposite things.
 *
 * The hierarchy is expanded by JOINING the descendant set rather than by
 * `slug = ANY(stack_expand(...))`. They return the same rows; the second form
 * takes 18 seconds against this view and the first takes 240ms, because ANY()
 * over a function result gives the planner nothing to hash and it re-derives
 * the union per row. Every query on this page uses the join form for that
 * reason.
 */
async function monthly(stack: string | null, months = MONTHS): Promise<Point[]> {
  const rows = await q<{ month: string; n: string }>(
    // The axis starts where the TECHNOLOGY starts, not ten years ago.
    //
    // The bounds used to be a flat `now() - 120 months`, which is right for the
    // archive as a whole and wrong for one entry in it: a technology first seen
    // in June draws five bars crammed against the right edge of a decade of
    // blank baseline. The empty stretch is not information -- the archive was
    // not watching and the technology did not exist -- and it costs the five
    // real bars almost all of their width.
    //
    // Still bounded at 120 months, so a long-running technology cannot draw an
    // axis longer than the archive can honestly claim.
    `WITH fam AS (SELECT slug FROM stack_descendants(${stack === null ? `''` : `$2`})),
     series AS (
       ${stack === null
         ? `SELECT month, sum(stories)::int AS n FROM archive_history GROUP BY 1`
         : `SELECT h.month, sum(h.stories)::int AS n
              FROM stack_history h JOIN fam f ON f.slug = h.slug
             GROUP BY 1`}
     ),
     bounds AS (
       SELECT generate_series(
         greatest(
           coalesce((SELECT min(month) FROM series WHERE n > 0),
                    date_trunc('month', now())::date),
           (date_trunc('month', now()) - make_interval(months => $1::int - 1))::date
         ),
         date_trunc('month', now())::date,
         interval '1 month')::date AS month
     )
     SELECT to_char(b.month, 'YYYY-MM') AS month,
            coalesce(s.n, 0)::text AS n
       FROM bounds b LEFT JOIN series s ON s.month = b.month
      ORDER BY b.month`,
    stack === null ? [months] : [months, stack]);

  return rows.map((r) => ({
    label: r.month.slice(2), value: Number(r.n),
    title: `${r.month}: ${r.n} stories`,
  }));
}


/**
 * How far back the analysis reaches, how much of it is aggregate, and -- kept
 * strictly apart from both -- how long this archive has actually been running.
 *
 * THE HEADLINE USED TO READ "1,635 stories analysed across 144 months, 2010-10
 * to 2026-09", and on 2026-09-09 a reader did the only arithmetic that sentence
 * invites: 1,635 stories in twelve years. Which would indeed be nothing.
 *
 * The sentence was wrong in the way that is hardest to catch, because every
 * number in it was correct. `archive_history` buckets stories by the month they
 * were PUBLISHED, and feeds do not serve only this week -- Vercel's carries
 * 1,563 entries going back years, Shopify's 428. Collecting those on a Tuesday
 * puts one story in 2010-10 and two in 2011-06, and the min-to-max span of the
 * result reads as the age of the archive. It is not. It is the age of the
 * oldest thing somebody left in a feed.
 *
 * So the two facts are now separated and both are shown. Collecting since is a
 * fact about us and the honest measure of how much this archive can yet be
 * expected to hold; the published span is a fact about the feeds.
 */
async function span(): Promise<{ first: string | null; last: string | null;
  months: number; archived: number; stories: number;
  collectingSince: string | null; collectedDays: number }> {
  const r = await one<{ first: string; last: string; months: string;
    archived: string; stories: string }>(
    `SELECT to_char(min(month), 'YYYY-MM') AS first,
            to_char(max(month), 'YYYY-MM') AS last,
            count(*)::text AS months,
            count(*) FILTER (WHERE archived)::text AS archived,
            sum(stories)::text AS stories
       FROM archive_history`);
  // Not from `stories`, whose oldest row is only the oldest SURVIVING row --
  // retention deletes, and after the first deletion that column would report
  // the archive getting younger. fetch_log is never pruned by the retention
  // contract, so the first fetch is the first fetch.
  const c = await one<{ since: string; days: string }>(
    `SELECT to_char(min(fetched_at), 'YYYY-MM-DD') AS since,
            greatest(1, (now()::date - min(fetched_at)::date))::text AS days
       FROM fetch_log`);
  return {
    first: r?.first ?? null, last: r?.last ?? null,
    months: Number(r?.months ?? 0), archived: Number(r?.archived ?? 0),
    stories: Number(r?.stories ?? 0),
    collectingSince: c?.since ?? null, collectedDays: Number(c?.days ?? 0),
  };
}


// --- what the Analyse section is actually for --------------------------------
//
// Not "which technology has the most stories". That question is answered by
// whichever feed is loudest: measured on this archive, ranking by raw count put
// `atproto` at the top with 719 items from TWO sources -- one project's own
// release feed, publishing into a vacuum. It tells you nothing about adoption.
//
// The question is which technologies are being picked UP, and the signal for
// that is BREADTH: how many distinct outlets carry it, and whether that number
// is climbing. One project shouting is one source. Twenty outlets independently
// finding a thing worth writing about is a market moving.

export interface Rising {
  slug: string; name: string; kind: string; category: string;
  recent: string; prior: string; outlets: string; outlets_before: string;
}

/**
 * Technologies reaching more outlets than they used to.
 *
 * Gated at three distinct sources, which is the line between "a project
 * announced something" and "the industry noticed". Ordered by the CHANGE in
 * breadth rather than its level, so an established name holding steady does not
 * crowd out something arriving.
 */
async function rising(limit = 20): Promise<Rising[]> {
  return q<Rising>(
    `WITH recent AS (
       SELECT h.slug, sum(h.stories) AS st, max(h.distinct_sources) AS src
         FROM stack_history h
        WHERE h.month >= date_trunc('month', now()) - interval '2 months'
        GROUP BY 1),
     prior AS (
       SELECT h.slug, sum(h.stories) AS st, max(h.distinct_sources) AS src
         FROM stack_history h
        WHERE h.month >= date_trunc('month', now()) - interval '8 months'
          AND h.month <  date_trunc('month', now()) - interval '2 months'
        GROUP BY 1)
     SELECT r.slug, k.name, k.kind::text, k.category,
            r.st::text AS recent, coalesce(p.st, 0)::text AS prior,
            r.src::text AS outlets, coalesce(p.src, 0)::text AS outlets_before
       FROM recent r
       JOIN stacks k ON k.slug = r.slug
       LEFT JOIN prior p ON p.slug = r.slug
      WHERE k.kind IN ('stack', 'tool')
        AND r.src >= 3
        AND r.st >= 5
        AND r.src > coalesce(p.src, 0)
      ORDER BY (r.src - coalesce(p.src, 0)) DESC, r.st DESC
      LIMIT ${limit}`).catch(() => []);
}

export interface BestTool {
  category: string; slug: string; name: string; outlets: string; stories: string;
  version: string | null; last_seen: string | null;
}

/**
 * The tool to reach for in each category, and which version is current.
 *
 * "Best" is not a judgement this system can make and it does not pretend to.
 * What it can say is which tool in a category the most independent outlets are
 * writing about, which is the closest honest proxy, and what version it is on
 * right now -- read from the release feeds rather than from anybody's opinion.
 */
async function bestTools(): Promise<BestTool[]> {
  return q<BestTool>(
    `WITH latest AS (
       SELECT DISTINCT ON (x) x AS slug,
              substring(coalesce(s.title_en, s.title_original)
                        from '[vV]?[0-9]+\.[0-9]+(?:\.[0-9]+)?') AS version,
              to_char(coalesce(s.published_at, s.collected_at), 'YYYY-MM-DD') AS seen
         FROM stories s
         JOIN sources src ON src.id = s.source_id,
              LATERAL unnest(s.stacks) AS x
        WHERE src.kind = 'releases'
          AND NOT s.is_prerelease
          AND s.superseded_by IS NULL
        ORDER BY x, coalesce(s.published_at, s.collected_at) DESC)
     SELECT DISTINCT ON (k.category)
            k.category, k.slug, k.name,
            t.peak_sources::text AS outlets, t.stories::text AS stories,
            l.version, l.seen AS last_seen
       FROM stacks k
       JOIN stack_totals t ON t.slug = k.slug
       LEFT JOIN latest l ON l.slug = k.slug
      WHERE k.kind = 'tool' AND t.stories > 0
      ORDER BY k.category, t.peak_sources DESC, t.stories DESC`).catch(() => []);
}

export interface EarningPlatform {
  slug: string; name: string; channel: string; url: string | null;
  status: string; recent: string; outlets: string;
}

/** The platform registry, with whatever momentum the archive can see. */
async function earningPlatforms(): Promise<EarningPlatform[]> {
  return q<EarningPlatform>(
    `WITH recent AS (
       SELECT slug, sum(stories) AS st, max(distinct_sources) AS src
         FROM platform_month
        WHERE month >= date_trunc('month', now()) - interval '5 months'
        GROUP BY 1)
     SELECT p.slug, p.name, p.channel_type_id AS channel, p.url, p.status,
            coalesce(r.st, 0)::text AS recent, coalesce(r.src, 0)::text AS outlets
       FROM platforms p
       LEFT JOIN recent r ON r.slug = p.slug
      WHERE p.status = 'active'
      ORDER BY coalesce(r.src, 0) DESC, coalesce(r.st, 0) DESC, p.name`).catch(() => []);
}

export async function renderTrends(): Promise<string> {
  // The retention window is a setting; the sentence that states it reads it.
  const keepMonths = getConfig().retention.keepMonths;
  const [reach, rows, series, overall, up, tools, platforms] = await Promise.all([
    span(),
    // Every column here comes from a materialised table or a single grouped
    // pass. The obvious shape -- a LATERAL per row -- costs a scan of the live
    // month per technology, and forty of those is a page that takes seven
    // seconds to say the same thing.
    q<{ slug: string; name: string; category: string; kind: string;
        total: string; recent: string; live: string; last: string | null }>(
      `WITH live AS (
         SELECT x AS slug, count(*)::int AS n
           FROM stories s, LATERAL unnest(s.stacks) AS x
          WHERE s.superseded_by IS NULL
            AND coalesce(s.published_at, s.collected_at) > now() - interval '7 days'
          GROUP BY 1
       )
       SELECT st.slug, st.name, st.category, st.kind,
              t.stories::text AS total,
              f.recent::text AS recent,
              coalesce(l.n, 0)::text AS live,
              to_char(t.last_month, 'YYYY-MM') AS last
         FROM stacks st
         JOIN stack_totals t ON t.slug = st.slug
         LEFT JOIN stack_frequency f ON f.slug = st.slug
         LEFT JOIN live l ON l.slug = st.slug
        WHERE t.stories > 0
        ORDER BY t.stories DESC
        LIMIT 40`),
    // One query for every sparkline rather than 40 round trips.
    q<{ slug: string; month: string; n: string }>(
      `SELECT slug, to_char(month, 'YYYY-MM') AS month, sum(stories)::text AS n
         FROM stack_history
        WHERE month >= date_trunc('month', now() - interval '24 months')
        GROUP BY 1, month ORDER BY 1, month`),
    monthly(null),
    rising(),
    bestTools(),
    earningPlatforms(),
  ]);

  const bySlug = new Map<string, number[]>();
  for (const r of series) {
    const list = bySlug.get(r.slug) ?? [];
    list.push(Number(r.n));
    bySlug.set(r.slug, list);
  }

  const body = rows.map((r) => `<tr>
      <td><a href="/trend/${encodeURIComponent(r.slug)}">${escapeHtml(r.name)}</a>
        <span class="muted">${escapeHtml(r.category)}</span></td>
      <td class="num">${Number(r.total).toLocaleString('en-US')}</td>
      <td class="num">${Number(r.recent).toLocaleString('en-US')}</td>
      <td class="num">${Number(r.live).toLocaleString('en-US')}</td>
      <td>${sparkline(bySlug.get(r.slug) ?? [])}</td>
      <td class="mono">${escapeHtml(r.last ?? '')}</td>
    </tr>`).join('');

  return wrap(`
    ${pageHead('Technology trends',
      `${reach.stories.toLocaleString('en-US')} stories analysed`
      + (reach.collectingSince
        ? `, collected over ${reach.collectedDays === 1 ? 'one day'
          : `${reach.collectedDays} days`} since ${escapeHtml(reach.collectingSince)}`
        : ''))}

    <p class="note"><b>Two different spans, and only one of them is about this
      archive.</b> It has been collecting since
      ${escapeHtml(reach.collectingSince ?? 'its first fetch')}; that is how much
      time it has had. The stories in it carry publication dates spread across
      ${reach.months} months${reach.first ? `, ${escapeHtml(reach.first)} to
        ${escapeHtml(reach.last ?? '')}` : ''}, because a feed serves its back
      catalogue as well as its latest post &mdash; one story dated 2010 means one
      feed still lists a post from 2010, not that anything was watching then.</p>

    <p class="note">${reach.archived} of these months are held as monthly analysis rather
      than as whole stories — per technology: how many stories, how many distinct outlets,
      what kind of source, peak importance, what it appeared alongside, and three exemplar
      headlines. The stories themselves are held for ${keepMonths === 1 ? 'a month'
        : `${keepMonths} months`}; the analysis is kept for good.</p>

    <h2 class="sec">Gaining ground</h2>
    <p class="note">Ranked by the change in how many DISTINCT outlets carry a
      technology, not by how many stories it has. Raw counts answer "which feed
      is loudest" — ranked that way this archive puts <code>atproto</code> first
      on 719 items from two sources, which is one project publishing into a
      vacuum. Three outlets minimum; a rising number here means the industry is
      picking something up.</p>
    ${up.length === 0 ? '<p class="muted">Not enough months of history yet — this needs two quarters to say anything.</p>'
      : `<div class="scroll"><table>
      <thead><tr><th>technology</th><th>kind</th><th>outlets now</th><th>before</th>
        <th>stories 3m</th><th>trend</th></tr></thead>
      <tbody>${up.map((r) => `<tr>
        <td><a href="/trend/${encodeURIComponent(r.slug)}">${escapeHtml(r.name)}</a>
          <span class="muted">${escapeHtml(r.category)}</span></td>
        <td class="muted">${escapeHtml(r.kind)}</td>
        <td class="num"><b>${escapeHtml(r.outlets)}</b></td>
        <td class="num muted">${escapeHtml(r.outlets_before)}</td>
        <td class="num">${Number(r.recent).toLocaleString('en-US')}</td>
        <td>${sparkline(bySlug.get(r.slug) ?? [])}</td>
      </tr>`).join('')}</tbody></table></div>`}

    <h2 class="sec">The tool to reach for, by category</h2>
    <p class="note">"Best" is not a judgement this system can make and it does
      not pretend to. This is the tool in each category that the most
      independent outlets write about, with the version it is on right now —
      read from release feeds rather than from anybody's opinion.</p>
    ${tools.length === 0 ? '<p class="muted">No tools tagged yet.</p>'
      : `<div class="scroll"><table>
      <thead><tr><th>category</th><th>tool</th><th>current version</th>
        <th>released</th><th>outlets</th><th>stories</th></tr></thead>
      <tbody>${tools.map((t) => `<tr>
        <td class="muted">${escapeHtml(t.category)}</td>
        <td><a href="/trend/${encodeURIComponent(t.slug)}">${escapeHtml(t.name)}</a></td>
        <td class="mono">${t.version ? escapeHtml(t.version) : '<span class="muted">—</span>'}</td>
        <td class="mono muted">${escapeHtml(t.last_seen ?? '')}</td>
        <td class="num">${escapeHtml(t.outlets)}</td>
        <td class="num">${Number(t.stories).toLocaleString('en-US')}</td>
      </tr>`).join('')}</tbody></table></div>`}

    <h2 class="sec">Where the money is</h2>
    <p class="note"><b>This section is incomplete and says so rather than
      guessing.</b> The platform registry carries a real address and a channel
      for each entry, and <code>time_to_first_dollar</code> is a column that is
      NULL on all ${platforms.length} of them — no source feeds it, and
      <code>platform_facts</code> is empty. Rates, payout terms and market size
      are not collected by anything in this system today. What is shown is the
      registry plus the only earning signal the archive genuinely has: how many
      outlets are writing about each platform.</p>
    ${platforms.length === 0 ? '<p class="muted">No platforms registered.</p>'
      : `<div class="scroll"><table>
      <thead><tr><th>platform</th><th>channel</th><th>outlets</th>
        <th>stories 6m</th><th>address</th></tr></thead>
      <tbody>${platforms.slice(0, 40).map((pl) => `<tr>
        <td><a href="/platform/${encodeURIComponent(pl.slug)}">${escapeHtml(pl.name)}</a></td>
        <td class="muted">${escapeHtml(pl.channel)}</td>
        <td class="num">${escapeHtml(pl.outlets)}</td>
        <td class="num">${escapeHtml(pl.recent)}</td>
        <td>${pl.url ? `<a href="${escapeHtml(pl.url)}" target="_blank" rel="noreferrer">${
          escapeHtml(pl.url.replace(/^https?:\/\//, '').slice(0, 40))}</a>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>`}

    <h2 class="sec">Volume, for context only</h2>
    <p class="note">How much was collected each month. This is a fact about the
      collector, not about the market — it is here so the numbers above can be
      read against it.</p>
    ${barChart(overall, { height: 110, labelEvery: 6 })}

    <h2 class="sec">By total coverage</h2>
    ${rows.length === 0 ? '<p class="muted">Nothing tagged yet.</p>' : `<div class="scroll"><table>
      <thead><tr><th>technology</th><th>all time</th><th>90 days</th><th>last 7d</th>
        <th>24-month trend</th><th>latest</th></tr></thead>
      <tbody>${body}</tbody></table></div>`}
  `);
}

export async function renderTrend(slug: string): Promise<string> {
  const stack = await one<{
    slug: string; name: string; category: string; kind: string; description: string | null;
    docs_url: string | null; repo_url: string | null; release_feed_url: string | null;
    status: string; curated: boolean; parent: string | null;
  }>(
    `SELECT st.slug, st.name, st.category, st.kind, st.description, st.docs_url, st.repo_url,
            st.release_feed_url, st.current_status AS status, st.curated,
            p.slug AS parent
       FROM stacks st LEFT JOIN stacks p ON p.id = st.parent_id
      WHERE st.slug = $1`,
    [slug]);

  if (!stack) return wrap(pageHead('Unknown technology', 'Not in the taxonomy.'));

  const [children, totals, kinds, sources, recent, related, exemplars, peak, adoption, ref,
         resources]
    = await Promise.all([
    q<{ slug: string; name: string }>(
      `SELECT slug, name FROM stacks WHERE parent_id = (SELECT id FROM stacks WHERE slug = $1) ORDER BY name`,
      [slug]),
    // The whole archive, from both halves.
    one<{ total: string; months: string; sources: string; peak: string | null;
          since: string | null; until: string | null }>(
      `SELECT stories::text AS total, months_seen::text AS months,
              peak_sources::text AS sources, max_importance::text AS peak,
              to_char(first_month, 'YYYY-MM') AS since,
              to_char(last_month, 'YYYY-MM') AS until
         FROM stack_totals WHERE slug = $1`, [slug]),
    // What KIND of attention, over the whole archive. A technology whose every
    // month is release notes is in a different phase from one the press writes
    // about, and that distinction survives the stories being gone.
    one<{ releases: string; news: string; community: string; research: string }>(
      `SELECT coalesce(sum(from_releases), 0)::text AS releases,
              coalesce(sum(from_news), 0)::text AS news,
              coalesce(sum(from_community), 0)::text AS community,
              coalesce(sum(from_research), 0)::text AS research
         FROM stack_month k JOIN stack_descendants($1) d ON d.slug = k.slug`, [slug]),
    // Who covers it: live only. `source_month` records volume per source but not
    // per technology, so this genuinely cannot reach back, and says so.
    q(`SELECT src.name AS source, count(*)::int AS stories, src.lang::text AS lang
         FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND s.stacks && stack_expand(ARRAY[$1]::text[])
        GROUP BY src.name, src.lang ORDER BY 2 DESC LIMIT 12`, [slug]),
    q<{ id: string; title: string; url: string; source: string; collected: string;
        importance: number | null; coverage: number }>(
      `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title, s.canonical_url AS url,
              src.name AS source, s.collected_at::text AS collected, s.importance,
              s.coverage_count AS coverage
         FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND s.stacks && stack_expand(ARRAY[$1]::text[])
        ORDER BY coalesce(s.published_at, s.collected_at) DESC LIMIT 25`, [slug]),
    // What it rises alongside, over the whole archive. Pairs are stored one way
    // round (a < b) to halve the table, so both directions are asked for here.
    q<{ slug: string; n: string }>(
      `SELECT other AS slug, sum(n)::text AS n FROM (
         SELECT slug_b AS other, stories AS n FROM stack_pair_month WHERE slug_a = $1
         UNION ALL
         SELECT slug_a AS other, stories AS n FROM stack_pair_month WHERE slug_b = $1
       ) x GROUP BY other ORDER BY sum(n) DESC LIMIT 14`, [slug]),
    // The evidence. Three headlines a month survive the stories being deleted,
    // which is what keeps the chart interrogable rather than a wall of numbers.
    q<{ month: string; title: string; url: string; source_name: string | null;
        published_at: string | null; coverage: number | null; importance: number | null }>(
      `SELECT to_char(month, 'YYYY-MM') AS month, title, url, source_name,
              published_at::text, coverage, importance
         FROM stack_month_exemplar
        WHERE slug = $1
        ORDER BY month DESC, rank
        LIMIT 24`, [slug]),
    // Peak month, for the headline number that says when this thing mattered most.
    one<{ month: string; stories: string; share: string | null }>(
      `SELECT to_char(h.month, 'YYYY-MM') AS month, sum(h.stories)::text AS stories,
              round(100.0 * sum(h.stories) / nullif(max(a.tagged_stories), 0), 1)::text AS share
         FROM stack_history h
         JOIN stack_descendants($1) d ON d.slug = h.slug
         JOIN archive_history a ON a.month = h.month
        GROUP BY h.month ORDER BY sum(h.stories) DESC LIMIT 1`, [slug]),

    // HOW BIG IS THIS THING, rather than how often this archive noticed it.
    //
    // The largest technologies in the same category, this one among them. A
    // number on its own does not answer "is 12,821 a lot"; the same number
    // beside its neighbours does. Ordered by projects, so the row this page is
    // about may or may not appear -- it is unioned in below either way, because
    // a technology missing from its own comparison is the one case that must
    // never happen.
    q<{ slug: string; name: string; projects: string; stars: string | null;
        measured: string | null }>(
      `SELECT s.slug, s.name, a.projects::text, a.stars::text,
              a.measured_at::text AS measured
         FROM stacks s JOIN stack_adoption a ON a.stack_id = s.id
        WHERE a.projects IS NOT NULL
          AND (s.category = (SELECT category FROM stacks WHERE slug = $1)
               OR s.slug = $1)
        ORDER BY (s.slug = $1) DESC, a.projects DESC
        LIMIT 9`, [slug]),

    // WHAT THE THING IS, as opposed to what happened to it lately. Copied from
    // Wikidata and Wikipedia and carrying the URL it came from -- never written
    // by a model, which would produce a fluent paragraph about anything at all.
    // The company is matched back to the registry by name where possible, so a
    // maker this archive already tracks becomes a link rather than a string.
    one<{ summary: string | null; developer: string | null; inception: string | null;
          license: string | null; written_in: string[] | null; latest_version: string | null;
          official_url: string | null; source_url: string | null;
          source_license: string | null; confidence: string | null;
          company_slug: string | null; note: string | null; checked: string | null }>(
      `SELECT r.summary, r.developer, r.inception::text, r.license, r.written_in,
              r.latest_version, r.official_url, r.source_url, r.source_license,
              r.confidence, r.note, r.checked_at::text AS checked,
              c.slug AS company_slug
         FROM stacks s
         LEFT JOIN entity_reference r
                ON r.subject_kind = 'stack' AND r.subject_id = s.id
         LEFT JOIN companies c
                ON lower(c.name) = lower(r.developer)
                OR lower(r.developer) = ANY (SELECT lower(a) FROM unnest(c.aliases) a)
        WHERE s.slug = $1`, [slug]),

    // Everything the archive has collected to READ about this technology.
    // Ordered by shelf first so `official` leads, then by the order the
    // collector recorded, which is its own judgement of prominence.
    q<ResourceRow>(
      `SELECT kind, title, url, provider, free, http_status
         FROM stack_resources
        WHERE stack_slug = $1
        ORDER BY CASE kind WHEN 'official' THEN 0 WHEN 'reference' THEN 1
                           WHEN 'learning' THEN 2 WHEN 'tutorial' THEN 3 ELSE 4 END,
                 sort_order, title
        LIMIT 60`, [slug]),
  ]);

  const links = [
    stack.docs_url ? `<a href="${escapeHtml(stack.docs_url)}" target="_blank" rel="noreferrer">docs</a>` : '',
    stack.repo_url ? `<a href="${escapeHtml(stack.repo_url)}" target="_blank" rel="noreferrer">repo</a>` : '',
    stack.release_feed_url ? `<a href="${escapeHtml(stack.release_feed_url)}" target="_blank" rel="noreferrer">releases</a>` : '',
  ].filter(Boolean).join(' · ');

  const hierarchy = [
    stack.parent ? `<a class="chip" href="/trend/${encodeURIComponent(stack.parent)}">↑ ${escapeHtml(stack.parent)}</a>` : '',
    ...children.map((c) => `<a class="chip" href="/trend/${encodeURIComponent(c.slug)}">↓ ${escapeHtml(c.slug)}</a>`),
  ].filter(Boolean).join(' ');

  const recentList = recent.map((r) => `<article class="item${(r.importance ?? 0) >= 8 ? ' crit' : ''}">
      <div>
        <h2><a href="/story/${escapeHtml(r.id)}">${escapeHtml(truncate(r.title, 140))}</a></h2>
        <div class="meta">
          <span class="src">${escapeHtml(r.source)}</span>
          <span>${escapeHtml(relativeTime(r.collected))}</span>
          <span>${r.coverage} ${r.coverage === 1 ? 'outlet' : 'outlets'}</span>
          <a class="readbtn" href="/read/${escapeHtml(r.id)}" data-url="${escapeHtml(r.url)}"
            title="read the article here (v)">${icon('book', 12)}read</a>
        </div>
      </div>
      <div class="side"><span class="sev${(r.importance ?? 0) >= 8 ? ' hi' : ''}">${r.importance ?? '–'}</span></div>
    </article>`).join('');

  // Grouped by month, because the month is the unit these were chosen within:
  // three per month, most widely carried first.
  const byMonth = new Map<string, typeof exemplars>();
  for (const e of exemplars) {
    byMonth.set(e.month, [...(byMonth.get(e.month) ?? []), e]);
  }
  const archiveList = [...byMonth.entries()].map(([month, items]) => `
    <div class="exmonth"><h3>${escapeHtml(month)}</h3>
      ${items.map((e) => `<p class="ex">
        <a href="${escapeHtml(e.url)}" target="_blank" rel="noreferrer">${
          escapeHtml(truncate(e.title, 130))}</a>
        <span class="muted">${escapeHtml(e.source_name ?? '')}${
          e.coverage ? ` · ${e.coverage} outlets` : ''}${
          e.importance ? ` · importance ${e.importance}` : ''}</span></p>`).join('')}
    </div>`).join('');

  const total = Number(totals?.total ?? 0);
  const mix = [
    ['releases', Number(kinds?.releases ?? 0)],
    ['news', Number(kinds?.news ?? 0)],
    ['community', Number(kinds?.community ?? 0)],
    ['research', Number(kinds?.research ?? 0)],
  ].filter(([, n]) => Number(n) > 0) as [string, number][];

  return wrap(`
    ${pageHead(stack.name, `${escapeHtml(stack.kind)} · ${escapeHtml(stack.category)} · ${escapeHtml(stack.status)}`
      + (stack.curated ? '' : ' · <span class="accent">auto-added, unreviewed</span>')
      + (links ? ` · ${links}` : ''), {
        // The page answers "what is this" and the reader's next question is
        // always "so what has happened to it". That was a text link at the
        // bottom of a page with a chart, five cards and four sections above it.
        actions: `<a class="btn primary" href="/all?stack=${encodeURIComponent(slug)}">
            ${icon('stream', 13)} News about it</a>
          <a class="btn" href="/news?stack=${encodeURIComponent(slug)}">In my fields</a>`,
      })}

    ${hierarchy ? `<p>${hierarchy}</p>` : ''}
    ${stack.description ? `<p class="note">${escapeHtml(stack.description)}</p>` : ''}
    ${referencePanel(ref)}
    ${docsPanel(resources)}
    ${!stack.docs_url ? `<p class="muted" style="font-size:var(--t-11)">No docs URL recorded. Blank is deliberate:
      a plausible wrong URL in a permanent record is worse than a gap.</p>` : ''}

    <div class="cards">
      ${stat('Stories', total.toLocaleString('en-US'), 'all time, incl. everything beneath',
        'Every story this archive holds about this technology and anything nested under '
        + 'it, live rows and rolled-up months together.')}
      ${stat('Months seen', Number(totals?.months ?? 0), `${totals?.since ?? '—'} → ${totals?.until ?? '—'}`,
        'Months in which at least one story mentioned it. A gap means nothing was '
        + 'published that month, not that the record is missing.')}
      ${stat('Busiest month', peak?.month ?? '—',
        peak ? `${Number(peak.stories).toLocaleString('en-US')} stories`
          + (peak.share ? `, ${peak.share}% of everything tagged` : '') : '',
        'The month this technology was written about most, and how much of everything '
        + 'the archive tagged that month it accounted for.')}
      ${stat('Peak outlets', Number(totals?.sources ?? 0), 'in a single month',
        'The most separate outlets that wrote about it within one month — how broadly '
        + 'the press covered it at its busiest, not how much was published.')}
      ${stat('Peak importance', totals?.peak ?? '—', 'of 10',
        'The highest importance any single story about it ever scored, 0 to 10. One '
        + 'genuinely significant release will show here even in a quiet year.')}
      <div class="card" data-tip="Which of the four kinds of change the coverage was: launches, releases, things that cost money, and endings. A technology written about only when it breaks looks very different from one written about when it ships."><h3>Kind of attention</h3>
        ${mix.length
          ? mix.map(([k, n]) => `<span class="chip">${escapeHtml(k)}: ${n.toLocaleString('en-US')}</span>`).join(' ')
          : '<span class="muted">not yet aggregated</span>'}</div>
    </div>

    <h2 class="sec">How widely it is used</h2>
    ${adoptionPanel(stack, adoption)}

    ${related.length ? `<h2 class="sec">Appears alongside</h2>
      <p class="note">Co-mention across the whole archive, from the monthly pair counts.</p>
      <p>${related.map((r) => `<a class="chip" href="/trend/${encodeURIComponent(r.slug)}">${escapeHtml(r.slug)} ${r.n}</a>`).join(' ')}</p>` : ''}

    ${archiveList ? `<h2 class="sec">From the archive</h2>
      <p class="note">The most widely carried story about this each month. These outlive the
        stories they point at — the link still works after the row is gone.</p>
      <div class="exemplars">${archiveList}</div>` : ''}

    ${sources.length ? `<h2 class="sec">Who covers it</h2>
      <p class="note">From the live window only. Per-source volume is kept per month, but not
        broken down per technology, so this one genuinely cannot reach back.</p>
      ${table([{ name: 'source' }, { name: 'stories' }, { name: 'lang' }], sources)}` : ''}

    ${recent.length ? `<h2 class="sec">Recent</h2>${recentList}`
      : total > 0 ? empty('Nothing about this in the live window. The history above is all archive.') : ''}

  `);
}

interface AdoptionRow {
  slug: string; name: string; projects: string; stars: string | null; measured: string | null;
}

/**
 * How big a technology is, next to its neighbours.
 *
 * This replaced a histogram of story volume by month. That chart plotted how
 * often THIS ARCHIVE mentioned the thing, over every month the archive has ever
 * held -- so C++ rendered as nine years of empty buckets and one spike at the
 * right-hand end, because the archive is two months old and C++ is forty. It
 * measured the observer.
 *
 * A count of public repositories carrying the technology's GitHub topic is a
 * fact about the technology instead. It is shown against the largest things in
 * the same category because a number alone cannot answer "is 12,821 a lot" and
 * the same number beside its neighbours can.
 *
 * NOT A COUNT OF DEVELOPERS. Nobody has one -- not GitHub, not Stack Overflow,
 * not libraries.io -- and every available proxy measures something else: stars
 * are interest in one repository, questions are confusion, downloads are CI.
 * The page says what the number is, in the words of what was counted.
 */
function adoptionPanel(
  stack: { slug: string; name: string }, rows: AdoptionRow[],
): string {
  const mine = rows.find((r) => r.slug === stack.slug);
  if (!mine) {
    return `<p class="muted">Not measured yet. The adoption pass refreshes twenty
      technologies every fifteen minutes, so the whole registry comes round in
      about seventeen hours — this one has not had its turn.</p>`;
  }

  // Ordered by size for the comparison; the page's own technology keeps its
  // place in that order rather than being pinned to the top, because where it
  // falls among its neighbours IS the information.
  const ranked = [...rows].sort((a, b) => Number(b.projects) - Number(a.projects));
  const top = Math.max(...ranked.map((r) => Number(r.projects)), 1);
  const n = (v: string | null) => v === null ? '—' : Number(v).toLocaleString('en-US');

  const bars = ranked.map((r) => {
    const here = r.slug === stack.slug;
    const width = Math.max(0.6, (Number(r.projects) / top) * 100);
    return `<li${here ? ' class="here"' : ''}>
      <a href="/trend/${encodeURIComponent(r.slug)}">${escapeHtml(r.name)}</a>
      <span class="bar"><span style="width:${width.toFixed(1)}%"></span></span>
      <span class="num">${n(r.projects)}</span>
    </li>`;
  }).join('');

  return `<p class="note">Public repositories carrying the GitHub topic
      <code>${escapeHtml(stack.slug)}</code>${
      mine.measured ? `, measured ${escapeHtml(mine.measured.slice(0, 10))}` : ''}.
      This is a count of projects, not of developers — nobody publishes that
      number, and the nearest proxies each measure something else.</p>
    <div class="cards">
      ${stat('Projects', n(mine.projects), 'public repos with this topic',
        'Public GitHub repositories carrying this topic. A count of projects, not of '
        + 'developers — nobody publishes that number and every proxy for it measures '
        + 'something else.')}
      ${mine.stars !== null
        ? stat('Stars', n(mine.stars), 'on its own repository',
          'Stars on the technology’s own repository. Interest in one project, which is '
          + 'a different thing from how widely the technology is used.')
        : ''}
    </div>
    ${ranked.length > 1
      ? `<ol class="adopt">${bars}</ol>` : ''}`;
}

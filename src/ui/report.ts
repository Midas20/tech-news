// A field, explained by summarising the news rather than listing it.
//
// Asked for on 2026-08-29: "I don't want raw news, this make noise, i want
// report that summarize related news", and then "report that explain about a
// field by summarizing related news".
//
// The distinction is the whole design. `/field/<slug>` answers "what arrived",
// newest first, thirty rows deep. That is a river, and a river is exactly the
// noise being complained about: fourteen Solana changelogs and eleven BitMEX
// delistings read as twenty-five separate things when they are two.
//
// This page answers "what HAPPENED" -- the same stories, grouped by the
// technology they are about, counted by what kind of event they were, and
// stated in a sentence. Twenty-five rows become "Solana: nine changes and three
// releases, from one source".
//
// WRITTEN FROM COUNTS, NOT BY A MODEL, and deliberately so. There is an LLM
// router in this project with budgets and a cache, and it would produce nicer
// prose. It would also be able to say things the archive cannot support, and
// this page's entire value is that every sentence in it is a number somebody
// can click through to. A summary that might be wrong is worse than a list,
// because a list is honest about being a list.
//
// GROUPED BY TECHNOLOGY, which is the strongest "related" signal here. The
// archive has three candidates -- `story_members` (the same event reported by
// several outlets), `simhash` (near-duplicate text) and the stack tags. The
// first two group DUPLICATES, which the collector already merges; what a reader
// wants grouped is different stories about the same thing, and that is the tag.

import { q, one } from './db.ts';
import { FIELDS } from '../vocab/fields.ts';
import {
  escapeHtml, wrap, pageHead, empty, relativeTime, truncate, icon,
} from './html.ts';
import { crumbsFor } from './nav.ts';

/** How many days the report covers. Short enough to be about now. */
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export function reportDays(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(Math.floor(n), MAX_DAYS);
}

interface Grouped {
  slug: string;
  name: string;
  stories: number;
  sources: number;
  launch: number;
  release: number;
  change: number;
  market: number;
  article: number;
  titles: { id: string; title: string; url: string; kind: string; source: string; when: string }[];
}

/**
 * The English for a count of event kinds.
 *
 * "three releases and a breaking change" rather than "release: 3, change: 1".
 * The list is built in the order a reader cares about -- what is new, then what
 * moved, then what merely happened -- and an empty class is omitted rather than
 * reported as zero, because "0 launches" is noise in a sentence about noise.
 */
function phrase(g: Grouped): string {
  const bits: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n === 1) bits.push(`one ${one}`);
    else if (n > 1) bits.push(`${n} ${many}`);
  };
  add(g.market, 'market move', 'market moves');
  add(g.launch, 'launch', 'launches');
  add(g.release, 'release', 'releases');
  add(g.change, 'change', 'changes');
  add(g.article, 'piece of writing', 'pieces of writing');
  if (bits.length === 0) return 'nothing classified';
  if (bits.length === 1) return bits[0]!;
  return `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;
}

/** "from one source" vs "from four sources" — how much of this is one outlet. */
function attribution(g: Grouped): string {
  return g.sources === 1
    ? 'from a single source'
    : `from ${g.sources} sources`;
}

export async function renderFieldReport(slug: string, days: number): Promise<string> {
  const field = FIELDS.find((f) => f.slug === slug);
  const root = await one<{ slug: string; name: string; description: string | null }>(
    `SELECT slug, name, description FROM stacks WHERE slug = $1`, [slug]);
  if (!root) return wrap(pageHead('Unknown field', 'Not a root of the taxonomy.'));
  const label = field?.label ?? root.name;

  const [totals, groups, kinds, movers] = await Promise.all([
    // The period, and the one before it of the same length. Direction needs a
    // comparison and a single number is not one.
    one<{ now: string; prev: string; sources: string; first: string | null }>(
      `SELECT count(*) FILTER (WHERE d > now() - make_interval(days => $2::int))::text AS now,
              count(*) FILTER (WHERE d <= now() - make_interval(days => $2::int)
                                 AND d >  now() - make_interval(days => $2::int * 2))::text AS prev,
              count(DISTINCT source_id) FILTER (
                WHERE d > now() - make_interval(days => $2::int))::text AS sources,
              min(d) FILTER (WHERE d > now() - make_interval(days => $2::int))::date::text AS first
         FROM (SELECT coalesce(published_at, collected_at) AS d, source_id
                 FROM stories
                WHERE superseded_by IS NULL AND dismissed_at IS NULL
                  AND stacks && stack_expand(ARRAY[$1]::text[])) z`, [slug, days]),

    // One row per technology in the field that produced anything, with its
    // event mix. LIMIT is generous: the tail is the interesting part of a
    // report about what is growing.
    q<{ slug: string; name: string; stories: string; sources: string;
        launch: string; release: string; change: string; market: string; article: string }>(
      `SELECT st.slug, st.name,
              count(*)::text AS stories,
              count(DISTINCT s.source_id)::text AS sources,
              count(*) FILTER (WHERE s.event_kind = 'launch')::text  AS launch,
              count(*) FILTER (WHERE s.event_kind = 'release')::text AS release,
              count(*) FILTER (WHERE s.event_kind = 'change')::text  AS change,
              count(*) FILTER (WHERE s.event_kind = 'market')::text  AS market,
              count(*) FILTER (WHERE s.event_kind = 'article')::text AS article
         FROM stories s
         JOIN stacks st ON st.slug = ANY(s.stacks)
        WHERE s.superseded_by IS NULL AND s.dismissed_at IS NULL
          AND s.stacks && stack_expand(ARRAY[$1]::text[])
          AND st.slug <> $1
          AND coalesce(s.published_at, s.collected_at) > now() - make_interval(days => $2::int)
        GROUP BY st.slug, st.name
        ORDER BY count(*) DESC, st.name
        LIMIT 24`, [slug, days]),

    // The field's own event mix, for the opening sentence.
    q<{ kind: string; n: string }>(
      `SELECT event_kind AS kind, count(*)::text AS n
         FROM stories
        WHERE superseded_by IS NULL AND dismissed_at IS NULL
          AND stacks && stack_expand(ARRAY[$1]::text[])
          AND coalesce(published_at, collected_at) > now() - make_interval(days => $2::int)
        GROUP BY 1`, [slug, days]),

    // Money, called out separately because it is the half the archive was
    // blindest to and the half a reader is least likely to find by scrolling.
    q<{ id: string; title: string; url: string; source: string; when: string }>(
      `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title,
              s.canonical_url AS url, src.name AS source,
              coalesce(s.published_at, s.collected_at)::text AS when
         FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND s.dismissed_at IS NULL
          AND s.event_kind = 'market'
          AND s.stacks && stack_expand(ARRAY[$1]::text[])
          AND coalesce(s.published_at, s.collected_at) > now() - make_interval(days => $2::int)
        ORDER BY coalesce(s.published_at, s.collected_at) DESC LIMIT 12`, [slug, days]),
  ]);

  const now = Number(totals?.now ?? 0);
  const prev = Number(totals?.prev ?? 0);

  if (now === 0) {
    return wrap(`
      ${pageHead(`${label}: report`,
        `Nothing collected in this field in the last ${days} days.`,
        // Reports, not Explore. The tab this page lights is the one the trail
      // has to name -- a breadcrumb that disagrees with the top bar is a claim
      // about where you are, and it was claiming the wrong section.
      { crumbs: [...crumbsFor('/reports', 'Reports'), { label }] })}
      ${empty(`No stories in ${label} in the last ${days} days, so there is nothing to `
        + 'summarise. That is a statement about coverage, not about the field.')}
      <p class="note" style="text-align:center">
        <a href="/field/${encodeURIComponent(slug)}">See the field page</a> ·
        <a href="/field/${encodeURIComponent(slug)}/report?days=180">Try 180 days</a>
      </p>`);
  }

  // Headlines per technology, fetched once for every group rather than per row.
  const slugs = groups.map((g) => g.slug);
  const heads = slugs.length ? await q<{
    slug: string; id: string; title: string; url: string; kind: string;
    source: string; when: string;
  }>(
    `SELECT st.slug, s.id::text, coalesce(s.title_en, s.title_original) AS title,
            s.canonical_url AS url, s.event_kind AS kind, src.name AS source,
            coalesce(s.published_at, s.collected_at)::text AS when
       FROM stories s
       JOIN sources src ON src.id = s.source_id
       JOIN stacks st ON st.slug = ANY(s.stacks)
      WHERE s.superseded_by IS NULL AND s.dismissed_at IS NULL
        AND st.slug = ANY($1::text[])
        AND coalesce(s.published_at, s.collected_at) > now() - make_interval(days => $2::int)
      ORDER BY st.slug, s.importance DESC NULLS LAST,
               coalesce(s.published_at, s.collected_at) DESC`, [slugs, days]) : [];

  const byStack = new Map<string, Grouped>();
  for (const g of groups) {
    byStack.set(g.slug, {
      slug: g.slug, name: g.name,
      stories: Number(g.stories), sources: Number(g.sources),
      launch: Number(g.launch), release: Number(g.release), change: Number(g.change),
      market: Number(g.market), article: Number(g.article), titles: [],
    });
  }
  for (const h of heads) {
    const g = byStack.get(h.slug);
    if (g && g.titles.length < 4) {
      g.titles.push({ id: h.id, title: h.title, url: h.url, kind: h.kind,
                      source: h.source, when: h.when });
    }
  }
  const grouped = [...byStack.values()];

  // Direction. Stated as a percentage only when the previous period had enough
  // in it to divide by -- "up 400%" from one story to five is arithmetic, not
  // a trend, and this page exists to stop that kind of sentence.
  const direction = prev >= 5
    ? (() => {
        const pct = Math.round(((now - prev) / prev) * 100);
        if (Math.abs(pct) < 10) return `level with the ${days} days before it`;
        return pct > 0
          ? `up ${pct}% on the ${days} days before it`
          : `down ${Math.abs(pct)}% on the ${days} days before it`;
      })()
    : `against ${prev} in the ${days} days before it, which is too few to call a trend`;

  const kindMap = new Map(kinds.map((k) => [k.kind, Number(k.n)]));
  const fieldPhrase = phrase({
    slug, name: label, stories: now, sources: Number(totals?.sources ?? 0),
    launch: kindMap.get('launch') ?? 0, release: kindMap.get('release') ?? 0,
    change: kindMap.get('change') ?? 0, market: kindMap.get('market') ?? 0,
    article: kindMap.get('article') ?? 0, titles: [],
  });

  const covered = grouped.reduce((n, g) => n + g.stories, 0);

  const section = (g: Grouped) => `
    <div class="rep-group">
      <h3><a href="/all?stack=${encodeURIComponent(g.slug)}">${escapeHtml(g.name)}</a>
        <span class="rep-n">${g.stories}</span></h3>
      <p class="rep-say">${escapeHtml(phrase(g))}, ${escapeHtml(attribution(g))}.</p>
      <ul class="rep-list">
        ${g.titles.map((t) => `<li>
          <span class="rep-kind k-${escapeHtml(t.kind)}">${escapeHtml(t.kind)}</span>
          <a href="${escapeHtml(t.url)}" target="_blank" rel="noreferrer"
            >${escapeHtml(truncate(t.title, 110))}</a>
          <span class="rep-src">${escapeHtml(t.source)} · ${relativeTime(t.when)}</span>
        </li>`).join('')}
        ${g.stories > g.titles.length ? `<li class="rep-more">
          <a href="/all?stack=${encodeURIComponent(g.slug)}"
            >${g.stories - g.titles.length} more in ${escapeHtml(g.name)}</a></li>` : ''}
      </ul>
    </div>`;

  return wrap(`
    ${pageHead(`${label}: report`,
      `What happened in ${label} over the last ${days} days, grouped by the technology it `
      + 'happened to. Every sentence here is a count, and every count links to the stories '
      + 'behind it.',
      { crumbs: [...crumbsFor('/reports', 'Reports'), { label }] })}

    <form method="get" action="/field/${encodeURIComponent(slug)}/report"
      class="row" style="--row-gap:var(--s-2);margin:0 0 var(--s-4)">
      <label for="rep-days">Period</label>
      <select id="rep-days" name="days" onchange="this.form.submit()">
        ${[7, 30, 90, 180, 365].map((d) =>
          `<option value="${d}"${d === days ? ' selected' : ''}>last ${d} days</option>`).join('')}
      </select>
      <noscript><button class="btn" type="submit">Go</button></noscript>
      <a class="btn" href="/field/${encodeURIComponent(slug)}">Raw stories</a>
    </form>

    <div class="rep-lede">
      <p><b>${now.toLocaleString('en-US')} ${now === 1 ? 'story' : 'stories'}</b> in
        ${escapeHtml(label)} over the last ${days} days, ${escapeHtml(direction)} —
        ${escapeHtml(fieldPhrase)}, from
        ${escapeHtml(String(totals?.sources ?? 0))}
        ${Number(totals?.sources ?? 0) === 1 ? 'source' : 'sources'}.</p>
      <p class="muted">${grouped.length === 0
        ? 'None of it is tagged to a technology beneath this field, so it cannot be grouped.'
        // NOT "N of them": the groups below overlap. A story tagged Kubernetes AND
        // Docker appears under both, so the sum of the groups routinely exceeds
        // the number of stories, and phrasing it as a subset stated something
        // arithmetically impossible -- 487 of 354.
        : `The ${grouped.length} ${grouped.length === 1 ? 'technology' : 'technologies'} below `
          + `account for ${covered.toLocaleString('en-US')} `
          + `${covered === 1 ? 'mention' : 'mentions'} across them; a story tagged with two `
          + 'is counted under both.'}</p>
    </div>

    ${movers.length ? `<h2 class="sec">Money</h2>
      <p class="muted" style="margin-top:-4px">Funding, acquisitions and adoption moves in this
        field. Called out separately because it is the half of the archive that was blindest
        until 2026-08-29, and the half hardest to find by scrolling.</p>
      <ul class="rep-list rep-money">
        ${movers.map((m) => `<li>
          <span class="rep-kind k-market">market</span>
          <a href="${escapeHtml(m.url)}" target="_blank" rel="noreferrer"
            >${escapeHtml(truncate(m.title, 110))}</a>
          <span class="rep-src">${escapeHtml(m.source)} · ${relativeTime(m.when)}</span>
        </li>`).join('')}
      </ul>` : ''}

    ${grouped.length ? `<h2 class="sec">What changed, by technology</h2>
      <div class="rep-groups">${grouped.map(section).join('')}</div>`
      : empty('Nothing in this period carries a technology tag beneath this field.')}

    <p class="note">This report counts stories the archive collected and classified. It is not
      a claim about what happened in the world — a field with no sources covering it produces
      a short report, and that is a statement about the registry rather than about the field.</p>
  `);
}

/** The sentence-building is the part worth testing without a database. */
export const __test = { phrase, attribution };


// --- the index -----------------------------------------------------------
//
// The menu behind the Reports tab. One card per field, each carrying the two
// numbers that decide whether the report is worth opening -- how much arrived,
// and whether that is more or less than the period before it.
//
// A field with nothing in it keeps its card. An empty report is a true answer
// about a quiet field, and dropping the row would make this page change shape
// week to week, which is the opposite of what a menu is for.

interface FieldPeriod {
  slug: string;
  now: number;
  prev: number;
  sources: number;
}

/** Both periods for every field, in one query. */
async function fieldPeriods(days: number): Promise<Map<string, FieldPeriod>> {
  const rows = await q<{ slug: string; now: string; prev: string; sources: string }>(
    `SELECT f.slug,
            count(s.id) FILTER (
              WHERE coalesce(s.published_at, s.collected_at)
                    > now() - make_interval(days => $2::int))::text AS now,
            count(s.id) FILTER (
              WHERE coalesce(s.published_at, s.collected_at)
                    <= now() - make_interval(days => $2::int)
                AND coalesce(s.published_at, s.collected_at)
                    >  now() - make_interval(days => $2::int * 2))::text AS prev,
            count(DISTINCT s.source_id) FILTER (
              WHERE coalesce(s.published_at, s.collected_at)
                    > now() - make_interval(days => $2::int))::text AS sources
       FROM unnest($1::text[]) AS f(slug)
       LEFT JOIN stories s
         ON s.superseded_by IS NULL AND s.dismissed_at IS NULL
        AND s.stacks && stack_expand(ARRAY[f.slug]::text[])
      GROUP BY f.slug`,
    [FIELDS.map((f) => f.slug), days]);
  return new Map(rows.map((r) => [r.slug, {
    slug: r.slug, now: Number(r.now), prev: Number(r.prev), sources: Number(r.sources),
  }]));
}

/**
 * The direction, in words, and only when the comparison can carry it.
 *
 * Below five in the previous period a percentage is theatre: two stories
 * becoming five is "up 150%" and means nothing. The same guard the report
 * itself uses, for the same reason.
 */
function movement(p: FieldPeriod | undefined): string {
  if (!p || p.now === 0) return 'nothing yet';
  if (!p.prev || p.prev < 5) return 'no useful comparison';
  const pct = Math.round(((p.now - p.prev) / p.prev) * 100);
  if (pct === 0) return 'level with the period before';
  return `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on the period before`;
}

export async function renderReports(days: number): Promise<string> {
  const periods = await fieldPeriods(days);

  const cards = [...FIELDS]
    .sort((a, b) => (periods.get(b.slug)?.now ?? 0) - (periods.get(a.slug)?.now ?? 0))
    .map((f) => {
      const p = periods.get(f.slug);
      const n = p?.now ?? 0;
      return `<a class="repcard" href="/field/${encodeURIComponent(f.slug)}/report?days=${days}">
        <div class="fc-top">${icon(f.icon, 16)}<span class="fc-name">${escapeHtml(f.label)}</span></div>
        <div class="fc-n">${n.toLocaleString('en-US')}
          <small>${n === 1 ? 'story' : 'stories'} in ${days} days</small></div>
        <div class="repcard-move">${escapeHtml(movement(p))}</div>
        <div class="repcard-src muted">${p?.sources
          ? `${p.sources} ${p.sources === 1 ? 'source' : 'sources'}`
          : 'no sources reporting'}</div>
      </a>`;
    }).join('');

  return wrap(`
    ${pageHead('Reports',
      'What happened in a field over a period, counted and grouped by the technology it '
      + 'happened to — instead of a list of everything that arrived. Every sentence in a '
      + 'report is a count, and every count links to the stories behind it.',
      { crumbs: crumbsFor('/reports', 'Reports') })}

    <form method="get" action="/reports" class="row" style="--row-gap:var(--s-2);margin:0 0 var(--s-4)">
      <label for="rep-days">Period</label>
      <select id="rep-days" name="days" onchange="this.form.submit()">
        ${[7, 30, 90, 180, 365].map((d) =>
          `<option value="${d}"${d === days ? ' selected' : ''}>last ${d} days</option>`).join('')}
      </select>
      <noscript><button class="btn" type="submit">Go</button></noscript>
      <a class="btn" href="/all">Raw stories</a>
    </form>

    <div class="fieldgrid">${cards}</div>`);
}

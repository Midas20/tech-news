// Where software runs and ships.
//
// This registry held EARNING platforms -- freelance marketplaces, bounties,
// stock media, creator tips -- seeded for a Phase 7 feature that was never
// built. Fifty-six hand-written rows, and not one tagged on a single live
// story, because the technology press does not write about payout thresholds.
// The rail meanwhile said "Platforms are where a thing runs or is sold", which
// described a different registry entirely.
//
// It now holds that one: clouds, package registries, app and extension stores,
// model hosts, CI and managed data. Sixty-five rows the sources in this archive
// actually write about. The old rows are retired rather than deleted -- see
// migrations/0050 -- because platform_month keys months of history by slug.
//
// What is here is IDENTITY plus what the archive already knows: who they are,
// which channel, whether the site still answers, every story that mentions them,
// and the background panel the technology pages use. What is deliberately NOT
// here is a price list.
//
// `platform_facts` models a fact as a value with a source URL, a confidence and a
// validity window, superseded rather than overwritten -- because "S3 costs
// $0.023/GB" is true until it is not, and a number with no source and no date is
// indistinguishable from a number that is wrong. The page says the facts are
// uncollected rather than inventing them, and says what would collect them.
import { q, one } from './db.ts';
import {
  escapeHtml, wrap, pageHead, empty, kpi, panel, icon, relativeTime, subnav,
} from './html.ts';
import { CHANNELS } from '../../seeds/platforms.ts';
import { crumbsFor } from './nav.ts';
import { referencePanel, type ReferenceRow } from './reference.ts';

const CHANNEL_LABEL = new Map(CHANNELS.map((c) => [c.id, c]));

interface PlatformRow {
  slug: string;
  name: string;
  url: string;
  channel: string | null;
  status: string;
  stories: number;
  latest: string | null;
  /** What the link checker found at p.url. See migrations/0038. */
  link_state: string | null;
  link_final: string | null;
  /** The technology this platform also is, where it is one. See 0051. */
  stack_slug: string | null;
  /** Wikidata's one-line description, for the row. See 0052. */
  blurb: string | null;
}

/**
 * Stories about a platform, matched by name.
 *
 * Platforms are not in the stack vocabulary and should not be -- Upwork is not a
 * technology -- so this matches the name against the title directly. The word
 * boundary matters for the same reason it does everywhere else: "Arc" and
 * "Impact" are ordinary words, so a platform whose name is one is matched only
 * where it appears capitalised.
 */
const STORY_MATCH = `
  EXISTS (
    SELECT 1 FROM stories s
     WHERE s.superseded_by IS NULL
       AND coalesce(s.title_en, s.title_original) ~ ('(^|[^A-Za-z])' || p.name || '([^A-Za-z]|$)')
  )`;

/**
 * The orders worth offering, and the SQL for each.
 *
 * Whitelisted rather than interpolated: this string ends up in an ORDER BY, and
 * an ORDER BY built from a query parameter is an injection with extra steps.
 * The key is looked up in this map and the map's value is used -- a value the
 * request never touches.
 */
export const PLATFORM_SORTS: Record<string, { label: string; sql: string }> = {
  stories: {
    label: 'Most written about',
    sql: '(coalesce(a.archived, 0) + coalesce(l.live, 0)) DESC, p.name',
  },
  name: { label: 'Name A–Z', sql: 'p.name ASC' },
  recent: {
    label: 'Recently mentioned',
    // NULLS LAST: a platform nothing has ever said anything about is not the
    // most recently mentioned one, which is what NULLS FIRST would imply.
    sql: 'greatest(a.last_month::timestamptz, l.latest) DESC NULLS LAST, p.name',
  },
  channel: { label: 'By channel', sql: 'p.channel_type_id ASC, p.name ASC' },
  health: {
    label: 'Link health',
    // Broken first: this ordering exists to find what needs fixing, so the
    // interesting end of it belongs at the top.
    //
    // Written as a searched CASE, not a simple one. `CASE h.state WHEN NULL`
    // never matches: a simple CASE compares with =, and NULL = NULL is unknown
    // rather than true, so every never-checked platform would fall through to
    // ELSE and sort as though it were the most broken thing in the registry.
    sql: `CASE WHEN h.state IS NULL THEN 1
               WHEN h.state = 'ok' THEN 3
               WHEN h.state = 'blocked' THEN 2
               ELSE 0 END ASC, p.name`,
  },
};

export const PLATFORM_SORT_DEFAULT = 'stories';

/** The requested order if it is one we offer, the default otherwise. */
export function platformSort(requested: string | null): string {
  return requested && Object.hasOwn(PLATFORM_SORTS, requested)
    ? requested : PLATFORM_SORT_DEFAULT;
}

async function platformRows(
  channel: string, sort: string, search = '',
): Promise<PlatformRow[]> {
  const params: unknown[] = [];
  // Retired platforms keep their row so the rollup history that references them
  // by slug still resolves -- see 0050 -- and stop being listed.
  const clauses = ['p.retired_at IS NULL'];
  if (channel) clauses.push(`p.channel_type_id = $${params.push(channel)}`);
  // Name, slug and address. NOT the blurb: those descriptions come from
  // Wikidata and are written to disambiguate, so they contain words like
  // "platform", "service" and "software" for nearly every row -- searching them
  // returns the whole registry for a term that felt specific when it was typed.
  //
  // The address is included because a person looking for a platform often knows
  // the domain and not the brand: "avax" finds Avalanche, "jup.ag" finds
  // Jupiter, and neither string appears in either name.
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    const i = params.push(like);
    clauses.push(`(lower(p.name) LIKE $${i} OR lower(p.slug) LIKE $${i}`
      + ` OR lower(p.url) LIKE $${i})`);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const order = PLATFORM_SORTS[platformSort(sort)]!.sql;

  return q<PlatformRow>(
    `SELECT p.slug, p.name, p.url, p.channel_type_id AS channel, p.status,
            p.stack_slug, r.short_description AS blurb,
            -- All-time volume from the monthly rollup plus the live window,
            -- which is also what makes this survive retention. The old form was
            -- a regex over every story title, run once PER PLATFORM.
            (coalesce(a.archived, 0) + coalesce(l.live, 0))::int AS stories,
            greatest(a.last_month::timestamptz, l.latest)::text AS latest,
            h.state AS link_state,
            h.final_url AS link_final
       FROM platforms p
       LEFT JOIN LATERAL (
         SELECT sum(pm.stories) AS archived, max(pm.month) AS last_month
           FROM platform_month pm WHERE pm.slug = p.slug
       ) a ON true
       LEFT JOIN LATERAL (
         -- Either tagged to the platform directly, or tagged to the TECHNOLOGY
         -- this platform also is. The platform tagger deliberately yields the
         -- name to the stack vocabulary where both claim it -- see 0051 -- so
         -- for Cloudflare, Azure, AWS and every other platform worth opening,
         -- the second half is where all the stories actually are.
         SELECT count(*) AS live, max(coalesce(s.published_at, s.collected_at)) AS latest
           FROM stories s
          WHERE s.superseded_by IS NULL
            AND (p.slug = ANY(s.platforms)
                 OR (p.stack_slug IS NOT NULL AND s.stacks && ARRAY[p.stack_slug]))
       ) l ON true
       LEFT JOIN link_health h ON h.url = p.url
       -- One line saying what the thing is. Wikidata's own description, written
       -- to disambiguate an item in a list, which is exactly this list.
       LEFT JOIN entity_reference r
              ON r.subject_kind = 'platform' AND r.subject_id = p.id
       ${where}
      ORDER BY ${order}`, params);
}

export async function renderPlatforms(url: URL): Promise<string> {
  const channel = CHANNELS.some((c) => c.id === url.searchParams.get('channel'))
    ? url.searchParams.get('channel')! : '';

  const sort = platformSort(url.searchParams.get('sort'));
  // `sq`, not `q`: `q` is the header's archive-wide search and the two must not
  // fight over the same box. Same name Stacks, Sources and the Registry use.
  const search = url.searchParams.get('sq')?.trim() ?? '';

  const [rows, totals, counts] = await Promise.all([
    platformRows(channel, sort, search),
    one<{ n: string }>(
      `SELECT count(*)::text AS n FROM platforms WHERE retired_at IS NULL`),
    q<{ channel: string; n: string }>(
      `SELECT channel_type_id AS channel, count(*)::text AS n
         FROM platforms WHERE retired_at IS NULL GROUP BY 1`),
  ]);

  const byChannel = new Map(counts.map((c) => [c.channel, Number(c.n)]));
  const n = (v: string | null | undefined) => Number(v ?? 0);
  const seen = rows.filter((r) => r.stories > 0).length;

  return wrap(`
    ${pageHead('Platforms',
      'Where software runs and ships: the clouds, package registries, stores and model hosts '
      + 'the sources here write about. Every row carries the real address and whether it '
      + 'answered when last checked. What a platform charges is not here, and the reason is below.',
      { crumbs: crumbsFor('/platforms', 'Platforms') })}

    ${subnav([
      { href: '/platforms', label: 'All channels', icon: 'grid', active: !channel, count: n(totals?.n) },
      ...CHANNELS.filter((c) => byChannel.get(c.id)).map((c) => ({
        href: `/platforms?channel=${c.id}`,
        label: c.label,
        count: byChannel.get(c.id) ?? 0,
        active: channel === c.id,
      })),
    ])}

    <div class="kpis">
      ${kpi({ label: 'Platforms', value: n(totals?.n),
        help: 'Platforms in the live registry. Curated by hand rather than grown by '
          + 'collection, so the number moves when the list is edited and not otherwise. '
          + 'Retired entries keep their row and stop being listed.' })}
      ${kpi({ label: 'In the archive', value: seen, note: 'mentioned by a collected story',
        help: 'Platforms at least one collected story names. The rest are in the '
          + 'registry but the technology press has not written about them.' })}
    </div>

    <form method="get" action="/platforms" class="row" style="--row-gap:var(--s-2);margin:0 0 var(--s-3)">
      ${channel ? `<input type="hidden" name="channel" value="${escapeHtml(channel)}">` : ''}
      <input class="txt" type="search" name="sq" value="${escapeHtml(search)}"
        placeholder="${channel
          ? `search ${escapeHtml((CHANNEL_LABEL.get(channel)?.label ?? 'this channel').toLowerCase())}…`
          : 'name, slug or address…'}"
        aria-label="Search platforms">
      <label for="plat-sort">Sort</label>
      <select id="plat-sort" name="sort" onchange="this.form.submit()">
        ${Object.entries(PLATFORM_SORTS).map(([v, o]) =>
          `<option value="${v}"${sort === v ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
      <button class="btn" type="submit">Search</button>
      ${search ? `<a class="btn" href="/platforms${channel ? `?channel=${channel}` : ''}"
        title="clear the search">Clear</a>` : ''}
    </form>

    ${search ? `<h2 class="sec">${rows.length}
      ${rows.length === 1 ? 'platform matches' : 'platforms match'}
      &ldquo;${escapeHtml(search)}&rdquo;${channel
        ? ` in ${escapeHtml(CHANNEL_LABEL.get(channel)?.label ?? channel)}` : ''}</h2>` : ''}

    ${rows.length === 0 ? `${empty(search
      ? `Nothing in the registry matches “${escapeHtml(search)}”${channel
          ? ' in this channel' : ''}.`
      : 'No platforms in this channel.')}
      ${/* A search that finds nothing HERE but something elsewhere is the
            common case once the channel tabs exist -- looking for Coinbase
            while standing in App and extension stores. Say so and offer the way
            out, rather than leaving the reader to conclude the registry does
            not have it. */ ''}
      ${search && channel ? `<p class="note" style="text-align:center">
        <a href="/platforms?sq=${encodeURIComponent(search)}">Search every channel</a>
      </p>` : ''}` : `<div class="stacklist">
      ${rows.map((r) => `<div class="stackrow">
        <div style="min-width:0">
          <div class="nm">
            <span class="statusdot ${r.status === 'active' ? '' : 'unknown'}"
              title="${escapeHtml(r.status)}"></span>
            <a href="/platform/${encodeURIComponent(r.slug)}"><b>${escapeHtml(r.name)}</b></a>
            <span class="sl">${escapeHtml(new URL(r.url).hostname.replace(/^www\./, ''))}</span>
          </div>
          <div class="al">
            <a class="addr ${r.link_state === 'ok' ? 'ok'
              : r.link_state === 'missing' || r.link_state === 'unreachable'
                || r.link_state === 'erroring' ? 'bad' : 'muted'}"
              href="${escapeHtml(r.url)}" target="_blank" rel="noreferrer"
              title="${escapeHtml(r.link_state === 'ok' ? 'answered when last checked'
                : r.link_state === 'blocked' ? 'refused an automated request — fine in a browser'
                : r.link_state ? `last check: ${r.link_state}` : 'not checked yet')}"
              >${escapeHtml(r.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>
            <span class="catlabel">${escapeHtml(
              CHANNEL_LABEL.get(r.channel ?? '')?.label.toLowerCase() ?? 'unclassified')}</span>
          </div>
          ${r.blurb ? `<div class="blurb">${escapeHtml(r.blurb)}</div>` : ''}
        </div>
        <div class="num">${r.stories.toLocaleString('en-US')}<small>stories</small></div>
        <div class="lnk">
          <a href="${escapeHtml(r.url)}" target="_blank" rel="noreferrer">site</a>
          <a href="/platform/${encodeURIComponent(r.slug)}">detail</a>
        </div>
      </div>`).join('')}</div>`}
  `);
}

/** Why the fee column is empty, said plainly rather than left as a gap. */
export async function renderPlatform(slug: string): Promise<string> {
  const platform = await one<{
    slug: string; name: string; url: string; channel: string | null; status: string;
    first_seen: string; updated: string; stack_slug: string | null;
    retired: string | null;
  }>(
    `SELECT slug, name, url, channel_type_id AS channel, status, stack_slug,
            first_seen_at::date::text AS first_seen, updated_at::text AS updated,
            retired_at::date::text AS retired
       FROM platforms WHERE slug = $1`, [slug]);

  if (!platform) return wrap(pageHead('Unknown platform', 'Not in the registry.'));

  const [stories, related, history, ref] = await Promise.all([
    q<{ id: string; title: string; url: string; source: string; when: string; importance: number | null }>(
      // Was a regex over every story title, run for one platform at a time, and
      // it found what a regex over titles finds: "Render a template" for the
      // host called Render. This reads the tags instead -- the platform's own,
      // plus the technology it also is.
      `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title, s.canonical_url AS url,
              src.name AS source, coalesce(s.published_at, s.collected_at)::text AS when,
              s.importance
         FROM stories s
         JOIN sources src ON src.id = s.source_id
         JOIN platforms p ON p.slug = $1
        WHERE s.superseded_by IS NULL
          AND (p.slug = ANY(s.platforms)
               -- WIDENED THROUGH THE STACK TREE, like the technology page.
               -- Matching ARRAY[p.stack_slug] alone finds only the exact
               -- tag: a platform whose stack is "kubernetes" missed every
               -- story tagged with a child of it. stack_expand() is the same
               -- function /trend uses, so both pages now answer the same
               -- question about breadth.
               OR (p.stack_slug IS NOT NULL
                   AND s.stacks && stack_expand(ARRAY[p.stack_slug]::text[])))
        ORDER BY coalesce(s.published_at, s.collected_at) DESC LIMIT 40`, [slug]),

    q<{ slug: string; name: string }>(
      `SELECT slug, name FROM platforms
        WHERE channel_type_id = (SELECT channel_type_id FROM platforms WHERE slug = $1)
          AND slug <> $1 AND retired_at IS NULL ORDER BY name LIMIT 12`, [slug]),

    // ALL-TIME, from the monthly rollup, which is a different number from the
    // list of stories below it and the difference is the point. Retention holds
    // two months; everything older was reduced to analysis and its rows deleted.
    // The list page counts rollup plus live, so a platform can read "34" there
    // and show nothing here -- which looked like a broken page rather than a
    // working retention policy until this said so.
    one<{ archived: string; months: string; last_month: string | null }>(
      `SELECT coalesce(sum(stories), 0)::text AS archived,
              count(*)::text AS months,
              to_char(max(month), 'YYYY-MM') AS last_month
         FROM platform_month WHERE slug = $1`, [slug]),

    // The same background a technology page carries, from the same sources and
    // under the same rule: copied and attributed, never generated.
    one<ReferenceRow>(
      `SELECT r.summary, r.developer, r.inception::text, r.license, r.written_in,
              r.latest_version, r.official_url, r.source_url, r.source_license,
              r.confidence, r.note, r.checked_at::text AS checked,
              c.slug AS company_slug
         FROM platforms p
         LEFT JOIN entity_reference r
                ON r.subject_kind = 'platform' AND r.subject_id = p.id
         LEFT JOIN companies c
                ON lower(c.name) = lower(r.developer)
                OR lower(r.developer) = ANY (SELECT lower(a) FROM unnest(c.aliases) a)
        WHERE p.slug = $1`, [slug]),
  ]);

  const channel = CHANNEL_LABEL.get(platform.channel ?? '');

  return wrap(`
    ${pageHead(platform.name,
      `${escapeHtml(channel?.label ?? 'Unclassified')} · ${escapeHtml(channel?.blurb ?? '')}`,
      {
        crumbs: [...crumbsFor('/platform/', 'Platforms'), { label: platform.name }],
        actions: `<a class="btn primary" href="/all?platform=${encodeURIComponent(slug)}">
            ${icon('stream', 13)} News about it</a>
          <a class="btn" href="${escapeHtml(platform.url)}"
            target="_blank" rel="noreferrer">Open ${escapeHtml(platform.name)} ${icon('external', 12)}</a>`,
      })}

    ${platform.retired ? `<p class="notice bad">Retired from the registry on
      ${escapeHtml(platform.retired)}. The row is kept because months of history
      reference it; it is no longer listed.</p>` : ''}

    ${referencePanel(ref)}

    <div class="kpis">
      ${kpi({ label: 'Stories held', value: stories.length,
        note: 'still in the live window',
        help: 'Stories about this platform whose rows the archive still holds. '
          + 'Retention keeps two months; older ones were reduced to the monthly '
          + 'rollup and deleted, which is why this can be zero while the all-time '
          + 'figure beside it is not.' })}
      ${Number(history?.archived ?? 0) > 0 ? kpi({
        label: 'All time', value: Number(history?.archived ?? 0),
        note: `${history?.months ?? 0} month(s), to ${history?.last_month ?? '—'}`,
        help: 'Every story ever collected about this platform, counted from the '
          + 'monthly rollup. The rollup outlives the stories it counted, which is '
          + 'the whole reason it exists.' }) : ''}
    </div>

    <h2 class="sec">${icon('stream', 14)} In the archive</h2>
    ${platform.stack_slug ? `<p class="note">Read through
      <a href="/trend/${encodeURIComponent(platform.stack_slug)}"><code>${
        escapeHtml(platform.stack_slug)}</code></a>, the technology of the same name.
      Where a name is both, the tagger gives it to the technology — so this is
      where the stories about ${escapeHtml(platform.name)} actually are.</p>` : ''}
    ${stories.length === 0
      ? empty(Number(history?.archived ?? 0) > 0
        ? `${history?.archived} stories about ${platform.name} were collected across `
          + `${history?.months} month(s), and none is still held. Retention keeps two `
          + `months of stories and the analysis forever — the counts above survive, the `
          + `rows they counted do not. This fills again as new stories arrive.`
        : `Nothing collected mentions ${platform.name} yet.`)
      : stories.map((r) => `<article class="item">
          <div>
            <h2><a href="/story/${escapeHtml(r.id)}">${escapeHtml(r.title)}</a></h2>
            <div class="meta">
              <span class="src">${escapeHtml(r.source)}</span>
              <span class="dot"></span>
              <span>${escapeHtml(relativeTime(r.when))}</span>
              <a class="readbtn" href="/read/${escapeHtml(r.id)}" data-url="${escapeHtml(r.url)}"
                >${icon('book', 12)}read</a>
            </div>
          </div>
          <div class="side"><span class="sev">${r.importance ?? '–'}</span></div>
        </article>`).join('')}

    ${related.length ? `<h2 class="sec">Also in ${escapeHtml(channel?.label.toLowerCase() ?? 'this channel')}</h2>
      <p>${related.map((r) => `<a class="chip" href="/platform/${encodeURIComponent(r.slug)}">${
        escapeHtml(r.name)}</a>`).join(' ')}</p>` : ''}
  `);
}

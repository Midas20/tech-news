// Search: entity resolution first, text second (spec 6.2).
//
// Typing "react" is not a request for documents containing the word react. It is
// a request for React -- so the term is resolved against the things this system
// knows by name (the closed vocabulary, the company registry, the source
// registry), and the answer opens with what that entity has been doing lately.
// Text matches come after, for the queries that are genuinely textual.
//
// Resolution order, most confident first:
//   1. exact slug or alias        react            -> React
//   2. exact name, case-folded    "Hugging Face"   -> Hugging Face
//   3. prefix                     kuber            -> Kubernetes
//   4. trigram similarity         kubernets        -> Kubernetes
//
// The text half is full text search, not substring matching. That distinction is
// most of what "the search is weak" meant: ILIKE '%rust async runtime%' requires
// those three words adjacent and in that order, so it found nothing, ranked
// nothing, and offered no reason why.

import { q } from './db.ts';
import {
  escapeHtml, wrap, pageHead, empty, relativeTime, sparkline, truncate, icon, table,
} from './html.ts';
import { crumbsFor } from './nav.ts';

export interface EntityHit {
  kind: 'stack' | 'company' | 'source' | 'platform';
  slug: string;
  name: string;
  detail: string;
  href: string;
  score: number;
}

/** Stop the fuzzy tier from answering with noise. Below this, say nothing. */
const SIMILARITY_FLOOR = 0.34;

async function resolveEntities(term: string): Promise<EntityHit[]> {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];

  const [stacks, companies, sources, platforms] = await Promise.all([
    q<{ slug: string; name: string; category: string; score: string }>(
      `SELECT s.slug, s.name, s.category,
              GREATEST(
                CASE WHEN lower(s.slug) = $1 OR lower(s.name) = $1 THEN 1.0
                     WHEN EXISTS (SELECT 1 FROM unnest(s.aliases) a WHERE lower(a) = $1) THEN 0.97
                     WHEN lower(s.slug) LIKE $1 || '%' OR lower(s.name) LIKE $1 || '%' THEN 0.8
                     ELSE 0 END,
                similarity(lower(s.name), $1) * 0.7,
                similarity(lower(s.slug), $1) * 0.7
              )::text AS score
         FROM stacks s
        WHERE lower(s.slug) = $1
           OR lower(s.name) = $1
           OR lower(s.slug) LIKE $1 || '%'
           OR lower(s.name) LIKE $1 || '%'
           OR EXISTS (SELECT 1 FROM unnest(s.aliases) a WHERE lower(a) = $1)
           OR similarity(lower(s.name), $1) > $2::real
        ORDER BY 4 DESC LIMIT 8`,
      [needle, SIMILARITY_FLOOR],
    ),

    // A company is a first-class answer: "Cloudflare" is more likely a request
    // for Cloudflare's page than for the word in a headline.
    q<{ slug: string; name: string; category: string; score: string }>(
      `SELECT c.slug, c.name, c.category,
              GREATEST(
                CASE WHEN lower(c.slug) = $1 OR lower(c.name) = $1 THEN 1.0
                     WHEN EXISTS (SELECT 1 FROM unnest(c.aliases) a WHERE lower(a) = $1) THEN 0.96
                     WHEN lower(c.name) LIKE $1 || '%' THEN 0.78
                     ELSE 0 END,
                similarity(lower(c.name), $1) * 0.7
              )::text AS score
         FROM companies c
        WHERE lower(c.slug) = $1
           OR lower(c.name) = $1
           OR lower(c.name) LIKE $1 || '%'
           OR EXISTS (SELECT 1 FROM unnest(c.aliases) a WHERE lower(a) = $1)
           OR similarity(lower(c.name), $1) > $2::real
        ORDER BY 4 DESC LIMIT 6`,
      [needle, SIMILARITY_FLOOR],
    ).catch(() => []),

    // And a source: "Hacker News" should get you the stream, not a lecture.
    q<{ name: string; score: string; n: string }>(
      `SELECT src.name,
              GREATEST(
                CASE WHEN lower(src.name) = $1 THEN 1.0
                     WHEN lower(src.name) LIKE $1 || '%' THEN 0.75 ELSE 0 END,
                similarity(lower(src.name), $1) * 0.65
              )::text AS score,
              count(s.id)::text AS n
         FROM sources src
         LEFT JOIN stories s ON s.source_id = src.id AND s.superseded_by IS NULL
        WHERE lower(src.name) = $1
           OR lower(src.name) LIKE $1 || '%'
           OR similarity(lower(src.name), $1) > $2::real
        GROUP BY src.name ORDER BY 2 DESC LIMIT 5`,
      [needle, SIMILARITY_FLOOR],
    ),

    // `tools` is a table from an earlier design and it has never had a row in
    // it: a tool is a `stacks` row with kind = 'tool', which is what /tools
    // renders and what the query above already searches. Asking the empty table
    // as well cost one round trip on every keystroke of every search.
    q<{ slug: string; name: string; url: string }>(
      `SELECT slug, name, url FROM platforms
        WHERE lower(slug) = $1 OR lower(name) = $1 OR lower(name) LIKE $1 || '%'
        LIMIT 5`, [needle]).catch(() => []),
  ]);

  return [
    ...stacks.map((s): EntityHit => ({
      kind: 'stack', slug: s.slug, name: s.name, detail: s.category,
      href: `/trend/${encodeURIComponent(s.slug)}`, score: Number(s.score),
    })),
    ...companies.map((c): EntityHit => ({
      kind: 'company', slug: c.slug, name: c.name, detail: c.category,
      href: `/company/${encodeURIComponent(c.slug)}`, score: Number(c.score),
    })),
    ...sources.map((s): EntityHit => ({
      kind: 'source', slug: s.name, name: s.name,
      detail: `${Number(s.n).toLocaleString('en-US')} stories`,
      href: `/all?source=${encodeURIComponent(s.name)}`, score: Number(s.score),
    })),
    // To the platform's own page. This pointed back at /search, which was true
    // when platforms had no page and became a loop the day they got one.
    ...platforms.map((p): EntityHit => ({
      kind: 'platform', slug: p.slug, name: p.name, detail: p.url,
      href: `/platform/${encodeURIComponent(p.slug)}`, score: 0.9,
    })),
  ].sort((a, b) => b.score - a.score);
}

// --- text ---------------------------------------------------------------------

interface TextHit {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source: string;
  collected: string;
  importance: number | null;
  coverage: number;
  stacks: string[];
  rank: number;
}

const DOC = `coalesce(s.title_en, s.title_original) || ' ' || coalesce(s.summary_en, '')`;

/**
 * Full text search, ranked, with a fuzzy fallback.
 *
 * websearch_to_tsquery is the parser people already know: quoted phrases work,
 * "or" works, a leading minus excludes. Ranking blends relevance with recency,
 * because in a news archive a perfect match from 2019 is usually not the answer
 * to a question asked today -- but it is still worth showing, so recency is a
 * multiplier and never a filter.
 */
export type MatchMode = 'all' | 'any' | 'literal';

/** Every word (the default), then any word, then the string as written. */
async function runQuery(term: string, limit: number, mode: 'all' | 'any'): Promise<TextHit[]> {
  // Widening is done on the PARSED query rather than by re-splitting the input,
  // so quoted phrases survive it: "breaking change" stays one phrase, and only
  // the joins between top-level terms become ORs.
  const tsq = mode === 'all'
    ? `websearch_to_tsquery('english', $1)`
    : `replace(websearch_to_tsquery('english', $1)::text, '&', '|')::tsquery`;

  return q<TextHit>(
    `WITH qy AS (SELECT ${tsq} AS tsq)
     SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title,
            s.summary_en AS summary, s.canonical_url AS url, src.name AS source,
            s.collected_at::text AS collected, s.importance,
            s.coverage_count AS coverage, s.stacks,
            (ts_rank_cd(to_tsvector('english', ${DOC}), qy.tsq)
              * (1 + 1.0 / (1 + EXTRACT(epoch FROM (now() - coalesce(s.published_at, s.collected_at)))
                                / 2592000.0)))::float AS rank
       FROM stories s JOIN sources src ON src.id = s.source_id, qy
      WHERE s.superseded_by IS NULL
        AND (s.lang = 'en' OR s.title_en IS NOT NULL)
        AND to_tsvector('english', ${DOC}) @@ qy.tsq
      ORDER BY rank DESC, coalesce(s.published_at, s.collected_at) DESC
      LIMIT ${limit}`,
    [term],
  );
}

async function countQuery(term: string, mode: 'all' | 'any'): Promise<number> {
  const tsq = mode === 'all'
    ? `websearch_to_tsquery('english', $1)`
    : `replace(websearch_to_tsquery('english', $1)::text, '&', '|')::tsquery`;
  const rows = await q<{ n: string }>(
    `WITH qy AS (SELECT ${tsq} AS tsq)
     SELECT count(*)::text AS n FROM stories s, qy
      WHERE s.superseded_by IS NULL
        AND (s.lang = 'en' OR s.title_en IS NOT NULL)
        AND to_tsvector('english',
              coalesce(s.title_en, s.title_original) || ' ' || coalesce(s.summary_en, '')) @@ qy.tsq`,
    [term],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Three tiers, widening only when the tighter one found nothing.
 *
 *   all      every word must appear      the default, and usually right
 *   any      at least one word           three words that never co-occur
 *   literal  the string as written       product names, versions, identifiers
 *
 * Widening is not silent: the page says which tier answered, because "12 results
 * for any of these words" and "12 results" mean very different things.
 */
async function searchText(
  term: string, limit: number,
): Promise<{ rows: TextHit[]; total: number; mode: MatchMode }> {
  const all = await runQuery(term, limit, 'all');
  if (all.length > 0) {
    return { rows: all, total: await countQuery(term, 'all'), mode: 'all' };
  }

  // More than one word, and no document has them all. Ask for any of them
  // rather than shrugging -- ts_rank still floats the documents with the most.
  if (/\s/.test(term.trim())) {
    const any = await runQuery(term, limit, 'any');
    if (any.length > 0) {
      return { rows: any, total: await countQuery(term, 'any'), mode: 'any' };
    }
  }

  // Nothing stems to a match. Try the query as a fragment of a title -- product
  // names, version strings and identifiers are exactly what English stemming
  // knows nothing about.
  const fuzzy = await q<TextHit>(
    `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title,
            s.summary_en AS summary, s.canonical_url AS url, src.name AS source,
            s.collected_at::text AS collected, s.importance,
            s.coverage_count AS coverage, s.stacks,
            similarity(coalesce(s.title_en, s.title_original), $1)::float AS rank
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE s.superseded_by IS NULL
        AND (s.lang = 'en' OR s.title_en IS NOT NULL)
        AND (coalesce(s.title_en, s.title_original) ILIKE '%' || $1 || '%'
             OR s.canonical_url ILIKE '%' || $1 || '%')
      ORDER BY rank DESC, coalesce(s.published_at, s.collected_at) DESC
      LIMIT ${limit}`,
    [term],
  );

  return { rows: fuzzy, total: fuzzy.length, mode: 'literal' };
}

/**
 * Highlight the query's words in a snippet.
 *
 * Done here rather than with ts_headline so that escaping happens FIRST and the
 * only markup in the output is the <mark> this function put there. A publisher's
 * headline is never trusted as HTML.
 */
function highlight(text: string, term: string): string {
  const escaped = escapeHtml(text);
  const words = [...new Set(
    term.toLowerCase().replace(/["'-]/g, ' ').split(/\s+/).filter((w) => w.length > 2),
  )];
  if (words.length === 0) return escaped;
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi');
  return escaped.replace(pattern, '<mark>$1</mark>');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- the page -----------------------------------------------------------------

export async function renderSearch(url: URL): Promise<string> {
  const term = url.searchParams.get('q')?.trim() ?? '';

  if (!term) return renderEmptyState();

  const [entities, text] = await Promise.all([
    resolveEntities(term),
    searchText(term, 25),
  ]);
  const best = entities[0];

  if (!best && text.rows.length === 0) return renderNothing(term);

  const entityBlock = best ? await renderEntity(best, entities) : '';

  const textList = text.rows.length === 0 ? '' : `
    <h2 class="sec">${best ? 'Mentions in text' : 'Text matches'}</h2>
    <p class="note">${
      text.mode === 'literal'
        ? `Nothing matched those words, so these are titles containing “${escapeHtml(term)}” as written.`
        : text.mode === 'any'
          ? `Nothing mentions all of those words. ${text.total.toLocaleString('en-US')}
             ${text.total === 1 ? 'story mentions' : 'stories mention'} at least one, most first.`
          : `${text.total.toLocaleString('en-US')} ${text.total === 1 ? 'story mentions' : 'stories mention'}
             “${escapeHtml(term)}”, best match first.`}
      <a href="/all?q=${encodeURIComponent(term)}" style="color:var(--link)">Open all in the reader →</a></p>
    ${text.rows.map((r) => storyLine(r, term)).join('')}`;

  return wrap(`
    ${pageHead(best ? best.name : `“${term}”`,
      best
        ? `${escapeHtml(best.kind)} · ${escapeHtml(best.detail)} · matched “${escapeHtml(term)}”`
        : `${text.total.toLocaleString('en-US')} stories mention this`,
      { crumbs: crumbsFor('/search', 'Search') })}
    ${entityBlock}
    ${textList}`);
}

async function renderEmptyState(): Promise<string> {
  const popular = await q<{ slug: string; name: string; n: string }>(
    `SELECT st.slug, st.name, count(s.id)::text AS n
       FROM stacks st JOIN stories s ON s.stacks && ARRAY[st.slug] AND s.superseded_by IS NULL
      GROUP BY st.slug, st.name ORDER BY count(s.id) DESC LIMIT 24`);

  return wrap(`
    ${pageHead('Search',
      'A technology, a company, a source, or just words. Naming something the system knows opens ' +
      'with what it has been doing lately; anything else is searched as text.',
      { crumbs: crumbsFor('/search', 'Search') })}

    <p class="notice">${icon('search', 15)}<span><strong>Phrases work.</strong>
      <code>"breaking change"</code> matches the phrase, <code>rust or zig</code> matches either,
      and <code>kubernetes -helm</code> excludes the second word.</span></p>

    <h2 class="sec">Most active right now</h2>
    <div class="pills">${popular.map((p) =>
      `<a class="pill" href="/search?q=${encodeURIComponent(p.slug)}">${escapeHtml(p.name)}
        <b>${Number(p.n).toLocaleString('en-US')}</b></a>`).join('')}</div>`);
}

/**
 * Nothing matched.
 *
 * The old version of this page always offered eight "did you mean" chips, taken
 * from a similarity sort with no floor -- so searching for GoHighLevel suggested
 * Go, Godot and Laravel, twice over. A suggestion nobody meant is worse than no
 * suggestion: it implies the system understood, and it did not.
 */
async function renderNothing(term: string): Promise<string> {
  const needle = term.toLowerCase();
  const suggestions = await q<{ name: string; slug: string; kind: string; score: string }>(
    `SELECT name, slug, 'stack' AS kind, similarity(lower(name), $1)::text AS score
       FROM stacks WHERE similarity(lower(name), $1) > $2::real
     UNION ALL
     SELECT name, slug, 'company' AS kind, similarity(lower(name), $1)::text AS score
       FROM companies WHERE similarity(lower(name), $1) > $2::real
     ORDER BY 4 DESC LIMIT 6`,
    [needle, SIMILARITY_FLOOR],
  ).catch(() => []);

  // De-duplicate by display name: two stacks can share a name and differ only by
  // slug, and offering the same word twice reads as a bug because it is one.
  const seen = new Set<string>();
  const unique = suggestions.filter((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return wrap(`
    ${pageHead(`“${term}”`, 'Nothing in the archive mentions this, and it is not in the vocabulary.',
      { crumbs: crumbsFor('/search', 'Search') })}

    ${empty('No stories, no technology, no company, no source.', 'search')}

    ${unique.length ? `<h2 class="sec">Did you mean</h2>
      <div class="pills">${unique.map((s) =>
        `<a class="pill" href="/search?q=${encodeURIComponent(s.slug)}">${escapeHtml(s.name)}
          <b>${escapeHtml(s.kind)}</b></a>`).join('')}</div>` : ''}

    <h2 class="sec">Why this can happen</h2>
    <ul class="reasons">
      <li><strong>It is genuinely absent.</strong> The archive holds what the seeded sources
        published — a product no tracked outlet has written about will not be here.</li>
      <li><strong>It is not in the taxonomy.</strong> The vocabulary is closed by design, so a
        technology nobody added is never tagged, however often it is mentioned.
        <a href="/technologies">Browse what is tracked →</a></li>
      <li><strong>The words differ.</strong> Search stems English, so <em>vacuuming</em> finds
        <em>vacuum</em> — but it cannot guess a product name it has never seen.</li>
    </ul>`);
}

/** The entity answer: what has this technology been doing, right now. */
async function renderEntity(best: EntityHit, all: EntityHit[]): Promise<string> {
  const others = all.slice(1, 7);
  const otherChips = others.length
    ? `<p class="note">Also matched: ${others.map((e) =>
        `<a class="chip" href="${escapeHtml(e.href)}">${escapeHtml(e.name)}
          <span class="chip-n">${escapeHtml(e.kind)}</span></a>`).join(' ')}</p>`
    : '';

  if (best.kind === 'company') {
    return `<p class="row" style="--row-gap:8px">
        <a class="btn primary" href="${escapeHtml(best.href)}">Open ${escapeHtml(best.name)}</a>
        <a class="btn" href="${escapeHtml(best.href)}?view=announcements">Announcements only</a>
      </p>
      <div class="notice">${icon('gem', 14)}<span><strong>${escapeHtml(best.name)}</strong>
        is a company. Its page keeps what it announced apart from what was written about it —
        the two answer different questions.</span></div>${otherChips}`;
  }

  if (best.kind === 'source') {
    return `<p class="row" style="--row-gap:8px">
        <a class="btn primary" href="${escapeHtml(best.href)}">Read ${escapeHtml(best.name)}</a>
        <a class="btn" href="/sources?sq=${encodeURIComponent(best.name)}">Source health</a>
      </p>${otherChips}`;
  }

  if (best.kind !== 'stack') {
    // A company or a platform: both have a page of their own. This used to
    // announce that "story-level indexing arrives with Phase 7" and offer
    // nothing -- a promise where a link belonged.
    return `<p class="row" style="--row-gap:8px">
        <a class="btn primary" href="${escapeHtml(best.href)}">Open ${escapeHtml(best.name)}</a>
      </p>${otherChips}`;
  }

  const [totals, recent, weekly, related] = await Promise.all([
    q<{ total: string; week: string; day: string; peak: string | null; outlets: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE coalesce(published_at, collected_at) > now() - interval '7 days')::text AS week,
              count(*) FILTER (WHERE coalesce(published_at, collected_at) > now() - interval '24 hours')::text AS day,
              max(importance)::text AS peak,
              coalesce(max(coverage_count),0)::text AS outlets
         FROM stories
        WHERE superseded_by IS NULL AND stacks && stack_expand(ARRAY[$1]::text[])`, [best.slug]),
    q<TextHit>(
      `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title, s.summary_en AS summary,
              s.canonical_url AS url, src.name AS source, s.collected_at::text AS collected,
              s.importance, s.coverage_count AS coverage, s.stacks, 0::float AS rank
         FROM stories s JOIN sources src ON src.id = s.source_id
        WHERE s.superseded_by IS NULL AND s.stacks && stack_expand(ARRAY[$1]::text[])
        ORDER BY coalesce(s.published_at, s.collected_at) DESC LIMIT 12`, [best.slug]),
    q<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM generate_series(date_trunc('week', now()) - interval '11 weeks',
                              date_trunc('week', now()), interval '1 week') AS wk
         LEFT JOIN stories s
           ON date_trunc('week', coalesce(s.published_at, s.collected_at)) = wk
          AND s.superseded_by IS NULL
          AND s.stacks && stack_expand(ARRAY[$1]::text[])
        GROUP BY wk ORDER BY wk`, [best.slug]),
    q<{ slug: string; n: string }>(
      `SELECT other AS slug, count(*)::text AS n
         FROM stories s, LATERAL unnest(s.stacks) AS other
        WHERE s.superseded_by IS NULL AND s.stacks && ARRAY[$1] AND other <> $1
        GROUP BY other ORDER BY count(*) DESC LIMIT 8`, [best.slug]),
  ]);

  const t = totals[0];
  const series = weekly.map((w) => Number(w.n));
  const found = Number(t?.total ?? 0);

  const header = `<div class="cards">
      <div class="card"><h3>Stories</h3><div class="stat">${found.toLocaleString('en-US')}
        <small>incl. everything beneath</small></div></div>
      <div class="card"><h3>Last 24 hours</h3><div class="stat">${Number(t?.day ?? 0)}</div></div>
      <div class="card"><h3>Last 7 days</h3><div class="stat">${Number(t?.week ?? 0)}</div></div>
      <div class="card"><h3>Peak importance</h3><div class="stat">${t?.peak ?? '—'} <small>of 10</small></div></div>
      <div class="card"><h3>12-week trend</h3>${
        series.some((n) => n > 0) ? sparkline(series, { width: 130, height: 30 })
          : '<span class="muted">no activity</span>'}</div>
    </div>
    <p class="row" style="--row-gap:8px">
      <a class="btn primary" href="/all?stack=${encodeURIComponent(best.slug)}">Open in reader</a>
      <a class="btn" href="/trend/${encodeURIComponent(best.slug)}">Full trend page</a>
      ${related.length ? `<span class="muted" style="margin-left:6px">appears with</span> ${
        related.map((r) => `<a class="chip" href="/search?q=${encodeURIComponent(r.slug)}">${
          escapeHtml(r.slug)}</a>`).join(' ')}` : ''}
    </p>
    ${otherChips}`;

  if (found === 0) {
    return `${header}<div class="notice">${icon('alert', 14)}
      <span><strong>${escapeHtml(best.name)}</strong> is in the taxonomy but nothing has been tagged with it
      yet — either nothing has been published about it since collection started, or those stories are still
      waiting on classification.</span></div>`;
  }

  return `${header}
    <h2 class="sec">Most recent</h2>
    ${recent.map((r) => storyLine(r, '')).join('')}`;
}

function storyLine(r: TextHit, term: string): string {
  const critical = (r.importance ?? 0) >= 8;
  const title = term ? highlight(truncate(r.title, 150), term) : escapeHtml(truncate(r.title, 150));
  const snippet = term && r.summary ? highlight(truncate(r.summary, 210), term) : '';

  return `<article class="item${critical ? ' crit' : ''}">
    <div>
      <h2><a href="/story/${escapeHtml(r.id)}">${title}</a></h2>
      ${snippet ? `<p class="sum">${snippet}</p>` : ''}
      <div class="meta">
        <span class="src">${escapeHtml(r.source)}</span>
        <span class="dot"></span>
        <span>${escapeHtml(relativeTime(r.collected))}</span>
        <span class="dot"></span>
        <span>${r.coverage} ${r.coverage === 1 ? 'outlet' : 'outlets'}</span>
        ${r.stacks.slice(0, 3).map((s) =>
          `<a class="chip" href="/search?q=${encodeURIComponent(s)}">${escapeHtml(s)}</a>`).join(' ')}
        <a class="readbtn" href="/read/${escapeHtml(r.id)}" data-url="${escapeHtml(r.url)}"
          title="read the article here">${icon('book', 12)}read</a>
      </div>
    </div>
    <div class="side"><span class="sev${critical ? ' hi' : ''}">${r.importance ?? '–'}</span></div>
  </article>`;
}

export interface Suggestion {
  label: string;
  kind: string;
  href: string;
  count?: string;
}

/**
 * Header autocomplete, answered per keystroke.
 *
 * This used to be a <datalist> of every slug in the vocabulary, inlined into
 * every page: 230 options, and the browser decides how tall that popup is. It
 * worked until the vocabulary started growing, and then it covered the screen.
 * Eight results, ranked, is a different thing entirely -- and it stays eight
 * however many thousand entries the taxonomy ends up with.
 */
export async function suggest(term: string): Promise<Suggestion[]> {
  const needle = term.trim().toLowerCase();
  if (needle.length < 2) return [];
  const prefix = `${needle}%`;
  const contains = `%${needle}%`;

  const [stacks, companies, sources] = await Promise.all([
    q<{ slug: string; name: string; n: string; rank: string }>(
      `SELECT st.slug, st.name, coalesce(agg.n, 0)::text AS n,
              (CASE WHEN lower(st.slug) = $1 OR lower(st.name) = $1 THEN 0
                    WHEN lower(st.slug) LIKE $2 OR lower(st.name) LIKE $2 THEN 1
                    WHEN EXISTS (SELECT 1 FROM unnest(st.aliases) a WHERE lower(a) LIKE $2) THEN 2
                    ELSE 3 END)::text AS rank
         FROM stacks st
         LEFT JOIN LATERAL (
           SELECT count(*) AS n FROM stories s
            WHERE s.superseded_by IS NULL AND s.stacks && ARRAY[st.slug]
         ) agg ON true
        WHERE lower(st.slug) LIKE $3 OR lower(st.name) LIKE $3
           OR EXISTS (SELECT 1 FROM unnest(st.aliases) a WHERE lower(a) LIKE $3)
        ORDER BY 4, coalesce(agg.n, 0) DESC, st.name
        LIMIT 6`,
      [needle, prefix, contains]),

    q<{ slug: string; name: string }>(
      `SELECT slug, name FROM companies
        WHERE lower(name) LIKE $1
           OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE lower(a) LIKE $1)
        ORDER BY length(name) LIMIT 3`, [contains]).catch(() => []),

    q<{ name: string }>(
      `SELECT name FROM sources WHERE lower(name) LIKE $1 ORDER BY length(name) LIMIT 2`,
      [contains]),
  ]);

  const out: Suggestion[] = [
    ...stacks.map((s): Suggestion => ({
      label: s.name,
      kind: 'technology',
      href: `/search?q=${encodeURIComponent(s.slug)}`,
      count: Number(s.n) > 0 ? Number(s.n).toLocaleString('en-US') : undefined,
    })),
    ...companies.map((c): Suggestion => ({
      label: c.name, kind: 'company', href: `/company/${encodeURIComponent(c.slug)}`,
    })),
    ...sources.map((s): Suggestion => ({
      label: s.name, kind: 'source', href: `/all?source=${encodeURIComponent(s.name)}`,
    })),
  ];

  // Whatever was typed is always an option: the vocabulary is not the only thing
  // worth searching, and a term with no entity still has text matches.
  out.push({ label: `Search “${term}” everywhere`, kind: 'text', href: `/search?q=${encodeURIComponent(term)}` });
  return out.slice(0, 9);
}

export { table };

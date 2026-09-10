// Research beyond the archive, so a reading is not capped by what we caught.
//
// Asked for on 2026-09-09: "I want to you research all news that related to the
// target news when you generate report, This mans when you make report, don't
// be limited to db's past news, I want to know trend of the tech, not summary
// of the news."
//
// THE PROBLEM THIS SOLVES IS STRUCTURAL, not a matter of prompt wording. The
// pairing rule in strategy.ts discards any claim about change whose earlier end
// it cannot cite. That rule is right -- it is the only thing separating a
// finding from a restatement -- and it silently caps every reading at the depth
// of our own collection. This archive started collecting on 2026-09-08. Asked
// how a field has changed since March, it could answer only from whatever
// March-dated items happened to be sitting in a feed's back catalogue.
//
// So the earlier end can now come from outside, in two forms:
//
//   ADOPTION SERIES  daily downloads from the registry that publishes the
//                    package. A real magnitude, measured by somebody else,
//                    reaching back as far as the registry keeps it.
//   OUTSIDE COVERAGE stories about our subjects that we never collected, from
//                    Hacker News's public index, with their dates and links.
//
// WHY THIS IS NOT "counting our own stories" WEARING A DISGUISE. That rule
// exists because an archive count answers "how many of these did WE catch",
// which measures a feed list. Everything here is published by somebody else
// under its own name and is true whether or not this repository runs -- and it
// is MORE checkable than our own corpus, because anybody can re-run the same
// query against the same public API and get the same answer. It is the argument
// public.ts already makes for GitHub topic counts, extended from a census to a
// series, because a snapshot cannot express a trend and a trend is the ask.
//
// EVERY REGISTRY HERE IS KEYLESS. Verified 2026-09-09: api.npmjs.org,
// pypistats.org, crates.io and hn.algolia.com all answered 200 with no
// credential. That matters because the archive must run unattended, and a key
// is a thing that expires while nobody is looking.

import type { Db } from '../db/client.ts';
import { NOT_A_PRODUCT } from '../vocab/emerging.ts';

/** How far back to ask a registry for a curve. Matches LOOKBACK_DAYS. */
export const OUTSIDE_DAYS = 180;

/** The window at each end that a movement is measured over. */
export const EDGE_DAYS = 28;

const UA = 'NewsTrack/1.0 (technology archive; +https://github.com/Midas20)';

async function getJson<T>(url: string, timeoutMs = 20_000): Promise<T | null> {
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    return await r.json() as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Which package a technology is, if it is one
// ---------------------------------------------------------------------------

export type Registry = 'npm' | 'pypi' | 'crates';

/**
 * github.com/owner/name, lowercased, out of whatever shape a registry uses.
 *
 * Returns null for anything that is not a GitHub repository, which makes a
 * non-match rather than a false match -- the safe direction.
 */
export function repoKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /github\.com[/:]+([^/\s]+)\/([^/\s#?]+)/i.exec(String(raw));
  if (!m) return null;
  return `${m[1]!.toLowerCase()}/${m[2]!.replace(/\.git$/i, '').toLowerCase()}`;
}

/** The repository a registry says a package comes from. */
async function declaredRepo(registry: Registry, pkg: string): Promise<string | null> {
  const name = encodeURIComponent(pkg);
  if (registry === 'npm') {
    const j = await getJson<{ repository?: { url?: string } | string }>(
      `https://registry.npmjs.org/${name}`);
    const r = typeof j?.repository === 'string' ? j.repository : j?.repository?.url;
    return repoKey(r);
  }
  if (registry === 'pypi') {
    const j = await getJson<{ info?: { project_urls?: Record<string, string>;
      home_page?: string } }>(`https://pypi.org/pypi/${name}/json`);
    const urls = Object.values(j?.info?.project_urls ?? {});
    for (const u of [...urls, j?.info?.home_page]) {
      const k = repoKey(u);
      if (k) return k;
    }
    return null;
  }
  const j = await getJson<{ crate?: { repository?: string } }>(
    `https://crates.io/api/v1/crates/${name}`);
  return repoKey(j?.crate?.repository);
}

/**
 * Find the package a slug names -- and PROVE it is the same project.
 *
 * THE FIRST VERSION OF THIS GUESSED, and the guess was that a technology's slug
 * is its package name on the first registry that answers. Measured on
 * 2026-09-09, before this was ever wired into a report:
 *
 *   kubernetes  npm:kubernetes  29/day -> 158/day   +441%
 *   polars      npm:polars       4/day ->   2/day    -52%
 *
 * Neither is the technology. `npm:kubernetes` is an abandoned client with a
 * hundred installs a day, and `npm:polars` declares github.com/ritchie46/polars
 * while the project lives at github.com/pola-rs/polars and ships through PyPI
 * and crates.io with a volume four orders of magnitude larger. A report saying
 * "Kubernetes adoption rose 441%" on that basis is exactly the confident,
 * checkable-looking, wrong finding this archive exists to refuse -- and it would
 * have been the only number on the page a reader could not check against a
 * story, because it came with no story.
 *
 * So a package is accepted only when the registry's own declared repository
 * matches the repository the taxonomy holds for that technology. The name is
 * not the evidence; the repository is.
 *
 * A technology with no repo_url in the taxonomy gets NO CURVE, and a
 * technology that is not distributed through a package registry at all --
 * Kubernetes, which is the correct answer for it -- gets no curve either. Both
 * are recorded as misses so the lookup is not repeated.
 */
/**
 * Drop a technology's cached curve when its resolution is withdrawn.
 *
 * A REFUSAL MUST REACH THE DATA THAT WAS PUBLISHED UNDER IT. `adoption_lookup`
 * caches the answer, so once a slug resolves the series is fetched daily and
 * kept for ever -- and tightening the guard afterwards only stops NEW rows.
 * Measured on 2026-09-09: `jinja` had been resolved to pypi:django before the
 * "the repo must mention the slug" rule existed, and 181 days of django's
 * downloads were still sitting in `adoption_series` under the name `jinja`,
 * ready for the first period report to put on a page.
 *
 * So withdrawing a resolution deletes the curve with it. That is the whole
 * correction: a wrong number is worse than no number, because it is the only
 * thing on the page a reader cannot check against a story.
 */
async function forgetSeries(db: Db, slug: string): Promise<void> {
  await db.query(`DELETE FROM adoption_series WHERE slug = $1`, [slug])
    .catch(() => undefined);
}

export async function resolvePackage(
  db: Db, slug: string,
): Promise<{ registry: Registry; package: string } | null> {
  const [known] = await db.query<{ registry: string | null; package: string | null; missing: boolean }>(
    `SELECT registry, package, missing FROM adoption_lookup WHERE slug = $1`, [slug]);
  if (known) {
    if (known.missing || !known.registry || !known.package) return null;
    return { registry: known.registry as Registry, package: known.package };
  }

  const [stack] = await db.query<{ repo_url: string | null }>(
    `SELECT repo_url FROM stacks WHERE slug = $1`, [slug]);
  const want = repoKey(stack?.repo_url);
  if (!want) {
    await db.query(
      `INSERT INTO adoption_lookup (slug, missing, note) VALUES ($1, true, $2)
       ON CONFLICT (slug) DO UPDATE SET missing = true, checked_at = now(),
         note = EXCLUDED.note`,
      [slug, 'no GitHub repo in the taxonomy, so no package can be verified']);
    await forgetSeries(db, slug);
    return null;
  }

  // TWO CANDIDATE NAMES, and trying more than one is only safe because every
  // one of them is verified against the same repository afterwards.
  //
  // The slug is the obvious guess and it is often wrong in a specific way: a
  // project is known by its organisation and ships under its artefact's name.
  // `huggingface` is `huggingface/transformers` and ships as `transformers`;
  // `llvm` is `llvm/llvm-project`. So the repository's own name is the second
  // candidate. Without verification this would be reckless -- `transformers` is
  // a plausible package name for several unrelated things -- and with it, a
  // wrong guess simply fails to match and costs one request.
  const candidates = [...new Set([slug.toLowerCase(), want.split('/')[1]!])];

  // AND THE TAXONOMY ITSELF HAS TO BE CHECKED, because verifying against it
  // makes it the single point of failure. Found on 2026-09-09, one step after
  // the npm-squatter problem was fixed: `stacks.jinja.repo_url` is
  // github.com/django/django, so `jinja` verified cleanly against pypi:django
  // and the report would have carried a row reading "jinja (pypi:django)
  // 1,545,935/day". Correct by construction and wrong about the world -- which
  // is the same failure as before wearing the previous fix as a disguise.
  //
  // The guard: the slug has to appear somewhere in the repository it claims.
  // pola-rs/polars, huggingface/transformers, langchain-ai/langchain and
  // pypa/pip all pass. django/django does not contain "jinja" and is refused,
  // and the refusal note names the taxonomy row so the data can be corrected
  // rather than the number being quietly published.
  const flat = (x: string) => x.replace(/[^a-z0-9]/g, '');
  if (!flat(want).includes(flat(slug.toLowerCase()))) {
    await db.query(
      `INSERT INTO adoption_lookup (slug, missing, note) VALUES ($1, true, $2)
       ON CONFLICT (slug) DO UPDATE SET missing = true, checked_at = now(),
         note = EXCLUDED.note`,
      [slug, `taxonomy repo ${want} does not mention "${slug}"; refusing rather `
        + 'than publishing a curve for another project under this name']);
    await forgetSeries(db, slug);
    return null;
  }

  for (const registry of ['npm', 'pypi', 'crates'] as const) {
    for (const candidate of candidates) {
      const got = await declaredRepo(registry, candidate);
      if (got && got === want) {
        await db.query(
          `INSERT INTO adoption_lookup (slug, registry, package, missing, note)
           VALUES ($1, $2, $3, false, $4)
           ON CONFLICT (slug) DO UPDATE SET registry = EXCLUDED.registry,
             package = EXCLUDED.package, missing = false, checked_at = now(),
             note = EXCLUDED.note`,
          [slug, registry, candidate, `verified against ${want}`]);
        return { registry, package: candidate };
      }
    }
  }

  await db.query(
    `INSERT INTO adoption_lookup (slug, missing, note) VALUES ($1, true, $2)
     ON CONFLICT (slug) DO UPDATE SET missing = true, checked_at = now(),
       note = EXCLUDED.note`,
    [slug, `no npm, pypi or crates package declares ${want}`]);
  return null;
}

// ---------------------------------------------------------------------------
// The curve
// ---------------------------------------------------------------------------

interface Point { day: string; downloads: number }

/** Daily downloads, from the registry, for as much of the window as it keeps. */
export async function fetchSeries(
  registry: Registry, pkg: string, from: string, to: string,
): Promise<Point[]> {
  if (registry === 'npm') {
    const got = await getJson<{ downloads?: { day: string; downloads: number }[] }>(
      `https://api.npmjs.org/downloads/range/${from}:${to}/${encodeURIComponent(pkg)}`);
    return (got?.downloads ?? []).map((d) => ({ day: d.day, downloads: d.downloads }));
  }
  if (registry === 'pypi') {
    const got = await getJson<{ data?: { category: string; date: string; downloads: number }[] }>(
      `https://pypistats.org/api/packages/${encodeURIComponent(pkg)}/overall`);
    // `with_mirrors` counts CI mirrors pulling the whole index, which moves
    // with infrastructure rather than with adoption.
    return (got?.data ?? [])
      .filter((d) => d.category === 'without_mirrors' && d.date >= from && d.date <= to)
      .map((d) => ({ day: d.date, downloads: d.downloads }));
  }
  return [];
}

/** Store a curve. Idempotent, so a re-run repairs a partial fetch. */
export async function saveSeries(
  db: Db, registry: Registry, pkg: string, slug: string, points: Point[],
): Promise<number> {
  if (points.length === 0) return 0;
  await db.query(
    `INSERT INTO adoption_series (registry, package, day, downloads, slug)
     SELECT $1, $2, d.day::date, d.n::bigint, $3
       FROM unnest($4::text[], $5::bigint[]) AS d(day, n)
     ON CONFLICT (registry, package, day)
       DO UPDATE SET downloads = EXCLUDED.downloads, fetched_at = now()`,
    [registry, pkg, slug, points.map((p) => p.day), points.map((p) => p.downloads)]);
  return points.length;
}

export interface Movement {
  slug: string;
  registry: Registry;
  package: string;
  /** Mean daily downloads over the first EDGE_DAYS of the window. */
  before: number;
  after: number;
  /** Whole percent. Positive is growth. */
  changePct: number;
  fromDay: string;
  toDay: string;
  days: number;
}

/**
 * What the curve did between its two ends.
 *
 * A MEAN OVER EACH EDGE, not first day against last day. Package downloads are
 * violently weekly -- a Sunday is a third of a Tuesday -- so two single days
 * can differ by 200% while nothing has happened. Twenty-eight days is four
 * whole weeks at each end, which cancels it.
 *
 * Returns null rather than a number when either edge is thin. A percentage
 * computed from four days is a number with no meaning, and printing one would
 * be worse than printing nothing.
 */
export function movement(
  slug: string, registry: Registry, pkg: string, points: Point[],
): Movement | null {
  if (points.length < EDGE_DAYS * 2) return null;
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));
  const head = sorted.slice(0, EDGE_DAYS);
  const tail = sorted.slice(-EDGE_DAYS);
  const mean = (xs: Point[]) => xs.reduce((n, p) => n + p.downloads, 0) / xs.length;
  const before = mean(head);
  const after = mean(tail);
  if (before <= 0) return null;
  return {
    slug, registry, package: pkg,
    before: Math.round(before),
    after: Math.round(after),
    changePct: Math.round(((after - before) / before) * 100),
    fromDay: head[0]!.day,
    toDay: tail[tail.length - 1]!.day,
    days: sorted.length,
  };
}

// ---------------------------------------------------------------------------
// Coverage we never collected
// ---------------------------------------------------------------------------

export interface OutsideStory {
  subject: string;
  title: string;
  url: string | null;
  host: string | null;
  when: string;
  score: number | null;
  source: string;
}

/**
 * Stories about a subject that this archive does not hold.
 *
 * Hacker News's public index, searched by date over the window. Chosen because
 * it is keyless, it is dated, it spans years, and its index is not our feed
 * list -- which is the entire point. Its `points` are carried through as a
 * `score` and are never added to anything of ours; they measure attention on
 * one site and say so.
 *
 * DEDUPLICATED AGAINST OUR OWN ARCHIVE BY URL before being returned, because an
 * item we already hold is not outside evidence and offering it as a second,
 * independent sighting of the same thing would be the worst error this module
 * could make.
 */
export async function outsideCoverage(
  db: Db, subject: string, from: string, to: string, limit = 8,
): Promise<OutsideStory[]> {
  const after = Math.floor(Date.parse(from) / 1000);
  const before = Math.floor(Date.parse(to) / 1000);
  const url = 'https://hn.algolia.com/api/v1/search'
    + `?query=${encodeURIComponent(subject)}&tags=story`
    + `&numericFilters=created_at_i>${after},created_at_i<${before},points>10`
    + `&hitsPerPage=${limit * 3}`;

  const got = await getJson<{ hits?: {
    objectID: string; title: string | null; url: string | null;
    created_at: string; points: number | null;
  }[] }>(url);
  if (!got?.hits?.length) return [];

  const hits = got.hits.filter((h) => h.title && h.url);
  if (hits.length === 0) return [];

  // Anything we already hold is not outside evidence.
  const ours = await db.query<{ canonical_url: string }>(
    `SELECT canonical_url FROM stories WHERE canonical_url = ANY($1::text[])`,
    [hits.map((h) => h.url!)]);
  const held = new Set(ours.map((r) => r.canonical_url));

  const fresh = hits.filter((h) => !held.has(h.url!)).slice(0, limit);
  if (fresh.length === 0) return [];

  await db.query(
    `INSERT INTO outside_coverage
       (subject, source, external_id, title, url, host, published_at, score)
     SELECT $1, 'hn', d.id, d.title, d.url, d.host, d.at::timestamptz, d.score::int
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[])
            AS d(id, title, url, host, at, score)
     ON CONFLICT (source, external_id) DO NOTHING`,
    [subject,
      fresh.map((h) => h.objectID),
      fresh.map((h) => h.title!),
      fresh.map((h) => h.url!),
      fresh.map((h) => hostOf(h.url!)),
      fresh.map((h) => h.created_at),
      fresh.map((h) => h.points ?? 0)]);

  return fresh.map((h) => ({
    subject, title: h.title!, url: h.url, host: hostOf(h.url!),
    when: h.created_at.slice(0, 10), score: h.points ?? null, source: 'Hacker News',
  }));
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

// ---------------------------------------------------------------------------
// The packet
// ---------------------------------------------------------------------------

export interface Outside {
  movements: Movement[];
  stories: OutsideStory[];
}

/**
 * Gather outside evidence for one field's subjects.
 *
 * Bounded on purpose. `subjectCap` limits how many technologies are researched
 * per field, because this is network work on the critical path of a scheduled
 * job and an unbounded version would make the report's runtime a function of
 * how broad the day's news happened to be.
 */
export async function gatherOutside(
  db: Db, subjects: string[], from: string, to: string,
  subjectCap = 6, storiesPerSubject = 4,
  /** URLs an earlier field in this run already used. See `analyseField`. */
  seen: Set<string> | null = null,
  /** The field being researched, so its own category tag can be dropped. */
  field: string | null = null,
): Promise<Outside> {
  // TWO DIFFERENT SELECTIONS, because the two kinds of evidence want different
  // subjects and using one list for both wasted every curve.
  //
  // Measured 2026-09-09 on the first run: 0 curves across all four fields. The
  // subjects that lead a day's corpus are broad category tags -- `ai`,
  // `google`, `open-source`, `startups` -- and a category is not a package, so
  // every lookup correctly refused and the adoption block was empty on a day
  // when polars, langchain and fastapi all had six months of curve available.
  //
  // A curve needs a NAMED PROJECT WITH A REPOSITORY, which the taxonomy already
  // records, so the curve list is filtered to subjects that have one. Coverage
  // search wants the opposite: a broad term returns what was being discussed,
  // and `open-source` is a perfectly good search where it is a useless package.
  const withRepos = await db.query<{ slug: string }>(
    `SELECT slug FROM stacks
      WHERE slug = ANY($1::text[]) AND repo_url IS NOT NULL
        AND repo_url ILIKE '%github.com%'`,
    [subjects]);
  const repoOrder = new Set(withRepos.map((r) => r.slug));
  const forCurves = subjects.filter((x) => repoOrder.has(x)).slice(0, subjectCap);

  // A CATEGORY IS NOT A SEARCH TERM EITHER, and this is the second half of the
  // same mistake the curve list made. Searching Hacker News for `cloud` or
  // `data` returns whatever Hacker News was discussing, which is the same
  // result whichever field asked -- so the field's own slug and the generic
  // words in NOT_A_PRODUCT come out of the search list. What is left is the
  // named things: `aws`, `gcp`, `openai`, `postgres`.
  const generic = new Set<string>([...NOT_A_PRODUCT, ...(field ? [field] : [])]);
  const forSearch = subjects.filter((x) => !generic.has(x)).slice(0, subjectCap);

  const movements: Movement[] = [];
  const stories: OutsideStory[] = [];

  for (const slug of forCurves) {
    const pkg = await resolvePackage(db, slug);
    if (pkg) {
      const points = await fetchSeries(pkg.registry, pkg.package, from.slice(0, 10), to.slice(0, 10));
      if (points.length > 0) {
        await saveSeries(db, pkg.registry, pkg.package, slug, points);
        const m = movement(slug, pkg.registry, pkg.package, points);
        if (m) movements.push(m);
      }
    }
  }

  for (const slug of forSearch) {
    for (const s of await outsideCoverage(db, slug, from, to, storiesPerSubject)) {
      // FIRST FIELD TO WANT A STORY KEEPS IT. Without this, four fields that
      // share a search term paste the same four headlines into four reports and
      // the site reads as though it wrote one thing four times.
      // A story with no URL cannot be deduplicated and is kept: dropping it
      // would lose evidence to protect against a repeat that cannot be detected.
      if (s.url) {
        if (seen?.has(s.url)) continue;
        seen?.add(s.url);
      }
      stories.push(s);
    }
  }

  // Oldest first, matching the history packet, so the numbering runs forwards
  // through time in both blocks and a citation to O2 against O30 is visibly a
  // claim about a span.
  stories.sort((a, b) => a.when.localeCompare(b.when));
  return { movements, stories };
}

const NL = String.fromCharCode(10);

/**
 * The outside-evidence block of the prompt.
 *
 * Numbered in its own O series, for the same reason the history uses P: a
 * citation that could mean either set proves nothing.
 */
export function outsidePacket(o: Outside): string {
  if (o.movements.length === 0 && o.stories.length === 0) {
    return 'OUTSIDE EVIDENCE: none could be gathered for these subjects. Do not '
      + 'treat that as evidence of anything; say so in `limits`.';
  }

  const parts: string[] = [
    'OUTSIDE EVIDENCE. None of this came from this archive. It was measured or '
    + 'indexed by somebody else, it is public, and anybody can re-run the same '
    + 'query and get the same answer. You MAY quote these numbers, naming the '
    + 'registry and the dates, and you may use them as the EARLIER END of a '
    + 'claim about change when the archive holds nothing that old.',
  ];

  if (o.movements.length > 0) {
    parts.push('', 'ADOPTION, from the package registries. Mean downloads per day '
      + `over the first ${EDGE_DAYS} days of the window against the last ${EDGE_DAYS}:`);
    for (const m of o.movements) {
      const dir = m.changePct >= 0 ? '+' : '';
      parts.push(`  ${m.slug} (${m.registry}:${m.package}) `
        + `${m.before.toLocaleString('en-US')}/day on ${m.fromDay} -> `
        + `${m.after.toLocaleString('en-US')}/day on ${m.toDay}  ${dir}${m.changePct}% `
        + `over ${m.days} days of data`);
    }
    parts.push('These are DOWNLOADS. They measure installs, including continuous '
      + 'integration, and they are not users. A rise is real and its cause is not '
      + 'given; say which you mean.');
  }

  if (o.stories.length > 0) {
    parts.push('', 'COVERAGE THIS ARCHIVE DOES NOT HOLD, from the Hacker News index, '
      + 'oldest first. Cite these as O1, O2, ... :');
    o.stories.forEach((s, i) => {
      parts.push(`O${i + 1}. [${s.when}] ${s.title}`
        + `${NL}    ${s.host ?? 'unknown host'}`
        + `${s.score != null ? ` · ${s.score} points on Hacker News` : ''}`);
    });
    parts.push('You have the HEADLINE AND THE DATE for these and not the body. '
      + 'Use them for what was being discussed and when, never for what an '
      + 'article said. Points measure attention on one site on one day.');
  }

  return parts.join(NL);
}

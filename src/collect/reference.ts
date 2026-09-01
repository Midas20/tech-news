// What a technology IS, from Wikidata and Wikipedia.
//
// A technology page could say how often the thing had been in the news and how
// many projects carry its topic, and nothing about the thing itself. This fills
// that in: the background paragraph, who makes it, when it appeared, what
// licence it carries, what it is written in.
//
// NOT WRITTEN BY A MODEL, DELIBERATELY. A model would produce a fluent
// paragraph about any of these 2,330 technologies without consulting anything,
// and some of those paragraphs would be wrong in ways no reader could detect.
// Every field here is a copy of something somebody else published, carrying the
// URL it came from. See 0049.

import type { Db } from '../db/client.ts';

export interface ReferenceReport {
  resolved: number;
  /** Candidates rejected because nothing confirmed them beyond the name. */
  unresolved: number;
  failed: number;
  requests: number;
  skipped?: string;
}

export interface ReferenceOptions {
  limit?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  staleAfterDays?: number;
}

/**
 * Wikimedia asks for a descriptive User-Agent that identifies the caller, and
 * enforces it. This is not politeness theatre: anonymous bulk clients get
 * blocked, and a blocked client here means a page that silently stops learning
 * anything new.
 */
const UA = 'NewsTrack/0.1 (technology archive; +https://example.invalid/about)';

export const SLICE = 10;
export const STALE_AFTER_DAYS = 90;

/**
 * Wikidata P31 (instance of) values that mean "this is a piece of technology".
 *
 * This is the weaker of the two confirmations and it exists for the ~57% of
 * technologies with no repository or homepage recorded here to check against.
 * It is an allowlist rather than a denylist on purpose: the failure mode of a
 * denylist is that anything unforeseen is accepted, and what gets accepted here
 * ends up printed on a page as fact.
 */
export const TECH_TYPES = new Set([
  'Q9143',      // programming language
  'Q7397',      // software
  'Q341',       // free software
  'Q1130645',   // open-source software
  'Q21127166',  // software framework
  'Q271680',    // software library
  'Q176165',    // file format
  'Q1092177',   // markup language
  'Q8513',      // database
  'Q176165',    // format
  'Q3966',      // computer hardware
  'Q9135',      // operating system
  'Q131212',    // web framework
  'Q1330336',   // relational database management system
  'Q28923',     // application software
  'Q193424',    // middleware
  'Q3238015',   // web service
  'Q11288',     // protocol
  'Q15836568',  // communication protocol
  'Q1155404',   // standard
  'Q80993',     // software engineering
  'Q638608',    // integrated development environment
  'Q188860',    // version control system
  'Q7644902',   // technical standard
  'Q1058834',   // compiler
  'Q1662673',   // runtime system
  'Q189210',    // package manager
  'Q6368',      // cloud computing service
]);

/**
 * The same gate for platforms, whose Wikidata types are nothing like a
 * technology's. Measured from what real platforms actually carry: app
 * marketplace, freelance marketplace, digital distribution platform, patronage
 * website, and so on.
 *
 * WHAT IS DELIBERATELY LEFT OUT is the more interesting half. The commonest P31
 * on these articles are `business` (Q4830453), `enterprise`, `public company`,
 * `organization` and `website` -- and every one of them is useless here. They
 * would confirm essentially any company article a name search returned, which is
 * the wrong-match problem this gate exists to prevent, wearing a different hat.
 * A type only counts as confirmation when being that type means the article is
 * about the KIND of thing we were looking for.
 */
export const PLATFORM_TYPES = new Set([
  'Q3814081',    // app marketplace
  'Q5412217',    // freelance marketplace
  'Q3390477',    // online marketplace
  'Q19307174',   // digital distribution platform
  'Q81989119',   // video game distribution platform
  'Q42337018',   // patronage website
  'Q122759350',  // user-generated content platform
  'Q59152282',   // video streaming service
  'Q484847',     // e-commerce
  'Q1334294',    // software repository
  'Q891055',     // package manager
  'Q6368',       // cloud computing service
  'Q3238015',    // web service
]);

interface Due {
  kind: 'stack' | 'platform';
  id: string;
  name: string;
  repo_url: string | null;
  homepage_url: string | null;
}

/** Host + path, lowercased, trailing slash and .git removed. */
export function urlKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/**
 * Does anything confirm this candidate beyond sharing a name?
 *
 * "Rust" is a video game, a fungal disease and a programming language, and a
 * name search returns the game. This is the gate that stops a confident,
 * sourced, entirely irrelevant paragraph appearing on a technology page --
 * which would be worse than the blank space it replaced.
 */
export function confirm(
  subject: { name: string; repo_url: string | null; homepage_url: string | null;
             kind?: 'stack' | 'platform' },
  candidate: { repos: string[]; sites: string[]; types: string[]; title: string },
): 'repo' | 'website' | 'typed' | null {
  const ourRepo = urlKey(subject.repo_url);
  if (ourRepo && candidate.repos.some((r) => urlKey(r) === ourRepo)) return 'repo';

  const ourSite = urlKey(subject.homepage_url);
  if (ourSite && candidate.sites.some((s) => urlKey(s) === ourSite)) return 'website';

  // A platform is not a technology and its Wikidata types say so. Checking a
  // marketplace against the technology list rejected two thirds of them.
  const allowed = subject.kind === 'platform' ? PLATFORM_TYPES : TECH_TYPES;
  if (candidate.types.some((t) => allowed.has(t))
      && titleFits(subject.name, candidate.title)) return 'typed';
  return null;
}

/**
 * Does this article title actually name the thing we asked about?
 *
 * A TYPE CONFIRMS A CATEGORY, NOT AN IDENTITY, and shipping without this
 * distinction produced a page of confident nonsense: Artifact Hub resolved to
 * Helm, the Go package index to "Apk (file format)", Buy Me a Coffee to Patreon,
 * Maven Central to Apache Maven, Flathub to Flatpak. Every one passed the type
 * gate honestly -- they ARE package managers and distribution platforms -- and
 * every one was a different product.
 *
 * So a type-only match must also agree on the name: every significant word of
 * the subject has to appear in the title. "Maven Central" against "Apache Maven"
 * is missing `central` and fails; "Apple App Store" against "App Store (Apple)"
 * has all three and passes, because the disambiguator in brackets is read as
 * part of the title rather than discarded.
 *
 * Only `typed` is gated this way. A repository or website match is confirmed by
 * a URL already held here, which is far stronger evidence than a name, and
 * legitimately resolves "PyPI" to "Python Package Index".
 */
export function titleFits(name: string, title: string): boolean {
  const words = (v: string) => new Set(
    v.toLowerCase()
      .replace(/[()[\]{}.,:;!?"'’\/\-]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)));

  const want = words(name);
  if (want.size === 0) return false;
  const have = words(title);
  for (const w of want) if (!have.has(w)) return false;
  return true;
}

/** Words that carry no identity, so their absence should not reject a match. */
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'to', 'me', 'my']);

function claimValues(claims: Record<string, unknown>, prop: string): unknown[] {
  const list = claims[prop];
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => (c as { mainsnak?: { datavalue?: { value?: unknown } } })?.mainsnak?.datavalue?.value)
    .filter((v) => v !== undefined);
}

function stringClaims(claims: Record<string, unknown>, prop: string): string[] {
  return claimValues(claims, prop).filter((v): v is string => typeof v === 'string');
}

function entityIds(claims: Record<string, unknown>, prop: string): string[] {
  return claimValues(claims, prop)
    .map((v) => (v as { id?: string })?.id)
    .filter((v): v is string => typeof v === 'string');
}

/** Wikidata times are "+2010-07-07T00:00:00Z" with a precision we must respect. */
export function inceptionDate(claims: Record<string, unknown>): string | null {
  const raw = claimValues(claims, 'P571')[0] as { time?: string; precision?: number } | undefined;
  if (!raw?.time) return null;
  // Precision 9 is year-only, 10 is month. Wikidata pads the unknown parts with
  // zeroes, and "2010-00-00" is not a date Postgres will take -- nor is it one
  // this archive should invent a January for.
  const m = /^\+(\d{4})-(\d{2})-(\d{2})/.exec(raw.time);
  if (!m) return null;
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  const prec = raw.precision ?? 11;
  if (prec <= 9 || mo === '00') return `${y}-01-01`;
  if (prec === 10 || d === '00') return `${y}-${mo}-01`;
  return `${y}-${mo}-${d}`;
}

export async function refreshReferences(
  db: Db,
  opts: ReferenceOptions = {},
): Promise<ReferenceReport> {
  const report: ReferenceReport = { resolved: 0, unresolved: 0, failed: 0, requests: 0 };
  const limit = opts.limit ?? SLICE;
  const stale = opts.staleAfterDays ?? STALE_AFTER_DAYS;
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { 'user-agent': opts.userAgent ?? UA, accept: 'application/json' };

  // Technologies that actually appear in the archive come first: those are the
  // pages a reader can reach from a story. 279 of 2,330 at the time of writing,
  // so the useful half is done in hours rather than in the days a flat pass
  // over the whole registry would take.
  const due = await db.query<Due>(
    `WITH subjects AS (
       SELECT 'stack'::text AS kind, s.id, s.name, s.repo_url, s.homepage_url,
              EXISTS (SELECT 1 FROM stories x
                       WHERE x.superseded_by IS NULL AND x.stacks && ARRAY[s.slug]) AS seen,
              s.curated
         FROM stacks s
       UNION ALL
       -- Platforms have one URL and no repository, so that URL stands in for the
       -- homepage. They are 56 rows against 2,330, so they finish quickly and
       -- are not worth a separate job or a separate cadence.
       SELECT 'platform', p.id, p.name, NULL, p.url, true, true
         FROM platforms p
     )
     SELECT sub.kind, sub.id::text, sub.name, sub.repo_url, sub.homepage_url
       FROM subjects sub
       LEFT JOIN entity_reference r
              ON r.subject_kind = sub.kind AND r.subject_id = sub.id
      WHERE (r.checked_at IS NULL
             OR r.checked_at < now() - make_interval(days => $2)
             -- Resolved before short_description existed. Treated as due so the
             -- archive fills itself in rather than waiting out 90 days or
             -- needing a backfill run by hand. See 0052.
             OR (r.wikidata_id IS NOT NULL AND r.short_description IS NULL))
        AND (r.failed_at IS NULL
             OR r.failed_at < now() - make_interval(hours => least(r.failures, 8) * 12))
      ORDER BY sub.seen DESC, sub.curated DESC, r.checked_at ASC NULLS FIRST, sub.name
      LIMIT $1`,
    [limit, stale],
  );
  if (due.length === 0) return report;

  for (const subject of due) {
    try {
      const outcome = await resolveOne(subject, doFetch, headers, report);
      if (outcome) report.resolved++;
      else report.unresolved++;
    } catch (err) {
      report.failed++;
      await fail(db, subject, err instanceof Error ? err.message : String(err));
      continue;
    }
  }
  return report;

  async function resolveOne(
    subject: Due,
    f: typeof fetch,
    hdrs: Record<string, string>,
    rep: ReferenceReport,
  ): Promise<boolean> {
    // 1. Candidate article titles, by search rather than by guessing at
    //    disambiguators -- "Rust (programming language)" is not derivable from
    //    "Rust", and getting it wrong silently is the whole risk here.
    const search = new URL('https://en.wikipedia.org/w/api.php');
    search.searchParams.set('action', 'query');
    search.searchParams.set('list', 'search');
    search.searchParams.set('srsearch', subject.name);
    search.searchParams.set('srlimit', '5');
    search.searchParams.set('format', 'json');
    const sres = await f(search.toString(), { headers: hdrs });
    rep.requests++;
    if (!sres.ok) throw new Error(`wikipedia search http ${sres.status}`);
    const sbody = await sres.json() as { query?: { search?: { title: string }[] } };
    const titles = (sbody.query?.search ?? []).map((s) => s.title).slice(0, 5);
    if (titles.length === 0) {
      await unresolved(db, subject, 'no Wikipedia article matched the name');
      return false;
    }

    // 2. Those titles as Wikidata items, in ONE request.
    const ents = new URL('https://www.wikidata.org/w/api.php');
    ents.searchParams.set('action', 'wbgetentities');
    ents.searchParams.set('sites', 'enwiki');
    ents.searchParams.set('titles', titles.join('|'));
    ents.searchParams.set('props', 'claims|sitelinks|descriptions');
    ents.searchParams.set('languages', 'en');
    ents.searchParams.set('format', 'json');
    const eres = await f(ents.toString(), { headers: hdrs });
    rep.requests++;
    if (!eres.ok) throw new Error(`wikidata http ${eres.status}`);
    const ebody = await eres.json() as {
      entities?: Record<string, {
        claims?: Record<string, unknown>;
        sitelinks?: { enwiki?: { title?: string } };
        descriptions?: { en?: { value?: string } };
      }>;
    };

    // 3. The first candidate anything confirms. Search order is relevance
    //    order, so this prefers the best-ranked article that also checks out
    //    rather than the best-confirmed article of any rank.
    for (const title of titles) {
      const entry = Object.entries(ebody.entities ?? {})
        .find(([qid, e]) => !qid.startsWith('-') && e.sitelinks?.enwiki?.title === title);
      if (!entry) continue;
      const [qid, entity] = entry;
      const claims = entity.claims ?? {};

      const how = confirm({ ...subject, kind: subject.kind }, {
        repos: stringClaims(claims, 'P1324'),
        sites: stringClaims(claims, 'P856'),
        types: entityIds(claims, 'P31'),
        title,
      });
      if (!how) continue;

      // 4. The background paragraph, and the labels for the entity-valued
      //    claims. One more request each; both are cheap and cached hard by
      //    Wikimedia.
      const sum = await f(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        { headers: hdrs },
      );
      rep.requests++;
      const summary = sum.ok
        ? ((await sum.json() as { extract?: string }).extract ?? null)
        : null;

      const devQid = entityIds(claims, 'P178')[0] ?? null;
      const licenseQid = entityIds(claims, 'P275')[0] ?? null;
      const langQids = entityIds(claims, 'P277');
      const labels = await labelsFor(
        [devQid, licenseQid, ...langQids].filter((x): x is string => !!x), f, hdrs, rep);

      await store(db, subject, {
        qid,
        title,
        summary,
        shortDescription: entity.descriptions?.en?.value ?? null,
        developer: devQid ? labels.get(devQid) ?? null : null,
        developerQid: devQid,
        inception: inceptionDate(claims),
        license: licenseQid ? labels.get(licenseQid) ?? null : null,
        writtenIn: langQids.map((q) => labels.get(q)).filter((x): x is string => !!x),
        version: stringClaims(claims, 'P348')[0] ?? null,
        officialUrl: stringClaims(claims, 'P856')[0] ?? null,
        confidence: how,
      });
      return true;
    }

    await unresolved(db, subject,
      `nothing confirmed a match; considered ${titles.slice(0, 3).join(', ')}`);
    return false;
  }
}

async function labelsFor(
  qids: string[], f: typeof fetch, hdrs: Record<string, string>, rep: ReferenceReport,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (qids.length === 0) return out;
  const u = new URL('https://www.wikidata.org/w/api.php');
  u.searchParams.set('action', 'wbgetentities');
  u.searchParams.set('ids', [...new Set(qids)].slice(0, 50).join('|'));
  u.searchParams.set('props', 'labels');
  u.searchParams.set('languages', 'en');
  u.searchParams.set('format', 'json');
  const res = await f(u.toString(), { headers: hdrs });
  rep.requests++;
  if (!res.ok) return out;
  const body = await res.json() as {
    entities?: Record<string, { labels?: { en?: { value?: string } } }>;
  };
  for (const [qid, e] of Object.entries(body.entities ?? {})) {
    const v = e.labels?.en?.value;
    if (v) out.set(qid, v);
  }
  return out;
}

interface Resolved {
  qid: string; title: string; summary: string | null; shortDescription: string | null;
  developer: string | null; developerQid: string | null;
  inception: string | null; license: string | null; writtenIn: string[];
  version: string | null; officialUrl: string | null;
  confidence: 'repo' | 'website' | 'typed';
}

async function store(db: Db, subject: Due, r: Resolved): Promise<void> {
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`;
  await db.query(
    `INSERT INTO entity_reference (
       subject_kind, subject_id, wikidata_id, wikipedia_title, summary, developer,
       developer_qid, inception, license, written_in, latest_version, official_url,
       source_url, source_license, confidence, short_description,
       checked_at, failed_at, failures, note)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8::date, $9, $10::text[], $11, $12,
             $13, $14, $15, $16, now(), NULL, 0, NULL)
     ON CONFLICT (subject_kind, subject_id) DO UPDATE SET
       wikidata_id = EXCLUDED.wikidata_id, wikipedia_title = EXCLUDED.wikipedia_title,
       summary = EXCLUDED.summary, developer = EXCLUDED.developer,
       developer_qid = EXCLUDED.developer_qid, inception = EXCLUDED.inception,
       license = EXCLUDED.license, written_in = EXCLUDED.written_in,
       latest_version = EXCLUDED.latest_version, official_url = EXCLUDED.official_url,
       source_url = EXCLUDED.source_url, source_license = EXCLUDED.source_license,
       confidence = EXCLUDED.confidence,
       short_description = EXCLUDED.short_description,
       checked_at = now(), failed_at = NULL, failures = 0, note = NULL`,
    [
      subject.kind, subject.id, r.qid, r.title, r.summary, r.developer,
      r.developerQid, r.inception, r.license, r.writtenIn, r.version, r.officialUrl,
      // CC BY-SA requires attribution and attribution requires the link, which
      // is why the table refuses a summary without both.
      url, 'CC BY-SA 4.0', r.confidence, r.shortDescription,
    ],
  );
}

async function unresolved(db: Db, subject: Due, note: string): Promise<void> {
  await db.query(
    `INSERT INTO entity_reference (subject_kind, subject_id, checked_at, note)
     VALUES ($1, $2::uuid, now(), $3)
     ON CONFLICT (subject_kind, subject_id) DO UPDATE
        SET checked_at = now(), note = EXCLUDED.note`,
    [subject.kind, subject.id, note.slice(0, 300)],
  );
}

async function fail(db: Db, subject: Due, note: string): Promise<void> {
  await db.query(
    `INSERT INTO entity_reference (subject_kind, subject_id, failed_at, failures, note)
     VALUES ($1, $2::uuid, now(), 1, $3)
     ON CONFLICT (subject_kind, subject_id) DO UPDATE
        SET failed_at = now(), failures = entity_reference.failures + 1,
            note = EXCLUDED.note`,
    [subject.kind, subject.id, note.slice(0, 300)],
  );
}

/** One line for the job note. */
export function summariseReferences(r: ReferenceReport): string {
  if (r.skipped && r.resolved === 0) return r.skipped;
  const bits: string[] = [];
  if (r.resolved) bits.push(`${r.resolved} resolved`);
  if (r.unresolved) bits.push(`${r.unresolved} unconfirmed`);
  if (r.failed) bits.push(`${r.failed} failed`);
  if (r.requests) bits.push(`${r.requests} request(s)`);
  return bits.join(', ');
}

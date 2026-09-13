// The work market, counted where the work is posted.
//
// 2026-09-13: "I want clear report - which market like freelancing, jobs are
// changes, which market appear newly and we can use which platform to attend to
// this market." See migrations/0084 for why these sources and not the news.
//
// TWO COLLECTORS, BECAUSE THE TWO RECORDS HAVE DIFFERENT SHAPES.
//
//   Hacker News hiring threads   one thread a month, fifteen years deep. Counted
//                                once each, re-counted while a thread is young
//                                enough to still be gaining posts.
//   Remote boards and bounties   a moving window of what is open now. Read
//                                twice a day, each listing kept by id, so a
//                                board's history accumulates from the first run.
//
// NEITHER STORES POST TEXT. A count is kept with the thread id it came from;
// a listing keeps its title, category, type, tags and pay, and a link back.

import type { Db } from '../db/client.ts';
import { marketsOf, skillsOf } from '../vocab/workmarkets.ts';

const HN = 'https://hn.algolia.com/api/v1';
export const HN_SOURCE = 'hn-whoishiring';

type FetchImpl = typeof fetch;

// ---------------------------------------------------------------------------
// Hacker News
// ---------------------------------------------------------------------------

export type ThreadKind = 'hiring' | 'seeking' | 'freelance';

export interface Thread { id: string; title: string; kind: ThreadKind; day: string }

/**
 * Which monthly thread a `whoishiring` story is, if it is one.
 *
 * The account has also posted meta threads, a one-off "Who is hiring right
 * now?" in March 2020 and a "How much are remote developers paid?" -- none of
 * which is the monthly series, and each of which would put a second point on a
 * month if it were counted.
 */
export function threadKind(title: string): ThreadKind | null {
  const t = String(title ?? '').trim().toLowerCase();
  if (/^ask hn: who is hiring\?/.test(t)) return 'hiring';
  if (/^ask hn: who wants to be hired\?/.test(t)) return 'seeking';
  if (/^ask hn: freelancer\? seeking freelancers?\?/.test(t)) return 'freelance';
  return null;
}

/** HN comment HTML as plain text, keeping paragraph breaks. */
export function htmlText(html: string): string {
  return String(html ?? '')
    .replace(/<p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

const CONTRACT = /\b(contract(?:or|ors|-to-hire)?|freelance(?:r|rs)?|part[- ]time|fractional|consult(?:ant|ants|ing))\b/i;

export interface PostFacts {
  remote: boolean;
  contract: boolean;
  markets: string[];
  skills: string[];
}

const firstLine = (text: string): string =>
  text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';

/**
 * A "Who is hiring?" post.
 *
 * REMOTE AND CONTRACT ARE READ FROM THE HEADER LINE ONLY. By convention the
 * first line is `Company | Role | Location | REMOTE | Full-time | Pay`, and the
 * body is free prose. Reading the whole post counted "we are not remote" and
 * "our contractors" as remote contract roles: measured on September 2026, the
 * whole-text rule found 27 contract posts and the header rule 16, and the
 * eleven extras were benefits paragraphs.
 */
export function readHiringPost(text: string): PostFacts {
  const head = firstLine(text);
  return {
    remote: /\bremote\b/i.test(head) && !/\b(?:no|not)\s+remote\b/i.test(head),
    contract: CONTRACT.test(head),
    markets: marketsOf(text),
    skills: skillsOf(text),
  };
}

/**
 * A "Who wants to be hired?" post.
 *
 * These follow a template -- `Location: / Remote: / Willing to relocate: /
 * Technologies:` -- so remote is the answer on the `Remote:` line. Almost
 * every seeker writes "Remote: Yes", which is exactly why it is read from that
 * line and not from the word appearing somewhere.
 */
export function readSeekingPost(text: string): PostFacts {
  const line = /^\s*remote\s*:\s*(.+)$/im.exec(text)?.[1]?.trim() ?? '';
  const remote = line
    ? /^(yes|y\b|ok|sure|preferred|only|remote|open|either|both|hybrid)/i.test(line)
    : /\bremote\b/i.test(text);
  return { remote, contract: CONTRACT.test(text), markets: marketsOf(text), skills: skillsOf(text) };
}

/** A "Freelancer? Seeking freelancer?" post, which says which side it is on first. */
export function readFreelancePost(text: string): PostFacts & { side: 'work' | 'hire' | null } {
  const head = text.slice(0, 160);
  const side = /seeking\s+freelancers?\b/i.test(head) ? 'hire'
    : /seeking\s+work\b/i.test(head) ? 'work' : null;
  return {
    side, remote: /\bremote\b/i.test(head), contract: true,
    markets: marketsOf(text), skills: skillsOf(text),
  };
}

export interface CountRow { dataset: string; market: string; measure: string; value: number }

/** Every count one thread contributes. */
export function countThread(kind: ThreadKind, texts: string[]): CountRow[] {
  const rows = new Map<string, CountRow>();
  const add = (dataset: string, market: string, measure: string, by = 1) => {
    const k = `${dataset}|${market}|${measure}`;
    const r = rows.get(k) ?? { dataset, market, measure, value: 0 };
    r.value += by;
    rows.set(k, r);
  };
  const datasets = kind === 'freelance' ? ['freelance-work', 'freelance-hire'] : [kind];
  // A zero row for every dataset, so a thread that was counted and held no
  // posts on one side is distinguishable from a thread never counted.
  for (const d of datasets) add(d, 'all', 'posts', 0);

  const bump = (dataset: string, p: PostFacts) => {
    for (const m of ['all', ...p.markets, ...p.skills.map((s) => `skill:${s}`)]) {
      add(dataset, m, 'posts');
      if (p.remote) add(dataset, m, 'remote');
      if (p.contract) add(dataset, m, 'contract');
    }
  };

  for (const text of texts) {
    if (kind === 'hiring') bump('hiring', readHiringPost(text));
    else if (kind === 'seeking') bump('seeking', readSeekingPost(text));
    else {
      const p = readFreelancePost(text);
      if (p.side) bump(`freelance-${p.side}`, p);
    }
  }
  return [...rows.values()];
}

async function getJson(url: string, doFetch: FetchImpl, userAgent: string): Promise<any> {
  const res = await doFetch(url, {
    headers: { 'user-agent': userAgent, accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Every monthly thread the account has posted. */
export async function listThreads(doFetch: FetchImpl, userAgent: string): Promise<Thread[]> {
  const out: Thread[] = [];
  for (let page = 0; page < 10; page += 1) {
    const r = await getJson(
      `${HN}/search_by_date?tags=story,author_whoishiring&hitsPerPage=1000&page=${page}`,
      doFetch, userAgent);
    for (const h of r.hits ?? []) {
      const kind = threadKind(h.title ?? '');
      if (kind) out.push({ id: String(h.objectID), title: h.title, kind, day: String(h.created_at).slice(0, 10) });
    }
    if (page >= (r.nbPages ?? 1) - 1) break;
  }
  return out;
}

export interface HnReport { threads: number; counted: number; pending: number; failed: string[] }

/**
 * Count the threads not yet counted, and re-count the young ones.
 *
 * A thread keeps gaining posts for weeks, so anything under 45 days old is
 * counted again each run and its rows replaced. Older threads are counted once.
 * `max` bounds a run so the fifteen-year backfill spreads across several runs
 * instead of holding a job lease for half an hour.
 */
export async function refreshHnWork(db: Db, opts: {
  max?: number; delayMs?: number; userAgent?: string; fetchImpl?: FetchImpl; now?: number;
} = {}): Promise<HnReport> {
  const doFetch = opts.fetchImpl ?? fetch;
  const ua = opts.userAgent ?? 'NewsTrack';
  const now = opts.now ?? Date.now();
  const report: HnReport = { threads: 0, counted: 0, pending: 0, failed: [] };

  const threads = await listThreads(doFetch, ua);
  report.threads = threads.length;
  const done = await db.query<{ day: string; dataset: string }>(
    `SELECT DISTINCT day::text AS day, dataset FROM work_counts
      WHERE source = $1 AND market = 'all' AND measure = 'posts'`, [HN_SOURCE]);
  const have = new Set(done.map((r) =>
    `${r.day}|${r.dataset.startsWith('freelance') ? 'freelance' : r.dataset}`));
  const young = (day: string) => now - Date.parse(day) < 45 * 86_400_000;

  const due = threads
    .filter((t) => young(t.day) || !have.has(`${t.day}|${t.kind}`))
    .sort((a, b) => b.day.localeCompare(a.day));
  const batch = due.slice(0, opts.max ?? 40);
  report.pending = due.length - batch.length;

  for (const t of batch) {
    try {
      const item = await getJson(`${HN}/items/${t.id}`, doFetch, ua);
      const texts = (item.children ?? [])
        .filter((c: any) => c && c.text && c.author)
        .map((c: any) => htmlText(c.text));
      const rows = countThread(t.kind, texts);
      const datasets = [...new Set(rows.map((r) => r.dataset))];
      await db.query(
        `DELETE FROM work_counts WHERE source = $1 AND day = $2::date AND dataset = ANY($3::text[])`,
        [HN_SOURCE, t.day, datasets]);
      await insertCounts(db, HN_SOURCE, t.day, rows, t.id);
      report.counted += 1;
    } catch (err) {
      report.failed.push(`${t.day} ${t.kind}: ${(err as Error).message.slice(0, 60)}`);
    }
    if (opts.delayMs !== 0) await new Promise((r) => setTimeout(r, opts.delayMs ?? 1500));
  }
  return report;
}

async function insertCounts(
  db: Db, source: string, day: string, rows: CountRow[], threadId: string | null,
): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = batch.map((r, n) => {
      const b = n * 7;
      values.push(source, r.dataset, day, r.market, r.measure, r.value, threadId);
      return `($${b + 1}, $${b + 2}, $${b + 3}::date, $${b + 4}, $${b + 5}, $${b + 6}::numeric, $${b + 7})`;
    }).join(', ');
    await db.query(
      `INSERT INTO work_counts (source, dataset, day, market, measure, value, thread_id)
       VALUES ${tuples}
       ON CONFLICT (source, dataset, day, market, measure)
       DO UPDATE SET value = EXCLUDED.value, thread_id = EXCLUDED.thread_id, fetched_at = now()`,
      values);
  }
}

export function summariseHn(r: HnReport): string {
  return `${r.counted} of ${r.threads} threads counted${r.pending ? `, ${r.pending} still to count` : ''}${
    r.failed.length ? `; failed: ${r.failed.slice(0, 3).join(', ')}` : ''}`;
}

// ---------------------------------------------------------------------------
// Remote boards and bounties
// ---------------------------------------------------------------------------

export interface Listing {
  board: string;
  id: string;
  postedAt: string | null;
  title: string;
  company: string | null;
  category: string | null;
  employment: string | null;
  tags: string[];
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  reward: number | null;
  rewardToken: string | null;
  submissions: number | null;
  url: string | null;
  markets: string[];
}

const str = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function listing(
  l: Omit<Listing, 'markets'>, extraMarkets: string[] = [], useTags = true,
): Listing {
  const text = [l.title, l.category ?? '', ...(useTags ? l.tags : [])].join(' \n ');
  return { ...l, markets: [...new Set([...extraMarkets, ...marketsOf(text)])] };
}

/**
 * Remote OK's feed opens with a legal notice object, which has no id.
 *
 * ITS TAGS ARE NOT READ FOR MARKETS. The board attaches a broad set to almost
 * every listing -- a "Technical Product Lead, AI Finance App" carried
 * `sys admin, infosec, exec, ruby, mobile, ops` -- and classifying on them put
 * 21 of its 99 listings in security. The title says what the job is.
 */
export function fromRemoteOk(body: unknown): Listing[] {
  return (Array.isArray(body) ? body : [])
    .filter((j: any) => j && j.id && j.position)
    .map((j: any) => listing({
      board: 'remoteok', id: String(j.id), postedAt: iso(j.date ?? j.epoch),
      title: String(j.position), company: str(j.company), category: null,
      employment: null, tags: (j.tags ?? []).map(String), location: str(j.location),
      salaryMin: num(j.salary_min), salaryMax: num(j.salary_max),
      currency: num(j.salary_min) ? 'USD' : null,
      reward: null, rewardToken: null, submissions: null, url: str(j.url),
    }, [], false));
}

export function fromJobicy(body: any): Listing[] {
  return (body?.jobs ?? []).filter((j: any) => j && j.id && j.jobTitle).map((j: any) => listing({
    board: 'jobicy', id: String(j.id), postedAt: iso(j.pubDate),
    title: String(j.jobTitle), company: str(j.companyName),
    category: str((j.jobIndustry ?? [])[0]), employment: str((j.jobType ?? [])[0]),
    tags: [...(j.jobIndustry ?? [])].map(String), location: str(j.jobGeo),
    salaryMin: num(j.annualSalaryMin), salaryMax: num(j.annualSalaryMax),
    currency: str(j.salaryCurrency),
    reward: null, rewardToken: null, submissions: null, url: str(j.url),
  }));
}

export function fromHimalayas(body: any): Listing[] {
  return (body?.jobs ?? []).filter((j: any) => j && j.title && (j.guid || j.applicationLink)).map((j: any) => listing({
    board: 'himalayas', id: String(j.guid ?? j.applicationLink), postedAt: iso(j.pubDate),
    title: String(j.title), company: str(j.companyName),
    category: str((j.parentCategories ?? [])[0]), employment: str(j.employmentType),
    tags: [...(j.categories ?? []), ...(j.parentCategories ?? [])].map((c: string) => String(c).replace(/-/g, ' ')),
    location: str((j.locationRestrictions ?? []).join(', ')),
    salaryMin: num(j.minSalary), salaryMax: num(j.maxSalary), currency: str(j.currency),
    reward: null, rewardToken: null, submissions: null, url: str(j.applicationLink ?? j.guid),
  }));
}

export function fromWorkingNomads(body: unknown): Listing[] {
  return (Array.isArray(body) ? body : []).filter((j: any) => j && j.url && j.title).map((j: any) => listing({
    board: 'workingnomads', id: String(j.url), postedAt: iso(j.pub_date),
    title: String(j.title), company: str(j.company_name), category: str(j.category_name),
    employment: null, tags: String(j.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    location: str(j.location), salaryMin: null, salaryMax: null, currency: null,
    reward: null, rewardToken: null, submissions: null, url: str(j.url),
  }));
}

const xmlText = (s: string): string => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&').trim();

/** We Work Remotely's RSS: `Company: Role` titles, with category, type and region elements. */
export function fromWeWorkRemotely(xml: string): Listing[] {
  return String(xml ?? '').split('<item>').slice(1).map((item) => {
    const tag = (name: string) => {
      const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item);
      return m ? xmlText(m[1] ?? '') : '';
    };
    const full = tag('title');
    const colon = full.indexOf(':');
    const link = tag('link') || tag('guid');
    return listing({
      board: 'weworkremotely', id: link || full, postedAt: iso(tag('pubDate')),
      title: colon > 0 ? full.slice(colon + 1).trim() : full,
      company: colon > 0 ? full.slice(0, colon).trim() : null,
      category: str(tag('category')), employment: str(tag('type')),
      tags: tag('skills').split(',').map((t) => t.trim()).filter(Boolean),
      location: str(tag('region')), salaryMin: null, salaryMax: null, currency: null,
      reward: null, rewardToken: null, submissions: null, url: str(link),
    });
  }).filter((l) => l.title);
}

/** Superteam Earn: bounties and projects, paid in stablecoins. */
export function fromSuperteam(body: unknown): Listing[] {
  return (Array.isArray(body) ? body : []).filter((j: any) => j && j.id && j.title).map((j: any) => listing({
    board: 'superteam', id: String(j.id), postedAt: null,
    title: String(j.title), company: str(j.sponsor?.name), category: str(j.type),
    employment: str(j.type), tags: [], location: null,
    salaryMin: null, salaryMax: null, currency: null,
    reward: num(j.rewardAmount), rewardToken: str(j.token),
    submissions: Number.isFinite(Number(j._count?.Submission)) ? Number(j._count.Submission) : null,
    url: j.slug ? `https://earn.superteam.fun/listing/${encodeURIComponent(j.slug)}` : null,
  }, ['crypto-web3']));
}

export interface BoardReport { boards: string[]; listings: number; failed: string[] }

/**
 * Read every board and bounty feed and keep what they carry.
 *
 * Twice a day. Remotive's terms ask for no more than four reads a day and the
 * others say less or nothing; twice keeps inside the strictest of them, and
 * none of these windows turns over faster than that.
 *
 * Himalayas is the one board large enough that its feed is a sample: it holds
 * about a hundred thousand listings and pages twenty at a time. The newest ten
 * pages are read, and its own total is stored as the board's size.
 */
export async function refreshBoards(db: Db, opts: {
  userAgent?: string; fetchImpl?: FetchImpl; himalayasPages?: number; delayMs?: number;
} = {}): Promise<BoardReport> {
  const doFetch = opts.fetchImpl ?? fetch;
  const ua = opts.userAgent ?? 'NewsTrack';
  const report: BoardReport = { boards: [], listings: 0, failed: [] };
  const today = new Date().toISOString().slice(0, 10);
  const pause = () => new Promise((r) => setTimeout(r, opts.delayMs ?? 1000));

  const boards: Array<{ slug: string; read: () => Promise<{ rows: Listing[]; open?: number }> }> = [
    { slug: 'remoteok', read: async () => ({ rows: fromRemoteOk(await getJson('https://remoteok.com/api', doFetch, ua)) }) },
    { slug: 'jobicy', read: async () => ({ rows: fromJobicy(await getJson('https://jobicy.com/api/v2/remote-jobs?count=100', doFetch, ua)) }) },
    { slug: 'workingnomads', read: async () => ({ rows: fromWorkingNomads(await getJson('https://www.workingnomads.com/api/exposed_jobs/', doFetch, ua)) }) },
    {
      slug: 'weworkremotely',
      read: async () => {
        const res = await doFetch('https://weworkremotely.com/remote-jobs.rss', {
          headers: { 'user-agent': ua }, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(String(res.status));
        return { rows: fromWeWorkRemotely(await res.text()) };
      },
    },
    { slug: 'superteam', read: async () => ({ rows: fromSuperteam(await getJson('https://earn.superteam.fun/api/listings/?take=100', doFetch, ua)) }) },
    {
      slug: 'himalayas',
      read: async () => {
        const rows: Listing[] = [];
        let cursor = '';
        let open: number | undefined;
        for (let page = 0; page < (opts.himalayasPages ?? 10); page += 1) {
          const body = await getJson(
            `https://himalayas.app/jobs/api?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
            doFetch, ua);
          if (open === undefined && Number.isFinite(Number(body.totalCount))) open = Number(body.totalCount);
          rows.push(...fromHimalayas(body));
          cursor = body.nextCursor ?? '';
          if (!cursor) break;
          await pause();
        }
        return { rows, open };
      },
    },
  ];

  for (const b of boards) {
    try {
      const { rows, open } = await b.read();
      if (rows.length === 0) { report.failed.push(`${b.slug} empty`); continue; }
      await upsertListings(db, rows);
      const counts: CountRow[] = [
        { dataset: 'board', market: 'all', measure: 'open', value: open ?? rows.length },
      ];
      const reward = rows.reduce((t, r) => t + (r.reward ?? 0), 0);
      if (reward > 0) counts.push({ dataset: 'board', market: 'all', measure: 'reward', value: reward });
      await insertCounts(db, b.slug, today, counts, null);
      report.boards.push(b.slug);
      report.listings += rows.length;
    } catch (err) {
      report.failed.push(`${b.slug} ${(err as Error).message.slice(0, 60)}`);
    }
    await pause();
  }

  // A listing unseen for thirteen months is history nobody reads; the monthly
  // counts in work_counts outlive it.
  await db.query(`DELETE FROM work_listings WHERE last_seen_at < now() - interval '400 days'`);
  return report;
}

async function upsertListings(db: Db, rows: Listing[]): Promise<void> {
  const unique = [...new Map(rows.map((r) => [`${r.board}|${r.id}`, r])).values()];
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = batch.map((r, n) => {
      const b = n * 17;
      values.push(r.board, r.id, r.postedAt, r.title.slice(0, 300), r.company, r.category,
        r.employment, r.tags.slice(0, 30), r.markets, r.location, r.salaryMin, r.salaryMax,
        r.currency, r.reward, r.rewardToken, r.submissions, r.url);
      return `($${b + 1}, $${b + 2}, $${b + 3}::timestamptz, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7},
        $${b + 8}::text[], $${b + 9}::text[], $${b + 10}, $${b + 11}::numeric, $${b + 12}::numeric,
        $${b + 13}, $${b + 14}::numeric, $${b + 15}, $${b + 16}::integer, $${b + 17})`;
    }).join(', ');
    await db.query(
      `INSERT INTO work_listings (board, listing_id, posted_at, title, company, category,
         employment, tags, markets, location, salary_min, salary_max, currency, reward,
         reward_token, submissions, url)
       VALUES ${tuples}
       ON CONFLICT (board, listing_id) DO UPDATE SET
         title = EXCLUDED.title, category = EXCLUDED.category, employment = EXCLUDED.employment,
         tags = EXCLUDED.tags, markets = EXCLUDED.markets, reward = EXCLUDED.reward,
         submissions = EXCLUDED.submissions,
         posted_at = COALESCE(work_listings.posted_at, EXCLUDED.posted_at),
         last_seen_at = now()`,
      values);
  }
}

export function summariseBoards(r: BoardReport): string {
  return `${r.listings} listings from ${r.boards.length ? r.boards.join(', ') : 'no board'}${
    r.failed.length ? `; failed: ${r.failed.join(', ')}` : ''}`;
}

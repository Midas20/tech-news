// Which work markets grew, which appeared, which shrank -- and where the work is.
//
// 2026-09-13: "which market like freelancing, jobs are changes, which market
// appear newly and we can use which platform to attend to this market."
//
// EVERY NUMBER HERE IS A SHARE OF PUBLIC POSTS. "AI and LLM engineering: 28% of
// hiring posts" means 28% of the posts in that month's Hacker News "Who is
// hiring?" thread mention it, counted by src/collect/workmarket.ts and
// re-countable by anybody from the same thread. It is not a share of the
// economy, and the page never says it is.
//
// COMPARED WITH A YEAR EARLIER, NOT WITH LAST MONTH. Hiring has a calendar --
// the January thread is always large, the December one small -- so a month is
// compared with the same month a year before, and a year with the year before.
//
// DEMAND AGAINST SUPPLY IS THE FINDING A FREELANCER CAN USE. The "Who wants to
// be hired?" thread is the other side of the same market in the same month. A
// market asked for in 8% of hiring posts and offered by 2% of the people looking
// for work has few candidates; one asked for in 26% and offered by 52% is
// crowded. Both are shares of their own thread, so the two threads being very
// different sizes does not distort the comparison.

import { q } from '../ui/db.ts';
import type { Query } from './corpus.ts';
import type { Range } from './period.ts';
import { WORK_MARKETS, WORK_SKILLS, WORK_BOARDS } from '../vocab/workmarkets.ts';
import { HN_SOURCE } from '../collect/workmarket.ts';

const DAY = 86_400_000;
const YEAR = 365 * DAY;
/** A week or a partial month falls back to the thread in force, if it is this recent. */
const IN_FORCE = 70 * DAY;

export type MarketStatus = 'new' | 'growing' | 'steady' | 'shrinking';

export interface MarketMove {
  slug: string;
  label: string;
  what: string;
  /** Share of hiring posts mentioning it, percent. */
  now: number;
  before: number | null;
  /** Percentage points. */
  change: number | null;
  /** Share of job-seeker posts offering it, percent. */
  supply: number | null;
  /** Demand share over supply share. Above 1: fewer candidates than asks. */
  pressure: number | null;
  /** Share of this market's hiring posts that are remote, percent. */
  remote: number | null;
  /** Share of this market's hiring posts that are contract or freelance, percent. */
  contract: number | null;
  /** Hiring posts behind `now`, so a reader can see when a share rests on few. */
  posts: number;
  status: MarketStatus;
}

export interface ThreadSide {
  /** The thread dates this side was drawn from. */
  days: string[];
  hiring: number;
  seeking: number;
  /** Percent of hiring posts saying remote in their header. */
  remote: number | null;
  /** Percent of hiring posts offering contract, freelance or part-time. */
  contract: number | null;
  /** Percent of seekers who say they will work remotely. */
  seekingRemote: number | null;
  /** Percent of seekers open to contract or freelance work. */
  seekingContract: number | null;
  /** The freelance thread, while it ran: posts offering work and posts seeking it. */
  freelanceWork: number | null;
  freelanceHire: number | null;
}

export interface BoardMix {
  board: string;
  label: string;
  url: string;
  /** Listings seen on this board that were posted inside the period. */
  listings: number;
  /** The board's own count of what is open, from its latest snapshot. */
  open: number | null;
  markets: Array<{ slug: string; n: number; share: number }>;
  /** Percent of its listings typed contract, freelance or part-time. */
  contract: number | null;
}

export interface Bounties {
  board: string;
  open: number;
  reward: number;
  medianSubmissions: number | null;
  tokens: string[];
}

export interface WorkPicture {
  now: ThreadSide | null;
  before: ThreadSide | null;
  markets: MarketMove[];
  skills: MarketMove[];
  boards: BoardMix[];
  bounties: Bounties | null;
  /** The last freelance thread ever posted; it stopped in October 2025. */
  lastFreelanceThread: string | null;
}

const pct = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/**
 * Whether a market is new, growing, steady or shrinking.
 *
 * In percentage points of hiring posts, with a ratio test beside it so a small
 * market doubling is not called steady and a large one wobbling a point is not
 * called growing.
 */
export function statusOf(now: number, before: number | null): MarketStatus {
  if (before === null) return 'steady';
  const change = now - before;
  if (before < 2 && now >= 4) return 'new';
  if (change >= 3 || (before > 0 && now >= 3 && now / before >= 1.5)) return 'growing';
  if (change <= -3 || (before >= 3 && now / before <= 0.6)) return 'shrinking';
  return 'steady';
}

interface Row { dataset: string; day: string; market: string; measure: string; value: number }

/** The thread days a side of the comparison reads: inside the window, or the one in force. */
export function daysFor(all: string[], from: number, to: number): string[] {
  const inside = all.filter((d) => { const t = Date.parse(d); return t >= from && t < to; });
  if (inside.length > 0) return inside;
  const before = all.filter((d) => { const t = Date.parse(d); return t < to && t >= to - IN_FORCE; })
    .sort();
  return before.length ? [before[before.length - 1]!] : [];
}

function side(rows: Row[], from: number, to: number): ThreadSide | null {
  const daysOf = (ds: string) => [...new Set(rows.filter((r) => r.dataset === ds).map((r) => r.day))];
  const hiringDays = daysFor(daysOf('hiring'), from, to);
  if (hiringDays.length === 0) return null;
  const seekingDays = daysFor(daysOf('seeking'), from, to);
  const freelanceDays = daysFor(daysOf('freelance-work'), from, to);
  const sum = (ds: string, days: string[], market: string, measure: string) => rows
    .filter((r) => r.dataset === ds && days.includes(r.day) && r.market === market && r.measure === measure)
    .reduce((t, r) => t + r.value, 0);

  const hiring = sum('hiring', hiringDays, 'all', 'posts');
  const seeking = sum('seeking', seekingDays, 'all', 'posts');
  return {
    days: [...new Set([...hiringDays, ...seekingDays])].sort(),
    hiring: Math.round(hiring / hiringDays.length),
    seeking: seekingDays.length ? Math.round(seeking / seekingDays.length) : 0,
    remote: pct(sum('hiring', hiringDays, 'all', 'remote'), hiring),
    contract: pct(sum('hiring', hiringDays, 'all', 'contract'), hiring),
    seekingRemote: pct(sum('seeking', seekingDays, 'all', 'remote'), seeking),
    seekingContract: pct(sum('seeking', seekingDays, 'all', 'contract'), seeking),
    freelanceWork: freelanceDays.length
      ? Math.round(sum('freelance-work', freelanceDays, 'all', 'posts') / freelanceDays.length) : null,
    freelanceHire: freelanceDays.length
      ? Math.round(sum('freelance-hire', freelanceDays, 'all', 'posts') / freelanceDays.length) : null,
  };
}

/** One market's move, from the rows of both sides. */
function moves(
  rows: Row[], list: typeof WORK_MARKETS, prefix: string,
  now: ThreadSide, before: ThreadSide | null,
): MarketMove[] {
  const share = (ds: string, days: string[], market: string, measure = 'posts') => {
    const whole = rows.filter((r) => r.dataset === ds && days.includes(r.day) && r.market === 'all' && r.measure === 'posts')
      .reduce((t, r) => t + r.value, 0);
    const part = rows.filter((r) => r.dataset === ds && days.includes(r.day) && r.market === market && r.measure === measure)
      .reduce((t, r) => t + r.value, 0);
    return { part, whole, share: pct(part, whole) };
  };
  const hiringDays = (s: ThreadSide) => s.days.filter((d) => rows.some((r) => r.dataset === 'hiring' && r.day === d));
  const seekingDays = (s: ThreadSide) => s.days.filter((d) => rows.some((r) => r.dataset === 'seeking' && r.day === d));

  return list.map((m) => {
    const key = `${prefix}${m.slug}`;
    const n = share('hiring', hiringDays(now), key);
    const b = before ? share('hiring', hiringDays(before), key) : null;
    const s = share('seeking', seekingDays(now), key);
    const remote = share('hiring', hiringDays(now), key, 'remote');
    const contract = share('hiring', hiringDays(now), key, 'contract');
    const nowShare = n.share ?? 0;
    const beforeShare = b && b.whole > 0 ? b.share : null;
    return {
      slug: m.slug, label: m.label, what: m.what,
      now: nowShare,
      before: beforeShare,
      change: beforeShare === null ? null : Math.round((nowShare - beforeShare) * 10) / 10,
      supply: s.whole > 0 ? s.share : null,
      pressure: s.share && s.share > 0 ? Math.round((nowShare / s.share) * 100) / 100 : null,
      remote: pct(remote.part, n.part),
      contract: pct(contract.part, n.part),
      posts: n.part,
      status: statusOf(nowShare, beforeShare),
    };
  });
}

/** What the boards carried that was posted inside the period. */
async function boardsIn(range: Range, query: Query): Promise<{ boards: BoardMix[]; bounties: Bounties | null }> {
  const listings = await query<{ board: string; markets: string[]; employment: string | null }>(
    `SELECT board, markets, employment FROM work_listings
      WHERE COALESCE(posted_at, first_seen_at) >= $1::timestamptz
        AND COALESCE(posted_at, first_seen_at) < $2::timestamptz
        AND board <> 'superteam'`, [range.from, range.to]);
  const opens = await query<{ source: string; value: string }>(
    `SELECT DISTINCT ON (source) source, value::text AS value FROM work_counts
      WHERE dataset = 'board' AND measure = 'open' AND day < $1::date
      ORDER BY source, day DESC`, [range.to]);

  const boards: BoardMix[] = WORK_BOARDS.filter((b) => b.slug !== 'superteam').map((b) => {
    const mine = listings.filter((l) => l.board === b.slug);
    const counts = new Map<string, number>();
    for (const l of mine) for (const m of l.markets ?? []) counts.set(m, (counts.get(m) ?? 0) + 1);
    const contract = mine.filter((l) => /contract|freelance|part/i.test(l.employment ?? '')).length;
    return {
      board: b.slug, label: b.label, url: b.url, listings: mine.length,
      open: Number(opens.find((o) => o.source === b.slug)?.value ?? NaN) || null,
      markets: [...counts].map(([slug, n]) => ({ slug, n, share: pct(n, mine.length) ?? 0 }))
        .sort((x, y) => y.n - x.n),
      contract: mine.length ? pct(contract, mine.length) : null,
    };
  }).filter((b) => b.listings > 0);

  // Bounties are open or closed rather than posted on a date, so they are
  // shown only for a period that includes the latest snapshot.
  const bounty = await query<{ reward: string | null; submissions: number | null; token: string | null; seen: string }>(
    `SELECT reward::text AS reward, submissions, reward_token AS token, last_seen_at::text AS seen
       FROM work_listings
      WHERE board = 'superteam'
        AND last_seen_at >= (SELECT max(last_seen_at) - interval '6 hours' FROM work_listings WHERE board = 'superteam')
        AND last_seen_at >= $1::timestamptz AND first_seen_at < $2::timestamptz`,
    [range.from, range.to]);
  let bounties: Bounties | null = null;
  if (bounty.length > 0) {
    const subs = bounty.map((b) => b.submissions).filter((s): s is number => s !== null).sort((a, b) => a - b);
    bounties = {
      board: 'superteam', open: bounty.length,
      reward: Math.round(bounty.reduce((t, b) => t + Number(b.reward ?? 0), 0)),
      medianSubmissions: subs.length ? subs[Math.floor(subs.length / 2)]! : null,
      tokens: [...new Set(bounty.map((b) => b.token).filter((t): t is string => Boolean(t)))],
    };
  }
  return { boards, bounties };
}

export async function workPicture(range: Range, query: Query = q): Promise<WorkPicture> {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const raw = await query<{ dataset: string; day: string; market: string; measure: string; value: string }>(
    `SELECT dataset, day::text AS day, market, measure, value::text AS value
       FROM work_counts
      WHERE source = $1 AND day >= $2::date AND day < $3::date`,
    [HN_SOURCE, new Date(from - YEAR - IN_FORCE).toISOString().slice(0, 10), range.to]);
  const rows: Row[] = raw.map((r) => ({ ...r, value: Number(r.value) }));

  const last = await query<{ day: string | null }>(
    `SELECT max(day)::text AS day FROM work_counts WHERE source = $1 AND dataset = 'freelance-work'`,
    [HN_SOURCE]).catch(() => [{ day: null }]);

  const now = side(rows, from, to);
  const before = side(rows, from - YEAR, to - YEAR);
  const { boards, bounties } = await boardsIn(range, query).catch(() => ({ boards: [], bounties: null }));

  const order: Record<MarketStatus, number> = { new: 0, growing: 1, steady: 2, shrinking: 3 };
  const sort = (xs: MarketMove[]) => xs.sort((a, b) =>
    order[a.status] - order[b.status] || b.now - a.now);

  return {
    now, before,
    markets: now ? sort(moves(rows, WORK_MARKETS, '', now, before)) : [],
    skills: now ? sort(moves(rows, WORK_SKILLS, 'skill:', now, before)) : [],
    boards, bounties,
    lastFreelanceThread: last[0]?.day ?? null,
  };
}

/** How crowded a market is, in the words the page uses. */
export function competition(pressure: number | null): 'few candidates' | 'balanced' | 'crowded' | null {
  if (pressure === null) return null;
  if (pressure >= 1.25) return 'few candidates';
  if (pressure <= 0.8) return 'crowded';
  return 'balanced';
}

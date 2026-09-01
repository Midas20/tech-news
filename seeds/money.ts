// Sources for the two targets the archive could not see.
//
// Measured 2026-08-29. Before this file the archive held 86 sources, every one
// an engineering blog or a release feed, and the consequence was arithmetic
// rather than opinion:
//
//     3  stories classified `market` in the whole archive
//     3  funding-shaped titles in the whole archive
//     1  story naming any earning platform
//
// The market lane and the earning lane were not badly tuned. They were empty,
// because nothing in the registry covers funding, crypto or being paid. A
// bigger platform registry produced a longer page of zeroes; this is the half
// that makes those pages mean something.
//
// AUDITIONED AFTER THE SPECULATION GATE, which is the only reason a crypto
// source can be in this file at all. Every candidate was fetched live and every
// item put through the whole gauntlet in memory -- window, build noise,
// language, topical, evidence, event class -- with `speculation` in force. The
// filtering that produced these numbers is visible in them:
//
//     cointelegraph.com   2 kept of 30 offered
//     decrypt.co          5 kept of 57 offered
//     theblock.co         1 kept of 19 offered
//
// A crypto outlet is mostly price talk and the gate removes it. What survives
// Cointelegraph is "Capital B raises $24.5M" and "BitGo buys NYDIG trading
// arm" -- acquisitions and rounds, which is exactly the target.
//
// THE NUMBER THAT DECIDES IT IS THE LAST 90 DAYS, NOT THE LIFETIME.
//
// This is the correction that matters most here, and it was nearly missed. With
// RETENTION_KEEP_MONTHS=0 (keep forever) `isTooOld` is always false, so the
// audition's "in window" silently became "everything the feed carries" -- and
// several of these feeds carry their whole archive:
//
//     blog.ethereum.org   100 all-time,  3 in the last 90 days   (636 offered)
//     akash.network        40 all-time,  1 in the last 90 days
//     buttondown.com       22 all-time,  1 in the last 90 days
//     vitalik.eth.limo      9 all-time,  0 in the last 90 days
//
// Ranked on lifetime output the Ethereum Foundation blog was the strongest
// candidate offered, at 33x its real rate, and Akash and Buttondown would have
// been added as producers on the strength of posts from years ago. A retention
// setting changed what an unrelated measurement meant. Every number below is
// the 90-day one.
//
// A SHORT FEED IS NOT A QUIET SOURCE. `offered` is recorded next to `kept`
// because a floor of 3 punishes a publisher that only exposes ten items:
// Crunchbase News kept 2 of the 10 it offers and Kraken kept 9 of 10, and both
// are better bets than a 600-item archive feed yielding 3. The collector polls
// repeatedly, so a short feed with a high rate compounds.

export interface MoneySource {
  name: string;
  url: string;
  feed: string;
  /** Kept in the last 90 days, through the whole gauntlet. */
  recent: number;
  /** Items the feed offered at all, which is how to read `recent`. */
  offered: number;
  /** Share kept only by the first-party fallback. Zero for every one of these. */
  fallback: number;
  /** Which target this serves. */
  beat: 'market' | 'crypto' | 'earning';
  why: string;
}

export const MONEY_SOURCES: MoneySource[] = [
  // --- market: who is being funded and who bought whom ------------------------
  {
    name: 'TechCrunch', url: 'https://techcrunch.com/', feed: 'https://techcrunch.com/feed/',
    recent: 3, offered: 20, fallback: 0, beat: 'market',
    why: 'Rounds and acquisitions, daily. "Neocloud Lambda secures $1B in debt to buy more '
      + 'chips" is the shape the market lane was built for and had three examples of.',
  },
  {
    name: 'Crunchbase News', url: 'https://news.crunchbase.com/',
    feed: 'https://news.crunchbase.com/feed/',
    recent: 2, offered: 10, fallback: 0, beat: 'market',
    why: 'Funding is the entire beat. 2 kept of only 10 offered -- the highest rate here '
      + 'after Kraken, on the shortest feed.',
  },
  {
    name: 'Sifted', url: 'https://sifted.eu/', feed: 'https://sifted.eu/feed',
    recent: 2, offered: 24, fallback: 0, beat: 'market',
    why: 'European rounds, which the US-weighted sources miss. "Lunar founders raise €8.2m '
      + 'to launch AI-native audit startup".',
  },
  {
    name: 'Tech.eu', url: 'https://tech.eu/', feed: 'https://tech.eu/feed',
    recent: 6, offered: 20, fallback: 0, beat: 'market',
    why: 'The strongest market producer offered, at 6 of 20. European funding and M&A, '
      + 'including "NVIDIA to buy Hugging Face".',
  },

  // --- crypto: platform changes, with the price talk already removed ----------
  {
    name: 'Kraken Blog', url: 'https://blog.kraken.com/', feed: 'https://blog.kraken.com/feed',
    recent: 9, offered: 10, fallback: 0, beat: 'crypto',
    why: 'Nine of ten. An exchange listing an asset or opening staking is a change to where '
      + 'a person can earn, announced first-party and stated plainly.',
  },
  {
    name: 'Solana News', url: 'https://solana.com/news', feed: 'https://solana.com/rss.xml',
    recent: 9, offered: 20, fallback: 0, beat: 'crypto',
    why: 'Protocol changelogs and network changes from the network itself. "Solana Changelog: '
      + 'August 20, 2026" is a release note, not a price.',
  },
  {
    name: 'Ethereum Foundation Blog', url: 'https://blog.ethereum.org/',
    feed: 'https://blog.ethereum.org/en/feed.xml',
    recent: 3, offered: 636, fallback: 0, beat: 'crypto',
    why: 'Upgrades, testnets and grant programmes from the foundation. Admitted on 3, NOT on '
      + 'the 100 its whole-archive feed reports -- see the note above.',
  },
  {
    name: 'Decrypt', url: 'https://decrypt.co/', feed: 'https://decrypt.co/feed',
    recent: 3, offered: 57, fallback: 0, beat: 'crypto',
    why: 'Kept 5 of 57 with the gate in force. What survives is "BitGo Buys NYDIG\'s '
      + 'Institutional Trading Arm" and a disinflation vote passing.',
  },
  {
    name: 'Cointelegraph', url: 'https://cointelegraph.com/',
    feed: 'https://cointelegraph.com/rss',
    recent: 2, offered: 30, fallback: 0, beat: 'crypto',
    why: 'The clearest evidence the gate works: 2 of 30, and both survivors are acquisitions. '
      + 'Admitted BECAUSE the rate is low -- 28 of its 30 were the noise this archive refuses.',
  },
  {
    name: 'BitMEX Blog', url: 'https://blog.bitmex.com/', feed: 'https://blog.bitmex.com/feed',
    recent: 2, offered: 20, fallback: 0, beat: 'crypto',
    why: 'Delistings and product removals -- the end-of-life notices of an exchange, and the '
      + 'kind of change that costs somebody money.',
  },

  // --- earning: being paid by a platform --------------------------------------
  {
    name: 'YouTube Official Blog', url: 'https://blog.youtube/', feed: 'https://blog.youtube/rss',
    recent: 2, offered: 20, fallback: 0, beat: 'earning',
    why: 'Monetisation and revenue-share changes for creators, announced first-party. The '
      + 'largest earning platform in the registry by user count.',
  },
];

/** Refused, with the number, so the decision is not re-litigated. */
export const MONEY_REFUSED: { name: string; recent: number; offered: number; why: string }[] = [
  { name: 'akash.network', recent: 1, offered: 238,
    why: '40 kept all-time and 1 in the last 90 days. The archive feed made a quiet source '
      + 'look like the second-strongest candidate offered.' },
  { name: 'buttondown.com', recent: 1, offered: 628,
    why: 'Same shape: 22 all-time, 1 recent. Good changelog, not a current producer.' },
  { name: 'vitalik.eth.limo', recent: 0, offered: 175,
    why: 'Nine kept across the whole feed and none in 90 days. Essays rather than events '
      + 'in any case -- "Why I used to prefer permissive licenses" is an article.' },
  { name: 'blog.bitfinex.com', recent: 0, offered: 100,
    why: 'Four all-time, none recent, and its samples were market commentary: "Leverage '
      + 'Reheats as BTC Price Structure Weakens" is the genre the gate exists to refuse.' },
  { name: 'theblock.co', recent: 1, offered: 19,
    why: 'One of nineteen. Mostly price and flows; the gate takes almost all of it.' },
  { name: 'blockworks.co', recent: 0, offered: 50,
    why: 'One of fifty all-time, none recent. Institutional price coverage.' },
  { name: 'protos.com', recent: 1, offered: 10, why: 'One of ten, and largely scandal reporting.' },
  { name: 'venturebeat.com', recent: 1, offered: 7,
    why: 'One of seven. Mostly vendor-sourced AI features rather than market moves.' },
  { name: 'www.saastr.com', recent: 1, offered: 10, why: 'One of ten, and opinion-led.' },
  { name: 'on.substack.com', recent: 1, offered: 20,
    why: 'One of twenty. Product notes for writers rather than changes to what Substack pays.' },
  { name: 'arbitrumfoundation.medium.com', recent: 0, offered: 10,
    why: 'Two all-time, none recent. Worth revisiting: the beat is right and the feed is quiet.' },
];

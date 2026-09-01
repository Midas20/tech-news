// The sources that passed, and the flag that decided most of them.
//
// Asked for on 2026-08-31: "Expand source list that collect news".
//
// ---------------------------------------------------------------------------
// THE REGISTRY WAS NOT 88% VENDOR BY ACCIDENT. THE FILTER SELECTS FOR VENDORS.
//
// 54 candidates were auditioned against the portfolio gap -- security had two
// sources in the whole registry, research five, journalism five. Thirteen
// cleared the bar, worth about 1.5 items a day, and the refusal column said the
// same thing almost everywhere:
//
//   Krebs on Security       0 of 10   not_an_event
//   Schneier on Security    0 of 10   not_an_event
//   Dark Reading            0 of 30   not_an_event
//   IEEE Spectrum           1 of 27   not_an_event
//   The Pragmatic Engineer  0 of 14   not_an_event
//
// That is not a judgement about quality. It is `classifyEvent`, which ends:
//
//   if (opts.firstParty && shape === undefined) return { kind: 'change', ... };
//   return { kind: 'article', matched: shape };
//
// A first party gets the benefit of the doubt when nothing in the grammar
// matches. Everybody else defaults to `article`, and with EVENTS_ONLY -- on by
// default -- ingest drops articles unless `allowsArticles(source)`. So a vendor
// post that matches no pattern is kept, and the identical sentence from a
// newsroom is dropped. The archive is 88% vendor because the pipeline admits
// vendors and refuses everyone else by default.
//
// The switch already exists: `tech_only`, which is badly named -- what it does
// is `allowsArticles()`. Re-auditioned with it, the same feeds on the same day:
//
//   IEEE Spectrum           1 of 27  ->  27 of 27
//   Simon Willison          3 of 30  ->  28 of 30
//   InfoWorld               3 of 20  ->  19 of 20
//   The Pragmatic Engineer  0 of 14  ->  14 of 14
//   Schneier on Security    0 of 10  ->   8 of 10
//   Krebs on Security       0 of 10  ->   5 of 10
//
// And the refusals that remain are real topical judgements -- off_topic:crime,
// off_topic:politics, too_short -- rather than a structural veto.
//
// THIS IS A DELIBERATE CHANGE OF CHARACTER, and it is worth saying plainly:
// "release notes are events, not essays" is a rule this project chose, and for
// a vendor changelog it is exactly right. For a publication whose entire value
// is the essay, it is a rule that excludes the category. `tech_only` is set
// ONLY on the reporting and analysis sources below, never on a vendor feed,
// and it is one column -- reversible on any row, any time.

export interface MeasuredSource {
  name: string;
  url: string;
  feed: string;
  /** A first party writing about its own work. Relaxes the topic filter. */
  primary: boolean;
  /**
   * Filed with `allowsArticles`. True only where the analysis IS the product.
   */
  articles: boolean;
  sourceType:
    | 'PRIMARY_VENDOR' | 'PRIMARY_PROJECT' | 'PRIMARY_RESEARCH' | 'RESEARCH'
    | 'TECHNICAL_JOURNALISM' | 'SPECIALIST_PUBLICATION' | 'REGIONAL_PUBLICATION'
    | 'MAJOR_JOURNALISM' | 'COMMUNITY' | 'MARKET_ANALYSIS';
  categories: string[];
  domains: string[];
  kept: number;
  sampled: number;
  why: string;
}

/** Cleared the bar as EVENTS. Filed the strict way, like every vendor feed. */
export const AS_EVENTS: MeasuredSource[] = [
  { name: 'MIT News — computing', url: 'https://news.mit.edu/topic/computers',
    feed: 'https://news.mit.edu/rss/topic/computers', primary: true, articles: false,
    sourceType: 'PRIMARY_RESEARCH', categories: ['research'],
    domains: ['artificial-intelligence', 'machine-learning', 'hardware'],
    kept: 24, sampled: 30, why: 'University research announcements in computing.' },

  { name: 'Rapid7 Blog', url: 'https://www.rapid7.com/blog/',
    feed: 'https://www.rapid7.com/rss.xml', primary: true, articles: false,
    sourceType: 'PRIMARY_VENDOR', categories: ['security'],
    domains: ['cybersecurity'], kept: 19, sampled: 20,
    why: 'Vulnerability analysis and exploitation detail, 95% technical.' },

  { name: 'ESET WeLiveSecurity', url: 'https://www.welivesecurity.com/',
    feed: 'https://www.welivesecurity.com/feed', primary: true, articles: false,
    sourceType: 'PRIMARY_VENDOR', categories: ['security'],
    domains: ['cybersecurity'], kept: 19, sampled: 24,
    why: 'Malware research published from its own telemetry.' },

  { name: 'Stack Overflow Blog', url: 'https://stackoverflow.blog/',
    feed: 'https://stackoverflow.blog/feed/', primary: true, articles: false,
    sourceType: 'PRIMARY_VENDOR', categories: ['devecosystem'],
    domains: ['developer-tools', 'programming-languages'], kept: 17, sampled: 30,
    why: 'Ecosystem observations and survey data from its own traffic.' },

  { name: 'Cisco Talos', url: 'https://blog.talosintelligence.com/',
    feed: 'https://blog.talosintelligence.com/rss/', primary: true, articles: false,
    sourceType: 'PRIMARY_VENDOR', categories: ['security'],
    domains: ['cybersecurity'], kept: 13, sampled: 15,
    why: 'Threat research and malware analysis.' },

  { name: 'TechNode', url: 'https://technode.com/',
    feed: 'https://technode.com/feed/', primary: false, articles: false,
    sourceType: 'REGIONAL_PUBLICATION', categories: ['regional', 'journalism'],
    domains: ['artificial-intelligence', 'semiconductors'], kept: 11, sampled: 30,
    why: 'Chinese technology industry in English — a market the archive cannot see.' },

  { name: 'Allen Institute for AI', url: 'https://allenai.org/blog',
    feed: 'https://allenai.org/rss.xml', primary: true, articles: false,
    sourceType: 'PRIMARY_RESEARCH', categories: ['research', 'ai'],
    domains: ['artificial-intelligence', 'llms', 'open-source'], kept: 10, sampled: 17,
    why: 'Open model and dataset releases with the research behind them.' },

  { name: 'ProjectDiscovery', url: 'https://blog.projectdiscovery.io/',
    feed: 'https://blog.projectdiscovery.io/rss', primary: true, articles: false,
    sourceType: 'PRIMARY_VENDOR', categories: ['security'],
    domains: ['cybersecurity', 'developer-tools'], kept: 6, sampled: 7,
    why: 'Offensive tooling and vulnerability engineering.' },

  { name: 'arXiv cs.SE', url: 'https://arxiv.org/list/cs.SE/recent',
    feed: 'https://export.arxiv.org/rss/cs.SE', primary: false, articles: false,
    sourceType: 'RESEARCH', categories: ['research'],
    domains: ['developer-tools', 'frameworks'], kept: 5, sampled: 30,
    why: 'Software engineering preprints. EARLY_SIGNAL, never adoption evidence.' },

  { name: 'SANS Internet Storm Center', url: 'https://isc.sans.edu/',
    feed: 'https://isc.sans.edu/rssfeed.xml', primary: true, articles: false,
    sourceType: 'PRIMARY_VENDOR', categories: ['security'],
    domains: ['cybersecurity'], kept: 4, sampled: 10,
    why: 'Handler diaries: what is being exploited today.' },
];

/**
 * Cleared the bar only once ARTICLES WERE ALLOWED.
 *
 * Every one of these is a publication whose value is the writing. Filed with
 * `tech_only`, which is the flag ingest reads as `allowsArticles`.
 */
export const AS_ARTICLES: MeasuredSource[] = [
  { name: 'Simon Willison', url: 'https://simonwillison.net/',
    feed: 'https://simonwillison.net/atom/everything/', primary: false, articles: true,
    sourceType: 'SPECIALIST_PUBLICATION', categories: ['engineering', 'ai'],
    domains: ['llms', 'ai-agents', 'developer-tools'], kept: 28, sampled: 30,
    why: 'LLM tooling tracked daily by somebody building with it. 3 of 30 as events.' },

  { name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/',
    feed: 'https://spectrum.ieee.org/feeds/feed.rss', primary: false, articles: true,
    sourceType: 'TECHNICAL_JOURNALISM', categories: ['engineering', 'journalism'],
    domains: ['semiconductors', 'hardware', 'artificial-intelligence', 'robotics'],
    kept: 27, sampled: 27, why: 'Engineering journalism with real depth. 1 of 27 as events.' },

  { name: 'InfoWorld', url: 'https://www.infoworld.com/',
    feed: 'https://www.infoworld.com/feed/', primary: false, articles: true,
    sourceType: 'TECHNICAL_JOURNALISM', categories: ['engineering', 'journalism'],
    domains: ['cloud-computing', 'developer-tools', 'enterprise-software'],
    kept: 19, sampled: 20, why: 'Enterprise development and cloud trade press.' },

  { name: 'The Pragmatic Engineer', url: 'https://blog.pragmaticengineer.com/',
    feed: 'https://blog.pragmaticengineer.com/rss/', primary: false, articles: true,
    sourceType: 'SPECIALIST_PUBLICATION', categories: ['engineering', 'market'],
    domains: ['developer-tools', 'enterprise-software'], kept: 14, sampled: 14,
    why: 'Engineering practice and the industry labour market, reported. Hiring signal.' },

  { name: 'LWN security alerts', url: 'https://lwn.net/Alerts/',
    feed: 'https://lwn.net/headlines/newrss', primary: false, articles: true,
    sourceType: 'SPECIALIST_PUBLICATION', categories: ['security', 'engineering'],
    domains: ['cybersecurity', 'open-source'], kept: 10, sampled: 15,
    why: 'Distribution security advisories, aggregated.' },

  { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/',
    feed: 'https://www.bleepingcomputer.com/feed/', primary: false, articles: true,
    sourceType: 'SPECIALIST_PUBLICATION', categories: ['security', 'journalism'],
    domains: ['cybersecurity'], kept: 9, sampled: 15,
    why: 'Breaking vulnerability and ransomware coverage.' },

  { name: 'Rest of World', url: 'https://restofworld.org/',
    feed: 'https://restofworld.org/feed/latest', primary: false, articles: true,
    sourceType: 'REGIONAL_PUBLICATION', categories: ['regional', 'journalism', 'market'],
    domains: ['artificial-intelligence', 'fintech'], kept: 9, sampled: 12,
    why: 'Technology outside the US and Europe, reported locally.' },

  { name: 'Schneier on Security', url: 'https://www.schneier.com/',
    feed: 'https://www.schneier.com/feed/', primary: false, articles: true,
    sourceType: 'SPECIALIST_PUBLICATION', categories: ['security'],
    domains: ['cybersecurity', 'identity'], kept: 8, sampled: 10,
    why: 'Cryptography and security policy, original and long-running.' },

  { name: 'Console.dev', url: 'https://console.dev/',
    feed: 'https://console.dev/rss.xml', primary: false, articles: true,
    sourceType: 'SPECIALIST_PUBLICATION', categories: ['devecosystem'],
    domains: ['developer-tools'], kept: 7, sampled: 8,
    why: 'New developer tools, reviewed rather than listed.' },

  { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/',
    feed: 'https://krebsonsecurity.com/feed/', primary: false, articles: true,
    sourceType: 'SPECIALIST_PUBLICATION', categories: ['security', 'journalism'],
    domains: ['cybersecurity'], kept: 5, sampled: 10,
    why: 'Original investigative reporting on breaches and the criminal economy.' },

  { name: 'Dan Luu', url: 'https://danluu.com/',
    feed: 'https://danluu.com/atom.xml', primary: false, articles: true,
    sourceType: 'SPECIALIST_PUBLICATION', categories: ['engineering'],
    domains: ['hardware', 'developer-tools'], kept: 5, sampled: 5,
    why: 'Measured analysis of engineering practice. Infrequent and dense.' },

  { name: 'The Record', url: 'https://therecord.media/',
    feed: 'https://therecord.media/feed', primary: false, articles: true,
    sourceType: 'SPECIALIST_PUBLICATION', categories: ['security', 'journalism'],
    domains: ['cybersecurity'], kept: 4, sampled: 5,
    why: 'Security newsroom: incidents, policy, threat actors.' },

  { name: 'This Week in Rust', url: 'https://this-week-in-rust.org/',
    feed: 'https://this-week-in-rust.org/rss.xml', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['devecosystem'],
    domains: ['programming-languages', 'open-source'], kept: 4, sampled: 4,
    why: 'The Rust ecosystem weekly record. Community: proves interest, never adoption.' },

  { name: 'JavaScript Weekly', url: 'https://javascriptweekly.com/',
    feed: 'https://javascriptweekly.com/rss/', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['devecosystem'],
    domains: ['frontend', 'programming-languages'], kept: 4, sampled: 4,
    why: 'Curated ecosystem digest, hand-edited.' },
];

/** Auditioned and refused. Kept so the decision is not re-litigated. */
export const REFUSED: Array<{ name: string; note: string }> = [
  { name: 'Dark Reading', note: '0 of 30 even with articles allowed; 27 refused too_short — the feed is headlines and the pages did not yield text.' },
  { name: 'SecurityWeek', note: '0 of 10, 9 too_short. Same shape as Dark Reading.' },
  { name: 'The Changelog', note: '0 of 3, media_enclosure — it is a podcast feed, and the archive drops audio enclosures.' },
  { name: 'arXiv cs.LG', note: '0 of 30. 210 papers offered; every one classified article, and as a non-first-party venue it cannot use the articles flag without importing the whole of machine learning preprints daily.' },
  { name: 'arXiv cs.CR / cs.DC', note: '2 and 1 of 30. Below the bar as events; not given the articles flag for the same reason as cs.LG.' },
  { name: 'The Next Web', note: '1 of 10. Measured 8 of 10 in an earlier run on a different sample; left out as consumer-adjacent.' },
  { name: 'Google Project Zero, SemiAnalysis, Brendan Gregg, High Scalability, Stanford AI Lab, The Morning Paper', note: 'Feed found but zero recent items — dormant or moved.' },
  { name: 'ACM Queue, Communications of the ACM, Phoronix, Martin Fowler, PitchBook, a16z, Python Weekly, KrASIA, Analytics India, Berkeley AI Research', note: 'No feed advertised or guessable.' },
];

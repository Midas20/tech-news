// Widening the registry where it is actually narrow.
//
// Asked for on 2026-08-31: "Expand source list that collect news".
//
// The obvious reading is "add more feeds", and following it would have made the
// archive worse. Measured first: 308 sources, and 271 of them carry the
// `vendor` category. Five are journalism, five are research, five are market,
// four are engineering, and TWO are security. The archive is a release tracker
// with a rounding error of reporting attached, which is exactly the shape that
// cannot tell an announcement from an adoption -- 1.3% of stories have ever
// been reported by more than one source, because there is nobody independent to
// do the confirming.
//
// So this list is chosen against the gap, not against a ranking of famous
// sites. Nothing in it is a vendor blog.
//
// WHAT IS DELIBERATELY NOT HERE, AND WHY IT IS NOT AN OVERSIGHT.
//
// The brief's Category A names Ars Technica, TechCrunch, The Verge, WIRED,
// Engadget and VentureBeat. Every one of those is already on this project's
// off-topic host list, and it was put there with evidence rather than taste --
// forty days of measurement, in src/vocab/offtopic.ts:
//
//   TechRadar Computing   126 items, 67 off-topic,  5 events
//   Ars Technica           32 items,  6 off-topic,  3 events
//   The New Stack          36 items,  0 off-topic, 92% technical
//
// Three events in forty days is not a feed. Adding those hosts means reversing
// a measured decision, which is a call for the person who owns the archive to
// make, not something to slip into a seed file. It is raised in the report
// instead.
//
// AUDITIONED, NOT ARGUED. Nothing here is admitted by being listed. Each site
// is fetched live and every item goes through the whole gauntlet in memory --
// host, topic, build noise, event class, language, length -- calling the
// functions ingest calls, in ingest's order. Expect a good share to fail; the
// list is written long on purpose.

import type { SourceCandidate } from './candidates.ts';

/**
 * `primary` marks a first party writing about ITS OWN work, and it relaxes the
 * topic filter, so it has to be honest.
 *
 *   A security team publishing its own vulnerability research  -> primary
 *   A newsroom reporting on somebody else's breach             -> not primary
 *   A university lab publishing its own results                -> primary
 *   A venue that carries other people's papers (arXiv)         -> not primary
 */
export const BREADTH: SourceCandidate[] = [
  // --- Security. The whole of Category D, and the registry holds two. -------
  { name: 'Krebs on Security', site: 'https://krebsonsecurity.com/', primary: false,
    why: 'Original investigative reporting on breaches, fraud and the criminal economy.' },
  { name: 'BleepingComputer', site: 'https://www.bleepingcomputer.com/', primary: false,
    why: 'Breaking vulnerability and ransomware coverage, technical and fast.' },
  { name: 'The Record', site: 'https://therecord.media/', primary: false,
    why: 'Security newsroom; incidents, policy and threat actors.' },
  { name: 'Dark Reading', site: 'https://www.darkreading.com/', primary: false,
    why: 'Enterprise security trade press.' },
  { name: 'SecurityWeek', site: 'https://www.securityweek.com/', primary: false,
    why: 'Enterprise security news and vendor moves.' },
  { name: 'Schneier on Security', site: 'https://www.schneier.com/', primary: false,
    why: 'Cryptography and security policy, long-running and original.' },
  { name: 'Google Project Zero', site: 'https://googleprojectzero.blogspot.com/', primary: true,
    why: 'First-party vulnerability research at unusual depth.' },
  { name: 'Cisco Talos', site: 'https://blog.talosintelligence.com/', primary: true,
    why: 'Threat research and malware analysis from its own telemetry.' },
  { name: 'Rapid7 Blog', site: 'https://www.rapid7.com/blog/', primary: true,
    why: 'Vulnerability analysis and exploitation detail.' },
  { name: 'ESET WeLiveSecurity', site: 'https://www.welivesecurity.com/', primary: true,
    why: 'Malware research from a vendor that publishes its analysis.' },
  { name: 'SANS Internet Storm Center', site: 'https://isc.sans.edu/', primary: true,
    why: 'Daily handler diaries: what is actually being exploited today.' },
  { name: 'Microsoft Security Response Center', site: 'https://msrc.microsoft.com/blog/', primary: true,
    why: 'First-party advisories and incident write-ups.' },
  { name: 'Project Discovery', site: 'https://blog.projectdiscovery.io/', primary: true,
    why: 'Offensive tooling and vulnerability engineering.' },

  // --- Technical and engineering journalism --------------------------------
  { name: 'IEEE Spectrum', site: 'https://spectrum.ieee.org/', primary: false,
    why: 'Engineering journalism with real technical depth; semiconductors, computing, power.' },
  { name: 'Communications of the ACM', site: 'https://cacm.acm.org/', primary: false,
    why: 'The professional body\'s publication; research meeting practice.' },
  { name: 'ACM Queue', site: 'https://queue.acm.org/', primary: false,
    why: 'Practitioner-facing systems writing, commissioned from engineers.' },
  { name: 'InfoWorld', site: 'https://www.infoworld.com/', primary: false,
    why: 'Enterprise development and cloud trade press.' },
  { name: 'SemiAnalysis', site: 'https://semianalysis.com/', primary: false,
    why: 'Semiconductor and AI-infrastructure analysis; supply chain and economics.' },
  { name: 'Phoronix', site: 'https://www.phoronix.com/', primary: false,
    why: 'Linux kernel, graphics and hardware benchmarking, daily and detailed.' },
  { name: 'The Pragmatic Engineer', site: 'https://blog.pragmaticengineer.com/', primary: false,
    why: 'Engineering practice and the industry\'s labour market, reported.' },
  { name: 'Stack Overflow Blog', site: 'https://stackoverflow.blog/', primary: true,
    why: 'Developer survey data and ecosystem observations from its own traffic.' },
  { name: 'Martin Fowler', site: 'https://martinfowler.com/', primary: false,
    why: 'Architecture and design writing that the industry adopts vocabulary from.' },
  { name: 'Julia Evans', site: 'https://jvns.ca/', primary: false,
    why: 'Systems explanation from first principles; debugging, networking, git.' },
  { name: 'Dan Luu', site: 'https://danluu.com/', primary: false,
    why: 'Measured, contrarian analysis of engineering practice and hardware.' },
  { name: 'Brendan Gregg', site: 'https://www.brendangregg.com/', primary: false,
    why: 'Performance engineering and observability, at the depth practitioners need.' },
  { name: 'Simon Willison', site: 'https://simonwillison.net/', primary: false,
    why: 'LLM tooling tracked daily by somebody building with it. Measured 20 of 30 kept.' },
  { name: 'High Scalability', site: 'http://highscalability.com/', primary: false,
    why: 'Architecture case studies from production systems.' },
  { name: 'Eugene Yan', site: 'https://eugeneyan.com/', primary: false,
    why: 'Applied ML engineering; what works in production rather than in papers.' },

  // --- Research venues. EARLY_SIGNAL, explicitly not adoption. --------------
  { name: 'arXiv cs.AI', site: 'https://export.arxiv.org/rss/cs.AI', primary: false,
    why: 'Artificial intelligence preprints, the day they appear.' },
  { name: 'arXiv cs.LG', site: 'https://export.arxiv.org/rss/cs.LG', primary: false,
    why: 'Machine learning preprints.' },
  { name: 'arXiv cs.SE', site: 'https://export.arxiv.org/rss/cs.SE', primary: false,
    why: 'Software engineering research.' },
  { name: 'arXiv cs.CR', site: 'https://export.arxiv.org/rss/cs.CR', primary: false,
    why: 'Cryptography and security research.' },
  { name: 'arXiv cs.DC', site: 'https://export.arxiv.org/rss/cs.DC', primary: false,
    why: 'Distributed and parallel computing research.' },
  { name: 'Berkeley AI Research', site: 'https://bair.berkeley.edu/blog/', primary: true,
    why: 'A university lab publishing its own results in readable form.' },
  { name: 'Stanford AI Lab', site: 'https://ai.stanford.edu/blog/', primary: true,
    why: 'Lab publishing its own results.' },
  { name: 'MIT News — computing', site: 'https://news.mit.edu/rss/topic/computers', primary: true,
    why: 'University research announcements in computing.' },
  { name: 'Allen Institute for AI', site: 'https://allenai.org/blog', primary: true,
    why: 'Open model and dataset releases with the research behind them.' },
  { name: 'The Morning Paper archive', site: 'https://blog.acolyer.org/', primary: false,
    why: 'Computer science papers explained. Dormant; auditioned to find out.' },

  // --- Developer ecosystem --------------------------------------------------
  { name: 'This Week in Rust', site: 'https://this-week-in-rust.org/', primary: false,
    why: 'The Rust ecosystem\'s weekly record: RFCs, releases, calls for participation.' },
  { name: 'JavaScript Weekly', site: 'https://javascriptweekly.com/', primary: false,
    why: 'Curated ecosystem digest, hand-edited.' },
  { name: 'Python Weekly', site: 'https://www.pythonweekly.com/', primary: false,
    why: 'Curated Python ecosystem digest.' },
  { name: 'Golang Weekly', site: 'https://golangweekly.com/', primary: false,
    why: 'Curated Go ecosystem digest.' },
  { name: 'Postgres Weekly', site: 'https://postgresweekly.com/', primary: false,
    why: 'Curated Postgres digest; releases, extensions, performance.' },
  { name: 'Console.dev', site: 'https://console.dev/', primary: false,
    why: 'New developer tools, reviewed rather than listed.' },
  { name: 'The Changelog', site: 'https://changelog.com/', primary: false,
    why: 'Open source ecosystem interviews and news.' },
  { name: 'LWN security alerts', site: 'https://lwn.net/headlines/newrss', primary: false,
    why: 'Distribution security advisories, aggregated.' },

  // --- IT market and business ----------------------------------------------
  { name: 'PitchBook News', site: 'https://pitchbook.com/news', primary: false,
    why: 'Venture and private capital reporting against its own deal data.' },
  { name: 'Andreessen Horowitz', site: 'https://a16z.com/', primary: true,
    why: 'Investment theses; useful as a leading indicator of where money is going.' },
  { name: 'Rest of World', site: 'https://restofworld.org/', primary: false,
    why: 'Technology outside the US and Europe, reported locally.' },
  { name: 'The Register — enterprise', site: 'https://www.theregister.com/headlines.atom', primary: false,
    why: 'Already held; listed to confirm the feed the audition finds.' },

  // --- Regional -------------------------------------------------------------
  { name: 'TechNode', site: 'https://technode.com/', primary: false,
    why: 'Chinese technology industry, in English.' },
  { name: 'KrASIA', site: 'https://kr-asia.com/', primary: false,
    why: 'Asian technology business coverage.' },
  { name: 'Analytics India Magazine', site: 'https://analyticsindiamag.com/', primary: false,
    why: 'Indian AI and data industry; hiring and enterprise adoption.' },
  { name: 'The Next Web', site: 'https://thenextweb.com/', primary: false,
    why: 'European technology news. Measured 8 of 10 kept and left undecided before.' },
];

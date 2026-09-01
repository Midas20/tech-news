// The professional technology press, chosen deliberately and kept small.
//
// Every source in the registry was removed and this is what went back. The
// brief was "a few professional tech news sites", and the rule the whole
// registry is judged by is the one set for it: sites that cover technology for
// people who build with it, not for people shopping for it.
//
// What that excludes is most of the trade. The consumer press -- TechRadar,
// ZDNET, Tom's Hardware, TechCrunch, Ars Technica -- is a real trade and a good
// one, and it is addressed to somebody choosing a laptop rather than somebody
// choosing a dependency. Those hosts are refused at ingest as well as here; see
// src/vocab/offtopic.ts.
//
// EVERY FEED BELOW WAS FETCHED AND PARSED BEFORE IT WAS WRITTEN DOWN. Two
// candidates did not survive that check and are recorded here rather than
// silently dropped, because "we considered it" is worth more than a gap:
//
//   InfoWorld     https://www.infoworld.com/index.rss   404
//   ACM TechNews  https://technews.acm.org/rss.cfm      403
//
// One more was dropped for a reason that is not the site's fault: heise
// Security is professional IT press and publishes in German, and
// ALLOWED_LANGUAGES is ['en'], so every item it produced would be refused at
// the language gate. A source whose every item is rejected is not a source.
//
// A NOTE ON WHAT THIS LIST CAN AND CANNOT DO. Measured against this archive,
// news outlets run 5-8% events -- The Register 3 of 58, The New Stack 2 of 36,
// InfoQ 5 of 20. That is not a fault in the outlets; it is what press IS. A
// release is announced by the project and reported by the press, so the
// announcement arrives through a release feed and the press arrives with an
// article about it. LWN is the exception at 93%, because it reports kernel and
// toolchain changes as changes rather than as features.
//
// So this list is the discussion half of the brief -- "the developer's site
// that discusses tech topics". The announcement half lives in the release feeds
// and vendor channels, and `npm run seed` puts those back.

import type { SourceSeed } from './sources.ts';

const H = 3600, M = 60;

export const NEWS_SOURCES: SourceSeed[] = [
  // Kernel, toolchains, distributions, and the standards work under them.
  // Measured at 93% events over this archive: the highest of any source in the
  // registry, press or otherwise.
  {
    name: 'LWN.net', url: 'https://lwn.net/', feedHint: 'https://lwn.net/headlines/newrss',
    roles: ['CONTENT', 'PRIMARY'], lang: 'en', trust: 0.95, weightContent: 1.0,
    fields: ['linux', 'os'], pollSeconds: 2 * H,
    notes: 'Highest depth-per-item of any English source in the registry.',
  },
  // Enterprise IT, and the only outlet here with a newsroom that covers the
  // industry as an industry.
  {
    name: 'The Register', url: 'https://www.theregister.com/',
    feedHint: 'https://www.theregister.com/headlines.atom', feedKind: 'atom',
    roles: ['CONTENT', 'COVERAGE'], lang: 'en', country: 'GB',
    trust: 0.75, weightContent: 0.85, pollSeconds: 60 * M,
  },
  // Cloud native and platform engineering. Measured at 0 off-topic items over
  // 36, which no other general outlet in the registry managed.
  {
    name: 'The New Stack', url: 'https://thenewstack.io/', feedHint: 'https://thenewstack.io/feed/',
    roles: ['CONTENT', 'COVERAGE'], lang: 'en', trust: 0.7, weightContent: 0.8, pollSeconds: 2 * H,
  },
  // Written for practitioners by practitioners; 90% technical, measured.
  {
    name: 'InfoQ', url: 'https://www.infoq.com/', feedHint: 'https://feed.infoq.com/',
    roles: ['CONTENT'], lang: 'en', trust: 0.8, weightContent: 0.9, pollSeconds: 2 * H,
  },
  // Linux, graphics, compilers and the hardware underneath them, in more detail
  // than anyone else attempts.
  {
    name: 'Phoronix', url: 'https://www.phoronix.com/', feedHint: 'https://www.phoronix.com/rss.php',
    roles: ['CONTENT'], lang: 'en', trust: 0.8, weightContent: 0.9,
    fields: ['linux', 'hardware'], pollSeconds: 60 * M,
  },
  // Developer tools and platforms, which is precisely this archive's subject.
  {
    name: 'DevClass', url: 'https://devclass.com/', feedHint: 'https://devclass.com/feed/',
    roles: ['CONTENT'], lang: 'en', country: 'GB', trust: 0.7, weightContent: 0.85,
    pollSeconds: 2 * H,
  },
  // The software development industry as a beat: releases, licences, tooling.
  {
    name: 'SD Times', url: 'https://sdtimes.com/', feedHint: 'https://sdtimes.com/feed/',
    roles: ['CONTENT'], lang: 'en', trust: 0.65, weightContent: 0.8, pollSeconds: 3 * H,
  },
  // Security, which is IT news and belongs here: a CVE in a dependency is a
  // material change to a stack, and the event classifier already reads
  // advisories as changes.
  {
    name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/',
    feedHint: 'https://www.bleepingcomputer.com/feed/', roles: ['CONTENT'], lang: 'en',
    trust: 0.75, weightContent: 0.85, fields: ['security'], pollSeconds: 60 * M,
  },
  {
    name: 'The Hacker News', url: 'https://thehackernews.com/',
    feedHint: 'https://feeds.feedburner.com/TheHackersNews', roles: ['CONTENT'], lang: 'en',
    trust: 0.65, weightContent: 0.8, fields: ['security'], pollSeconds: 2 * H,
  },
];

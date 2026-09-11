// The half of the archive that does not work for the companies it covers.
//
// Asked for on 2026-09-10: "And extend news source so analysis as many as news."
//
// THE REGISTRY WAS 44 VENDOR BLOGS AND 6 JOURNALISTS. Measured that day, by
// approved source type:
//
//     44  PRIMARY_VENDOR
//     29  COMMUNITY
//     23  PRIMARY_PROJECT
//      5  TECHNICAL_JOURNALISM
//      3  SPECIALIST_PUBLICATION
//      2  MARKET_ANALYSIS
//      1  PRIMARY_RESEARCH
//      1  MAJOR_JOURNALISM
//
// The consequence shows up in every report this archive writes. Of the 120
// stories in July's period corpus, 119 were first-party -- a vendor describing
// its own product. That is excellent evidence of what a company intends and no
// evidence at all that anybody adopted it, and it is why every reading this
// archive produces has to end by saying so in `limits`.
//
// It is also why eight of the ten years cannot be read: 1,392 of the 1,402
// stories before 2025 come from five vendor blogs whose archives a backfill
// could walk. Widening the beat is the only thing that ever changes that, and
// it changes it slowly and forwards.
//
// AUDITIONED LIVE, like every other seed file here. Each feed was fetched and
// every item put through the whole gauntlet in memory -- window, build noise,
// language, topical, evidence, event class -- and these are the numbers that
// came back on 2026-09-10:
//
//     kept/recent  offered  source                top refusal
//       26/30        50     The Register          off_topic:business 2
//       22/26        26     The New Stack         not_an_event 3
//       16/20        20     Ars Technica IT       off_topic:crime 2
//       11/15        15     LWN                   too_short 4
//        9/15        15     InfoQ                 not_an_event 6
//        8/13        13     TechCrunch Venture    off_topic:business 2
//        8/10        10     Crunchbase News       not_an_event 1
//        5/30        32     Phoronix              too_short 24
//
// TWO WERE REFUSED and are recorded so the decision is not re-litigated.
//
// NONE OF THESE IS FIRST PARTY, which is the entire point and is also why they
// are filed as CONTENT rather than PRIMARY. A vendor post the parser cannot
// classify gets the benefit of the doubt -- "something happened, we cannot say
// what" -- and that rule is exactly wrong for an outlet writing about other
// people's products. An unparseable Register headline is not a change.

export interface IndependentSource {
  name: string;
  url: string;
  feed: string;
  /** What it is for, in the archive's own terms. */
  beat: 'journalism' | 'market';
  /** Items that survived the full gauntlet, of recent technology items offered. */
  kept: number;
  recent: number;
  offered: number;
  why: string;
}

export const INDEPENDENT_SOURCES: IndependentSource[] = [
  {
    name: 'The Register',
    url: 'https://www.theregister.com/',
    feed: 'https://www.theregister.com/headlines.atom',
    beat: 'journalism',
    kept: 26, recent: 30, offered: 50,
    why: 'The highest-volume independent survivor of the gate. Covers vendor '
      + 'announcements adversarially, which is the read no first-party feed can '
      + 'supply.',
  },
  {
    name: 'The New Stack',
    url: 'https://thenewstack.io/',
    feed: 'https://thenewstack.io/feed/',
    beat: 'journalism',
    kept: 22, recent: 26, offered: 26,
    why: '95% of its recent technology items cleared the gate -- the highest '
      + 'rate measured. Beat is exactly this archive: platforms, runtimes and '
      + 'the tooling around them.',
  },
  {
    name: 'Ars Technica IT',
    url: 'https://arstechnica.com/information-technology/',
    feed: 'https://arstechnica.com/information-technology/feed/',
    beat: 'journalism',
    kept: 16, recent: 20, offered: 20,
    why: 'Already the single independent voice that reached a July report. This '
      + 'adds its infrastructure beat rather than the whole site.',
  },
  {
    name: 'LWN',
    url: 'https://lwn.net/',
    feed: 'https://lwn.net/headlines/newrss',
    beat: 'journalism',
    kept: 11, recent: 15, offered: 15,
    why: 'Kernel and toolchain reporting with nobody paying for it. Its top '
      + 'refusal is `too_short` -- headline-only items -- rather than off-topic.',
  },
  {
    name: 'InfoQ',
    url: 'https://www.infoq.com/',
    feed: 'https://feed.infoq.com/',
    beat: 'journalism',
    kept: 9, recent: 15, offered: 15,
    why: 'Architecture and language-ecosystem reporting. Lower yield because '
      + 'much of it is conference write-ups, which `not_an_event` removes.',
  },
  {
    name: 'Phoronix',
    url: 'https://www.phoronix.com/',
    feed: 'https://www.phoronix.com/rss.php',
    beat: 'journalism',
    kept: 5, recent: 30, offered: 32,
    why: 'The lowest yield here and kept anyway: 24 of its refusals are '
      + '`too_short`, meaning the feed carries headlines the article pages would '
      + 'fill in. What survives is hardware and driver landings nothing else in '
      + 'this registry reports.',
  },
  {
    name: 'TechCrunch Venture',
    url: 'https://techcrunch.com/category/venture/',
    feed: 'https://techcrunch.com/category/venture/feed/',
    beat: 'market',
    kept: 8, recent: 13, offered: 13,
    why: 'THE TARGET THAT WAS EMPTY. 35 of 5,993 stories were classified '
      + '`market` because the archive does not subscribe to where funding is '
      + 'announced. The classifier was never the problem; this is.',
  },
  {
    name: 'Crunchbase News',
    url: 'https://news.crunchbase.com/',
    feed: 'https://news.crunchbase.com/feed/',
    beat: 'market',
    kept: 8, recent: 10, offered: 10,
    why: 'Rounds and acquisitions with the numbers attached, from the database '
      + 'that records them. 88% of its recent items cleared the gate.',
  },
];

export interface RefusedSource { name: string; feed: string; why: string }

/** Kept so the decision is visible and is not made twice. */
export const INDEPENDENT_REFUSED: RefusedSource[] = [
  {
    name: 'Sifted',
    feed: 'https://sifted.eu/feed',
    why: 'Cleared nothing in 90 days. European startup coverage is mostly '
      + 'company profiles and opinion, which `not_an_event` removes correctly.',
  },
  {
    name: 'SemiAnalysis',
    feed: 'https://www.semianalysis.com/feed',
    why: 'Cleared nothing in 90 days. Long-form analysis rather than events -- '
      + 'genuinely good and genuinely not what this archive collects. It is the '
      + 'category `business` was written to refuse.',
  },
];

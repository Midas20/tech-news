// The outlets that cover the market, which this archive had blocked.
//
// Reported on 2026-09-09 with fourteen headlines and their URLs: "This the AI
// news title and their url I collected, but you can't find these news, it means
// there are big problem in your source list."
//
// The report was right and the problem was not the size of the list. Seven of
// the twelve domains were on a hand-written host blocklist, refused before any
// filter saw them, under this comment in seeds/../vocab/offtopic.ts:
//
//     // Startup and venture press: the beat is who raised money, not what
//     // shipped.
//     'techcrunch.com', 'venturebeat.com', 'sifted.eu', 'crunchbase.com',
//
// That was a correct reading of the purpose on the day it was written, and the
// purpose changed under it twice: MARKET became the second target and an
// event_kind on 2026-08-28, and on 2026-09-09 the whole archive was pointed at
// "detect IT market changes and find opportunity that I can attend to work
// remotely and create income as freelancer". Under either, "who raised money"
// is not a reason to refuse an outlet -- it is one of the two things being
// collected. So the archive ran for three weeks with `market` as a first-class
// event kind and every outlet that covers it blocked at the host level, which
// is why the market lane held 3 stories against 1,560 `change`.
//
// WHAT WAS MEASURED, 2026-09-09, sampling each live feed through the whole
// gauntlet -- topic filter, build noise, event classifier, length bar -- with
// the host block lifted. `market` counts items the event classifier filed as a
// market move, which is the lane that was empty:
//
//   SiliconANGLE      29/30   market: 6
//   Crunchbase News    8/10   market: 4
//   Ars Technica      15/20   market: 0
//   Schneier           5/10   market: 0
//   The Next Web       3/10   market: 0
//   TechCrunch         1/20   market: 0   -- see the caveat below
//   Wired              0/30   market: 0   -- not admitted
//   The Verge          9/10               -- measured and STAYS BLOCKED
//
// Crunchbase returned the exact headline that was reported missing: "Mistral AI
// Raises $3.5B At $24B Valuation In Another Record European AI Round". Schneier
// returned both of the ones attributed to it. Neither was blocked; Schneier was
// simply never in the registry.
//
// THE VERGE IS THE CONTROL. It clears every gate at 9 of 10 and what it clears
// with is "there aren't AirPods with cameras yet" and "the black iPhone Pro
// returns". The consumer-press judgement in offtopic.ts is still right, and it
// is kept for exactly the outlets it was right about.
//
// ONE CAVEAT, AND IT IS THE REASON TECHCRUNCH IS HERE ON 1/20: an audition
// reads the feed only, while ingest fetches the article page for anything
// short. TechCrunch's 18 `too_short` measure its feed stubs, not its
// journalism. It is admitted on its beat, with the number written down so that
// the decision can be checked against what it actually does.

import type { MeasuredSource } from './measured-breadth.ts';

export const MARKET_PRESS: MeasuredSource[] = [
  { name: 'SiliconANGLE', url: 'https://siliconangle.com/',
    feed: 'https://siliconangle.com/feed/', primary: false, articles: true,
    sourceType: 'MARKET_ANALYSIS', categories: ['market', 'journalism'],
    domains: ['enterprise-software', 'cloud-computing', 'artificial-intelligence'],
    kept: 29, sampled: 30,
    why: 'Enterprise funding, acquisitions and deals, with bodies in the feed. '
      + 'Six market events in thirty items — the best market yield measured.' },

  { name: 'Crunchbase News', url: 'https://news.crunchbase.com/',
    feed: 'https://news.crunchbase.com/feed/', primary: false, articles: true,
    sourceType: 'MARKET_ANALYSIS', categories: ['market', 'journalism'],
    domains: ['enterprise-software', 'artificial-intelligence'],
    kept: 8, sampled: 10,
    why: 'Funding rounds with the number and the investor named. Returned the '
      + 'Mistral $3.5B round that was reported missing.' },

  { name: 'Ars Technica', url: 'https://arstechnica.com/',
    feed: 'https://feeds.arstechnica.com/arstechnica/index', primary: false,
    articles: true, sourceType: 'TECHNICAL_JOURNALISM',
    categories: ['engineering', 'security', 'journalism'],
    domains: ['cybersecurity', 'artificial-intelligence', 'open-source'],
    kept: 15, sampled: 20,
    why: 'Exploits, industry accusations and platform policy, reported with '
      + 'depth. Was swept up by the consumer-press block and is not consumer press.' },

  { name: 'Schneier on Security', url: 'https://www.schneier.com/',
    feed: 'https://www.schneier.com/feed/atom/', primary: false, articles: true,
    sourceType: 'SPECIALIST_PUBLICATION', categories: ['security', 'engineering'],
    domains: ['cybersecurity', 'artificial-intelligence'],
    kept: 5, sampled: 10,
    why: 'Security analysis rather than breach reporting. Never blocked and '
      + 'never registered; produced both headlines attributed to it in the report.' },

  { name: 'TechCrunch', url: 'https://techcrunch.com/',
    feed: 'https://techcrunch.com/feed/', primary: false, articles: true,
    sourceType: 'MARKET_ANALYSIS', categories: ['market', 'journalism'],
    domains: ['enterprise-software', 'artificial-intelligence'],
    kept: 1, sampled: 20,
    why: 'Admitted on its beat, not its audition score: 18 of 20 refusals were '
      + 'too_short against feed stubs, which ingest resolves by fetching the '
      + 'page and an audition does not. Check it after a week.' },

  { name: 'The Next Web', url: 'https://thenextweb.com/',
    feed: 'https://thenextweb.com/feed', primary: false, articles: true,
    sourceType: 'TECHNICAL_JOURNALISM', categories: ['market', 'journalism'],
    domains: ['artificial-intelligence', 'enterprise-software'],
    kept: 3, sampled: 10,
    why: 'European technology and deal coverage. Never blocked, never registered.' },
];

/**
 * Probed and not admitted, with the number, so the decision is not made twice.
 */
export const REFUSED_MARKET_PRESS = [
  { name: 'Wired',
    note: '0 of 30. Seventeen too_short against feed stubs and eleven refused '
      + 'as off_topic:commerce — a shopping-guide business attached to a '
      + 'magazine. The commerce share, not the stub length, is what keeps it '
      + 'out; TechCrunch is admitted on the same stub problem without it.' },
  { name: 'The Verge, Gizmodo, 9to5Mac',
    note: 'Measured with the host block lifted and left blocked. The Verge '
      + 'cleared 9 of 10 and cleared them with "there aren\'t AirPods with '
      + 'cameras yet" and "the black iPhone Pro returns". The consumer-press '
      + 'judgement is correct for these and stays.' },
  { name: 'VentureBeat',
    note: 'HTTP 429 on every probe. Unblocked in offtopic.ts so its links are '
      + 'no longer refused, but not registered as a source until it answers.' },
  { name: 'The Information, Business of Apps',
    note: 'HTTP 403. Both are paywalled and neither serves a public feed.' },
  { name: 'Outsource Accelerator',
    note: 'Reported as carrying "H-1B denials target IT outsourcing wage '
      + 'levels", which is the single most on-purpose headline in that list — '
      + 'labour-market intelligence for a freelancer. Not yet probed; it is an '
      + 'outsourcing trade publication rather than a technology one, and that '
      + 'is a judgement worth making deliberately rather than in passing.' },
];

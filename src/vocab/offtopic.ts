// Hosts this archive does not want, and the reason for each group.
//
// These lists began inside scripts/audit-sources.ts, where they decided which
// SOURCES to stop polling. That left a door open, and it was wide: pausing
// TechCrunch's feed does nothing about the TechCrunch article Hacker News
// submits an hour later. Measured over thirty days, 3,046 of 23,477 collected
// items pointed at a host this project had already decided it did not want --
// arriving through an aggregator instead of through the front door.
//
// So the judgement lives here now and is applied twice: to a source before it
// is polled, and to a LINK before its page is fetched. One list, two
// enforcement points, no drift.

/**
 * A feed whose contents are whatever its members posted.
 *
 * By HOST, and by host alone. The obvious shortcut is `kind = 'community'`, and
 * it is wrong: that column holds Hacker News and Reddit alongside This Week in
 * Rust, JavaScript Weekly, Postgres Weekly and Console.dev, which are
 * hand-curated newsletters and the most concentrated IT reading in the whole
 * list. Pausing those would have removed exactly the sources this exercise
 * exists to protect. `roles` does not separate them either -- Golang Weekly and
 * Fosstodon are both DISCOVERY.
 *
 * A host is a fact about who decides what appears in the feed. That is the
 * actual distinction, so it is the one used.
 */
export const SOCIAL_HOSTS = [
  // Link aggregators and boards: anyone submits, the crowd sorts.
  'news.ycombinator.com', 'ycombinator.com', 'reddit.com', 'lobste.rs',
  'slashdot.org', 'digg.com', 'tildes.net', 'v2ex.com', 'producthunt.com',
  'indiehackers.com', 'b.hatena.ne.jp', 'hatena.ne.jp', 'hatena.com',
  // Community publishing platforms: anyone posts under their own name.
  'zenn.dev', 'qiita.com', 'juejin.cn', 'oschina.net', 'dev.to', 'medium.com',
  'hackernoon.com',
  // Microblogging, including the Mastodon instances registered here.
  'mastodon.social', 'fosstodon.org', 'hachyderm.io', 'infosec.exchange',
  'bsky.app', 'twitter.com', 'x.com', 'linkedin.com', 'facebook.com',
  // Deliberately NOT substack.com: a Substack is one author's newsletter, and
  // importai.substack.com is an editorial publication that happens to be hosted
  // there. The platform is not the thing being judged.
];

/**
 * Written for a reader who is not at work.
 *
 * The consumer technology press is a real trade and a good one; it is simply
 * addressed to somebody choosing a laptop rather than somebody choosing a
 * dependency. Measured over 40 days, the difference is not subtle:
 *
 *   TechRadar Computing   126 items, 67 off-topic,  5 events
 *   ZDNET                  65 items, 25 off-topic,  1 event
 *   Tom's Hardware         60 items, 17 off-topic,  3 events
 *   TechCrunch             44 items, 14 off-topic,  4 events
 *   Ars Technica           32 items,  6 off-topic,  3 events
 *
 *   The New Stack          36 items,  0 off-topic, 92% technical
 *   InfoQ                  20 items,  0 off-topic, 90% technical
 *   Publickey              16 items,  0 off-topic, 100% technical
 *
 * The item filters can clean up after these outlets and were doing so. What
 * they cannot do is make the remainder worth polling: five events in forty days
 * from the noisiest source in the list is not a feed, it is a rounding error
 * with a bandwidth cost.
 *
 * Hackaday and LowEndBox are here for a different reason and it is worth being
 * explicit about it -- neither publishes noise. Hackaday is hobbyist
 * electronics and LowEndBox is hosting offers; both are perfectly good at what
 * they do and neither is professional IT news.
 */
export const CONSUMER_HOSTS = [
  'techradar.com', 'zdnet.com', 'tomshardware.com', 'tomsguide.com', 'cnet.com',
  'pcmag.com', 'pcworld.com', 'laptopmag.com', 'techspot.com', 'digitaltrends.com',
  'theverge.com', 'engadget.com', 'gizmodo.com', 'mashable.com', 'slashgear.com',
  'bgr.com', 'androidauthority.com', '9to5mac.com', '9to5google.com', 'macrumors.com',
  'androidcentral.com', 'windowscentral.com', 'xda-developers.com', 'lifehacker.com',
  // Startup and venture press: the beat is who raised money, not what shipped.
  'techcrunch.com', 'venturebeat.com', 'sifted.eu', 'crunchbase.com',
  // General-interest science and technology magazines.
  'arstechnica.com', 'wired.com', 'newscientist.com', 'popsci.com',
  // Hobbyist, and hosting offers.
  'hackaday.com', 'hackster.io', 'lowendbox.com', 'lowendtalk.com',
];

/**
 * Not a tech-news site at all.
 *
 * The archive wants three things: projects announcing their own releases,
 * companies announcing changes to their own products, and developers writing
 * about the work. These are the sources that are none of the three and were
 * never going to become one -- a software review marketplace, a consumer
 * review site, a hosting forum, a digital-politics campaign, and the general
 * consumer-tech magazines whose beat is the phone in your pocket.
 */
export const OFF_BEAT_HOSTS = [
  'g2.com', 'trustpilot.com', 'capterra.com', 'producthunt.com',
  'webhostingtalk.com',
  'netzpolitik.org',
  't3n.de', 'golem.de', 'sspai.com', 'tldr.tech',
];

/**
 * General-interest news.
 *
 * These outlets are good at what they do and technology is not it. What they
 * publish about a technology is a report ABOUT it, written for a reader who
 * does not use it -- which is the exact distinction the archive is built on.
 *
 * The evidence for the list is the archive's own thirty days. What came in
 * through an aggregator and survived every content gate:
 *
 *   nytimes.com     "Violet Hensley Dies at 109; Ozarks Fiddler"
 *   reuters.com     "Jellyfish-hit French nuclear plant shuts down three reactors"
 *   apnews.com      "Trump orders Navy to return to old system launching jets"
 *   economist.com   "China is now the world's greatest oil power"
 *   axios.com       "Tucker Carlson unveils 10-point manifesto"
 *
 * Note what those have in common with each other and not with this archive: a
 * plant "shuts down" and a manifesto is "unveiled", so the event classifier
 * reads them as changes and launches. The gates cannot fix this, because the
 * grammar really is the grammar of an announcement. Only the outlet gives it
 * away.
 */
export const GENERAL_NEWS_HOSTS = [
  'nytimes.com', 'theguardian.com', 'wsj.com', 'reuters.com', 'bloomberg.com',
  'ft.com', 'bbc.com', 'bbc.co.uk', 'cnbc.com', 'economist.com', 'theatlantic.com',
  'apnews.com', 'cnn.com', 'npr.org', 'washingtonpost.com', 'newyorker.com',
  'businessinsider.com', 'forbes.com', 'axios.com', 'euronews.com',
  'finance.yahoo.com', 'theconversation.com', 'time.com', 'politico.com',
  'aljazeera.com', 'latimes.com', 'nbcnews.com', 'cbsnews.com', 'usatoday.com',
  'telegraph.co.uk', 'independent.co.uk', 'dailymail.co.uk', 'vox.com', 'slate.com',
  // Not about technology at all, and both arrived through an aggregator.
  'hiringlab.indeed.com', 'hrexecutive.com',
];

/**
 * The microblogging subset of SOCIAL_HOSTS, and only that subset.
 *
 * A link to a post has no article behind it: there is nothing to extract, nothing
 * to summarise and nothing to deduplicate against. The rest of SOCIAL_HOSTS must
 * NOT be blocked at link level and the distinction matters --
 * news.ycombinator.com is an active source, and dev.to, Zenn, Qiita and Medium
 * are where a great deal of real developer writing lives. Refusing a source's
 * own links would empty the source.
 */
export const MICROBLOG_HOSTS = [
  'twitter.com', 'x.com', 'facebook.com', 'linkedin.com', 'threads.net',
  'bsky.app', 'mastodon.social', 'fosstodon.org', 'hachyderm.io', 'infosec.exchange',
];

/**
 * Hosts a broader entry would otherwise sweep up.
 *
 * Checked before the block lists, not after, so a specific keep always beats a
 * general refusal.
 */
export const ALWAYS_KEEP_HOSTS = ['developer.apple.com', 'atmarkit.itmedia.co.jp'];

/** Every host refused at link level, which is not every host refused as a source. */
export const OFF_TOPIC_HOSTS: string[] = [
  ...GENERAL_NEWS_HOSTS, ...CONSUMER_HOSTS, ...OFF_BEAT_HOSTS, ...MICROBLOG_HOSTS,
];

/** Exact host, or a subdomain of one. Never a substring: `ft.com` is not
 *  `microsoft.com`, and `x.com` is not `phoronix.com`. */
export function hostMatches(host: string, list: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return h !== '' && list.some((b) => h === b || h.endsWith(`.${b}`));
}

/** True when a link points somewhere this archive has decided not to collect. */
export function isOffTopicHost(host: string): boolean {
  if (hostMatches(host, ALWAYS_KEEP_HOSTS)) return false;
  return hostMatches(host, OFF_TOPIC_HOSTS);
}

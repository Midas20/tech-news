// First-party announcement channels: the thing itself, saying what changed.
//
// The brief is "new stacks, tools and platforms, and major changes to them",
// and the measurement behind this file says the press cannot deliver the second
// half of it. English outlets in this archive run 5-8% events (The Register 3 of
// 58, InfoQ 5 of 20): a release is ANNOUNCED by the project and REPORTED by the
// press, so what arrives through a news feed is an article about a change, days
// later, for the subset of changes an editor judged newsworthy.
//
// The announcement arrives here instead. Every row below is the publisher
// writing about its own product, which is the definition of PRIMARY, and the
// event classifier already knows what to do with it (src/collect/eventful.ts):
// a `releases` source is an event by construction, and a PRIMARY source's post
// is an event unless its own title says otherwise. That is the whole reason
// News is empty today -- the registry holds nine press outlets and nothing that
// announces.
//
// WHAT COUNTS AS A PLATFORM HERE. The 42 curated registry entries whose
// `repo_url` points at a GitHub ORGANISATION rather than a repository -- aws,
// azure, cloudflare, vercel, android, github, slack-platform, notion, unity --
// named themselves. They have no releases.atom because they are not a repo;
// they are a platform, and a platform's changelog is its announcement channel.
// This file is that list, resolved.
//
// EVERY FEED BELOW WAS FETCHED AND PARSED BEFORE IT WAS WRITTEN DOWN, on
// 2026-08-26, with its entry count and newest item checked. Four candidates did
// not survive and are recorded rather than quietly dropped:
//
//   Espressif (ESP32)  developer.espressif.com/blog/feed.xml    404
//                      www.espressif.com/en/news/rss            404
//   Figma              figma.com/release-notes/{feed.xml,rss/}  404 -- release
//                      notes are a web page with no feed of any kind
//   Fortran-lang       fortran-lang.org/{en/,}news.xml          404
//   Obsidian           forum.obsidian.md/c/announcements.rss    404 -- the
//                      changelog is a page, and the repo is not public
//
// Four more needed a second address, and the working one is what is recorded:
//
//   Cloudflare  /changelog/index.xml 404      -> /changelog/rss.xml
//   Slack       /changelog/feed 404           -> /changelog.rss (declared in
//                                                the page's <link rel=alternate>)
//   MySQL       blogs.oracle.com/mysql/rss    -> 403; GitHub tags instead
//   GHC         haskell.org/ghc/blog.atom 404 -> Discourse announcements
//
// WHAT IS NOT HERE. Per-project release feeds -- 562 of them -- are not
// hand-listed and must never be: they are derived mechanically from
// `stacks.repo_url` by `npm run sync:releases`, which probes each repo and
// promotes only the ones that actually publish. Hand-listing feeds that a
// script can derive is how a registry becomes stale.

import type { SourceSeed } from './sources.ts';

const H = 3600, M = 60;

/**
 * `kind` is explicit on every row, because it is the field the event gate reads.
 *
 *   releases  every item IS a release or a changelog entry. The classifier
 *             takes the source's word for it and never reads the title.
 *   news      a first-party blog. Most posts are announcements, some are
 *             engineering essays, and the PRIMARY role plus the title decides
 *             which -- see `firstParty` in eventful.ts.
 *
 * Getting this wrong in the generous direction turns a vendor's essay series
 * into a stream of fake releases, so it is set by what the feed actually
 * publishes rather than by who publishes it.
 */
export interface PrimarySeed extends SourceSeed {
  kind: 'releases' | 'news' | 'status';
}

// ---------------------------------------------------------------------------
// Cloud and application platforms. A changelog is the closest thing this
// archive has to ground truth: dated, first-party, and complete rather than
// curated by newsworthiness.
// ---------------------------------------------------------------------------
const PLATFORMS: PrimarySeed[] = [
  {
    name: 'AWS What’s New', url: 'https://aws.amazon.com/new/',
    feedHint: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['aws', 'cloud'], pollSeconds: 60 * M,
    notes: '100 items in the feed, several a day. The busiest source in the registry.',
  },
  {
    name: 'Azure updates', url: 'https://azure.microsoft.com/en-us/updates/',
    feedHint: 'https://www.microsoft.com/releasecommunications/api/v2/azure/rss',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['azure', 'cloud'], pollSeconds: 60 * M,
    notes: '200 items. Retirement notices arrive here first and nowhere else.',
  },
  {
    // feedKind 'api', which routes this through the adapter in
    // collect/changelogs.ts rather than the feed parser. The feed is real and
    // well-formed; it is also one entry per DAY, every entry linking to the same
    // page with a different fragment, so through the ordinary path all thirty
    // collapsed onto one URL and it produced nothing for as long as it existed.
    name: 'Google Cloud release notes', url: 'https://docs.cloud.google.com/release-notes',
    feedHint: 'https://docs.cloud.google.com/feeds/gcp-release-notes.xml',
    feedKind: 'api',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['gcp', 'cloud'], pollSeconds: 60 * M,
  },
  {
    name: 'Cloudflare changelog', url: 'https://developers.cloudflare.com/changelog/',
    feedHint: 'https://developers.cloudflare.com/changelog/rss.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['cloudflare', 'infra'], pollSeconds: 60 * M,
  },
  {
    name: 'Cloudflare blog', url: 'https://blog.cloudflare.com/',
    feedHint: 'https://blog.cloudflare.com/rss/',
    kind: 'news', roles: ['PRIMARY', 'CONTENT'], lang: 'en', trust: 0.95,
    fields: ['cloudflare', 'infra'], pollSeconds: 4 * H,
    notes: 'Announcements and engineering writing in one feed; the title decides which.',
  },
  {
    name: 'Vercel changelog', url: 'https://vercel.com/changelog',
    feedHint: 'https://vercel.com/atom', feedKind: 'atom',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['frontend', 'cloud'], pollSeconds: 2 * H,
    notes: 'The feed carries its whole history — 1,524 entries. Backfill will see all of it.',
  },
  {
    name: 'Netlify developers', url: 'https://developers.netlify.com/',
    feedHint: 'https://developers.netlify.com/feed.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 0.9,
    fields: ['frontend', 'cloud'], pollSeconds: 12 * H,
    notes: 'Quiet: newest entry was 2025-12 when checked. Polled slowly for that reason, '
      + 'not dropped — a platform that changes twice a year still changes.',
  },
  {
    name: 'GitHub changelog', url: 'https://github.blog/changelog/',
    feedHint: 'https://github.blog/changelog/feed/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['devops', 'practice'], pollSeconds: 2 * H,
    notes: 'Covers GitHub Actions, Packages and the API, which are three registry entries.',
  },
  {
    name: 'Slack platform changelog', url: 'https://api.slack.com/changelog',
    feedHint: 'https://api.slack.com/changelog.rss',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    pollSeconds: 24 * H,
    notes: 'Newest entry 2025-08 when checked. Authoritative when it does publish.',
  },
  {
    name: 'Auth0 changelog', url: 'https://auth0.com/changelog',
    feedHint: 'https://auth0.com/changelog/rss.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['security'], pollSeconds: 12 * H,
  },
  {
    name: 'Discord developer changelog', url: 'https://discord.com/developers/docs/change-log',
    feedHint: 'https://discord.com/developers/docs/change-log/rss.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0, pollSeconds: 12 * H,
  },
  {
    name: 'Notion releases', url: 'https://www.notion.so/releases',
    feedHint: 'https://www.notion.so/releases/rss.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0, pollSeconds: 24 * H,
  },
  {
    // The API changelog, not the news blog.
    //
    // `openai.com/news/rss.xml` was here and produced ZERO stories: measured
    // over 24 hours, 3,395 items examined and none kept, because the blog is
    // customer stories and policy letters. The gates were right to refuse every
    // one. Model launches, deprecations and price changes are announced on the
    // changelog, which has no feed at all -- so this is 'api' and the adapter in
    // collect/changelogs.ts reads the page. Every alternative was checked first;
    // see the note there.
    name: 'OpenAI changelog', url: 'https://platform.openai.com/docs/changelog',
    feedKind: 'api',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['ai'], pollSeconds: 4 * H,
  },
  {
    name: 'NVIDIA developer blog', url: 'https://developer.nvidia.com/blog/',
    feedHint: 'https://developer.nvidia.com/blog/feed/',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.85,
    fields: ['ai', 'hardware'], pollSeconds: 6 * H,
  },
  {
    name: 'SAP news', url: 'https://news.sap.com/',
    feedHint: 'https://news.sap.com/feed/',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.8, pollSeconds: 12 * H,
  },
];

// ---------------------------------------------------------------------------
// Operating systems, distributions and devices. The entries where a change is
// a change to the ground everything else stands on.
// ---------------------------------------------------------------------------
const SYSTEMS: PrimarySeed[] = [
  {
    name: 'Linux kernel releases', url: 'https://www.kernel.org/',
    feedHint: 'https://www.kernel.org/feeds/kdist.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['linux', 'os'], pollSeconds: 2 * H,
    notes: 'kernel.org itself. torvalds/linux publishes no GitHub releases, only tags.',
  },
  {
    name: 'Arch Linux news', url: 'https://archlinux.org/news/',
    feedHint: 'https://archlinux.org/feeds/news/',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['linux', 'os'], pollSeconds: 12 * H,
    notes: 'Nearly every item is a manual-intervention notice: a breaking change by definition.',
  },
  {
    name: 'Debian news', url: 'https://www.debian.org/News/',
    feedHint: 'https://www.debian.org/News/news', feedKind: 'atom',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['linux', 'os'], pollSeconds: 12 * H,
  },
  {
    name: 'Ubuntu security notices', url: 'https://ubuntu.com/security/notices',
    feedHint: 'https://ubuntu.com/security/notices/rss.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['linux', 'security'], pollSeconds: 6 * H,
    notes: 'USNs, not marketing. A patched CVE in a distribution package is a change to a stack.',
  },
  {
    name: 'Windows Insider blog', url: 'https://blogs.windows.com/windows-insider/',
    feedHint: 'https://blogs.windows.com/windows-insider/feed/',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.9,
    fields: ['os'], pollSeconds: 12 * H,
  },
  {
    name: 'Android Developers Blog', url: 'https://android-developers.googleblog.com/',
    feedHint: 'https://android-developers.googleblog.com/feeds/posts/default', feedKind: 'atom',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.9,
    fields: ['mobile'], pollSeconds: 6 * H,
  },
  {
    name: 'Raspberry Pi news', url: 'https://www.raspberrypi.com/news/',
    feedHint: 'https://www.raspberrypi.com/news/feed/',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.85,
    fields: ['hardware', 'embedded'], pollSeconds: 12 * H,
  },
  {
    name: 'Arduino blog', url: 'https://blog.arduino.cc/',
    feedHint: 'https://blog.arduino.cc/feed/',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.8,
    fields: ['hardware', 'embedded'], pollSeconds: 12 * H,
  },
];

// ---------------------------------------------------------------------------
// Languages, runtimes and databases whose repositories tag but never publish a
// GitHub release. Measured, not assumed: of 1,005 repositories in the registry,
// 57 tag without releasing, and they include Linux, Python, PostgreSQL, Go,
// Java, Git, Kafka and MongoDB -- the largest things in the archive. Without
// this section the derived release feeds would cover everything except what
// matters most.
// ---------------------------------------------------------------------------
const RUNTIMES: PrimarySeed[] = [
  // The four below were measured against the same gates the pipeline runs,
  // on their own most recent output, in answer to "is 174 too low". Every
  // general-press domain tested alongside them scored 0-20% events; these
  // scored 25-53%, which is better than two sources already in the registry.
  //
  //   Node.js blog      53% events   every LTS and security release
  //   Rust blog         50%          every 1.x, announced first-party
  //   Kubernetes blog   30%          releases plus the SIG announcements
  //   HashiCorp blog    25%          Terraform, Vault, Packer, Consul
  {
    name: 'Node.js blog', url: 'https://nodejs.org/en/blog',
    feedHint: 'https://nodejs.org/en/feed/blog.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['nodejs', 'javascript'], pollSeconds: 6 * H,
    notes: 'Measured 53% events -- the highest of any candidate tested. '
      + 'Every LTS line and every security release is announced here.',
  },
  {
    name: 'Rust blog', url: 'https://blog.rust-lang.org/',
    feedHint: 'https://blog.rust-lang.org/feed.xml', feedKind: 'atom',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['rust'], pollSeconds: 6 * H,
    notes: 'Measured 50% events. "Announcing Rust 1.98.0" is the release itself.',
  },
  {
    name: 'Kubernetes blog', url: 'https://kubernetes.io/blog/',
    feedHint: 'https://kubernetes.io/feed.xml', feedKind: 'atom',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['kubernetes', 'infra', 'devops'], pollSeconds: 3 * H,
    notes: 'Measured 30% events, 0% refused -- better than two press sources '
      + 'already kept. Carries etcd and Gateway API announcements too.',
  },
  {
    name: 'HashiCorp blog', url: 'https://www.hashicorp.com/blog',
    feedHint: 'https://www.hashicorp.com/blog/feed.xml', feedKind: 'atom',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['terraform', 'devops', 'infra'], pollSeconds: 6 * H,
    notes: 'Measured 25% events, 0% refused. Terraform, Vault, Packer and '
      + 'Consul releases in one first-party channel.',
  },
  {
    name: 'Python Insider', url: 'https://pythoninsider.blogspot.com/',
    feedHint: 'https://pythoninsider.blogspot.com/feeds/posts/default', feedKind: 'atom',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['python'], pollSeconds: 6 * H,
    notes: 'The official release announcement channel: every 3.x is announced here.',
  },
  {
    name: 'Go blog', url: 'https://go.dev/blog/',
    feedHint: 'https://go.dev/blog/feed.atom', feedKind: 'atom',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['go'], pollSeconds: 6 * H,
  },
  {
    name: 'PostgreSQL news', url: 'https://www.postgresql.org/about/newsarchive/',
    feedHint: 'https://www.postgresql.org/news.rss',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['postgresql', 'data'], pollSeconds: 6 * H,
  },
  {
    name: 'Inside Java', url: 'https://inside.java/',
    feedHint: 'https://inside.java/feed.xml', feedKind: 'atom',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.95,
    fields: ['java'], pollSeconds: 6 * H,
    notes: 'Oracle’s JDK channel: JEPs, release candidates and GA announcements.',
  },
  {
    name: 'V8 blog', url: 'https://v8.dev/blog',
    feedHint: 'https://v8.dev/blog.atom', feedKind: 'atom',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.95,
    fields: ['javascript', 'web-platform'], pollSeconds: 24 * H,
  },
  {
    name: 'Django weblog', url: 'https://www.djangoproject.com/weblog/',
    feedHint: 'https://www.djangoproject.com/rss/weblog/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['python', 'backend'], pollSeconds: 12 * H,
  },
  {
    name: 'Lua news', url: 'https://www.lua.org/news.html',
    feedHint: 'https://www.lua.org/news.rss',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['languages'], pollSeconds: 24 * H,
  },
  {
    name: 'Haskell announcements', url: 'https://discourse.haskell.org/c/announcements/10',
    feedHint: 'https://discourse.haskell.org/c/announcements/10.rss',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 0.9,
    fields: ['languages'], pollSeconds: 24 * H,
    notes: 'GHC’s own blog feed is gone; Discourse announcements is where releases land now.',
  },
  {
    name: 'MongoDB blog', url: 'https://www.mongodb.com/blog',
    feedHint: 'https://www.mongodb.com/blog/rss',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.85,
    fields: ['data'], pollSeconds: 12 * H,
  },
  {
    name: 'WebAssembly news', url: 'https://webassembly.org/',
    feedHint: 'https://webassembly.org/feed.xml', feedKind: 'atom',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.9,
    fields: ['web-platform'], pollSeconds: 24 * H,
    notes: 'Six entries and years between them. Kept because a WASM standards move is rare '
      + 'and large, which is the definition of what this archive is for.',
  },
  {
    name: 'WordPress news', url: 'https://wordpress.org/news/',
    feedHint: 'https://wordpress.org/news/feed/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['web-platform'], pollSeconds: 12 * H,
  },
  {
    name: 'Unity blog', url: 'https://blog.unity.com/',
    feedHint: 'https://blog.unity.com/feed',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.85,
    fields: ['gamedev'], pollSeconds: 12 * H,
  },
  {
    name: 'Unreal Engine news', url: 'https://www.unrealengine.com/en-US/news',
    feedHint: 'https://www.unrealengine.com/en-US/rss',
    kind: 'news', roles: ['PRIMARY'], lang: 'en', trust: 0.85,
    fields: ['gamedev'], pollSeconds: 12 * H,
  },
];

// ---------------------------------------------------------------------------
// Tag feeds, for repositories that ship by tagging. `tags.atom` gives a version
// and a date and no notes, which is thin -- and a version with a date is still
// the fact this archive is built to record. Only where nothing better exists:
// Python, PostgreSQL, Go and the kernel all have real announcement channels
// above, so they are NOT here.
// ---------------------------------------------------------------------------
const TAGS: PrimarySeed[] = [
  {
    name: 'Apache Kafka tags', url: 'https://github.com/apache/kafka',
    feedHint: 'https://github.com/apache/kafka/tags.atom', feedKind: 'atom',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['data'], pollSeconds: 12 * H,
    notes: 'kafka.apache.org/blog.atom is 404; the tag feed is the only machine-readable one.',
  },
  {
    name: 'MySQL Server tags', url: 'https://github.com/mysql/mysql-server',
    feedHint: 'https://github.com/mysql/mysql-server/tags.atom', feedKind: 'atom',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['data'], pollSeconds: 12 * H,
    notes: 'Oracle’s MySQL blog returns 403 to any non-browser client.',
  },
  {
    name: 'Git tags', url: 'https://github.com/git/git',
    feedHint: 'https://github.com/git/git/tags.atom', feedKind: 'atom',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['practice'], pollSeconds: 12 * H,
  },
];

export const PRIMARY_SOURCES: PrimarySeed[] = [
  ...PLATFORMS, ...SYSTEMS, ...RUNTIMES, ...TAGS,
  // --- more first-party changelogs -------------------------------------------
  //
  // The registry was cut from 367 sources to the ones that report a TECHNOLOGY
  // changing rather than an incident at a company, and these are added under
  // that same rule: every one is a vendor publishing its own release notes.
  // Nothing here is press, opinion, or a company's marketing blog.
  //
  // The seeder checks each feed and records what answered, so a URL that has
  // moved shows up as a paused source with a reason rather than as silence.
  {
    name: 'Docker changelog', url: 'https://docs.docker.com/manuals/',
    feedHint: 'https://www.docker.com/blog/feed/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['devops', 'infra'], pollSeconds: 12 * H,
  },
  {
    name: 'PostgreSQL news', url: 'https://www.postgresql.org/about/newsarchive/',
    feedHint: 'https://www.postgresql.org/news.rss',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['data'], pollSeconds: 12 * H,
  },
  {
    name: 'Python Insider', url: 'https://pythoninsider.blogspot.com/',
    feedHint: 'https://feeds.feedburner.com/PythonInsider',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['languages'], pollSeconds: 12 * H,
  },
  {
    name: 'PHP releases', url: 'https://www.php.net/releases/',
    feedHint: 'https://www.php.net/feed.atom',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['languages'], pollSeconds: 12 * H,
  },
  {
    name: 'Mozilla Firefox releases', url: 'https://www.mozilla.org/firefox/releases/',
    feedHint: 'https://blog.mozilla.org/en/feed/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['web-platform'], pollSeconds: 12 * H,
  },
  {
    name: 'Chrome Developers', url: 'https://developer.chrome.com/blog',
    feedHint: 'https://developer.chrome.com/static/blog/feed.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['web-platform'], pollSeconds: 12 * H,
  },
  {
    name: 'WebKit blog', url: 'https://webkit.org/blog/',
    feedHint: 'https://webkit.org/feed/atom/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['web-platform'], pollSeconds: 12 * H,
  },
  {
    name: 'Deno blog', url: 'https://deno.com/blog',
    feedHint: 'https://deno.com/feed',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['languages', 'web-platform'], pollSeconds: 12 * H,
  },
  {
    name: 'Elastic blog', url: 'https://www.elastic.co/blog/',
    feedHint: 'https://www.elastic.co/blog/feed',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 0.95,
    fields: ['data', 'infra'], pollSeconds: 12 * H,
  },
  {
    name: 'GitLab releases', url: 'https://about.gitlab.com/releases/',
    feedHint: 'https://about.gitlab.com/atom.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['devops'], pollSeconds: 12 * H,
  },
  {
    name: 'Grafana blog', url: 'https://grafana.com/blog/',
    feedHint: 'https://grafana.com/blog/index.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 0.95,
    fields: ['infra', 'devops'], pollSeconds: 12 * H,
  },
  {
    name: 'MongoDB blog', url: 'https://www.mongodb.com/blog',
    feedHint: 'https://www.mongodb.com/blog/rss',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 0.95,
    fields: ['data'], pollSeconds: 12 * H,
  },
  {
    name: 'Redis blog', url: 'https://redis.io/blog/',
    feedHint: 'https://redis.io/blog/feed/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 0.95,
    fields: ['data'], pollSeconds: 12 * H,
  },
  {
    name: 'Debian news', url: 'https://www.debian.org/News/',
    feedHint: 'https://www.debian.org/News/news',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['os'], pollSeconds: 24 * H,
  },
  {
    name: 'Fedora Magazine', url: 'https://fedoramagazine.org/',
    feedHint: 'https://fedoramagazine.org/feed/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 0.9,
    fields: ['os'], pollSeconds: 24 * H,
  },
  {
    name: 'Docker Engine release notes', url: 'https://docs.docker.com/engine/release-notes/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['devops', 'infra'], pollSeconds: 24 * H,
  },
  {
    name: 'Terraform releases', url: 'https://github.com/hashicorp/terraform/releases',
    feedHint: 'https://github.com/hashicorp/terraform/releases.atom',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['devops', 'infra'], pollSeconds: 12 * H,
  },
  {
    name: 'Swift blog', url: 'https://www.swift.org/blog/',
    feedHint: 'https://www.swift.org/atom.xml',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['languages', 'mobile'], pollSeconds: 24 * H,
  },
  {
    name: 'Kotlin blog', url: 'https://blog.jetbrains.com/kotlin/',
    feedHint: 'https://blog.jetbrains.com/kotlin/feed/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['languages', 'mobile'], pollSeconds: 24 * H,
  },
  {
    name: '.NET blog', url: 'https://devblogs.microsoft.com/dotnet/',
    feedHint: 'https://devblogs.microsoft.com/dotnet/feed/',
    kind: 'releases', roles: ['PRIMARY'], lang: 'en', trust: 1.0,
    fields: ['languages', 'backend'], pollSeconds: 12 * H,
  },
];

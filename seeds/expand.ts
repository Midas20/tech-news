// The registry, expanded against the rules as they now stand.
//
//   npm run sources:expand             what would change
//   npm run sources:expand -- --apply  do it
//
// The registry was cut to 52 sources under rules that had one target. It now
// has two -- new stacks, and market -- and a grammar that reads a version title
// and a vendor changelog it used to refuse. So the cut was re-run as an
// AUDITION rather than an argument: every paused source and every candidate had
// its live feed fetched and every item put through the whole gauntlet in
// memory -- retention window, build noise, topical, event class -- and the
// count of what would survive is the number beside its name below.
//
// Nothing here is a guess about what a publisher is like. Every line is what
// one actually published in the last four months.
//
// TWO NUMBERS PER SOURCE, and the second is the interesting one:
//
//   kept       items that would become stories
//   fallback   the share of those kept ONLY by the first-party fallback --
//              the rule that says "a vendor post we cannot parse is a change"
//
// A high fallback share means the source writes essays that survive on the
// publisher's identity rather than on anything the sentence says. It is a
// quality signal and NOT a threshold: measured across the live registry, the
// fallback already carries 55% of everything and the median source sits at 64%
// (NVIDIA 95%, Redis 92%, Cloudflare 70%). Rejecting on it would mean rejecting
// most of what is already there. It is used here to break ties and to say out
// loud which additions are thin.

export interface Candidate {
  name: string;
  url: string;
  feed: string;
  /** Items that survived the whole gauntlet, measured 2026-08-28. */
  kept: number;
  /** Share of those kept only by the first-party fallback. */
  fallback: number;
  why: string;
}

/**
 * Paused sources the audition brings back.
 *
 * 193 were auditioned; 179 produce nothing and stay paused, which is the
 * repository release feeds doing exactly what they were paused for.
 */
export const UNPAUSE: Candidate[] = [
  { name: 'Android Developers Blog', url: 'https://android-developers.googleblog.com/',
    feed: 'https://android-developers.googleblog.com/feeds/posts/default',
    kept: 25, fallback: 0, why: 'the platform, first-party; 25 of 25 items survive' },
  { name: 'AWS News Blog', url: 'https://aws.amazon.com/blogs/aws/',
    feed: 'https://aws.amazon.com/blogs/aws/feed/',
    kept: 20, fallback: 0, why: 'zero URL overlap with AWS What’s New; a different channel, not a copy' },
  { name: 'Cloudflare blog', url: 'https://blog.cloudflare.com/',
    feed: 'https://blog.cloudflare.com/rss/',
    kept: 20, fallback: 0, why: 'zero overlap with the changelog; announcements and engineering' },
  { name: 'GitLab releases', url: 'https://about.gitlab.com/releases/',
    feed: 'https://about.gitlab.com/releases.xml',
    kept: 20, fallback: 0, why: '1 of 20 already held; GitLab Blog produces 4 and this produces 20' },
  { name: 'Apple Newsroom', url: 'https://www.apple.com/newsroom/',
    feed: 'https://www.apple.com/newsroom/rss-feed.rss',
    kept: 15, fallback: 0, why: 'hardware platform launches: Mac Studio M5 Max, Mac mini M6' },
  { name: 'Ubuntu Blog', url: 'https://ubuntu.com/blog',
    feed: 'https://ubuntu.com/blog/feed',
    kept: 12, fallback: 0, why: 'first-party for a distribution people run' },
  { name: '.NET blog', url: 'https://devblogs.microsoft.com/dotnet/',
    feed: 'https://devblogs.microsoft.com/dotnet/feed/',
    kept: 10, fallback: 0, why: 'first-party for the .NET runtime and the C# toolchain' },
  { name: 'Django weblog', url: 'https://www.djangoproject.com/weblog/',
    feed: 'https://www.djangoproject.com/rss/weblog/',
    kept: 10, fallback: 0, why: 'first-party for Django, and the Python web stack it anchors' },
  { name: 'WordPress news', url: 'https://wordpress.org/news/',
    feed: 'https://wordpress.org/news/feed/',
    kept: 10, fallback: 0, why: 'WordPress 7.1 "Mary Lou"; the platform under a third of the web' },
  { name: 'Swift blog', url: 'https://www.swift.org/blog/',
    feed: 'https://www.swift.org/atom.xml',
    kept: 9, fallback: 0,
    why: 'eight months of "What’s new in Swift" -- refused on its first word until the changelog rule' },
  { name: 'The Register', url: 'https://www.theregister.com/',
    feed: 'https://www.theregister.com/headlines.atom',
    kept: 7, fallback: 0,
    why: 'the marginal call: 7 of 50 in-window, and the only market-beat voice in the registry' },
  { name: 'Mozilla Hacks', url: 'https://hacks.mozilla.org/',
    feed: 'https://hacks.mozilla.org/feed/',
    kept: 5, fallback: 0, why: '"Intent to Ship: JPEG XL" -- the web platform changing, in advance' },
];

/** New to the registry. Each feed fetched and auditioned before it was written. */
export const ADD: Candidate[] = [
  { name: 'Python Insider', url: 'https://blog.python.org/',
    feed: 'https://blog.python.org/feeds/posts/default',
    kept: 16, fallback: 19, why: 'CPython itself; "RISC-V is now officially supported by CPython"' },
  { name: 'Astro blog', url: 'https://astro.build/blog/',
    feed: 'https://astro.build/rss.xml',
    kept: 10, fallback: 10, why: 'Astro 7.2 and a monthly changelog; the cleanest new-stack feed found' },
  { name: 'Chrome for Developers', url: 'https://developer.chrome.com/blog',
    feed: 'https://developer.chrome.com/static/blog/feed.xml',
    kept: 9, fallback: 44, why: 'the web platform from the engine that ships it' },
  { name: 'Angular blog', url: 'https://blog.angular.dev/',
    feed: 'https://blog.angular.dev/feed',
    kept: 9, fallback: 89, why: 'a framework people run; thin on parseable announcements' },
  { name: 'Ruby news', url: 'https://www.ruby-lang.org/en/news/',
    feed: 'https://www.ruby-lang.org/en/feeds/news.rss',
    kept: 7, fallback: 0, why: 'releases and CVEs, nothing else; 0% fallback' },
  { name: 'Ruby on Rails blog', url: 'https://rubyonrails.org/blog',
    feed: 'https://rubyonrails.org/feed.xml',
    kept: 7, fallback: 86, why: 'the framework; essay-heavy, kept for the releases' },
  { name: 'Laravel News', url: 'https://laravel-news.com/',
    feed: 'https://feed.laravel-news.com/',
    kept: 5, fallback: 80, why: 'the PHP stack, otherwise absent from the registry entirely' },
  { name: 'Svelte blog', url: 'https://svelte.dev/blog',
    feed: 'https://svelte.dev/blog/rss.xml',
    kept: 5, fallback: 0, why: '"The SvelteKit 3 Release Candidate is here"; 0% fallback' },
  { name: 'Bun blog', url: 'https://bun.com/blog',
    feed: 'https://bun.com/rss.xml',
    kept: 3, fallback: 33, why: 'Bun 1.4; a new runtime, which is the target' },
  { name: 'Deno blog', url: 'https://deno.com/blog',
    feed: 'https://deno.com/feed',
    kept: 3, fallback: 0, why: 'Deno 2.9, 2.8; a new runtime' },
  { name: 'TypeScript blog', url: 'https://devblogs.microsoft.com/typescript/',
    feed: 'https://devblogs.microsoft.com/typescript/feed/',
    kept: 2, fallback: 0, why: 'low volume, highest value: "Announcing TypeScript 7.0"' },
  { name: 'NixOS announcements', url: 'https://nixos.org/blog/',
    feed: 'https://nixos.org/blog/announcements-rss.xml',
    kept: 2, fallback: 50, why: 'NixOS 26.05 released; releases only, by design' },
  { name: 'Bazel blog', url: 'https://blog.bazel.build/',
    feed: 'https://blog.bazel.build/feed.xml',
    kept: 2, fallback: 100, why: 'a build system people run; low volume is the point' },
  { name: 'Zig news', url: 'https://ziglang.org/news/',
    feed: 'https://ziglang.org/news/index.xml',
    kept: 1, fallback: 100, why: 'a genuinely new stack; one item in four months is what that looks like' },
  { name: 'Elastic blog', url: 'https://www.elastic.co/blog',
    feed: 'https://www.elastic.co/blog/feed',
    kept: 20, fallback: 65, why: '"What’s new in ECK 3.5" and five releases' },
  { name: 'Neon blog', url: 'https://neon.com/blog',
    feed: 'https://neon.com/blog/rss.xml',
    kept: 27, fallback: 85, why: 'a Postgres platform being bet on; thin, and watch it' },
  { name: 'PlanetScale blog', url: 'https://planetscale.com/blog',
    feed: 'https://planetscale.com/blog/rss.xml',
    kept: 16, fallback: 94, why: 'a database platform; the thinnest addition here by the fallback measure' },
  { name: 'Linear changelog', url: 'https://linear.app/changelog',
    feed: 'https://linear.app/rss/changelog.xml',
    kept: 12, fallback: 83, why: 'an actual changelog, which is the format this archive is built for' },
];

/**
 * Found by asking what a source we already trust is like.
 *
 * `npm run discover:similar` seeded sitelike.org with all 60 producing sources
 * and returned 1,246 distinct domains; 450 were probed, 91 publish a readable
 * feed, 10 cleared the floor of 3. These are the ones worth a row.
 *
 * The script PROPOSES and this file DECIDES. Its --apply would have taken all
 * ten, and six of the ten are vendor marketing or trade press -- so the
 * proposals come here to be read, exactly as the hand-picked candidates were.
 */
export const DISCOVERED: Candidate[] = [
  { name: 'Next.js blog', url: 'https://nextjs.org/blog',
    feed: 'https://nextjs.org/feed.xml',
    kept: 5, fallback: 0,
    why: 'security releases for the framework the registry already tracks through Vercel' },
  { name: 'WordPress.com changelog', url: 'https://wordpress.com/blog/',
    feed: 'https://wordpress.com/blog/feed/',
    kept: 4, fallback: 0,
    why: 'the hosting product, a different channel from wordpress.org news' },
  { name: 'Express.js blog', url: 'https://expressjs.com/',
    feed: 'https://expressjs.com/feed.xml',
    kept: 3, fallback: 0,
    why: 'security releases for the most-deployed Node framework, absent until now' },
  { name: 'Netlify blog', url: 'https://www.netlify.com/blog/',
    feed: 'https://netlify.com/feed.xml',
    kept: 2, fallback: 0,
    why: 'below the floor but 0% fallback, and this project had already written it off as feedless' },
];

/**
 * Auditioned and refused, with the number that decided it.
 *
 * Kept in the file for the same reason story_rejects keeps a refusal: a
 * decision with no record is one somebody re-litigates in six months.
 */
export const REFUSED: { name: string; kept: number; why: string }[] = [
  // From the sitelike sweep. Six of the ten that cleared the floor.
  { name: 'itwire.com', kept: 85,
    why: 'IT trade press republishing vendor releases -- "Plaud Unveils the Wearable AI Earbuds"; would be a top-three producer' },
  { name: 'linode.com', kept: 12,
    why: 'Akamai security thought-leadership under the Linode domain, not the Linode changelog' },
  { name: 'launchpad.net', kept: 7,
    why: 'every package on Ubuntu releasing -- "[dcplusplus] DC++ 0.884 is out" -- build log at distribution scale' },
  { name: 'datadoghq.com', kept: 5,
    why: 'a real platform, but what it publishes is product marketing with a security byline' },
  { name: 'javaworld.com', kept: 3,
    why: 'covers real releases and covers them second; the first-party channels are already here' },
  { name: 'itsfoss.com', kept: 3,
    why: 'enthusiast Linux coverage; the same releases arrive from Debian, Arch and Ubuntu directly' },
  { name: 'logz.io', kept: 3, why: 'vendor marketing -- "Open 360 AI chat is now powered by OrionIQ"' },

  { name: 'Vercel Blog', kept: 379,
    why: 'the same feed as Vercel changelog -- 379 of its URLs are already held, of 380' },
  { name: 'Temporal blog', kept: 54,
    why: '80% fallback over 54 items: the largest single source of unparseable vendor essays offered' },
  { name: 'Prisma blog', kept: 42,
    why: '86% fallback; "Prisma Is Building the Stack for the Next Million Products" is not an event' },
  { name: 'Sourcegraph blog', kept: 12,
    why: '75% fallback, and what survives is commentary on other people’s tools' },
  { name: 'Confluent blog', kept: 9, why: '78% fallback; customer stories with a first-party byline' },
  { name: 'Raspberry Pi news', kept: 10,
    why: 'hobby hardware -- "Create your own cyberdeck" -- which the source test has always excluded' },
  { name: 'MongoDB blog', kept: 5, why: '100% fallback: five items, none of them placeable' },
  { name: 'Rancher / SUSE', kept: 5,
    why: '"The Art of the Possible: Unlocking Enterprise Value" -- marketing, first-party or not' },
  { name: 'Flutter (Medium)', kept: 8,
    why: 'a Medium mirror, not the first-party channel, and Antigravity marketing besides' },
  { name: 'DigitalOcean changelog', kept: 12,
    why: 'titles are bare dates -- "27 August 2026 (inference)" -- which carry no story' },
  { name: 'V8 blog', kept: 0, why: 'nothing published inside the window' },
  { name: 'Vue.js blog', kept: 0, why: 'nothing published inside the window' },
  { name: 'Anthropic news', kept: 0, why: 'no feed found at any of the usual addresses; worth revisiting by hand' },
  { name: 'Snowflake / Netlify / PyPI', kept: 0, why: 'no reachable feed at the addresses tried' },
];

// The source registry (spec 2.2).
//
// Feed URLs are deliberately NOT hardcoded. Each row seeds the site URL; the
// fetcher resolves the feed on first poll via <link rel="alternate"> and stores
// what it found. `feedHint` is a starting guess only -- when autodiscovery
// disagrees with the hint, autodiscovery wins and the row is updated.
//
// Roughly 200 rows here, plus ~205 GitHub release feeds derived from the stack
// taxonomy, plus whatever the discovery loop adds. The registry is meant to grow
// past 1,000 by itself; hand-listing 1,150 feeds would be stale within a month.

export interface SourceSeed {
  name: string;
  url: string;
  feedHint?: string;
  roles: string[];
  lang?: 'en' | 'ja' | 'de' | 'zh';
  country?: string;
  trust?: number;          // EXPERIENCE scoring weight
  weightContent?: number;  // 0 = pure coverage detector
  neverCanonical?: boolean;
  fields?: string[];
  pollSeconds?: number;
  feedKind?: 'rss' | 'atom' | 'jsonfeed' | 'api' | 'imap' | 'html';
  requiresSecret?: string;
  notes?: string;
  /**
   * The company whose own channel this is.
   *
   * Set only for rows derived from COMPANY_SEEDS[].announce. It is what makes
   * an announcement distinguishable from coverage, and the column it fills has
   * existed unused since the company registry was written.
   */
  companySlug?: string;
}

import { ANNOUNCE_SOURCES } from './announce.ts';

const H = 3600, M = 60;

// ---------------------------------------------------------------------------
// Aggregators and community. These supply what is rising, not what is written.
// ---------------------------------------------------------------------------
const AGGREGATORS: SourceSeed[] = [
  { name: 'Hacker News', url: 'https://news.ycombinator.com/', feedKind: 'api',
    feedHint: 'https://hacker-news.firebaseio.com/v0/topstories.json',
    roles: ['DISCOVERY', 'EXPERIENCE'], lang: 'en', trust: 0.85, weightContent: 0.2,
    neverCanonical: true, pollSeconds: 10 * M,
    notes: 'Comment threads are the EXPERIENCE signal; the link itself belongs to its own source.' },

  { name: 'Show HN', url: 'https://news.ycombinator.com/show', feedKind: 'api',
    feedHint: 'https://hacker-news.firebaseio.com/v0/showstories.json',
    roles: ['LAUNCH', 'DISCOVERY'], lang: 'en', trust: 0.8, weightContent: 0.2,
    neverCanonical: true, pollSeconds: 10 * M },

  { name: 'Lobste.rs', url: 'https://lobste.rs/', feedKind: 'jsonfeed',
    feedHint: 'https://lobste.rs/hottest.json',
    roles: ['DISCOVERY', 'CONTENT'], lang: 'en', trust: 0.8, pollSeconds: 30 * M,
    notes: 'Asks for no more than one request per minute. 30m is well inside that.' },

  { name: 'Bluesky (tech feed)', url: 'https://bsky.app/', feedKind: 'api',
    feedHint: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed',
    roles: ['DISCOVERY', 'EXPERIENCE'], lang: 'en', trust: 0.6, weightContent: 0.1,
    neverCanonical: true, pollSeconds: 15 * M, requiresSecret: 'BLUESKY_APP_PASSWORD' },

  { name: 'Fosstodon', url: 'https://fosstodon.org/', feedKind: 'api',
    roles: ['DISCOVERY'], lang: 'en', trust: 0.6, weightContent: 0.1, neverCanonical: true,
    pollSeconds: 15 * M },
  { name: 'Hachyderm', url: 'https://hachyderm.io/', feedKind: 'api',
    roles: ['DISCOVERY'], lang: 'en', trust: 0.6, weightContent: 0.1, neverCanonical: true,
    pollSeconds: 15 * M },
  { name: 'infosec.exchange', url: 'https://infosec.exchange/', feedKind: 'api',
    roles: ['DISCOVERY'], lang: 'en', trust: 0.6, weightContent: 0.1, neverCanonical: true,
    fields: ['security'], pollSeconds: 15 * M },
  { name: 'mastodon.social', url: 'https://mastodon.social/', feedKind: 'api',
    roles: ['DISCOVERY'], lang: 'en', trust: 0.5, weightContent: 0.1, neverCanonical: true,
    pollSeconds: 15 * M },

  { name: 'Hatena Bookmark IT', url: 'https://b.hatena.ne.jp/hotentry/it',
    feedHint: 'https://b.hatena.ne.jp/hotentry/it.rss',
    roles: ['DISCOVERY'], lang: 'ja', country: 'JP', trust: 0.7, weightContent: 0.2,
    neverCanonical: true, pollSeconds: 30 * M },

  { name: 'Product Hunt', url: 'https://www.producthunt.com/', feedKind: 'api',
    roles: ['LAUNCH'], lang: 'en', trust: 0.5, weightContent: 0.2, neverCanonical: true,
    pollSeconds: 24 * H, requiresSecret: 'PRODUCTHUNT_TOKEN' },

  // Optional and never a dependency: approval is a slow manual queue with a real
  // chance of silent rejection, and the free tier is non-commercial only.
  { name: 'Reddit (programming clusters)', url: 'https://www.reddit.com/', feedKind: 'api',
    roles: ['DISCOVERY', 'EXPERIENCE'], lang: 'en', trust: 0.5, weightContent: 0.1,
    neverCanonical: true, pollSeconds: 30 * M, requiresSecret: 'REDDIT_CLIENT_SECRET',
    notes: 'Non-commercial free tier. Stays disabled until approval AND a licence review.' },
];

// ---------------------------------------------------------------------------
// Primary technical. First-party and authoritative: this is what drives importance.
// ---------------------------------------------------------------------------
const PRIMARY: SourceSeed[] = [
  { name: 'npm registry', url: 'https://registry.npmjs.org/', feedKind: 'api',
    roles: ['PRIMARY', 'LAUNCH'], lang: 'en', fields: ['javascript'], pollSeconds: 30 * M },
  { name: 'PyPI', url: 'https://pypi.org/', feedHint: 'https://pypi.org/rss/updates.xml',
    roles: ['PRIMARY', 'LAUNCH'], lang: 'en', fields: ['python'], pollSeconds: 30 * M },
  { name: 'crates.io', url: 'https://crates.io/', feedKind: 'api',
    roles: ['PRIMARY', 'LAUNCH'], lang: 'en', fields: ['rust'], pollSeconds: 30 * M },
  { name: 'RubyGems', url: 'https://rubygems.org/', feedKind: 'api',
    roles: ['PRIMARY', 'LAUNCH'], lang: 'en', fields: ['ruby'], pollSeconds: 30 * M },
  { name: 'Go package index', url: 'https://index.golang.org/', feedKind: 'api',
    roles: ['PRIMARY', 'LAUNCH'], lang: 'en', fields: ['go'], pollSeconds: 30 * M },
  { name: 'Maven Central', url: 'https://central.sonatype.com/', feedKind: 'api',
    roles: ['PRIMARY'], lang: 'en', fields: ['java'], pollSeconds: 60 * M },
  { name: 'NuGet', url: 'https://www.nuget.org/', feedKind: 'api',
    roles: ['PRIMARY'], lang: 'en', fields: ['csharp'], pollSeconds: 60 * M },

  { name: 'NVD CVE feed', url: 'https://nvd.nist.gov/', feedKind: 'api',
    feedHint: 'https://services.nvd.nist.gov/rest/json/cves/2.0',
    roles: ['PRIMARY'], lang: 'en', country: 'US', trust: 1.0, fields: ['cve', 'security'],
    pollSeconds: 60 * M, requiresSecret: 'NVD_API_KEY',
    notes: 'Key is free and lifts the limit to 50 requests / 30s. Works keyless, slowly.' },
  { name: 'CISA Known Exploited Vulnerabilities', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
    feedKind: 'api', roles: ['PRIMARY'], lang: 'en', country: 'US', trust: 1.0,
    fields: ['cve', 'security'], pollSeconds: 6 * H },
  { name: 'EPSS', url: 'https://www.first.org/epss/', feedKind: 'api',
    roles: ['PRIMARY'], lang: 'en', trust: 1.0, fields: ['cve'], pollSeconds: 6 * H },
  { name: 'OSV.dev', url: 'https://osv.dev/', feedKind: 'api',
    roles: ['PRIMARY'], lang: 'en', trust: 1.0, fields: ['security', 'supply-chain-security'],
    pollSeconds: 60 * M },
  { name: 'GitHub Security Advisories', url: 'https://github.com/advisories',
    feedKind: 'api', roles: ['PRIMARY'], lang: 'en', trust: 1.0, fields: ['security'],
    pollSeconds: 60 * M, requiresSecret: 'GITHUB_TOKEN' },

  { name: 'AWS What’s New', url: 'https://aws.amazon.com/new/',
    roles: ['PRIMARY'], lang: 'en', fields: ['aws', 'cloud'], pollSeconds: 60 * M },
  { name: 'Google Cloud release notes', url: 'https://cloud.google.com/release-notes',
    roles: ['PRIMARY'], lang: 'en', fields: ['gcp', 'cloud'], pollSeconds: 60 * M },
  { name: 'Azure updates', url: 'https://azure.microsoft.com/en-us/updates/',
    roles: ['PRIMARY'], lang: 'en', fields: ['azure', 'cloud'], pollSeconds: 60 * M },
  { name: 'Cloudflare blog', url: 'https://blog.cloudflare.com/',
    roles: ['PRIMARY', 'CONTENT'], lang: 'en', trust: 0.9, fields: ['cloudflare', 'infra'],
    pollSeconds: 60 * M },
  { name: 'Kubernetes blog', url: 'https://kubernetes.io/blog/',
    roles: ['PRIMARY', 'CONTENT'], lang: 'en', fields: ['kubernetes'], pollSeconds: 2 * H },
  { name: 'PostgreSQL news', url: 'https://www.postgresql.org/news/',
    feedHint: 'https://www.postgresql.org/news.rss',
    roles: ['PRIMARY'], lang: 'en', fields: ['postgresql'], pollSeconds: 6 * H },
  { name: 'Rust blog', url: 'https://blog.rust-lang.org/',
    roles: ['PRIMARY', 'CONTENT'], lang: 'en', fields: ['rust'], pollSeconds: 6 * H },
  { name: 'Go blog', url: 'https://go.dev/blog/',
    roles: ['PRIMARY', 'CONTENT'], lang: 'en', fields: ['go'], pollSeconds: 6 * H },
  { name: 'Python Insider', url: 'https://pythoninsider.blogspot.com/',
    roles: ['PRIMARY'], lang: 'en', fields: ['python'], pollSeconds: 6 * H },
  { name: 'Chrome Developers blog', url: 'https://developer.chrome.com/blog',
    roles: ['PRIMARY'], lang: 'en', fields: ['browsers', 'web-platform'], pollSeconds: 6 * H },
  { name: 'WebKit blog', url: 'https://webkit.org/blog/',
    roles: ['PRIMARY'], lang: 'en', fields: ['browsers', 'web-platform'], pollSeconds: 6 * H },
  { name: 'Mozilla Hacks', url: 'https://hacks.mozilla.org/',
    roles: ['PRIMARY', 'CONTENT'], lang: 'en', fields: ['browsers', 'web-platform'], pollSeconds: 6 * H },

  { name: 'IETF RFCs', url: 'https://www.rfc-editor.org/', feedHint: 'https://www.rfc-editor.org/rfcrss.xml',
    roles: ['PRIMARY'], lang: 'en', trust: 1.0, fields: ['standards', 'protocols'], pollSeconds: 6 * H },
  { name: 'W3C news', url: 'https://www.w3.org/blog/news/',
    roles: ['PRIMARY'], lang: 'en', trust: 1.0, fields: ['standards', 'web-platform'], pollSeconds: 6 * H },
  { name: 'WHATWG', url: 'https://whatwg.org/', roles: ['PRIMARY'], lang: 'en',
    feedHint: 'https://blog.whatwg.org/feed',
    fields: ['standards', 'html'], pollSeconds: 6 * H },
  { name: 'TC39 proposals', url: 'https://github.com/tc39/proposals',
    feedHint: 'https://github.com/tc39/proposals/commits.atom',
    roles: ['PRIMARY'], lang: 'en', fields: ['javascript', 'standards'], pollSeconds: 6 * H },
  { name: 'Khronos news', url: 'https://www.khronos.org/news/',
    roles: ['PRIMARY'], lang: 'en', fields: ['gamedev', 'gpu'], pollSeconds: 6 * H },
  { name: 'Unicode announcements', url: 'https://blog.unicode.org/',
    roles: ['PRIMARY'], lang: 'en', fields: ['standards'], pollSeconds: 6 * H },

  { name: 'arXiv cs', url: 'https://arxiv.org/list/cs/recent', feedKind: 'api',
    feedHint: 'http://export.arxiv.org/api/query',
    roles: ['CONTENT', 'PRIMARY'], lang: 'en', fields: ['ai'], pollSeconds: 6 * H,
    notes: 'Requires 3s spacing between requests. Politeness interval is set accordingly.' },
];

// ---------------------------------------------------------------------------
// English press. Split hard between CONTENT and COVERAGE.
// ---------------------------------------------------------------------------
const EN_PRESS: SourceSeed[] = [
  { name: 'Ars Technica', url: 'https://arstechnica.com/', roles: ['CONTENT', 'COVERAGE'],
    lang: 'en', country: 'US', trust: 0.8, weightContent: 0.9, pollSeconds: 60 * M },
  { name: 'The Register', url: 'https://www.theregister.com/', roles: ['CONTENT', 'COVERAGE'],
    lang: 'en', country: 'GB', trust: 0.75, weightContent: 0.85, pollSeconds: 60 * M },
  { name: 'InfoQ', url: 'https://www.infoq.com/', roles: ['CONTENT'], lang: 'en',
    trust: 0.8, weightContent: 0.9, pollSeconds: 2 * H },
  { name: 'LWN.net', url: 'https://lwn.net/', roles: ['CONTENT', 'PRIMARY'], lang: 'en',
    trust: 0.95, weightContent: 1.0, fields: ['linux', 'os'], pollSeconds: 2 * H,
    notes: 'Highest depth-per-item of any English source in the registry.' },
  { name: 'Phoronix', url: 'https://www.phoronix.com/', roles: ['CONTENT'], lang: 'en',
    trust: 0.8, weightContent: 0.9, fields: ['linux', 'hardware'], pollSeconds: 60 * M },
  { name: 'The New Stack', url: 'https://thenewstack.io/', roles: ['CONTENT', 'COVERAGE'],
    lang: 'en', trust: 0.7, weightContent: 0.8, pollSeconds: 2 * H },
  { name: 'Hackaday', url: 'https://hackaday.com/', roles: ['CONTENT'], lang: 'en',
    trust: 0.7, weightContent: 0.9, fields: ['hardware', 'embedded'], pollSeconds: 2 * H },

  // COVERAGE only. These exist to measure mainstream-ness, nothing else.
  { name: 'TechCrunch', url: 'https://techcrunch.com/', roles: ['COVERAGE'], lang: 'en',
    country: 'US', trust: 0.4, weightContent: 0.2, neverCanonical: true, pollSeconds: 2 * H },
  { name: 'VentureBeat', url: 'https://venturebeat.com/', roles: ['COVERAGE'], lang: 'en',
    trust: 0.4, weightContent: 0.2, neverCanonical: true, pollSeconds: 2 * H },
  { name: 'ZDNET', url: 'https://www.zdnet.com/', roles: ['COVERAGE'], lang: 'en',
    trust: 0.35, weightContent: 0.2, neverCanonical: true, pollSeconds: 2 * H },
  { name: 'SD Times', url: 'https://sdtimes.com/', roles: ['COVERAGE'], lang: 'en',
    trust: 0.4, weightContent: 0.3, neverCanonical: true, pollSeconds: 4 * H },
  { name: "Tom's Hardware", url: 'https://www.tomshardware.com/', roles: ['COVERAGE'],
    lang: 'en', trust: 0.4, weightContent: 0.3, neverCanonical: true,
    fields: ['hardware'], pollSeconds: 2 * H },
  // Section feeds, not the firehose. Pure mainstream-ness detector.
  { name: 'TechRadar Pro', url: 'https://www.techradar.com/pro', roles: ['COVERAGE'],
    lang: 'en', trust: 0.2, weightContent: 0.1, neverCanonical: true, pollSeconds: 4 * H },
  { name: 'TechRadar Computing', url: 'https://www.techradar.com/computing',
    feedHint: 'https://www.techradar.com/rss/news/computing', roles: ['COVERAGE'],
    lang: 'en', trust: 0.2, weightContent: 0.1, neverCanonical: true, pollSeconds: 4 * H },
];

// ---------------------------------------------------------------------------
// Practitioner blogs. The long tail the discovery loop is meant to extend.
// ---------------------------------------------------------------------------
const BLOGS: SourceSeed[] = [
  { name: 'Simon Willison', url: 'https://simonwillison.net/', roles: ['CONTENT'], lang: 'en',
    trust: 0.9, fields: ['ai', 'python'], pollSeconds: 2 * H },
  { name: 'Julia Evans', url: 'https://jvns.ca/', roles: ['CONTENT'], lang: 'en',
    trust: 0.9, fields: ['linux', 'practice'], pollSeconds: 6 * H },
  { name: 'Dan Luu', url: 'https://danluu.com/', roles: ['CONTENT'], lang: 'en',
    trust: 0.9, fields: ['practice', 'hardware'], pollSeconds: 12 * H },
  { name: 'Brendan Gregg', url: 'https://www.brendangregg.com/', roles: ['CONTENT'], lang: 'en',
    trust: 0.9, fields: ['performance', 'linux', 'ebpf'], pollSeconds: 12 * H },
  { name: 'Martin Fowler', url: 'https://martinfowler.com/', roles: ['CONTENT'], lang: 'en',
    trust: 0.85, fields: ['architecture', 'practice'], pollSeconds: 12 * H },
  { name: 'Xe Iaso', url: 'https://xeiaso.net/', roles: ['CONTENT'], lang: 'en',
    trust: 0.8, fields: ['infra', 'nixos'], pollSeconds: 6 * H },
  { name: 'Chris Elhage / Transformer Circuits', url: 'https://transformer-circuits.pub/',
    roles: ['CONTENT'], lang: 'en', trust: 0.9, fields: ['ai', 'ai-safety'], pollSeconds: 24 * H },
  { name: 'Netflix Tech Blog', url: 'https://netflixtechblog.com/',
    feedHint: 'https://netflixtechblog.com/feed', roles: ['CONTENT'],
    lang: 'en', trust: 0.8, fields: ['infra'], pollSeconds: 12 * H },
  { name: 'Uber Engineering', url: 'https://www.uber.com/blog/engineering/', roles: ['CONTENT'],
    lang: 'en', trust: 0.75, fields: ['infra'], pollSeconds: 12 * H },
  { name: 'Stripe Engineering', url: 'https://stripe.com/blog/engineering', roles: ['CONTENT'],
    lang: 'en', trust: 0.8, pollSeconds: 12 * H },
  { name: 'GitHub Engineering', url: 'https://github.blog/engineering/', roles: ['CONTENT'],
    lang: 'en', trust: 0.8, fields: ['github'], pollSeconds: 12 * H },
  { name: 'Meta Engineering', url: 'https://engineering.fb.com/', roles: ['CONTENT'],
    lang: 'en', trust: 0.75, pollSeconds: 12 * H },
  { name: 'Google Research blog', url: 'https://research.google/blog/', roles: ['CONTENT'],
    lang: 'en', trust: 0.8, fields: ['ai'], pollSeconds: 12 * H },
  { name: 'Anthropic news', url: 'https://www.anthropic.com/news', roles: ['PRIMARY', 'CONTENT'],
    lang: 'en', trust: 0.9, fields: ['ai', 'anthropic'], pollSeconds: 6 * H },
  { name: 'OpenAI blog', url: 'https://openai.com/blog',
    feedHint: 'https://openai.com/news/rss.xml', roles: ['PRIMARY', 'CONTENT'],
    lang: 'en', trust: 0.85, fields: ['ai', 'openai'], pollSeconds: 6 * H },
  { name: 'Hugging Face blog', url: 'https://huggingface.co/blog', roles: ['CONTENT'],
    lang: 'en', trust: 0.8, fields: ['ai', 'huggingface'], pollSeconds: 12 * H },
  { name: 'Jepsen', url: 'https://jepsen.io/analyses', roles: ['CONTENT'], lang: 'en',
    trust: 0.95, fields: ['data', 'postgresql'], pollSeconds: 24 * H },
  { name: 'Rachel by the Bay', url: 'https://rachelbythebay.com/w/', roles: ['CONTENT'],
    lang: 'en', trust: 0.8, fields: ['infra', 'sre'], pollSeconds: 12 * H },
  { name: 'Fly.io blog', url: 'https://fly.io/blog/',
    feedHint: 'https://fly.io/blog/feed.xml', roles: ['CONTENT'], lang: 'en',
    trust: 0.8, fields: ['infra', 'fly-io'], pollSeconds: 12 * H },
  { name: 'Tailscale blog', url: 'https://tailscale.com/blog', roles: ['CONTENT'], lang: 'en',
    trust: 0.8, fields: ['infra', 'security'], pollSeconds: 12 * H },
];

// ---------------------------------------------------------------------------
// Japanese. All CONTENT, no auth.
// ---------------------------------------------------------------------------
const JA: SourceSeed[] = [
  { name: 'Publickey', url: 'https://www.publickey1.jp/', roles: ['CONTENT'], lang: 'ja',
    country: 'JP', trust: 0.85, pollSeconds: 60 * M },
  { name: 'ITmedia NEWS', url: 'https://www.itmedia.co.jp/news/',
    feedHint: 'https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml', roles: ['CONTENT', 'COVERAGE'],
    lang: 'ja', country: 'JP', trust: 0.7, pollSeconds: 60 * M },
  { name: '@IT', url: 'https://atmarkit.itmedia.co.jp/', roles: ['CONTENT'], lang: 'ja',
    country: 'JP', trust: 0.75, pollSeconds: 60 * M },
  { name: 'InfoQ Japan', url: 'https://www.infoq.com/jp/', roles: ['CONTENT'], lang: 'ja',
    feedHint: 'https://feed.infoq.com/jp/',
    country: 'JP', trust: 0.75, pollSeconds: 2 * H },
  { name: 'Zenn', url: 'https://zenn.dev/', roles: ['CONTENT', 'DISCOVERY'], lang: 'ja',
    country: 'JP', trust: 0.6, pollSeconds: 60 * M },
  { name: 'Qiita', url: 'https://qiita.com/',
    feedHint: 'https://qiita.com/popular-items/feed', roles: ['CONTENT', 'DISCOVERY'], lang: 'ja',
    country: 'JP', trust: 0.55, pollSeconds: 60 * M },
  { name: 'gihyo.jp', url: 'https://gihyo.jp/', roles: ['CONTENT'], lang: 'ja',
    country: 'JP', trust: 0.75, pollSeconds: 2 * H },
  { name: 'Cybozu Inside Out', url: 'https://blog.cybozu.io/', roles: ['CONTENT'], lang: 'ja',
    country: 'JP', trust: 0.75, pollSeconds: 12 * H },
  { name: 'DeNA Engineering', url: 'https://engineering.dena.com/', roles: ['CONTENT'], lang: 'ja',
    country: 'JP', trust: 0.75, pollSeconds: 12 * H },
  { name: 'LY Corporation Tech Blog', url: 'https://techblog.lycorp.co.jp/ja', roles: ['CONTENT'],
    lang: 'ja', country: 'JP', trust: 0.75, pollSeconds: 12 * H },
  { name: 'Mercari Engineering', url: 'https://engineering.mercari.com/blog/', roles: ['CONTENT'],
    lang: 'ja', country: 'JP', trust: 0.75, pollSeconds: 12 * H },
  { name: 'CyberAgent Developers', url: 'https://developers.cyberagent.co.jp/blog/', roles: ['CONTENT'],
    lang: 'ja', country: 'JP', trust: 0.7, pollSeconds: 12 * H },
  { name: 'さくらのナレッジ', url: 'https://knowledge.sakura.ad.jp/', roles: ['CONTENT'], lang: 'ja',
    country: 'JP', trust: 0.7, fields: ['infra'], pollSeconds: 12 * H },
];

// ---------------------------------------------------------------------------
// German.
// ---------------------------------------------------------------------------
const DE: SourceSeed[] = [
  { name: 'heise online', url: 'https://www.heise.de/',
    feedHint: 'https://www.heise.de/rss/heise-atom.xml', roles: ['CONTENT', 'COVERAGE'],
    lang: 'de', country: 'DE', trust: 0.8, pollSeconds: 60 * M },
  { name: 'heise Security', url: 'https://www.heise.de/security/', roles: ['CONTENT'],
    lang: 'de', country: 'DE', trust: 0.85, fields: ['security'], pollSeconds: 60 * M },
  { name: 'iX', url: 'https://www.heise.de/ix/', roles: ['CONTENT'], lang: 'de',
    country: 'DE', trust: 0.85, pollSeconds: 4 * H },
  { name: 'Golem.de', url: 'https://www.golem.de/', roles: ['CONTENT', 'COVERAGE'], lang: 'de',
    country: 'DE', trust: 0.75, pollSeconds: 60 * M },
  { name: 't3n', url: 'https://t3n.de/', roles: ['CONTENT', 'COVERAGE'], lang: 'de',
    country: 'DE', trust: 0.6, pollSeconds: 2 * H },
  { name: 'netzpolitik.org', url: 'https://netzpolitik.org/', roles: ['CONTENT'], lang: 'de',
    country: 'DE', trust: 0.8, fields: ['privacy', 'tech-policy'], pollSeconds: 4 * H },
];

// ---------------------------------------------------------------------------
// Chinese. Timeouts from US infrastructure are normal here, not a bug.
// ---------------------------------------------------------------------------
const ZH: SourceSeed[] = [
  { name: 'InfoQ 中国', url: 'https://www.infoq.cn/', roles: ['CONTENT'], lang: 'zh',
    country: 'CN', trust: 0.7, pollSeconds: 60 * M },
  { name: 'OSCHINA', url: 'https://www.oschina.net/news', roles: ['CONTENT', 'DISCOVERY'],
    lang: 'zh', country: 'CN', trust: 0.6, pollSeconds: 60 * M },
  { name: '机器之心', url: 'https://www.jiqizhixin.com/', roles: ['CONTENT'], lang: 'zh',
    country: 'CN', trust: 0.7, fields: ['ai'], pollSeconds: 2 * H },
  { name: '少数派', url: 'https://sspai.com/', roles: ['CONTENT'], lang: 'zh',
    country: 'CN', trust: 0.6, pollSeconds: 4 * H },
  { name: '掘金', url: 'https://juejin.cn/', roles: ['CONTENT', 'DISCOVERY'], lang: 'zh',
    country: 'CN', trust: 0.55, pollSeconds: 2 * H },
  { name: '阿里巴巴中间件', url: 'https://developer.aliyun.com/', roles: ['CONTENT'], lang: 'zh',
    country: 'CN', trust: 0.65, pollSeconds: 12 * H },
  { name: '腾讯云开发者', url: 'https://cloud.tencent.com/developer', roles: ['CONTENT'], lang: 'zh',
    country: 'CN', trust: 0.65, pollSeconds: 12 * H },
  { name: 'ByteDance 技术团队', url: 'https://juejin.cn/user/1838039172387262', roles: ['CONTENT'],
    lang: 'zh', country: 'CN', trust: 0.65, pollSeconds: 12 * H },
];

// ---------------------------------------------------------------------------
// Newsletters. Highest signal-per-source on the list; one mailbox, IMAP parsed.
// ---------------------------------------------------------------------------
const NEWSLETTERS: SourceSeed[] = [
  { name: 'TLDR', url: 'https://tldr.tech/', feedKind: 'imap', roles: ['CONTENT', 'DISCOVERY'],
    lang: 'en', trust: 0.6, weightContent: 0.3, neverCanonical: true, pollSeconds: 4 * H,
    requiresSecret: 'IMAP_PASSWORD' },
  { name: 'Console.dev', url: 'https://console.dev/', feedKind: 'imap', roles: ['LAUNCH', 'DISCOVERY'],
    lang: 'en', trust: 0.7, weightContent: 0.3, neverCanonical: true, pollSeconds: 24 * H,
    requiresSecret: 'IMAP_PASSWORD' },
  { name: 'Pointer.io', url: 'https://www.pointer.io/', feedKind: 'imap', roles: ['DISCOVERY'],
    lang: 'en', trust: 0.7, weightContent: 0.2, neverCanonical: true, pollSeconds: 24 * H,
    requiresSecret: 'IMAP_PASSWORD' },
  { name: 'Import AI', url: 'https://importai.substack.com/', roles: ['CONTENT'], lang: 'en',
    trust: 0.85, fields: ['ai'], pollSeconds: 24 * H },
  { name: 'The Batch', url: 'https://www.deeplearning.ai/the-batch/', roles: ['CONTENT'],
    lang: 'en', trust: 0.75, fields: ['ai'], pollSeconds: 24 * H },
  { name: 'Golang Weekly', url: 'https://golangweekly.com/', feedKind: 'imap', roles: ['DISCOVERY'],
    lang: 'en', trust: 0.7, weightContent: 0.2, neverCanonical: true, fields: ['go'],
    pollSeconds: 24 * H, requiresSecret: 'IMAP_PASSWORD' },
  { name: 'Python Weekly', url: 'https://www.pythonweekly.com/', feedKind: 'imap', roles: ['DISCOVERY'],
    lang: 'en', trust: 0.7, weightContent: 0.2, neverCanonical: true, fields: ['python'],
    pollSeconds: 24 * H, requiresSecret: 'IMAP_PASSWORD' },
  { name: 'This Week in Rust', url: 'https://this-week-in-rust.org/', roles: ['DISCOVERY', 'CONTENT'],
    lang: 'en', trust: 0.8, fields: ['rust'], pollSeconds: 24 * H },
  { name: 'JavaScript Weekly', url: 'https://javascriptweekly.com/', feedKind: 'imap',
    roles: ['DISCOVERY'], lang: 'en', trust: 0.7, weightContent: 0.2, neverCanonical: true,
    fields: ['javascript'], pollSeconds: 24 * H, requiresSecret: 'IMAP_PASSWORD' },
  { name: 'Postgres Weekly', url: 'https://postgresweekly.com/', feedKind: 'imap',
    roles: ['DISCOVERY'], lang: 'en', trust: 0.7, weightContent: 0.2, neverCanonical: true,
    fields: ['postgresql'], pollSeconds: 24 * H, requiresSecret: 'IMAP_PASSWORD' },
];

// ---------------------------------------------------------------------------
// Experience layer. Trust weights are the whole point of these rows.
// Anything carrying ref= / aff= / ?partner= is excluded mechanically at fetch
// time (trust 0.0), which removes most of the manipulation by itself.
// ---------------------------------------------------------------------------
const EXPERIENCE: SourceSeed[] = [
  { name: 'Cloudflare status', url: 'https://www.cloudflarestatus.com/', feedKind: 'api',
    roles: ['EXPERIENCE', 'PRIMARY'], lang: 'en', trust: 1.0, weightContent: 0.3,
    neverCanonical: true, pollSeconds: 15 * M },
  { name: 'AWS Health Dashboard', url: 'https://health.aws.amazon.com/health/status',
    feedKind: 'api', roles: ['EXPERIENCE', 'PRIMARY'], lang: 'en', trust: 1.0,
    weightContent: 0.3, neverCanonical: true, pollSeconds: 15 * M },
  { name: 'GitHub status', url: 'https://www.githubstatus.com/', feedKind: 'api',
    roles: ['EXPERIENCE', 'PRIMARY'], lang: 'en', trust: 1.0, weightContent: 0.3,
    neverCanonical: true, pollSeconds: 15 * M },
  { name: 'Google Cloud status', url: 'https://status.cloud.google.com/', feedKind: 'api',
    roles: ['EXPERIENCE', 'PRIMARY'], lang: 'en', trust: 1.0, weightContent: 0.3,
    neverCanonical: true, pollSeconds: 15 * M },
  { name: 'LowEndTalk', url: 'https://lowendtalk.com/',
    feedHint: 'https://lowendtalk.com/discussions/feed.rss', roles: ['EXPERIENCE'], lang: 'en',
    trust: 0.9, weightContent: 0.2, neverCanonical: true, fields: ['infra'], pollSeconds: 6 * H },
  { name: 'LowEndBox', url: 'https://lowendbox.com/', roles: ['EXPERIENCE'], lang: 'en',
    trust: 0.9, weightContent: 0.2, neverCanonical: true, fields: ['infra'], pollSeconds: 12 * H },
  { name: 'Web Hosting Talk', url: 'https://www.webhostingtalk.com/', roles: ['EXPERIENCE'],
    lang: 'en', trust: 0.7, weightContent: 0.1, neverCanonical: true, pollSeconds: 12 * H },
  { name: 'G2', url: 'https://www.g2.com/', feedKind: 'html', roles: ['EXPERIENCE'], lang: 'en',
    trust: 0.2, weightContent: 0.0, neverCanonical: true, pollSeconds: 24 * H,
    notes: 'Kept at 0.2 deliberately: vendor-influenced review platforms are the most poisoned tier.' },
  { name: 'Trustpilot', url: 'https://www.trustpilot.com/', feedKind: 'html', roles: ['EXPERIENCE'],
    lang: 'en', trust: 0.2, weightContent: 0.0, neverCanonical: true, pollSeconds: 24 * H },
];

export const SOURCE_SEEDS: SourceSeed[] = [
  ...AGGREGATORS, ...PRIMARY, ...EN_PRESS, ...BLOGS,
  ...JA, ...DE, ...ZH, ...NEWSLETTERS, ...EXPERIENCE,
  // A company's own newsroom and engineering blog. Derived from the company
  // registry rather than written twice; see seeds/announce.ts.
  ...ANNOUNCE_SOURCES,
];

// Cron shard assignment (spec 7.1). Sources polled every 15 minutes get shard 0 --
// about 20 of them, the ones where freshness actually matters. Everything else is
// spread across shards 1..N so no single Worker invocation runs long.
export const FAST_SHARD_SECONDS = 15 * M;

export function shardFor(seed: SourceSeed, index: number, shardCount = 6): number {
  if ((seed.pollSeconds ?? H) <= FAST_SHARD_SECONDS) return 0;
  return 1 + (index % (shardCount - 1));
}

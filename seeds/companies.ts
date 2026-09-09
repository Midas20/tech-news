// The company registry.
//
// Same discipline as the taxonomy: closed vocabulary, hand-verified, aliases
// carrying the forms that actually appear in headlines ("AWS", "Amazon Web
// Services", "Amazon's cloud arm"). A company the classifier invents resolves to
// nothing and is discarded.
//
// `announce` lists the company's OWN channels. A story from one of those is an
// announcement -- the company speaking about itself -- which is a different kind
// of evidence from an outlet writing about it, and the UI keeps them apart.
//
// URLs are seeds, not hardcoded feeds: the collector resolves the real feed by
// autodiscovery on first poll and stores what it found.

export interface CompanySeed {
  slug: string;
  name: string;
  aliases: string[];
  category: 'hyperscaler' | 'vendor' | 'ai-lab' | 'chipmaker' | 'platform'
    | 'security' | 'database' | 'startup' | 'foundation' | 'telecom';
  country?: string;
  ticker?: string;
  homepage?: string;
  /** Official channels: newsroom, engineering blog, status page. */
  announce?: {
    name: string;
    url: string;
    kind?: 'news' | 'status' | 'releases';
    /**
     * The feed, when the page does not advertise one.
     *
     * Autodiscovery is the default and stays the default -- a hardcoded feed
     * URL is a thing that rots silently. These are the exceptions: pages that
     * are rendered by script and carry no <link rel="alternate">, so discovery
     * finds nothing and the source fails forever. Every one was fetched and
     * parsed before it was written here, with the item count in the comment.
     */
    feed?: string;
    /**
     * Checked, and there is no feed. Recorded rather than dropped, so nobody
     * re-checks it in six months, and so seeds/announce.ts can skip it instead
     * of seeding a source that can never succeed.
     */
    noFeed?: string;
  }[];
  githubOrg?: string;
  stacks?: string[];
}

export const COMPANY_SEEDS: CompanySeed[] = [
  // --- hyperscalers ---------------------------------------------------------
  {
    slug: 'aws', name: 'Amazon Web Services', category: 'hyperscaler', country: 'US', ticker: 'AMZN',
    aliases: ['amazon web services', 'amazon aws', 'aws', 'amazon'],
    homepage: 'https://aws.amazon.com/', stacks: ['aws', 'cloud'],
    announce: [
      { name: 'AWS News Blog', url: 'https://aws.amazon.com/blogs/aws/' },
      { name: 'AWS Security Bulletins', url: 'https://aws.amazon.com/security/security-bulletins/',
        feed: 'https://aws.amazon.com/security/security-bulletins/feed/' },
    ],
  },
  {
    slug: 'google-cloud', name: 'Google Cloud', category: 'hyperscaler', country: 'US', ticker: 'GOOGL',
    aliases: ['google cloud', 'gcp', 'google cloud platform'],
    homepage: 'https://cloud.google.com/', stacks: ['gcp', 'cloud'],
    // cloud.google.com/blog advertises nothing: the feed lives on the
    // publishing host. 20 items.
    announce: [{ name: 'Google Cloud Blog', url: 'https://cloud.google.com/blog/',
      feed: 'https://cloudblog.withgoogle.com/rss/' }],
  },
  {
    slug: 'microsoft', name: 'Microsoft', category: 'hyperscaler', country: 'US', ticker: 'MSFT',
    aliases: ['microsoft', 'msft', 'microsoft azure', 'azure'],
    homepage: 'https://www.microsoft.com/', stacks: ['azure', 'csharp', 'windows'],
    announce: [
      { name: 'Microsoft Azure Blog', url: 'https://azure.microsoft.com/en-us/blog/',
        feed: 'https://azure.microsoft.com/en-us/blog/feed/' },  // 10 items,
      { name: 'Microsoft Security Blog', url: 'https://www.microsoft.com/en-us/security/blog/' },
    ],
  },
  {
    slug: 'cloudflare', name: 'Cloudflare', category: 'hyperscaler', country: 'US', ticker: 'NET',
    aliases: ['cloudflare'], homepage: 'https://www.cloudflare.com/',
    stacks: ['cloudflare', 'cdn', 'infra'], githubOrg: 'cloudflare',
    announce: [
      { name: 'Cloudflare blog', url: 'https://blog.cloudflare.com/' },
      { name: 'Cloudflare status', url: 'https://www.cloudflarestatus.com/', kind: 'status' },
    ],
  },
  {
    slug: 'oracle', name: 'Oracle', category: 'hyperscaler', country: 'US', ticker: 'ORCL',
    aliases: ['oracle', 'oci', 'oracle cloud'], homepage: 'https://www.oracle.com/',
    stacks: ['oracle-cloud', 'java'],
  },
  {
    slug: 'ibm', name: 'IBM', category: 'vendor', country: 'US', ticker: 'IBM',
    aliases: ['ibm', 'red hat', 'redhat'], homepage: 'https://www.ibm.com/',
    stacks: ['rhel', 'kubernetes'],
    announce: [{ name: 'Red Hat Blog', url: 'https://www.redhat.com/en/blog' }],
  },

  // --- AI labs --------------------------------------------------------------
  {
    slug: 'anthropic', name: 'Anthropic', category: 'ai-lab', country: 'US',
    aliases: ['anthropic', 'claude'], homepage: 'https://www.anthropic.com/',
    stacks: ['anthropic', 'llm', 'ai'], githubOrg: 'anthropics',
    announce: [
      { name: 'Anthropic news', url: 'https://www.anthropic.com/news',
        noFeed: 'rss.xml, news/rss.xml and news/feed.xml all 404 (2026-08-28)' },
      { name: 'Anthropic engineering', url: 'https://www.anthropic.com/engineering',
        noFeed: 'same site, same result (2026-08-28)' },
    ],
  },
  {
    slug: 'openai', name: 'OpenAI', category: 'ai-lab', country: 'US',
    aliases: ['openai', 'chatgpt', 'gpt-4', 'gpt-5'], homepage: 'https://openai.com/',
    stacks: ['openai', 'llm', 'ai'], githubOrg: 'openai',
    announce: [{ name: 'OpenAI blog', url: 'https://openai.com/blog',
      feed: 'https://openai.com/news/rss.xml' }]  // 1,156 items,
  },
  {
    slug: 'google-deepmind', name: 'Google DeepMind', category: 'ai-lab', country: 'GB',
    aliases: ['deepmind', 'google deepmind', 'gemini'], homepage: 'https://deepmind.google/',
    stacks: ['gemini', 'ai'],
    announce: [{ name: 'Google DeepMind blog', url: 'https://deepmind.google/discover/blog/' }],
  },
  {
    slug: 'meta-ai', name: 'Meta', category: 'ai-lab', country: 'US', ticker: 'META',
    aliases: ['meta', 'facebook', 'meta ai', 'llama'], homepage: 'https://about.meta.com/',
    stacks: ['llama', 'react', 'pytorch'], githubOrg: 'facebook',
    announce: [
      { name: 'Meta Engineering', url: 'https://engineering.fb.com/' },
      { name: 'Meta AI blog', url: 'https://ai.meta.com/blog/',
        noFeed: 'blog/rss/ and blog/feed/ both 404 (2026-08-28)' },
    ],
  },
  {
    slug: 'mistral', name: 'Mistral AI', category: 'ai-lab', country: 'FR',
    aliases: ['mistral', 'mistral ai'], homepage: 'https://mistral.ai/',
    stacks: ['mistral', 'llm'],
    announce: [{ name: 'Mistral AI news', url: 'https://mistral.ai/news/' }],
  },
  {
    slug: 'huggingface', name: 'Hugging Face', category: 'ai-lab', country: 'US',
    aliases: ['hugging face', 'huggingface'], homepage: 'https://huggingface.co/',
    stacks: ['huggingface', 'ai'], githubOrg: 'huggingface',
    announce: [{ name: 'Hugging Face blog', url: 'https://huggingface.co/blog' }],
  },
  {
    slug: 'xai', name: 'xAI', category: 'ai-lab', country: 'US',
    aliases: ['xai', 'grok'], homepage: 'https://x.ai/', stacks: ['grok', 'llm'],
  },
  {
    slug: 'deepseek', name: 'DeepSeek', category: 'ai-lab', country: 'CN',
    aliases: ['deepseek'], homepage: 'https://www.deepseek.com/', stacks: ['deepseek', 'llm'],
  },
  {
    slug: 'alibaba', name: 'Alibaba', category: 'hyperscaler', country: 'CN', ticker: 'BABA',
    aliases: ['alibaba', 'alibaba cloud', 'aliyun', 'qwen', 'tongyi'],
    homepage: 'https://www.alibabacloud.com/', stacks: ['qwen', 'cloud'],
  },
  {
    slug: 'bytedance', name: 'ByteDance', category: 'platform', country: 'CN',
    aliases: ['bytedance', 'tiktok', 'doubao'], homepage: 'https://www.bytedance.com/', stacks: ['ai'],
  },
  {
    slug: 'baidu', name: 'Baidu', category: 'ai-lab', country: 'CN', ticker: 'BIDU',
    aliases: ['baidu', 'ernie'], homepage: 'https://www.baidu.com/', stacks: ['ai'],
  },
  {
    slug: 'tencent', name: 'Tencent', category: 'hyperscaler', country: 'CN',
    aliases: ['tencent', 'tencent cloud', 'hunyuan', 'wechat'],
    homepage: 'https://www.tencent.com/', stacks: ['cloud', 'ai'],
  },

  // --- chipmakers -----------------------------------------------------------
  {
    slug: 'nvidia', name: 'NVIDIA', category: 'chipmaker', country: 'US', ticker: 'NVDA',
    aliases: ['nvidia', 'cuda', 'geforce', 'blackwell', 'hopper'],
    homepage: 'https://www.nvidia.com/', stacks: ['nvidia', 'gpu'], githubOrg: 'NVIDIA',
    announce: [{ name: 'NVIDIA Technical Blog', url: 'https://developer.nvidia.com/blog/' }],
  },
  {
    slug: 'amd', name: 'AMD', category: 'chipmaker', country: 'US', ticker: 'AMD',
    aliases: ['amd', 'ryzen', 'radeon', 'epyc', 'rocm'],
    homepage: 'https://www.amd.com/', stacks: ['amd', 'gpu', 'cpu'],
  },
  {
    slug: 'intel', name: 'Intel', category: 'chipmaker', country: 'US', ticker: 'INTC',
    aliases: ['intel', 'xeon', 'core ultra', 'arc gpu'],
    homepage: 'https://www.intel.com/', stacks: ['intel', 'cpu'],
  },
  {
    slug: 'arm', name: 'Arm', category: 'chipmaker', country: 'GB', ticker: 'ARM',
    aliases: ['arm', 'arm holdings', 'cortex', 'neoverse'],
    homepage: 'https://www.arm.com/', stacks: ['arm'],
  },
  {
    slug: 'apple', name: 'Apple', category: 'vendor', country: 'US', ticker: 'AAPL',
    aliases: ['apple', 'apple silicon', 'macos', 'ios'],
    homepage: 'https://www.apple.com/', stacks: ['apple-silicon', 'swift', 'macos', 'ios'],
    announce: [{ name: 'Apple Newsroom', url: 'https://www.apple.com/newsroom/' }],
  },
  {
    slug: 'qualcomm', name: 'Qualcomm', category: 'chipmaker', country: 'US', ticker: 'QCOM',
    aliases: ['qualcomm', 'snapdragon'], homepage: 'https://www.qualcomm.com/', stacks: ['qualcomm', 'arm'],
  },
  {
    slug: 'tsmc', name: 'TSMC', category: 'chipmaker', country: 'TW', ticker: 'TSM',
    aliases: ['tsmc', 'taiwan semiconductor'], homepage: 'https://www.tsmc.com/',
    stacks: ['semiconductor-manufacturing'],
  },
  {
    slug: 'samsung', name: 'Samsung', category: 'chipmaker', country: 'KR',
    aliases: ['samsung', 'samsung electronics', 'exynos'],
    homepage: 'https://www.samsung.com/', stacks: ['memory-vendors'],
  },
  {
    slug: 'sk-hynix', name: 'SK hynix', category: 'chipmaker', country: 'KR',
    aliases: ['sk hynix', 'hynix'], homepage: 'https://www.skhynix.com/', stacks: ['hbm'],
  },
  {
    slug: 'broadcom', name: 'Broadcom', category: 'chipmaker', country: 'US', ticker: 'AVGO',
    aliases: ['broadcom', 'vmware'], homepage: 'https://www.broadcom.com/', stacks: ['broadcom'],
  },
  {
    slug: 'asml', name: 'ASML', category: 'chipmaker', country: 'NL', ticker: 'ASML',
    aliases: ['asml'], homepage: 'https://www.asml.com/', stacks: ['semiconductor-manufacturing'],
  },

  // --- developer platforms --------------------------------------------------
  {
    slug: 'github', name: 'GitHub', category: 'platform', country: 'US',
    aliases: ['github', 'github copilot'], homepage: 'https://github.com/',
    stacks: ['github', 'git'], githubOrg: 'github',
    announce: [
      { name: 'GitHub Blog', url: 'https://github.blog/' },
      { name: 'GitHub status', url: 'https://www.githubstatus.com/', kind: 'status' },
    ],
  },
  {
    slug: 'gitlab', name: 'GitLab', category: 'platform', country: 'US', ticker: 'GTLB',
    aliases: ['gitlab'], homepage: 'https://about.gitlab.com/', stacks: ['gitlab', 'ci-cd'],
    announce: [{ name: 'GitLab Blog', url: 'https://about.gitlab.com/blog/' }],
  },
  {
    slug: 'vercel', name: 'Vercel', category: 'platform', country: 'US',
    aliases: ['vercel', 'next.js team'], homepage: 'https://vercel.com/',
    stacks: ['vercel', 'nextjs'], githubOrg: 'vercel',
    announce: [{ name: 'Vercel Blog', url: 'https://vercel.com/blog' }],
  },
  {
    slug: 'netlify', name: 'Netlify', category: 'platform', country: 'US',
    aliases: ['netlify'], homepage: 'https://www.netlify.com/', stacks: ['netlify'],
  },
  {
    slug: 'fly-io', name: 'Fly.io', category: 'platform', country: 'US',
    aliases: ['fly.io', 'flyio'], homepage: 'https://fly.io/', stacks: ['fly-io'],
    announce: [{ name: 'Fly.io blog', url: 'https://fly.io/blog/',
      feed: 'https://fly.io/blog/feed.xml' }],  // 40 items
  },
  {
    slug: 'digitalocean', name: 'DigitalOcean', category: 'platform', country: 'US', ticker: 'DOCN',
    aliases: ['digitalocean', 'digital ocean'], homepage: 'https://www.digitalocean.com/',
    stacks: ['digitalocean'],
  },
  {
    slug: 'hashicorp', name: 'HashiCorp', category: 'vendor', country: 'US',
    aliases: ['hashicorp'], homepage: 'https://www.hashicorp.com/',
    stacks: ['terraform', 'vault', 'consul'], githubOrg: 'hashicorp',
    announce: [{ name: 'HashiCorp Blog', url: 'https://www.hashicorp.com/blog',
      feed: 'https://www.hashicorp.com/blog/feed.xml' }],
  },
  {
    slug: 'docker', name: 'Docker', category: 'vendor', country: 'US',
    aliases: ['docker', 'docker inc'], homepage: 'https://www.docker.com/', stacks: ['docker'],
    announce: [{ name: 'Docker Blog', url: 'https://www.docker.com/blog/' }],
  },
  {
    slug: 'jetbrains', name: 'JetBrains', category: 'vendor', country: 'CZ',
    aliases: ['jetbrains', 'intellij'], homepage: 'https://www.jetbrains.com/',
    stacks: ['kotlin', 'editors'],
    announce: [{ name: 'JetBrains Blog', url: 'https://blog.jetbrains.com/' }],
  },
  {
    slug: 'atlassian', name: 'Atlassian', category: 'vendor', country: 'AU', ticker: 'TEAM',
    aliases: ['atlassian', 'jira', 'confluence'], homepage: 'https://www.atlassian.com/',
    stacks: ['atlassian'],
  },

  // --- databases and data ---------------------------------------------------
  {
    slug: 'databricks', name: 'Databricks', category: 'database', country: 'US',
    aliases: ['databricks'], homepage: 'https://www.databricks.com/', stacks: ['databricks', 'spark'],
    announce: [{ name: 'Databricks Blog', url: 'https://www.databricks.com/blog' }],
  },
  {
    slug: 'snowflake', name: 'Snowflake', category: 'database', country: 'US', ticker: 'SNOW',
    aliases: ['snowflake'], homepage: 'https://www.snowflake.com/', stacks: ['snowflake'],
  },
  {
    slug: 'mongodb', name: 'MongoDB', category: 'database', country: 'US', ticker: 'MDB',
    aliases: ['mongodb', 'mongo'], homepage: 'https://www.mongodb.com/', stacks: ['mongodb'],
  },
  {
    slug: 'elastic', name: 'Elastic', category: 'database', country: 'NL', ticker: 'ESTC',
    aliases: ['elastic', 'elasticsearch'], homepage: 'https://www.elastic.co/',
    stacks: ['elasticsearch'],
  },
  {
    slug: 'redis', name: 'Redis', category: 'database', country: 'US',
    aliases: ['redis', 'redis labs'], homepage: 'https://redis.io/', stacks: ['redis'],
  },
  {
    slug: 'confluent', name: 'Confluent', category: 'database', country: 'US', ticker: 'CFLT',
    aliases: ['confluent'], homepage: 'https://www.confluent.io/', stacks: ['kafka'],
  },
  {
    slug: 'clickhouse', name: 'ClickHouse', category: 'database', country: 'US',
    aliases: ['clickhouse'], homepage: 'https://clickhouse.com/', stacks: ['clickhouse'],
    announce: [{ name: 'ClickHouse Blog', url: 'https://clickhouse.com/blog' }],
  },
  {
    slug: 'supabase', name: 'Supabase', category: 'database', country: 'US',
    aliases: ['supabase'], homepage: 'https://supabase.com/', stacks: ['supabase', 'postgresql'],
    announce: [{ name: 'Supabase Blog', url: 'https://supabase.com/blog' }],
  },
  {
    slug: 'neon', name: 'Neon', category: 'database', country: 'US',
    aliases: ['neon', 'neon.tech'], homepage: 'https://neon.tech/', stacks: ['neon', 'postgresql'],
  },
  {
    slug: 'cockroach-labs', name: 'Cockroach Labs', category: 'database', country: 'US',
    aliases: ['cockroach labs', 'cockroachdb'], homepage: 'https://www.cockroachlabs.com/',
    stacks: ['cockroachdb'],
  },

  // --- security -------------------------------------------------------------
  {
    slug: 'crowdstrike', name: 'CrowdStrike', category: 'security', country: 'US', ticker: 'CRWD',
    aliases: ['crowdstrike'], homepage: 'https://www.crowdstrike.com/', stacks: ['edr'],
  },
  {
    slug: 'palo-alto', name: 'Palo Alto Networks', category: 'security', country: 'US', ticker: 'PANW',
    aliases: ['palo alto networks', 'unit 42'], homepage: 'https://www.paloaltonetworks.com/',
    stacks: ['security'],
  },
  {
    slug: 'fortinet', name: 'Fortinet', category: 'security', country: 'US', ticker: 'FTNT',
    aliases: ['fortinet', 'fortigate'], homepage: 'https://www.fortinet.com/', stacks: ['security'],
  },
  {
    slug: 'okta', name: 'Okta', category: 'security', country: 'US', ticker: 'OKTA',
    aliases: ['okta', 'auth0'], homepage: 'https://www.okta.com/', stacks: ['identity'],
  },
  {
    slug: 'snyk', name: 'Snyk', category: 'security', country: 'GB',
    aliases: ['snyk'], homepage: 'https://snyk.io/', stacks: ['appsec'],
  },
  {
    slug: 'tailscale', name: 'Tailscale', category: 'security', country: 'CA',
    aliases: ['tailscale'], homepage: 'https://tailscale.com/', stacks: ['security', 'infra'],
    announce: [{ name: 'Tailscale blog', url: 'https://tailscale.com/blog' }],
  },

  // --- platforms and the rest ----------------------------------------------
  {
    slug: 'stripe', name: 'Stripe', category: 'platform', country: 'US',
    aliases: ['stripe'], homepage: 'https://stripe.com/', stacks: ['stripe'],
    announce: [{ name: 'Stripe Engineering', url: 'https://stripe.com/blog/engineering' }],
  },
  {
    slug: 'shopify', name: 'Shopify', category: 'platform', country: 'CA', ticker: 'SHOP',
    aliases: ['shopify'], homepage: 'https://www.shopify.com/', stacks: ['shopify', 'ruby'],
    announce: [{ name: 'Shopify Engineering', url: 'https://shopify.engineering/',
      noFeed: 'blog.atom answers 200 with HTML, not a feed (2026-08-28)' }],
  },
  {
    slug: 'netflix', name: 'Netflix', category: 'platform', country: 'US', ticker: 'NFLX',
    aliases: ['netflix'], homepage: 'https://www.netflix.com/', stacks: ['infra'],
    announce: [{ name: 'Netflix Tech Blog', url: 'https://netflixtechblog.com/',
      feed: 'https://netflixtechblog.com/feed' }],  // 10 items
  },
  {
    slug: 'uber', name: 'Uber', category: 'platform', country: 'US', ticker: 'UBER',
    aliases: ['uber'], homepage: 'https://www.uber.com/', stacks: ['infra'],
    announce: [{ name: 'Uber Engineering', url: 'https://www.uber.com/blog/engineering/',
      noFeed: 'every path answers 406 to an automated request (2026-08-28)' }],
  },
  {
    slug: 'spotify', name: 'Spotify', category: 'platform', country: 'SE', ticker: 'SPOT',
    aliases: ['spotify'], homepage: 'https://www.spotify.com/',
    stacks: ['platform-engineering'],
    announce: [{ name: 'Spotify Engineering', url: 'https://engineering.atspotify.com/' }],
  },
  {
    slug: 'slack', name: 'Slack', category: 'platform', country: 'US',
    aliases: ['slack', 'salesforce slack'], homepage: 'https://slack.com/', stacks: ['slack-platform'],
  },
  {
    slug: 'salesforce', name: 'Salesforce', category: 'vendor', country: 'US', ticker: 'CRM',
    aliases: ['salesforce'], homepage: 'https://www.salesforce.com/', stacks: ['salesforce'],
  },
  {
    slug: 'sap', name: 'SAP', category: 'vendor', country: 'DE', ticker: 'SAP',
    aliases: ['sap'], homepage: 'https://www.sap.com/', stacks: ['sap'],
  },
  {
    slug: 'canonical', name: 'Canonical', category: 'vendor', country: 'GB',
    aliases: ['canonical', 'ubuntu'], homepage: 'https://canonical.com/', stacks: ['ubuntu', 'linux'],
    announce: [{ name: 'Ubuntu Blog', url: 'https://ubuntu.com/blog' }],
  },
  {
    slug: 'suse', name: 'SUSE', category: 'vendor', country: 'DE',
    aliases: ['suse', 'opensuse', 'rancher'], homepage: 'https://www.suse.com/', stacks: ['linux'],
  },
  {
    slug: 'mozilla', name: 'Mozilla', category: 'foundation', country: 'US',
    aliases: ['mozilla', 'firefox'], homepage: 'https://www.mozilla.org/',
    stacks: ['browsers', 'web-platform'],
    announce: [{ name: 'Mozilla Hacks', url: 'https://hacks.mozilla.org/' }],
  },
  {
    slug: 'linux-foundation', name: 'Linux Foundation', category: 'foundation', country: 'US',
    aliases: ['linux foundation', 'cncf'], homepage: 'https://www.linuxfoundation.org/',
    stacks: ['linux', 'kubernetes'],
  },
  {
    slug: 'apache', name: 'Apache Software Foundation', category: 'foundation', country: 'US',
    aliases: ['apache software foundation', 'apache foundation', 'asf'],
    homepage: 'https://www.apache.org/', stacks: ['open-source'],
  },
  {
    slug: 'sonatype', name: 'Sonatype', category: 'security', country: 'US',
    aliases: ['sonatype', 'maven central'], homepage: 'https://www.sonatype.com/',
    stacks: ['supply-chain-security'],
  },
  {
    slug: 'jfrog', name: 'JFrog', category: 'vendor', country: 'IL', ticker: 'FROG',
    aliases: ['jfrog', 'artifactory'], homepage: 'https://jfrog.com/', stacks: ['devops'],
  },
  {
    slug: 'grafana-labs', name: 'Grafana Labs', category: 'vendor', country: 'US',
    aliases: ['grafana labs'], homepage: 'https://grafana.com/',
    stacks: ['grafana', 'observability'],
    announce: [{ name: 'Grafana Blog', url: 'https://grafana.com/blog/',
      feed: 'https://grafana.com/blog/index.xml' }],
  },
  {
    slug: 'datadog', name: 'Datadog', category: 'vendor', country: 'US', ticker: 'DDOG',
    aliases: ['datadog'], homepage: 'https://www.datadoghq.com/', stacks: ['datadog', 'observability'],
  },
  {
    slug: 'sentry', name: 'Sentry', category: 'vendor', country: 'US',
    aliases: ['sentry', 'functional software'], homepage: 'https://sentry.io/', stacks: ['sentry'],
    announce: [{ name: 'Sentry Blog', url: 'https://blog.sentry.io/' }],
  },
  {
    slug: 'cursor', name: 'Cursor', category: 'startup', country: 'US',
    aliases: ['cursor', 'anysphere'], homepage: 'https://cursor.com/', stacks: ['ai-coding-tools'],
  },
  {
    slug: 'replit', name: 'Replit', category: 'startup', country: 'US',
    aliases: ['replit'], homepage: 'https://replit.com/', stacks: ['ai-coding-tools'],
  },
  {
    slug: 'linear', name: 'Linear', category: 'startup', country: 'US',
    aliases: ['linear app'], homepage: 'https://linear.app/', stacks: ['practice'],
  },
];

// The kinds of paid technical work, as a person looking for it would name them.
//
// NOT the technology taxonomy. `fields.ts` files a story under whatever it is
// about; this files a POSTING under the kind of work it pays for, which is the
// unit a freelancer chooses between. "React" is a technology; "Frontend and
// web" is a market somebody can decide to work in.
//
// Matched against the text of a hiring post, a job-seeker's post or a board
// listing's title, category and tags. A post can sit in several markets -- a
// "senior backend engineer, Kubernetes, LLM features" posting is demand for
// three -- and every share computed from these is a share of posts mentioning
// the market, never a share of the market's size.
//
// THE PATTERNS WERE TUNED AGAINST REAL THREADS, 2019 to 2026 (see README). The
// traps found doing it are written next to the rule that avoids them.

export interface WorkMarket {
  slug: string;
  label: string;
  /** One line, for a reader who has not heard the term. */
  what: string;
  pattern: RegExp;
}

export const WORK_MARKETS: WorkMarket[] = [
  {
    slug: 'ai-engineering', label: 'AI and LLM engineering',
    what: 'Building products on language models: agents, retrieval, evaluation, integrations.',
    pattern: /\b(llms?|genai|gen ai|generative ai|large language models?|rag|ai agents?|agentic|mcp|prompt engineer\w*|openai|anthropic|langchain|llamaindex|fine[- ]tun\w+|ai engineer\w*|vector (?:database|db|search)|model context protocol)\b/i,
  },
  {
    slug: 'ai-training', label: 'AI training and evaluation work',
    what: 'Paid tasks that teach and grade models: writing, coding and reviewing for AI labs.',
    pattern: /\b(rlhf|data annotat\w+|data label\w+|ai trainers?|ai tutors?|annotators?|human feedback|red[- ]team\w*|model evaluat\w+)\b/i,
  },
  {
    slug: 'ml-data-science', label: 'Machine learning and data science',
    what: 'Training and shipping models, and the statistics around them.',
    pattern: /\b(machine learning|ml engineer\w*|mlops|data scien\w+|pytorch|tensorflow|computer vision|deep learning|recommendation systems?)\b/i,
  },
  {
    slug: 'data-engineering', label: 'Data engineering',
    what: 'Pipelines, warehouses and streaming: moving and shaping data for others to use.',
    pattern: /\b(data engineer\w*|data pipelines?|spark|airflow|dbt|snowflake|databricks|etl|elt|kafka|clickhouse|bigquery|data warehous\w+)\b/i,
  },
  {
    slug: 'cloud-devops', label: 'Cloud, DevOps and platform',
    what: 'Running infrastructure: cloud accounts, Kubernetes, CI/CD, reliability.',
    pattern: /\b(devops|sre|site reliability|kubernetes|k8s|terraform|platform engineer\w*|infrastructure engineer\w*|cloud engineer\w*|aws|gcp|azure|ci\/cd)\b/i,
  },
  {
    slug: 'security', label: 'Security',
    what: 'Application and infrastructure security, penetration testing, detection.',
    // Not "SOC 2": that is a compliance certificate a company mentions when it
    // is selling to enterprises, and it put every B2B startup in this market.
    pattern: /\b(security engineer\w*|appsec|application security|product security|penetration test\w*|pentest\w*|infosec|cyber ?security|offensive security|threat detection|security analyst|detection engineer\w*)\b/i,
  },
  {
    slug: 'backend', label: 'Backend and APIs',
    what: 'Services, APIs and the systems behind an application.',
    // No bare "java": \bjava\b does not match "javascript", but "rails" and
    // "go" are ordinary words, so only their unambiguous spellings are here.
    pattern: /\b(back[- ]?end|golang|java|elixir|ruby on rails|django|fastapi|node\.?js|\.net|c#|php|laravel|scala|microservices|distributed systems)\b/i,
  },
  {
    slug: 'frontend', label: 'Frontend and web',
    what: 'Interfaces in the browser: React, Vue, design systems, web apps.',
    pattern: /\b(front[- ]?end|react(?!\s+native)|vue(?:\.js)?|angular|svelte|next\.?js|nuxt|tailwind|web developer)\b/i,
  },
  {
    slug: 'mobile', label: 'Mobile apps',
    what: 'iOS and Android apps, native or cross-platform.',
    pattern: /\b(ios|android|swiftui|kotlin|flutter|react native|mobile (?:developer|engineer|app\w*))\b/i,
  },
  {
    slug: 'crypto-web3', label: 'Crypto and web3',
    what: 'Smart contracts, protocols, wallets and exchanges.',
    pattern: /\b(blockchain|cryptocurrenc\w+|crypto|web3|solidity|smart contracts?|defi|ethereum|solana|evm|onchain|on-chain|stablecoins?)\b/i,
  },
  {
    slug: 'embedded-hardware', label: 'Embedded, hardware and robotics',
    what: 'Firmware, electronics and machines that move.',
    pattern: /\b(embedded|firmware|robotics?|fpga|rtos|hardware engineer\w*|pcb|microcontrollers?)\b/i,
  },
  {
    slug: 'game-dev', label: 'Game development',
    what: 'Games and real-time 3D.',
    // "Unity" only as a word: \b stops "community" and "opportunity".
    pattern: /\b(game (?:developer|engineer|dev|development|studio)|gamedev|unity|unreal engine|godot)\b/i,
  },
  {
    slug: 'qa-testing', label: 'QA and test automation',
    what: 'Testing software for a living: automation, SDET, quality.',
    pattern: /\b(qa engineer\w*|quality assurance|test automation|sdet|playwright|cypress|selenium)\b/i,
  },
  {
    slug: 'design-ux', label: 'Design and UX',
    what: 'Product, interface, brand and visual design.',
    // Brand and graphic design are included: on the boards they are the largest
    // design category and one of the most freelanced kinds of work there is.
    pattern: /\b(product designer|ux|ui\/ux|ux\/ui|user experience|figma|interaction designer|(?:graphic|brand|visual|web|motion) design\w*)\b/i,
  },
  {
    slug: 'devrel-writing', label: 'Developer relations and technical writing',
    what: 'Documentation, tutorials and developer advocacy.',
    pattern: /\b(developer relations|devrel|developer advocate|technical writ\w+|documentation engineer)\b/i,
  },
  {
    slug: 'it-support', label: 'IT support and administration',
    what: 'Keeping an organisation’s systems and people running.',
    pattern: /\b(it support|help ?desk|sysadmin|system administrat\w+|desktop support|technical support)\b/i,
  },
];

/**
 * Individual skills, measured the same way, for what a market is made of.
 *
 * A market can hold still while its skills turn over underneath it -- "AI and
 * LLM engineering" grew steadily while the skill being asked for moved from
 * fine-tuning to retrieval to agents to MCP -- so the skills are counted too.
 */
export const WORK_SKILLS: WorkMarket[] = [
  { slug: 'agents', label: 'AI agents', what: 'Agentic systems and workflows.',
    pattern: /\b(ai agents?|agentic|agent workflows?|multi-agent)\b/i },
  { slug: 'mcp', label: 'MCP', what: 'Model Context Protocol servers and clients.',
    pattern: /\b(mcp|model context protocol)\b/i },
  { slug: 'rag', label: 'RAG and retrieval', what: 'Retrieval-augmented generation.',
    pattern: /\b(rag|retrieval[- ]augmented)\b/i },
  { slug: 'evals', label: 'LLM evaluation', what: 'Testing and grading model output.',
    pattern: /\b(evals|llm evaluation|model evaluation)\b/i },
  { slug: 'python', label: 'Python', what: '', pattern: /\bpython\b/i },
  { slug: 'typescript', label: 'TypeScript', what: '', pattern: /\btypescript\b/i },
  { slug: 'rust', label: 'Rust', what: '', pattern: /\brust\b/i },
  // "Go" as a capitalised word followed by a non-letter, or "golang". A
  // case-insensitive \bgo\b matched "go live", "go-to-market" and "go ahead".
  { slug: 'golang', label: 'Go', what: '', pattern: /\bgolang\b|\bGo\b(?![-a-zA-Z])/ },
  { slug: 'elixir', label: 'Elixir', what: '', pattern: /\belixir\b/i },
  { slug: 'java', label: 'Java', what: '', pattern: /\bjava\b/i },
  { slug: 'react', label: 'React', what: '', pattern: /\breact(?!\s+native)\b/i },
  { slug: 'nextjs', label: 'Next.js', what: '', pattern: /\bnext\.?js\b/i },
  { slug: 'postgres', label: 'PostgreSQL', what: '', pattern: /\bpostgres(?:ql)?\b/i },
  { slug: 'kubernetes', label: 'Kubernetes', what: '', pattern: /\b(kubernetes|k8s)\b/i },
  { slug: 'terraform', label: 'Terraform', what: '', pattern: /\bterraform\b/i },
  { slug: 'aws', label: 'AWS', what: '', pattern: /\baws\b/i },
  { slug: 'flutter', label: 'Flutter', what: '', pattern: /\bflutter\b/i },
  { slug: 'react-native', label: 'React Native', what: '', pattern: /\breact native\b/i },
  { slug: 'solidity', label: 'Solidity', what: '', pattern: /\bsolidity\b/i },
  { slug: 'pytorch', label: 'PyTorch', what: '', pattern: /\bpytorch\b/i },
];

export function marketsOf(text: string): string[] {
  const t = String(text ?? '');
  return WORK_MARKETS.filter((m) => m.pattern.test(t)).map((m) => m.slug);
}

export function skillsOf(text: string): string[] {
  const t = String(text ?? '');
  return WORK_SKILLS.filter((m) => m.pattern.test(t)).map((m) => m.slug);
}

export function marketLabel(slug: string): string {
  const s = slug.startsWith('skill:') ? slug.slice(6) : slug;
  return [...WORK_MARKETS, ...WORK_SKILLS].find((m) => m.slug === s)?.label ?? s;
}

/** How work arrives on each kind of platform, in the order /work lists them. */
export const PLATFORM_KINDS: Record<string, { title: string; blurb: string; short: string }> = {
  marketplace: { title: 'Freelance marketplaces', short: 'freelance marketplace',
    blurb: 'Clients post work and freelancers compete for it.' },
  network: { title: 'Vetted talent networks', short: 'vetted network',
    blurb: 'Pass a screen once, then get matched to engagements.' },
  'ai-work': { title: 'AI training and evaluation work', short: 'AI training work',
    blurb: 'Paid tasks for AI labs: writing, coding and grading model output.' },
  board: { title: 'Remote job boards', short: 'job board',
    blurb: 'Contract and full-time remote roles; apply to the employer.' },
  community: { title: 'Community hiring threads', short: 'hiring thread',
    blurb: 'Companies post roles in public; you reply directly.' },
  bounty: { title: 'Bounties and competitions', short: 'bounties',
    blurb: 'Paid per result, open to anyone who delivers.' },
  security: { title: 'Security bounties and audit contests', short: 'security bounties',
    blurb: 'Paid for vulnerabilities found.' },
};

/** The boards this archive reads, with the address a reader should be sent to. */
export interface WorkBoard { slug: string; label: string; url: string }

export const WORK_BOARDS: WorkBoard[] = [
  { slug: 'himalayas', label: 'Himalayas', url: 'https://himalayas.app/jobs' },
  { slug: 'weworkremotely', label: 'We Work Remotely', url: 'https://weworkremotely.com' },
  { slug: 'remoteok', label: 'Remote OK', url: 'https://remoteok.com' },
  { slug: 'jobicy', label: 'Jobicy', url: 'https://jobicy.com' },
  { slug: 'workingnomads', label: 'Working Nomads', url: 'https://www.workingnomads.com/jobs' },
  { slug: 'superteam', label: 'Superteam Earn', url: 'https://earn.superteam.fun' },
];

export function boardLabel(slug: string): string {
  return WORK_BOARDS.find((b) => b.slug === slug)?.label ?? slug;
}

// Where a person goes to take paid technical work.
//
// 2026-09-13: "...and we can use which platform to attend to this market."
//
// NOT THE REGISTRY RETIRED IN 0050. That one held 56 earning channels and was
// judged by whether the technology press mentioned them, which it never did.
// These are judged by what they carry: six publish a feed that
// src/collect/workmarket.ts reads, so the page can say what share of their
// listings is in each market. The rest publish nothing machine-readable and are
// listed for what they are, with no activity number invented for them.
//
// `how` says how work arrives -- bid, get matched, apply, claim a bounty --
// because that decides whether a platform suits someone at all. No fees and no
// earnings figures: those change without notice and a wrong one costs money.

export interface WorkPlatformSeed {
  slug: string;
  name: string;
  url: string;
  kind: 'marketplace' | 'network' | 'board' | 'community' | 'ai-work' | 'bounty' | 'security';
  how: string;
  /** Market slugs from src/vocab/workmarkets.ts. '*' means every technical market. */
  markets: string[];
  measuredBy?: string;
}

const TECH = [
  'ai-engineering', 'backend', 'frontend', 'mobile', 'cloud-devops', 'data-engineering',
  'ml-data-science', 'qa-testing', 'design-ux', 'devrel-writing',
];

export const WORK_PLATFORMS: WorkPlatformSeed[] = [
  // Freelance marketplaces: clients post work, freelancers compete for it.
  { slug: 'upwork', name: 'Upwork', url: 'https://www.upwork.com', kind: 'marketplace',
    how: 'Clients post projects and hourly contracts; freelancers send proposals.',
    markets: [...TECH, 'crypto-web3', 'security', 'it-support'] },
  { slug: 'fiverr', name: 'Fiverr', url: 'https://www.fiverr.com', kind: 'marketplace',
    how: 'Freelancers list fixed-scope services that buyers order directly.',
    markets: ['design-ux', 'frontend', 'ai-engineering', 'devrel-writing', 'mobile'] },
  { slug: 'freelancer', name: 'Freelancer.com', url: 'https://www.freelancer.com', kind: 'marketplace',
    how: 'Clients post projects and contests; freelancers bid.',
    markets: [...TECH, 'embedded-hardware'] },
  { slug: 'contra', name: 'Contra', url: 'https://contra.com', kind: 'marketplace',
    how: 'Independents publish a portfolio profile; clients post projects and hire directly.',
    markets: ['design-ux', 'frontend', 'ai-engineering', 'mobile'] },
  { slug: 'malt', name: 'Malt', url: 'https://www.malt.com', kind: 'marketplace',
    how: 'European freelance marketplace; companies search profiles and send missions.',
    markets: TECH },
  { slug: 'peopleperhour', name: 'PeoplePerHour', url: 'https://www.peopleperhour.com', kind: 'marketplace',
    how: 'Clients post jobs; freelancers send proposals or sell fixed-price offers.',
    markets: ['frontend', 'design-ux', 'devrel-writing', 'backend'] },

  // Vetted networks: pass a screen once, then get matched to engagements.
  { slug: 'toptal', name: 'Toptal', url: 'https://www.toptal.com', kind: 'network',
    how: 'Screening process for applicants; accepted freelancers are matched to client engagements.',
    markets: [...TECH, 'security'] },
  { slug: 'arc', name: 'Arc.dev', url: 'https://arc.dev', kind: 'network',
    how: 'Remote developers are vetted, then apply to or are matched with freelance and full-time roles.',
    markets: TECH },
  { slug: 'gunio', name: 'Gun.io', url: 'https://gun.io', kind: 'network',
    how: 'Vetted freelance software engineers matched to contract work.',
    markets: TECH },
  { slug: 'lemonio', name: 'Lemon.io', url: 'https://lemon.io', kind: 'network',
    how: 'Vetted developers matched with startups for contract work.',
    markets: ['frontend', 'backend', 'mobile', 'ai-engineering', 'cloud-devops'] },
  { slug: 'braintrust', name: 'Braintrust', url: 'https://www.braintrust.com', kind: 'network',
    how: 'Talent network where clients post roles and vetted members apply.',
    markets: [...TECH, 'crypto-web3'] },
  { slug: 'ateam', name: 'A.Team', url: 'https://www.a.team', kind: 'network',
    how: 'Independent builders are assembled into small teams for product missions.',
    markets: ['ai-engineering', 'frontend', 'backend', 'design-ux', 'data-engineering'] },

  // AI training and evaluation work: the market that did not exist five years ago.
  { slug: 'mercor', name: 'Mercor', url: 'https://www.mercor.com', kind: 'ai-work',
    how: 'Applicants interview once and are matched to contract roles, many training and evaluating AI models.',
    markets: ['ai-training', 'ai-engineering', 'ml-data-science'] },
  { slug: 'outlier', name: 'Outlier', url: 'https://outlier.ai', kind: 'ai-work',
    how: 'Paid tasks writing, coding and reviewing training data for AI models.',
    markets: ['ai-training'] },
  { slug: 'dataannotation', name: 'DataAnnotation', url: 'https://www.dataannotation.tech', kind: 'ai-work',
    how: 'Paid tasks evaluating and improving AI output, including coding tasks.',
    markets: ['ai-training'] },
  { slug: 'alignerr', name: 'Alignerr', url: 'https://www.alignerr.com', kind: 'ai-work',
    how: 'Subject-matter experts label and evaluate data for AI models.',
    markets: ['ai-training'] },

  // Remote job boards with a public feed, measured.
  { slug: 'himalayas', name: 'Himalayas', url: 'https://himalayas.app/jobs', kind: 'board',
    how: 'Remote job board; apply on the employer’s site.', markets: ['*'], measuredBy: 'himalayas' },
  { slug: 'weworkremotely', name: 'We Work Remotely', url: 'https://weworkremotely.com', kind: 'board',
    how: 'Remote job board organised by category; apply on the employer’s site.',
    markets: ['*'], measuredBy: 'weworkremotely' },
  { slug: 'remoteok', name: 'Remote OK', url: 'https://remoteok.com', kind: 'board',
    how: 'Remote job board with tags and salary ranges; apply on the employer’s site.',
    markets: ['*'], measuredBy: 'remoteok' },
  { slug: 'jobicy', name: 'Jobicy', url: 'https://jobicy.com', kind: 'board',
    how: 'Remote job board filtered by industry and region.', markets: ['*'], measuredBy: 'jobicy' },
  { slug: 'workingnomads', name: 'Working Nomads', url: 'https://www.workingnomads.com/jobs', kind: 'board',
    how: 'Curated remote job listings by category.', markets: ['*'], measuredBy: 'workingnomads' },
  { slug: 'wellfound', name: 'Wellfound', url: 'https://wellfound.com', kind: 'board',
    how: 'Startup job board; many roles list salary and equity and allow remote.',
    markets: [...TECH, 'crypto-web3'] },
  { slug: 'web3career', name: 'web3.career', url: 'https://web3.career', kind: 'board',
    how: 'Job board for crypto and web3 roles.', markets: ['crypto-web3'] },

  // Community threads, measured.
  { slug: 'hn-whoishiring', name: 'Hacker News: Who is hiring?', url: 'https://news.ycombinator.com/submitted?id=whoishiring',
    kind: 'community',
    how: 'One thread a month; companies post roles and you contact them directly. The companion “Who wants to be hired?” thread is where you post yourself.',
    markets: ['*'], measuredBy: 'hn-whoishiring' },

  // Bounties and competitions: paid per result, open to anyone.
  { slug: 'superteam', name: 'Superteam Earn', url: 'https://earn.superteam.fun', kind: 'bounty',
    how: 'Open bounties and projects paid in stablecoins, mostly from the Solana ecosystem.',
    markets: ['crypto-web3', 'frontend', 'design-ux', 'devrel-writing'], measuredBy: 'superteam' },
  { slug: 'algora', name: 'Algora', url: 'https://algora.io', kind: 'bounty',
    how: 'Companies and maintainers attach cash bounties to open-source GitHub issues.',
    markets: ['backend', 'frontend', 'cloud-devops'] },
  { slug: 'kaggle', name: 'Kaggle', url: 'https://www.kaggle.com/competitions', kind: 'bounty',
    how: 'Machine-learning competitions, some with prize money.', markets: ['ml-data-science'] },

  // Security: bug bounties and audit contests.
  { slug: 'hackerone', name: 'HackerOne', url: 'https://www.hackerone.com', kind: 'security',
    how: 'Companies run bug bounty programmes; researchers report vulnerabilities for rewards.',
    markets: ['security'] },
  { slug: 'bugcrowd', name: 'Bugcrowd', url: 'https://www.bugcrowd.com', kind: 'security',
    how: 'Bug bounty and penetration-testing programmes open to researchers.', markets: ['security'] },
  { slug: 'immunefi', name: 'Immunefi', url: 'https://immunefi.com', kind: 'security',
    how: 'Bug bounties for crypto protocols and smart contracts.', markets: ['security', 'crypto-web3'] },
  { slug: 'code4rena', name: 'Code4rena', url: 'https://code4rena.com', kind: 'security',
    how: 'Competitive smart-contract audits; findings share a prize pool.', markets: ['security', 'crypto-web3'] },
  { slug: 'sherlock', name: 'Sherlock', url: 'https://www.sherlock.xyz', kind: 'security',
    how: 'Smart-contract audit contests and bug bounties.', markets: ['security', 'crypto-web3'] },
  { slug: 'cantina', name: 'Cantina', url: 'https://cantina.xyz', kind: 'security',
    how: 'Security review competitions and bug bounties for web3 code.', markets: ['security', 'crypto-web3'] },
];

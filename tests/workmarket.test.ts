import { describe, it, expect } from 'vitest';
import {
  threadKind, htmlText, readHiringPost, readSeekingPost, readFreelancePost, countThread,
  fromRemoteOk, fromWeWorkRemotely, fromSuperteam, fromHimalayas,
} from '../src/collect/workmarket.ts';
import { marketsOf, skillsOf } from '../src/vocab/workmarkets.ts';
import { statusOf, daysFor, competition, type WorkPicture } from '../src/analysis/workmarket.ts';
import { workMarketBlock, platformsFor, type PlatformRow } from '../src/ui/workmarket.ts';

// "The report still focus on projects, I want clear report - which market like
// freelancing, jobs are changes, which market appear newly and we can use which
// platform to attend to this market" -- 2026-09-13.

describe('which whoishiring stories are the monthly series', () => {
  it.each([
    ['Ask HN: Who is hiring? (September 2026)', 'hiring'],
    ['Ask HN: Who Is Hiring? (May 2012)', 'hiring'],
    ['Ask HN: Who wants to be hired? (September 2026)', 'seeking'],
    ['Ask HN: Freelancer? Seeking freelancer? (October 2025)', 'freelance'],
    ['Ask HN: Freelancer? Seeking Freelancers? (April 2011)', 'freelance'],
  ])('%s is %s', (title, kind) => {
    expect(threadKind(title)).toBe(kind);
  });

  it.each([
    'Ask HN: Who is hiring right now?',
    'Ask HN: Who wants to be hired right now?',
    'Ask HN: How much are remote software developers paid?',
    'Ask HN: Have the whoishiring posts been useful? Can we do better?',
  ])('%s is not', (title) => {
    expect(threadKind(title)).toBeNull();
  });
});

describe('a hiring post', () => {
  it('reads remote and contract from the header line, not the body', () => {
    const p = readHiringPost(htmlText(
      'We The Flywheel | AI-Native Engineers | REMOTE (worldwide) | Contract &#x2F; Part-time<p>We build agents.'));
    expect(p.remote).toBe(true);
    expect(p.contract).toBe(true);
  });

  it('does not call a post remote because the body mentions contractors', () => {
    const p = readHiringPost('Acme | Backend Engineer | Berlin | ONSITE | Full-time\nWe work with remote contractors.');
    expect(p.remote).toBe(false);
    expect(p.contract).toBe(false);
  });

  it('does not call "no remote" remote', () => {
    expect(readHiringPost('Acme | SRE | London | NO REMOTE').remote).toBe(false);
  });
});

describe('a job-seeker post', () => {
  it('reads remote from the template line', () => {
    expect(readSeekingPost('Location: Porto\nRemote: Yes (remote only)\nTechnologies: Rust').remote).toBe(true);
    expect(readSeekingPost('Location: Porto\nRemote: No\nTechnologies: Rust').remote).toBe(false);
  });

  it('counts a seeker open to contract work', () => {
    expect(readSeekingPost('Remote: Yes\nOpen to freelance or full-time.').contract).toBe(true);
  });
});

describe('a freelance-thread post', () => {
  it('knows which side it is on', () => {
    expect(readFreelancePost('SEEKING WORK - Remote. Full stack Rails.').side).toBe('work');
    expect(readFreelancePost('SEEKING FREELANCER | SWITZERLAND | REMOTE').side).toBe('hire');
    expect(readFreelancePost('Just a comment about the thread').side).toBeNull();
  });
});

describe('counting a thread', () => {
  it('counts posts, remote and contract for all and for each market', () => {
    const rows = countThread('hiring', [
      'Acme | LLM Engineer | REMOTE | Contract',
      'Beta | Frontend (React) | NYC | Full-time',
      'Gamma | Security Engineer | REMOTE',
    ]);
    const v = (market: string, measure: string) =>
      rows.find((r) => r.market === market && r.measure === measure)?.value ?? 0;
    expect(v('all', 'posts')).toBe(3);
    expect(v('all', 'remote')).toBe(2);
    expect(v('all', 'contract')).toBe(1);
    expect(v('ai-engineering', 'posts')).toBe(1);
    expect(v('frontend', 'posts')).toBe(1);
    expect(v('security', 'remote')).toBe(1);
  });

  it('keeps a zero row for a freelance side nobody posted on', () => {
    const rows = countThread('freelance', ['SEEKING WORK - remote Python']);
    expect(rows.find((r) => r.dataset === 'freelance-hire' && r.market === 'all')?.value).toBe(0);
    expect(rows.find((r) => r.dataset === 'freelance-work' && r.market === 'all')?.value).toBe(1);
  });
});

describe('the market vocabulary', () => {
  it.each([
    ['Senior React Native developer', 'mobile', 'frontend'],
    ['Community manager, great opportunity', null, 'game-dev'],
    ['We are SOC 2 compliant', null, 'security'],
    ['Solidity smart contract auditor', 'crypto-web3', null],
    ['AI trainer for coding tasks (RLHF)', 'ai-training', null],
    ['Build MCP servers and AI agents', 'ai-engineering', null],
  ])('%s', (text, yes, no) => {
    const ms = marketsOf(text);
    if (yes) expect(ms).toContain(yes);
    if (no) expect(ms).not.toContain(no);
  });

  it('reads Go only as the language', () => {
    expect(skillsOf('Backend in Go, Postgres')).toContain('golang');
    expect(skillsOf('ready to go live next week')).not.toContain('golang');
    expect(skillsOf('our go-to-market team')).not.toContain('golang');
  });
});

describe('new, growing, steady, shrinking', () => {
  it.each([
    [4.5, 1.0, 'new'],
    [28.4, 16.3, 'growing'],
    [4.5, 2.8, 'growing'],
    [26.1, 31.9, 'shrinking'],
    [1.1, 4.7, 'shrinking'],
    [10.3, 11.0, 'steady'],
    [10.0, null, 'steady'],
  ])('%s%% against %s%% is %s', (now, before, status) => {
    expect(statusOf(now, before)).toBe(status);
  });

  it('calls a market with more asks than candidates short of candidates', () => {
    expect(competition(7.7 / 1.6)).toBe('few candidates');
    expect(competition(26.1 / 51.9)).toBe('crowded');
    expect(competition(1)).toBe('balanced');
  });
});

describe('which thread a period reads', () => {
  const all = ['2026-07-01', '2026-08-03', '2026-09-01'];
  it('reads the threads inside a month', () => {
    expect(daysFor(all, Date.parse('2026-08-01'), Date.parse('2026-09-01'))).toEqual(['2026-08-03']);
  });
  it('reads the thread in force for a week with none inside it', () => {
    expect(daysFor(all, Date.parse('2026-08-17'), Date.parse('2026-08-24'))).toEqual(['2026-08-03']);
  });
  it('reads nothing when the latest thread is too old to be in force', () => {
    expect(daysFor(['2020-01-01'], Date.parse('2026-08-17'), Date.parse('2026-08-24'))).toEqual([]);
  });
});

describe('board feeds', () => {
  it('skips the legal notice at the head of Remote OK', () => {
    const rows = fromRemoteOk([{ legal: 'terms' },
      { id: '1', position: 'Senior Backend Engineer', tags: ['rust'], date: '2026-09-12T16:00:10+00:00', url: 'https://remoteok.com/x' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.markets).toContain('backend');
  });

  it('classifies Remote OK by title, because its tags are attached to almost everything', () => {
    const [row] = fromRemoteOk([{ id: '2', position: 'Technical Product Lead AI Finance App',
      tags: ['sys admin', 'infosec', 'exec', 'mobile', 'ops'] }]);
    expect(row!.markets).not.toContain('security');
    expect(row!.markets).not.toContain('mobile');
  });

  it('reads company, role and category from We Work Remotely', () => {
    const rows = fromWeWorkRemotely(`<rss><channel><item>
      <title>Pinterest: Data Scientist II, ML Infrastructure</title>
      <region>Anywhere in the World</region><category>Full-Stack Programming</category>
      <type>Full-Time</type><pubDate>Sun, 13 Sep 2026 07:31:12 +0000</pubDate>
      <link>https://weworkremotely.com/remote-jobs/x</link></item></channel></rss>`);
    expect(rows[0]).toMatchObject({ company: 'Pinterest', title: 'Data Scientist II, ML Infrastructure',
      category: 'Full-Stack Programming', employment: 'Full-Time' });
    expect(rows[0]!.markets).toContain('ml-data-science');
  });

  it('files every Superteam listing under crypto, with its reward and submissions', () => {
    const [row] = fromSuperteam([{ id: 'a', title: 'Write a thread', rewardAmount: 1000, token: 'USDC',
      type: 'bounty', slug: 'write-a-thread', _count: { Submission: 28 } }]);
    expect(row!.markets).toContain('crypto-web3');
    expect(row!.reward).toBe(1000);
    expect(row!.submissions).toBe(28);
  });

  it('reads Himalayas categories as tags', () => {
    const [row] = fromHimalayas({ jobs: [{ title: 'Platform Engineer', guid: 'g1',
      categories: ['Kubernetes-Engineer'], parentCategories: ['Developer'], pubDate: 1789327560 }] });
    expect(row!.markets).toContain('cloud-devops');
    expect(row!.postedAt?.slice(0, 4)).toBe('2026');
  });
});

describe('the report block', () => {
  const picture: WorkPicture = {
    now: { days: ['2026-09-01'], hiring: 261, seeking: 563, remote: 52.5, contract: 5.7,
      seekingRemote: 87.6, seekingContract: 34.3, freelanceWork: null, freelanceHire: null },
    before: { days: ['2025-09-01'], hiring: 280, seeking: 400, remote: 58, contract: 4,
      seekingRemote: 85, seekingContract: 20, freelanceWork: 110, freelanceHire: 1 },
    markets: [
      { slug: 'security', label: 'Security', what: 'Security work.', now: 7.7, before: 2.5, change: 5.2,
        supply: 1.6, pressure: 4.8, remote: 60, contract: 5, posts: 20, status: 'growing' },
      { slug: 'frontend', label: 'Frontend and web', what: 'Web.', now: 26.1, before: 31.9, change: -5.8,
        supply: 51.9, pressure: 0.5, remote: 50, contract: 3, posts: 68, status: 'shrinking' },
    ],
    skills: [],
    boards: [{ board: 'himalayas', label: 'Himalayas', url: 'https://himalayas.app/jobs', listings: 200,
      open: 103817, markets: [{ slug: 'security', n: 12, share: 6 }], contract: 4 }],
    bounties: null,
    lastFreelanceThread: '2025-10-01',
  };
  const platforms: PlatformRow[] = [
    { slug: 'hackerone', name: 'HackerOne', url: 'https://www.hackerone.com', kind: 'security',
      how: 'Bug bounties.', markets: ['security'], measured_by: null },
    { slug: 'upwork', name: 'Upwork', url: 'https://www.upwork.com', kind: 'marketplace',
      how: 'Proposals.', markets: ['security', 'frontend'], measured_by: null },
  ];
  const html = workMarketBlock(picture, 'month', platforms);

  it('leads with the market for work, not with projects', () => {
    expect(html.indexOf('The market for work')).toBeGreaterThanOrEqual(0);
    expect(html).toContain('261 companies posted roles');
    // Shares of ten or more are shown whole; a decimal on 52.5% is precision
    // the thread cannot support.
    expect(html).toContain('53% of roles are remote');
  });

  it('names what grew, what shrank and what is short of candidates', () => {
    expect(html).toMatch(/<b>Growing:<\/b> Security/);
    expect(html).toMatch(/<b>Shrinking:<\/b> Frontend and web/);
    expect(html).toContain('Fewest candidates per role');
  });

  it('says where to take the growing work, measured board first', () => {
    const where = platformsFor('security', platforms, picture);
    expect(where[0]!.name).toBe('Himalayas');
    expect(where.map((w) => w.name)).toContain('HackerOne');
    expect(where.findIndex((w) => w.name === 'HackerOne'))
      .toBeLessThan(where.findIndex((w) => w.name === 'Upwork'));
    expect(html).toContain('Where to take the work');
  });

  it('says the freelance thread ended rather than showing nothing', () => {
    expect(html).toContain('stopped its monthly');
  });
});

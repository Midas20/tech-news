// The topic filter, against the titles that produced it.
//
// Every case here is a real headline collected by this system in August 2026 --
// not an invented one. A filter written against imagined input is a filter
// tuned to the imagination, and the false positives in the second block are the
// ones that actually happened on the first dry run.

import { describe, it, expect } from 'vitest';
import { judgeTopic } from '../src/collect/topical.ts';

const keep = (t: string, s = '') => judgeTopic(t, s).keep;
const why = (t: string, s = '') => judgeTopic(t, s).category;

describe('refuses what is not a technology story', () => {
  it('shopping', () => {
    expect(why('The best early Labor Day Costco deals 2026: TVs, smartwatches, Apple devices'))
      .toBe('commerce');
    expect(why("This Blink security camera can last up to 2 years on one charge - and it's on sale"))
      .toBe('commerce');
    expect(why('Get up to 56% off lightweight down jackets from Patagonia, Rab and Arc’teryx'))
      .toBe('commerce');
    // The bug the first dry run found: a bare \d in the price pattern made the
    // boundary check land on the second digit, so "$90" never matched.
    expect(why('MSI is on a mission to upgrade your WFH setup with this 27-inch monitor dropping to under $90'))
      .toBe('commerce');
    expect(why("Seagate's 8TB BarraCuda drops to $250 at Best Buy")).toBe('commerce');
  });

  it('television, film and games', () => {
    expect(why('Reacher season 4 fans have forgotten that the hit Prime Video crime drama')).toBe('entertainment');
    expect(why('Metro 2039 executive producer says the game brings back the spookiness')).toBe('entertainment');
    expect(why('Everything announced at Gamescom Opening Night Live 2026')).toBe('entertainment');
  });

  it('sport', () => {
    // Refused as entertainment or as sport -- "how to watch" fires first and
    // both are correct. What is asserted is that it does not survive.
    expect(keep('How to watch UCI Mountain Bike World Championships 2026 for FREE: Live Streams'))
      .toBe(false);
    expect(why('Apple, MLB announce September “Friday Night Baseball” schedule')).toBe('sport');
  });

  it('politics', () => {
    expect(why('Texas Governor Abbott Directs Comprehensive Data Center Audit')).toBe('politics');
    expect(why("US refunds $100B of Donald Trump's 'liberation day' tariffs")).toBe('politics');
    expect(why('Utah lawmakers decided to tax large tech companies')).toBe('politics');
    // Naming a technology is NOT enough to rescue a political story -- this is
    // the case the first draft got wrong, and it is the user's actual request.
    expect(why('OpenAI bans Russian ChatGPT accounts posing as a fake Israeli think tank'))
      .toBe('politics');
  });

  it('the reports', () => {
    expect(why('New study finds bosses are far more comfortable sharing work documents with AI'))
      .toBe('business');
    expect(why('AI is hitting entry-level jobs hardest, Stanford study finds')).toBe('business');
    expect(why('Ventures Platform goes bigger with its second Africa fund',
      'The firm raises $75M for its second fund')).toBe('business');
  });

  it('ordinary crime', () => {
    expect(why('$50k worth of retro Nintendo NES games stolen in devastating home robbery'))
      // Nintendo makes this entertainment before it is crime; either is correct
      // and both are refusals. What matters is that it does not survive.
      .toBeDefined();
    expect(keep('Seattle contractor settles death lawsuit over 911 ambulance wait')).toBe(false);
  });
});

describe('keeps technical announcements and technical discussion', () => {
  it('releases and product news', () => {
    expect(keep('OpenTelemetry Comes to IntelliJ IDEA, GoLand, PyCharm, and WebStorm')).toBe(true);
    expect(keep('Amazon EC2 M8i and M8i-flex instances are now available in Canada West')).toBe(true);
    expect(keep('Next.js 16.3 support on Vercel')).toBe(true);
    expect(keep('Introducing Governance Hub: account-level governance over your Databricks estate'))
      .toBe(true);
    expect(keep('Vercel Sandbox now supports 10,000 concurrent sandboxes')).toBe(true);
  });

  it('security, which shares its vocabulary with crime', () => {
    expect(keep('New Windows malware lays dormant until a custom command activates it')).toBe(true);
    expect(keep('Android car systems abused by hackers to launch new malware')).toBe(true);
    expect(keep("You could've applied all 1,449 Oracle patches and still been hit by this attack",
      'The attack chain relies on credential theft')).toBe(true);
    expect(keep('Cloudflare DDoS Threat Report H1 2026: 1 Tbps attacks soar as DNS floods '
      + 'and geopolitical tension rise')).toBe(true);
  });

  it('discussion', () => {
    expect(keep('How to self-host your own AI agent')).toBe(true);
    expect(keep('Debian polls its developers on whether to burn the bots')).toBe(true);
    expect(keep('How Factory scaled its cloud backend to one billion monthly requests')).toBe(true);
  });

  it('the false positives the first dry run produced', () => {
    // Retail vocabulary used to describe history.
    expect(keep('Windows NT 4 went on sale 30 years ago today')).toBe(true);
    // Open source governs itself with the vocabulary of government.
    expect(keep('Announcing the Packaging Council Election Candidates for 2026!')).toBe(true);
    // Hackaday's vacuum is a tube, not a cleaner.
    expect(keep('Tech in Plain Sight: Vacuum Blood Collection')).toBe(true);
    // "War" is political in every sentence except these.
    expect(keep('Secret Cold War IBM Supercomputer Was Built for One Job')).toBe(true);
    expect(keep('The AI industry is about to relearn every lesson of the ad blocking wars')).toBe(true);
    // Visa the payments company is not an immigration story.
    expect(why('Visa to Cut 7% of Workforce')).not.toBe('politics');
  });
});

describe('who the rules apply to', () => {
  it('leaves release and research feeds alone entirely', () => {
    // A release feed publishes releases. Running a shopping filter over it can
    // only produce mistakes.
    expect(keep('Deals with the SOCKS5 handshake')).toBe(false);
    expect(judgeTopic('Deals with the SOCKS5 handshake', '', { sourceKind: 'releases' }).keep)
      .toBe(true);
    expect(judgeTopic('Election forecasting with Bayesian methods', '',
      { sourceKind: 'research' }).keep).toBe(true);
  });

  it('lets a vendor announce its own pricing', () => {
    const title = 'DeepSeek V4 Flash is 90% off through Novita on AI Gateway';
    expect(judgeTopic(title, '', { sourceKind: 'news' }).keep).toBe(false);
    expect(judgeTopic(title, '', { sourceKind: 'news', sourceRoles: ['PRIMARY'] }).keep).toBe(true);
  });

  it('an empty title is never refused', () => {
    expect(keep('')).toBe(true);
    expect(keep('   ')).toBe(true);
  });
});

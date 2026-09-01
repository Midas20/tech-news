// The gate that has to exist before the beat widens to money.
//
// The archive's second and third targets -- market moves, and platforms a
// person can earn from -- are covered by a press that is mostly speculation.
// Measured on 2026-08-29, BEFORE this rule, the gauntlet kept
//
//   "Top 10 best crypto to buy now before they explode"   -> market
//   "Bitcoin price prediction: BTC could hit $200,000"    -> change
//
// and threw away "Binance adds USDC staking", "Uniswap v5 launches on mainnet"
// and "Ethereum Foundation ships Fusaka upgrade to mainnet". It was exactly
// backwards for the beat it was about to be pointed at. Adding the sources
// first would have filled the archive with the worst writing on the internet
// and left somebody to find out afterwards.
//
// Both halves are tested here, because either alone is a worse filter than
// neither: a gate with no evidence rule refuses the announcements too, and an
// evidence rule with no gate lets the pump in.

import { describe, it, expect } from 'vitest';
import { judgeTopic, isTechnicalTitle } from '../src/collect/topical.ts';
import { classifyEvent, isEvent } from '../src/collect/eventful.ts';

const judge = (t: string) =>
  judgeTopic(t, '', { sourceKind: 'news', sourceRoles: ['CONTENT'] });

describe('speculation', () => {
  const REFUSE = [
    'Bitcoin price prediction: BTC could hit $200,000',
    'XRP price prediction 2027: can it reach $10?',
    'Solana could hit $500 this cycle, analyst says',
    'Top 10 best crypto to buy now before they explode',
    '5 altcoins to buy now before the next bull run',
    'Best meme coins to watch in 2026',
    'Should you buy the dip in Ethereum?',
    'How I made $12,000 a month with crypto in 2026',
    'How I earned $8,400 with staking last month',
    'Passive income with crypto: my 2026 setup',
    'Bitcoin price surges 12% after ETF news',
    'Earn free crypto with these 5 airdrops',
    'This token has 100x potential, here is why',
  ];

  it('refuses the genre outright', () => {
    for (const t of REFUSE) {
      const v = judge(t);
      expect(v.keep, t).toBe(false);
      expect(v.category, t).toBe('speculation');
    }
  });

  it('cannot be rescued by naming a technology', () => {
    // rescue: 'none'. Every price prediction names a technology -- that is what
    // it is a prediction ABOUT -- so a technology signal here would undo the
    // whole rule.
    for (const t of ['Bitcoin price prediction: BTC could hit $200,000',
                     'Solana could hit $500 this cycle, analyst says']) {
      expect(judge(t).keep, t).toBe(false);
    }
  });
});

describe('what the gate must NOT take with it', () => {
  // Every one of these was a real casualty of a first draft, found by replaying
  // the rule over the 2,616 stories the archive already held. The final rule
  // costs zero of them.
  const KEEP = [
    // "will reach" is how an end-of-life notice is written, and those are among
    // the most useful items here.
    'Azure Databricks Runtime 10.4 LTS will reach end of life on November 1, 2026',
    // Moonshot AI ships models; the genre and the company share a word.
    'Moonshot AI Kimi K2.7 Code now available on Workers AI',
    // 100x is how engineers write a performance claim.
    'Training 100x Cheaper Retrieval models',
    // A threat report moves a number without being about a price.
    'Cloudflare DDoS Threat Report: 1 Tbps attacks soar 40%',
    'Ethereum completes Fusaka hard fork on mainnet',
    'Lido adds support for distributed validators',
  ];

  it('keeps them all', () => {
    for (const t of KEEP) expect(judge(t).keep, t).toBe(true);
  });

  it('a price needs its whole number, not its first digit', () => {
    // The trailing boundary group lands on the SECOND digit if the pattern ends
    // at a bare \d, so "could hit $500" never matched. The commerce rule
    // already records this exact bug; this is the second time it was written.
    expect(judge('Solana could hit $500 this cycle').keep).toBe(false);
    expect(judge('Solana could hit $5 this cycle').keep).toBe(false);
  });
});

describe('an announcement about being paid is an event', () => {
  // The general grammar missed every one of these. CHANGE matches `adds <word>
  // support|api|backend|driver|integration|mode` -- a closed list of nouns with
  // no way to be paid in it -- and `raises` reaches MARKET only with a currency
  // figure after it, while a revenue share is a percentage.
  const EVENTS = [
    'Binance adds USDC staking with 8% APY',
    'Kraken lists Monad and opens staking rewards',
    'Ethereum Foundation ships Fusaka upgrade to mainnet',
    'YouTube raises creator revenue share on Shorts',
    'Substack adds paid video subscriptions for writers',
    'Arbitrum announces DAO grants program for builders',
    'Helium rolls out new rewards structure for hotspot operators',
    'Fiverr introduces per-task pricing for sellers',
  ];

  it('classifies each as an event rather than an article', () => {
    for (const t of EVENTS) {
      expect(isEvent(classifyEvent(t, { sourceKind: 'news' }).kind), t).toBe(true);
    }
  });

  it('and each carries technology evidence, so a stranger can publish it', () => {
    // Every unvetted source must show a stack or a technical title. Without the
    // earning phrases these read as ordinary business prose and are dropped
    // before the event class is ever consulted.
    for (const t of EVENTS) expect(isTechnicalTitle(t), t).toBe(true);
  });

  it('does not make every mention of a price technical', () => {
    // The evidence is scoped to words that name a SELLER rather than a shopper.
    // Bare "pricing" and bare "subscription" would make every consumer price
    // story read as on-beat.
    expect(isTechnicalTitle('Netflix subscription costs more this year')).toBe(false);
    expect(isTechnicalTitle('The best pricing on winter coats')).toBe(false);
  });
});

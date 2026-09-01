// The money lens: the three ways a technology story has a number attached.

import { describe, it, expect } from 'vitest';
import { moneyClasses, MONEY, moneySql } from '../src/vocab/money.ts';

describe('what costs, what changes licence, what ends', () => {
  it('reads the money out of a changelog line', () => {
    expect(moneyClasses('Billing is now enabled for R2 SQL')).toContain('cost');
    expect(moneyClasses('AI Gateway - Get 50% off GPT-5.6 Sol')).toContain('cost');
    expect(moneyClasses('Custom Rate Limits available in Early Access')).toContain('cost');
    expect(moneyClasses('Retirement: Support for Node 22 LTS ends on April 30, 2027'))
      .toContain('eol');
    expect(moneyClasses('Azure Databricks Runtime 10.4 LTS will reach end of life'))
      .toContain('eol');
    expect(moneyClasses('HashiCorp adopts the Business Source License')).toContain('licence');
    expect(moneyClasses('Redis relicenses under RSAL and SSPL')).toContain('licence');
  });

  it('puts a story in both lists when it is in both', () => {
    // "The free tier ends" is a cost change and an ending, and forcing one
    // answer would make each list lie about the other.
    const both = moneyClasses('Heroku free tier ends in November');
    expect(both).toContain('cost');
    expect(both).toContain('eol');
  });

  it('needs a word boundary around every acronym', () => {
    // The first version listed SSPL bare and matched "Cro-sspl-ane", a
    // Kubernetes project with no licence news in it whatsoever. Every acronym
    // in the vocabulary is wrapped, and this is what holds it there.
    expect(moneyClasses('Crossplane v2.5.0-rc.0')).toEqual([]);
    expect(moneyClasses('Bslinger 1.2 released')).toEqual([]);
    expect(moneyClasses('Neologisms in Rust 1.90')).toEqual([]);
  });

  it('does not fire on an ordinary release', () => {
    expect(moneyClasses('Ansible v2.19.1')).toEqual([]);
    expect(moneyClasses('PostgreSQL 18.1 released')).toEqual([]);
    expect(moneyClasses('')).toEqual([]);
  });

  it('writes SQL for a known lens and nothing for an invented one', () => {
    // The pattern goes into the statement as a literal, so an unknown value has
    // to return null rather than an empty condition that matches everything.
    expect(moneySql('cost', 't')).toContain('t ~*');
    expect(moneySql('nonsense', 't')).toBeNull();
    expect(MONEY.map((m) => m.value)).toEqual(['cost', 'licence', 'eol']);
  });
});

// The report as a thing a freelancer reads, and as a page that is actually styled.
//
// Two complaints on 2026-09-09, and they turned out to be the same complaint:
//
//   "the purpose of this project is detect IT market changes and find opportunity
//    that I can attend to work remotely and create income as freelancer"
//   "the current report display style is messy"
//
// The first says the reader is one person deciding what to learn, build and quote
// for -- not an investor. An analysis section naming "EDA vendors" as the party
// who could take an opening has failed that reader. So the reading now leads with
// `work`: things one person could start on remotely, each with the evidence that
// somebody would pay for it.
//
// The second had a specific, findable cause. `mv-find` and `mv-cites` were used
// four times by the reading and defined nowhere, so the most important section on
// the site rendered as unstyled headings with the citation links running into one
// another. Every other test passed, because the HTML was perfectly valid.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateStrategy } from '../src/analysis/strategy.ts';

const page = readFileSync(new URL('../src/ui/briefing.ts', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../src/ui/theme.ts', import.meta.url), 'utf8');
const spec = readFileSync(new URL('../src/llm/jobs.ts', import.meta.url), 'utf8');
const analysis = readFileSync(
  new URL('../src/analysis/briefing.ts', import.meta.url), 'utf8');

const strategyPrompt = spec.slice(spec.indexOf('field_strategy:'));

const claim = (over: Record<string, unknown> = {}) => ({
  claim: 'Databricks is making auditability its wedge into regulated finance',
  reasoning: 'Last year the pitch was capability; this year it is proof.',
  then: [1], now: [1], ...over,
});

describe('work a single person could take', () => {
  const job = (over: Record<string, unknown> = {}) => ({
    what: 'Jira Data Center migrations, as a contract service',
    why: 'Atlassian is discontinuing sales and support for Data Center products.',
    skills: 'Jira administration and its REST API',
    horizon: 'now',
    evidence: [1],
    ...over,
  });

  it('keeps a cited, described piece of work', () => {
    const out = validateStrategy({ work: [job()] }, 10, 10);
    expect(out.work).toHaveLength(1);
    expect(out.work[0]!.horizon).toBe('now');
  });

  it('drops work with no evidence behind it', () => {
    // The whole claim is that somebody would pay for this, and the only reason
    // to believe it is in the stories.
    expect(validateStrategy({ work: [job({ evidence: [] })] }, 10, 10).work)
      .toHaveLength(0);
  });

  it('drops work with no stated reason to think there is demand', () => {
    expect(validateStrategy({ work: [job({ why: '' })] }, 10, 10).work).toHaveLength(0);
    expect(validateStrategy({ work: [job({ what: '  ' })] }, 10, 10).work).toHaveLength(0);
  });

  it('downgrades an unrecognised horizon rather than dropping the work', () => {
    // Overstating how ready a piece of work is costs the reader a week of their
    // life; understating it costs them a second look.
    for (const bad of ['soon', '', 'NOW', undefined, 42]) {
      const out = validateStrategy({ work: [job({ horizon: bad })] }, 10, 10);
      expect(out.work[0]!.horizon, String(bad)).toBe('watch');
    }
  });

  it('keeps all three real horizons', () => {
    for (const h of ['now', 'months', 'watch'] as const) {
      expect(validateStrategy({ work: [job({ horizon: h })] }, 10, 10).work[0]!.horizon)
        .toBe(h);
    }
  });

  it('asks the model for one person, not for a vendor', () => {
    expect(strategyPrompt).toMatch(/One person, working remotely/);
    expect(strategyPrompt).toMatch(/A FORCED MIGRATION WITH A DEADLINE/);
    // The failure this section exists to prevent, named in the prompt so the
    // model cannot fall back into it.
    expect(strategyPrompt).toMatch(/useless to them/);
  });

  it('refuses "learn AI" as an answer', () => {
    expect(strategyPrompt).toMatch(/is not work/);
  });

  it('puts the work above the vendor strategy on the page', () => {
    const workAt = page.indexOf('Where the work is');
    const dirAt = page.indexOf('Where this is going');
    expect(workAt).toBeGreaterThan(0);
    expect(dirAt).toBeGreaterThan(0);
    expect(workAt).toBeLessThan(dirAt);
  });
});

describe('every directional claim says how to disprove itself', () => {
  it('carries the falsifier through validation', () => {
    const out = validateStrategy(
      { direction: [claim({ falsifier: 'no price appears within a month' })] }, 10, 10);
    expect(out.direction[0]!.falsifier).toBe('no price appears within a month');
  });

  it('does not drop a claim that failed to supply one', () => {
    // A missing falsifier should be visible rather than fatal: dropping the
    // claim hides the weakness instead of showing it.
    expect(validateStrategy({ direction: [claim()] }, 10, 10).direction).toHaveLength(1);
  });

  it('renders it under the claim it belongs to', () => {
    expect(page).toContain('What would show this wrong');
  });

  it('tells the model that a hedge is not a falsifier', () => {
    expect(strategyPrompt).toMatch(/"More evidence is needed" is not a falsifier/);
  });
});

describe('tensions', () => {
  const t = { what: 'GA without a price', sides: 'Both are accurate.', evidence: [1] };

  it('keeps a cited disagreement', () => {
    expect(validateStrategy({ tensions: [t] }, 10, 10).tensions).toHaveLength(1);
  });

  it('drops an uncited one', () => {
    expect(validateStrategy({ tensions: [{ ...t, evidence: [] }] }, 10, 10).tensions)
      .toHaveLength(0);
  });

  it('tells the model to leave it empty rather than invent one', () => {
    expect(strategyPrompt).toMatch(/rather than manufacturing a disagreement/);
  });
});

describe('the page is styled, not merely structured', () => {
  it('defines every class the briefing page uses', () => {
    // THE BUG THIS CATCHES, WHICH SHIPPED AND WAS REPORTED AS "messy".
    // mv-find and mv-cites were used four times and defined nowhere.
    const used = new Set(
      [...page.matchAll(/class="([a-z0-9 _-]+)"/g)]
        .flatMap((m) => m[1]!.split(/\s+/))
        .filter(Boolean));
    expect(used.size).toBeGreaterThan(5);
    const missing = [...used].filter((c) => !theme.includes(`.${c}`));
    expect(missing, `classes used with no CSS: ${missing.join(', ')}`).toEqual([]);
  });

  it('styles the section the reader is here for differently from the rest', () => {
    expect(theme).toMatch(/\.mv-op\{/);
    expect(page).toContain('class="mv-op"');
  });
});

describe('what the recent readings have established', () => {
  it('excludes the day being read', () => {
    // Today is directly above this section; repeating it here would make the
    // standing list look like corroboration of itself.
    expect(analysis).toMatch(/AND day < \$2::date/);
  });

  it('does not paraphrase the claims through a second model call', () => {
    // Every claim was validated and cited on the day it was made. Re-summarising
    // would put an uncitable layer between the reader and the evidence, and
    // would cost a model call on every page view.
    expect(analysis).toMatch(/DELIBERATELY NOT A MODEL CALL/);
  });

  it('carries the falsifier forward, which is the point of keeping them', () => {
    expect(analysis).toMatch(/falsifier\?: string;/);
    expect(page).toContain('Would be shown wrong by');
  });

  it('says so plainly when there is only one reading so far', () => {
    expect(page).toMatch(/This is the first reading written for/);
  });
});

describe('the caveats are gathered, not sprinkled', () => {
  it('renders them in one block', () => {
    // They used to be a note under the reading, another under the history line,
    // a third under the provider and a bulleted list of their own. Scattered
    // hedging reads as evasion and gets skipped.
    expect(page).toContain('mv-caveat');
  });

  it('shows one lede rather than the summary and the reading both', () => {
    expect(page).toMatch(/ONE LEDE, NOT TWO/);
    expect(page).toMatch(/b\.strategy\?\.read/);
  });
});

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
import { nearlySame } from '../src/ui/briefing.ts';

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

  it('renders it on the page where a reader stops to weigh the claim', () => {
    // Moved to the per-finding page on 2026-09-09. A falsifier is the last
    // thing a sceptic reads, and the index is not where anybody is sceptical
    // yet -- it is where they are choosing what to be sceptical about.
    expect(page).toMatch(/What would show this\s+wrong/);
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

  it('defines every class the period pages use', () => {
    // THE SAME CHECK, ON THE OTHER RENDERER. It covered briefing.ts only, so
    // when the period reading landed on 2026-09-10 using pr-card, pr-claim,
    // pr-ends and pr-end -- none of which had a rule -- nothing failed. The
    // page rendered as unstyled text, which is the exact symptom this test was
    // written for the first time.
    const periods = readFileSync(
      new URL('../src/ui/period.ts', import.meta.url), 'utf8');
    const used = new Set(
      [...periods.matchAll(/class="([a-z0-9 _-]+)"/g)]
        .flatMap((m) => m[1]!.split(/\s+/))
        .filter(Boolean));
    expect(used.size).toBeGreaterThan(5);
    const missing = [...used].filter((c) => !theme.includes(`.${c}`));
    expect(missing, `classes used with no CSS: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not reuse a class name across two different layouts', () => {
    // `.mv-then-now` is the field report's shift block: a two-column grid of
    // before against after. The period reading reached for the same name for a
    // card holding a claim, a paragraph and its evidence, and silently
    // inherited `grid-template-columns:1fr 1fr` over all three.
    //
    // A collision like this cannot be caught by checking that a class has a
    // rule, because it has one -- somebody else's. So the period reading's
    // classes carry their own prefix, and this asserts the two sets stay apart.
    const periods = readFileSync(
      new URL('../src/ui/period.ts', import.meta.url), 'utf8');
    expect(periods).not.toMatch(/class="[^"]*\bmv-then-now\b/);
    expect(periods).toMatch(/class="pr-card"/);
  });

  it('styles the findings as cards a reader can scan and click', () => {
    // Replaced .mv-op on 2026-09-09, when the report became an index: the
    // whole card is the link, so the target is the size of the thought.
    expect(theme).toMatch(/\.mv-item\{/);
    expect(page).toContain('class="mv-item"');
    expect(page).toMatch(/mv-items/);
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
    // The rule, not the sentence. Shortened on 2026-09-10 from four sentences
    // to one while trimming the page -- an absence still has to say what it is,
    // or a field whose readings have established nothing looks the same as a
    // field that has only ever been read once. Matching the wording verbatim
    // made a legitimate edit look like a regression.
    expect(page).toMatch(/first reading written for/i);
    expect(page).toMatch(/fills as they accumulate/i);
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

describe('the lede and the shift are not the same sentence twice', () => {
  // Both `read` and `shift.moved` ask the model for the one thing a reader
  // should take from the day, so it answers both with the same claim. Measured
  // on the AI report, 2026-09-10:
  //
  //   lede   "In March the question was whether AI coding models worked; today
  //           it is whether autonomous agents can be audited, sandboxed, and
  //           kept from writing their own exploits."
  //   shift  "In March the argument was whether these models could do the work;
  //           today it is whether autonomous agents can be audited, sandboxed,
  //           and prevented from executing unauthorized code."
  //
  // Two paragraphs saying one thing is what a padded page is made of.
  it('spots a reworded repeat', () => {
    expect(nearlySame(
      'In March the question was whether AI coding models worked; today it is '
      + 'whether autonomous agents can be audited, sandboxed, and kept from '
      + 'writing their own exploits.',
      'In March the argument was whether these models could do the work; today '
      + 'it is whether autonomous agents can be audited, sandboxed, and '
      + 'prevented from executing unauthorized code.')).toBe(true);
  });

  it('leaves two genuinely different claims alone', () => {
    // The expensive mistake in the other direction: suppressing this would
    // delete a finding, not a repetition.
    expect(nearlySame(
      'Enterprise concerns have pivoted from raw model capability to '
      + 'compliance, auditability, and catastrophic loss of control.',
      'Vulnerability surfaces have moved from application-layer web flaws to '
      + 'agent-driven code injection and sandbox escapes.')).toBe(false);
  });

  it('is not fooled by shared grammar alone', () => {
    // Short words are dropped, so two sentences that share only "the", "from"
    // and "have" are not duplicates.
    expect(nearlySame(
      'The registry changed how it counts downloads this week.',
      'The vendors changed how they price support this year.')).toBe(false);
  });

  it('says no rather than yes when a sentence is empty', () => {
    expect(nearlySame('', 'anything at all here')).toBe(false);
    expect(nearlySame('a b c', '')).toBe(false);
  });

  it('drops only the sentence, never the section', () => {
    // The then-and-now evidence is reachable only through this card, so the
    // heading and its link must survive the deduplication.
    expect(page).toMatch(/echo \? '' :/);
    expect(page).toMatch(/Then and now, with the stories at both ends/);
  });
});

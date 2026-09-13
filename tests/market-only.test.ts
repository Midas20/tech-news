import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { aboutTheMarket, isAboutTheSources } from '../src/analysis/marketonly.ts';
import { validateStrategy } from '../src/analysis/strategy.ts';

// "Thirty developer-community sources were added to this registry today, so
// today's corpus is drawn from a wider set of publishers than the earlier one
// ... These are unnecessary content in report, You have to say about new market
// and market change in report, not source of report." -- 2026-09-13.

describe('a sentence about the sources', () => {
  it.each([
    'Thirty developer-community sources were added to this registry today, so today’s corpus is drawn from a wider set of publishers than the earlier one.',
    'Every citation in the shift above is from a source this archive already held in March, on purpose.',
    'Every one of today\'s eleven stories is first-party: vendors, projects and package registries describing their own releases.',
    'Not one independent source is present, so this establishes what these companies decided to build.',
    'The 382 stories from 49 publishers describe the industry turning agents into infrastructure.',
    'The claim about AWS is drawn from a capped, diversified sample rather than its full release stream.',
    'The archive relies heavily on first-party vendor releases from AWS, Vercel, and Google.',
    'The evidence is heavily weighted toward first-party vendor announcements.',
  ])('is recognised: %s', (s) => {
    expect(isAboutTheSources(s)).toBe(true);
  });
});

describe('a sentence about the market', () => {
  it.each([
    'AWS Agent Registry is now generally available.',
    'Vercel shipped a container registry and Dockerfile support in its functions.',
    'Grant Thornton\'s survey cited by Databricks found only 18% can pass an independent audit of AI controls.',
    'Grafana 13.2 failed to start after upgrade, with Prometheus missing from the data-source list.',
    'Atlassian\'s withdrawal from Data Center creates a forced migration, answered with a webinar and customer stories.',
    'Build an open-source MCP server connector for specialised analytical databases.',
    'Configure a private package registry proxy so CI stops failing on public rate limits.',
    'That the edge is the default runtime for the front end, plus its own bundler and first-party analytics.',
    'AI crawler traffic became a cost and a content-protection problem for publishers and commerce sites.',
  ])('is kept: %s', (s) => {
    expect(isAboutTheSources(s)).toBe(false);
    expect(aboutTheMarket(s)).toBe(s);
  });
});

describe('aboutTheMarket', () => {
  it('keeps the market sentence and drops the one about the evidence', () => {
    const text = 'AWS made Bedrock pricing per token. Six of today\'s seven stories are first-party. '
      + 'Teams on provisioned throughput must re-plan by March.';
    expect(aboutTheMarket(text)).toBe(
      'AWS made Bedrock pricing per token. Teams on provisioned throughput must re-plan by March.');
  });

  it('removes a passing mention of the archive and keeps the sentence', () => {
    expect(aboutTheMarket(
      'In April and May the agent announcements in this archive were claims about intelligence.'))
      .toBe('In April and May the agent announcements were claims about intelligence.');
  });

  it.each([
    ['The first-party announcement states that the model provides deeper reasoning.',
      'The model provides deeper reasoning.'],
    ['According to the first-party announcement, the agent turns company data into dashboards.',
      'The agent turns company data into dashboards.'],
    ['The independent source reports the service bridges domain expertise and machine learning.',
      'The service bridges domain expertise and machine learning.'],
    ['DeepSeek plans to release V4.1 Flash around September 10, according to a first-party announcement on Hacker News.',
      'DeepSeek plans to release V4.1 Flash around September 10.'],
    ['InfoQ — the only independent source in today\'s set — reports that licensing was unpublished at GA.',
      'InfoQ reports that licensing was unpublished at GA.'],
    ['Earlier discussions on Hacker News and in our archive focused on perimeter access.',
      'Earlier discussions on Hacker News focused on perimeter access.'],
    ['A product reaches general availability while the one independent source reports it cannot be priced',
      'A product reaches general availability while reports say it cannot be priced'],
    ['The earlier story is Polars 2.0, reported as a 5x speed boost — an absolute claim about one library, and one of the few pieces of independent coverage in this field.',
      'The earlier story is Polars 2.0, reported as a 5x speed boost — an absolute claim about one library.'],
    ['The vendor response in today\'s archive is JetBrains running migration webinars.',
      'The vendor response is JetBrains running migration webinars.'],
    ['On 2026-09-09, independent publisher LWN.net reported that Debian issued security updates.',
      'On 2026-09-09, LWN.net reported that Debian issued security updates.'],
    ['Earlier archive coverage focused heavily on the race for intelligence-per-parameter.',
      'Earlier the market focused heavily on the race for intelligence-per-parameter.'],
  ])('keeps the claim and removes the attribution: %s', (input, expected) => {
    expect(aboutTheMarket(input)).toBe(expected);
  });

  it('drops a sentence that is nothing but attribution', () => {
    expect(aboutTheMarket('Amazon MQ added RabbitMQ 4.3. This is a first-party announcement from AWS.'))
      .toBe('Amazon MQ added RabbitMQ 4.3.');
  });

  it('keeps paragraph breaks, because briefing bodies are split on them', () => {
    expect(aboutTheMarket('Vercel raised a Series F.\n\nThe corpus is narrow.\n\nMistral cut prices.'))
      .toBe('Vercel raised a Series F.\n\nMistral cut prices.');
  });

  it('is idempotent, so the stored-report cleanup can run twice', () => {
    const once = aboutTheMarket('Earlier in this archive AWS shipped DocumentDB upgrades. This reading is wrong if not.');
    expect(aboutTheMarket(once)).toBe(once);
  });
});

describe('what a model writes is filtered before it is stored', () => {
  it('drops the source commentary and never keeps `limits`', () => {
    const kept = validateStrategy({
      read: 'Bedrock became a shop window for other labs. Every substantive source is first-party.',
      direction: [], positioning: [], tensions: [], openings: [],
      work: [{ what: 'Migrate Bedrock workloads to per-token pricing',
        why: 'The corpus is drawn from a wider set of publishers than the earlier one.',
        skills: 'AWS', horizon: 'now', evidence: [1] }],
      limits: 'Thirty developer-community sources were added to this registry today.',
    }, 3, 3);
    expect(kept.read).toBe('Bedrock became a shop window for other labs.');
    expect(kept.limits).toBe('');
    // A work item whose only reason was about the evidence has no reason left.
    expect(kept.work).toHaveLength(0);
  });

  it('no longer asks the model for `limits`', () => {
    const jobs = readFileSync(new URL('../src/llm/jobs.ts', import.meta.url), 'utf8');
    expect(jobs).not.toMatch(/'"limits":"\.\.\."}'/);
    expect(jobs).toMatch(/WRITE ABOUT THE MARKET, NEVER ABOUT YOUR EVIDENCE/);
    expect(jobs).toMatch(/WRITE ABOUT THE MARKET, NEVER ABOUT THE STORIES/);
  });
});

describe('the report pages say nothing about their sources', () => {
  const period = readFileSync(new URL('../src/ui/period.ts', import.meta.url), 'utf8');
  const briefing = readFileSync(new URL('../src/ui/briefing.ts', import.meta.url), 'utf8');

  it.each([
    ['publishers, not of the', period],
    ['What this cannot settle', period],
    ['diversified first, so no publisher', period],
    ['What this cannot tell you</h2>', briefing],
    ['What these stories could not tell us', briefing],
    ['that this archive caught and could read', briefing],
    ['independent of ${d.read} read', briefing],
  ])('does not print "%s"', (phrase, src) => {
    expect(src).not.toContain(phrase);
  });
});

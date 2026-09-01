// The event classifier, against the titles that produced it.
//
// Every case is a real headline this system collected in August 2026. The last
// block is the false positives and false negatives the first dry run produced,
// which is the part worth keeping: each one is a rule that looked obviously
// right until the corpus disagreed.

import { describe, it, expect } from 'vitest';
import { classifyEvent, isEvent, __test as eventTest } from '../src/collect/eventful.ts';
import { isPrereleaseTitle } from '../src/collect/pipeline.ts';

const kind = (t: string, o = {}) => classifyEvent(t, o).kind;
const kept = (t: string, o = {}) => isEvent(classifyEvent(t, o).kind);

describe('events', () => {
  it('launches', () => {
    expect(kind('Introducing Agent Plugins 1.0.0')).toBe('launch');
    expect(kind('Introducing the new v0 API')).toBe('launch');
    expect(kind('Amazon EC2 M8i and M8i-flex instances are now available in Canada West'))
      .toBe('launch');
    expect(kind('Cursor Releases Origin as an Agent-Native Alternative to GitHub')).toBe('release');
  });

  it('releases', () => {
    expect(kind('Rust 1.90 released')).toBe('release');
    expect(kind('OpenTelemetry Comes to IntelliJ IDEA, GoLand, PyCharm, and WebStorm'))
      .toBe('release');
    expect(kind('Next.js 16.3 support on Vercel')).toBe('release');
    expect(kind('Audit Log Drains now support Datadog, Splunk, and Panther')).toBe('release');
    expect(kind('Vercel Container Registry repositories can now be made public')).toBe('release');
    // A release feed publishes releases. That is the contract of the format.
    expect(kind('b10635', { sourceKind: 'releases' })).toBe('release');
  });

  it('changes', () => {
    expect(kind('Python 3.9 has reached end of life')).toBe('change');
    expect(kind('Diagrid Catalyst 2.0 Adds Durable and Verifiable Execution for AI Agents'))
      .toBe('change');
    expect(kind('OVHcloud Raises Prices as AI Memory Demand Reprices Non-AI Infrastructure'))
      .toBe('change');
    expect(kind('BMC Vulnerabilities Put Thousands of Servers at Risk')).toBe('change');
  });
});

describe('articles', () => {
  it('the declared kinds', () => {
    expect(kind('Article: Beyond Offset Lag: Computing Time in Queue for Apache Hudi'))
      .toBe('article');
    expect(kind('Presentation: Can Claude Fix Itself? Using LLMs for Incident Response'))
      .toBe('article');
    expect(kind('Quoting Paul Dix')).toBe('article');
  });

  it('the shapes', () => {
    expect(kind('How Factory scaled its cloud backend to one billion monthly requests'))
      .toBe('article');
    expect(kind('Why retailers must replace rigid planning with micro-season agility'))
      .toBe('article');
    expect(kind('Montech Titan PLA 750W power supply review')).toBe('article');
  });

  it('a digest is not a release, however many releases it lists', () => {
    // Six announcements in a trench coat. Filing it as a release attaches all
    // six to whichever one the pattern happened to match first.
    expect(kind('Java News Roundup: JDK 27-RC1, OpenJDK JEPs, Jakarta EE, BellSoft, Helidon'))
      .toBe('article');
  });

  it('a retrospective is not an announcement', () => {
    // Matches RELEASE on its strongest pattern. The tense is in the date.
    expect(kind('Windows XP was released to manufacturing a quarter of a century ago'))
      .toBe('article');
    expect(kind('One gigabyte of RAM cost as much as a house back in 1995')).toBe('article');
  });
});

describe('first-party posts', () => {
  const post = 'Share Vercel Container Registry repositories across teams';

  it('are events when nothing says otherwise', () => {
    // Read as an anonymous headline this is a how-to. Read as what it is -- a
    // post on the vendor's own blog about the vendor's own product -- it is a
    // feature that did not exist last week.
    expect(kind(post)).toBe('article');
    expect(kind(post, { firstParty: true })).toBe('change');
    expect(kind('Set your own project avatars', { firstParty: true })).toBe('change');
  });

  it('can still say otherwise', () => {
    const essay = 'How Factory scaled its cloud backend to one billion monthly requests';
    expect(kind(essay, { firstParty: true })).toBe('article');
    expect(kind('Article: our storage layer', { firstParty: true })).toBe('article');
  });
});

describe('a match that reports nothing must not read as no match', () => {
  // The bug this pins down: anchored patterns put their body in group 1 while
  // B() put it in group 2, firstMatch() read group 2 either way, and an
  // anchored hit therefore returned its trailing character -- which trims to ""
  // and is falsy. Every "Introducing X" in the corpus was filed as an article.
  it('anchored patterns still decide', () => {
    for (const t of ['Introducing Foo', 'Announcing Bar', 'Meet Baz']) {
      expect(kept(t)).toBe(true);
      expect(classifyEvent(t).matched).toBeTruthy();
    }
  });
});

describe('build artefacts are not releases', () => {
  it('catches what the word-based test never could', () => {
    for (const t of [
      'build-2.5.0-dev-5797',
      'b10635',
      'viable/strict/1787738484: Re-enable expandable segments',
      'YugabyteDB 2025.2.7.0-b28',
      '2.31.0.0-b389: [CLOUDGA-35506] Fix reservation cleanup',
    ]) expect(isPrereleaseTitle(t)).toBe(true);
  });

  it('leaves real versions alone', () => {
    for (const t of [
      'Rolldown v1.2.6', '@tanstack/solid-query@5.102.5', 'PostgreSQL 18.1',
      'Kotlin 2.4.20', 'Node.js v24.19.0', 'nginx 1.29.3', 'Django 5.2.4 released',
    ]) expect(isPrereleaseTitle(t)).toBe(false);
  });

  it('still catches the ones it always did', () => {
    expect(isPrereleaseTitle('Storybook v10.6.0-alpha.9')).toBe(true);
    expect(isPrereleaseTitle('Prisma v8.0.0-rc.8')).toBe(true);
  });
});

describe('a release feed that publishes an ending', () => {
  it('files a price, a licence or a retirement as a change, not a release', () => {
    // These arrive on feeds whose every other entry is a version number, and
    // not one of them is a release. Filing them as releases hid them behind the
    // rule News applies to releases -- shown only for technologies you track --
    // which is backwards: a price change matters most for the things you have
    // not been watching.
    for (const title of [
      'Billing is now enabled for R2 SQL',
      'Retirement: Support for Node 22 LTS ends on April 30, 2027',
      'HashiCorp adopts the Business Source License',
      'Azure Databricks Runtime 10.4 LTS will reach end of life',
    ]) {
      const v = classifyEvent(title, { sourceKind: 'releases' });
      expect(v.kind, title).toBe('change');
      expect(v.matched, title).toContain('money');
    }
  });

  it('still takes the feed at its word for an ordinary version', () => {
    // A version string carries no money vocabulary, so the exemption above
    // cannot misfile one -- which is the whole reason it is safe to check the
    // title of a source whose contract already answers the question.
    expect(classifyEvent('Ansible v2.19.1', { sourceKind: 'releases' }).kind).toBe('release');
    expect(classifyEvent('pkg/machinery/v1.13.9', { sourceKind: 'releases' }).kind).toBe('release');
    expect(classifyEvent('PostgreSQL 18.1 released', { sourceKind: 'releases' }).kind)
      .toBe('release');
  });
});

describe('a changelog is a release feed that publishes prose', () => {
  it('reads a vendor changelog entry as what it is, not as a version', () => {
    // AWS, Azure, Cloudflare and GitHub publish feeds whose kind is `releases`
    // and whose entries are sentences. Taking the feed's word for all of them
    // filed 155 of 169 stories as releases, which the tracked-releases rule
    // then hid: News showed 11.
    for (const title of [
      'Amazon Cognito adds admin API operation to reset user TOTP',
      'Mountpoint for Amazon S3 adds memory usage controls',
      'AWS Glue 5.1 is now available in AWS European Sovereign Cloud',
      'Global model policy generally available',
    ]) {
      const v = classifyEvent(title, { sourceKind: 'releases', firstParty: true });
      expect(v.kind, title).not.toBe('release');
      expect(v.kind, title).not.toBe('article');
    }
  });

  it('still takes the feed at its word for a title that IS a version', () => {
    for (const title of ['v1.14.0', 'pkg/machinery/v1.13.9', 'Rspack v2.2.1',
      'Anthropic Claude v2.1.239', 'b10647']) {
      expect(classifyEvent(title, { sourceKind: 'releases' }).kind, title).toBe('release');
    }
  });

  it('knows a version in a sentence from a version as a title', () => {
    const { looksLikeVersion } = eventTest;
    expect(looksLikeVersion('Rspack v2.2.1')).toBe(true);
    expect(looksLikeVersion('pkg/machinery/v1.13.9')).toBe(true);
    expect(looksLikeVersion('AWS Glue 5.1 is now available in AWS European Sovereign Cloud'))
      .toBe(false);
    expect(looksLikeVersion('Amazon Cognito adds admin API operation')).toBe(false);
  });
});

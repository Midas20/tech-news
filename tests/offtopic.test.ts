// Which hosts this archive refuses a link to.
//
// The dangerous failure here is not letting one through -- it is refusing a
// host that only LOOKS like one on the list. `ft.com` is a substring of
// `microsoft.com` and `x.com` is a substring of `phoronix.com`, and an audit
// query written with ILIKE claimed both of those as matches before this was
// pinned down.

import { describe, it, expect } from 'vitest';
import {
  isOffTopicHost, hostMatches, OFF_TOPIC_HOSTS, SOCIAL_HOSTS, ALWAYS_KEEP_HOSTS,
} from '../src/vocab/offtopic.ts';

describe('matching a host', () => {
  it('is exact, or a subdomain', () => {
    expect(isOffTopicHost('nytimes.com')).toBe(true);
    expect(isOffTopicHost('www.nytimes.com')).toBe(true);
    expect(isOffTopicHost('cooking.nytimes.com')).toBe(true);
  });

  it('is never a substring', () => {
    // The two that a sloppy audit query actually got wrong.
    expect(isOffTopicHost('microsoft.com')).toBe(false);   // contains "ft.com"
    expect(isOffTopicHost('phoronix.com')).toBe(false);    // contains "x.com"
    expect(isOffTopicHost('azure.microsoft.com')).toBe(false);
    expect(isOffTopicHost('notreuters.com')).toBe(false);
  });

  it('has nothing to say about an empty host', () => {
    expect(isOffTopicHost('')).toBe(false);
    expect(hostMatches('', ['nytimes.com'])).toBe(false);
  });
});

describe('what is refused', () => {
  it('general news, consumer tech, and microblogs', () => {
    for (const h of ['reuters.com', 'theguardian.com', 'apnews.com']) {
      expect(isOffTopicHost(h)).toBe(true);
    }
    for (const h of ['techcrunch.com', 'tomshardware.com', 'zdnet.com', 'engadget.com']) {
      expect(isOffTopicHost(h)).toBe(true);
    }
    expect(isOffTopicHost('twitter.com')).toBe(true);
    expect(isOffTopicHost('x.com')).toBe(true);
  });
});

describe('what is NOT refused, and why it must not be', () => {
  it('the sources this archive is made of', () => {
    // Every one of these is an active source. Refusing its links would empty it.
    for (const h of [
      'news.ycombinator.com', 'lobste.rs', 'reddit.com',
      'github.com', 'thenewstack.io', 'phoronix.com', 'theregister.com',
      'infoq.com', 'lwn.net', 'vercel.com', 'kubernetes.io',
    ]) expect(isOffTopicHost(h)).toBe(false);
  });

  it('the places developers actually write', () => {
    // In SOCIAL_HOSTS -- correctly, for deciding what to POLL -- and deliberately
    // not refused as a link destination.
    for (const h of ['dev.to', 'medium.com', 'zenn.dev', 'qiita.com', 'substack.com']) {
      expect(SOCIAL_HOSTS.includes(h) || h === 'substack.com').toBe(true);
      expect(isOffTopicHost(h)).toBe(false);
    }
  });

  it('a specific keep beats a general refusal', () => {
    for (const h of ALWAYS_KEEP_HOSTS) expect(isOffTopicHost(h)).toBe(false);
  });
});

describe('the list itself', () => {
  it('carries no duplicates', () => {
    expect(new Set(OFF_TOPIC_HOSTS).size).toBe(OFF_TOPIC_HOSTS.length);
  });

  it('is all bare hostnames', () => {
    for (const h of OFF_TOPIC_HOSTS) {
      expect(h).toBe(h.toLowerCase());
      expect(h).not.toMatch(/^www\.|\/|:|^\.|\.$/);
      expect(h).toMatch(/\./);
    }
  });
});

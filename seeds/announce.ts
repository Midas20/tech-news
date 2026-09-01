// A company talking about its own work.
//
// The company registry has carried an `announce` list since it was written --
// newsrooms, engineering blogs, security bulletins, the channels a company
// publishes on itself -- with a comment explaining that an announcement is "a
// different kind of evidence from an outlet writing about it, and the UI keeps
// them apart". `sources.company_slug` exists to hold the link.
//
// None of it was ever wired up. Thirty-nine channels sat in the seed, zero rows
// carried a company_slug, and the archive collected exactly none of it. The
// registry described a feature; the collector had never been told about it.
//
// WHY THIS IS NOT THE THING THE SOURCE POLICY REFUSES. The rule this archive is
// judged by is that a source must report that a TECHNOLOGY changed, not that
// something happened to somebody who uses one -- which is why the consumer
// trade is refused at ingest. A company's own engineering blog is the opposite
// end of that: when Cloudflare writes about its own proxy or Anthropic about
// its own model, the company IS the primary source for the change, and the
// press piece that follows is the secondary one. These are announcements, not
// coverage, and they are weighted as such.
//
// Status pages are excluded. An incident is not a change to a technology, it is
// a bad afternoon, and it would fill the archive with resolved outages.
//
// URLs are page addresses, not feeds. Autodiscovery resolves the real feed on
// the first poll and stores what it found -- see discoverFeedLinks() in
// src/collect/fetcher.ts. A channel that advertises no feed simply never
// succeeds, which is visible on /sources rather than silent.

import { COMPANY_SEEDS } from './companies.ts';
import type { SourceSeed } from './sources.ts';

const H = 3600;

/**
 * The official channels, as sources.
 *
 * Trust is high but not top: a company is authoritative about its own product
 * and is also selling it, so an announcement is the best evidence that
 * something shipped and the worst evidence that it is any good. CONTENT and
 * PRIMARY, never COVERAGE -- a company corroborating itself is one outlet
 * twice, which is the mistake coverage counting already had to be fixed for.
 */
export const ANNOUNCE_SOURCES: SourceSeed[] = COMPANY_SEEDS.flatMap((c) =>
  (c.announce ?? [])
    .filter((a) => (a.kind ?? 'news') === 'news')
    // A channel with no feed is not a source. Four of them publish only a
    // script-rendered page -- Anthropic, Meta AI, Uber, Shopify -- and seeding
    // them produces a row that fails on every poll forever. They stay in the
    // company registry with the reason and the date they were checked.
    .filter((a) => !a.noFeed)
    .map((a): SourceSeed => ({
      name: a.name,
      url: a.url,
      // Present only where the page advertises nothing. Everywhere else the
      // collector discovers the feed and stores what it found, which is the
      // arrangement that survives a feed moving.
      feedHint: a.feed,
      roles: ['CONTENT', 'PRIMARY'],
      lang: 'en',
      country: c.country,
      trust: 0.8,
      weightContent: 0.9,
      pollSeconds: 4 * H,
      companySlug: c.slug,
      notes: `${c.name}'s own channel — an announcement, not coverage.`,
    })));

/** Checked, and there is no feed. Kept so nobody checks them again. */
export const ANNOUNCE_WITHOUT_FEEDS = COMPANY_SEEDS.flatMap((c) =>
  (c.announce ?? []).filter((a) => a.noFeed)
    .map((a) => ({ company: c.name, name: a.name, url: a.url, why: a.noFeed! })));

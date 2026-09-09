// Ingest gates (spec 2.3). Every drop is counted and reported, never silent --
// during the Phase 1 observation week the drop histogram is the main diagnostic,
// and a filter that quietly eats 40% of a source looks identical to a dead feed
// unless the reasons are recorded.

import type { FeedItem } from './feed.ts';
import { checkLength } from '../lib/text.ts';
import { detectLanguage, type DetectedLang } from '../lib/lang.ts';
import { getConfig, isBlockedHost } from '../config.ts';
import { domainOf } from '../lib/url.ts';

export type DropReason =
  | 'no_link'
  | 'no_title'
  | 'media_enclosure'
  | 'podcast_feed'
  | 'too_short'
  /**
   * Refused on an earlier poll and still inside its wait.
   *
   * Its own reason rather than a repeat of the original one: a drop chart that
   * cannot tell "we looked and said no" from "we said no last month" hides the
   * growth that refused_items exists to stop.
   */
  | 'refused_before'
  | 'lang_gate'
  | 'blocked_host'
  | 'duplicate_url'
  | 'duplicate_content'
  // Published inside a month that has already been reduced to monthly analysis.
  // Storing it would put a story into a month whose totals are settled, where
  // nothing counts it and the next retention run deletes it again.
  | 'already_archived'
  // Published before the retention window opens. Not the same as
  // already_archived, which is about a month whose ANALYSIS is settled: this is
  // about a month that will never be shown and can never be pruned.
  | 'too_old'
  // Not a technology story. Shopping listicles, television, sport, politics,
  // crime reporting, funding rounds and vendor surveys -- see topical.ts, and
  // story_rejects for what was actually refused and on what evidence.
  | 'off_topic'
  // About technology, but an article about it rather than something that
  // happened to it. See eventful.ts.
  | 'not_an_event'
  // A build artefact rather than a release: a rolling tag that was re-pointed,
  // a release candidate, a nightly with an incrementing suffix and no notes.
  // A repository's releases.atom is a build log, not an editorial channel.
  // See vocab/buildnoise.ts.
  | 'build_noise';

export interface GateResult {
  keep: boolean;
  reason?: DropReason;
  lang?: DetectedLang;
  langConfidence?: number;
  length?: number;
}

/** DROP_ENCLOSURE_TYPES entries are glob-ish ("audio/*"); match on the prefix. */
export function hasMediaEnclosure(item: FeedItem): boolean {
  const patterns = getConfig().filters.dropEnclosureTypes;
  return item.enclosureTypes.some((t) =>
    patterns.some((p) => {
      const prefix = p.replace(/\*$/, '');
      return p.endsWith('*') ? t.toLowerCase().startsWith(prefix.toLowerCase()) : t.toLowerCase() === p.toLowerCase();
    }),
  );
}

/**
 * A feed where most items carry media enclosures is a podcast or a video channel.
 * Dropping items one at a time would still leave the source polled forever, so
 * the whole feed is flagged and the caller pauses it.
 */
export function isPodcastFeed(items: FeedItem[]): boolean {
  if (items.length < 3) return false;
  const withMedia = items.filter(hasMediaEnclosure).length;
  return withMedia / items.length > getConfig().filters.enclosureRatioThreshold;
}

export interface GateOptions {
  /**
   * Relax the length gate. The gate exists to reject article stubs, and a
   * release note is not an article: "Fixes a panic in the SOCKS5 handshake" is
   * the whole event. Judging it by an article's yardstick throws away the
   * primary-source signal the importance scorer most wants.
   */
  minLengthOverride?: number;
}

export function gateItem(item: FeedItem, bodyText: string, gateOpts: GateOptions = {}): GateResult {
  if (!item.link) return { keep: false, reason: 'no_link' };
  if (!item.title.trim()) return { keep: false, reason: 'no_title' };
  if (hasMediaEnclosure(item)) return { keep: false, reason: 'media_enclosure' };

  // Video and audio platforms carry no text worth archiving, whatever links there.
  const host = domainOf(item.link);
  if (host && isBlockedHost(getConfig(), host)) return { keep: false, reason: 'blocked_host' };

  // The title is included in the language sample deliberately: many feeds carry
  // a one-line summary, and a title alone is often the only text with signal.
  const sample = `${item.title} ${bodyText}`.slice(0, 4000);
  const detected = detectLanguage(sample);
  // ALLOWED_LANGUAGES is the gate; 'other' is never in it.
  if (!getConfig().filters.allowedLanguages.includes(detected.lang)) {
    return { keep: false, reason: 'lang_gate', langConfidence: detected.confidence };
  }

  const length = checkLength(bodyText);
  const passes = gateOpts.minLengthOverride !== undefined
    ? length.length >= gateOpts.minLengthOverride
    : length.passes;
  if (!passes) {
    return {
      keep: false,
      reason: 'too_short',
      lang: detected.lang as DetectedLang,
      langConfidence: detected.confidence,
      length: length.length,
    };
  }

  return {
    keep: true,
    lang: detected.lang as DetectedLang,
    langConfidence: detected.confidence,
    length: length.length,
  };
}

export class DropCounter {
  private counts = new Map<DropReason, number>();

  record(reason: DropReason): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  get total(): number {
    let n = 0;
    for (const v of this.counts.values()) n += v;
    return n;
  }
}

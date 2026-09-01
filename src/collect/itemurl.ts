// One address per story, because the address IS the story's identity.
//
// Everything downstream keys on the canonical URL: deduplication, coverage,
// membership, the story record itself. That only works if a feed gives each
// item a distinct link, and four of them in this registry do not:
//
//   kernel.org      <link>https://www.kernel.org/</link>            on every item
//                   <guid>kernel.org,mainline,7.2,2026-08-16</guid> distinct
//
//   Auth0           <link>https://auth0.com/changelog/rss.xml</link>  the FEED itself
//                   <guid>https://auth0.com/changelog#2oiLhtKT…</guid> a real per-item URL
//
//   Discord, Azure  the changelog landing page, once per item
//
// Nine kernel releases collapsed onto one address, ten Discord changes onto
// another, and twenty-five Azure announcements onto a third. Fifty rows sharing
// four URLs, which is fifty stories that cannot be told apart by the thing this
// archive uses to tell stories apart.
//
// THE GUID IS THE ANSWER AND IT ALWAYS WAS. A guid is the publisher's own
// identifier for the item -- that is its entire purpose in the format -- and
// every one of these feeds populates it correctly while leaving the link
// generic. Auth0's guid is literally the per-item URL its link should have
// been.
//
// The OpenAI adapter already reached the same conclusion from the other
// direction and synthesises `?entry=<date>:<product>:<slug>` per item. This
// does for ordinary feeds what that adapter does for one.

import { canonicalizeUrl } from '../lib/url.ts';

export interface UrlSource {
  link: string | null;
  guid: string | null;
}

/**
 * Is this link the feed's own address?
 *
 * Auth0 puts the feed URL in every item's link. A link that points at the feed
 * is not a link to the item, so the guid is all there is.
 */
function isFeedItself(link: string, feedUrl: string): boolean {
  if (!feedUrl) return false;
  const strip = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  return strip(link) === strip(feedUrl);
}

/**
 * A guid that is itself a usable web address.
 *
 * The fragment is KEPT, against the usual rule. canonicalizeUrl strips it, and
 * that is right everywhere else -- a fragment is a position on a page, not a
 * different page -- but in these feeds the fragment is the whole of what
 * distinguishes one item from the next. Auth0's six entries differ only after
 * the hash. Canonicalising it away turns six changelog entries back into one.
 */
function guidAsUrl(guid: string): string | null {
  const raw = guid.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  const hash = raw.indexOf('#');
  const base = hash >= 0 ? raw.slice(0, hash) : raw;
  const fragment = hash >= 0 ? raw.slice(hash) : '';
  const clean = canonicalizeUrl(base)?.url;
  return clean ? `${clean}${fragment}` : null;
}

/**
 * A distinct address for every item in one poll.
 *
 * Returns one entry per input, in order, `null` where there is nothing usable.
 *
 * The link is preferred and almost always kept: a well-formed feed needs none
 * of this, and rewriting URLs that are already correct would change the
 * identity of everything already collected. The guid is reached for in exactly
 * two cases, both of which mean the link cannot identify the item:
 *
 *   1. the link is the feed's own address
 *   2. two items in this batch share a link
 *
 * Where the guid is a URL it is used as-is -- Auth0's is the per-item anchor.
 * Where it is an opaque token it becomes a fragment on the link, which keeps
 * the address pointing somewhere real while making it unique. Both are stable
 * across polls, because a guid that changed between polls would break the
 * publisher's own readers too.
 */
export interface ResolvedUrl {
  url: string | null;
  /**
   * This item's link was a listing, not a page of its own.
   *
   * Known because the link had to be disambiguated: every item in the feed
   * pointed at the same address, or at the feed itself. That is the same fact
   * FeedItem.complete carries, and the comment there says only the producer
   * knows it -- which was true until the addresses were being resolved in one
   * place and the collision became visible.
   *
   * It matters because of what happens next. Fetching a listing gives every
   * item on it the same body and the same rel=canonical, so ten distinct
   * changelog entries with ten distinct addresses still deduplicate into one
   * story on the content hash. Measured on Discord: 3 refused on the URL, 10
   * more on the body.
   */
  fromListing: boolean;
}

export function resolveItemUrls(
  items: UrlSource[], feedUrl = '',
): ResolvedUrl[] {
  const links = items.map((i) => canonicalizeUrl(i.link ?? '')?.url ?? null);

  // The same link with its fragment kept.
  //
  // Discord's changelog links are distinct -- change-log#august-27-2026,
  // change-log#august-26-2026 -- and canonicalisation strips the fragment,
  // which is correct everywhere else and collapses all fifteen of them here.
  // A fragment is usually a position on a page; in a changelog it is the entry.
  const withFragment = items.map((i, n) => {
    const raw = (i.link ?? '').trim();
    const hash = raw.indexOf('#');
    return hash > 0 && links[n] ? `${links[n]}${raw.slice(hash)}` : links[n] ?? null;
  });

  // Which links are shared. Counted across the batch rather than assumed per
  // source, so a feed that is well formed today and breaks tomorrow is handled
  // on the day it breaks and not before.
  const count = (xs: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const seen = count(links);
  const seenWithFragment = count(withFragment);

  return items.map((item, i): ResolvedUrl => {
    const link = links[i]!;
    const guid = item.guid?.trim() ?? '';

    const ambiguous = !link
      || isFeedItself(link, feedUrl)
      || (seen.get(link) ?? 0) > 1;
    if (!ambiguous) return { url: link, fromListing: false };

    // The publisher's own fragment first, when it settles the matter. It is a
    // real address that opens the right entry, which nothing synthesised here
    // can claim.
    const framed = withFragment[i];
    if (framed && framed !== link && (seenWithFragment.get(framed) ?? 0) === 1) {
      return { url: framed, fromListing: true };
    }

    if (!guid) return { url: framed ?? link, fromListing: true };

    const asUrl = guidAsUrl(guid);
    if (asUrl) return { url: asUrl, fromListing: true };

    // An opaque guid. Hang it off the link as a fragment: the address still
    // resolves to a real page, and it is now this item's address and no other's.
    if (!link) return { url: null, fromListing: true };
    return { url: `${link}#${encodeURIComponent(guid)}`, fromListing: true };
  });
}

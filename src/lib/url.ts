// URL canonicalization. The canonical URL is a story's identity -- everything
// else about the row is re-derivable, so this function decides what counts as
// "the same page" for dedup layer 1.

const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'matomo_', 'hsa_', 'vero_', 'wt_'];

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'twclid', 'igshid', 'ttclid',
  'mc_cid', 'mc_eid', 'yclid', '_hsenc', '_hsmi', 'oly_anon_id', 'oly_enc_id',
  'source', 'campaign', 'medium', 'spm', 'scm', 'from', 'share_source',
  'ref', 'referrer', 'referral', 'aff', 'affiliate', 'affiliate_id', 'partner',
  'tag', 'sub_id', 'subid', 'clickid', 'irclickid', 'sscid', 'cjevent',
  'at_medium', 'at_campaign', 'CMP', 'ncid', 'sr_share', 'guccounter',
]);

// Markers that make a page unusable as an EXPERIENCE signal. The filter is
// mechanical and removes most of the manipulation in the VPS, proxy, hosting,
// VPN and freelance-platform categories, which are the most poisoned.
const AFFILIATE_PARAMS = ['ref', 'aff', 'affiliate', 'affiliate_id', 'partner',
  'partnerid', 'tag', 'irclickid', 'sscid', 'clickid', 'cjevent', 'sub_id'];

const AFFILIATE_PATH_MARKERS = ['/go/', '/out/', '/recommends/', '/aff/', '/deal/', '/r/'];

export interface CanonicalUrl {
  url: string;
  domain: string;
  hadTracking: boolean;
}

export function canonicalizeUrl(raw: string, base?: string): CanonicalUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  // Feeds are inconsistent about scheme; treat http and https as one page.
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';
  if ((u.port === '80' || u.port === '443')) u.port = '';

  let hadTracking = false;
  for (const key of [...u.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p))) {
      u.searchParams.delete(key);
      hadTracking = true;
    }
  }
  // Stable ordering so ?a=1&b=2 and ?b=2&a=1 hash identically.
  u.searchParams.sort();

  // AMP and print variants are the same story wearing a different hat.
  u.pathname = u.pathname
    .replace(/\/amp\/?$/i, '/')
    .replace(/\.amp(\.html?)?$/i, '$1')
    .replace(/\/print\/?$/i, '/')
    .replace(/\/{2,}/g, '/');

  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }

  const url = u.toString().replace(/\?$/, '');
  return { url, domain: u.hostname, hadTracking };
}

export function domainOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Public-suffix-lite: enough to group blog.example.co.uk with example.co.uk
// without shipping a 200 KB suffix list into a Worker bundle.
const TWO_LEVEL_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'or.jp', 'ne.jp', 'ac.jp',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'com.au', 'net.au', 'org.au',
  'com.br', 'com.mx', 'co.in', 'co.nz', 'co.za', 'com.tr',
]);

export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LEVEL_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

/**
 * Affiliate detection for the EXPERIENCE layer. Note this runs against the RAW
 * url, not the canonicalized one -- canonicalization strips the very parameters
 * that give the page away, so checking afterwards would always come back clean.
 */
export function hasAffiliateMarkers(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  for (const p of AFFILIATE_PARAMS) {
    if (u.searchParams.has(p)) return true;
  }
  const path = u.pathname.toLowerCase();
  if (AFFILIATE_PATH_MARKERS.some((m) => path.startsWith(m))) return true;
  return /(^|\.)(shareasale|impact|awin|cj|clickbank|linksynergy|partnerize)\./i.test(u.hostname);
}

/** Feed items routinely carry relative or protocol-relative links. */
export function absolutize(href: string, pageUrl: string): string | null {
  const c = canonicalizeUrl(href, pageUrl);
  return c ? c.url : null;
}

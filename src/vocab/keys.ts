// External API keys, and what each one is worth.
//
// Every one of these is free and optional, and the system runs without any of
// them -- which is exactly why they get forgotten. A key that is missing shows up
// as a quietly smaller import rather than an error, so this registry exists to
// make the difference visible: what is configured, what it unlocks, and where to
// get it.
//
// Nothing here ever reads a key's VALUE into anything user-facing. `configured`
// is a boolean; the secret stays in the environment.

export interface KeySpec {
  env: string;
  label: string;
  /** What the system can do once it is set. */
  unlocks: string;
  /** What happens without it. Never "it breaks" -- everything degrades. */
  without: string;
  /** Where to get one. */
  source: string;
  free: boolean;
  /** Which parts of the system read it. */
  usedBy: string[];
}

export const KEYS: KeySpec[] = [
  {
    env: 'GITHUB_TOKEN',
    label: 'GitHub',
    unlocks: '5,000 API requests an hour instead of 60, and faster topic imports.',
    without: 'Sixty requests an hour, shared with everything else on this IP.',
    source: 'https://github.com/settings/tokens — a classic token with no scopes is enough for public data.',
    free: true,
    usedBy: ['import:topics', 'collection of GitHub release feeds'],
  },
  {
    env: 'STACKEXCHANGE_KEY',
    label: 'Stack Exchange',
    unlocks: 'All 5,329 tag synonyms, and 10,000 requests a day instead of 300.',
    without: 'The 2,500 most-applied synonyms. Page 26 returns access_denied whatever the quota says.',
    source: 'https://stackapps.com/apps/oauth/register — register an app, use the "key" field. No OAuth flow needed.',
    free: true,
    usedBy: ['import:vocab --source synonyms'],
  },
  {
    env: 'LIBRARIES_IO_KEY',
    label: 'Libraries.io',
    unlocks: 'Package names across 30-odd registries, ranked by how much depends on them.',
    without: 'Nothing — this source is skipped entirely.',
    source: 'https://libraries.io/account — the API key is on the account page.',
    free: true,
    usedBy: ['import:vocab --source libraries'],
  },
  {
    env: 'NVD_API_KEY',
    label: 'NVD (NIST)',
    unlocks: '50 requests per 30 seconds instead of 5, for CVE enrichment.',
    without: 'Five requests per 30 seconds. Enough for a slow backfill, not for live enrichment.',
    source: 'https://nvd.nist.gov/developers/request-an-api-key',
    free: true,
    usedBy: ['not yet — CVE enrichment is unbuilt'],
  },
];

export interface KeyStatus extends KeySpec {
  configured: boolean;
}

/** Which keys are set. The values never leave the environment. */
export function keyStatus(env: NodeJS.ProcessEnv | Record<string, string | undefined>): KeyStatus[] {
  return KEYS.map((k) => ({ ...k, configured: Boolean(env[k.env]?.trim()) }));
}

/**
 * Headers for a GitHub request.
 *
 * Unauthenticated GitHub is sixty requests an hour PER IP, which is shared with
 * whatever else runs here -- so a token is the difference between an import that
 * completes and one that stops halfway through with a 403 that reads like a bug.
 */
export function githubHeaders(env: Record<string, string | undefined> = process.env): HeadersInit {
  const headers: Record<string, string> = {
    'user-agent': 'NewsTrack/0.1 (vocabulary import)',
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  const token = env.GITHUB_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

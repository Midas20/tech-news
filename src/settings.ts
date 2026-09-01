// Operator settings: a database overlay on top of the environment.
//
// src/config.ts reads the environment, and that stays the floor -- a Worker has
// no other way to be told anything before its first request. What it cannot do
// is let anyone change a value while the system runs, and a knob nobody can
// reach is not a knob.
//
// So resolution has exactly two layers, in this order:
//
//   app_settings row  ->  environment variable  ->  the code's own default
//
// which is what lets the settings page be honest about provenance: every field
// shows either a value someone chose, or the environment value it falls through
// to, and says which of the two it is. Nothing is offered as configurable that
// the running code does not actually read.

import type { Config } from './config.ts';
import { FIELDS } from './vocab/fields.ts';

export type SettingValue = number | boolean | string | string[];
export type SettingKind = 'int' | 'float' | 'bool' | 'text' | 'enum' | 'multi' | 'list';
export type SettingGroup = 'reading' | 'collection' | 'quality' | 'dedup' | 'processing';

export interface SettingDef {
  /** Dotted key. For scope 'config' it is also the path into Config. */
  key: string;
  scope: 'config' | 'reading';
  group: SettingGroup;
  label: string;
  help: string;
  kind: SettingKind;
  /** The environment variable this overlays, shown as the fallback. */
  env?: string;
  min?: number;
  max?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Turning this on spends budget or sends traffic; the page says so. */
  caution?: boolean;
}

const KIND_OPTIONS = [
  { value: 'news', label: 'News' },
  { value: 'releases', label: 'Releases' },
  { value: 'community', label: 'Community' },
  { value: 'all', label: 'Everything' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'importance', label: 'Importance' },
  { value: 'niche', label: 'Niche first' },
  { value: 'velocity', label: 'Rising fastest' },
  { value: 'coverage', label: 'Most covered' },
];

export const SETTINGS: SettingDef[] = [
  // --- reading: what the reader opens on when the URL says nothing ----------
  {
    key: 'reading.fields', scope: 'reading', group: 'reading', kind: 'multi',
    label: 'Fields you follow',
    options: FIELDS.map((f) => ({ value: f.slug, label: f.label })),
    help: 'The News menu shows only these, and everything beneath them in the taxonomy — '
      + 'picking Security gets CVEs, cryptography and identity, not only stories tagged '
      + '"security". Explore ignores this and always shows everything, so narrowing here '
      + 'hides nothing permanently. Selecting none means no filter at all, which is the '
      + 'default: a reader that starts out hiding things is a reader that looks broken.',
  },
  {
    key: 'reading.tracked', scope: 'reading', group: 'reading', kind: 'list',
    label: 'Releases you track',
    help: 'Releases are shown on News only for the technologies listed here, one slug per '
      + 'line. Everything else a release feed publishes is still collected, still searchable, '
      + 'and still on Explore — it is kept out of the river you read. With nothing listed, '
      + 'News shows launches and changes and no releases at all: 320 repositories publishing '
      + 'a patch version each is not news, and a release you depend on is. Launches, '
      + 'deprecations, shutdowns and advisories are never filtered by this.',
  },
  {
    key: 'reading.kind', scope: 'reading', group: 'reading', kind: 'enum',
    label: 'Default stream', options: KIND_OPTIONS,
    help: 'Which stream the reader opens on. Release feeds outnumber news roughly two to one, which is why news is the default; a link with ?kind= in it always wins over this.',
  },
  {
    key: 'reading.sort', scope: 'reading', group: 'reading', kind: 'enum',
    label: 'Default order', options: SORT_OPTIONS,
    help: 'Applied when the URL carries no ?sort=.',
  },
  {
    key: 'reading.days', scope: 'reading', group: 'reading', kind: 'int', min: 0, max: 365, unit: 'days',
    label: 'Default window', help: 'Show only the last N days. 0 opens the whole archive.',
  },
  {
    key: 'reading.minImportance', scope: 'reading', group: 'reading', kind: 'int', min: 0, max: 10,
    label: 'Minimum importance',
    help: 'Hide anything scored below this. 0 shows everything, including stories not yet scored.',
  },
  {
    key: 'reading.pageSize', scope: 'reading', group: 'reading', kind: 'int', min: 10, max: 200,
    label: 'Stories per page', help: 'Rows before paging.',
  },
  {
    key: 'reading.theme', scope: 'reading', group: 'reading', kind: 'enum', label: 'Theme',
    options: [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
      { value: 'auto', label: 'Match the system' },
    ],
    help: 'Dark is the default: this is a tool people sit in front of for hours, and "match the system" quietly turns it white on a light desktop. The moon in the top bar flips it from any page.',
  },
  {
    key: 'reading.density', scope: 'reading', group: 'reading', kind: 'enum', label: 'Density',
    options: [
      { value: 'comfortable', label: 'Comfortable — show summaries' },
      { value: 'compact', label: 'Compact — headlines only' },
    ],
    help: 'Compact drops the two-line summary and tightens the row, roughly doubling what fits on a screen.',
  },

  // --- collection ----------------------------------------------------------
  {
    key: 'fetch.maxConcurrency', scope: 'config', group: 'collection', kind: 'int', min: 1, max: 64,
    env: 'FETCH_MAX_CONCURRENCY', label: 'Fetch concurrency', unit: 'sources at once',
    help: 'How many sources one cycle polls in parallel.',
  },
  {
    key: 'fetch.politenessMs', scope: 'config', group: 'collection', kind: 'int', min: 0, max: 60000,
    env: 'POLITENESS_INTERVAL_MS', label: 'Politeness interval', unit: 'ms per host',
    help: 'Minimum gap between two requests to the same host, enforced across the whole cycle rather than per source — otherwise twelve feeds on one domain are twelve simultaneous requests.',
  },
  {
    key: 'fetch.timeoutMs', scope: 'config', group: 'collection', kind: 'int', min: 2000, max: 120000,
    env: 'FETCH_TIMEOUT_MS', label: 'Request timeout', unit: 'ms',
    help: 'One slow host must not be allowed to own the cycle.',
  },
  {
    key: 'fetch.retryAttempts', scope: 'config', group: 'collection', kind: 'int', min: 0, max: 5,
    env: 'FETCH_RETRY_ATTEMPTS', label: 'Retry attempts',
    help: 'Attempts after a transient failure before the source is left for the next cycle.',
  },
  {
    key: 'fetch.failureThreshold', scope: 'config', group: 'collection', kind: 'int', min: 1, max: 100,
    env: 'SOURCE_FAILURE_THRESHOLD', label: 'Failures before pausing', unit: 'consecutive',
    help: 'Deliberately tolerant: sources abroad time out intermittently from one region, and that is normal rather than a dead feed.',
  },
  {
    key: 'fetch.userAgent', scope: 'config', group: 'collection', kind: 'text',
    env: 'USER_AGENT', label: 'User agent',
    help: 'Sent on every outbound request. Keep a contact URL in it — it is what a publisher blocks or allows you by.',
  },
  {
    key: 'schedule.hotSeconds', scope: 'config', group: 'collection', kind: 'int', min: 60, max: 86400,
    env: 'POLL_INTERVAL_HOT_SECONDS', label: 'Hot source interval', unit: 'seconds',
    help: 'Sources that publish constantly. Intervals are re-tuned from observed yield, so this is a starting point rather than a fixed rate.',
  },
  {
    key: 'schedule.warmSeconds', scope: 'config', group: 'collection', kind: 'int', min: 300, max: 172800,
    env: 'POLL_INTERVAL_WARM_SECONDS', label: 'Warm source interval', unit: 'seconds',
    help: 'The middle band: a few items a day.',
  },
  {
    key: 'schedule.coldSeconds', scope: 'config', group: 'collection', kind: 'int', min: 900, max: 604800,
    env: 'POLL_INTERVAL_COLD_SECONDS', label: 'Cold source interval', unit: 'seconds',
    help: 'Rarely-updated feeds. Most release feeds live here.',
  },

  // --- what is worth keeping ------------------------------------------------
  {
    key: 'filters.minCharsLatin', scope: 'config', group: 'quality', kind: 'int', min: 0, max: 5000,
    env: 'MIN_CONTENT_CHARS_LATIN', label: 'Minimum length (Latin scripts)', unit: 'characters',
    help: 'Below this a page is a stub, a redirect or an index rather than an article.',
  },
  {
    key: 'filters.minCharsCJK', scope: 'config', group: 'quality', kind: 'int', min: 0, max: 5000,
    env: 'MIN_CONTENT_CHARS_CJK', label: 'Minimum length (CJK)', unit: 'characters',
    help: 'Separate from the Latin threshold because Chinese and Japanese carry far more meaning per character; one number for both silently discards half the Japanese feed.',
  },
  {
    key: 'filters.enclosureRatioThreshold', scope: 'config', group: 'quality', kind: 'float', min: 0, max: 1,
    env: 'DROP_FEED_IF_ENCLOSURE_RATIO_ABOVE', label: 'Podcast detection', unit: 'share of items with audio or video',
    help: 'Above this share of enclosures the feed is a podcast, and its items are links to episodes rather than to writing.',
  },
  {
    key: 'filters.blockedHosts', scope: 'config', group: 'quality', kind: 'list',
    env: 'BLOCKED_HOSTS', label: 'Blocked hosts',
    help: 'Never ingested, whatever links to them. Subdomains are covered. One host per line.',
  },
  {
    key: 'filters.offTopicHosts', scope: 'config', group: 'quality', kind: 'bool',
    env: 'OFF_TOPIC_HOSTS', label: 'Refuse off-topic outlets',
    help: 'Refuse a link to a general-news, consumer-tech or microblogging host — the same 92 hosts the source audit refuses to poll, applied to what aggregators submit. Measured over 30 days it refuses 13.8% of everything collected before the page is fetched, and gives up 4.4% of the News stream.',
  },

  // --- deduplication --------------------------------------------------------
  {
    key: 'dedup.autoMergeDistance', scope: 'config', group: 'dedup', kind: 'int', min: 0, max: 16,
    env: 'SIMHASH_HAMMING_THRESHOLD', label: 'Auto-merge distance', unit: 'bits of 64',
    help: 'SimHash distance at or below which two stories are merged with no model involved. Raising it merges more aggressively and risks joining two genuinely different stories.',
  },
  {
    key: 'dedup.askModelMaxDistance', scope: 'config', group: 'dedup', kind: 'int', min: 0, max: 32,
    env: 'DEDUP_AMBIGUOUS_LOWER', label: 'Ask-the-model ceiling', unit: 'bits of 64',
    help: 'The outer edge of the ambiguous band. Beyond it a pair is simply different, and no model ever sees it.',
  },
  {
    key: 'dedup.maxModelPairs', scope: 'config', group: 'dedup', kind: 'int', min: 0, max: 2000,
    env: 'DEDUP_MAX_MODEL_PAIRS', label: 'Model pairs per cycle', unit: 'pairs',
    help: 'Hard ceiling on judgement calls in one pass, and what it drops is reported rather than dropped quietly. One noisy cycle produced 9,763 candidate pairs against a budget under 100 calls a day.',
  },

  // --- processing -----------------------------------------------------------
  {
    key: 'gates.classificationEnabled', scope: 'config', group: 'processing', kind: 'bool',
    env: 'CLASSIFICATION_ENABLED', label: 'Classification', caution: true,
    help: 'The model passes: tagging, importance, summaries, title translation. Off means collect and store only.',
  },
  {
    key: 'gates.backfillEnabled', scope: 'config', group: 'processing', kind: 'bool',
    env: 'BACKFILL_ENABLED', label: 'Historical backfill', caution: true,
    help: 'The backward collector — Hacker News, GitHub releases and arXiv, walked from a saved cursor. Independent of live collection.',
  },
  {
    key: 'gates.backfillClassify', scope: 'config', group: 'processing', kind: 'bool',
    env: 'BACKFILL_CLASSIFY', label: 'Classify backfilled stories', caution: true,
    help: 'Off by default. Classification is one model call per story, and a backfill is hundreds of thousands of them — leaving this on is how a historical run quietly spends a month of budget in an afternoon. Stack tagging is deterministic and runs either way, so the archive stays analysable by technology regardless.',
  },
  {
    key: 'gates.deliveryEnabled', scope: 'config', group: 'processing', kind: 'bool',
    env: 'DELIVERY_ENABLED', label: 'Slack delivery', caution: true,
    help: 'Routing to Slack channels. Nothing is delivered while this is off.',
  },
  {
    key: 'llm.cacheEnabled', scope: 'config', group: 'processing', kind: 'bool',
    env: 'LLM_CACHE_ENABLED', label: 'Model response cache',
    help: 'Keyed on job type plus a hash of the input, so the same story classified twice costs one call.',
  },
  {
    key: 'llm.escalationThreshold', scope: 'config', group: 'processing', kind: 'int', min: 0, max: 10,
    env: 'IMPORTANCE_ESCALATION_THRESHOLD', label: 'Escalate above importance',
    help: 'Stories scored at or above this are re-judged by the stronger model. Lowering it spends the paid budget faster.',
  },
  {
    key: 'batch.classify', scope: 'config', group: 'processing', kind: 'int', min: 1, max: 100,
    env: 'BATCH_SIZE_CLASSIFY', label: 'Classification batch', unit: 'stories per call',
    help: 'Larger batches cost less per story and lose more when one call fails.',
  },
  {
    key: 'batch.translateTitle', scope: 'config', group: 'processing', kind: 'int', min: 1, max: 100,
    env: 'BATCH_SIZE_TRANSLATE_TITLE', label: 'Translation batch', unit: 'titles per call',
    help: 'Titles only. Bodies are never sent anywhere.',
  },
  {
    key: 'batch.dedupPairs', scope: 'config', group: 'processing', kind: 'int', min: 1, max: 50,
    env: 'BATCH_SIZE_DEDUP_PAIRS', label: 'Dedup batch', unit: 'pairs per call',
    help: 'How many ambiguous pairs are judged in one request.',
  },
];

export const GROUPS: { id: SettingGroup; label: string; icon: string; blurb: string }[] = [
  {
    id: 'reading', label: 'Reading', icon: 'feed',
    blurb: 'What the reader opens on when the URL says nothing. Any link you follow still wins over these.',
  },
  {
    id: 'collection', label: 'Collection', icon: 'pulse',
    blurb: 'How hard the forward collector polls. Changes take effect on the next cycle.',
  },
  {
    id: 'quality', label: 'What is kept', icon: 'scale',
    blurb: 'Applied at ingest, so a change affects new collection only. Nothing already stored is re-filtered or removed.',
  },
  {
    id: 'dedup', label: 'Deduplication', icon: 'layers',
    blurb: 'The band between obviously the same and obviously different, and how much of it a model is allowed to see.',
  },
  {
    id: 'processing', label: 'Processing', icon: 'spark',
    blurb: 'The passes that run after collection, and the gates that hold them shut.',
  },
];

const BY_KEY = new Map(SETTINGS.map((d) => [d.key, d]));

export function settingDef(key: string): SettingDef | undefined {
  return BY_KEY.get(key);
}

// --- reading preferences -----------------------------------------------------

export interface ReadingPrefs {
  /**
   * Taxonomy roots the News menu is limited to.
   *
   * Empty means no restriction, and that is deliberately the same as "all
   * fourteen selected" rather than "nothing shown". The two readings are
   * indistinguishable to a filter and opposite to a person opening the page for
   * the first time.
   */
  fields: string[];
  /**
   * Technologies whose RELEASES you want to see.
   *
   * Empty means no releases on News at all, and that is the deliberate default
   * -- the opposite reading of the same emptiness used by `fields` above, for
   * the opposite reason. A field you have not chosen is a subject you have not
   * ruled out; a release you have not asked for is 320 repositories publishing
   * a patch version every day. Measured on this archive the moment the release
   * feeds went in: 195 releases against 1 launch and 27 changes.
   *
   * A release matters when you depend on the thing releasing. Nothing else can
   * decide that, so nothing else does.
   */
  tracked: string[];
  kind: string;
  sort: string;
  days: number;
  minImportance: number;
  pageSize: number;
  theme: 'auto' | 'dark' | 'light';
  density: 'comfortable' | 'compact';
}

export const READING_DEFAULTS: ReadingPrefs = {
  fields: [], tracked: [],
  kind: 'news', sort: 'newest', days: 0, minImportance: 0,
  pageSize: 40, theme: 'dark', density: 'comfortable',
};

export function readingPrefs(overrides: Map<string, SettingValue>): ReadingPrefs {
  const p = { ...READING_DEFAULTS };
  const get = (k: string) => overrides.get(`reading.${k}`);

  const fields = get('fields');
  if (Array.isArray(fields)) p.fields = fields.map(String);
  const tracked = get('tracked');
  if (Array.isArray(tracked)) p.tracked = tracked.map(String);

  const kind = get('kind');
  if (typeof kind === 'string') p.kind = kind;
  const sort = get('sort');
  if (typeof sort === 'string') p.sort = sort;
  const days = get('days');
  if (typeof days === 'number') p.days = days;
  const min = get('minImportance');
  if (typeof min === 'number') p.minImportance = min;
  const size = get('pageSize');
  if (typeof size === 'number') p.pageSize = size;

  const theme = get('theme');
  if (theme === 'dark' || theme === 'light' || theme === 'auto') p.theme = theme;
  const density = get('density');
  if (density === 'compact' || density === 'comfortable') p.density = density;

  return p;
}

// --- coercion ----------------------------------------------------------------

/**
 * A stored value is usable only if it still fits its definition. Definitions
 * change with the code and rows do not, so every read is validated rather than
 * trusted: a value that no longer fits is ignored and the environment shows
 * through, which is the same outcome as never having set it.
 */
export function coerce(def: SettingDef, raw: unknown): SettingValue | null {
  switch (def.kind) {
    case 'int':
    case 'float': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return null;
      const v = def.kind === 'int' ? Math.round(n) : n;
      if (def.min !== undefined && v < def.min) return def.min;
      if (def.max !== undefined && v > def.max) return def.max;
      return v;
    }
    case 'bool':
      if (typeof raw === 'boolean') return raw;
      return ['true', '1', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
    case 'enum': {
      const v = String(raw).trim();
      return def.options?.some((o) => o.value === v) ? v : null;
    }
    case 'multi': {
      const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(',');
      const allowed = new Set(def.options?.map((o) => o.value));
      return [...new Set(list.map((v) => v.trim()).filter((v) => allowed.has(v)))];
    }
    case 'list': {
      const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[\n,]/);
      return [...new Set(list.map((v) => v.trim().toLowerCase()).filter(Boolean))];
    }
    case 'text':
    default: {
      const v = String(raw).trim();
      return v === '' ? null : v;
    }
  }
}

// --- applying the overlay to Config ------------------------------------------

/** Read a dotted path out of a config, for display and for tests. */
export function configValue(config: Config, key: string): SettingValue | undefined {
  const node = key.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object'
      ? (acc as Record<string, unknown>)[part]
      : undefined),
    config,
  );
  if (typeof node === 'number' || typeof node === 'boolean' || typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(String);
  return undefined;
}

/**
 * Returns a NEW config with the overrides applied. The environment config is
 * never mutated, so "what would this be without the overlay" stays answerable --
 * which is exactly what the settings page prints under every field.
 */
export function applyOverrides(config: Config, overrides: Map<string, SettingValue>): Config {
  const next = structuredClone(config) as unknown as Record<string, unknown>;
  for (const def of SETTINGS) {
    if (def.scope !== 'config') continue;
    const raw = overrides.get(def.key);
    if (raw === undefined) continue;
    const value = coerce(def, raw);
    if (value === null) continue;

    const parts = def.key.split('.');
    const leaf = parts.pop()!;
    let parent: Record<string, unknown> | undefined = next;
    for (const part of parts) {
      const child: unknown = parent?.[part];
      parent = child && typeof child === 'object' ? (child as Record<string, unknown>) : undefined;
    }
    if (parent) parent[leaf] = value;
  }
  return next as unknown as Config;
}

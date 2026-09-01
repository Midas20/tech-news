// Runtime configuration, read from the environment with the values the code was
// written against as defaults.
//
// Everything here is a knob the operator is expected to turn. Anything NOT here
// is a decision the code owns -- the split matters, because a setting that looks
// configurable but is ignored is worse than a hardcoded constant.

import { isOffTopicHost } from './vocab/offtopic.ts';

export interface Env {
  [key: string]: string | undefined;
}

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function list(env: Env, key: string, fallback: string[]): string[] {
  const raw = env[key];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * SimHash distance from a similarity ratio. The .env expresses the ambiguous
 * band as similarity (0.75-0.88); the algorithm works in Hamming distance over
 * 64 bits. distance = (1 - similarity) * 64.
 */
export function distanceFromSimilarity(similarity: number): number {
  return Math.round((1 - similarity) * 64);
}

export interface Config {
  fetch: {
    timeoutMs: number;
    maxConcurrency: number;
    retryAttempts: number;
    politenessMs: number;
    userAgent: string;
    failureThreshold: number;
  };
  filters: {
    minCharsLatin: number;
    minCharsCJK: number;
    allowedLanguages: string[];
    dropEnclosureTypes: string[];
    enclosureRatioThreshold: number;
    blockedHosts: string[];
    /** Refuse links to outlets this archive is not for. */
    offTopicHosts: boolean;
    affiliateParams: string[];
    /**
     * Refuse items that are not about technology at ingest. See topical.ts.
     *
     * On by default, which is the unusual choice here -- most gates in this
     * file default off. The reason is that the cost of it being wrong is
     * recoverable and visible (story_rejects records every refusal with its
     * evidence) while the cost of it being off is a slow accumulation of
     * shopping listicles that nobody notices until the archive is half junk.
     */
    topical: boolean;
    /**
     * Keep only EVENTS: launches, releases and material changes. See eventful.ts.
     *
     * The narrower of the two content gates and the one that decides what this
     * archive is. An article about Kubernetes is not an event in Kubernetes'
     * history; a 2.0 release is.
     */
    eventsOnly: boolean;
  };
  dedup: {
    autoMergeDistance: number;
    askModelMaxDistance: number;
    /** Hard ceiling on judgement calls in one dedup pass. */
    maxModelPairs: number;
  };
  batch: { classify: number; translateTitle: number; dedupPairs: number };
  quality: { sampleSize: number; agreementThreshold: number };
  models: {
    groqClassify: string;
    groqFast: string;
    cerebrasClassify: string;
    geminiClassify: string;
    geminiTranslate: string;
    anthropicJudgment: string;
    anthropicCheap: string;
  };
  llm: {
    bootstrapRpm: number;
    bootstrapRpd: number;
    backoffBaseMs: number;
    backoffMaxMs: number;
    cacheEnabled: boolean;
    escalationThreshold: number;
  };
  schedule: {
    hotSeconds: number;
    warmSeconds: number;
    coldSeconds: number;
    snapshotOffsetHours: number[];
  };
  retention: {
    /**
     * How many months of whole stories to keep. Everything older is aggregate.
     *
     * `0` is KEEP_FOREVER: nothing is ever deleted and no publication date is
     * too old to collect. Set on the user's instruction of 2026-08-29.
     */
    keepMonths: number;
    /**
     * How long a story survives after being taken off the favourites list.
     *
     * Un-favouriting is one click, and the story it releases may be the only
     * surviving copy of something a year old. The window makes that click
     * reversible by clicking again.
     */
    favouriteGraceHours: number;
  };
  gates: {
    classificationEnabled: boolean;
    deliveryEnabled: boolean;
    backfillEnabled: boolean;
    /** Whether a backfilled story is also worth a paid classification call. */
    backfillClassify: boolean;
  };
}

export function loadConfig(env: Env): Config {
  // The ambiguous band arrives as two similarity ratios. The LOWER ratio is the
  // outer edge -- less similar than that and the pair is simply different.
  const askModelMax = distanceFromSimilarity(num(env, 'DEDUP_AMBIGUOUS_LOWER', 0.75));

  return {
    fetch: {
      timeoutMs: num(env, 'FETCH_TIMEOUT_MS', 20_000),
      maxConcurrency: num(env, 'FETCH_MAX_CONCURRENCY', 20),
      retryAttempts: num(env, 'FETCH_RETRY_ATTEMPTS', 2),
      politenessMs: num(env, 'POLITENESS_INTERVAL_MS', 2000),
      userAgent: env.USER_AGENT ?? 'NewsTrack/0.1 (+https://example.invalid/about)',
      // Deliberately tolerant: Chinese sources time out intermittently from US
      // infrastructure, and that is normal rather than a dead feed.
      failureThreshold: num(env, 'SOURCE_FAILURE_THRESHOLD', 10),
    },
    filters: {
      minCharsLatin: num(env, 'MIN_CONTENT_CHARS_LATIN', 400),
      minCharsCJK: num(env, 'MIN_CONTENT_CHARS_CJK', 150),
      // English only by default. The multilingual case is real -- a Japanese
      // release note often lands days before the English write-up -- but it only
      // pays off if titles are TRANSLATED, and translation sits behind the
      // classification gate. Collecting what nobody can read is not collection.
      allowedLanguages: list(env, 'ALLOWED_LANGUAGES', ['en']),
      dropEnclosureTypes: list(env, 'DROP_ENCLOSURE_TYPES', ['audio/*', 'video/*']),
      enclosureRatioThreshold: num(env, 'DROP_FEED_IF_ENCLOSURE_RATIO_ABOVE', 0.5),
      blockedHosts: list(env, 'BLOCKED_HOSTS', []),
    // The editorial host list, as one switch. Off means "collect from anywhere
    // a feed points", which is what this was before the aggregator door was
    // noticed -- kept switchable so the change is measurable rather than
    // permanent.
    offTopicHosts: bool(env, 'OFF_TOPIC_HOSTS', true),
      affiliateParams: list(env, 'AFFILIATE_PARAM_PATTERNS', []),
      topical: bool(env, 'TOPIC_FILTER', true),
      eventsOnly: bool(env, 'EVENTS_ONLY', true),
    },
    dedup: {
      autoMergeDistance: num(env, 'SIMHASH_HAMMING_THRESHOLD', 3),
      askModelMaxDistance: askModelMax,
      maxModelPairs: num(env, 'DEDUP_MAX_MODEL_PAIRS', 200),
    },
    batch: {
      classify: num(env, 'BATCH_SIZE_CLASSIFY', 20),
      translateTitle: num(env, 'BATCH_SIZE_TRANSLATE_TITLE', 20),
      dedupPairs: num(env, 'BATCH_SIZE_DEDUP_PAIRS', 10),
    },
    quality: {
      sampleSize: num(env, 'QUALITY_SAMPLE_SIZE', 20),
      agreementThreshold: num(env, 'QUALITY_AGREEMENT_THRESHOLD', 0.9),
    },
    models: {
      groqClassify: env.GROQ_MODEL_CLASSIFY ?? 'openai/gpt-oss-120b',
      groqFast: env.GROQ_MODEL_FAST ?? 'openai/gpt-oss-20b',
      cerebrasClassify: env.CEREBRAS_MODEL_CLASSIFY ?? 'gpt-oss-120b',
      geminiClassify: env.GEMINI_MODEL_CLASSIFY ?? 'gemini-3.5-flash-lite',
      geminiTranslate: env.GEMINI_MODEL_TRANSLATE ?? 'gemini-3.5-flash',
      anthropicJudgment: env.ANTHROPIC_MODEL_JUDGMENT ?? 'claude-opus-5',
      anthropicCheap: env.ANTHROPIC_MODEL_CHEAP ?? 'claude-haiku-4-5',
    },
    llm: {
      bootstrapRpm: num(env, 'LLM_BOOTSTRAP_RPM', 25),
      bootstrapRpd: num(env, 'LLM_BOOTSTRAP_RPD', 900),
      backoffBaseMs: num(env, 'LLM_BACKOFF_BASE_MS', 1000),
      backoffMaxMs: num(env, 'LLM_BACKOFF_MAX_MS', 60_000),
      cacheEnabled: bool(env, 'LLM_CACHE_ENABLED', true),
      escalationThreshold: num(env, 'IMPORTANCE_ESCALATION_THRESHOLD', 6),
    },
    schedule: {
      hotSeconds: num(env, 'POLL_INTERVAL_HOT_SECONDS', 900),
      warmSeconds: num(env, 'POLL_INTERVAL_WARM_SECONDS', 3600),
      coldSeconds: num(env, 'POLL_INTERVAL_COLD_SECONDS', 21_600),
      snapshotOffsetHours: list(env, 'SNAPSHOT_OFFSETS_HOURS', ['1', '6', '24', '168'])
        .map(Number)
        .filter((n) => Number.isFinite(n)),
    },
    retention: {
      // Default 0 -- keep forever. A default that deletes is the wrong way for
      // this mistake to go: an archive that lost a month because nobody set an
      // env var cannot get it back.
      keepMonths: num(env, 'RETENTION_KEEP_MONTHS', 0),
      favouriteGraceHours: num(env, 'FAVOURITE_GRACE_HOURS', 24),
    },
    gates: {
      // The Phase 1 gate. Both false means: collect, store, and run nothing
      // downstream, for one full week.
      classificationEnabled: bool(env, 'CLASSIFICATION_ENABLED', false),
      deliveryEnabled: bool(env, 'DELIVERY_ENABLED', false),
      backfillEnabled: bool(env, 'BACKFILL_ENABLED', false),
      // Off by default, and the default is the whole point: a backfill is
      // hundreds of thousands of stories and this is a per-story model call.
      // Deterministic stack tagging still runs, so the archive is still
      // analysable by technology -- it is the editorial judgement that is
      // skipped, which is the part nobody reads on a five-year-old story.
      backfillClassify: bool(env, 'BACKFILL_CLASSIFY', false),
    },
  };
}

/**
 * Hosts that are never worth ingesting, whatever links to them.
 *
 * Two lists, kept apart because they are two different decisions. BLOCKED_HOSTS
 * is the operator's -- video and audio platforms, which carry no text. The other
 * is the project's editorial judgement about which outlets this archive is for,
 * and it lives in the vocabulary next to the source audit that already used it:
 * the same call has to be made about a source before polling it and about a link
 * before fetching it, and the two must never disagree.
 */
export function isBlockedHost(config: Config, host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  if (config.filters.blockedHosts.some((b) => h === b || h.endsWith(`.${b}`))) return true;
  return config.filters.offTopicHosts && isOffTopicHost(h);
}

// --- Active configuration ---------------------------------------------------
//
// One process-wide config object, set once at startup. A Worker invocation and
// a CLI run each set it exactly once; nothing mutates it afterwards.

let active: Config | null = null;

export function setConfig(config: Config): void {
  active = config;
}

export function getConfig(): Config {
  if (!active) active = loadConfig({});
  return active;
}

export function configureFromEnv(env: Env): Config {
  const config = loadConfig(env);
  setConfig(config);
  return config;
}

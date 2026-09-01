import type { Db } from '../client.ts';

export interface SourceRow {
  id: string;
  name: string;
  url: string;
  feed_url: string | null;
  feed_kind: string;
  kind: string;
  roles: string[];
  lang: string | null;
  country: string | null;
  trust_weight: string;
  weight_content: string;
  never_canonical: boolean;
  fields: string[];
  poll_interval_seconds: number;
  politeness_seconds: number;
  requires_secret: string | null;
  last_etag: string | null;
  last_modified: string | null;
  consecutive_failures: number;
  health: string;
  /**
   * The company whose own channel this is, when it is one.
   *
   * Set only for rows derived from COMPANY_SEEDS[].announce. It is what tells
   * ingest that a post is the company speaking about its own work rather than
   * an outlet writing about somebody else's, which is a different question from
   * the PRIMARY role: a project's release feed is PRIMARY too.
   */
  company_slug: string | null;
  /**
   * Everything this source publishes is about technology.
   *
   * Its articles are kept as well as its announcements: a project writing
   * "What's new in DevTools (Chrome 149)" is describing a change it made, and
   * the event classifier reads that as an article. True of first-party blogs
   * and release feeds, false of the press. The off-topic gate still applies to
   * both. See migration 0055.
   */
  tech_only: boolean;
}

/**
 * Sources whose next_fetch_at has come round, for one cron shard.
 *
 * Ordered by lateness relative to each source's own interval, for the same
 * reason as dueAcrossShards: plain `next_fetch_at` favours whatever became due
 * first, which in a backlog means the shortest intervals in perpetuity.
 */
export async function dueSources(db: Db, shard: number, limit = 200): Promise<SourceRow[]> {
  return db.query<SourceRow>(
    `SELECT id, name, url, feed_url, feed_kind, kind::text, roles, lang, country, trust_weight,
            weight_content, never_canonical, fields, poll_interval_seconds,
            politeness_seconds, requires_secret, last_etag, last_modified,
            consecutive_failures, health, company_slug, tech_only
       FROM sources
      WHERE shard = $1
        AND health NOT IN ('dead','paused')
        AND next_fetch_at <= now()
      ORDER BY extract(epoch FROM (now() - next_fetch_at))
               / greatest(poll_interval_seconds, 60) DESC,
               next_fetch_at
      LIMIT $2`,
    [shard, limit],
  );
}

/**
 * The next poll time, jittered.
 *
 * `now() + interval` looks obviously right and produces a thundering herd. Every
 * source polled in the same cycle comes due again in the same cycle, and stays
 * in lockstep for as long as the process runs: 300 feeds fetched at once, then
 * an hour of nothing, then 300 again. Measured on this collector -- 597 stories
 * in one minute, then single digits for the next forty.
 *
 * That is not just untidy. It makes a live reader look frozen between bursts,
 * it wastes the concurrency limit on one spike, and it means the moment a story
 * appears has almost nothing to do with when it gets collected.
 *
 * A tenth of the interval, either way, is enough to disperse the herd within a
 * few rounds without letting any source drift meaningfully off its schedule.
 */
const JITTERED = `make_interval(secs => $INTERVAL * (0.9 + random() * 0.2))`;

export async function recordSuccess(
  db: Db,
  sourceId: string,
  opts: { etag: string | null; lastModified: string | null; intervalSeconds: number },
): Promise<void> {
  await db.query(
    `UPDATE sources SET
       last_etag = $2, last_modified = $3,
       last_fetch_at = now(), last_success_at = now(),
       next_fetch_at = now() + ${JITTERED.replace('$INTERVAL', '$4')},
       consecutive_failures = 0, last_error = NULL, health = 'healthy'
     WHERE id = $1`,
    [sourceId, opts.etag, opts.lastModified, opts.intervalSeconds],
  );
}

export async function recordNotModified(db: Db, sourceId: string, intervalSeconds: number): Promise<void> {
  await db.query(
    `UPDATE sources SET
       last_fetch_at = now(), last_success_at = now(),
       next_fetch_at = now() + ${JITTERED.replace('$INTERVAL', '$2')},
       consecutive_failures = 0, health = 'healthy'
     WHERE id = $1`,
    [sourceId, intervalSeconds],
  );
}

/**
 * Exponential backoff with a health ladder. A source is only called dead after
 * roughly a week of consecutive failures -- intermittent timeouts from Chinese
 * sources, and blogs that go down for a weekend, must not be discarded.
 */
export async function recordFailure(
  db: Db,
  sourceId: string,
  error: string,
  baseIntervalSeconds: number,
): Promise<void> {
  await db.query(
    `UPDATE sources SET
       last_fetch_at = now(),
       consecutive_failures = consecutive_failures + 1,
       last_error = $2,
       next_fetch_at = now() + make_interval(secs =>
         LEAST($3 * power(2, LEAST(consecutive_failures, 6))::int, 86400)),
       health = CASE
         WHEN consecutive_failures + 1 >= 40 THEN 'dead'::source_health
         WHEN consecutive_failures + 1 >= 10 THEN 'failing'::source_health
         WHEN consecutive_failures + 1 >= 3  THEN 'degraded'::source_health
         ELSE 'healthy'::source_health
       END
     WHERE id = $1`,
    [sourceId, error.slice(0, 500), baseIntervalSeconds],
  );
}

export async function pauseSource(db: Db, sourceId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE sources SET health = 'paused', last_error = $2 WHERE id = $1`,
    [sourceId, reason.slice(0, 500)],
  );
}

/**
 * Autodiscovery result. The stored feed URL is what was found, not what was
 * guessed.
 *
 * Two registry entries can legitimately resolve to ONE feed -- "GitHub Blog" and
 * "GitHub Engineering" both advertise github.blog/feed. feed_url is unique, so
 * the second one to discover it is a duplicate of a source already being polled:
 * it is paused with that reason rather than crashing the cycle or silently
 * double-collecting the same items under two names.
 */
export async function setFeedUrl(db: Db, sourceId: string, feedUrl: string, kind: string): Promise<boolean> {
  const owner = await db.query<{ id: string; name: string }>(
    `SELECT id::text, name FROM sources WHERE feed_url = $1 AND id <> $2`, [feedUrl, sourceId]);

  if (owner.length > 0) {
    await pauseSource(db, sourceId,
      `duplicate feed: ${feedUrl} is already collected as "${owner[0]!.name}"`);
    return false;
  }

  await db.query(`UPDATE sources SET feed_url = $2, feed_kind = $3 WHERE id = $1`, [
    sourceId, feedUrl, kind,
  ]);
  return true;
}

export async function logFetch(
  db: Db,
  row: {
    sourceId: string;
    status: number | null;
    durationMs: number;
    bytes: number;
    itemsSeen: number;
    itemsKept: number;
    notModified: boolean;
    error: string | null;
    dropReasons: Record<string, number>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO fetch_log (source_id, status, duration_ms, bytes, items_seen,
                            items_kept, not_modified, error, drop_reasons)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      row.sourceId, row.status, row.durationMs, row.bytes, row.itemsSeen,
      row.itemsKept, row.notModified, row.error?.slice(0, 500) ?? null,
      JSON.stringify(row.dropReasons),
    ],
  );
}

/**
 * Source discovery (spec 2.4). Outbound domains are accumulated here; promotion
 * to a real source is a separate weekly model pass over candidates with 3+
 * mentions in 30 days.
 */
export async function recordCandidateDomains(
  db: Db,
  referringSourceId: string,
  domains: { domain: string; sampleUrl: string }[],
): Promise<void> {
  if (domains.length === 0) return;
  await db.query(
    `INSERT INTO source_candidates (domain, sample_urls, referring_sources, mention_count)
     SELECT d.domain, ARRAY[d.sample_url], ARRAY[$1::uuid], 1
       FROM unnest($2::text[], $3::text[]) AS d(domain, sample_url)
      WHERE NOT EXISTS (
        SELECT 1 FROM sources s
         WHERE lower(split_part(split_part(s.url, '://', 2), '/', 1)) = d.domain
            OR lower(split_part(split_part(coalesce(s.feed_url,''), '://', 2), '/', 1)) = d.domain
      )
     ON CONFLICT (domain) DO UPDATE SET
       mention_count = source_candidates.mention_count + 1,
       last_seen_at = now(),
       sample_urls = (source_candidates.sample_urls || EXCLUDED.sample_urls)[1:5],
       referring_sources = CASE
         WHEN $1::uuid = ANY(source_candidates.referring_sources)
           THEN source_candidates.referring_sources
         ELSE source_candidates.referring_sources || $1::uuid
       END`,
    [referringSourceId, domains.map((d) => d.domain), domains.map((d) => d.sampleUrl)],
  );
}

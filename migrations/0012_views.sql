-- 0012: read helpers used by the UI, the digest builder and the ops dashboard.

-- The live archive: superseded rows are kept forever but never surface.
CREATE OR REPLACE VIEW live_stories AS
  SELECT * FROM stories WHERE superseded_by IS NULL;

-- Coverage trajectory per story, for the inline sparklines (spec 6.8).
CREATE OR REPLACE VIEW story_coverage_curve AS
  SELECT story_id,
         array_agg(count ORDER BY captured_at)       AS counts,
         array_agg(captured_at ORDER BY captured_at) AS points,
         max(count)                                  AS peak
  FROM coverage_snapshots
  GROUP BY story_id;

-- Velocity: coverage gained per hour since first snapshot. Only possible because
-- snapshots are stored; nothing else offers this sort.
CREATE OR REPLACE VIEW story_velocity AS
  SELECT s.id AS story_id,
         s.coverage_count,
         GREATEST(EXTRACT(epoch FROM (now() - s.collected_at)) / 3600.0, 0.25) AS age_hours,
         s.coverage_count /
           GREATEST(EXTRACT(epoch FROM (now() - s.collected_at)) / 3600.0, 0.25) AS coverage_per_hour
  FROM stories s
  WHERE s.superseded_by IS NULL;

CREATE OR REPLACE VIEW source_health_board AS
  SELECT s.id, s.name, s.health, s.roles, s.lang, s.consecutive_failures,
         s.last_success_at, s.last_error, s.poll_interval_seconds,
         f.attempts_24h, f.kept_24h, f.not_modified_24h
  FROM sources s
  LEFT JOIN LATERAL (
    SELECT count(*) AS attempts_24h,
           sum(items_kept) AS kept_24h,
           count(*) FILTER (WHERE not_modified) AS not_modified_24h
    FROM fetch_log fl
    WHERE fl.source_id = s.id AND fl.fetched_at > now() - interval '24 hours'
  ) f ON true;

-- Per-day ingest funnel. During the Phase 1 observation week this is the whole
-- dashboard: how much arrived, how much survived, where it was dropped.
CREATE OR REPLACE VIEW ingest_funnel AS
  SELECT date_trunc('day', fetched_at) AS day,
         sum(items_seen)  AS seen,
         sum(items_kept)  AS kept,
         count(*)         AS fetches,
         count(*) FILTER (WHERE not_modified) AS not_modified,
         count(*) FILTER (WHERE error IS NOT NULL) AS errors
  FROM fetch_log
  GROUP BY 1 ORDER BY 1 DESC;

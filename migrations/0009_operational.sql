-- 0009: operational tables. Everything the model layer needs to be stateless,
-- resumable and cheap.

-- Cache every result by hash(job_type + input) so failover and reprocessing cost
-- nothing. This is what makes the failover chain safe to retry aggressively.
CREATE TABLE IF NOT EXISTS llm_cache (
  input_hash    bytea NOT NULL,
  job_type      text  NOT NULL,
  output_json   jsonb NOT NULL,
  provider      text  NOT NULL,
  model         text,
  prompt_version text NOT NULL DEFAULT 'v1',
  tokens_in     int,
  tokens_out    int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_type, input_hash, prompt_version)
);

CREATE INDEX IF NOT EXISTS llm_cache_created_idx ON llm_cache (created_at DESC);

-- Observed limits, never published ones. Providers change quotas without notice
-- and their own documentation contradicts itself (spec 9.5).
CREATE TABLE IF NOT EXISTS provider_budgets (
  provider_id       text NOT NULL,
  bucket            text NOT NULL DEFAULT 'requests'
                    CHECK (bucket IN ('requests','tokens')),
  quota_observed    int,
  remaining_observed int,
  window_start      timestamptz NOT NULL DEFAULT now(),
  window_seconds    int NOT NULL DEFAULT 60,
  spent             int NOT NULL DEFAULT 0,
  last_429_at       timestamptz,
  retry_after       timestamptz,
  health            provider_health NOT NULL DEFAULT 'healthy',
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, bucket)
);

-- Weekly agreement sampling (spec 4.4). Quality degradation is silent: a weak
-- model misclassifying a CVE produces no error, just a story that never arrives.
CREATE TABLE IF NOT EXISTS quality_samples (
  id             bigserial PRIMARY KEY,
  job_type       text NOT NULL,
  input_hash     bytea NOT NULL,
  cheap_provider text NOT NULL,
  cheap_output   jsonb NOT NULL,
  reference_output jsonb,
  agreed         boolean,
  sampled_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS quality_samples_job_idx ON quality_samples (job_type, sampled_at DESC);

CREATE OR REPLACE VIEW quality_agreement AS
  SELECT job_type,
         cheap_provider,
         count(*) FILTER (WHERE agreed IS NOT NULL)              AS scored,
         count(*) FILTER (WHERE agreed)                          AS agreements,
         round(avg(CASE WHEN agreed THEN 1.0 ELSE 0.0 END), 3)   AS agreement_rate,
         max(sampled_at)                                         AS last_sample
  FROM quality_samples
  WHERE sampled_at > now() - interval '30 days'
  GROUP BY job_type, cheap_provider;

-- Table-backed queue. CF Queues can replace this without touching callers; the
-- table is the free-tier default and doubles as the audit trail.
CREATE TABLE IF NOT EXISTS jobs (
  id            bigserial PRIMARY KEY,
  type          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_key     text,
  status        job_status NOT NULL DEFAULT 'pending',
  priority      smallint NOT NULL DEFAULT 5,   -- 0 highest; backfill sits at 9
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 5,
  run_after     timestamptz NOT NULL DEFAULT now(),
  leased_until  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedup_idx ON jobs (type, dedup_key)
  WHERE dedup_key IS NOT NULL AND status IN ('pending','leased');
CREATE INDEX IF NOT EXISTS jobs_ready_idx ON jobs (priority, run_after)
  WHERE status IN ('pending','deferred');

-- Lease jobs atomically. Nothing blocks: unprocessed rows simply retry next cycle.
CREATE OR REPLACE FUNCTION lease_jobs(p_types text[], p_limit int, p_lease_seconds int)
RETURNS SETOF jobs LANGUAGE sql AS $fn$
  UPDATE jobs SET
    status = 'leased',
    attempts = attempts + 1,
    leased_until = now() + make_interval(secs => p_lease_seconds)
  WHERE id IN (
    SELECT id FROM jobs
    WHERE type = ANY(p_types)
      AND (status IN ('pending','deferred')
           OR (status = 'leased' AND leased_until < now()))
      AND run_after <= now()
      AND attempts < max_attempts
    ORDER BY priority, run_after
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *
$fn$;

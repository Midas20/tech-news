-- 0006: time series. These curves cannot be recreated after the fact -- they are
-- captured at +1h, +6h, +24h and +7d and are what make niche-first and velocity
-- sorting possible at all.

CREATE TABLE IF NOT EXISTS coverage_snapshots (
  story_id     uuid NOT NULL,
  count        int  NOT NULL,
  offset_label text NOT NULL CHECK (offset_label IN ('1h','6h','24h','7d','adhoc')),
  captured_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, offset_label, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE INDEX IF NOT EXISTS coverage_snapshots_story_idx ON coverage_snapshots (story_id, captured_at);

CREATE TABLE IF NOT EXISTS engagement_snapshots (
  story_id        uuid NOT NULL,
  engagement_type engagement_type NOT NULL,
  value           bigint NOT NULL,
  source_id       uuid REFERENCES sources(id),   -- 500 HN points is not 500 Qiita views
  offset_label    text NOT NULL CHECK (offset_label IN ('1h','6h','24h','7d','adhoc')),
  captured_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, engagement_type, offset_label, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE INDEX IF NOT EXISTS engagement_snapshots_story_idx
  ON engagement_snapshots (story_id, engagement_type, captured_at);

-- Work list for the snapshot scheduler. One row per (story, offset) due in future.
CREATE TABLE IF NOT EXISTS snapshot_schedule (
  story_id     uuid NOT NULL,
  offset_label text NOT NULL,
  due_at       timestamptz NOT NULL,
  captured     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (story_id, offset_label)
);

CREATE INDEX IF NOT EXISTS snapshot_due_idx ON snapshot_schedule (due_at) WHERE NOT captured;

CREATE TRIGGER coverage_snapshots_no_delete   BEFORE DELETE ON coverage_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER engagement_snapshots_no_delete BEFORE DELETE ON engagement_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();

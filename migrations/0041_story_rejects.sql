-- 0041: what the topic filter refused, and why.
--
-- src/collect/topical.ts drops items at ingest: shopping listicles, television,
-- sport, politics, crime reporting and the endless vendor survey. Dropping is
-- the right call -- storing something in order to hide it later costs the same
-- disk and buys nothing -- but a filter with no record is a filter nobody can
-- correct. A rule that quietly eats a beat you cared about looks exactly like a
-- feed that went quiet, and by the time you notice, the evidence is gone.
--
-- So the decision is kept even though the story is not. Title, category, and
-- the exact phrase that triggered it: enough to see a mistake and fix the rule,
-- and not enough to be an archive of things we decided not to archive.
--
-- Keyed by URL with a counter rather than a row per sighting. A refused item
-- stays in its feed and is refused again on every poll -- ZDNET's Labor Day
-- deals page was seen eight times in eight hours -- so a row per decision would
-- make this table grow at exactly the rate of the junk it exists to describe.
-- The counter is also the more useful number: `times` says which noise is
-- persistent and which was a one-off.

CREATE TABLE IF NOT EXISTS story_rejects (
  url        text PRIMARY KEY,
  title      text NOT NULL,
  source_id  uuid REFERENCES sources(id) ON DELETE CASCADE,
  category   text NOT NULL,
  -- The phrase that decided it. Without this a rejection is an assertion; with
  -- it, it is an argument you can check in one glance.
  matched    text,
  times      int  NOT NULL DEFAULT 1,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);

-- "What is this filter doing lately", and "what is this source mostly for".
CREATE INDEX IF NOT EXISTS story_rejects_seen_idx ON story_rejects (last_seen DESC);
CREATE INDEX IF NOT EXISTS story_rejects_source_idx ON story_rejects (source_id, category);

GRANT SELECT ON story_rejects TO newstrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON story_rejects TO newstrack_worker;

-- Deliberately NOT under the append-only rules of 0037. Those protect the
-- archive; this is a diagnostic log, and retention trims it the way it trims
-- fetch_log.

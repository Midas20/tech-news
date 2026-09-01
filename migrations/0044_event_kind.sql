-- 0044: what KIND of thing a story reports.
--
-- The archive's target is narrow and it was not written down anywhere the code
-- could act on: new stacks, tools and platforms, and major changes to existing
-- ones. Launches, releases, deprecations, licence changes, shutdowns.
--
-- Articles are not that. A tutorial about Kubernetes, a benchmark of Postgres,
-- an essay on why microservices were a mistake -- all of them are about
-- technology, all of them pass the topic filter in 0041's sense, and none of
-- them is an EVENT in a technology's life. An archive built to answer what rose
-- and fell over years is built out of events.
--
-- Four values, because "is this an announcement" loses information that costs
-- nothing to keep: a launch and an end-of-life are both events and they are
-- opposite events, and a reader scanning for what is NEW wants one of them.
--
--   launch   a thing that did not exist before now does
--   release  a new version of a thing that already existed
--   change   the same thing, materially different
--   article  writing about a technology rather than a report of an event
--
-- NULL means nobody has judged it yet, and the reader must not confuse that
-- with `article` -- the same rule `is_tech` follows, for the same reason: the
-- archive predates the classifier and reading NULL as a rejection would empty
-- every page at once.

ALTER TABLE stories ADD COLUMN IF NOT EXISTS event_kind text;

ALTER TABLE stories DROP CONSTRAINT IF EXISTS stories_event_kind_check;
ALTER TABLE stories ADD CONSTRAINT stories_event_kind_check
  CHECK (event_kind IS NULL OR event_kind IN ('launch','release','change','article'));

-- The reader's default is "events only", which is this column plus the
-- publication clock every list already sorts on.
CREATE INDEX IF NOT EXISTS stories_event_kind_idx
  ON stories (event_kind, published_at DESC);

-- Two faults, one shape. A daily report that was not daily, and no way to read
-- the ones already written.
--
-- FAULT 1: THE REPORT DID NOT CHANGE. 0072 wrote one briefing a day over a
-- rolling FOURTEEN-day window. Measured on 2026-09-01: that window holds 2,237
-- readable stories and roughly 171 arrive in a day, so consecutive reports
-- shared about 92% of their evidence. Same evidence, same briefing. Calling it
-- daily made it look like a fresh reading of the news when it was yesterday's
-- reading with one day stirred in.
--
-- So a report now covers the period SINCE THE LAST ONE. `covered_from` and
-- `covered_to` are stored rather than derived, because "the last fourteen days"
-- is a different set of stories depending on when you ask it, and a report has
-- to be able to say exactly which stories it read -- including a week later,
-- when the job has run six more times.
--
-- WHY NOT first_seen_at, which is the obvious column for "new to us". It is
-- poisoned here: the backfill campaign re-inserted the archive, so 22,167
-- stories claim to have been first seen within a day. `published_at` is what
-- actually happened when, so the window is a window on the news rather than on
-- our own write traffic.
--
-- FAULT 2: NOTHING WAS LISTABLE. Asked for 2026-09-01 -- the report must "list
-- that compose each report for each day and each fields". The briefings lived
-- inside one jsonb blob per day, so "every AI briefing this month" meant parsing
-- every day's payload, and a single field's report had no address of its own.
--
-- Hence this table: one row per (day, field). It is the grain the reader
-- actually navigates -- by day down one axis and by field across the other --
-- and it makes both listings an index scan instead of a scan plus a parse.
-- daily_reports keeps its row per day for the composed title and the totals.

CREATE TABLE IF NOT EXISTS field_briefings (
  day           date        NOT NULL,
  field         text        NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  generator     text        NOT NULL,
  -- Which model wrote it. A briefing is not anonymous, and the chain degrades.
  provider      text,

  -- Exactly what this briefing read. Stored, not derived: see above.
  covered_from  timestamptz NOT NULL,
  covered_to    timestamptz NOT NULL,
  CHECK (covered_to > covered_from),

  headline      text        NOT NULL,
  summary       text        NOT NULL,
  -- What the stories could not settle, in the writer's own words.
  gaps          text,

  -- Counts OF THE READING, which this archive knows exactly. Never counts of
  -- the field, which it cannot know at all -- see 0072.
  stories_read  int         NOT NULL CHECK (stories_read >= 0),
  sources       int         NOT NULL CHECK (sources >= 0),
  independent   int         NOT NULL CHECK (independent >= 0),
  themes        int         NOT NULL CHECK (themes >= 0),

  -- The findings and their resolved citations. jsonb for the same reason as
  -- 0071: the shape of a finding is the thing most likely to change, and
  -- `generator` keeps an old row readable as what it was.
  payload       jsonb       NOT NULL,

  PRIMARY KEY (day, field)
);

-- The two axes the reader navigates. One index each, because "every field on
-- this day" and "every day for this field" are different questions and the
-- primary key only serves the first.
CREATE INDEX IF NOT EXISTS field_briefings_by_day_idx
  ON field_briefings (day DESC, field);
CREATE INDEX IF NOT EXISTS field_briefings_by_field_idx
  ON field_briefings (field, day DESC);

-- A briefing is analysis. Retention deletes the stories it cites after four
-- months; the sentence the archive was prepared to say about them stays.
CREATE TRIGGER field_briefings_no_delete
  BEFORE DELETE ON field_briefings
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();

GRANT SELECT ON field_briefings TO newstrack_app;
GRANT SELECT, INSERT, UPDATE ON field_briefings TO newstrack_worker;

-- The day-level row gets the same window, so a listing can state what each
-- day's report covered without opening any of its fields.
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS covered_from timestamptz;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS covered_to   timestamptz;

COMMENT ON COLUMN daily_reports.covered_from IS
  'Start of the period this report read. NULL on movement-v1 rows, which used a '
  'rolling window derived at render time.';

-- window_days stays in the primary key and stops being a window. Under
-- content-v2 a report covers the gap since the previous one, which is usually a
-- day and is whatever it is after an outage. The column is retained as the key
-- discriminator and as the NOMINAL cadence; covered_from/covered_to are the
-- truth about what was read.
COMMENT ON COLUMN daily_reports.window_days IS
  'movement-v1: the comparison window. content-v2: nominal cadence in days; the '
  'actual period read is covered_from..covered_to.';

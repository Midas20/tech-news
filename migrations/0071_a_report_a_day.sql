-- A report is a thing the archive produces, not a page it renders on request.
--
-- /trends/report computed its findings live on every view. That is fine for a
-- page and useless as a record: the verdicts move as collection moves, so what
-- the archive said about Rust last Tuesday was unrecoverable by Wednesday. For
-- an instrument whose whole purpose is the passage of time, that is the wrong
-- way round -- the analysis is supposed to be the durable part.
--
-- So the report is generated once a day by the scheduler and kept. The page
-- still renders live, because a reader looking now should see now; but the
-- stored row is what makes "what did we think in August" a question with an
-- answer.
--
-- WHY jsonb AND NOT COLUMNS. The shape of a finding is the thing most likely to
-- change here -- a new band, a new corroboration measure, a verdict this code
-- does not have a name for yet. A table of columns would need a migration per
-- idea and would still lose the old shape on the way. The payload is written by
-- one function and read by one function, and both are versioned by `generator`,
-- so an old row stays readable as what it was rather than being reinterpreted
-- as what the current code would have written.
--
-- ONE ROW PER (day, window). The window is part of the identity: a 30-day and a
-- 365-day report on the same morning are two different statements, and neither
-- supersedes the other. Re-running a day overwrites that day's row for that
-- window, so a retry after a failure corrects rather than duplicates.

CREATE TABLE IF NOT EXISTS daily_reports (
  day           date        NOT NULL,
  window_days   int         NOT NULL CHECK (window_days > 0),
  generated_at  timestamptz NOT NULL DEFAULT now(),
  generator     text        NOT NULL,

  -- What the report is ABOUT, and when. "Movement report" on two hundred rows
  -- is a filename; a title names the subject -- a technology, a tool, a
  -- platform, a company, or the money -- and the day it was written.
  title         text        NOT NULL,

  -- The headline counts, lifted out of the payload so a listing does not have
  -- to parse every row to say how big each report was.
  stories       int         NOT NULL,
  sources       int         NOT NULL,
  compared      int         NOT NULL,
  growing       int         NOT NULL,
  declining     int         NOT NULL,

  payload       jsonb       NOT NULL,

  PRIMARY KEY (day, window_days)
);

CREATE INDEX IF NOT EXISTS daily_reports_recent_idx
  ON daily_reports (window_days, day DESC);

-- Retention deletes stories and keeps the analysis. A report is analysis: it is
-- the sentence the archive was prepared to say on a given morning, and it stays
-- readable long after the stories that justified it are gone.
CREATE TRIGGER daily_reports_no_delete
  BEFORE DELETE ON daily_reports
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();

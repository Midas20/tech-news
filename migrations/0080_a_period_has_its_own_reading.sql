-- A month can be read. It was never tried.
--
-- 2026-09-10, against /reports/month/2026-07, which said in careful prose that
-- it had no analysis and could not get one: "hey kidding me?"
--
-- THE REASON GIVEN WAS NOT MEASURED, AND IT WAS WRONG. Every period page
-- carried a note saying a period of stories "does not fit in a prompt", and the
-- README repeated it as settled design. That claim came from the year: the
-- archive holds 5,461 stories back to 2010, and it is true of those. It was
-- never checked against a month. Measured that day:
--
--   2026-05    163 readable stories
--   2026-06    266
--   2026-07    360
--   2026-08    790
--   2026-09  1,882
--
-- A daily field briefing already reads 80 stories in a ~54,000 character
-- prompt. July diversifies to the same size. The period reports were refusing,
-- on principle, work that fits.
--
-- So a period gets a reading of its own: ONE model call over the whole archive
-- for that span, with the stories from BEFORE the span as its earlier end --
-- which is the same then-and-now comparison a daily reading makes, over a
-- longer baseline. `analyseField` already takes its corpus as an argument and
-- its window as an argument, so this needs no new analysis machinery at all.
-- Only somewhere to put the answer.
--
-- WHY A TABLE AND NOT A COLUMN, which is the opposite of the call made in 0076.
-- A field briefing's strategy is a column because it is written from exactly one
-- briefing's corpus and its citations are indices into that briefing's story
-- list; the two cannot outlive each other. A period reading has no such row to
-- hang from -- a month is not a briefing, and /reports/month/2026-07 is composed
-- on demand from four separate queries. Its citations are resolved to real
-- stories at write time for the same reason field briefings resolve theirs:
-- retention deletes the stories within four months and the comparison has to
-- outlive them.
--
-- NOTHING IS GENERATED ON VIEW, exactly as with the daily reports. A page that
-- writes its own analysis on refresh costs a model call per reader, and gives
-- two people looking at the same archive two different reports.

CREATE TABLE IF NOT EXISTS period_readings (
  -- 'week' | 'month' | 'year'. Not an enum: `day` is a valid span in the code
  -- and deliberately has no reading here, since a day already has one per field.
  span         text        NOT NULL,
  -- The period key as the route spells it: 2026-W-Monday-date, 2026-07, 2026.
  key          text        NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  -- Which model answered. Shown, because the weakest provider in the chain is
  -- the one that answers on a day the others are out of quota.
  provider     text,
  -- The window actually read, which is the calendar period and is stored anyway
  -- so a reading can be checked against the range it claims to cover.
  covered_from timestamptz NOT NULL,
  covered_to   timestamptz NOT NULL,
  -- How much was read, and how much came before it. Out of the jsonb because
  -- the page shows them beside the claims and a reader weighing a claim about
  -- change needs the size of both ends before they read one.
  stories_read integer     NOT NULL DEFAULT 0,
  history_read integer,
  history_from date,
  -- The reading itself, in the same shape as field_briefings.strategy, so one
  -- renderer serves both. See 0076 for what is in it.
  strategy     jsonb       NOT NULL,
  PRIMARY KEY (span, key)
);

GRANT SELECT ON period_readings TO newstrack_app;
GRANT SELECT, INSERT, UPDATE ON period_readings TO newstrack_worker;

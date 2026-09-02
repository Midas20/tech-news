-- The report stopped being a count, so its columns had to stop being counts.
--
-- 0071 gave daily_reports five NOT NULL integers: stories, sources, compared,
-- growing, declining. Those were the summary of a share-ratio analysis -- how
-- many technologies the archive compared, how many it judged to be growing.
--
-- That analysis was rejected on 2026-09-01: "don't count news, it is fake value
-- because we can't collect all news". The objection is correct and it is fatal
-- to those columns specifically. `growing` was never a fact about technology;
-- it was a fact about which feeds happened to be healthy that week, which is
-- why repairing 179 dead release feeds moved every verdict in the table.
--
-- WHY THE OLD COLUMNS SURVIVE AS NULLABLE rather than being dropped. Rows
-- written under `movement-v1` are still in this table and are still true as
-- what they were: a record of what the archive was prepared to say on those
-- mornings, under an analysis it no longer performs. Dropping the columns would
-- silently rewrite that history into something it never said. They are made
-- nullable so that nothing new has to invent a value for them, and `generator`
-- already tells a reader which shape they are looking at.
--
-- WHAT REPLACES THEM. Not measurements of the industry -- measurements of the
-- READING. `stories_read` is how many stories were actually put in front of the
-- writer, `sources` how many publishers they came from, `themes` how many
-- findings survived citation checking. Those describe the evidence behind the
-- report, which is a thing this archive genuinely knows, unlike the size of a
-- field.

ALTER TABLE daily_reports ALTER COLUMN stories   DROP NOT NULL;
ALTER TABLE daily_reports ALTER COLUMN sources   DROP NOT NULL;
ALTER TABLE daily_reports ALTER COLUMN compared  DROP NOT NULL;
ALTER TABLE daily_reports ALTER COLUMN growing   DROP NOT NULL;
ALTER TABLE daily_reports ALTER COLUMN declining DROP NOT NULL;

COMMENT ON COLUMN daily_reports.compared IS
  'movement-v1 only: technologies whose share was compared. NULL under content-v1, '
  'which does not count.';
COMMENT ON COLUMN daily_reports.growing IS
  'movement-v1 only. A share verdict, and a fact about feed health rather than '
  'about the technology. NULL under content-v1.';
COMMENT ON COLUMN daily_reports.declining IS
  'movement-v1 only. See growing. NULL under content-v1.';

-- How many of the taxonomy roots produced a briefing. A field with too little
-- text to read is recorded as quiet in the payload, not as zero.
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS fields int
  CHECK (fields IS NULL OR fields >= 0);

-- Findings that survived citation checking. A theme citing no story, or a story
-- that does not exist, is dropped before it reaches this table.
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS themes int
  CHECK (themes IS NULL OR themes >= 0);

-- Stories actually put in front of the writer. This is a count OF THE READING,
-- which the archive knows exactly, and never a count of a field, which it
-- cannot know at all.
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS stories_read int
  CHECK (stories_read IS NULL OR stories_read >= 0);

COMMENT ON COLUMN daily_reports.stories_read IS
  'Stories the briefing was written from. Evidence behind the report, not a '
  'measurement of the field.';

-- The page asks for the newest row of a given shape, so the generator belongs
-- in the index that serves it.
CREATE INDEX IF NOT EXISTS daily_reports_generator_idx
  ON daily_reports (window_days, generator, day DESC);

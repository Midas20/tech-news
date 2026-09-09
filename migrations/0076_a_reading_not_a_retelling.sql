-- The reading, stored beside the report it was drawn from.
--
-- Asked for on 2026-09-09, against a briefing that had repeated a Databricks
-- conference post almost verbatim: "This report is only repeat of some news
-- content... I need strategy info in report not repeat of news, The news is only
-- data that prove your analysis result."
--
-- The complaint was correct and the cause was not the prompt. `fieldCorpus` is
-- bounded at both ends by the report window -- deliberately, since 0073, because
-- that is what made a daily report actually daily. But a corpus holding one day
-- cannot support a claim about direction. The model was asked what is going on
-- while holding a single day's stories; it could repeat the post or invent a
-- trend, and repeating was the honest of the two.
--
-- So a second pass reads the same field against the SIX MONTHS BEFORE the
-- window, on the subjects today's stories actually name, and this column holds
-- what it found.
--
-- WHY A COLUMN AND NOT A TABLE. A strategy is written from exactly one
-- briefing's corpus and is meaningless without it: the citations are indices
-- into that briefing's story list. Splitting them across two tables would allow
-- a strategy row to outlive the numbering it refers to, which is a footnote
-- pointing at a page that has been renumbered.
--
-- WHAT IS IN THE JSON, and why none of it is a count of our own stories:
--
--   read         one sentence: the useful thing to take from today
--   direction[]  a claim about change, with `then` citing the earlier corpus and
--                `now` citing today's. BOTH ARE REQUIRED. src/analysis/strategy.ts
--                drops any claim that cannot fill both, because a model with
--                nothing to compare reaches for two of today's stories and
--                produces a sentence that sounds like a trend and is a
--                restatement -- indistinguishable from a finding unless
--                something checks the indices.
--   positioning[] what a named company appears to be betting on, read from what
--                it ships and chooses to talk about. `firstParty` marks the case
--                where the evidence is that company talking about itself, which
--                is excellent evidence of intent and none at all of adoption.
--   openings[]   a gap between what is being sold and what the evidence shows
--                is solved.
--   limits       what this evidence cannot settle.
--   history      the real span of earlier coverage read, so a reader can tell a
--                claim drawn against six months from one drawn against four days.

ALTER TABLE field_briefings ADD COLUMN IF NOT EXISTS strategy jsonb;

-- How many earlier stories the reading was drawn against, and how far back they
-- reached. Lifted out of the jsonb because the report index shows it per row and
-- a reader deciding whether to trust a claim needs it before they open the page.
ALTER TABLE field_briefings ADD COLUMN IF NOT EXISTS history_read integer;
ALTER TABLE field_briefings ADD COLUMN IF NOT EXISTS history_from date;

-- Which fields have a reading at all. Partial, because the query that wants it
-- always wants the ones that do.
CREATE INDEX IF NOT EXISTS field_briefings_strategy_idx
  ON field_briefings (day DESC, field)
  WHERE strategy IS NOT NULL;

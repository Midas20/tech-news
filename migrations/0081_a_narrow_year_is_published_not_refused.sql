-- A narrow period is published with its narrowness attached, not refused.
--
-- 2026-09-10: "I think you didn't read all news in 10 years, so you don't
-- analysis news."
--
-- That was correct, and it was the right objection to make. 0080 added a guard
-- that refused any period whose three largest publishers held more than 60% of
-- it, and eight of the archive's ten years failed it. The refusal was decided
-- from an aggregate query. Not one of the 1,392 stories in those eight years was
-- read before the page was told to say they could not be.
--
-- THE GUARD MEASURED SOMETHING REAL AND THEN DID THE WRONG THING WITH IT. This
-- archive refuses a curve when a cohort break makes the number WRONG -- there is
-- no honest version of a comparison spanning a measurement change, so
-- `brokenCurves` withholds it. Narrow sourcing is not that. It makes a reading
-- PARTIAL, and partial is the condition every reading in this system is already
-- in: each one ends with `limits` describing what its evidence cannot settle,
-- and the 2026 reading's own limits say that 119 of its 120 stories are vendors
-- writing about themselves.
--
-- So the standard the eight refused years were held to was one no published
-- reading here has ever met. What the guard should produce is a label, not a
-- veto: read the years, and put on the page whose years they are.
--
-- These two columns are that label. They are stored rather than recomputed
-- because they describe the corpus the reading was ACTUALLY written from --
-- after diversification, after the month-stratified rotation -- and that corpus
-- does not exist any more once the reading is stored. Recomputing them from
-- today's stories would answer a different question, and would drift every time
-- retention deletes a month.

ALTER TABLE period_readings ADD COLUMN IF NOT EXISTS sources_read integer;

-- Percentage of the corpus held by its three largest publishers, 0-100.
ALTER TABLE period_readings ADD COLUMN IF NOT EXISTS top_share integer;

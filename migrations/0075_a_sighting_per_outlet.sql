-- One sighting per OUTLET, not per story.
--
-- 0074 keyed `emerging_sightings` on (slug, story_id), which quietly assumed one
-- story is one source. Deduplication makes that false, and it is false in
-- exactly the cases that matter most: `dedup` merges the same event from several
-- outlets into one canonical story and records the rest in `story_members`. So a
-- name carried by seven publications was recorded as having one source, and the
-- best-attested events in the archive scored lowest on the evidence gate.
--
-- Measured here on 2026-09-09: 139 stories carry more than one outlet, up to
-- seven. Small against 4,026 -- release feeds mostly publish alone -- but it is
-- the wrong 3.5%: multi-outlet coverage is the definition of corroboration and
-- the gate was blind to all of it.
--
-- The fix is the grain. (slug, story_id, source_id) lets one story contribute
-- one sighting per outlet that carried it, which is what the counts already
-- claimed to measure.
--
-- WHY NOT JOIN story_members AT READ TIME instead. Retention deletes it, and
-- these rows are analysis, which outlives the stories. A count that silently
-- shrinks four months later is worse than no count.

ALTER TABLE emerging_sightings DROP CONSTRAINT emerging_sightings_pkey;
ALTER TABLE emerging_sightings ADD PRIMARY KEY (slug, story_id, source_id);

-- Which outlet this row speaks for, when it is not the canonical story's own.
-- Kept so a sighting can say "InfoQ also carried this" rather than attributing
-- every outlet's coverage to whichever feed happened to be polled first.
ALTER TABLE emerging_sightings
  ADD COLUMN IF NOT EXISTS via text
  CHECK (via IS NULL OR via IN ('story', 'member'));

UPDATE emerging_sightings SET via = 'story' WHERE via IS NULL;

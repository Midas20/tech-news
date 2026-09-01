-- 0052: one line saying what a thing is, for a list row.
--
-- `entity_reference.summary` is Wikipedia's lead paragraph. It is the right
-- length for the top of a detail page and far too long for a row in a list of
-- sixty-five, where the reader is scanning rather than reading.
--
-- Wikidata carries a separate field for exactly this: a short description
-- written to disambiguate an item in a list. "app marketplace developed by
-- Apple". "software to manage containers on a server-cluster". One line, no
-- markup, already written by somebody, already licensed. It costs nothing extra
-- to collect -- the same wbgetentities call that fetches the claims returns it
-- when asked -- and it is stored separately rather than truncated out of the
-- summary, because the first sentence of a paragraph is not a description and
-- cutting one to length produces neither.

ALTER TABLE entity_reference
  ADD COLUMN IF NOT EXISTS short_description text;

COMMENT ON COLUMN entity_reference.short_description IS
  'Wikidata description: one line for a list row. Distinct from summary, which '
  'is Wikipedia lead prose for a detail page.';

-- Rows resolved before this column existed have a wikidata_id and no
-- description. The refresh job treats that as due rather than waiting out the
-- 90-day staleness window, so the archive fills itself in instead of needing a
-- backfill run by hand.
CREATE INDEX IF NOT EXISTS entity_reference_needs_description_idx
  ON entity_reference (subject_kind, subject_id)
  WHERE wikidata_id IS NOT NULL AND short_description IS NULL;

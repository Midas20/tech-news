-- 0029: tools are not stacks.
--
-- One registry answered two questions at once. "React" and "VS Code" are both
-- technologies, so both were rows in `stacks`, and a reader looking for what to
-- build on had to read past the editors to find them.
--
-- `category` cannot carry this. It says what a thing IS ABOUT -- ai, web, db --
-- and Claude and PyTorch are both `ai` while being opposite answers to "does
-- this ship in my product". So the split needs its own column.
--
--   stack    a dependency. It ships; remove it and the product stops.
--   tool     operated by a person. It never ships; remove it and work is slower.
--   concept  a practice, a field, or a node the tree hangs from. Nothing to install.
--
-- Defaulting to 'concept' rather than 'stack' is deliberate. An unclassified row
-- showing up among concepts is a shrug, which is what it is; the same row
-- appearing in a list of things you can build on would be a claim.

ALTER TABLE stacks
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'concept'
  CHECK (kind IN ('stack', 'tool', 'concept'));

-- Both registry pages filter on it and then sort, so it leads the index.
CREATE INDEX IF NOT EXISTS stacks_kind_idx ON stacks (kind, category);

COMMENT ON COLUMN stacks.kind IS
  'stack = ships with the product; tool = operated by a person; concept = nothing to install. '
  'Set by scripts/classify-kinds.ts, which is re-runnable and prints its reasoning.';

-- 0026: two more ways a name gets into the vocabulary.
--
-- 'linguist' is GitHub's language list, which is as close to authoritative as
-- "is this a programming language" gets. 'cncf' is the cloud native landscape,
-- which arrives already categorised and states a maturity level rather than
-- leaving it to be inferred.
--
-- Keeping every provenance distinct in one column is what lets the registry
-- answer "who decided this was a technology" -- and that question matters more
-- with every source added, not less.

ALTER TABLE stacks DROP CONSTRAINT IF EXISTS stacks_origin_check;
ALTER TABLE stacks ADD CONSTRAINT stacks_origin_check
  CHECK (origin IN ('seed', 'github_release', 'title', 'repo_link', 'topic_index',
                    'linguist', 'cncf', 'manual'));

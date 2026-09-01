-- 0027: one more provenance.
--
-- Libraries.io ranks packages by how many repositories DEPEND on them, which is
-- the only source here that measures use rather than fame. A library with 40,000
-- dependents is load-bearing whether or not anyone writes about it.

ALTER TABLE stacks DROP CONSTRAINT IF EXISTS stacks_origin_check;
ALTER TABLE stacks ADD CONSTRAINT stacks_origin_check
  CHECK (origin IN ('seed', 'github_release', 'title', 'repo_link', 'topic_index',
                    'linguist', 'cncf', 'libraries_io', 'manual'));

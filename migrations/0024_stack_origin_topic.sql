-- 0024: the vocabulary gained a third way in.
--
-- 'seed' was written by hand, 'github_release' was discovered from the archive,
-- and now 'topic_index' is imported from GitHub's curated topic list. Keeping
-- them apart in one column is what lets the registry answer "who decided this
-- was a technology" for every row -- which matters more the more of them arrive
-- without a person in the loop.

ALTER TABLE stacks DROP CONSTRAINT IF EXISTS stacks_origin_check;
ALTER TABLE stacks ADD CONSTRAINT stacks_origin_check
  CHECK (origin IN ('seed', 'github_release', 'title', 'repo_link', 'topic_index', 'manual'));

-- 0021: a vocabulary that grows.
--
-- The taxonomy was seeded by hand and then never moved, which makes it wrong a
-- little more each week: every technology released after the seed was written is
-- invisible to a system whose entire job is noticing new technologies.
--
-- The closed vocabulary is NOT the thing to give up. Free-text tags fragment
-- within a week (react / React / ReactJS) and break per-user filtering silently.
-- What has to change is who closes it: not a person editing a seed file, but a
-- discovery pass that proposes entries from evidence and promotes them when the
-- evidence is strong enough. Closed at tagging time, open at the edges.
--
-- Exactly the shape source_candidates already has for sources, for the same
-- reason: a proposal is not a fact, and the queue is where the difference lives.

CREATE TABLE IF NOT EXISTS stack_candidates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The normalised key. Two spellings of one thing must not queue twice.
  term              text NOT NULL UNIQUE,
  -- The spelling most often seen, which is what the entry gets named.
  display_name      text NOT NULL,
  -- Every spelling observed, so promotion can seed the aliases from evidence.
  variants          text[] NOT NULL DEFAULT '{}',
  origin            text NOT NULL CHECK (origin IN ('github_release', 'title', 'repo_link')),
  repo_url          text,
  release_feed_url  text,
  homepage_url      text,
  mention_count     int  NOT NULL DEFAULT 0,
  distinct_sources  int  NOT NULL DEFAULT 0,
  distinct_stories  int  NOT NULL DEFAULT 0,
  sample_urls       text[] NOT NULL DEFAULT '{}',
  -- The stacks most often tagged on the same stories: how category and parent
  -- are inferred without asking a model.
  co_stacks         text[] NOT NULL DEFAULT '{}',
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'promoted', 'rejected')),
  promoted_slug     text,
  evaluated_at      timestamptz,
  reason            text
);

CREATE INDEX IF NOT EXISTS stack_candidates_status_idx
  ON stack_candidates (status, mention_count DESC);
CREATE INDEX IF NOT EXISTS stack_candidates_seen_idx
  ON stack_candidates (last_seen_at DESC);

-- Where an entry came from, and when it arrived. `curated` already says whether
-- a human wrote it; this says how the rest got here, which is what makes the
-- registry page able to show the vocabulary growing rather than just being.
ALTER TABLE stacks ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'seed'
  CHECK (origin IN ('seed', 'github_release', 'title', 'repo_link', 'manual'));
ALTER TABLE stacks ADD COLUMN IF NOT EXISTS discovered_at timestamptz;

-- Deterministic tagging needs a progress marker of its own, for the same reason
-- company tagging needed one: a story with no technology in it stays eligible
-- forever otherwise, and the pass re-reads the same rows reporting zero.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS stacks_tagged_at timestamptz;

CREATE INDEX IF NOT EXISTS stories_stacks_untagged_idx
  ON stories (collected_at DESC) WHERE stacks_tagged_at IS NULL;

GRANT SELECT ON stack_candidates TO newstrack_app;
GRANT SELECT, INSERT, UPDATE ON stack_candidates TO newstrack_worker;

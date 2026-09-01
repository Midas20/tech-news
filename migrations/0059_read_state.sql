-- Which stories have been read.
--
-- The reader has had two per-story states -- favourited and dismissed -- and no
-- answer to the question a river actually raises, which is "where did I get
-- to". Without it every visit starts at the top and the only way to tell new
-- from seen is to remember.
--
-- A column on the story rather than a table, for the same reason `dismissed_at`
-- is: this archive has one reader. `favourites` is a table because a favourite
-- carries its own history -- when it was saved, when it was released, when it
-- lapses -- and a read mark carries nothing but the moment.
--
-- NOT a filter on what is collected, and not a kind of deletion. A read story
-- stays in every list, in place, marked. Hiding it would make the archive
-- disagree with itself between two visits, and "I read that" is not "I do not
-- want it" -- that is what the delete button is for.

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

COMMENT ON COLUMN stories.read_at IS
  'When the reader opened this story. Marks it seen; does not hide it.';

-- The unread count in the rail, and the unread filter, both ask the same
-- question of the newest end of the archive.
CREATE INDEX IF NOT EXISTS stories_unread
  ON stories (collected_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL AND superseded_by IS NULL;

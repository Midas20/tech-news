-- 325 release feeds, every one of them filed as news.
--
-- 2026-09-12, against "The news scope still low". The registry held 475 healthy
-- sources and 357 of them had never produced a single story. They were not
-- broken: they fetched every hour, succeeded, recorded no error, and stored
-- nothing. 323 of the 357 were refused for the same reason, `build:tag_page`,
-- most recently at 01:51 that morning.
--
-- `isBuildNoise` refuses a github.com/<owner>/<repo>/releases/tag/ address
-- because an aggregator posting one is a bot writing to a tag. It carries an
-- escape hatch for the case where the address is not evidence of anything --
-- a repository's own releases.atom, where EVERY entry has that shape by
-- construction -- and ingest asked for that hatch with `source.kind =
-- 'releases'`.
--
-- No row in this table has ever had kind = 'releases'. The enum has carried the
-- value since the schema was written; every seed script files its rows as
-- 'news'. So the hatch never opened once, and the finer rules that were meant
-- to do the actual judging -- prerelease suffixes, templated bodies, a bare
-- version with nothing to say -- never got to run at all.
--
-- THE CODE FIX IS THE REAL ONE, and it is in src/vocab/buildnoise.ts: ingest
-- now reads the feed's ADDRESS as well as this column, because an address is
-- what the feed is and a column is something somebody has to remember. This
-- migration makes the column honest as well, so that `kind` means what it says
-- when anything else reads it.

UPDATE sources
   SET kind = 'releases', updated_at = now()
 WHERE feed_url ~* '(^|/)(releases|tags)\.atom([?#]|$)'
    OR feed_url ~* '/releases\.rss([?#]|$)';

-- The refusals these feeds accumulated are an audit log, not a deferral: the
-- tag-page rule never wrote to `refused_items`, so nothing has to be released
-- from a waiting list. They are cleared only so the reject board shows what the
-- gate refuses NOW rather than what it refused while it was wrong.
DELETE FROM story_rejects WHERE category = 'build:tag_page';

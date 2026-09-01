-- 0030: 120 release feeds registered as news, with no history.
--
-- The registry holds 325 GitHub `releases.atom` feeds. 205 were seeded with
-- kind='releases' and backfill_provider='github_releases'; the other 120 arrived
-- with a later vocabulary import that set neither. Same URL shape, same thing on
-- the other end, three different consequences:
--
--   1. backfill_provider IS NULL, so they only ever take the current feed
--      window -- about ten releases -- instead of walking the GitHub API
--      backwards. The 205 that were configured correctly average 43 stories
--      each, reaching back to 2013. That is the difference between having a
--      year of history for a project and having a fortnight.
--   2. kind='news', so release notes were filed in the News stream and counted
--      as press coverage in every per-kind figure on the site.
--   3. All 120 sat at a 3600s interval behind the 30-minute tier, which is how
--      every one of them ended up in the never-fetched set (see 0029's sibling
--      change to the due-queue ordering).
--
-- Matched on the feed URL rather than by name, because the URL is what makes the
-- github_releases provider applicable: it needs owner/name, and it parses them
-- out of exactly this shape.

UPDATE sources
   SET kind = 'releases',
       backfill_provider = 'github_releases',
       backfill_depth = 'full',
       -- Releases are not breaking news. The correctly-configured 205 sit
       -- between 30 and 120 minutes; an hour is the middle of that and leaves
       -- these no hungrier than their peers.
       poll_interval_seconds = 3600,
       updated_at = now()
 WHERE feed_url LIKE '%github.com%releases.atom'
   AND backfill_provider IS NULL;

-- A source whose feed is a GitHub release atom and whose provider is NULL is
-- the bug above, and it will come back the next time an importer forgets. This
-- is the cheapest possible tripwire: a partial index that is only ever
-- populated by the mistake, so `SELECT count(*)` on it is the health check.
CREATE INDEX IF NOT EXISTS sources_unconfigured_release_feed_idx
    ON sources (id)
 WHERE feed_url LIKE '%github.com%releases.atom'
   AND backfill_provider IS NULL;

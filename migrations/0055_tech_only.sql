-- Which sources may publish articles.
--
-- The archive collects EVENTS -- launches, releases, changes, deprecations --
-- and refuses articles, because articles are 86% of what feeds publish and a
-- river of them buries the two classes a reader cannot afford to miss. That
-- rule is right about the press and wrong about a project writing about itself:
--
--   "What's New in WebGPU (Chrome 149-150)"     refused as an article
--   "What's new in DevTools (Chrome 149)"       refused as an article
--
-- Both are changes with a version attached, from the team that made them. 60 of
-- the 919 refusals in this archive name a version like that.
--
-- The distinction is not the sentence, it is the SOURCE. Some publish nothing
-- but technology: a project's own blog, a company's engineering channel, a
-- release feed. Everything they write is about a stack, so an article from one
-- is worth having even when it is not shaped like an announcement. Others cover
-- an industry -- funding, lawsuits, breaches, conference keynotes -- and for
-- those the event test is the only thing keeping the archive on subject.
--
-- So this is a property of the source, set once and visible on /sources, rather
-- than a cleverer classifier. It is not a blanket pass: the OFF-TOPIC gate
-- still applies to every source, so a tech-only source blogging about its
-- hiring is still refused.
--
-- Backfilled from the PRIMARY role, which already draws exactly this line. It
-- is true of all 362 release feeds and 50 first-party blogs, and false of the
-- three press outlets in the registry -- InfoQ, The New Stack, The Register --
-- which are the ones that write about the industry as an industry.

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS tech_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sources.tech_only IS
  'Everything this source publishes is about technology, so its articles are '
  'kept as well as its announcements. The off-topic gate still applies.';

UPDATE sources SET tech_only = true
 WHERE 'PRIMARY' = ANY(roles);

-- A company's own channel is tech-only by construction, and it is the case the
-- role check would miss if a channel were ever seeded without PRIMARY.
UPDATE sources SET tech_only = true
 WHERE company_slug IS NOT NULL;

-- 0050: the platform registry becomes what the site always said it was.
--
-- `platforms` held 56 EARNING channels -- freelance marketplaces, bounties,
-- stock media, creator tips -- seeded for a Phase 7 feature that was never
-- built. The rail meanwhile said "Platforms are where a thing runs or is sold",
-- which described a different registry entirely, and the two had been wearing
-- one name since the schema was written.
--
-- Not one of those 56 was tagged on a single live story, which is the measurable
-- version of the same observation: the technology press does not write about
-- payout thresholds. The new registry is clouds, package registries, stores,
-- model hosts, CI and managed data -- the places the sources in this archive
-- actually write about. See seeds/platforms.ts.
--
-- RETIRED, NOT DELETED.
--
-- `platform_month` holds 85 rows of rollup history across 24 slugs, keyed by
-- slug as text rather than by a foreign key. Deleting the platforms would leave
-- that history pointing at nothing -- no error, no constraint violation, just
-- months of counts about rows that no longer exist. `platform_facts`,
-- `platform_signals` and `page_watches` all reference platforms.id directly and
-- would refuse, which is the same objection stated louder.
--
-- So the old rows keep their slug, their name and their URL, and stop being
-- listed. Anything that already pointed at them still resolves.

ALTER TABLE platforms
  ADD COLUMN IF NOT EXISTS retired_at timestamptz;

COMMENT ON COLUMN platforms.retired_at IS
  'Set when a platform leaves the registry. The row is kept so history that '
  'references it still resolves; the listings hide it.';

-- Everything in an earning channel. Named explicitly rather than "everything not
-- in the new list", so re-running this after the new registry is seeded cannot
-- retire the new rows.
UPDATE platforms
   SET retired_at = now(), updated_at = now()
 WHERE retired_at IS NULL
   AND channel_type_id IN (
     'freelance', 'content', 'creator', 'digital-goods', 'bounty',
     'stock', 'education', 'affiliate', 'compute')
   -- Two of them are moving to the new registry rather than leaving it: the
   -- App Store and the Chrome Web Store are app stores in both readings, and
   -- keeping the slug keeps whatever has already been collected about them.
   AND slug NOT IN ('app-store', 'chrome-web-store');

CREATE INDEX IF NOT EXISTS platforms_live_idx
  ON platforms (name) WHERE retired_at IS NULL;

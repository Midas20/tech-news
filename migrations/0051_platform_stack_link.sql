-- 0051: a platform page reads the technology's stories rather than its own.
--
-- The platform tagger has a collision rule: where a name is both a technology
-- and a platform, the technology wins, because that is what a technology archive
-- is mostly about and the stack tagger already claims it correctly. That rule is
-- right, and after the registry became clouds and registries it excluded 32 of
-- the 65 names -- Cloudflare, Vercel, npm, PyPI, Supabase, GitHub Actions, every
-- one of the platforms anybody would actually open.
--
-- Re-tagging the archive against the new registry was measured before being
-- done, and it was not done. Across 550 live stories it would have produced NINE
-- tags, of which most were wrong: "USN-8658-3: Linux kernel vulnerabilities"
-- matched Azure and AWS, because Ubuntu ships kernel variants called linux-azure
-- and linux-aws. Nine mostly-wrong tags is a worse archive, not a fuller one.
--
-- The stories exist. They are tagged to the TECHNOLOGY of the same name --
-- Cloudflare 60, Azure 55, AWS 20, Google Cloud 18 -- by a tagger that has been
-- getting this right all along. So the platform page reads through to it instead
-- of competing with it.
--
-- The mapping is stored rather than resolved by name at query time. Name
-- matching found it, but 'google-cloud' maps to 'gcp' and 'pypi' to 'pip', so
-- the relationship is not derivable from the slug and belongs in a column that
-- can be corrected by hand when it is wrong.

ALTER TABLE platforms
  ADD COLUMN IF NOT EXISTS stack_slug text;

COMMENT ON COLUMN platforms.stack_slug IS
  'The technology this platform is, where it is also one. The platform page '
  'reads stories through this rather than tagging platforms separately.';

-- Written as a correlated scalar subquery, not UPDATE ... FROM LATERAL: the
-- lateral cannot see the UPDATE target, and Postgres says so ("invalid reference
-- to FROM-clause entry for table p") rather than quietly matching nothing.
UPDATE platforms p SET stack_slug = (
    SELECT st.slug
      FROM stacks st
     WHERE lower(st.name) = lower(p.name)
        OR st.slug = p.slug
        OR lower(p.name) = ANY (SELECT lower(a) FROM unnest(st.aliases) a)
     -- A name can hit more than one vocabulary entry. Prefer the curated one,
     -- then the one the archive has actually seen, then the shortest slug --
     -- which is the general entry rather than a variant of it.
     ORDER BY st.curated DESC,
              (SELECT count(*) FROM stories s
                WHERE s.superseded_by IS NULL AND s.stacks && ARRAY[st.slug]) DESC,
              length(st.slug)
     LIMIT 1
  ), updated_at = now()
 WHERE p.retired_at IS NULL AND p.stack_slug IS NULL;

CREATE INDEX IF NOT EXISTS platforms_stack_slug_idx
  ON platforms (stack_slug) WHERE stack_slug IS NOT NULL;

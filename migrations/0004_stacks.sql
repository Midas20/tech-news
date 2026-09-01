-- 0004: the closed taxonomy. Free-text stack tags fragment within a week
-- (react / React / ReactJS / react.js) and silently break per-user filtering.

CREATE TABLE IF NOT EXISTS stacks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  name              text NOT NULL,
  parent_id         uuid REFERENCES stacks(id),
  aliases           text[] NOT NULL DEFAULT '{}',
  category          text NOT NULL CHECK (category IN
                    ('language','framework','library','runtime','db','infra','cloud',
                     'devops','ai','security','web','mobile','data','hardware',
                     'os','protocol','tooling','practice','domain')),
  description       text,
  docs_url          text,
  repo_url          text,
  homepage_url      text,
  changelog_url     text,
  release_feed_url  text,
  first_release     date,
  current_status    text NOT NULL DEFAULT 'active'
                    CHECK (current_status IN ('active','maintenance','deprecated','unknown')),
  curated           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stack_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS stacks_parent_idx ON stacks (parent_id);
CREATE INDEX IF NOT EXISTS stacks_alias_idx  ON stacks USING gin (aliases);
CREATE INDEX IF NOT EXISTS stacks_name_trgm  ON stacks USING gin (name gin_trgm_ops);
CREATE TRIGGER stacks_updated BEFORE UPDATE ON stacks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Alias to slug lookup, used to validate every model-returned field. A field the
-- model invents resolves to nothing and is discarded rather than stored.
CREATE OR REPLACE VIEW stack_alias_lookup AS
  SELECT lower(a) AS alias, s.slug, s.id
  FROM stacks s, LATERAL unnest(s.aliases || ARRAY[s.slug, s.name]) AS a;

-- Descendants of a stack. Following "frontend" must return React news;
-- following "react" must not return Vue news (spec 1.4).
CREATE OR REPLACE FUNCTION stack_descendants(root_slug text)
RETURNS TABLE (slug text) LANGUAGE sql STABLE AS $fn$
  WITH RECURSIVE tree AS (
    SELECT id, slug FROM stacks WHERE slug = root_slug
    UNION ALL
    SELECT s.id, s.slug FROM stacks s JOIN tree t ON s.parent_id = t.id
  )
  SELECT slug FROM tree
$fn$;

CREATE OR REPLACE FUNCTION stack_expand(roots text[])
RETURNS text[] LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(DISTINCT d.slug), '{}')
  FROM unnest(roots) r, LATERAL stack_descendants(r) d
$fn$;

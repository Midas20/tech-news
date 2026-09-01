-- 0015: companies as a first-class dimension.
--
-- Two distinct things get conflated if this is not modelled: what a company
-- SAYS about itself, and what is written ABOUT it. A vendor's own release notes
-- and its newsroom are primary sources -- authoritative on fact, useless on
-- judgement. Third-party coverage is the opposite. Keeping them apart is the
-- difference between "AWS announced X" and "AWS is reported to be doing X", and
-- a reader needs to see which is which without clicking through.
--
-- So a story carries companies[] regardless of who published it, and the
-- FIRST-PARTY relationship lives on the source: sources.company_slug says "this
-- feed belongs to that company", which is what makes an announcement an
-- announcement.

CREATE TABLE IF NOT EXISTS companies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  aliases       text[] NOT NULL DEFAULT '{}',
  category      text NOT NULL DEFAULT 'vendor'
                CHECK (category IN ('hyperscaler','vendor','ai-lab','chipmaker','platform',
                                    'security','database','startup','foundation','telecom')),
  country       text,
  ticker        text,
  homepage_url  text,
  newsroom_url  text,
  blog_url      text,
  status_url    text,
  github_org    text,
  stacks        text[] NOT NULL DEFAULT '{}',   -- technologies it is known for
  curated       boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS companies_alias_idx ON companies USING gin (aliases);
CREATE INDEX IF NOT EXISTS companies_name_trgm ON companies USING gin (name gin_trgm_ops);
CREATE TRIGGER companies_updated BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Alias -> slug, the same closed-vocabulary discipline the stacks use. A company
-- name the model invents resolves to nothing and is discarded.
CREATE OR REPLACE VIEW company_alias_lookup AS
  SELECT lower(a) AS alias, c.slug, c.id
  FROM companies c, LATERAL unnest(c.aliases || ARRAY[c.slug, c.name]) AS a;

-- First-party: this feed IS the company speaking.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS company_slug text REFERENCES companies(slug);
CREATE INDEX IF NOT EXISTS sources_company_idx ON sources (company_slug)
  WHERE company_slug IS NOT NULL;

-- Which companies a story is about, whoever published it.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS companies text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS stories_companies_idx ON stories USING gin (companies);

-- An announcement is a story published BY one of the companies it is about.
-- Derived at read time from the source, never stored twice.
CREATE OR REPLACE VIEW company_stories AS
  SELECT s.id, s.collected_at, s.published_at, s.canonical_url, s.title_original,
         s.title_en, s.summary_en, s.importance, s.coverage_count, s.stacks,
         s.companies, s.superseded_by, s.source_id,
         src.name AS source_name, src.company_slug AS published_by,
         (src.company_slug IS NOT NULL AND src.company_slug = ANY(s.companies)) AS is_announcement
    FROM stories s JOIN sources src ON src.id = s.source_id;

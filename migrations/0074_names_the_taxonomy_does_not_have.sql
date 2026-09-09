-- A ledger for names nobody has heard of yet.
--
-- Asked for on 2026-09-09: "The purpose of the project is to find new market
-- that will appear in short period, But currently the project can't enough
-- report that can find new market and tool and platform."
--
-- MEASURED, BEFORE BUILDING ANYTHING. Every headline in that morning's four
-- briefings named an incumbent -- AWS, Microsoft, Databricks, Amazon. The
-- genuinely new things were all present, and all of them were in `watch`, the
-- footnote at the bottom of the page:
--
--   Booley, an open-source IDE for agentic chip design in SystemVerilog
--   aic-agent 1.0.2, shell access and task planning
--   scigantic-surechembl 0.3.0
--   PocketBase Cloud
--
-- The system was FINDING new tools and then throwing them away. Three reasons,
-- and this migration addresses the second and third:
--
--   1. The briefing prompt ranks by importance -- "the single most important
--      thing that happened". A new market has no big actor yet, by definition,
--      so it can never win that ranking against a hyperscaler.
--
--   2. THE TAXONOMY IS CLOSED. `stacks` has 2,460 rows and a story is tagged by
--      matching against them. A tool that is not one of them gets no row, no
--      page, no trend line; "Booley" was a substring of a JSON blob and nothing
--      else. A closed vocabulary is exactly the wrong instrument for finding
--      what is not in it yet.
--
--   3. NOTHING TRACKED A NAME ACROSS DAYS. A new market IS "a name that keeps
--      coming back from unrelated sources". Without somewhere to write the
--      first sighting down, the third sighting looks exactly like the first.
--
-- WHAT THIS IS NOT. It is not a popularity table. `sightings`, `sources` and
-- `independent_sources` count OUR OWN COLLECTION, which measures the feed list
-- and not the industry -- the same mistake the whole content-v2 rewrite exists
-- to prevent. They are here as an EVIDENCE GATE and nothing else: two unrelated
-- sources is the line at which a name stops being one vendor's press release
-- and becomes something worth showing a reader. Nothing may rank markets by
-- them, and nothing may render them as a size. Magnitudes still come only from
-- the public figures in `stack_adoption`.

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS emerging (
  slug          text PRIMARY KEY,
  -- As it was written. `slug` folds case and punctuation so that "LangGraph",
  -- "langgraph" and "Lang Graph" are one row; `name` keeps the spelling a
  -- reader would recognise.
  name          text NOT NULL,
  kind          text NOT NULL
                CHECK (kind IN ('tool','platform','model','company','standard','format')),
  -- One line on what it claims to do, in the words of the story that
  -- introduced it. This is the difference between a name and a market: "Booley"
  -- means nothing, "an open-source IDE for agentic chip design" is a category
  -- that either exists or does not.
  what          text,
  fields        text[] NOT NULL DEFAULT '{}',

  first_seen_at timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,

  -- The evidence gate. See the note above: these are not a measure of anything
  -- outside this archive.
  sightings           integer NOT NULL DEFAULT 0,
  sources             integer NOT NULL DEFAULT 0,
  independent_sources integer NOT NULL DEFAULT 0,

  --   candidate  seen once, or only from parties describing themselves
  --   tracked    corroborated by two unrelated sources; shown to readers
  --   known      it turned out to be in the taxonomy after all, or became so
  --   rejected   a false positive: a person, a place, a common noun
  status        text NOT NULL DEFAULT 'candidate'
                CHECK (status IN ('candidate','tracked','known','rejected')),
  -- Set when a tracked name graduates into `stacks` and stops being news.
  promoted_to   text,
  why_rejected  text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The reader's query: what is new, newest first, corroborated only.
CREATE INDEX IF NOT EXISTS emerging_new_idx
  ON emerging (status, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS emerging_fields_idx
  ON emerging USING gin (fields);
-- For the promotion sweep, which asks only about the gate.
CREATE INDEX IF NOT EXISTS emerging_gate_idx
  ON emerging (independent_sources, status);

-- ---------------------------------------------------------------------------
-- Where each sighting came from
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS emerging_sightings (
  slug        text NOT NULL REFERENCES emerging(slug) ON DELETE CASCADE,
  story_id    uuid NOT NULL,
  source_id   uuid NOT NULL REFERENCES sources(id),

  -- THE CITATION IS COPIED, NOT REFERENCED, AND THAT IS DELIBERATE.
  --
  -- Retention deletes stories after the window; analysis outlives them. A
  -- sighting that held only a story_id would become an unciteable claim the
  -- moment its story was pruned -- which is precisely when the ledger is most
  -- useful, because a name first seen four months ago and still appearing is
  -- the strongest signal this table can carry. So the title, the URL and the
  -- sentence that mentioned it are written down here. No foreign key to
  -- `stories` for the same reason.
  story_title text,
  url         text,
  quote       text,

  field       text,
  -- From sources.source_type via the ladder in src/vocab/intel.ts. A vendor
  -- describing its own product is authoritative about what shipped and worth
  -- nothing as corroboration that anyone else cares.
  independent boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  seen_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (slug, story_id)
);

CREATE INDEX IF NOT EXISTS emerging_sightings_slug_idx
  ON emerging_sightings (slug, published_at DESC);

-- ---------------------------------------------------------------------------
-- Which stories have been read for names
-- ---------------------------------------------------------------------------

-- Same shape as stacks_tagged_at / companies_tagged_at / platforms_tagged_at:
-- a null means "never offered to the extractor", which is what the batch query
-- selects on. A story that yielded no new names still gets stamped, or every
-- pass would re-read the same stories that have nothing in them.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS entities_scanned_at timestamptz;

CREATE INDEX IF NOT EXISTS stories_entities_pending_idx
  ON stories (collected_at)
  WHERE entities_scanned_at IS NULL;

-- ---------------------------------------------------------------------------
-- Grants, matching migration 0010's two runtime roles
-- ---------------------------------------------------------------------------

-- The collector writes the ledger; the reader reads it. Neither is the owner.
GRANT SELECT, INSERT, UPDATE ON emerging, emerging_sightings TO newstrack_worker;
GRANT SELECT ON emerging, emerging_sightings TO newstrack_app;

-- 0049: what a technology IS, as opposed to what happened to it lately.
--
-- A technology page could say how often it had been in the news and how many
-- projects carry its topic, and nothing at all about the thing itself: what it
-- is for, who makes it, when it appeared, what licence it carries. A reader
-- who has just met the name learns nothing from a story count.
--
-- WHERE THE FACTS COME FROM, AND WHY NOT A MODEL
--
-- Wikidata for the structured claims and Wikipedia for the prose. A model could
-- write a fluent paragraph about any of these 2,330 technologies without
-- consulting anything, and some of those paragraphs would be wrong in ways no
-- reader could detect. This archive already refuses that trade elsewhere -- see
-- the note in 0008 about a plausible wrong URL being worse than a gap -- and a
-- fabricated history is the same failure with better prose.
--
-- So every row here is a copy of something somebody else published, carrying
-- the URL it came from. `summary` is Wikipedia text under CC BY-SA 4.0, which
-- is why `source_url` and `source_license` are NOT NULL when it is present:
-- the licence requires attribution, and attribution requires the link.
--
-- RESOLUTION IS THE DANGEROUS PART
--
-- "Rust" is a video game, a fungal disease, and a programming language, and a
-- name search returns the game. A wrong match here would put a confident,
-- sourced, entirely irrelevant paragraph on a technology page, which is worse
-- than the blank it replaced. So a candidate is accepted only when something
-- CONFIRMS it beyond the name:
--
--   strong  the item's source-code repository or official website matches the
--           one already recorded here
--   typed   the item is an instance of a technology type we recognise
--
-- Anything else is recorded as unresolved, with the candidate that was rejected
-- and why. `confidence` says which of those two it was, so the page can treat
-- them differently and a later pass can revisit the weaker ones.

CREATE TABLE IF NOT EXISTS entity_reference (
  -- 'stack' covers stacks, tools and concepts: they are one table with a kind.
  subject_kind    text NOT NULL CHECK (subject_kind IN ('stack', 'platform')),
  subject_id      uuid NOT NULL,

  wikidata_id     text,
  wikipedia_title text,

  -- The background paragraph. Wikipedia's lead, which is the section written to
  -- answer "what is this" for somebody who has just arrived.
  summary         text,
  -- Who makes it. Free text rather than a companies.id: Wikidata names
  -- organisations this archive has never heard of, and dropping the fact
  -- because the company is not in a 76-row table would be the wrong trade. The
  -- UI links it up when the name does match.
  developer       text,
  developer_qid   text,
  inception       date,
  license         text,
  written_in      text[],
  latest_version  text,
  official_url    text,

  source_url      text,
  source_license  text,
  -- 'repo' and 'website' were confirmed against a URL already held here;
  -- 'typed' was confirmed only by the kind of thing Wikidata says it is.
  confidence      text CHECK (confidence IN ('repo', 'website', 'typed')),

  checked_at      timestamptz,
  failed_at       timestamptz,
  failures        integer NOT NULL DEFAULT 0,
  -- Why no match was accepted, including the candidate that was rejected. A
  -- gap that cannot explain itself gets re-investigated by hand forever.
  note            text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (subject_kind, subject_id),

  -- Attribution is not optional for CC BY-SA text, so the schema will not hold
  -- a summary that cannot say where it came from.
  CONSTRAINT entity_reference_attributed
    CHECK (summary IS NULL OR (source_url IS NOT NULL AND source_license IS NOT NULL))
);

-- The refresh job takes the least recently checked slice.
CREATE INDEX IF NOT EXISTS entity_reference_due_idx
  ON entity_reference (checked_at ASC NULLS FIRST);

DROP TRIGGER IF EXISTS entity_reference_updated ON entity_reference;
CREATE TRIGGER entity_reference_updated BEFORE UPDATE ON entity_reference
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT ON entity_reference TO newstrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_reference TO newstrack_worker;

-- 0008: tools and earning-platform registries (Phase 7 tables, defined now so the
-- schema is coherent and the collector can start accumulating signals early).

CREATE TABLE IF NOT EXISTS tools (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE,
  name           text NOT NULL,
  category       text NOT NULL,
  stack_slug     text REFERENCES stacks(slug),
  repo_url       text,
  changelog_url  text,
  homepage_url   text,
  description    text,
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','maintenance','deprecated','abandoned','unknown')),
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Accumulating dated experience. observed_at is mandatory because claims decay:
-- an account of a 2023 signup flow may describe something that no longer exists.
CREATE TABLE IF NOT EXISTS tool_signals (
  id            bigserial PRIMARY KEY,
  tool_id       uuid NOT NULL REFERENCES tools(id),
  aspect        text NOT NULL,
  sentiment     numeric(3,2) NOT NULL CHECK (sentiment BETWEEN -1 AND 1),
  claim         text NOT NULL,
  source_url    text NOT NULL,
  source_id     uuid REFERENCES sources(id),
  trust_weight  numeric(3,2) NOT NULL CHECK (trust_weight BETWEEN 0 AND 1),
  observed_at   timestamptz NOT NULL,
  extracted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tool_id, aspect, source_url)
);

CREATE INDEX IF NOT EXISTS tool_signals_tool_idx ON tool_signals (tool_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS platforms (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  channel_type_id       text,           -- FK into the existing 68-channel earning taxonomy
  url                   text NOT NULL,
  country_restrictions  text[] NOT NULL DEFAULT '{}',
  async_only            boolean,        -- does any stage require a call or video?
  time_to_first_dollar  int,            -- days, estimated
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','restricted','closed','unknown')),
  fact_pages            text[] NOT NULL DEFAULT '{}',  -- help pages diffed weekly (spec 9.3)
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Facts have validity windows. A fee change inserts a new row and closes the
-- previous one; the change itself is a deliverable event.
CREATE TABLE IF NOT EXISTS platform_facts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id    uuid NOT NULL REFERENCES platforms(id),
  stage          platform_stage NOT NULL,
  attribute      text NOT NULL,
  value          text NOT NULL,
  source_url     text NOT NULL,
  source_type    fact_source_type NOT NULL,
  confidence     numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  superseded_by  uuid REFERENCES platform_facts(id),
  captured_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_facts_current_idx
  ON platform_facts (platform_id, stage, attribute) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS platform_signals (
  id            bigserial PRIMARY KEY,
  platform_id   uuid NOT NULL REFERENCES platforms(id),
  stage         platform_stage NOT NULL,
  sentiment     numeric(3,2) NOT NULL CHECK (sentiment BETWEEN -1 AND 1),
  claim         text NOT NULL,
  source_url    text NOT NULL,
  trust_weight  numeric(3,2) NOT NULL CHECK (trust_weight BETWEEN 0 AND 1),
  observed_at   timestamptz NOT NULL,
  extracted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_id, stage, source_url)
);

-- Weekly diff of known help pages. No feed exists for "our fee structure changed".
CREATE TABLE IF NOT EXISTS page_watches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id   uuid REFERENCES platforms(id),
  tool_id       uuid REFERENCES tools(id),
  url           text NOT NULL UNIQUE,
  selector      text,
  last_hash     bytea,
  last_text     text,
  last_checked  timestamptz,
  last_changed  timestamptz,
  CONSTRAINT page_watch_has_owner CHECK (platform_id IS NOT NULL OR tool_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS page_diffs (
  id           bigserial PRIMARY KEY,
  watch_id     uuid NOT NULL REFERENCES page_watches(id),
  diff         text NOT NULL,
  detected_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TRIGGER tools_updated     BEFORE UPDATE ON tools     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER platforms_updated BEFORE UPDATE ON platforms FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER platform_facts_no_delete BEFORE DELETE ON platform_facts
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();

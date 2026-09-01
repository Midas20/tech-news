-- A source is not one number.
--
-- The registry has carried `trust_weight` since the beginning: one float, doing
-- the work of authority, technical depth, market relevance and signal density
-- at once. It cannot answer the question this platform exists to ask. Reuters
-- Technology and a Kubernetes operator's blog can hold the same trust_weight
-- and mean completely different things, and the ranking has no way to say so.
--
-- Split into three kinds of column, and THE SPLIT IS BY WHERE THE VALUE CAME
-- FROM, not by what it describes. This is the important part of this migration
-- and the reason it is a schema change rather than a scoring change:
--
--   DECLARED  a checkable fact about the organisation. source_type, country,
--             region, language, categories, whether it publishes a feed. Being
--             wrong about one of these is FALSIFIABLE -- somebody can look.
--
--   MEASURED  computed from this archive's own history, never typed in by
--             anyone. Signal density, originality, duplicate rate, freshness,
--             availability. Lives in source_metrics, one row per source per
--             window, because "track historical performance" means keeping the
--             history rather than overwriting a column every night.
--
--   PRIOR     an editorial judgement that cannot be derived from the archive:
--             authority, and technical expertise. Stored WITH its reason and
--             its date, and rendered differently from a measurement, because a
--             prior and a measurement shown in the same typeface is a lie.
--
-- Everything not yet known is NULL, and NULL means UNKNOWN rather than zero.
-- A source with no measurements is not a bad source; it is an unmeasured one,
-- and the composite score refuses to invent a number for it.
--
-- What this migration deliberately does NOT do: it adds no way to delete,
-- pause, or retire a source. Degradation changes priority and weight. The
-- history stays, because a source going quiet is itself a signal and deleting
-- the row is how you lose it.

-- ---------------------------------------------------------------------------
-- DECLARED
-- ---------------------------------------------------------------------------

-- What kind of claim this source is able to make. The distinction that matters
-- is epistemic, not topical: "Microsoft announced X", "journalists report X",
-- "developers are adopting X" and "companies are hiring for X" are four
-- different kinds of evidence, and a system that cannot tell them apart will
-- read a press release as market confirmation.
CREATE TYPE source_type AS ENUM (
  'PRIMARY_GOVERNMENT',
  'PRIMARY_VENDOR',
  'PRIMARY_PROJECT',
  'PRIMARY_RESEARCH',
  'MAJOR_JOURNALISM',
  'TECHNICAL_JOURNALISM',
  'SPECIALIST_PUBLICATION',
  'REGIONAL_PUBLICATION',
  'COMMUNITY',
  'RESEARCH',
  'MARKET_ANALYSIS',
  'DISCOVERY'
);

-- Where a source is in its life, which is not the same as whether it is
-- reachable. `health` answers "did the last fetch work"; this answers "do we
-- trust what comes out of it". A source can be healthy and REJECTED.
CREATE TYPE source_status AS ENUM (
  'DISCOVERED',
  'EVALUATING',
  'APPROVED',
  'MONITORING',
  'LOW_PRIORITY',
  'SUSPENDED',
  'REJECTED'
);

ALTER TABLE sources
  -- NULL until somebody or something can show what it is. There are 308 rows
  -- here and no honest way to classify all of them in one pass.
  ADD COLUMN source_type source_type,
  ADD COLUMN status source_status NOT NULL DEFAULT 'APPROVED',
  -- Beats (Category A-J). Many per source: Ars Technica is both major
  -- journalism and technical journalism, and forcing a choice loses that.
  ADD COLUMN categories text[] NOT NULL DEFAULT '{}',
  -- Technology domains covered. Separate from `fields`, which is the READER's
  -- taxonomy of stack roots; this is what the source is ABOUT.
  ADD COLUMN tech_domains text[] NOT NULL DEFAULT '{}',
  ADD COLUMN region text,
  ADD COLUMN api_url text,
  -- How it got here: 'seed', 'candidates', 'vocabulary', 'hand'. Discovery
  -- method is evidence about a source, not trivia -- a domain found in an
  -- outbound link and one that IS a tracked vocabulary entry arrived with
  -- different amounts of prior justification.
  ADD COLUMN discovery_method text,
  ADD COLUMN inclusion_reason text,
  ADD COLUMN exclusion_reason text,
  ADD COLUMN last_evaluated_at timestamptz,

  -- PRIOR. Two of them, and only two: these are the dimensions that cannot be
  -- computed from what this archive has seen. Every other score in the spec is
  -- measurable and therefore is not stored here.
  ADD COLUMN authority_score smallint,
  ADD COLUMN expertise_score smallint,
  ADD COLUMN prior_reason text,
  ADD COLUMN prior_set_at timestamptz,

  -- Composite, recomputed by the `evaluate` job. Cached for ordering only; the
  -- dimensions it came from stay visible, which is the whole point.
  ADD COLUMN overall_score smallint,

  ADD CONSTRAINT sources_authority_range
    CHECK (authority_score IS NULL OR authority_score BETWEEN 0 AND 100),
  ADD CONSTRAINT sources_expertise_range
    CHECK (expertise_score IS NULL OR expertise_score BETWEEN 0 AND 100),
  ADD CONSTRAINT sources_overall_range
    CHECK (overall_score IS NULL OR overall_score BETWEEN 0 AND 100),
  -- A prior without a reason is a number somebody made up. The constraint is
  -- what stops that from being possible rather than merely discouraged.
  ADD CONSTRAINT sources_prior_needs_reason
    CHECK ((authority_score IS NULL AND expertise_score IS NULL)
           OR (prior_reason IS NOT NULL AND prior_set_at IS NOT NULL));

COMMENT ON COLUMN sources.source_type IS
  'DECLARED. What kind of claim this source can make. NULL = not yet classified.';
COMMENT ON COLUMN sources.authority_score IS
  'PRIOR, not a measurement. Requires prior_reason. Render differently from measured scores.';
COMMENT ON COLUMN sources.overall_score IS
  'Cached composite from source_metrics + priors. Ordering only; never gates admission.';

CREATE INDEX sources_status_idx ON sources (status) WHERE status <> 'APPROVED';
CREATE INDEX sources_type_idx ON sources (source_type);
CREATE INDEX sources_categories_idx ON sources USING gin (categories);
CREATE INDEX sources_domains_idx ON sources USING gin (tech_domains);

-- ---------------------------------------------------------------------------
-- MEASURED
-- ---------------------------------------------------------------------------

-- One row per source per evaluation window. Kept rather than overwritten:
-- "source quality is not permanently fixed" only means something if last
-- month's number is still there to compare against.
--
-- Every score here is NULL when its input is absent. A source with four
-- stories has no meaningful duplicate rate and says so.
CREATE TABLE source_metrics (
  source_id       uuid        NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  -- The window this row describes, by its last day. Daily rows, 90-day window.
  window_end      date        NOT NULL,
  window_days     smallint    NOT NULL,

  stories         integer     NOT NULL,
  -- Of items the feed offered, how many became stories. The spec's signal
  -- density: NOT volume. A source publishing 100 low-value articles a day is
  -- worse than one publishing 10 useful ones, and this is the number that says
  -- so.
  signal_density  smallint,
  noise_score     smallint,
  -- Share that were the FIRST report of their event rather than a later one.
  -- Requires more than one source to have covered it, which is why this is
  -- mostly NULL today and why that is worth knowing.
  originality     smallint,
  duplicate_rate  smallint,
  -- Median hours from publication to collection, over rows published INSIDE
  -- the window. Backfilled history is excluded: including it measured a lag of
  -- 13,086 hours for Vercel, which is a statement about an import, not a feed.
  freshness       smallint,
  -- Share of stories that attached to a tracked stack, platform or company.
  -- This is market relevance measured against THIS platform's purpose rather
  -- than against the source's reputation.
  market_relevance   smallint,
  developer_relevance smallint,
  enterprise_relevance smallint,
  early_signal    smallint,
  -- Fetches that succeeded, from the poller's own record.
  availability    smallint,
  -- How often another source independently reported the same event.
  confirmations   integer     NOT NULL DEFAULT 0,

  computed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, window_end, window_days)
);

COMMENT ON TABLE source_metrics IS
  'MEASURED dimensions, computed from the archive by the `evaluate` job. Never hand-entered. '
  'NULL means not enough evidence, never zero.';

CREATE INDEX source_metrics_recent_idx ON source_metrics (window_end DESC, source_id);

-- ---------------------------------------------------------------------------
-- RELATIONSHIPS
-- ---------------------------------------------------------------------------

-- Reuters reports; twenty sites reproduce it. That is ONE event and one
-- confirmation, not twenty, and the difference between "cites" and
-- "independent" is the difference between reach and evidence.
CREATE TYPE source_relation AS ENUM ('syndicates', 'cites', 'summarises', 'owns');

CREATE TABLE source_links (
  from_source uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  to_source   uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  relation    source_relation NOT NULL,
  -- How many times the archive has actually seen this happen. Evidence for the
  -- relationship, not an assertion about it.
  observed    integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_source, to_source, relation),
  CHECK (from_source <> to_source)
);

COMMENT ON TABLE source_links IS
  'Observed relationships between sources. Used to stop syndicated copies counting '
  'as independent confirmation.';

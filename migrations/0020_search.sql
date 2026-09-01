-- 0020: make search a search.
--
-- Text matching was ILIKE '%term%' against the title. That is substring
-- matching, not search: "rust async runtime" matches nothing unless those three
-- words appear in exactly that order, "vacuuming" never finds "vacuum", and
-- there is no ranking at all -- results came back in collection order, so the
-- best match was wherever it happened to fall.
--
-- Full text search fixes all three: stemming, word order independence, and
-- ts_rank to put the best match first. The index is an EXPRESSION index rather
-- than a stored tsvector column, because a generated column on a partitioned
-- table has to be added to every partition and to every partition created
-- afterwards, and this expression is immutable so an index over it is exact.

CREATE INDEX IF NOT EXISTS stories_fts_idx ON stories USING gin (
  to_tsvector('english',
    coalesce(title_en, title_original) || ' ' || coalesce(summary_en, ''))
);

-- Fuzzy fallback, for the queries full text search cannot help with: a
-- misspelling, or a product name English stemming has never heard of.
CREATE INDEX IF NOT EXISTS stories_title_trgm_idx ON stories USING gin (
  coalesce(title_en, title_original) gin_trgm_ops
);

-- Entities are searched by name too, and "did you mean" is only useful if it can
-- rank by similarity cheaply.
CREATE INDEX IF NOT EXISTS sources_name_trgm_idx ON sources USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS companies_name_trgm_idx ON companies USING gin (name gin_trgm_ops);

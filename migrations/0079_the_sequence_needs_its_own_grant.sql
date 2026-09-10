-- A GRANT on a table does not carry to the sequence behind its bigserial.
--
-- 0078 granted INSERT on outside_coverage to newstrack_worker and the first
-- insert failed with "permission denied for sequence outside_coverage_id_seq".
-- The default is easy to miss because every other table in this schema is keyed
-- on something natural -- a hash, a slug, a (day, field) pair -- so no sequence
-- has ever needed granting before.
--
-- Granted rather than the column being removed, though the column is arguably
-- the mistake: (source, external_id) is already UNIQUE and is the real identity
-- of a row here. Changing the key of a table that already holds rows to save one
-- GRANT is the more dangerous of the two, and the id is useful for paging.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'newstrack_worker') THEN
    GRANT USAGE, SELECT ON SEQUENCE outside_coverage_id_seq TO newstrack_worker;
  END IF;
END $$;

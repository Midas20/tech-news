-- 0001: extensions, roles, enums, shared helpers.
--
-- Two roles, deliberately:
--   newstrack_worker  collection + processing. Writes global tables. BYPASSRLS is
--                     NOT granted; the worker simply owns nothing tenant-scoped it
--                     should not see, and sets app.tenant_id when it delivers.
--   newstrack_app     the UI and the Slack agent. Every tenant-scoped read passes
--                     through RLS. This role can never reach tenant_secrets.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'newstrack_worker') THEN
    CREATE ROLE newstrack_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'newstrack_app') THEN
    CREATE ROLE newstrack_app NOLOGIN;
  END IF;
END $$;

-- Source role drives pipeline treatment (spec 1.2).
DO $$ BEGIN
  CREATE TYPE source_role AS ENUM
    ('CONTENT','PRIMARY','DISCOVERY','COVERAGE','LAUNCH','EXPERIENCE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE source_health AS ENUM ('healthy','degraded','failing','dead','paused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only four languages survive the ingest gate (spec 2.3).
DO $$ BEGIN
  CREATE TYPE content_lang AS ENUM ('en','ja','de','zh');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE collection_mode AS ENUM ('live','backfill');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery_tier AS ENUM ('critical','notable','niche_first','background');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE volume_tier AS ENUM ('critical','notable','all');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery_mode AS ENUM ('channel','dm','hybrid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Never mix engagement types in one numeric column: 500 HN points != 500 Qiita views.
DO $$ BEGIN
  CREATE TYPE engagement_type AS ENUM
    ('views','points','stars','bookmarks','downloads','comments','reposts');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE platform_stage AS ENUM
    ('signup','assessment','onboarding','acquisition','delivery','payment','dispute','exit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fact_source_type AS ENUM ('official','experiential');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('pending','leased','done','failed','deferred');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE provider_health AS ENUM ('healthy','throttled','exhausted','down');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Current tenant for RLS. Returns NULL rather than raising when unset, so that
-- global-table queries from the worker do not need a tenant context at all.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- Nothing is ever deleted (spec principle 3). Corrections append and supersede.
-- This trigger is attached to every append-only table; it turns a DELETE into a
-- loud failure rather than a silent hole in a permanent archive.
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: rows are superseded, never deleted', TG_TABLE_NAME
    USING HINT = 'insert a replacement row and set superseded_by on the old one';
END $$;

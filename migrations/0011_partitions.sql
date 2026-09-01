-- 0011: monthly partitions. Queries stay fast at millions of rows and cold months
-- can move to cheaper storage without a code change.
--
-- story_members grows 5-8x faster than stories -- plan for it as the largest table.

CREATE OR REPLACE FUNCTION ensure_month_partition(p_parent text, p_month date)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := format('%s_%s', p_parent, to_char(v_start, 'YYYY_MM'));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
      v_name, p_parent, v_start, v_end);
  END IF;
  RETURN v_name;
END $fn$;

-- Called by the maintenance cron. Keeps a rolling window of partitions ahead of
-- now() so an insert can never arrive with nowhere to land.
CREATE OR REPLACE FUNCTION ensure_partitions(p_months_back int DEFAULT 1,
                                             p_months_ahead int DEFAULT 3)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_parent text;
  v_month  date;
BEGIN
  FOREACH v_parent IN ARRAY ARRAY['stories','story_members',
                                  'coverage_snapshots','engagement_snapshots']
  LOOP
    v_month := (date_trunc('month', now()) - make_interval(months => p_months_back))::date;
    WHILE v_month <= (date_trunc('month', now()) + make_interval(months => p_months_ahead))::date LOOP
      PERFORM ensure_month_partition(v_parent, v_month);
      v_month := (v_month + interval '1 month')::date;
    END LOOP;
  END LOOP;
END $fn$;

SELECT ensure_partitions(2, 3);

-- Take the quotation marks out of thirteen names and fourteen descriptions.
--
-- The topic import reads GitHub's frontmatter with a small YAML reader, and it
-- did not unquote scalars. YAML requires quoting when a value contains a colon
-- or a comma, so what came through damaged was not a random thirteen: it was
-- exactly the entries whose names needed quoting.
--
--   "Animal Crossing"   "JSON:API"   "CC: Tweaked"   "Nashville, Tennessee"
--   "PSR-15: HTTP Server Request Handlers"
--
-- The reader is fixed in scripts/import-topics.ts, so a re-import will not put
-- them back. This repairs what the broken one already wrote.
--
-- Only a matched outer pair, matching the fix: a name may legitimately contain
-- a quote character, and stripping one end of one would be the same bug again.
-- The slug is untouched -- it was derived from the topic key, not the display
-- name, so it was never quoted, and it is the URL and the tag.

UPDATE stacks
   SET name = substring(name from 2 for length(name) - 2)
 WHERE name ~ '^".*"$'
   AND length(name) > 2;

UPDATE stacks
   SET description = substring(description from 2 for length(description) - 2)
 WHERE description ~ '^".*"$'
   AND length(description) > 2;

-- Aliases were clean -- they come from a YAML list, whose items this reader
-- never quoted -- but assert it rather than assume it: if a later import ever
-- writes one, this is where it will be noticed.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM stacks
   WHERE EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ~ '^".*"$');
  IF bad > 0 THEN
    RAISE NOTICE 'unquote: % rows have quoted aliases, which 0053 did not expect', bad;
  END IF;
END $$;

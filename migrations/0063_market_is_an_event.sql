-- 0063: the market is the fourth thing that happens to a technology.
--
-- The project's purpose, stated 2026-08-28: "finding new stacks and market via
-- news." Two targets. `event_kind` implemented one of them -- launch, release,
-- change, all facts about a codebase -- and had no way to say that somebody
-- with money looked at a technology and bet on it.
--
-- So every one of these was refused, and not as an article: earlier, as
-- `business` off-topic, which is the category for analyst reports and vendor
-- surveys:
--
--   ClickHouse raises $400M Series D led by Dragoneer
--   ClickHouse raises $350 million Series C to power analytics for the AI era
--   ClickHouse raises a $250M Series B at a $2B valuation
--   Supabase Series F  /  Series B  /  $30m Series A
--   Mistral AI raises 1.7B EUR to accelerate technological progress with AI
--   Hugging Face: We Raised $100 Million for Open & Collaborative ML
--   OpenAI: New funding to build towards AGI
--
-- Nine rounds, from six of the most-watched infrastructure companies in the
-- archive, each one announced by the company itself. Which stack is being bet
-- on is not a fact about a codebase and is exactly what a reader deciding where
-- to spend a year needs.
--
-- `market` also takes ACQUISITION off `change`, where it had been matching all
-- along. "MotherDuck bought the startup" changes nothing about what MotherDuck
-- is this week and everything about what it will be; filing it as a product
-- change made the money lens unreadable.
--
-- The column stays nullable and unconstrained in every other respect. Existing
-- rows keep whatever they were classified as -- reclassifying the archive is
-- `npm run kinds`, which is a separate, resumable, auditable pass.

ALTER TABLE stories DROP CONSTRAINT IF EXISTS stories_event_kind_check;
ALTER TABLE stories ADD CONSTRAINT stories_event_kind_check
  CHECK (event_kind IS NULL
         OR event_kind IN ('launch','release','change','market','article'));

-- 0022: the queue is worked from the settings-style surface, so the application
-- role needs to be able to accept and reject a candidate, and to write the entry
-- that acceptance creates.
--
-- This is a deliberate widening: the app role can now INSERT into stacks. It is
-- the same trade the settings page made -- the operator surface runs as the
-- non-owner role, and the alternative is running the whole UI as owner, which is
-- how tenant isolation dies quietly.
--
-- What it still cannot do is DELETE a stack. An entry that turns out to be wrong
-- is superseded by hand with the owner connection, on purpose: in a closed
-- vocabulary a slug that disappears takes every tag pointing at it with it.

GRANT INSERT, UPDATE ON stacks TO newstrack_app;
GRANT INSERT, UPDATE ON stack_candidates TO newstrack_app;
GRANT UPDATE ON stories TO newstrack_app;

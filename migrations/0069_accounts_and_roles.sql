-- Who is asking.
--
-- Until now the reader had no idea. There was no login, no session, and
-- SESSION_SECRET was not referenced anywhere in src/ -- entirely reasonable for
-- a tool on 127.0.0.1, and the thing that had to be solved by a blunt rule the
-- moment it was put on a public address: writes were accepted only from the
-- machine itself, because "the machine itself" was the only identity available.
--
-- That rule had a visible cost. The theme toggle in the top bar is a form that
-- posts to /settings, so on both deployed sites clicking it returned 403. The
-- button was not broken; it was refused, and it was refused because the server
-- could not tell an owner from a stranger.
--
-- A NEW TABLE, NOT THE EXISTING ONE. `users` is Slack-shaped -- slack_user_id
-- is NOT NULL, rows are tenant-scoped -- and belongs to the delivery phase that
-- has not been built. Widening it to mean two things would leave both meanings
-- worse. `accounts` is the web login and nothing else.

CREATE TYPE account_role AS ENUM ('admin', 'user');

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Case-insensitive by index rather than by citext, which is an extension this
  -- database does not have. Stored as typed so it can be shown back that way.
  username      text        NOT NULL,

  -- EMAIL IS OPTIONAL, deliberately. Asked for as "signup with only username
  -- and password, email optional" -- so it is nullable, and the uniqueness
  -- index skips NULLs rather than treating a missing address as a value that
  -- can collide with another missing address.
  email         text,

  -- PBKDF2-SHA256, encoded with its parameters:
  --   pbkdf2$sha256$<iterations>$<salt-b64>$<hash-b64>
  -- The parameters travel with the hash so the cost can be raised later
  -- without invalidating what is already stored.
  password_hash text        NOT NULL,

  role          account_role NOT NULL DEFAULT 'user',

  -- A common user's whole surface: which fields they follow. Everything else
  -- about the archive is read-only to them.
  fields        text[]      NOT NULL DEFAULT '{}',

  -- PER ACCOUNT, not global. The theme lived in app_settings, which is one
  -- value for the entire installation -- fine for one operator on loopback,
  -- wrong the moment two people log in and one of them prefers light.
  theme         text        NOT NULL DEFAULT 'dark',

  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,

  CONSTRAINT accounts_theme_known CHECK (theme IN ('auto', 'dark', 'light')),
  -- Long enough to be worth typing, short enough to fit a column heading, and
  -- restricted so a username cannot be made to look like another one.
  CONSTRAINT accounts_username_shape CHECK (username ~ '^[A-Za-z0-9._-]{3,32}$'),
  CONSTRAINT accounts_email_shape CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')
);

CREATE UNIQUE INDEX accounts_username_key ON accounts (lower(username));
CREATE UNIQUE INDEX accounts_email_key ON accounts (lower(email)) WHERE email IS NOT NULL;

COMMENT ON TABLE accounts IS
  'Web login. Separate from `users`, which is Slack-scoped and belongs to the delivery phase.';
COMMENT ON COLUMN accounts.password_hash IS
  'pbkdf2$sha256$<iterations>$<salt-b64>$<hash-b64>. Verified with WebCrypto, which both '
  'Node and Workers have -- bcrypt and argon2 are native modules and neither runs on Workers.';

-- The reader connects as app_user (NOBYPASSRLS). Default privileges on this
-- database grant it SELECT on new tables and nothing else, which would let
-- somebody log in and then fail to sign up, fail to save a focus field and fail
-- to change the theme -- the last of which is the bug this migration exists to
-- fix. Named explicitly rather than left to a default that is easy to misread.
GRANT SELECT, INSERT, UPDATE ON accounts TO app_user;

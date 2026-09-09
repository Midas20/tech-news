// What the desktop launcher decides, separated from what it does.
//
// Everything here is a pure function over strings, so the rules that matter --
// which database, which port, what a first run writes down -- can be tested
// without Postgres, a file system or a spawned process. launch.ts is the shell
// that performs them.

import { randomBytes } from 'node:crypto';

/**
 * The port an embedded cluster listens on. NOT 5432, deliberately.
 *
 * 5432 is where an installed PostgreSQL service already is -- on this machine,
 * the one holding the archive. A launcher that started its own cluster on the
 * same port would either fail to bind or, worse, succeed after the service was
 * stopped and quietly serve a different, empty database.
 */
export const EMBEDDED_PORT = 54329;

/** The database inside that cluster, and the web port the reader opens. */
export const EMBEDDED_DB = 'newstrack';
export const DEFAULT_PORT = 3000;

// ---------------------------------------------------------------------------
// Configuration files
// ---------------------------------------------------------------------------

/**
 * Read a .env-shaped file into a map.
 *
 * Deliberately the same shape as src/lib/dotenv.ts rather than a second
 * dialect: the launcher writes a file the application then reads, and two
 * parsers that disagree about quoting is a bug that appears only once a
 * password happens to contain the character they disagree about.
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] =
      trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Set a key in a .env-shaped file, keeping every comment and every other line.
 *
 * A launcher that rewrites the whole file from its own map throws away
 * everything it does not know about -- which is every API key the user pasted
 * in by hand. This edits one line and appends only when the key is new.
 */
export function setEnv(text: string, key: string, value: string): string {
  const line = key + '=' + value;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('^' + escaped + '=.*$', 'm');
  if (pattern.test(text)) return text.replace(pattern, line);
  const separator = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  return text + separator + line + '\n';
}

// ---------------------------------------------------------------------------
// Which database
// ---------------------------------------------------------------------------

export interface Candidate {
  /** 'configured' -- a server somebody chose. 'embedded' -- the one we start. */
  kind: 'configured' | 'embedded';
  url: string;
  /** For a log line, and never carrying the password. */
  describe: string;
}

/**
 * Where the archive is.
 *
 * ONE RULE, AND IT IS THE IMPORTANT ONE: a configured database is never
 * silently replaced by an empty one. If DATABASE_URL is set and the server
 * behind it does not answer, that is an error to report, not a reason to start
 * a fresh cluster -- this machine has an archive in a PostgreSQL service, and
 * an app that greets an outage by showing a working, empty archive has told
 * the user their data is gone.
 *
 * So this returns at most one candidate, chosen from configuration alone.
 * Reachability decides whether it works, never which one is used.
 */
export function chooseDatabase(
  config: Record<string, string>,
  opts: { embeddedAvailable: boolean; embeddedPort?: number },
): Candidate | null {
  const configured = config.DATABASE_URL?.trim();
  if (configured) {
    return { kind: 'configured', url: configured, describe: redact(configured) };
  }
  if (!opts.embeddedAvailable) return null;
  const port = opts.embeddedPort ?? EMBEDDED_PORT;
  // The password is invented here and then lives in the config file, so this
  // branch is reached exactly once per installation.
  const url = embeddedUrl(newPassword(), port);
  return { kind: 'embedded', url, describe: 'embedded postgres on 127.0.0.1:' + port };
}

/** The connection string for the cluster this launcher starts and owns. */
export function embeddedUrl(
  password: string, port = EMBEDDED_PORT, database = EMBEDDED_DB,
): string {
  return 'postgresql://postgres:' + encodeURIComponent(password)
    + '@127.0.0.1:' + port + '/' + database;
}

/**
 * A connection string with the password taken out, for printing.
 *
 * The launcher writes to a console the user is looking at and to a log file
 * they may well send somebody. Neither should contain the password.
 */
export function redact(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    return (u.username ? u.username + '@' : '') + u.hostname
      + (u.port ? ':' + u.port : '') + u.pathname;
  } catch {
    return 'an unparseable connection string';
  }
}

/** 24 bytes of randomness, in an alphabet that survives a URL and a shell. */
export function newPassword(): string {
  return randomBytes(24).toString('base64url');
}

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------

/**
 * The configuration file written when there is none.
 *
 * A real file with real comments rather than a blank one, because the next
 * thing a user wants after "it runs" is "how do I give it my API keys", and
 * the answer should be visible in the file they already have. Nothing here is
 * a secret: the database line is filled in by the caller once the cluster
 * exists, and every model key is deliberately empty.
 */
export function firstRunConfig(port = DEFAULT_PORT): string {
  return [
    '# NewsTrack -- configuration for this machine.',
    '#',
    '# Written on the first run and never overwritten. Edit it and restart.',
    '# The lines the launcher manages (DATABASE_URL and friends) are rewritten',
    '# in place; everything else is left exactly as you leave it.',
    '',
    '# The reader. 127.0.0.1 means this machine only, which is the right default',
    '# for something you double-click: any other value puts the archive on your',
    '# network, and then ADMIN_TOKEN below stops being optional.',
    'HOST=127.0.0.1',
    'PORT=' + port,
    '',
    '# Collection runs whether or not any of the keys below are set. What they',
    '# buy is the part that reads and summarises: with none of them, stories are',
    '# collected, tagged and readable, and nothing is deduplicated or scored.',
    'PROCESSING_ENABLED=1',
    '',
    '# Model routing. All optional, and the free tiers do most of the work.',
    'ANTHROPIC_API_KEY=',
    'GEMINI_API_KEY=',
    'GROQ_API_KEY=',
    'CEREBRAS_API_KEY=',
    '',
    '# Raises the rate limit on two collectors. Also optional.',
    'GITHUB_TOKEN=',
    '',
    '# Required only if HOST above is not loopback: /admin runs on the owner',
    '# connection, which bypasses row-level security by design.',
    'ADMIN_TOKEN=',
    '',
  ].join('\n');
}

/**
 * Whether a bind address exposes the archive beyond this machine.
 *
 * The same test the server makes, kept here so the launcher can say so before
 * anything binds rather than after.
 */
export function isPublicBind(host: string): boolean {
  return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
}

/**
 * The URL to open in a browser.
 *
 * Always loopback, even when the server is bound to every interface: the
 * browser being opened is on the same machine as the server, and 0.0.0.0 is
 * not an address a client can connect to.
 */
export function readerUrl(port: number): string {
  return 'http://127.0.0.1:' + port + '/';
}

// NewsTrack as something you double-click.
//
// Asked for on 2026-09-09: "I want exe file I can run on my PC". Until now the
// system was `npm start` plus a PostgreSQL service somebody had installed,
// configured and pointed a .env at -- four things to get right before the first
// story arrives, on a machine with a terminal open. This is the same system
// with those four things done for you.
//
// WHAT RUNS THIS. NewsTrack.exe (src/launcher/shim.cs, 4 KB of C#) finds
// runtime\node.exe and hands it this file. Everything below is the actual
// startup, in TypeScript, where it can be read and changed without a compiler.
//
// THE ORDER MATTERS AND IT IS NOT ARBITRARY:
//
//   config      what the user has already chosen wins over anything invented
//   database    a configured one is used or fails; only nothing starts a new one
//   migrate     as the owner, before anything else opens a connection
//   roles       so the app half runs NOBYPASSRLS, exactly as on a server
//   seed        only when the taxonomy is empty, so a re-run is not a re-seed
//   start       the whole system, one process, ROLE=all
//   browser     only after /healthz answers, so the first page is not an error
//
// Each step is skipped when it has already been done, so the second run is the
// first run minus the waiting.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePool } from '../db/driver.ts';
import {
  parseEnv, setEnv, chooseDatabase, firstRunConfig, redact, isPublicBind,
  readerUrl, newPassword, EMBEDDED_PORT, EMBEDDED_DB, DEFAULT_PORT,
} from './plan.ts';

// --- where everything is ------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
/** The application: src, scripts, migrations, seeds, node_modules. */
const APP = join(HERE, '..', '..');
/** The installation: the application, the Node runtime, and maybe Postgres. */
const HOME = join(APP, '..');

/**
 * Data lives outside the installation, always.
 *
 * The cluster, the logs and the configuration go in %LOCALAPPDATA%, so that
 * replacing the program folder with a newer one -- which is the entire upgrade
 * procedure for a portable app -- cannot delete the archive. It also means the
 * program folder never has to be writable, which matters the first time
 * somebody drops it in Program Files.
 */
const DATA = process.env.NEWSTRACK_DATA
  ?? join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Local'),
    'NewsTrack');

const PGDATA = join(DATA, 'pgdata');
const LOGS = join(DATA, 'logs');
const PG_BIN = join(HOME, 'pgsql', 'bin');

/**
 * The configuration file.
 *
 * A checkout's own .env wins, so running this from the repository behaves like
 * every other script in it rather than reading some other file in AppData.
 */
const CONFIG = process.env.NEWSTRACK_CONFIG
  ?? (existsSync(join(APP, '.env')) ? join(APP, '.env') : join(DATA, 'newstrack.env'));

const embeddedAvailable = existsSync(join(PG_BIN, 'pg_ctl.exe'))
  || existsSync(join(PG_BIN, 'pg_ctl'));

// --- what we started, so we can stop it ---------------------------------------

let app: ChildProcess | null = null;
let startedPostgres = false;
let stopping = false;

// --- go -----------------------------------------------------------------------

banner();

mkdirSync(DATA, { recursive: true });
mkdirSync(LOGS, { recursive: true });

let configText = readConfig();
let config = parseEnv(configText);

const chosen = chooseDatabase(config, { embeddedAvailable, embeddedPort: EMBEDDED_PORT });
if (!chosen) {
  fail([
    'NewsTrack has no database to use.',
    '',
    'This copy was built without the embedded PostgreSQL, so it needs to be',
    'told where an existing one is. Open this file:',
    '',
    '  ' + CONFIG,
    '',
    'and set DATABASE_URL, for example:',
    '',
    '  DATABASE_URL=postgresql://postgres:PASSWORD@127.0.0.1:5432/newstrack',
    '',
    'then start NewsTrack again.',
  ]);
}

say('database  ' + chosen!.describe);

if (chosen!.kind === 'embedded') {
  // Remembered before the cluster is built, because initdb needs the password
  // and a half-built cluster with a password nobody wrote down is unusable.
  remember('DATABASE_URL', chosen!.url);
  remember('DATABASE_DIRECT_URL', chosen!.url);
  await ensureCluster(chosen!.url);
} else {
  if (!config.DATABASE_DIRECT_URL) remember('DATABASE_DIRECT_URL', chosen!.url);
  await requireReachable(chosen!.url);
}

const ownerUrl = config.DATABASE_DIRECT_URL || chosen!.url;

await migrate(ownerUrl);
await ensureRoles(ownerUrl);
await seedIfEmpty(ownerUrl);

const port = Number(config.PORT) || DEFAULT_PORT;
const host = config.HOST || '127.0.0.1';
if (isPublicBind(host) && !config.ADMIN_TOKEN) {
  fail([
    'HOST is set to ' + host + ', which puts NewsTrack on your network, but',
    'ADMIN_TOKEN is empty. /admin runs on the database owner connection and',
    'bypasses row-level security by design, so it must not be reachable',
    'without a token.',
    '',
    'Set ADMIN_TOKEN in ' + CONFIG + ', or set HOST back to 127.0.0.1.',
  ]);
}

startApp(port, host);
await openWhenReady(port);

// --- steps --------------------------------------------------------------------

function readConfig(): string {
  if (existsSync(CONFIG)) return readFileSync(CONFIG, 'utf8');
  say('config    writing ' + CONFIG);
  const text = firstRunConfig(DEFAULT_PORT);
  writeFileSync(CONFIG, text, 'utf8');
  return text;
}

/** Write one setting to the config file and to the map we are working from. */
function remember(key: string, value: string): void {
  configText = setEnv(configText, key, value);
  writeFileSync(CONFIG, configText, 'utf8');
  config[key] = value;
}

/**
 * A cluster of our own, created once.
 *
 * initdb is the only step here that cannot be repeated: it refuses a non-empty
 * directory, and re-running it on a cluster that already holds the archive
 * would be the worst thing this program could do. So the test is the existence
 * of PG_VERSION, which initdb writes last.
 */
async function ensureCluster(url: string): Promise<void> {
  const password = decodeURIComponent(new URL(url).password);

  if (!existsSync(join(PGDATA, 'PG_VERSION'))) {
    say('database  creating a cluster in ' + PGDATA + ' (once, ~20s)');
    // Via a file, never an argument: a command line is visible to every other
    // process on the machine, and this password is the owner's.
    const pwfile = join(DATA, 'initdb.pw');
    writeFileSync(pwfile, password, 'utf8');
    try {
      run(pg('initdb'), [
        '--pgdata=' + PGDATA,
        '--username=postgres',
        '--pwfile=' + pwfile,
        '--auth=scram-sha-256',
        '--encoding=UTF8',
        // C rather than the machine's locale: collation affects index ordering,
        // and an archive that sorts differently on two machines is an archive
        // whose indexes are not portable.
        '--locale=C',
      ], 'could not create the database cluster');
    } finally {
      rmSync(pwfile, { force: true });
    }
  }

  if (!isRunning()) {
    say('database  starting postgres on 127.0.0.1:' + EMBEDDED_PORT);
    run(pg('pg_ctl'), [
      '--pgdata=' + PGDATA,
      '--log=' + join(LOGS, 'postgres.log'),
      '--wait',
      '--options=-p ' + EMBEDDED_PORT + ' -c listen_addresses=127.0.0.1',
      'start',
    ], 'could not start postgres — see ' + join(LOGS, 'postgres.log'));
    startedPostgres = true;
  } else {
    // Left running by a previous session that was closed rather than stopped.
    // Adopting it is right; it is the same cluster and the same data.
    say('database  already running');
  }

  // createdb is not idempotent, so ask first. Both the failure and the
  // already-exists case are normal on a second run.
  const check = spawnSync(pg('psql'), [
    '--host=127.0.0.1', '--port=' + EMBEDDED_PORT, '--username=postgres',
    '--dbname=postgres', '--tuples-only', '--no-align',
    '--command=SELECT 1 FROM pg_database WHERE datname = ' + quoteLiteral(EMBEDDED_DB),
  ], { env: { ...process.env, PGPASSWORD: password }, encoding: 'utf8' });

  if (check.stdout?.trim() !== '1') {
    say('database  creating ' + EMBEDDED_DB);
    run(pg('createdb'), [
      '--host=127.0.0.1', '--port=' + EMBEDDED_PORT, '--username=postgres', EMBEDDED_DB,
    ], 'could not create the database', { PGPASSWORD: password });
  }
}

/**
 * Prove a configured database answers before going any further.
 *
 * Everything after this assumes a working connection, and the errors they give
 * when there is not one are about migrations and roles rather than about the
 * server being unreachable, which is the thing the user needs told.
 */
async function requireReachable(url: string): Promise<void> {
  const pool = makePool(url, { max: 1 });
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    fail([
      'NewsTrack cannot reach the database it is configured to use.',
      '',
      '  ' + redact(url),
      '  ' + (err instanceof Error ? err.message : String(err)),
      '',
      'It will not start a different, empty database instead -- if this server',
      'holds your archive, showing you a working but empty one would be a lie.',
      '',
      'Start that server, or change DATABASE_URL in:',
      '  ' + CONFIG,
    ]);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function migrate(url: string): Promise<void> {
  say('schema    applying migrations');
  await node(join(APP, 'scripts', 'migrate.ts'), {
    DATABASE_URL: url, DATABASE_DIRECT_URL: url,
  }, 'migrations failed');
}

/**
 * The two NOBYPASSRLS roles, created once and then left alone.
 *
 * Skipped when the config already names them, because create-app-role.ts
 * rotates the password every time it runs -- which is correct when a person
 * asks for it and wrong on every application start.
 *
 * Not fatal if it fails. src/main.ts falls back to the owner connection with a
 * warning it prints itself, and a desktop installation with one user is not
 * where tenant isolation is load-bearing. Refusing to start would trade a
 * working archive for a protection nothing here is relying on.
 */
async function ensureRoles(url: string): Promise<void> {
  if (config.DATABASE_APP_URL && config.DATABASE_WORKER_URL) return;
  say('roles     creating app_user and worker_user');
  for (const args of [[], ['--worker']]) {
    try {
      await node(join(APP, 'scripts', 'create-app-role.ts'), {
        DATABASE_URL: url, DATABASE_DIRECT_URL: url, NEWSTRACK_ENV_FILE: CONFIG,
      }, 'could not create a database role', args);
    } catch (err) {
      say('roles     ' + (err instanceof Error ? err.message : String(err)));
      say('roles     continuing as the database owner');
      return;
    }
  }
  configText = readFileSync(CONFIG, 'utf8');
  config = parseEnv(configText);
}

/**
 * The taxonomy and the source registry, on an archive that has neither.
 *
 * The test is `stacks`, not `stories`: a seeded installation that has not
 * collected anything yet is normal and must not be re-seeded, and an
 * installation with no taxonomy cannot classify what it collects.
 */
async function seedIfEmpty(url: string): Promise<void> {
  const pool = makePool(url, { max: 1 });
  let empty = false;
  try {
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM stacks');
    empty = Number(rows[0]?.n ?? 0) === 0;
  } catch {
    // A missing table means the migration that creates it has not run, which
    // migrate() would already have failed on. Nothing useful to add.
    empty = false;
  } finally {
    await pool.end().catch(() => undefined);
  }
  if (!empty) return;
  say('seed      loading the taxonomy and the source registry (once, ~30s)');
  await node(join(APP, 'scripts', 'seed.ts'), {
    DATABASE_URL: url, DATABASE_DIRECT_URL: url,
  }, 'seeding failed');
}

/**
 * The system itself: web server and scheduler in one process, as on a server.
 *
 * Not awaited -- this is the thing that keeps running. Its output is this
 * console's output, so what the user sees is what the logs say.
 */
function startApp(port: number, host: string): void {
  say('starting  ' + readerUrl(port));
  say('');
  app = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings',
    join(APP, 'src', 'main.ts')], {
    cwd: APP,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...config,
      ROLE: 'all',
      HOST: host,
      PORT: String(port),
      // The config file is the source of truth for a desktop installation, and
      // main.ts would otherwise read a .env from its own working directory.
      NEWSTRACK_ENV_FILE: CONFIG,
    },
  });

  app.on('exit', (code, signal) => {
    if (stopping) return;
    say('');
    say('NewsTrack stopped' + (code ? ' (exit ' + code + ')' : signal ? ' (' + signal + ')' : ''));
    void shutdown(code ?? 1);
  });
}

/**
 * Open the browser once the server answers, and not before.
 *
 * /healthz deliberately does not touch the database, so this waits for a
 * listening socket rather than for a working archive -- which is what "the
 * page will load" actually depends on.
 */
async function openWhenReady(port: number): Promise<void> {
  const url = readerUrl(port);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (stopping) return;
    try {
      const res = await fetch(url + 'healthz');
      if (res.ok) {
        if (process.argv.includes('--no-browser')) return;
        spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
        return;
      }
    } catch {
      // Not listening yet. Expected for the first second or two.
    }
    await sleep(400);
  }
  say('note      the server did not answer within a minute; open ' + url + ' yourself');
}

// --- stopping -----------------------------------------------------------------

/**
 * Stop what we started, in the order that makes the next start clean.
 *
 * The application first, so the scheduler releases its job claims and finishes
 * the request in flight; then Postgres, with -m fast, which rolls back open
 * transactions rather than waiting for clients that have already gone.
 *
 * Only a cluster THIS process started is stopped. Adopting one left running by
 * an earlier session is right; killing one somebody else is using is not.
 */
async function shutdown(code: number): Promise<never> {
  stopping = true;
  if (app && app.exitCode === null) {
    app.kill('SIGTERM');
    const deadline = Date.now() + 20_000;
    while (app.exitCode === null && Date.now() < deadline) await sleep(200);
    if (app.exitCode === null) app.kill('SIGKILL');
  }
  if (startedPostgres) {
    say('database  stopping postgres');
    spawnSync(pg('pg_ctl'), ['--pgdata=' + PGDATA, '--mode=fast', '--wait', 'stop'],
      { stdio: 'ignore' });
  }
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    say('');
    say('stopping…');
    void shutdown(0);
  });
}

// --- plumbing -----------------------------------------------------------------

function pg(tool: string): string {
  return join(PG_BIN, process.platform === 'win32' ? tool + '.exe' : tool);
}

function isRunning(): boolean {
  return spawnSync(pg('pg_ctl'), ['--pgdata=' + PGDATA, 'status'], { stdio: 'ignore' })
    .status === 0;
}

/** A blocking external command whose failure is fatal and worth explaining. */
function run(
  command: string, args: string[], what: string, env: Record<string, string> = {},
): void {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    fail([what + '.', '', '  ' + command, '  exit ' + (result.status ?? result.signal)]);
  }
}

/** One of this project's own scripts, with its output on this console. */
function node(
  script: string, env: Record<string, string>, what: string, args: string[] = [],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      ['--experimental-strip-types', '--no-warnings', script, ...args], {
        cwd: APP,
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, ...config, ...env },
      });
    child.on('exit', (code) => (code === 0
      ? resolve()
      : reject(new Error(what + ' (exit ' + code + ')'))));
    child.on('error', (err) => reject(new Error(what + ': ' + err.message)));
  });
}

function quoteLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function say(line: string): void {
  console.log(line);
}

function banner(): void {
  console.log('');
  console.log('  NewsTrack');
  console.log('  ' + '-'.repeat(58));
  console.log('');
}

/** Print, wait to be read, and stop. Reached only before the app starts. */
function fail(lines: string[]): never {
  console.error('');
  for (const line of lines) console.error(line ? '  ' + line : '');
  console.error('');
  if (!process.stdin.isTTY) process.exit(1);
  console.error('  Press Ctrl+C to close.');
  // Hold the console open. A double-clicked window that vanishes on an error
  // has told the user nothing at all.
  setInterval(() => undefined, 1 << 30);
  // Never reached, but the signature promises never and the compiler is right
  // to want it.
  return undefined as never;
}

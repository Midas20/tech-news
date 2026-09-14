// Build NewsTrack into a folder you can copy to a Windows machine and run.
//
//   npm run build:app                 the program, using a database you configure
//   npm run build:app -- --with-postgres   ...and a PostgreSQL of its own
//   npm run build:app -- --with-env        ...and this machine's .env, secrets included
//
// The output is dist/NewsTrack. There is no installer and nothing is written to
// the registry: the folder IS the program, and deleting it uninstalls it. Data
// lives in %LOCALAPPDATA%\NewsTrack, so replacing the folder with a newer build
// is the upgrade procedure.
//
// WHY csc.exe AND NOT A SINGLE EXECUTABLE
//
// Node 22 can bundle a script into a copy of node.exe, and that was the first
// attempt. postject, the tool that injects the blob, loads the whole 92 MB
// binary into a LIEF wasm heap and dies with "Fatal process out of memory:
// Zone" on a machine with 8 GB. Raising --max-old-space-size does not help --
// the allocation that fails is wasm's, not V8's.
//
// csc.exe has shipped inside Windows since Vista. It compiles a 4 KB launcher
// that starts node.exe, needs no download, and leaves the TypeScript readable
// in the folder rather than sealed inside a binary. The exe is the double-click;
// the program is still the repository.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync }
  from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'NewsTrack');

const withPostgres = process.argv.includes('--with-postgres');
const withEnv = process.argv.includes('--with-env');

// The compiler that is already on the machine. Framework64 is present on every
// 64-bit Windows; the version directory has not changed since 2012.
const CSC = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

/**
 * Everything the application needs at runtime, and nothing else.
 *
 * `tests` is not here, and neither is `.git`. node_modules IS here: there is no
 * bundler, so the dependency tree is the dependency tree. It is copied from the
 * checkout rather than reinstalled, which means a build inherits whatever
 * `npm ci` last produced -- checked below rather than assumed.
 */
const PARTS = ['src', 'scripts', 'migrations', 'seeds', 'node_modules',
  'package.json', 'package-lock.json'];

main();

function main(): void {
  step('checking the checkout');
  if (!existsSync(CSC)) {
    die('No C# compiler at ' + CSC + '.\n'
      + 'It is part of the .NET Framework and ships with Windows; this build needs it\n'
      + 'to produce NewsTrack.exe.');
  }
  for (const part of PARTS) {
    if (!existsSync(join(ROOT, part))) {
      die('Missing ' + part + '. Run `npm ci` first.');
    }
  }

  step('clearing ' + rel(OUT));
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  step('copying the application');
  for (const part of PARTS) {
    cpSync(join(ROOT, part), join(OUT, 'app', part), { recursive: true });
  }

  // The one file the launcher must not inherit unless asked. It holds live API
  // keys and a database password, and a build is a thing people copy about.
  if (withEnv) {
    if (!existsSync(join(ROOT, '.env'))) die('--with-env, but there is no .env to include.');
    cpSync(join(ROOT, '.env'), join(OUT, 'app', '.env'));
    warn('this build contains .env — API keys and a database password.\n'
      + '           It is for your own machine. Do not send the folder to anybody.');
  }

  step('copying the Node runtime');
  // The runtime that is running this script, so the build cannot disagree with
  // the version it was tested on.
  mkdirSync(join(OUT, 'runtime'), { recursive: true });
  cpSync(process.execPath, join(OUT, 'runtime', 'node.exe'));

  if (withPostgres) {
    const source = findPostgres();
    if (!source) {
      die('--with-postgres, but no PostgreSQL installation was found.\n'
        + 'Looked under C:\\Program Files\\PostgreSQL. Install one, or drop the flag\n'
        + 'and set DATABASE_URL in the config file instead.');
    }
    step('copying PostgreSQL from ' + source);
    // bin, lib and share are the server, its libraries and its bootstrap
    // catalogues. `data` is a cluster and is emphatically not copied: it would
    // ship somebody's archive inside the program folder.
    for (const part of ['bin', 'lib', 'share']) {
      cpSync(join(source, part), join(OUT, 'pgsql', part), { recursive: true });
    }
  }

  step('compiling NewsTrack.exe');
  const compile = spawnSync(CSC, [
    '-nologo',
    '-optimize+',
    '-target:exe',
    '-platform:anycpu',
    '-out:' + join(OUT, 'NewsTrack.exe'),
    join(ROOT, 'src', 'launcher', 'shim.cs'),
  ], { stdio: 'inherit' });
  if (compile.status !== 0) die('the launcher did not compile.');

  writeFileSync(join(OUT, 'README.txt'), readme(), 'utf8');

  const mb = (bytes(OUT) / 1024 / 1024).toFixed(0);
  console.log('');
  console.log('  built  ' + rel(OUT) + '  (' + mb + ' MB)');
  console.log('  run    ' + join(OUT, 'NewsTrack.exe'));
  console.log('');
  if (!withPostgres) {
    console.log('  This build has no database of its own. On first run it writes a config');
    console.log('  file and tells you where to set DATABASE_URL. Build it with');
    console.log('  --with-postgres to make it self-contained.');
    console.log('');
  }
}

/** The newest PostgreSQL under the standard Windows install root. */
function findPostgres(): string | null {
  const root = 'C:\\Program Files\\PostgreSQL';
  if (!existsSync(root)) return null;
  const versions = readdirSync(root)
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(b) - Number(a));
  for (const version of versions) {
    const candidate = join(root, version);
    if (existsSync(join(candidate, 'bin', 'pg_ctl.exe'))) return candidate;
  }
  return null;
}

function readme(): string {
  return [
    'NewsTrack',
    '=========',
    '',
    'Double-click NewsTrack.exe. It opens a console window, sets itself up on the',
    'first run, and opens the reader in your browser when it is ready.',
    '',
    'The first run takes a minute or two: it creates a database, applies the',
    'schema and loads the source registry. Every run after that is a few seconds.',
    '',
    'Closing the console window stops it. Nothing is left running.',
    '',
    '',
    'WHERE THINGS ARE',
    '',
    '  This folder                     the program. Delete it to uninstall.',
    '  %LOCALAPPDATA%\\NewsTrack        your archive, your settings, the logs.',
    '',
    'The two are separate on purpose: to upgrade, replace this folder with a',
    'newer one. Your archive is not in it and is not touched.',
    '',
    '',
    'SETTINGS',
    '',
    'Open %LOCALAPPDATA%\\NewsTrack\\newstrack.env in Notepad. It explains itself.',
    'Restart NewsTrack after changing it.',
    '',
    'Collection works with no API keys at all — stories are fetched, tagged and',
    'readable. The keys buy the part that reads and summarises them.',
    '',
    '',
    'THE FIRST SIGN-IN',
    '',
    'Username admin. The password is ADMIN_PASSWORD in newstrack.env: set it',
    'before the first start, which creates the account with it.',
    '',
    '',
    'IF IT WILL NOT START',
    '',
    'The console window says why and stays open. The most common cause is a',
    'DATABASE_URL pointing at a server that is not running.',
    '',
    'Logs are in %LOCALAPPDATA%\\NewsTrack\\logs.',
    '',
  ].join('\r\n');
}

function bytes(path: string): number {
  const info = statSync(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of readdirSync(path)) total += bytes(join(path, entry));
  return total;
}

function rel(path: string): string {
  return path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path;
}

function step(what: string): void {
  console.log('  ' + what);
}

function warn(what: string): void {
  console.log('  WARNING: ' + what);
}

function die(message: string): never {
  console.error('');
  for (const line of message.split('\n')) console.error('  ' + line);
  console.error('');
  process.exit(1);
}

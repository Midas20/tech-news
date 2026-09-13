// Keeps `src/main.ts` running on this host, and brings it back when it stops.
//
//   node scripts/host.mjs        (started by the NewsTrack scheduled task)
//
// WHY THIS EXISTS
//
// `npm start` is a foreground process, and nothing in the repository restarted
// it. On 2026-09-09 the process on 162.246.23.43 stopped mid-log with no error
// -- killed along with the shell that had started it -- and port 3000 stayed
// dark for four days, because "the site is down" had no owner except a person
// noticing. A deployment that depends on somebody typing `npm start` again is
// the same broken contract as a collector that depends on somebody typing.
//
// WHAT IT DOES
//
// One child, always. It is restarted when it exits, with a delay that doubles
// on quick failures (5 s up to 5 min) and resets once a run has stayed up for
// ten minutes -- so a database outage costs a few hundred restarts a day, not
// thousands, and a one-off crash comes back in seconds.
//
// ONE SUPERVISOR, NOT SEVERAL
//
// The scheduled task fires at boot and every five minutes, so that a
// supervisor which itself dies is replaced. That only works if a second one
// can tell the first is alive: `.run/host.lock` holds the running supervisor's
// pid, and a supervisor that finds a live pid there exits at once.
//
// NOT TWO WEB SERVERS
//
// If something else already holds the port -- an `npm start` somebody ran by
// hand -- the child is not started into EADDRINUSE over and over. The
// supervisor waits and takes over once the port is free.

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync, renameSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = join(ROOT, '.run', 'host.lock');
const LOG = join(ROOT, 'server.log');
const PORT = Number(process.env.PORT) || 3000;
const LOG_LIMIT = 20 * 1024 * 1024;
const FIRST_DELAY = 5_000;
const MAX_DELAY = 300_000;
const HEALTHY_AFTER = 600_000;

const stamp = () => new Date().toISOString().slice(11, 19);

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

mkdirSync(dirname(LOCK), { recursive: true });
try {
  const held = Number(readFileSync(LOCK, 'utf8').trim());
  if (held && held !== process.pid && alive(held)) process.exit(0);
} catch { /* no lock: nobody is supervising */ }
writeFileSync(LOCK, String(process.pid));

let log = openLog();
function openLog() {
  // Rotated once, at 20 MB, so a year unattended cannot fill the disk.
  try { if (statSync(LOG).size > LOG_LIMIT) renameSync(LOG, `${LOG}.1`); } catch { /* none yet */ }
  return createWriteStream(LOG, { flags: 'a' });
}
const say = (line) => log.write(`${stamp()} host: ${line}\n`);

function portBusy() {
  return new Promise((resolve) => {
    const socket = createConnection({ port: PORT, host: '127.0.0.1' });
    socket.setTimeout(2_000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

let child = null;
let stopping = false;
// Halved, because the first failure doubles it: a crash is retried after 5 s.
let delay = FIRST_DELAY / 2;
let waitingSaid = false;

async function run() {
  if (stopping) return;
  if (await portBusy()) {
    if (!waitingSaid) say(`port ${PORT} is already in use; waiting for it to free up`);
    waitingSaid = true;
    setTimeout(run, 30_000);
    return;
  }
  waitingSaid = false;
  log.end();
  log = openLog();

  const started = Date.now();
  say(`starting src/main.ts (supervisor ${process.pid})`);
  child = spawn(process.execPath, ['--experimental-strip-types', 'src/main.ts'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    const up = Date.now() - started;
    delay = up >= HEALTHY_AFTER ? FIRST_DELAY : Math.min(delay * 2, MAX_DELAY);
    say(`src/main.ts exited (${signal ?? `code ${code}`}) after ${Math.round(up / 1000)} s; `
      + `restarting in ${Math.round(delay / 1000)} s`);
    setTimeout(run, delay);
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  say('stopping');
  try { if (Number(readFileSync(LOCK, 'utf8').trim()) === process.pid) rmSync(LOCK); } catch { /* gone */ }
  if (!child) process.exit(0);
  child.once('exit', () => process.exit(0));
  child.kill();
  setTimeout(() => process.exit(0), 25_000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

void run();

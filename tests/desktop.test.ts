// NewsTrack as something you double-click.
//
// Asked for on 2026-09-09: "I want exe file I can run on my PC". The system was
// `npm start` against a PostgreSQL somebody had installed and pointed a .env at,
// which is four things to get right before the first story arrives.
//
// Two of the rules below are the ones that matter, and both are about not
// destroying an archive that already exists:
//
//   1. A configured database is never silently replaced by an empty one. If
//      DATABASE_URL is set and unreachable, that is an error to report, not a
//      reason to start a fresh cluster and show a working, empty site.
//   2. The config file is edited, not rewritten. Every API key the user pasted
//      in by hand is in it.
//
// The third is about not losing a password that was already generated, which is
// a real bug this file was written after finding.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseEnv, setEnv, chooseDatabase, embeddedUrl, redact, newPassword,
  firstRunConfig, isPublicBind, readerUrl, EMBEDDED_PORT, DEFAULT_PORT,
} from '../src/launcher/plan.ts';

const shim = readFileSync(new URL('../src/launcher/shim.cs', import.meta.url), 'utf8');
const launch = readFileSync(new URL('../src/launcher/launch.ts', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-app.ts', import.meta.url), 'utf8');
const role = readFileSync(new URL('../scripts/create-app-role.ts', import.meta.url), 'utf8');

describe('choosing a database', () => {
  it('uses the one that is configured', () => {
    const chosen = chooseDatabase(
      { DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:5432/newstrack' },
      { embeddedAvailable: true },
    );
    expect(chosen?.kind).toBe('configured');
    expect(chosen?.url).toContain('5432');
  });

  it('NEVER falls back to an empty cluster when one is configured', () => {
    // The whole point. This machine has an archive in a PostgreSQL service; a
    // launcher that answers a stopped service by starting its own empty
    // database has told the user their data is gone.
    const chosen = chooseDatabase(
      { DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:5432/newstrack' },
      { embeddedAvailable: true },
    );
    expect(chosen?.kind).not.toBe('embedded');
    expect(chosen?.url).not.toContain(String(EMBEDDED_PORT));
  });

  it('starts its own only when nothing is configured', () => {
    const chosen = chooseDatabase({}, { embeddedAvailable: true });
    expect(chosen?.kind).toBe('embedded');
    expect(chosen?.url).toContain(String(EMBEDDED_PORT));
  });

  it('has nothing to offer when neither exists', () => {
    expect(chooseDatabase({}, { embeddedAvailable: false })).toBeNull();
  });

  it('treats an empty or blank DATABASE_URL as unset', () => {
    // A config file written by hand routinely has `DATABASE_URL=` left in it.
    for (const blank of ['', '   ']) {
      expect(chooseDatabase({ DATABASE_URL: blank }, { embeddedAvailable: true })?.kind)
        .toBe('embedded');
    }
  });

  it('keeps the embedded cluster off the port an installed server uses', () => {
    // 5432 is where the PostgreSQL service is. Binding there would either fail
    // or, after somebody stopped the service, quietly serve a different
    // database under the same name.
    expect(EMBEDDED_PORT).not.toBe(5432);
    expect(embeddedUrl('pw')).toContain('127.0.0.1:' + EMBEDDED_PORT);
  });

  it('survives a password containing URL syntax', () => {
    // base64url cannot produce these, but a rotated password typed in by hand
    // can, and a connection string that silently truncates at "@" connects
    // somewhere else entirely.
    const url = new URL(embeddedUrl('p@ss:w/rd?#'));
    expect(decodeURIComponent(url.password)).toBe('p@ss:w/rd?#');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe(String(EMBEDDED_PORT));
  });

  it('generates a password worth having', () => {
    const a = newPassword();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(newPassword());
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('what gets printed', () => {
  it('never prints the password', () => {
    // This goes to a console the user is looking at and to a log they may well
    // send somebody.
    const said = redact('postgresql://postgres:hunter2@127.0.0.1:5432/newstrack');
    expect(said).not.toContain('hunter2');
    expect(said).toContain('127.0.0.1:5432');
    expect(said).toContain('newstrack');
  });

  it('says so plainly when the string is not a URL', () => {
    expect(redact('garbage')).toContain('unparseable');
  });

  it('opens loopback even when the server is bound wider', () => {
    // 0.0.0.0 is not an address a browser can connect to.
    expect(readerUrl(3000)).toBe('http://127.0.0.1:3000/');
  });
});

describe('the config file', () => {
  it('round-trips through the same rules the application parses with', () => {
    const parsed = parseEnv(firstRunConfig());
    expect(parsed.HOST).toBe('127.0.0.1');
    expect(parsed.PORT).toBe(String(DEFAULT_PORT));
    expect(parsed.PROCESSING_ENABLED).toBe('1');
  });

  it('ships no secrets and no database line', () => {
    // The database line is written once the cluster exists. Every key is empty
    // on purpose: a default file with a credential in it is a credential in
    // every copy of the build.
    const parsed = parseEnv(firstRunConfig());
    for (const key of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY',
      'CEREBRAS_API_KEY', 'GITHUB_TOKEN', 'ADMIN_TOKEN']) {
      expect(parsed[key], key).toBe('');
    }
    expect(parsed.DATABASE_URL).toBeUndefined();
  });

  it('binds to loopback by default', () => {
    expect(isPublicBind(parseEnv(firstRunConfig()).HOST!)).toBe(false);
  });

  it('knows which binds put the archive on the network', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      expect(isPublicBind(host), host).toBe(false);
    }
    for (const host of ['0.0.0.0', '192.168.1.10', '::']) {
      expect(isPublicBind(host), host).toBe(true);
    }
  });

  it('refuses to serve /admin to the network without a token', () => {
    // /admin runs on the owner connection, which bypasses row-level security
    // by design, so a public bind without a token is not a warning.
    expect(launch).toMatch(/isPublicBind\(host\) && !config\.ADMIN_TOKEN/);
  });
});

describe('editing the config rather than rewriting it', () => {
  it('replaces a line in place, keeping everything around it', () => {
    const before = '# a comment\nPORT=3000\nANTHROPIC_API_KEY=sk-secret\n';
    const after = setEnv(before, 'PORT', '8080');
    expect(after).toContain('PORT=8080');
    expect(after).toContain('# a comment');
    // The line the user pasted in by hand. A launcher that regenerates the file
    // from its own map throws this away.
    expect(after).toContain('ANTHROPIC_API_KEY=sk-secret');
    expect(after).not.toContain('PORT=3000');
  });

  it('appends a key that is not there yet', () => {
    expect(parseEnv(setEnv('PORT=3000\n', 'DATABASE_URL', 'postgres://x/y')).DATABASE_URL)
      .toBe('postgres://x/y');
  });

  it('does not run two keys together when the file has no trailing newline', () => {
    const after = setEnv('PORT=3000', 'HOST', '127.0.0.1');
    expect(parseEnv(after).PORT).toBe('3000');
    expect(parseEnv(after).HOST).toBe('127.0.0.1');
  });

  it('does not mistake a key for one that merely contains it', () => {
    // DATABASE_URL and DATABASE_URL_OLD, or PORT and EXPORT. An unanchored
    // pattern rewrites the wrong line and the right one stays stale.
    const before = 'DATABASE_URL_OLD=postgres://old\nDATABASE_URL=postgres://new\n';
    const after = setEnv(before, 'DATABASE_URL', 'postgres://newer');
    expect(parseEnv(after).DATABASE_URL_OLD).toBe('postgres://old');
    expect(parseEnv(after).DATABASE_URL).toBe('postgres://newer');
  });
});

describe('a generated password is never dropped on the floor', () => {
  it('appends when the config has no line to anchor to', () => {
    // The bug this describes: the fallback inserted after DATABASE_APP_ROLE,
    // and the launcher's config file has no such line. String.replace with no
    // match returns the string unchanged -- so the role was created, the
    // password generated, the file written back byte-identical, and the only
    // copy of that password went out of scope. It is not printed, so it was
    // unrecoverable.
    expect(role).toMatch(/else \{\s*\n\s*updated = `\$\{envText\}/);
  });

  it('writes to the file it was told to, not always to .env', () => {
    // The desktop config lives in %LOCALAPPDATA%; the program folder is
    // replaced on every upgrade and need not be writable at all.
    expect(role).toContain('NEWSTRACK_ENV_FILE');
    expect(role).toContain('await writeFile(envPath, updated');
  });

  it('says so rather than pretending, when there is no file to write to', () => {
    expect(role).toMatch(/could not be written/);
  });
});

describe('the launcher does each step once', () => {
  it('never re-runs initdb on a cluster that exists', () => {
    // The worst thing this program could do. PG_VERSION is what initdb writes
    // last, so its presence means a finished cluster.
    expect(launch).toContain("existsSync(join(PGDATA, 'PG_VERSION'))");
  });

  it('seeds only an empty taxonomy, not an empty archive', () => {
    // `stories` is empty on a seeded installation that has not collected yet,
    // and re-seeding it every launch would be a re-seed on every launch.
    expect(launch).toContain('SELECT count(*) AS n FROM stacks');
  });

  it('does not rotate the database passwords on every start', () => {
    // create-app-role.ts rotates on every run, which is right when a person
    // asks for it and wrong on an application start.
    expect(launch).toMatch(/if \(config\.DATABASE_APP_URL && config\.DATABASE_WORKER_URL\) return;/);
  });

  it('stops only a cluster it started itself', () => {
    // Adopting one left running by an earlier session is right. Stopping one
    // somebody else is using is not.
    expect(launch).toContain('if (startedPostgres)');
  });

  it('keeps the archive outside the folder that gets replaced on upgrade', () => {
    expect(launch).toContain('LOCALAPPDATA');
    expect(launch).toMatch(/const PGDATA = join\(DATA, 'pgdata'\)/);
  });

  it('waits for the server before opening a browser at it', () => {
    // Otherwise the first thing the user sees is the browser's own error page.
    expect(launch).toContain("healthz");
    expect(launch).toMatch(/openWhenReady/);
  });
});

describe('the exe', () => {
  it('takes its children down with it however it dies', () => {
    // Ctrl+C and closing the window reach the whole console. End task does
    // not: it kills the shim alone and leaves node.exe serving on a port the
    // next launch then cannot bind. A job object is the only shutdown path
    // that does not depend on this code getting a chance to run.
    expect(shim).toContain('CreateJobObject');
    expect(shim).toContain('AssignProcessToJobObject');
    expect(shim).toMatch(/LimitKillOnJobClose = 0x2000/);
  });

  it('resolves its own folder rather than trusting the working directory', () => {
    // Double-clicking from Explorer sets the working directory to wherever the
    // shortcut points, which is routinely somewhere else.
    expect(shim).toContain('Assembly.GetExecutingAssembly().Location');
  });

  it('holds the window open on the two errors reachable before any logging', () => {
    expect(shim).toContain('Console.ReadLine()');
  });

  it('does not race the launcher to exit on Ctrl+C', () => {
    // The launcher's shutdown stops Postgres, and it needs the parent still
    // waiting when it finishes.
    expect(shim).toMatch(/CancelKeyPress \+= .*e\.Cancel = true/s);
  });
});

describe('the build', () => {
  it('leaves .env out unless it is asked for', () => {
    // A build is a thing people copy about, and .env holds live API keys.
    expect(build).toMatch(/if \(withEnv\)/);
    expect(build).toMatch(/API keys and a database password/);
  });

  it('never copies a cluster into the program folder', () => {
    // `data` under a PostgreSQL install is somebody's archive.
    expect(build).toMatch(/\['bin', 'lib', 'share'\]/);
    expect(build).not.toMatch(/'data'/);
  });

  it('ships the runtime it was built with', () => {
    expect(build).toContain('process.execPath');
  });

  it('does not ship the tests', () => {
    expect(build).not.toMatch(/PARTS = \[[^\]]*'tests'/s);
  });
});

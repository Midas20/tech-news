// The archive must be able to live somewhere that does not bill by the byte.
//
// Asked for on 2026-09-08 -- "I want the site work forever" -- three days after
// the hosted database exhausted its data-transfer allowance and took the site
// down with it. No change to this code makes a metered service unmetered, so
// the answer was to stop requiring one.
//
// Every connection went through @neondatabase/serverless, which does not speak
// to a Postgres server: it speaks to Neon's proxy over HTTP or a WebSocket.
// That is the right driver in a Cloudflare Worker, where there are no TCP
// sockets, and it was the only driver here -- so the archive could only ever
// live on that one service.
//
// What this file guards is the rule that replaced it: the connection string
// decides. Get that wrong in either direction and every query fails at once.

import { describe, it, expect } from 'vitest';
import { isNeon, describeTarget, makePool, closeQueriers } from '../src/db/driver.ts';

describe('choosing a driver from the connection string', () => {
  it('uses the specialised driver for the host that requires it', () => {
    for (const url of [
      'postgresql://u:p@ep-example-name-12345-pooler.c-2.us-east-2.aws.neon.tech/db',
      'postgres://u:p@ep-cool-name-123.eu-central-1.aws.neon.tech/db?sslmode=require',
    ]) {
      expect(isNeon(url), url).toBe(true);
    }
  });

  it('uses node-postgres for anything that is a real server', () => {
    for (const url of [
      'postgresql://postgres:pw@127.0.0.1:5432/newstrack',
      'postgresql://postgres:pw@localhost:5432/newstrack',
      'postgresql://u:p@db.internal:5432/newstrack',
      'postgresql://u:p@some-rds.amazonaws.com:5432/newstrack',
    ]) {
      expect(isNeon(url), url).toBe(false);
    }
  });

  it('is not fooled by a hostname that merely contains the name', () => {
    // The check is on the suffix, so an attacker-controlled or careless host
    // cannot talk this into using the wrong transport.
    for (const url of [
      'postgresql://u:p@neon.tech.example.com:5432/db',
      'postgresql://u:p@myneon.tech.internal:5432/db',
      'postgresql://u:p@not-neon.tech.evil.test:5432/db',
    ]) {
      expect(isNeon(url), url).toBe(false);
    }
  });

  it('treats an unparseable string as an ordinary server', () => {
    // `pg` reports a malformed URL clearly; the Neon driver does not.
    for (const bad of ['', 'not a url', 'postgres://', '://x']) {
      expect(isNeon(bad)).toBe(false);
    }
  });

  it('builds a pool for a local server without reaching the network', async () => {
    // Constructing a pg Pool connects nothing; the first query does. This is
    // the check that the local path is wired at all.
    const pool = makePool('postgresql://postgres:pw@127.0.0.1:5432/newstrack');
    expect(typeof pool.query).toBe('function');
    expect(typeof pool.connect).toBe('function');
    expect(typeof pool.end).toBe('function');
    await pool.end();
  });

  it('exposes connect(), which one caller genuinely needs', async () => {
    // withTenant() sets app.tenant_id and then reads under it. Both statements
    // must land on the same connection or RLS applies a setting that was never
    // made, which fails open rather than closed.
    const pool = makePool('postgresql://postgres:pw@127.0.0.1:5432/newstrack');
    expect(pool.connect).toBeTypeOf('function');
    await pool.end();
  });
});

describe('saying where the data is', () => {
  it('names the driver and the target without leaking the password', () => {
    const said = describeTarget(
      'postgresql://postgres:hunter2@127.0.0.1:5432/newstrack');
    expect(said).toContain('postgres');
    expect(said).toContain('127.0.0.1:5432');
    expect(said).not.toContain('hunter2');
  });

  it('distinguishes the two so a log line is worth reading', () => {
    expect(describeTarget('postgresql://u:p@x.neon.tech/db')).toMatch(/^neon /);
    expect(describeTarget('postgresql://u:p@127.0.0.1:5432/db')).toMatch(/^postgres /);
  });

  it('says so plainly when the string is not a URL', () => {
    expect(describeTarget('garbage')).toContain('unparseable');
  });
});

describe('one-shot queriers', () => {
  it('can be released, so a test or a shutdown leaves no socket open', async () => {
    await expect(closeQueriers()).resolves.toBeUndefined();
  });
});

// Creates the non-owner application role and points DATABASE_APP_URL at it.
//
// WHY THIS EXISTS
//
// neondb_owner has the BYPASSRLS attribute. That is stronger than table
// ownership: FORCE ROW LEVEL SECURITY closes the owner exemption, but a role
// carrying BYPASSRLS skips row-level security altogether, on every table, with
// no error and no log line. Tenant isolation tested on that role is not a test
// of anything.
//
// So the runtime connects as a role that does NOT have it. The owner keeps
// migrations (DATABASE_DIRECT_URL); everything else uses DATABASE_APP_URL.
//
//   node --experimental-strip-types scripts/create-app-role.ts
//
// The generated password is written to .env and never printed.

import { makePool } from '../src/db/driver.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { loadDotEnv } from '../src/lib/dotenv.ts';

await loadDotEnv();

const adminUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!adminUrl) {
  console.error('DATABASE_DIRECT_URL / DATABASE_URL is not set.');
  process.exit(1);
}

// Two runtime roles, neither of them the owner:
//   app_user     the UI and agent. Reads global tables, reads/writes tenant
//                tables under RLS, cannot see tenant_secrets.
//   worker_user  the collector. Writes global tables, has no business reading
//                any tenant's rows, and carries no BYPASSRLS -- so a deployed
//                Worker never holds owner credentials.
const wantWorker = process.argv.includes('--worker');
const roleName = wantWorker
  ? (process.env.DATABASE_WORKER_ROLE || 'worker_user')
  : (process.env.DATABASE_APP_ROLE || 'app_user');
const password = randomBytes(24).toString('base64url');

const pool = makePool(adminUrl);
const client = await pool.connect();

try {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
  if (exists.rows.length > 0) {
    console.log(`role ${roleName} exists; rotating its password and re-applying grants`);
    await client.query(`ALTER ROLE ${quote(roleName)} WITH LOGIN PASSWORD '${escape(password)}' NOBYPASSRLS`);
  } else {
    await client.query(`CREATE ROLE ${quote(roleName)} WITH LOGIN PASSWORD '${escape(password)}' NOBYPASSRLS`);
    console.log(`created role ${roleName}`);
  }

  const db = (await client.query('SELECT current_database() AS db')).rows[0].db as string;
  await client.query(`GRANT CONNECT ON DATABASE ${quote(db)} TO ${quote(roleName)}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${quote(roleName)}`);

  // Inherit the read/write surface migration 0010 defined, rather than
  // re-deriving it here and letting the two drift apart.
  await client.query(`GRANT ${wantWorker ? 'newstrack_worker' : 'newstrack_app'} TO ${quote(roleName)}`);

  if (wantWorker) {
    // The collector writes the whole global archive: sources, stories, members,
    // snapshots, jobs, caches, budgets.
    await client.query(`
      GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${quote(roleName)}`);
    await client.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE ON TABLES TO ${quote(roleName)}`);
  } else {
    // The app role reads global tables and reads/writes tenant-scoped ones under
    // RLS. It is never granted tenant_secrets -- bot tokens stay out of its reach
    // entirely, which is a GRANT decision, not a policy decision.
    await client.query(`
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${quote(roleName)}`);
    await client.query(`
      GRANT INSERT, UPDATE ON channels, users, saved_views, saved_items, analyses,
                              delivery_feedback, thread_state TO ${quote(roleName)}`);
  }
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quote(roleName)}`);
  // Keep this list in step with migration 0010: the blanket SELECT above is a
  // convenience, and these tables are deliberately outside the app's reach.
  if (wantWorker) {
    // NOT revoked here, deliberately: the collector becomes the deliverer in
    // Phase 4 and needs the workspace bot token to post. Its protection is that
    // it is not the owner and carries no BYPASSRLS -- it still cannot read one
    // tenant's rows while acting for another.
  } else {
    // These two revokes actually bite: newstrack_app was never granted either,
    // so nothing re-grants them through role membership.
    await client.query(`REVOKE ALL ON tenant_secrets FROM ${quote(roleName)}`);
    await client.query(
      `REVOKE ALL ON provider_budgets, llm_cache, jobs, source_budgets FROM ${quote(roleName)}`);
  }
  await client.query(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${quote(roleName)}`);

  const check = await client.query(
    'SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1', [roleName],
  );
  if (check.rows[0].rolbypassrls || check.rows[0].rolsuper) {
    console.error(`REFUSING: ${roleName} still has BYPASSRLS/SUPERUSER; RLS would not apply to it.`);
    process.exit(1);
  }
  console.log(`${roleName}: rolbypassrls=false rolsuper=false  <- RLS applies`);

  // Rewrite DATABASE_APP_URL in .env, keeping the host from the pooled URL.
  const pooled = process.env.DATABASE_URL ?? adminUrl;
  const appUrl = new URL(pooled);
  appUrl.username = roleName;
  appUrl.password = password;

  const varName = wantWorker ? 'DATABASE_WORKER_URL' : 'DATABASE_APP_URL';

  // WHICH FILE. The desktop launcher keeps its configuration in %LOCALAPPDATA%
  // rather than in a .env beside the code -- the program folder is replaced on
  // every upgrade and may not even be writable. It passes the path here rather
  // than copying this logic, so there is one place that knows how to write a
  // connection string and one file it lands in.
  const envPath = process.env.NEWSTRACK_ENV_FILE || '.env';

  let envText: string;
  try {
    envText = await readFile(envPath, 'utf8');
  } catch {
    // The role exists and the grants are applied -- that work is done, and
    // saying otherwise would be wrong. What is missing is somewhere to write
    // the password down, and the password is never printed, so the caller has
    // to create the file and run this again.
    console.error(`${roleName} was created, but ${envPath} does not exist, so `
      + `${varName} could not be written. The generated password is now unrecoverable; `
      + `create the file and run this again to rotate it.`);
    process.exit(1);
  }
  const line = `${varName}=${appUrl.toString()}`;
  const pattern = new RegExp(`^${varName}=.*$`, 'm');
  const note = '\n# Runtime connection. Non-owner, NOBYPASSRLS -- this is the one RLS protects.\n';

  // Three cases, and the third one used to be missing. Replacing an existing
  // line is the common one; inserting after DATABASE_APP_ROLE keeps the pair
  // together in a .env written from .env.example. But a config file with
  // neither -- which is exactly what the desktop launcher writes -- matched
  // nothing, and String.replace with no match returns the string unchanged.
  // The role would be created, the password generated, the file written back
  // byte-identical, and the only copy of that password would go out of scope.
  // Appending is the fallback, because a line at the end of the file is worth
  // more than a tidy one that does not exist.
  let updated: string;
  if (pattern.test(envText)) {
    updated = envText.replace(pattern, line);
  } else if (/^DATABASE_APP_ROLE=.*$/m.test(envText)) {
    updated = envText.replace(/^DATABASE_APP_ROLE=.*$/m, (m) => `${m}\n${note}${line}`);
  } else {
    updated = `${envText}${envText.endsWith('\n') ? '' : '\n'}${note}${line}\n`;
  }
  await writeFile(envPath, updated, 'utf8');
  console.log(`${varName} written to ${envPath} (password not printed)`);
} finally {
  client.release();
  await pool.end();
}

function quote(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) throw new Error(`unsafe identifier: ${identifier}`);
  return `"${identifier}"`;
}

function escape(literal: string): string {
  return literal.replace(/'/g, "''");
}

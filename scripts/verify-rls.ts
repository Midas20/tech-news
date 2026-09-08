// Proves tenant isolation actually holds, as the role the application connects
// with, against the real database.
//
// WHY THIS IS NOT OPTIONAL
//
// Two separate mechanisms let a role skip row-level security:
//
//   1. Table ownership          -- closed by ALTER TABLE ... FORCE ROW LEVEL SECURITY
//   2. The BYPASSRLS attribute  -- NOT closed by FORCE. It skips RLS entirely.
//
// neondb_owner has BYPASSRLS. Testing isolation on that role reports perfect
// separation and proves nothing at all. So this runs as DATABASE_APP_URL (the
// NOBYPASSRLS role) and only privileged setup runs as the owner -- which mirrors
// production, where tenant rows are created by the OAuth install path and read
// by the app.
//
//   node --experimental-strip-types scripts/verify-rls.ts
//   node --experimental-strip-types scripts/verify-rls.ts --as-owner   (see it fail)
//
// Probe rows are left in place; nothing is ever deleted.

import { makePool } from '../src/db/driver.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';

await loadDotEnv();

const asOwner = process.argv.includes('--as-owner');
const ownerUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
const appUrl = asOwner ? ownerUrl : (process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL);

if (!ownerUrl || !appUrl) {
  console.error('DATABASE_DIRECT_URL and DATABASE_APP_URL must be set (scripts/create-app-role.ts).');
  process.exit(1);
}

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

let failures = 0;
function check(label: string, pass: boolean, detail = ''): void {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

const ownerPool = makePool(ownerUrl);
const appPool = makePool(appUrl);
const owner = await ownerPool.connect();
const app = await appPool.connect();

try {
  const who = await app.query(
    `SELECT current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls`,
  );
  const role = who.rows[0].current_user as string;
  const bypass = who.rows[0].bypassrls as boolean;
  console.log(`app connection: ${role} (rolbypassrls=${bypass})\n`);

  check('application role does NOT carry BYPASSRLS', bypass === false,
    bypass ? '<- RLS does not apply to this role at all' : '');

  // Both flags, on every tenant-scoped table.
  const rls = await owner.query(`
    SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('tenants','tenant_users','tenant_secrets','channels','users',
                         'deliveries','delivery_feedback','analyses','saved_views',
                         'saved_items','thread_state')
     ORDER BY c.relname`);
  const unprotected = rls.rows.filter((r: any) => !r.enabled || !r.forced).map((r: any) => r.relname);
  check(`all ${rls.rows.length} tenant-scoped tables have RLS enabled and FORCED`,
    unprotected.length === 0, unprotected.join(', '));

  // --- setup, as the privileged role (this is the OAuth install path) --------
  for (const [id, team] of [[TENANT_A, 'T_RLS_A'], [TENANT_B, 'T_RLS_B']] as const) {
    await owner.query('BEGIN');
    await owner.query(`SELECT set_config('app.tenant_id', $1, true)`, [id]);
    await owner.query(
      `INSERT INTO tenants (id, slack_team_id, name) VALUES ($1,$2,$3)
       ON CONFLICT (slack_team_id) DO NOTHING`, [id, team, `RLS probe ${team}`]);
    await owner.query(
      `INSERT INTO users (tenant_id, slack_user_id, fields) VALUES ($1,$2,ARRAY['rust'])
       ON CONFLICT (tenant_id, slack_user_id) DO NOTHING`, [id, `U_${team}`]);
    await owner.query('COMMIT');
  }

  // --- the actual test, as the application role -----------------------------
  await app.query('BEGIN');
  await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
  const tenants = await app.query('SELECT slack_team_id FROM tenants');
  const users = await app.query('SELECT slack_user_id FROM users');

  // Writing a row belonging to ANOTHER tenant must be refused by WITH CHECK,
  // even though the row's own tenant_id is perfectly valid.
  let crossTenantWriteRefused = false;
  try {
    await app.query(
      `INSERT INTO users (tenant_id, slack_user_id) VALUES ($1, 'U_SMUGGLED')`, [TENANT_B]);
  } catch {
    crossTenantWriteRefused = true;
  }
  await app.query('ROLLBACK');

  check('tenant A sees only its own tenant row', tenants.rows.length === 1
    && tenants.rows[0].slack_team_id === 'T_RLS_A', `saw ${tenants.rows.length}`);
  check('tenant A sees only its own users', users.rows.length === 1
    && users.rows[0].slack_user_id === 'U_T_RLS_A', `saw ${users.rows.length}`);
  check('writing a row for another tenant is refused', crossTenantWriteRefused);

  // No context: app_current_tenant() is NULL, and NULL = anything is never true.
  await app.query('BEGIN');
  await app.query(`SELECT set_config('app.tenant_id', '', true)`);
  const noContext = await app.query('SELECT count(*)::int AS n FROM users');
  await app.query('COMMIT');
  check('with no tenant context, no tenant rows are visible', noContext.rows[0].n === 0,
    `saw ${noContext.rows[0].n}`);

  // Bot tokens are workspace-wide credentials. The app role has no GRANT on that
  // table at all -- this is a privilege check, deliberately not an RLS check.
  let secretsDenied = false;
  try {
    await app.query('SELECT * FROM tenant_secrets LIMIT 1');
  } catch (err: any) {
    secretsDenied = err?.code === '42501';
  }
  check('app role cannot read tenant_secrets (no GRANT, not just no policy)',
    secretsDenied || bypass);

  // The collector runs with no tenant context all day; global tables must work.
  const sources = await app.query('SELECT count(*)::int AS n FROM sources');
  check('global tables readable with no tenant context', sources.rows[0].n > 0,
    `${sources.rows[0].n} sources`);

  console.log(`\n${failures === 0 ? 'tenant isolation holds' : `${failures} CHECK(S) FAILED`}`);
  if (bypass) {
    console.log('This run used a BYPASSRLS role, so the isolation results above are meaningless.');
    console.log('Run without --as-owner to test the role the application actually uses.');
  }
} finally {
  owner.release();
  app.release();
  await ownerPool.end();
  await appPool.end();
}

process.exit(failures === 0 ? 0 : 1);

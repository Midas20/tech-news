// Seeds the work platforms, checking every address first.
//
//   npm run seed:work
//
// Idempotent: each platform is upserted by slug. A platform whose address does
// not answer at all, or answers 404, is reported and NOT written -- a link on
// the page that goes nowhere is worse than a platform left off it. A 403 is
// written: several large marketplaces refuse automated requests while serving
// people normally, and the status is stored so the difference stays visible.

import { loadDotEnv } from '../src/lib/dotenv.ts';
import { createDb } from '../src/db/client.ts';
import { WORK_PLATFORMS } from '../seeds/workplatforms.ts';

await loadDotEnv();
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

async function status(address: string): Promise<number> {
  try {
    const res = await fetch(address, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; NewsTrack platform check)' },
      signal: AbortSignal.timeout(20_000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

let written = 0;
for (const p of WORK_PLATFORMS) {
  const code = await status(p.url);
  const ok = code !== 0 && code !== 404 && code !== 410;
  console.log(`${ok ? 'ok  ' : 'SKIP'} ${String(code).padStart(3)} ${p.name} ${p.url}`);
  if (!ok) continue;
  await db.query(
    `INSERT INTO work_platforms (slug, name, url, kind, how, markets, measured_by, check_status, checked_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, now(), now())
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, kind = EXCLUDED.kind,
       how = EXCLUDED.how, markets = EXCLUDED.markets, measured_by = EXCLUDED.measured_by,
       check_status = EXCLUDED.check_status, checked_at = now(), updated_at = now()`,
    [p.slug, p.name, p.url, p.kind, p.how, p.markets, p.measuredBy ?? null, code]);
  written += 1;
}
console.log(`${written} of ${WORK_PLATFORMS.length} platforms written.`);
process.exit(0);

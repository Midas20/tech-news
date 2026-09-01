// Seed the earning-platform registry, and check every URL.
//
//   npm run seed:platforms
//
// Identity only. Facts -- fees, payout thresholds, country restrictions -- are
// deliberately absent: `platform_facts` models each as a value with a source URL,
// a confidence and a validity window precisely because those numbers go stale,
// and typing them into a seed file produces the confident undated claim that
// schema exists to prevent.

import { Pool } from '@neondatabase/serverless';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { mapWithConcurrency } from '../src/lib/pool.ts';
import { PLATFORMS } from '../seeds/platforms.ts';

await loadDotEnv();

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_DIRECT_URL is not set.');
  process.exit(1);
}

const check = !process.argv.includes('--no-check');

const pool = new Pool({ connectionString: url });
const client = await pool.connect();

try {
  let added = 0;
  let updated = 0;

  for (const p of PLATFORMS) {
    const res = await client.query(
      `INSERT INTO platforms (slug, name, url, channel_type_id, fact_pages)
       VALUES ($1, $2, $3, $4, $5::text[])
       ON CONFLICT (slug) DO UPDATE
          SET name = EXCLUDED.name, url = EXCLUDED.url,
              channel_type_id = EXCLUDED.channel_type_id,
              fact_pages = EXCLUDED.fact_pages, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [p.slug, p.name, p.url, p.channel, p.factPages ?? []]);
    if (res.rows[0]?.inserted) added++; else updated++;
  }
  console.log(`platforms: ${added} added, ${updated} updated`);

  if (check) {
    // A registry of dead links is worse than an empty one. Status is recorded
    // rather than assumed: 'closed' is a real answer about an earning platform.
    console.log('checking every platform URL…');
    let live = 0;
    let gone = 0;

    await mapWithConcurrency(PLATFORMS, 6, async (p) => {
      let status: string = 'unknown';
      try {
        const res = await fetch(p.url, {
          redirect: 'follow',
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
              + 'Chrome/131.0.0.0 Safari/537.36',
            accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(15_000),
        });
        // 403 and 429 are both a live server refusing an automated request --
        // a bot wall and a rate limit -- not a closed business. Several of
        // these sit behind one and are perfectly fine in a browser.
        // aptosfoundation.org answers 429 to this checker and 200 to a person,
        // and filing it as 'unknown' put a question mark on a working chain.
        //
        // 405 joins them: a host that refuses the METHOD has still answered.
        status = res.ok || res.status === 403 || res.status === 429 || res.status === 405
          ? 'active'
          : res.status === 404 ? 'closed' : 'unknown';
      } catch {
        status = 'unknown';
      }
      if (status === 'active') live++; else gone++;
      await client.query('UPDATE platforms SET status = $2, updated_at = now() WHERE slug = $1',
        [p.slug, status]);
    });

    console.log(`  ${live} answered, ${gone} did not`);
  }

  const [{ n }] = (await client.query('SELECT count(*)::text AS n FROM platforms')).rows;
  const [{ f }] = (await client.query('SELECT count(*)::text AS f FROM platform_facts')).rows;
  console.log(`registry: ${n} platforms · ${f} facts collected`);
} finally {
  client.release();
  await pool.end();
}

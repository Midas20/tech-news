// Seed the company registry and its first-party channels.
//
//   node --experimental-strip-types scripts/seed-companies.ts
//   node --experimental-strip-types scripts/seed-companies.ts --dry-run
//
// Idempotent, like the taxonomy seed. Announcement channels are inserted as
// ordinary sources with company_slug set -- that column is what makes a story an
// announcement rather than coverage, and it is the only thing distinguishing
// "Cloudflare says" from "someone says about Cloudflare".
//
// Existing sources are linked too: several company blogs were already seeded by
// name in sources.ts, and re-adding them under a new URL would duplicate the feed.

import { makePool } from '../src/db/driver.ts';
import { COMPANY_SEEDS } from '../seeds/companies.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';

await loadDotEnv();

const dryRun = process.argv.includes('--dry-run');
const channels = COMPANY_SEEDS.reduce((n, c) => n + (c.announce?.length ?? 0), 0);
console.log(`companies: ${COMPANY_SEEDS.length}`);
console.log(`first-party channels: ${channels}`);
if (dryRun) process.exit(0);

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const pool = makePool(url);
const client = await pool.connect();

let linked = 0;
let created = 0;

try {
  await client.query('BEGIN');

  for (const c of COMPANY_SEEDS) {
    await client.query(
      `INSERT INTO companies (slug, name, aliases, category, country, ticker,
                              homepage_url, newsroom_url, blog_url, github_org, stacks, curated)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         aliases = EXCLUDED.aliases,
         category = EXCLUDED.category,
         country = EXCLUDED.country,
         ticker = EXCLUDED.ticker,
         homepage_url = coalesce(EXCLUDED.homepage_url, companies.homepage_url),
         github_org = coalesce(EXCLUDED.github_org, companies.github_org),
         stacks = EXCLUDED.stacks,
         curated = true`,
      [
        c.slug, c.name, c.aliases, c.category, c.country ?? null, c.ticker ?? null,
        c.homepage ?? null,
        c.announce?.find((a) => a.kind !== 'status')?.url ?? null,
        c.announce?.[0]?.url ?? null,
        c.githubOrg ?? null, c.stacks ?? [],
      ],
    );

    for (const channel of c.announce ?? []) {
      // Link an existing row rather than inserting a duplicate feed: several
      // company blogs are already in the registry from sources.ts.
      const existing = await client.query(
        `UPDATE sources SET company_slug = $1
          WHERE (lower(url) = lower($2) OR lower(name) = lower($3))
            AND (company_slug IS NULL OR company_slug = $1)
          RETURNING id`,
        [c.slug, channel.url, channel.name],
      );

      if (existing.rows.length > 0) {
        linked += existing.rows.length;
        continue;
      }

      await client.query(
        `INSERT INTO sources (name, url, feed_kind, kind, roles, lang, country,
                              trust_weight, weight_content, fields, poll_interval_seconds,
                              politeness_seconds, shard, curated, company_slug, notes)
         VALUES ($1,$2,'rss',$3::source_kind,ARRAY['PRIMARY','CONTENT']::source_role[],'en',$4,
                 0.95,0.9,$5,$6,2,$7,true,$8,'first-party announcement channel')
         ON CONFLICT (url) DO UPDATE SET company_slug = EXCLUDED.company_slug`,
        [
          channel.name, channel.url,
          channel.kind === 'status' ? 'status' : 'news',
          c.country ?? null, c.stacks ?? [],
          // Announcements are worth checking often; status pages more so.
          channel.kind === 'status' ? 900 : 3600,
          1 + (created % 5),
          c.slug,
        ],
      );
      created++;
    }
  }

  // GitHub release feeds belong to whoever owns the org.
  const byOrg = await client.query(
    `UPDATE sources s SET company_slug = c.slug
       FROM companies c
      WHERE c.github_org IS NOT NULL
        AND s.company_slug IS NULL
        AND lower(s.url) LIKE 'https://github.com/' || lower(c.github_org) || '/%'
      RETURNING s.id`);

  await client.query('COMMIT');
  console.log(`linked ${linked} existing sources, created ${created} new channels`);
  console.log(`matched ${byOrg.rows.length} GitHub release feeds by org`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await pool.end();
}

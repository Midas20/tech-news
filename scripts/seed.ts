// Seed the reference data: the closed taxonomy and the source registry.
//
// Idempotent. Re-running updates curated rows in place and never touches rows
// the discovery loop added (curated = false), so a re-seed cannot silently
// overwrite what the system learned about a source.
//
//   node --experimental-strip-types scripts/seed.ts
//   node --experimental-strip-types scripts/seed.ts --dry-run

import { Pool } from '@neondatabase/serverless';
import { stackSeeds } from '../seeds/stacks.ts';
import { SOURCE_SEEDS, shardFor, type SourceSeed } from '../seeds/sources.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';

async function main(): Promise<void> {
  await loadDotEnv();
  const dryRun = process.argv.includes('--dry-run');
  const stacks = stackSeeds();
  const releaseFeeds = derivedReleaseFeeds();

  console.log(`stacks:         ${stacks.length}`);
  console.log(`sources (hand): ${SOURCE_SEEDS.length}`);
  console.log(`sources (github release feeds derived from stacks): ${releaseFeeds.length}`);
  console.log(`sources total:  ${SOURCE_SEEDS.length + releaseFeeds.length}`);

  if (dryRun) return;

  const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Nothing was executed. Use --dry-run to inspect the seed.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Pass 1: rows without parents, so every parent_id target exists in pass 2.
    for (const s of stacks) {
      await client.query(
        `INSERT INTO stacks (slug, name, category, aliases, repo_url, docs_url,
                             release_feed_url, curated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           aliases = EXCLUDED.aliases,
           repo_url = coalesce(EXCLUDED.repo_url, stacks.repo_url),
           docs_url = coalesce(EXCLUDED.docs_url, stacks.docs_url),
           release_feed_url = coalesce(EXCLUDED.release_feed_url, stacks.release_feed_url),
           curated = true`,
        [s.slug, s.name, s.category, s.aliases, s.repo_url, s.docs_url, s.release_feed_url],
      );
    }

    // Pass 2: hierarchy.
    for (const s of stacks) {
      if (!s.parent) continue;
      await client.query(
        `UPDATE stacks SET parent_id = (SELECT id FROM stacks WHERE slug = $2) WHERE slug = $1`,
        [s.slug, s.parent],
      );
    }

    const skipped: string[] = [];

    // Two seeds may name the same feed by different addresses. A first-party
    // changelog written by hand -- "Terraform releases", url
    // github.com/hashicorp/terraform -- and the release feed derived
    // mechanically from the same repository resolve to one releases.atom, and
    // `feed_url` is unique. The upsert keys on `url`, so neither one sees the
    // other and the insert fails on the constraint instead.
    //
    // Hand-written wins: it was chosen, it carries the fields and the notes,
    // and the derived one is a default. Skipped rows are counted out loud --
    // a seeder that quietly drops feeds is how a source goes missing.
    const claimed = new Map<string, string>();
    const wanted = [...SOURCE_SEEDS, ...releaseFeeds].filter((seed) => {
      if (!seed.feedHint) return true;
      const owner = claimed.get(seed.feedHint);
      if (owner) {
        skipped.push(`${seed.name} -> ${seed.feedHint} (already seeded as ${owner})`);
        return false;
      }
      claimed.set(seed.feedHint, seed.name);
      return true;
    });
    if (skipped.length > 0) {
      console.log(`skipped ${skipped.length} duplicate feed${skipped.length === 1 ? '' : 's'}:`);
      for (const line of skipped) console.log(`  ${line}`);
    }

    let index = 0;
    for (const seed of wanted) {
      // Name the row that failed. A unique-violation from a 484-row loop that
      // says only "duplicate key value violates sources_feed_url_key" costs an
      // afternoon of bisecting a seed file; the constraint knows which column,
      // and this knows which row, and neither is any use without the other.
      try {
        await insertSource(client, seed, index++);
      } catch (err) {
        throw new Error(
          `seeding source "${seed.name}" (${seed.url}`
          + `${seed.feedHint ? ` -> ${seed.feedHint}` : ''}): ${(err as Error).message}`,
          { cause: err });
      }
    }

    await client.query('COMMIT');
    console.log('seed complete');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function insertSource(client: any, seed: SourceSeed, index: number): Promise<void> {
  await client.query(
    `INSERT INTO sources (name, url, feed_url, feed_kind, roles, lang, country,
                          trust_weight, weight_content, never_canonical, fields,
                          poll_interval_seconds, politeness_seconds, requires_secret,
                          shard, curated, notes, company_slug)
     VALUES ($1,$2,$3,$4,$5::source_role[],$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,$16,$17)
     ON CONFLICT (url) DO UPDATE SET
       name = EXCLUDED.name,
       roles = EXCLUDED.roles,
       trust_weight = EXCLUDED.trust_weight,
       weight_content = EXCLUDED.weight_content,
       never_canonical = EXCLUDED.never_canonical,
       fields = EXCLUDED.fields,
       poll_interval_seconds = EXCLUDED.poll_interval_seconds,
       requires_secret = EXCLUDED.requires_secret,
       shard = EXCLUDED.shard,
       curated = true,
       notes = EXCLUDED.notes,
       company_slug = EXCLUDED.company_slug`,
    [
      seed.name,
      seed.url,
      // The hint is a starting point only: autodiscovery overwrites it on the
      // first poll if the site advertises something different.
      seed.feedHint ?? null,
      seed.feedKind ?? 'rss',
      seed.roles,
      seed.lang ?? null,
      seed.country ?? null,
      seed.trust ?? 0.5,
      seed.weightContent ?? 1.0,
      seed.neverCanonical ?? false,
      seed.fields ?? [],
      seed.pollSeconds ?? 3600,
      // arXiv asks for 3 seconds between requests and means it.
      seed.name === 'arXiv cs' ? 3 : 2,
      seed.requiresSecret ?? null,
      shardFor(seed, index),
      seed.notes ?? null,
      seed.companySlug ?? null,
    ],
  );
}

/**
 * GitHub release feeds, derived mechanically from the taxonomy rather than
 * hand-listed. Every repo exposes /releases.atom, so 205 curated repos become
 * 205 PRIMARY sources with no guessing and no maintenance.
 */
function derivedReleaseFeeds(): SourceSeed[] {
  const seen = new Set<string>();
  return stackSeeds()
    .filter((s) => {
      if (!s.repo_url || !s.release_feed_url) return false;
      // sources.url is unique; two stacks pointing at one repo must not collide.
      if (seen.has(s.repo_url)) return false;
      seen.add(s.repo_url);
      return true;
    })
    .map((s) => ({
      name: `${s.name} releases`,
      url: s.repo_url!,
      feedHint: s.release_feed_url!,
      feedKind: 'atom' as const,
      roles: ['PRIMARY'],
      lang: 'en' as const,
      trust: 1.0,
      weightContent: 0.8,
      fields: [s.slug],
      pollSeconds: 3600,
      notes: 'derived from stacks.repo_url',
    }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

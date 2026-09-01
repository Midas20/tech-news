// Empty the registry and put back the professional press, and nothing else.
//
//   npm run reset:sources            what it would do, and nothing else
//   npm run reset:sources -- --apply do it
//
// This is the destructive script in the repository and it is written to look
// like one. It refuses to run without --apply, it prints the counts it is about
// to destroy, and it does the whole thing in one transaction so a failure
// halfway leaves the database exactly as it was.
//
// WHAT IS DESTROYED
//   every source, every story, every membership row, every engagement snapshot,
//   every rejection record. Stories cannot be recovered: the pages they were
//   extracted from are not stored, by design (spec 0).
//
// WHAT SURVIVES, AND WHY
//   archive_history, stack_history, stack_totals -- the monthly aggregate. It
//   reaches back to 2010-01 and NOTHING can rebuild it: the stories it
//   summarises were pruned by the retention contract months and years ago.
//   "One month of news, analysis forever" is the contract, and this is the one
//   place where getting it wrong would be permanent.
//
//   the vocabulary -- stacks, platforms, companies. 2,330 technologies with
//   hand-assigned parents are not a by-product of collection.
//
//   favourites, and the stories behind them. "Favourites exempt" is the other
//   half of the retention contract. A favourited story keeps its source row
//   too, paused and marked, because a story whose provenance has been deleted
//   is a quotation with no attribution.

// A POOLED client, not the HTTP one every other script uses.
//
// createDb() is the Neon HTTP driver: one request per query, no session. Sending
// it BEGIN and COMMIT does not open a transaction -- each statement is its own
// request and autocommits, so the rollback below would have been decoration and
// a failure halfway would have left the registry half-deleted. The one script
// that genuinely needs all-or-nothing is the one script that has to hold a
// connection open.
import { Pool } from '@neondatabase/serverless';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { NEWS_SOURCES } from '../seeds/news.ts';
import { shardFor } from '../seeds/sources.ts';

await loadDotEnv();
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const apply = process.argv.includes('--apply');

const pool = new Pool({ connectionString: url });
const db = await pool.connect();

const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-US');
const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await db.query(sql, params)).rows[0]?.n ?? 0);
const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];
const done = async (code = 0): Promise<never> => {
  db.release();
  await pool.end();
  process.exit(code);
};

// --- what is here now -------------------------------------------------------
const before = {
  sources: await count(`SELECT count(*)::text n FROM sources`),
  stories: await count(`SELECT count(*)::text n FROM stories`),
  members: await count(`SELECT count(*)::text n FROM story_members`),
  rejects: await count(`SELECT count(*)::text n FROM story_rejects`),
  snapshots: await count(`SELECT count(*)::text n FROM engagement_snapshots`),
  favourites: await count(`SELECT count(*)::text n FROM favourites WHERE unfavourited_at IS NULL`),
  archiveMonths: await count(`SELECT count(*)::text n FROM archive_history`),
  stackHistory: await count(`SELECT count(*)::text n FROM stack_history`),
  stacks: await count(`SELECT count(*)::text n FROM stacks`),
};

// The stories that must live, and the sources they need for attribution.
const keepStories = (await rows<{ id: string }>(
  `SELECT DISTINCT f.story_id::text AS id FROM favourites f
     JOIN stories s ON s.id = f.story_id WHERE f.unfavourited_at IS NULL`)).map((r) => r.id);
const keepSources = await rows<{ id: string; name: string }>(
  `SELECT DISTINCT s.source_id::text AS id, src.name FROM stories s
     JOIN sources src ON src.id = s.source_id
    WHERE s.id = ANY($1::uuid[])`, [keepStories]);

console.log('now:');
console.log(`  sources               ${n(before.sources)}`);
console.log(`  stories               ${n(before.stories)}`);
console.log(`  story_members         ${n(before.members)}`);
console.log(`  story_rejects         ${n(before.rejects)}`);
console.log(`  engagement_snapshots  ${n(before.snapshots)}`);
console.log('');
console.log('kept, whatever happens:');
console.log(`  archive_history       ${n(before.archiveMonths)} months`);
console.log(`  stack_history         ${n(before.stackHistory)} rows`);
console.log(`  stacks                ${n(before.stacks)} technologies`);
console.log(`  favourites            ${n(before.favourites)}`);
if (keepStories.length) {
  console.log(`    ...and the ${keepStories.length} stor${keepStories.length === 1 ? 'y' : 'ies'} behind them, `
    + `plus ${keepSources.length} source row${keepSources.length === 1 ? '' : 's'} for attribution, paused: `
    + keepSources.map((s) => s.name).join(', '));
}
console.log('');
console.log(`going back in: ${NEWS_SOURCES.length} sources`);
for (const s of NEWS_SOURCES) console.log(`  ${s.name.padEnd(20)} ${s.feedHint ?? s.url}`);

if (!apply) {
  console.log('');
  console.log('(dry run. `npm run reset:sources -- --apply` to do it.)');
  await done();
}

// --- do it ------------------------------------------------------------------
// One transaction. Order matters: everything pointing AT a source has to go
// before the source does, because stories.source_id is ON DELETE NO ACTION --
// deliberately, so that a careless DELETE on sources fails loudly instead of
// silently taking the archive with it.
await db.query('BEGIN');
try {
  const keptSourceIds = keepSources.map((s) => s.id);

  // Parents before children, which is the opposite of the usual order and is
  // what this schema requires. story_members, coverage_snapshots and
  // engagement_snapshots each carry forbid_orphan_only_delete(): a row may be
  // deleted only once its story is already gone. That rule is right -- it makes
  // "was this child still needed" un-arguable -- so it is obeyed here rather
  // than suspended. Deleting the members first fails, loudly, and did.
  await db.query(`DELETE FROM stories WHERE NOT (id = ANY($1::uuid[]))`, [keepStories]);
  for (const t of ['story_members', 'coverage_snapshots', 'engagement_snapshots']) {
    await db.query(`DELETE FROM ${t} WHERE NOT (story_id = ANY($1::uuid[]))`, [keepStories]);
  }
  // The work queue, which the first version of this script forgot.
  //
  // The jobs table carries a bare storyId in its payload -- no foreign key,
  // because stories is partitioned -- so deleting stories leaves the queue pointing
  // at rows that no longer exist. Measured two days after the reset: 24,045
  // pending jobs of which 24,011 were ghosts, ahead of every real one in a
  // FIFO. A worker draining that queue would spend its entire budget learning
  // that 24,011 stories are gone before reaching today's.
  await db.query(
    `DELETE FROM jobs j WHERE NOT EXISTS (
       SELECT 1 FROM stories s WHERE s.id = (j.payload->>'storyId')::uuid)`);
  await db.query(
    `DELETE FROM story_keys k WHERE NOT EXISTS (
       SELECT 1 FROM stories s WHERE s.id = k.story_id)`);
  await db.query(
    `DELETE FROM snapshot_schedule ss WHERE NOT EXISTS (
       SELECT 1 FROM stories s WHERE s.id = ss.story_id)`);
  await db.query(`DELETE FROM tool_signals`);
  await db.query(`DELETE FROM backfill_state`);
  // The polling record. Useful while a source exists and meaningless once it
  // does not: every row names a fetch of a feed that is no longer in the
  // registry.
  await db.query(`DELETE FROM fetch_log`);
  await db.query(`DELETE FROM source_budgets`);
  // Discovered domains are NOT deleted. They are a record of what the crawler
  // saw, they are not promoted automatically by anything in this codebase, and
  // the discovery queue is worth more than the link into a registry that no
  // longer exists. Only the link is cleared.
  await db.query(`UPDATE source_candidates SET promoted_source_id = NULL
                   WHERE promoted_source_id IS NOT NULL`);
  // source_month and story_rejects are ON DELETE CASCADE and go with the source.
  await db.query(`DELETE FROM sources WHERE NOT (id = ANY($1::uuid[]))`, [keptSourceIds]);

  // What is left of the old registry exists only to attribute a saved story.
  // Paused, uncurated and labelled, so it never looks like a choice.
  if (keptSourceIds.length) {
    await db.query(
      `UPDATE sources SET health = 'paused', curated = false,
              notes = 'kept only to attribute a favourited story; not polled'
        WHERE id = ANY($1::uuid[])`, [keptSourceIds]);
  }

  let index = 0;
  for (const s of NEWS_SOURCES) {
    await db.query(
      `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang, country,
                            trust_weight, weight_content, never_canonical, fields,
                            poll_interval_seconds, politeness_seconds, shard, curated, notes)
       VALUES ($1,$2,$3,$4,'news',$5::source_role[],$6,$7,$8,$9,false,$10,$11,$12,$13,true,$14)
       ON CONFLICT (url) DO UPDATE SET
         name = EXCLUDED.name, feed_url = EXCLUDED.feed_url, kind = 'news',
         roles = EXCLUDED.roles, health = 'healthy', consecutive_failures = 0,
         next_fetch_at = now(), curated = true, notes = EXCLUDED.notes`,
      [s.name, s.url, s.feedHint ?? null, s.feedKind ?? 'rss', s.roles, s.lang ?? null,
        s.country ?? null, s.trust ?? 0.5, s.weightContent ?? 1.0, s.fields ?? [],
        s.pollSeconds ?? 3600, 2, shardFor(s, index++), s.notes ?? null]);
  }

  // The aggregate is the thing this script must not touch. Proving it INSIDE
  // the transaction means a mistake rolls back rather than being discovered.
  const months = await count(`SELECT count(*)::text n FROM archive_history`);
  const history = await count(`SELECT count(*)::text n FROM stack_history`);
  const stacks = await count(`SELECT count(*)::text n FROM stacks`);
  if (months !== before.archiveMonths || history !== before.stackHistory
      || stacks !== before.stacks) {
    throw new Error(`the aggregate moved: months ${before.archiveMonths}->${months}, `
      + `history ${before.stackHistory}->${history}, stacks ${before.stacks}->${stacks}`);
  }

  await db.query('COMMIT');
} catch (err) {
  await db.query('ROLLBACK');
  console.error('');
  console.error('rolled back, nothing changed:', (err as Error).message);
  await done(1);
}

console.log('');
console.log('done:');
console.log(`  sources          ${n(await count(`SELECT count(*)::text n FROM sources`))}`);
console.log(`  stories          ${n(await count(`SELECT count(*)::text n FROM stories`))}`);
console.log(`  archive_history  ${n(await count(`SELECT count(*)::text n FROM archive_history`))} months, untouched`);
console.log(`  stacks           ${n(await count(`SELECT count(*)::text n FROM stacks`))}, untouched`);
console.log('');
console.log('nothing is collected yet. `npm run poll` to fill it.');
console.log('`npm run seed` puts the release feeds and vendor channels back alongside these.');
await done();

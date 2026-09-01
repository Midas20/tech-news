import { randomUUID } from 'node:crypto';
import type { Db } from '../client.ts';

export interface StoryInsert {
  /**
   * The id this story must be written under.
   *
   * Handed out by claimUrls, which won the URL on this story's behalf. Absent
   * only on paths that do not go through the collector, where the database
   * generates one.
   */
  id?: string;
  canonicalUrl: string;
  urlHash: Uint8Array;
  contentHash: Uint8Array;
  titleOriginal: string;
  titleEn: string | null;
  titleHashEn: Uint8Array | null;
  summaryEn: string | null;
  author: string | null;
  sourceId: string;
  country: string | null;
  lang: string;
  publishedAt: Date | null;
  simhash: bigint | null;
  simhashBands: number[];
  bodyChars: number;
  outboundDomains: string[];
  collectionMode: 'live' | 'backfill';
  isPrerelease?: boolean;
  /** launch | release | change | article, from eventful.ts. NULL when unjudged. */
  eventKind?: string | null;
}

export interface StoryRow {
  id: string;
  collected_at: string;
  canonical_url: string;
  title_original: string;
  title_en: string | null;
  summary_en: string | null;
  lang: string;
  source_id: string;
  simhash: string | null;
  coverage_count: number;
  importance: number | null;
  stacks: string[];
}

/**
 * Dedup layer 1, as a single round trip. Both the URL hash and the content hash
 * are checked at once because a syndicated copy usually matches on content while
 * a feed re-publish matches on URL, and doing two queries doubles the cost of
 * the most-executed path in the system.
 */
export async function findExisting(
  db: Db,
  urlHash: Uint8Array,
  contentHash: Uint8Array,
): Promise<{ story_id: string; key_kind: string } | null> {
  // Two scalar parameters rather than a bytea[]: the Neon HTTP driver builds
  // array literals by string-escaping each element, which throws on binary
  // values. Scalar bytea parameters are fine, so the array never forms.
  const rows = await db.query<{ story_id: string; key_kind: string }>(
    `SELECT story_id, key_kind FROM story_keys
      WHERE key_hash = $1 OR key_hash = $2
      ORDER BY CASE key_kind WHEN 'url' THEN 0 ELSE 1 END
      LIMIT 1`,
    [urlHash, contentHash],
  );
  return rows[0] ?? null;
}

/**
 * URL-only lookup, run BEFORE any article page is fetched. Without this the
 * collector spends a page fetch discovering that it already has the story --
 * roughly 60% of items on a busy feed cycle.
 *
 * A CLAIM WITHOUT A STORY IS NOT A CLAIM. See findManyByUrl.
 */
export async function findByUrl(db: Db, urlHash: Uint8Array): Promise<string | null> {
  const rows = await db.query<{ story_id: string }>(
    `SELECT k.story_id FROM story_keys k
      WHERE k.key_hash = $1 AND k.key_kind = 'url'
        AND EXISTS (SELECT 1 FROM stories s WHERE s.id = k.story_id)`,
    [urlHash],
  );
  return rows[0]?.story_id ?? null;
}

/**
 * Claim a URL before writing anything under it.
 *
 * THE STORY CANNOT EXIST WITHOUT OWNING ITS ADDRESS. That is the whole point,
 * and it used to be the other way round: insertStory wrote the row, then
 * registerKeys claimed the URL with ON CONFLICT DO NOTHING -- so a claim that
 * lost left the story behind anyway. Two polls racing on one URL both inserted,
 * one of them won the key, and the archive kept both. 70 rows in 1,272, always
 * exactly twice, which is a race and not a feed.
 *
 * Returns the id to write the story under when the claim is won, and the id of
 * the story that already holds the URL when it is lost -- in which case the
 * caller has a story to attach a member to rather than one to insert.
 */
export async function claimUrl(
  db: Db, urlHash: Uint8Array,
): Promise<{ won: true; id: string } | { won: false; heldBy: string }> {
  const id = randomUUID();
  const rows = await db.query<{ story_id: string }>(
    `INSERT INTO story_keys (key_hash, key_kind, story_id, collected_at)
     VALUES ($1, 'url', $2::uuid, now())
     ON CONFLICT (key_hash) DO NOTHING
     RETURNING story_id::text`,
    [urlHash, id]);
  if (rows.length > 0) return { won: true, id };

  // Lost, or already held from an earlier poll. Either way somebody else owns
  // this address and the caller should join it, not duplicate it.
  const [held] = await db.query<{ story_id: string }>(
    `SELECT story_id::text FROM story_keys WHERE key_hash = $1 AND key_kind = 'url'`,
    [urlHash]);
  return { won: false, heldBy: held!.story_id };
}

export async function insertStory(
  db: Db, s: StoryInsert, id?: string,
): Promise<{ id: string; collected_at: string }> {
  const rows = await db.query<{ id: string; collected_at: string }>(
    `INSERT INTO stories (
       id,
       canonical_url, url_hash, content_hash, title_original, title_en, title_hash_en,
       summary_en, author, source_id, country, lang, published_at, simhash,
       simhash_bands, body_chars, outbound_domains, collection_mode, is_prerelease,
       event_kind)
     VALUES (coalesce($20::uuid, gen_random_uuid()),
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::content_lang,$12,$13,$14,$15,$16,$17::collection_mode,$18,$19)
     RETURNING id, collected_at`,
    [
      s.canonicalUrl, s.urlHash, s.contentHash, s.titleOriginal, s.titleEn, s.titleHashEn,
      s.summaryEn, s.author, s.sourceId, s.country, s.lang, s.publishedAt,
      s.simhash === null ? null : s.simhash.toString(), s.simhashBands, s.bodyChars,
      s.outboundDomains, s.collectionMode, s.isPrerelease ?? false, s.eventKind ?? null,
      id ?? null,
    ],
  );
  return rows[0]!;
}

export async function registerKeys(
  db: Db,
  storyId: string,
  collectedAt: string,
  keys: { hash: Uint8Array; kind: 'url' | 'content' | 'title_en' }[],
): Promise<void> {
  if (keys.length === 0) return;
  // Same constraint as findExisting: no bytea arrays over the HTTP driver. Three
  // keys at most, so an explicit VALUES list costs nothing.
  const values = keys
    .map((_, i) => `($${i * 2 + 3}, $${i * 2 + 4}, $1, $2)`)
    .join(', ');
  await db.query(
    `INSERT INTO story_keys (key_hash, key_kind, story_id, collected_at)
     VALUES ${values}
     ON CONFLICT (key_hash) DO NOTHING`,
    [storyId, collectedAt, ...keys.flatMap((k) => [k.hash, k.kind])],
  );
}

/** Another outlet carrying a story we already have. */
export async function addMember(
  db: Db,
  m: { storyId: string; sourceId: string; url: string; title: string | null; matchLayer: number; memberStoryId?: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO story_members (story_id, source_id, url, title, match_layer, member_story_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT DO NOTHING`,
    [m.storyId, m.sourceId, m.url, m.title, m.matchLayer, m.memberStoryId ?? null],
  );
  await db.query(
    // A story's own source is not coverage of it.
    //
    // `story_members` holds two different things. A layer-2/3/4 merge adds the
    // OTHER outlet that carried the story, which is what coverage means. Layer 1
    // adds a second ADDRESS for the same item from the same publisher -- the
    // feed link and the page's rel=canonical disagreeing over a tracking
    // parameter -- and that is not another outlet, it is the same one twice.
    //
    // Counting both made a single-publisher changelog entry read "2 outlets",
    // and it did so for 487 of 542 live stories: nine in ten of the archive
    // claiming corroboration that never existed. It is not a display bug.
    // `coverage_count` feeds the niche score (inverse coverage), the ranking,
    // the monthly rollups' outlet_mentions, and every coverage snapshot.
    `UPDATE stories s SET coverage_count = (
       SELECT 1 + count(DISTINCT m.source_id) FROM story_members m
        WHERE m.story_id = s.id AND m.source_id <> s.source_id
     ) WHERE s.id = $1`,
    [m.storyId],
  );
}

/**
 * Clustering never deletes. The losing row keeps its own record and points at the
 * winner; every read path filters superseded_by IS NULL.
 */
export async function supersede(
  db: Db,
  loserId: string,
  winnerId: string,
  reason: string,
): Promise<void> {
  await db.query(
    // superseded_at is not decoration. Without it the only record of WHEN a
    // merge happened is the job log, which is useful exactly as far as the job
    // reported honestly -- and a run that merged sixty-seven stories while
    // reporting "nothing" is what made this column necessary. See 0046.
    `UPDATE stories SET superseded_by = $2, supersede_reason = $3, superseded_at = now()
      WHERE id = $1 AND superseded_by IS NULL`,
    [loserId, winnerId, reason],
  );
}

/** SimHash band candidates -- dedup layer 2 without an O(n) scan. */
/**
 * Near-duplicate candidates for one story, from OTHER sources only.
 *
 * The same-source exclusion is the point of this function, not a detail of it.
 * Layer 2 asks "did somebody else carry this story", which is what coverage
 * means -- `story_members` and `coverage_count` exist to record exactly that.
 * Two items from ONE publisher are two different announcements by construction:
 * a changelog does not publish the same entry twice, and on the rare occasion a
 * feed does, it arrives at the same URL or with the same body and layers 1 and 3
 * catch it exactly rather than by resemblance.
 *
 * Without this, fuzzy similarity is turned loose on template text and eats the
 * things most worth keeping. Measured on Google Cloud's release notes: "GKE
 * (2026-R35) version updates" merged into "GKE (2026-R34)" -- two different
 * release rounds a week apart -- and "Distributed Cloud for VMware" merged into
 * "Distributed Cloud for bare metal", two different products. Release notes are
 * boilerplate around a small payload, so the boilerplate dominates the hash and
 * every one of them looks like every other.
 */
export async function bandCandidates(
  db: Db,
  bands: number[],
  since: Date,
  excludeId: string,
  excludeSourceId: string | null,
  limit = 50,
): Promise<{ id: string; simhash: string; source_id: string; canonical_url: string; title_original: string }[]> {
  return db.query(
    `SELECT id, simhash::text AS simhash, source_id, canonical_url, title_original
       FROM stories
      WHERE simhash_bands && $1::int[]
        AND collected_at > $2
        AND id <> $3
        AND ($5::uuid IS NULL OR source_id IS DISTINCT FROM $5::uuid)
        AND superseded_by IS NULL
      LIMIT $4`,
    [bands, since, excludeId, limit, excludeSourceId],
  );
}

export async function unclassified(db: Db, limit: number): Promise<StoryRow[]> {
  return db.query<StoryRow>(
    `SELECT id, collected_at, canonical_url, title_original, title_en, summary_en,
            lang, source_id, simhash::text AS simhash, coverage_count, importance, stacks
       FROM stories
      WHERE classified_at IS NULL AND superseded_by IS NULL
      ORDER BY collected_at
      LIMIT $1`,
    [limit],
  );
}

export async function applyClassification(
  db: Db,
  storyId: string,
  patch: { isTech: boolean; stacks: string[]; classifierVersion: string },
): Promise<void> {
  await db.query(
    `UPDATE stories SET is_tech = $2, stacks = $3, classifier_version = $4, classified_at = now()
      WHERE id = $1`,
    [storyId, patch.isTech, patch.stacks, patch.classifierVersion],
  );
}

export async function applyScores(
  db: Db,
  storyId: string,
  scores: { importance: number; importanceBy: string; novelty: number; niche: number; depth: number },
): Promise<void> {
  await db.query(
    `UPDATE stories SET importance = $2, importance_by = $3, novelty = $4, niche = $5, depth = $6
      WHERE id = $1`,
    [storyId, scores.importance, scores.importanceBy, scores.novelty, scores.niche, scores.depth],
  );
}

export async function setTranslatedTitle(
  db: Db,
  storyId: string,
  titleEn: string,
  titleHash: Uint8Array,
): Promise<void> {
  await db.query(`UPDATE stories SET title_en = $2, title_hash_en = $3 WHERE id = $1`, [
    storyId, titleEn, titleHash,
  ]);
}

export async function setSummary(db: Db, storyId: string, summaryEn: string): Promise<void> {
  await db.query(`UPDATE stories SET summary_en = $2 WHERE id = $1`, [storyId, summaryEn]);
}

// --- Batched paths ----------------------------------------------------------
//
// The per-item versions above are correct but cost roughly six round trips per
// story. Over an HTTP driver that is the whole cost of collection, so the live
// pipeline uses these instead: a fixed handful of queries per SOURCE, regardless
// of how many items the feed carried.
//
// Note the parameter style. bytea arrays cannot cross the Neon HTTP driver (it
// string-escapes array elements and throws on binary), so hashes are always
// passed as scalar parameters -- one placeholder each, never an array literal.

export interface PendingStory extends StoryInsert {
  /** Carried through so callers can map insert results back to their item. */
  itemTitle: string;
}

/** Which of these URL hashes do we already have? One query for a whole feed. */
export async function findManyByUrl(
  db: Db,
  urlHashes: Uint8Array[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (urlHashes.length === 0) return out;

  const placeholders = urlHashes.map((_, i) => `$${i + 1}`).join(',');
  const rows = await db.query<{ hex: string; story_id: string }>(
    `SELECT encode(k.key_hash, 'hex') AS hex, k.story_id::text
       FROM story_keys k
      WHERE k.key_kind = 'url' AND k.key_hash IN (${placeholders})
        -- A CLAIM WITHOUT A STORY IS NOT A CLAIM.
        --
        -- This answers "do we already hold this address", and the caller drops
        -- the item as a duplicate when it says yes. Without the check it says
        -- yes for a story that was deleted -- and then the item is refused
        -- forever, because nothing ever removes the claim and nothing ever
        -- re-collects the URL. Silent, permanent, and indistinguishable from a
        -- feed that went quiet.
        --
        -- Measured on 2026-08-28, after the registry was emptied: 73,286 url
        -- keys, 71,274 of them pointing at stories that no longer existed, and
        -- 374 items inside the retention window on offer across the live feeds
        -- that could never be collected again. The duplicate drop reason was
        -- the second largest in the archive at 41,795 in thirty days.
        --
        -- 0061 deletes the orphans; this clause is why they cannot come back.
        AND EXISTS (SELECT 1 FROM stories s WHERE s.id = k.story_id)`,
    urlHashes,
  );
  for (const r of rows) out.set(r.hex, r.story_id);
  return out;
}

/** Same, for content hashes -- the syndicated-copy case. */
export async function findManyByContent(
  db: Db,
  contentHashes: Uint8Array[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (contentHashes.length === 0) return out;

  const placeholders = contentHashes.map((_, i) => `$${i + 1}`).join(',');
  const rows = await db.query<{ hex: string; story_id: string }>(
    `SELECT encode(key_hash, 'hex') AS hex, story_id::text
       FROM story_keys
      WHERE key_kind = 'content' AND key_hash IN (${placeholders})`,
    contentHashes,
  );
  for (const r of rows) out.set(r.hex, r.story_id);
  return out;
}

export interface InsertedStory {
  id: string;
  collected_at: string;
  url_hex: string;
}

/** Multi-row insert. url_hex comes back so the caller can match rows to items. */
/**
 * Claim a batch of URLs, in one statement, before any story is written.
 *
 * The winners come back with the id to write their story under. The losers do
 * not come back at all, and the caller looks up who holds the address instead
 * of inserting a second row at it.
 *
 * This is the ordering the archive was missing. It used to insert the stories
 * and then claim the URLs with ON CONFLICT DO NOTHING -- so a claim that lost
 * left its story behind, and two polls racing on one address produced two rows
 * and one key. 70 rows in 1,272, always exactly twice.
 *
 * An explicit VALUES list rather than unnest($1::bytea[]): the HTTP driver
 * cannot send bytea arrays, which is the same reason registerKeys builds one.
 */
export async function claimUrls(
  db: Db, hashes: Uint8Array[],
): Promise<Map<string, string>> {
  const won = new Map<string, string>();
  if (hashes.length === 0) return won;

  const ids = hashes.map(() => randomUUID());
  const values = hashes
    .map((_, i) => `($${i * 2 + 1}, 'url', $${i * 2 + 2}::uuid, now())`)
    .join(', ');
  const rows = await db.query<{ hex: string; story_id: string }>(
    `INSERT INTO story_keys (key_hash, key_kind, story_id, collected_at)
     VALUES ${values}
     -- A claim whose story no longer exists is taken over rather than lost.
     --
     -- DO NOTHING was right when every claim had a story behind it and wrong
     -- the moment one did not: the loser here is dropped without a story, and
     -- the address stays unreachable forever. Deleting stories is a normal
     -- operation -- retention does it every month -- so the collector has to be
     -- able to reclaim an address whose owner is gone, not merely be repaired
     -- after the fact by 0061.
     --
     -- The WHERE makes it a no-op for a live claim, so the ordinary race is
     -- unchanged: two polls on one URL still produce one story and one member.
     ON CONFLICT (key_hash) DO UPDATE
       SET story_id = EXCLUDED.story_id, collected_at = now()
       WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = story_keys.story_id)
     RETURNING encode(key_hash, 'hex') AS hex, story_id::text`,
    hashes.flatMap((h, i) => [h, ids[i]!]));

  for (const r of rows) won.set(r.hex, r.story_id);
  return won;
}

export async function insertStories(db: Db, rows: StoryInsert[]): Promise<InsertedStory[]> {
  if (rows.length === 0) return [];

  // Every placeholder carries its type. In a multi-row VALUES list Postgres
  // infers the column type from the parameters, and an untyped parameter is
  // text -- which fails the moment it meets a bytea or an enum column. Casting
  // in the SELECT is too late; the VALUES column is already typed by then.
  const COL_TYPES = [
    'text', 'bytea', 'bytea', 'text', 'text', 'bytea', 'text', 'text', 'uuid',
    'text', 'content_lang', 'timestamptz', 'bigint', 'int[]', 'int', 'text[]',
    'collection_mode', 'boolean', 'text',
    // The id the URL claim handed out. Never null on the collector's path:
    // claimUrls has already decided who owns this address.
    'uuid',
  ];
  const COLS = COL_TYPES.length;

  const values = rows
    .map((_, r) => `(${COL_TYPES.map((t, c) => `$${r * COLS + c + 1}::${t}`).join(',')})`)
    .join(',');

  const params: unknown[] = [];
  for (const s of rows) {
    params.push(
      s.canonicalUrl, s.urlHash, s.contentHash, s.titleOriginal, s.titleEn, s.titleHashEn,
      s.summaryEn, s.author, s.sourceId, s.country, s.lang, s.publishedAt,
      s.simhash === null ? null : s.simhash.toString(), s.simhashBands, s.bodyChars,
      s.outboundDomains, s.collectionMode, s.isPrerelease ?? false, s.eventKind ?? null,
      s.id ?? null,
    );
  }

  return db.query<InsertedStory>(
    `INSERT INTO stories (
       id,
       canonical_url, url_hash, content_hash, title_original, title_en, title_hash_en,
       summary_en, author, source_id, country, lang, published_at, simhash,
       simhash_bands, body_chars, outbound_domains, collection_mode, is_prerelease,
       event_kind)
     SELECT coalesce(v.id, gen_random_uuid()),
            v.canonical_url, v.url_hash, v.content_hash, v.title_original, v.title_en,
            v.title_hash_en, v.summary_en, v.author, v.source_id, v.country,
            v.lang, v.published_at, v.simhash, v.simhash_bands, v.body_chars,
            v.outbound_domains, v.collection_mode, v.is_prerelease, v.event_kind
       FROM (VALUES ${values}) AS v(
         canonical_url, url_hash, content_hash, title_original, title_en, title_hash_en,
         summary_en, author, source_id, country, lang, published_at, simhash,
         simhash_bands, body_chars, outbound_domains, collection_mode, is_prerelease,
         event_kind, id)
     RETURNING id::text, collected_at::text, encode(url_hash, 'hex') AS url_hex`,
    params,
  );
}

export interface KeyRow {
  hash: Uint8Array;
  kind: 'url' | 'content' | 'title_en';
  storyId: string;
  collectedAt: string;
}

export async function registerKeysBatch(db: Db, keys: KeyRow[]): Promise<void> {
  if (keys.length === 0) return;
  const values = keys
    .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}::uuid, $${i * 4 + 4}::timestamptz)`)
    .join(',');
  const params = keys.flatMap((k) => [k.hash, k.kind, k.storyId, k.collectedAt]);
  await db.query(
    `INSERT INTO story_keys (key_hash, key_kind, story_id, collected_at)
     VALUES ${values} ON CONFLICT (key_hash) DO NOTHING`,
    params,
  );
}

/**
 * Snapshot windows for a batch of stories. Scheduled at insert time because the
 * curve cannot be reconstructed later -- if the row is not here, the +1h value
 * is simply gone.
 */
/**
 * The label for a snapshot offset.
 *
 * Not a free-form format. `coverage_snapshots` and `engagement_snapshots` both
 * carry CHECK (offset_label IN ('1h','6h','24h','7d','adhoc')), so the set of
 * legal labels is fixed by the schema and this function's only job is to land
 * inside it.
 *
 * The previous version formatted anything at or above a day as days, which is
 * a perfectly reasonable convention and produced '1d' for the 24-hour offset --
 * a label the constraint rejects. The failure was quiet in the worst way: the
 * schedule rows inserted fine, and the INSERT that used them blew up hours
 * later inside the collector's snapshot step, so what a reader saw was a
 * coverage curve with its 24-hour point permanently missing. 6,996 of them.
 *
 * An offset with no legal label is dropped rather than guessed at: a snapshot
 * stored under the wrong label is worse than one not taken, because the curve
 * then lies about WHEN it was measured.
 */
export function offsetLabel(hours: number): string {
  const known: Record<number, string> = { 1: '1h', 6: '6h', 24: '24h', 168: '7d' };
  return known[hours] ?? 'adhoc';
}

export async function scheduleSnapshotsBatch(
  db: Db,
  stories: { id: string; collectedAt: string }[],
  offsetHours: number[],
): Promise<void> {
  if (stories.length === 0 || offsetHours.length === 0) return;
  const labels = offsetHours.map(offsetLabel);

  await db.query(
    `INSERT INTO snapshot_schedule (story_id, offset_label, due_at)
     SELECT s.id, o.label, s.collected_at + make_interval(hours => o.hours)
       FROM unnest($1::uuid[], $2::timestamptz[]) AS s(id, collected_at)
       CROSS JOIN unnest($3::text[], $4::int[]) AS o(label, hours)
     ON CONFLICT (story_id, offset_label) DO NOTHING`,
    [
      stories.map((s) => s.id),
      stories.map((s) => s.collectedAt),
      labels,
      offsetHours.map(String),
    ],
  );
}

export async function enqueueBatch(
  db: Db,
  jobs: { type: string; storyId: string; priority: number }[],
): Promise<void> {
  if (jobs.length === 0) return;
  await db.query(
    `INSERT INTO jobs (type, payload, dedup_key, priority)
     SELECT j.type, jsonb_build_object('storyId', j.story_id), j.story_id, j.priority::smallint
       FROM unnest($1::text[], $2::text[], $3::int[]) AS j(type, story_id, priority)
     ON CONFLICT (type, dedup_key) WHERE dedup_key IS NOT NULL AND status IN ('pending','leased')
     DO NOTHING`,
    [jobs.map((j) => j.type), jobs.map((j) => j.storyId), jobs.map((j) => j.priority)],
  );
}

export interface MemberRow {
  storyId: string;
  sourceId: string;
  url: string;
  title: string | null;
  matchLayer: number;
}

/** Members plus a single coverage recount for every story the batch touched. */
export async function addMembersBatch(db: Db, rows: MemberRow[]): Promise<void> {
  // Distinct within the batch first. NOT EXISTS is evaluated against the
  // snapshot the statement began with, so two identical rows in one array both
  // pass it and both insert -- the anti-join below can only see what was
  // already committed. A feed listing one URL twice is enough to trigger that.
  const seen = new Set<string>();
  const members = rows.filter((m) => {
    const key = `${m.storyId}|${m.sourceId}|${m.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (members.length === 0) return;

  // NOT ON CONFLICT DO NOTHING, which is what this used to say and what it
  // could not do.
  //
  // story_members is PARTITIONED BY RANGE (seen_at), and Postgres requires a
  // unique index on a partitioned table to contain the partition key. So the
  // "unique" index reads (story_id, source_id, url, seen_at) -- and with a
  // timestamp in the key, no two sightings ever conflict. Every poll of every
  // source appended another row for every story it still carried: 180,456 rows
  // for 4,589 distinct (story, source, url) triples, thirty-nine copies each.
  // The schema comment calling this table "5-8x faster growing than stories"
  // was describing the bug and mistaking it for the design.
  //
  // An anti-join says what the constraint cannot. It costs one index probe per
  // row on story_members (story_id, seen_at), and it is the only form that
  // works across partitions.
  await db.query(
    `INSERT INTO story_members (story_id, source_id, url, title, match_layer)
     SELECT m.story_id::uuid, m.source_id::uuid, m.url, m.title, m.layer::smallint
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[])
            AS m(story_id, source_id, url, title, layer)
      WHERE NOT EXISTS (
        SELECT 1 FROM story_members e
         WHERE e.story_id = m.story_id::uuid
           AND e.source_id = m.source_id::uuid
           AND e.url = m.url)`,
    [
      members.map((m) => m.storyId), members.map((m) => m.sourceId),
      members.map((m) => m.url), members.map((m) => m.title),
      members.map((m) => m.matchLayer),
    ],
  );

  await db.query(
    // Same exclusion as addMember, and the same reason -- see the note there.
    //
    // Driven from `stories` with a LEFT JOIN rather than grouping the members:
    // a story whose only members are its own alternate URLs must come back as 1,
    // and grouping the member rows would produce no row for it at all, leaving
    // the inflated count in place. That is exactly the shape this bug had.
    `UPDATE stories s SET coverage_count = c.n
       FROM (
         SELECT x.id AS story_id,
                1 + count(DISTINCT m.source_id)
                      FILTER (WHERE m.source_id <> x.source_id) AS n
           FROM stories x
           LEFT JOIN story_members m ON m.story_id = x.id
          WHERE x.id = ANY($1::uuid[])
          GROUP BY x.id
       ) AS c
      WHERE s.id = c.story_id AND s.coverage_count <> c.n`,
    [[...new Set(members.map((m) => m.storyId))]],
  );
}

export interface RejectRow {
  url: string;
  title: string;
  sourceId: string;
  category: string;
  matched: string | null;
}

/**
 * Record what the topic filter refused.
 *
 * One statement for the whole batch, and one ROW per URL however many times it
 * is refused: a rejected item stays in its feed and is refused again on every
 * poll, so a row per decision would grow this table at exactly the rate of the
 * junk it describes. `times` is the more useful number anyway -- it separates
 * noise that keeps coming back from noise that appeared once.
 *
 * Never allowed to fail a collection cycle. This is a diagnostic; losing a note
 * about a story we did not keep is not worth losing the stories we did.
 */
export async function recordRejects(db: Db, rows: RejectRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db.query(
      `INSERT INTO story_rejects (url, title, source_id, category, matched)
       SELECT r.url, r.title, r.source_id::uuid, r.category, r.matched
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
              AS r(url, title, source_id, category, matched)
       ON CONFLICT (url) DO UPDATE
          SET times = story_rejects.times + 1,
              last_seen = now(),
              category = excluded.category,
              matched = excluded.matched`,
      [
        rows.map((r) => r.url), rows.map((r) => r.title),
        rows.map((r) => r.sourceId), rows.map((r) => r.category),
        rows.map((r) => r.matched),
      ],
    );
  } catch {
    // A diagnostic that can break collection is worse than no diagnostic.
  }
}

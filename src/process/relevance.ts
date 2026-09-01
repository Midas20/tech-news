// Relevance: the only hard filter in the system.
//
// It is a SQL set intersection, not a model call and not a similarity search.
// A user following "frontend" gets React news because React is a descendant of
// frontend in the taxonomy; a user following "react" does not get Vue news,
// because Vue is not. That distinction is a recursive CTE, and it is exact --
// which is precisely why there is no vector store here.

import type { Db } from '../db/client.ts';

export interface MatchedStory {
  story_id: string;
  user_id: string;
  channel_id: string | null;
  importance: number;
  niche: number;
  novelty: number;
  matched_fields: string[];
  title: string;
  canonical_url: string;
}

/**
 * Undelivered stories matching each user's fields, for one tenant.
 *
 * MUST be called inside withTenant(): the users and deliveries tables are under
 * RLS and this query carries no tenant_id clause of its own by design.
 */
export async function matchesForTenant(
  db: Db,
  opts: { since: Date; minImportance?: number; limit?: number },
): Promise<MatchedStory[]> {
  return db.query<MatchedStory>(
    `WITH profile AS (
       SELECT u.id AS user_id,
              u.channel_id,
              u.volume_tier,
              u.excluded_terms,
              u.keywords,
              stack_expand(u.fields) AS fields
         FROM users u
     )
     SELECT s.id            AS story_id,
            p.user_id,
            p.channel_id,
            s.importance,
            s.niche,
            s.novelty,
            ARRAY(SELECT unnest(s.stacks) INTERSECT SELECT unnest(p.fields)) AS matched_fields,
            coalesce(s.title_en, s.title_original) AS title,
            s.canonical_url
       FROM stories s
       CROSS JOIN profile p
      WHERE s.superseded_by IS NULL
        AND s.is_tech
        AND s.collected_at > $1
        AND s.importance >= $2
        -- the gate itself: does the story touch anything this user follows
        AND (s.stacks && p.fields
             OR EXISTS (SELECT 1 FROM unnest(p.keywords) k
                         WHERE coalesce(s.title_en, s.title_original) ILIKE '%' || k || '%'))
        AND NOT EXISTS (SELECT 1 FROM unnest(p.excluded_terms) x
                         WHERE coalesce(s.title_en, s.title_original) ILIKE '%' || x || '%')
        -- volume tolerance is per user, never a system-wide policy
        AND (p.volume_tier = 'all'
             OR (p.volume_tier = 'notable'  AND s.importance >= 5)
             OR (p.volume_tier = 'critical' AND s.importance >= 8))
        -- "has this user seen this story" is a row, not session memory
        AND NOT EXISTS (
              SELECT 1 FROM deliveries d
               WHERE d.story_id = s.id AND d.user_id = p.user_id)
      ORDER BY s.importance DESC, s.niche DESC, s.collected_at DESC
      LIMIT $3`,
    [opts.since, opts.minImportance ?? 0, opts.limit ?? 500],
  );
}

/**
 * Record a delivery. The unique constraint on (tenant, story, user, tier) is what
 * makes a mid-cycle restart safe: re-running the digest cannot double-send.
 */
export async function recordDelivery(
  db: Db,
  row: {
    tenantId: string;
    storyId: string;
    userId: string;
    channelId: string | null;
    tier: string;
    reasonLine: string | null;
    slackTs: string | null;
    digestId: string | null;
  },
): Promise<boolean> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO deliveries (tenant_id, story_id, user_id, channel_id, tier,
                             reason_line, slack_ts, digest_id)
     VALUES ($1,$2,$3,$4,$5::delivery_tier,$6,$7,$8)
     ON CONFLICT (tenant_id, story_id, user_id, tier) DO NOTHING
     RETURNING id`,
    [row.tenantId, row.storyId, row.userId, row.channelId, row.tier,
     row.reasonLine, row.slackTs, row.digestId],
  );
  return inserted.length > 0;
}

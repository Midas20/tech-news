// Coverage and engagement curves.
//
// These are captured at +1h, +6h, +24h and +7d and they CANNOT be recreated
// later. Coverage at hour one is not recoverable at hour six -- the count has
// already moved. Everything the UI offers that nothing else does (niche-first
// ordering, velocity sorting, the inline sparklines) depends on this table
// having been written at the moment the value existed.

import type { Db } from '../db/client.ts';

export interface SnapshotReport {
  due: number;
  captured: number;
}

export async function captureDueSnapshots(db: Db, limit = 500): Promise<SnapshotReport> {
  const due = await db.query<{ story_id: string; offset_label: string }>(
    `SELECT story_id, offset_label
       FROM snapshot_schedule
      WHERE NOT captured AND due_at <= now()
      ORDER BY due_at
      LIMIT $1`,
    [limit],
  );

  if (due.length === 0) return { due: 0, captured: 0 };

  // One statement per offset group: coverage_count is already denormalized on
  // the story, so a snapshot is a copy, not a recount.
  const byOffset = new Map<string, string[]>();
  for (const row of due) {
    const list = byOffset.get(row.offset_label) ?? [];
    list.push(row.story_id);
    byOffset.set(row.offset_label, list);
  }

  let captured = 0;
  for (const [label, ids] of byOffset) {
    const inserted = await db.query<{ story_id: string }>(
      `INSERT INTO coverage_snapshots (story_id, count, offset_label)
       SELECT s.id, s.coverage_count, $2
         FROM stories s
        WHERE s.id = ANY($1::uuid[])
       ON CONFLICT DO NOTHING
       RETURNING story_id`,
      [ids, label],
    );
    captured += inserted.length;

    await db.query(
      `UPDATE snapshot_schedule SET captured = true
        WHERE offset_label = $2 AND story_id = ANY($1::uuid[])`,
      [ids, label],
    );
  }

  return { due: due.length, captured };
}

/**
 * Engagement is recorded per type and never summed across them. 500 Hacker News
 * points and 500 Qiita views are not the same quantity and a single numeric
 * column would quietly average them into nonsense.
 */
export async function recordEngagement(
  db: Db,
  rows: {
    storyId: string;
    type: 'views' | 'points' | 'stars' | 'bookmarks' | 'downloads' | 'comments' | 'reposts';
    value: number;
    sourceId: string | null;
    offsetLabel?: string;
  }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db.query<{ story_id: string }>(
    `INSERT INTO engagement_snapshots (story_id, engagement_type, value, source_id, offset_label)
     SELECT r.story_id, r.type::engagement_type, r.value, r.source_id, r.label
       FROM unnest($1::uuid[], $2::text[], $3::bigint[], $4::uuid[], $5::text[])
            AS r(story_id, type, value, source_id, label)
     ON CONFLICT DO NOTHING
     RETURNING story_id`,
    [
      rows.map((r) => r.storyId),
      rows.map((r) => r.type),
      rows.map((r) => r.value),
      rows.map((r) => r.sourceId),
      rows.map((r) => r.offsetLabel ?? 'adhoc'),
    ],
  );
  return inserted.length;
}

/** The curve behind a sparkline. */
export async function coverageCurve(
  db: Db,
  storyId: string,
): Promise<{ label: string; count: number; at: string }[]> {
  return db.query(
    `SELECT offset_label AS label, count, captured_at::text AS at
       FROM coverage_snapshots
      WHERE story_id = $1
      ORDER BY captured_at`,
    [storyId],
  );
}

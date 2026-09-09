// What the gate refused, remembered, so it is not refused again next hour.
//
// Measured on 2026-09-09 against "the number of news is very low": 246,016 feed
// items seen in three days, 5,199 stories kept, and 97,302 refusals for
// `too_short` -- which were not 97,302 items. Vercel's feed carries 1,563
// entries and 1,103 of them were refused on every single poll, because a
// refusal left no trace anywhere. Only kept stories get a row, so dedup
// recognises what was accepted and nothing else; a refused item arrives next
// poll indistinguishable from a new one.
//
// The cost is not mainly the wasted work. ingest.ts allows 25 article fetches
// per source per poll. An item whose page cannot be read takes one of those 25
// on every poll and never gives it back, so a feed accumulating unreadable
// items at its head loses its capacity to contribute new ones. Hugging Face
// publishes a title-only feed of 860 entries against a budget of 25.
//
// EVERY REFUSAL EXPIRES, and that is what keeps this from becoming the thing
// the user already refused once: "I want to filter articles not block sources".
// This blocks neither. It defers ONE ITEM, for a bounded time, and the source
// is fetched in full on every poll exactly as before.

import type { Db } from '../db/client.ts';
import { toHex } from '../lib/hash.ts';

/**
 * How long an item waits before it is allowed to try again.
 *
 * Set by what would have to change for the answer to differ:
 *
 *   too_short      the feed's own text, and the page behind it, were both too
 *                  thin. Publishers do not go back and lengthen posts, so this
 *                  is the closest thing here to permanent -- but not permanent,
 *                  because our own extraction improves. The Atom xhtml parser
 *                  fix on this same day turned 1,103 of these into readable
 *                  stories, and a permanent refusal would have kept them out.
 *   page_blocked   a 403 or a timeout. Sites change their minds, and a fetch
 *                  failure says as much about us as about them, so this waits
 *                  the shortest time of any of them.
 *   not_an_event   a classifier decision on the title, which will not change
 *                  unless the classifier does.
 *
 * Growth is linear in attempts and capped: an item refused nine times has
 * proven the point, and the cap keeps a permanently-dead url on a schedule
 * where it still costs something to be wrong about it.
 */
const BASE_DAYS: Record<string, number> = {
  too_short: 21,
  page_blocked: 3,
  not_an_event: 30,
  off_topic: 30,
  build_noise: 60,
  lang_gate: 60,
};

const DEFAULT_DAYS = 14;
const MAX_DAYS = 120;

export function waitDays(reason: string, attempts: number): number {
  const base = BASE_DAYS[reason] ?? DEFAULT_DAYS;
  return Math.min(MAX_DAYS, base * Math.max(1, attempts));
}

/**
 * Which of these urls may still be skipped without being looked at.
 *
 * One query per source per poll, keyed on the hashes ingest already computed.
 * Returns hex hashes because that is what ingest's own maps are keyed on.
 */
export async function stillRefused(
  db: Db, hashes: Uint8Array[],
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const rows = await db.query<{ url_hash: Uint8Array }>(
    `SELECT url_hash FROM refused_items
      WHERE url_hash = ANY($1::bytea[]) AND retry_after > now()`,
    [hashes],
  );
  return new Set(rows.map((r) => toHex(r.url_hash)));
}

export interface Refusal {
  urlHash: Uint8Array;
  url: string;
  reason: string;
}

/**
 * Record what was refused this poll.
 *
 * `attempts` is incremented rather than set, and the wait is recomputed from
 * the new count, so an item that keeps failing backs off on its own without
 * anything having to decide that it is hopeless.
 */
export async function remember(
  db: Db, sourceId: string, refusals: Refusal[],
): Promise<number> {
  if (refusals.length === 0) return 0;
  // Deduplicated on the way in: one poll can present the same url twice and the
  // statement below would then fail on "cannot affect row a second time".
  const seen = new Set<string>();
  const rows = refusals.filter((r) => {
    const k = toHex(r.urlHash);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  await db.query(
    `INSERT INTO refused_items
       (url_hash, source_id, url, reason, retry_after)
     SELECT u.hash, $1, u.url, u.reason,
            now() + make_interval(days => u.days)
       FROM unnest($2::bytea[], $3::text[], $4::text[], $5::int[])
            AS u(hash, url, reason, days)
     ON CONFLICT (url_hash) DO UPDATE SET
       attempts = refused_items.attempts + 1,
       last_at = now(),
       reason = EXCLUDED.reason,
       -- Recomputed from the incremented count, which is why the wait grows
       -- without anything having to track it.
       retry_after = now() + make_interval(
         days => least(${MAX_DAYS}, greatest(1, EXCLUDED.retry_after::date - now()::date)
                                    * (refused_items.attempts + 1)))`,
    [
      sourceId,
      rows.map((r) => r.urlHash),
      rows.map((r) => r.url),
      rows.map((r) => r.reason),
      rows.map((r) => waitDays(r.reason, 1)),
    ],
  );
  return rows.length;
}

/**
 * Forget refusals older than the archive itself.
 *
 * Without this the table is the one thing here that grows for ever. A url whose
 * wait expired months ago and was never seen again is a url the feed has
 * dropped, and holding it costs an index entry to answer a question nobody asks.
 */
export async function forgetStale(db: Db, olderThanDays = 180): Promise<number> {
  const gone = await db.query<{ url_hash: Uint8Array }>(
    `DELETE FROM refused_items
      WHERE retry_after < now() - make_interval(days => $1)
      RETURNING url_hash`,
    [olderThanDays],
  );
  return gone.length;
}

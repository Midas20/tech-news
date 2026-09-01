// Which earning platforms a story is about.
//
// The same cheap-code pass as company tagging, and stricter, because the
// registry is full of ordinary words: Arc, Impact, Maven, Ghost, Medium, Contra
// and Polar are all platforms here and all of them appear in prose meaning
// something else.
//
// Over-tagging is worse than under-tagging. A Medium page listing every story
// containing the word "medium" is not a page about Medium.

import type { Db } from '../db/client.ts';
import { stripUrls } from './companies.ts';
import { AMBIGUOUS } from '../../seeds/platforms.ts';

export interface PlatformVocabulary {
  /** lowercased name -> slug */
  index: Map<string, string>;
  /** the name as written, for the capital check */
  written: Map<string, string>;
}

export interface PlatformTagReport {
  examined: number;
  tagged: number;
  added: number;
}

export async function loadPlatformVocabulary(db: Db): Promise<PlatformVocabulary> {
  const [rows, collisions] = await Promise.all([
    db.query<{ slug: string; name: string }>(
      // Retired platforms keep their row so old rollups still resolve, but
      // nothing new should be tagged to one. See 0050.
      `SELECT slug, name FROM platforms WHERE retired_at IS NULL`),
    // Maven is a build tool and a course platform; Ghost is a CMS and a
    // newsletter host; Arc is a browser and a talent marketplace. Where a name
    // means both, the technology wins: it is what a technology archive is mostly
    // about, and the stack tagger already claims it correctly.
    db.query<{ alias: string }>(
      `SELECT lower(alias) AS alias FROM stack_alias_lookup
        WHERE lower(alias) IN (SELECT lower(name) FROM platforms WHERE retired_at IS NULL)`),
  ]);
  const claimed = new Set(collisions.map((c) => c.alias));

  const index = new Map<string, string>();
  const written = new Map<string, string>();
  for (const r of rows) {
    const key = r.name.toLowerCase().trim();
    if (key.length < 2) continue;
    if (claimed.has(key)) continue;
    // The capital rule separates a platform from an ordinary word. It cannot
    // separate one proper noun from another, and "Cosmos" is Azure Cosmos DB
    // and NVIDIA Cosmos far more often than it is the Cosmos Hub. Held out by
    // name; see AMBIGUOUS in seeds/platforms.ts for the measurement that put
    // each one there.
    if (AMBIGUOUS.has(r.slug)) continue;
    index.set(key, r.slug);
    written.set(key, r.name);
  }
  return { index, written };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Platforms named in a piece of text.
 *
 * Two rules, both learned by getting them wrong on the first run.
 *
 * NO URL MATCHING. Hosting a story is not being the subject of one: a Substack
 * newsletter about Rust is not news about Substack, and it tagged 322 of them.
 * Worse, GitHub Sponsors lives at github.com/sponsors, so a hostname match put it
 * on 8,435 stories -- every GitHub release in the archive.
 *
 * ALWAYS REQUIRE THE CAPITAL. Platform names are proper nouns and are capitalised
 * whenever they are meant, while half this registry is also an ordinary word:
 * Arc, Impact, Maven, Ghost, Medium, Contra, Polar. Demanding the name exactly as
 * the platform writes it costs nothing real and removes the entire class.
 */
export function detectPlatforms(
  rawText: string,
  _url: string,
  vocab: PlatformVocabulary,
  opts: { max?: number } = {},
): string[] {
  if (!rawText) return [];
  const text = stripUrls(rawText);
  const haystack = text.toLowerCase();
  const found = new Set<string>();

  for (const [name, slug] of vocab.index) {
    if (name.length < 3) continue;
    if (!haystack.includes(name)) continue;

    const asWritten = vocab.written.get(name) ?? name;
    const strict = new RegExp(
      `(^|[^A-Za-z0-9])${escapeRegex(asWritten)}([^A-Za-z0-9]|$)`);
    if (!strict.test(text)) continue;

    found.add(slug);
    if (opts.max && found.size >= opts.max) break;
  }

  return [...found];
}

export async function tagPlatforms(db: Db, limit = 500): Promise<PlatformTagReport> {
  const vocab = await loadPlatformVocabulary(db);
  const report: PlatformTagReport = { examined: 0, tagged: 0, added: 0 };
  if (vocab.index.size === 0) return report;

  const rows = await db.query<{
    id: string; collected_at: string; title: string; summary: string | null;
    url: string; platforms: string[];
  }>(
    `SELECT id::text, collected_at::text, coalesce(title_en, title_original) AS title,
            summary_en AS summary, canonical_url AS url, platforms
       FROM stories
      WHERE superseded_by IS NULL AND platforms_tagged_at IS NULL
      ORDER BY collected_at DESC LIMIT $1`,
    [limit]);

  if (rows.length === 0) return report;
  report.examined = rows.length;

  const updates: { id: string; at: string; platforms: string[] }[] = [];
  for (const row of rows) {
    const detected = detectPlatforms(
      `${row.title} ${row.summary ?? ''}`, row.url, vocab, { max: 6 });
    const merged = [...new Set([...(row.platforms ?? []), ...detected])];
    if (merged.length > (row.platforms ?? []).length) {
      updates.push({ id: row.id, at: row.collected_at, platforms: merged });
      report.tagged++;
      report.added += merged.length - (row.platforms ?? []).length;
    }
  }

  if (updates.length > 0) {
    await db.query(
      `UPDATE stories s
          SET platforms = ARRAY(SELECT jsonb_array_elements_text(v.platforms))
         FROM (SELECT (e->>'id')::uuid AS id,
                      (e->>'at')::timestamptz AS collected_at,
                      e->'platforms' AS platforms
                 FROM jsonb_array_elements($1::jsonb) AS e) v
        WHERE s.id = v.id AND s.collected_at = v.collected_at`,
      [JSON.stringify(updates)]);
  }

  await db.query(
    `UPDATE stories SET platforms_tagged_at = now() WHERE id = ANY($1::uuid[])`,
    [rows.map((r) => r.id)]);

  return report;
}

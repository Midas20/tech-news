// Company tagging.
//
// Which companies is a story about? Two independent signals, both cheap:
//
//   1. WHO PUBLISHED IT. A story from a source with company_slug set is, by
//      definition, about that company -- it is the company speaking. This is
//      free and certain.
//   2. WHO IS NAMED IN IT. Alias matching against the closed company vocabulary,
//      on the title and summary. Plain string work, no model.
//
// The matching is deliberately conservative. "Meta" and "Arm" are ordinary
// English words, so short aliases must match as whole words with a capital in
// the original text, and a bare alias inside a longer word never counts.
// Over-tagging is worse than under-tagging here: a company page that includes
// every story containing the word "apple" is not a company page.

import type { Db } from '../db/client.ts';

export interface CompanyVocabulary {
  /** lowercased alias -> slug */
  index: Map<string, string>;
  /** aliases that are ordinary words and need stricter evidence */
  ambiguous: Set<string>;
}

/** Aliases that are also common English words or fragments. */
const AMBIGUOUS = new Set([
  'meta', 'arm', 'apple', 'oracle', 'linear app', 'cursor', 'spring', 'go',
  'redis', 'neon', 'slack', 'element', 'canonical', 'sentry', 'grok', 'docker',
]);

export async function loadCompanyVocabulary(db: Db): Promise<CompanyVocabulary> {
  const rows = await db.query<{ alias: string; slug: string }>(
    `SELECT alias, slug FROM company_alias_lookup`);
  const index = new Map<string, string>();
  for (const r of rows) index.set(r.alias.toLowerCase(), r.slug);
  return { index, ambiguous: AMBIGUOUS };
}

/**
 * Companies named in a piece of text.
 *
 * `strict` requires the alias to appear capitalised in the ORIGINAL text, which
 * is what separates "Meta announced" from "meta-programming" without a model.
 */
export function detectCompanies(
  rawText: string,
  vocab: CompanyVocabulary,
  opts: { max?: number } = {},
): string[] {
  if (!rawText) return [];
  // URLs are not mentions. Release notes are full of github.com links, which
  // otherwise tag every release in the archive as a story "about GitHub".
  const text = stripUrls(rawText);
  const haystack = text.toLowerCase();
  const found = new Set<string>();

  for (const [alias, slug] of vocab.index) {
    if (alias.length < 2) continue;
    if (!haystack.includes(alias)) continue;

    // Whole-word only: "arm" must not match "alarm" or "farmer".
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}([^a-z0-9]|$)`, 'i');
    if (!pattern.test(text)) continue;

    if (vocab.ambiguous.has(alias) || alias.length <= 4) {
      // Needs the capitalised form to count as a mention of the company.
      const capitalised = new RegExp(
        `(^|[^A-Za-z0-9])${escapeRegex(alias.replace(/\b\w/g, (c) => c.toUpperCase()))}([^A-Za-z0-9]|$)`,
      );
      const asWritten = new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(alias.toUpperCase())}([^A-Za-z0-9]|$)`);
      if (!capitalised.test(text) && !asWritten.test(text)) continue;
    }

    found.add(slug);
    if (opts.max && found.size >= opts.max) break;
  }

  return [...found];
}

/** Drop URLs and bare domains before matching names against prose. */
export function stripUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[\w-]+\.(com|org|io|dev|net|ai|co|cloud|sh|app)\b/gi, ' ');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface TagReport {
  examined: number;
  tagged: number;
  announcements: number;
}

/**
 * Tag a batch of untagged stories. Runs in the processing pass, after
 * classification, and costs nothing but string work.
 */
export async function tagCompanies(db: Db, limit = 500): Promise<TagReport> {
  const vocab = await loadCompanyVocabulary(db);
  const report: TagReport = { examined: 0, tagged: 0, announcements: 0 };

  const rows = await db.query<{
    id: string; title: string; summary: string | null; publisher: string | null;
  }>(
    `SELECT s.id::text,
            coalesce(s.title_en, s.title_original) AS title,
            s.summary_en AS summary,
            src.company_slug AS publisher
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE s.superseded_by IS NULL
        AND s.companies_tagged_at IS NULL
      ORDER BY s.collected_at DESC
      LIMIT $1`, [limit]);

  const updates: { id: string; companies: string[] }[] = [];

  for (const row of rows) {
    report.examined++;
    const text = `${row.title} ${row.summary ?? ''}`;
    const named = detectCompanies(text, vocab, { max: 6 });

    // The publisher is always in the list: a company blog is about its company.
    const companies = row.publisher
      ? [...new Set([row.publisher, ...named])]
      : named;

    if (row.publisher) report.announcements++;
    // Rows with no company are still recorded as examined; otherwise the pass
    // re-reads them forever and never reaches the rest of the archive.
    updates.push({ id: row.id, companies });
  }

  // One statement for the whole batch. An empty string means "examined, nothing
  // found", which is why the marker column and the array are written together.
  if (updates.length > 0) {
    await db.query(
      `UPDATE stories s SET
         companies = CASE WHEN u.csv = '' THEN '{}'::text[] ELSE string_to_array(u.csv, ',') END,
         companies_tagged_at = now()
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS csv) u
        WHERE s.id = u.id`,
      [updates.map((u) => u.id), updates.map((u) => u.companies.join(','))],
    );
    report.tagged = updates.filter((u) => u.companies.length > 0).length;
  }

  return report;
}

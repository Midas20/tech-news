// The closed vocabulary, loaded once per cycle.
//
// Every field a model returns is resolved through this table before it is
// stored. A field that does not resolve is DISCARDED, not stored as-is: the
// moment "react", "React" and "ReactJS" coexist as separate tags, per-user
// filtering breaks silently and no error is ever raised.

import type { Db } from '../db/client.ts';

export interface Taxonomy {
  /** alias (lowercased) -> canonical slug */
  resolve(raw: string): string | null;
  /** canonical slugs, for embedding in prompts */
  slugs(): string[];
  /** a stack plus everything beneath it */
  expand(slugs: string[]): Promise<string[]>;
}

export async function loadTaxonomy(db: Db): Promise<Taxonomy> {
  const rows = await db.query<{ alias: string; slug: string }>(
    `SELECT alias, slug FROM stack_alias_lookup`,
  );
  const index = new Map<string, string>();
  for (const r of rows) index.set(normalizeAlias(r.alias), r.slug);

  const allSlugs = [...new Set(rows.map((r) => r.slug))].sort();

  return {
    resolve(raw: string): string | null {
      const key = normalizeAlias(raw);
      if (!key) return null;
      const direct = index.get(key);
      if (direct) return direct;
      // Models hand back "React.js", "react js", "Rust (language)". Strip the
      // decoration once and try again; anything still unresolved is dropped.
      const stripped = key.replace(/\s*\(.*\)$/, '').replace(/[.\s_]+/g, '-');
      return index.get(stripped) ?? index.get(stripped.replace(/-/g, '')) ?? null;
    },
    slugs: () => allSlugs,
    async expand(slugs: string[]): Promise<string[]> {
      if (slugs.length === 0) return [];
      const out = await db.query<{ stack_expand: string[] }>(`SELECT stack_expand($1::text[])`, [slugs]);
      return out[0]?.stack_expand ?? [];
    },
  };
}

function normalizeAlias(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface ValidationOutcome {
  accepted: string[];
  rejected: string[];
}

export function validateFields(taxonomy: Taxonomy, raw: string[]): ValidationOutcome {
  const accepted = new Set<string>();
  const rejected: string[] = [];
  for (const field of raw) {
    const slug = taxonomy.resolve(field);
    if (slug) accepted.add(slug);
    else rejected.push(field);
  }
  return { accepted: [...accepted], rejected };
}

/**
 * The vocabulary given to the model. The full 367-entry list is too long for a
 * batched prompt, so candidates are narrowed by what the text plausibly mentions
 * before the call -- which also stops the model from picking a field at random
 * when nothing fits.
 */
export function vocabularyFor(taxonomy: Taxonomy, texts: string[], limit = 120): string[] {
  const haystack = texts.join(' \n ').toLowerCase();
  const hits: string[] = [];
  for (const slug of taxonomy.slugs()) {
    const needle = slug.replace(/-/g, ' ');
    if (haystack.includes(slug) || haystack.includes(needle)) hits.push(slug);
    if (hits.length >= limit) break;
  }
  // Always include the domain roots so a story about an unnamed database still
  // has somewhere correct to land.
  const roots = ['ai', 'security', 'infra', 'devops', 'cloud', 'data', 'frontend',
    'backend', 'mobile', 'os', 'hardware', 'web-platform', 'practice', 'languages'];
  return [...new Set([...hits, ...roots])];
}

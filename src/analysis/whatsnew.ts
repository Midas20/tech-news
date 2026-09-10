// What has just appeared, which no field report can be about.
//
// Asked for on 2026-09-09: "you make report on only fields that user selected,
// but the most important report is about new appearing fields and market, tool,
// platform."
//
// THE OBJECTION IS STRUCTURAL AND IT IS RIGHT. `briefArchive` loops over
// FIELDS, a fixed taxonomy written in advance, and asks what happened inside
// each one. That shape can only ever report on categories somebody already
// thought of. A genuinely new thing arrives without a field: it is one launch
// from one vendor, filed under whichever existing tag its words happened to
// match, and it reads as an ordinary event in an established category. The
// report is structurally incapable of saying "this did not exist last month".
//
// WHY THIS IS NOT THE EMERGING LEDGER, and why it exists beside it. Migration
// 0074 built `emerging` for exactly this question and it works, and it depends
// on a model call to pull names out of story text. Measured on 2026-09-09:
// 3,064 stories unscanned, the `names` job reporting "2 batches deferred,
// yielded the model budget", and no name added to the ledger since 23 June.
// With no API key and every free provider rate-limited, the most important
// report in the system was one that could not be written at all.
//
// So this reads what the pipeline has ALREADY DECIDED, with no model in the
// path:
//
//   launch   the event classifier's own verdict that something was introduced
//            rather than updated. 595 in the archive, 23 today.
//   market   money and ownership moving. 28 in the archive, 8 of them today --
//            it was 3 before the venture press came off the host blocklist.
//   names    product names pulled out of those headlines that appear in no
//            registry this archive holds.
//
// The third is the one that answers the question most directly. It is NOT a set
// difference over our own tagging -- that version was tried first and returned
// `gmail`, `nasa` and `hacking`, which is tagger coverage rather than novelty.
// A genuinely new thing is in no registry at all, so the names are read out of
// the headline itself. See `extractNames`.

import type { Query } from './corpus.ts';
import { q } from '../ui/db.ts';
import { slugify, NOT_A_PRODUCT } from '../vocab/emerging.ts';

export interface NewThing {
  id: string;
  title: string;
  url: string;
  source: string;
  independent: boolean;
  when: string;
  kind: string;
  summary: string | null;
  /** The technologies, companies and platforms the story names. */
  subjects: string[];
  importance: number | null;
}

export interface WhatsNew {
  from: string;
  to: string;
  launches: NewThing[];
  market: NewThing[];
  names: NewName[];
  /** Everything the window held, before the caps below took a slice. */
  totals: { launches: number; market: number; names: number };
}

const SELECT = `SELECT s.id::text AS id,
       coalesce(s.title_en, s.title_original) AS title,
       s.canonical_url AS url,
       src.name AS source,
       src.source_type::text AS source_type,
       s.summary_en AS summary,
       coalesce(s.published_at, s.collected_at)::date::text AS when,
       coalesce(s.event_kind::text, 'article') AS kind,
       s.stacks, s.companies, s.platforms, s.importance`;

interface Row {
  id: string; title: string; url: string; source: string;
  source_type: string | null; summary: string | null; when: string; kind: string;
  stacks: string[] | null; companies: string[] | null; platforms: string[] | null;
  importance: number | string | null;
}

function shapeNew(r: Row, independent: boolean): NewThing {
  return {
    id: r.id, title: r.title, url: r.url, source: r.source,
    independent, when: r.when, kind: r.kind, summary: r.summary,
    subjects: [...(r.stacks ?? []), ...(r.companies ?? []), ...(r.platforms ?? [])],
    importance: r.importance === null ? null : Number(r.importance),
  };
}

/**
 * Whether the source speaks for the subject.
 *
 * Read from `source_type` the same way the field corpus reads it, rather than
 * duplicated here, because a launch announced by its own vendor and a launch
 * reported by somebody else are different evidence and the page says which.
 */
function independentOf(sourceType: string | null): boolean {
  if (!sourceType) return false;
  return !sourceType.startsWith('PRIMARY_');
}

/** Things the classifier says were introduced, not updated. */
export async function launches(
  from: string, to: string, cap = 40, query: Query = q,
): Promise<{ rows: NewThing[]; total: number }> {
  const rows = await query<Row>(
    `${SELECT}
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE s.superseded_at IS NULL
        AND s.event_kind::text = 'launch'
        AND coalesce(s.published_at, s.collected_at) >= $1::timestamptz
        AND coalesce(s.published_at, s.collected_at) < $2::timestamptz
      ORDER BY coalesce(s.importance, 0) DESC,
               coalesce(s.published_at, s.collected_at) DESC
      LIMIT $3`, [from, to, cap + 1]);
  return {
    rows: rows.slice(0, cap).map((r) => shapeNew(r, independentOf(r.source_type))),
    total: rows.length,
  };
}

/** Money and ownership moving: who was funded, who bought whom. */
export async function marketMoves(
  from: string, to: string, cap = 25, query: Query = q,
): Promise<{ rows: NewThing[]; total: number }> {
  const rows = await query<Row>(
    `${SELECT}
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE s.superseded_at IS NULL
        AND s.event_kind::text = 'market'
        AND coalesce(s.published_at, s.collected_at) >= $1::timestamptz
        AND coalesce(s.published_at, s.collected_at) < $2::timestamptz
      ORDER BY coalesce(s.importance, 0) DESC,
               coalesce(s.published_at, s.collected_at) DESC
      LIMIT $3`, [from, to, cap + 1]);
  return {
    rows: rows.slice(0, cap).map((r) => shapeNew(r, independentOf(r.source_type))),
    total: rows.length,
  };
}

/**
 * Names that appear in a launch or a funding headline and are in no registry.
 *
 * THE FIRST VERSION OF THIS ASKED THE WRONG QUESTION. It computed a set
 * difference over our own tagging -- technologies named today that the archive
 * had never attached to a story before -- and the answer, measured, was
 * `gmail`, `nasa`, `cooling`, `hacking`. Every one of those is an established
 * thing whose taxonomy row says `origin: seed` or `origin: topic_index`. What
 * that list actually reported was TAGGER COVERAGE: which known names our
 * matcher happened to hit for the first time. Useful to somebody maintaining
 * the tagger, and worthless to somebody asking what is new in the world.
 *
 * A genuinely new thing is not in the taxonomy at all. It is a word in a
 * headline: "Show HN: Booley -- open-source IDE for agentic chip design",
 * "Cymphony launches with $30M", "Introducing Consort". So the names are pulled
 * out of the headline itself, and the only headlines searched are the ones
 * whose whole grammar is introduction -- `launch` and `market` -- because that
 * is what makes a capitalised word a product name rather than a person, a place
 * or the first word of a sentence.
 *
 * NO MODEL IN THE PATH, which is the point. `emerging` (0074) does this
 * properly, with a model reading the prose, and on 2026-09-09 it had 3,064
 * unscanned stories and had added nothing since 23 June because every provider
 * was rate-limited. The most important report in the system was one that could
 * not be written. This is the weaker version that runs anyway, and it says so.
 *
 * It reuses `slugify` and `NOT_A_PRODUCT` from the ledger rather than growing a
 * second opinion about what a product name is -- two copies would drift, and
 * the one making decisions unattended would be the one that drifted.
 */
const PATTERNS: RegExp[] = [
  // "Show HN: Booley - an IDE for ..." and "Show HN: Booley, an IDE ..."
  /^show hn:\s*([A-Z][\w.+-]*(?:\s[A-Z][\w.+-]*){0,2})\s*[-–—:,]/i,
  // "Introducing Consort", "Announcing Foo Bar", "Meet Baz"
  /^(?:introducing|announcing|meet|presenting)\s+([A-Z][\w.+-]*(?:\s[A-Z][\w.+-]*){0,2})\b/i,
  // "Cymphony launches with $30M", "Harvey raises $550M", "Euno raises $23M"
  /^([A-Z][\w.+-]*(?:\s[A-Z][\w.+-]*){0,1})\s+(?:launches|raises|emerges|debuts|unveils)\b/,
  // "... startup Lightfield raises", "AI company Foo acquires"
  /\b(?:startup|company|firm)\s+([A-Z][\w.+-]*(?:\s[A-Z][\w.+-]*){0,1})\s+(?:raises|launches|acquires|hits)\b/,
  // "Shopify acquires Tailwind" -- the thing bought is the newcomer here.
  /\bacquires\s+([A-Z][\w.+-]*(?:\s[A-Z][\w.+-]*){0,1})\b/,
];

/** Words that begin a description rather than a name. */
const DETERMINERS = new Set([
  'a', 'an', 'the', 'my', 'our', 'your', 'this', 'that', 'these', 'those',
  'introducing', 'announcing', 'new', 'open', 'free', 'simple', 'fast',
  'building', 'how', 'why', 'what', 'i', 'we',
]);

export interface NewName {
  slug: string;
  name: string;
  /** Every story in the window whose headline produced this name. */
  stories: NewThing[];
  /** Distinct publishers. Two is corroboration; one is a claim. */
  sources: number;
}

/**
 * Pull candidate names out of a set of headlines and keep the unknown ones.
 *
 * `known` is every slug in the taxonomy plus every name the emerging ledger has
 * already seen, so this only ever reports something both are silent about.
 */
export function extractNames(items: NewThing[], known: Set<string>): NewName[] {
  const found = new Map<string, NewName>();

  for (const it of items) {
    for (const re of PATTERNS) {
      const m = re.exec(it.title);
      const raw = m?.[1]?.trim();
      if (!raw) continue;
      // A HEADLINE THAT STARTS WITH A DETERMINER IS DESCRIBING, NOT NAMING.
      // "Show HN: An open-source SAS interpreter" and "Show HN: A free agent
      // orchestrator" both matched and produced `an-open` and `a-free`, which
      // are not products and would have been the first thing a reader saw
      // under "new names". The author of that headline did not give their tool
      // a name in it, and inventing one from the first two words is worse than
      // reporting nothing.
      if (DETERMINERS.has(raw.split(/\s+/)[0]!.toLowerCase())) continue;
      const slug = slugify(raw);
      // MIN length guards against an initial ("A", "I") surviving as a product.
      if (!slug || slug.length < 3) continue;
      if (NOT_A_PRODUCT.has(slug) || known.has(slug)) continue;
      const seen = found.get(slug);
      if (seen) {
        if (!seen.stories.some((s) => s.id === it.id)) seen.stories.push(it);
      } else {
        found.set(slug, { slug, name: raw, stories: [it], sources: 0 });
      }
      // First pattern to match wins: they are ordered from most specific, and
      // letting a later one fire too would file one headline under two names.
      break;
    }
  }

  for (const n of found.values()) {
    n.sources = new Set(n.stories.map((s) => s.source)).size;
  }
  // Corroborated first. A name two publishers reached for independently is a
  // different kind of evidence from one a vendor used about itself.
  return [...found.values()].sort((a, b) =>
    b.sources - a.sources || b.stories.length - a.stories.length);
}

/** The names, looked up against everything this archive already knows. */
export async function newNames(
  items: NewThing[], query: Query = q,
): Promise<NewName[]> {
  const known = new Set<string>();
  for (const r of await query<{ slug: string }>('SELECT slug FROM stacks')) {
    known.add(r.slug);
  }
  for (const r of await query<{ slug: string }>('SELECT slug FROM emerging')) {
    known.add(r.slug);
  }
  return extractNames(items, known);
}

/** Everything the "what is new" page needs, for one window. */
export async function whatsNew(
  from: string, to: string, query: Query = q,
): Promise<WhatsNew> {
  const [l, m] = await Promise.all([
    launches(from, to, 40, query),
    marketMoves(from, to, 25, query),
  ]);
  // Names are read out of the headlines already fetched rather than from a
  // query of their own: the two lists ARE the population a new name can be in,
  // since introduction is what makes a capitalised word a product name.
  const names = await newNames([...l.rows, ...m.rows], query);
  return {
    from, to,
    launches: l.rows, market: m.rows, names,
    totals: { launches: l.total, market: m.total, names: names.length },
  };
}

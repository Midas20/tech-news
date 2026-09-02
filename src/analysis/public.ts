// The only numbers a briefing is allowed to use.
//
// "If you want to use this value, collect public value of it in net"
// -- 2026-09-01, and that is the whole rule.
//
// An archive count answers "how many of these did WE catch". A public figure
// answers "how much of this exists", and it answers it the same way for
// everybody, whether or not this repository is running. That is the difference
// between a measurement and a self-portrait.
//
// WHAT IS ACTUALLY AVAILABLE, and it is less than people assume:
//
//   projects  public repositories carrying the technology's GitHub topic. A
//             real census of a real population, refreshed by the `adoption`
//             job. All 2,338 technologies in the vocabulary have one.
//   stars     stars on the technology's own repository, where it has one.
//             Interest in a repository, NOT users -- 746 technologies have it.
//
// Nobody publishes a developer count. Not GitHub, not Stack Overflow, not
// libraries.io, and the usual proxies each measure something else: stars are
// interest, questions are confusion, downloads are continuous integration. So
// this module offers the two figures that exist under their own names and
// refuses to synthesise a third. See migration 0048.
//
// EVERY FIGURE CARRIES ITS DATE. An adoption number with no measurement date is
// a claim about the present made from an unknown past, and the writer is told
// to quote the date alongside the number for exactly that reason.

import { q } from '../ui/db.ts';
import type { Query } from './corpus.ts';

export interface PublicFigure {
  slug: string;
  name: string;
  /** Public repositories carrying this technology's GitHub topic. */
  projects: number | null;
  /** Stars on its own repository, where it names one. */
  stars: number | null;
  /** When the figure was taken. NULL means never measured, never "zero". */
  measuredAt: string | null;
  repoUrl: string | null;
  /** Where it came from, so the reader can go and check it. */
  source: string;
}

/**
 * Look up public figures for the technologies a briefing is about.
 *
 * Returns only what has actually been measured. A slug that comes back missing
 * is not an implicit zero, and callers must not render it as one -- "no public
 * figure" and "a public figure of nothing" are different statements, and only
 * the first one is true here.
 */
export async function publicFigures(
  slugs: string[], query: Query = q,
): Promise<Map<string, PublicFigure>> {
  if (slugs.length === 0) return new Map();
  const rows = await query<{
    slug: string; name: string; projects: number | null; stars: number | null;
    measured_at: string | null; repo_url: string | null; source: string | null;
  }>(
    `SELECT st.slug, st.name, a.projects, a.stars,
            a.measured_at::date::text AS measured_at,
            st.repo_url, a.source
       FROM stacks st
       JOIN stack_adoption a ON a.stack_id = st.id
      WHERE st.slug = ANY($1::text[])
        AND a.measured_at IS NOT NULL
        AND (a.projects IS NOT NULL OR a.stars IS NOT NULL)`,
    [slugs]);

  const out = new Map<string, PublicFigure>();
  for (const r of rows) {
    out.set(r.slug, {
      slug: r.slug,
      name: r.name,
      projects: r.projects === null ? null : Number(r.projects),
      stars: r.stars === null ? null : Number(r.stars),
      measuredAt: r.measured_at,
      repoUrl: r.repo_url,
      source: r.source ?? 'github',
    });
  }
  return out;
}

/** How a figure is written, in full, with its provenance attached. */
export function describeFigure(f: PublicFigure): string {
  const parts: string[] = [];
  if (f.projects !== null) {
    parts.push(`${f.projects.toLocaleString('en-US')} public GitHub `
      + `project${f.projects === 1 ? '' : 's'} carry its topic`);
  }
  if (f.stars !== null) {
    parts.push(`${f.stars.toLocaleString('en-US')} stars on its own repository`);
  }
  if (parts.length === 0) return `${f.name}: no public figure measured.`;
  return `${f.name}: ${parts.join('; ')} (${f.source}, measured ${f.measuredAt ?? 'unknown'}).`;
}

/**
 * Rank the briefing's subjects by how large they actually are in public.
 *
 * The point of the ordering is scale, not attention: a reader is entitled to
 * know that one of the two technologies a paragraph mentions has forty thousand
 * public projects behind it and the other has ninety.
 */
export function bySize(figures: Iterable<PublicFigure>): PublicFigure[] {
  return [...figures]
    .filter((f) => f.projects !== null)
    .sort((a, b) => (b.projects ?? 0) - (a.projects ?? 0));
}

/**
 * How stale the figures are, so the page can say so rather than imply currency.
 *
 * The adoption job walks the whole vocabulary roughly every 17 hours at its
 * default rate, so a figure a week old is normal and a figure a year old means
 * the job has not been running.
 */
export function oldestMeasurement(figures: Iterable<PublicFigure>): string | null {
  const dates = [...figures].map((f) => f.measuredAt).filter((d): d is string => !!d).sort();
  return dates[0] ?? null;
}

// Where a vocabulary entry came from, in three classes rather than two.
//
// `stacks.curated` is a boolean, and a boolean could only say "a person chose
// this" or "a person did not". Everything in the second half was then described
// as DISCOVERED -- by the origin filter, by the growth panel, and by the row's
// own record -- which was true of two entries and false of 1,615.
//
//   discovered   The archive produced it. A repository under a repo the
//                vocabulary did not know published a release; or a term
//                appeared in enough headlines to clear the review queue. There
//                is evidence in the collection, and by construction there is
//                coverage: it was found BY being covered.
//
//   imported     A published vocabulary was mapped onto this one in bulk --
//                GitHub's topic index, Linguist's language list, the CNCF
//                landscape. These are somebody else's curation, which is worth
//                having, but an entry arrives with no coverage and usually
//                never gets any. 288 of the 930 topics have never been seen.
//
//   curated      Typed into a seed file, or added by hand through the registry.
//
// The distinction is the difference between "the system noticed something new"
// and "a list was loaded", and only the first is news. A panel headed
// "recently added by the system" that lists the second is telling the reader
// that a technology arrived when nothing of the sort happened.
//
// Nothing is imported here on purpose: this is read by the registry UI, by the
// filters and by discovery, and a shared constant that imports its consumers
// is how the STREAMS cycle happened.

/** The archive found it, so it has coverage by construction. */
export const DISCOVERED_ORIGINS = ['github_release', 'title', 'repo_link'];

/** Somebody else's list, loaded in bulk. Arrives with no coverage. */
export const IMPORTED_ORIGINS = ['topic_index', 'linguist', 'cncf'];

/** A person chose it. */
export const CURATED_ORIGINS = ['seed', 'manual'];

/** What each import actually was, for the row that says where it came from. */
export const IMPORT_SOURCE: Record<string, string> = {
  topic_index: "GitHub's curated topic index",
  linguist: "Linguist, GitHub's language list",
  cncf: 'the CNCF landscape',
};

export type OriginClass = 'discovered' | 'imported' | 'curated';

export function originClass(origin: string): OriginClass {
  if (DISCOVERED_ORIGINS.includes(origin)) return 'discovered';
  if (IMPORTED_ORIGINS.includes(origin)) return 'imported';
  return 'curated';
}

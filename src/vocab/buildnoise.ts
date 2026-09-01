// Releases that are not news.
//
//   Release v1.18-latest · elixir-lang/elixir
//   "Automated release for latest v1.18."          nine words, no content
//
//   YugabyteDB 2026.1.2.0-b90
//   YugabyteDB 2026.1.2.0-b89                      six consecutive nightly builds
//   YugabyteDB 2026.1.2.0-b88
//
// A repository's releases.atom is a build log, not an editorial channel. Most
// of what it carries is a CI artefact: a rolling tag that gets re-pointed every
// night, a release candidate, a patch build with an incrementing suffix and no
// notes. A reader wants to know that Elixir 1.18 shipped. They do not want to
// know that the -latest tag moved again, and they certainly do not want six of
// them in a row above the thing they were looking for.
//
// THIS IS ABOUT THE ITEM, NOT THE PROJECT. Elixir is a real technology and its
// 1.18.0 release is real news. `v1.18-latest` is a machine writing to a tag.
// The test is what the title and body say about themselves.
//
// Nothing here refuses a plain version. "webpack v5.110.1" stays: it is a real
// release of a real thing, and whether patch releases belong in the river is
// what Settings -> Releases you track is for. This file removes only what is
// not a release at all.

/**
 * Suffixes that mean "not the released thing".
 *
 * `-b90` is the one that matters most by volume and the one a naive version
 * regex misses, because it looks like part of the number.
 */
const PRERELEASE = new RegExp(
  '(?:^|[\\s.\\-_])(?:'
  + 'rc\\d*|alpha\\d*|beta\\d*|a\\d+|b\\d+|m\\d+|'          // rc1, beta2, b90
  + 'nightly|snapshot|canary|insiders?|'
  + 'preview|prerelease|pre|unstable|experimental|'
  + 'dev|devel|edge|latest|head|tip|weekly|daily'
  + ')(?:$|[\\s.\\-_+])', 'i');

/** Bodies a machine wrote because a template told it to. */
const TEMPLATED = [
  /^automated release\b/i,
  /^auto(?:matic)? (?:build|release|tag)\b/i,
  /^release for\b/i,
  /^see the changelog\b/i,
  /^no (?:release )?notes\b/i,
];
// An empty body is NOT listed above. A feed that carries titles only is common,
// and "PostgreSQL 18.1" with nothing after it is still a release; it is a bare
// VERSION with nothing after it that is a tag. Rule 3 below draws that line, and
// keeping the empty case out of here is what lets the audit log say which fired.

/** A title that is a version and nothing else: "v1.2.3", "2026.1.2.0-b90". */
const BARE_VERSION = /^\s*v?\d+(?:\.\d+)+[0-9A-Za-z.\-+]*\s*$/;

/**
 * A name and a version, and nothing else.
 *
 * "ComfyUI v0.34.2", "Python v3.11.16", "php-8.5.10", "Java jdk-28+13",
 * "@tanstack/svelte-query@6.1.48". Indistinguishable from BARE_VERSION as far
 * as a reader is concerned -- it is a tag with the project's name on it -- and
 * it was the single biggest miss when this was measured: 330 stories from 108
 * feeds, and most of them this shape.
 *
 * EXACTLY ONE name token, and that is the whole safety margin. Two words in
 * front of a version means somebody was writing a sentence -- "Announcing Rust
 * 1.90.0" is an announcement and "Rust 1.90.0" is a tag -- and an earlier
 * version of this allowed two, which refused the announcement. The GitHub cases
 * this was built for are all caught by isTagPage anyway; this only has to cover
 * feeds that are not repository pages, so it can afford to be strict.
 */
const NAME_AND_VERSION =
  /^\s*[@\w][\w.@/+-]*[ @v-]*\d+(?:[.+]\d+)+[0-9A-Za-z.\-+]*\s*$/;

/**
 * Machine-written titles. Each of these was read off the archive, not guessed.
 *
 *   Incrementing VERSION to 154.0.8029.1          Chromium's version bot
 *   153.0.8010.20: Roll Chrome Win64 PGO Profile  a build step
 *   trunk/3601a4924cb2...: [MPS] Ignore bias      a CI ref, not a release
 *   viable/strict/1787914523: Fix integer over…   the same
 *   chore: release @cypress/webpack-preproces…    a conventional commit
 *   v25.2.23: Merge pull request #3795 from …     a merge commit
 */
const MACHINE_TITLE = [
  /^incrementing version\b/i,
  /\broll [\w ]*pgo profile\b/i,
  /^(?:chore|ci|build|fix|feat|refactor|docs|test)(?:\([^)]*\))?:/i,
  /^[\w-]+\/[0-9a-f]{12,40}\b/i,          // trunk/<sha>
  /^viable\/strict\//i,
  /\bmerge pull request #\d+/i,
  /^create [\w.]+\.json for branch\b/i,
  /\bprototype-v?\d/i,
];

export interface NoiseVerdict {
  noise: boolean;
  /** Which rule fired, for the audit log. */
  why?: 'prerelease' | 'templated' | 'no_content' | 'machine' | 'tag_page';
}

/**
 * A repository tag page.
 *
 *   https://github.com/elixir-lang/elixir/releases/tag/v1.18-latest
 *
 * The surest rule here, and the cheapest: the address says what the thing is
 * before anything has to read the title. Everything under `/releases/tag/` is a
 * git tag rendered as a web page -- whatever wording the tag happens to carry,
 * and whether or not somebody wrote notes on it.
 *
 * This does NOT refuse a project's release ANNOUNCEMENT, which lives on the
 * project's own site: elixir-lang.org/blog, go.dev/blog, the PostgreSQL news
 * page. Those are written for readers. A tag page is written for git.
 */
const TAG_PAGE = /^https?:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+\/releases\/tag\//i;

/** Is this address a repository tag page rather than a published article? */
export function isTagPage(url: string): boolean {
  return TAG_PAGE.test((url ?? '').trim());
}

/**
 * Is this release item a build artefact rather than a release?
 *
 * Deliberately three narrow rules rather than one clever one. Each says
 * something different, each is separately wrong-able, and the audit log records
 * which fired so a bad rule can be found and removed rather than guessed at.
 */
export function isBuildNoise(
  title: string, body = '',
  opts: { words?: number; url?: string; fromReleaseFeed?: boolean } = {},
): NoiseVerdict {
  // The address first, because it is the only rule that does not depend on
  // wording. See isTagPage.
  //
  // THE TAG-PAGE RULE IS ABOUT WHO IS LINKING, NOT WHAT IS LINKED.
  //
  // A github.com/<owner>/<repo>/releases/tag/<v> URL arriving from an aggregator
  // is a machine-written tag somebody's bot posted, and refusing it on sight is
  // right. That same URL is also the canonical address of EVERY entry in every
  // releases.atom feed -- so applied to a release feed the rule refuses the
  // channel wholesale, which is what it did: 179 registered GitHub release feeds
  // fetched successfully, stored nothing, and were then pruned for producing
  // nothing.
  //
  // Measured over 100 entries from ten repositories: the blanket rule refused
  // 100 of 100. The rules below refuse 22 of those on their own -- the bare
  // "v8.2.2" with 41 characters of notes, which is the machine-writing-to-tags
  // case this was written for. The other 78 are releases carrying 123 to 1,430
  // characters of notes, and they are the signal the archive exists to hold.
  //
  // So the rule now asks who is speaking. The finer rules keep the noise out
  // either way, and a tag page cited by anything that is not a release feed is
  // refused exactly as before.
  if (!opts.fromReleaseFeed && opts.url && isTagPage(opts.url)) {
    return { noise: true, why: 'tag_page' };
  }

  const t = (title ?? '').trim();
  if (!t) return { noise: true, why: 'no_content' };

  // A machine wrote this title: a build bot, a CI ref, a merge commit, a
  // conventional-commit prefix. None of them is somebody telling you something.
  if (MACHINE_TITLE.some((re) => re.test(t))) return { noise: true, why: 'machine' };

  // 1. The version says it is not the real one.
  //
  // Checked against the version-looking part of the title only. "Beta" is a
  // word that appears in real headlines -- "Postgres 18 beta 1" is genuinely a
  // beta, but "Announcing the beta of our new engine" is a launch -- and the
  // difference is whether it is attached to a version.
  const version = /v?\d+(?:\.\d+)+[0-9A-Za-z.\-+]*/.exec(t)?.[0]
    ?? (BARE_VERSION.test(t) ? t : '');
  if (version && PRERELEASE.test(version)) return { noise: true, why: 'prerelease' };
  // A tag with no digits at all -- "nightly", "edge" -- is the same thing.
  if (!version && PRERELEASE.test(t) && t.split(/\s+/).length <= 3) {
    return { noise: true, why: 'prerelease' };
  }

  // 2. The body is a template.
  const b = (body ?? '').trim();
  if (TEMPLATED.some((re) => re.test(b))) return { noise: true, why: 'templated' };

  // 3. A bare version with nothing to say about itself.
  //
  // "webpack v5.110.1" with 340 characters of notes is a release. The same
  // title with nine words is a tag that moved. The threshold is words rather
  // than characters because a changelog of one line is still a changelog.
  const words = opts.words ?? (b ? b.split(/\s+/).filter(Boolean).length : 0);
  if (words < 12 && (BARE_VERSION.test(t) || NAME_AND_VERSION.test(t))) {
    return { noise: true, why: 'no_content' };
  }

  return { noise: false };
}

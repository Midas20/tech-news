// Collection follows the reader's choice, and keeps following it.
//
// "Releases you track" in Settings governs what News SHOWS. It now also governs
// what is FETCHED, in both directions and without anybody running a command:
//
//   tracked and not collected    ->  probe the repository, add its feed
//   collected and not tracked    ->  pause the feed
//
// The second half is the one that was missing. `npm run sync:releases --tracked`
// only ever added, so a technology you stopped following kept costing a request
// an hour forever, and the only way to stop it was to notice and go delete a
// row. A registry that grows on its own and shrinks only by hand is a registry
// that is wrong within a month.
//
// PAUSED, NOT DELETED. A source row is the provenance of every story that came
// from it, and `stories.source_id` is ON DELETE NO ACTION precisely so that a
// bookkeeping decision cannot quietly detach an archived story from where it
// came from. Pausing costs one row and no requests; deleting costs the history.
// Re-tracking something is then an UPDATE back to healthy rather than a re-probe.
//
// WHAT IT WILL NOT TOUCH
//   Anything curated. A hand-written row in seeds/primary.ts and a derived one
//   can collide on `sources.url` -- github.com/apache/kafka is in both -- and on
//   that collision the hand-written row wins. The guard is
//   `WHERE sources.curated IS NOT TRUE`, on the update and on the pause alike.

import type { Db } from '../db/client.ts';

export interface ReleaseSyncReport {
  tracked: number;
  added: number;
  resumed: number;
  paused: number;
  probed: number;
  skipped?: string;
  problems: string[];
}

interface Candidate {
  slug: string;
  name: string;
  curated: boolean;
  repo: string;
}

/** github.com/owner/repo -> "owner/repo". Anything else is not a repository. */
function repoPath(repoUrl: string | null): string | null {
  if (!repoUrl) return null;
  const repo = repoUrl.replace('https://github.com/', '').replace(/\/+$/, '');
  // One path segment is an ORGANISATION -- github.com/aws, /cloudflare. There is
  // no releases.atom for an org; its announcement channel is the vendor
  // changelog, which is hand-resolved in seeds/primary.ts.
  if (!repo.includes('/')) return null;
  // A tree/blob URL points inside a repository, not at one.
  if (/\/(tree|blob)\//.test(repo)) return null;
  return repo;
}

/**
 * Bring the release feeds into line with what Settings says is tracked.
 *
 * Idempotent and cheap when nothing has changed: the only GitHub requests are
 * for tracked technologies that have no source row yet, which after the first
 * run is zero.
 */
export async function syncTrackedReleases(
  db: Db,
  opts: { token?: string; months?: number; userAgent?: string } = {},
): Promise<ReleaseSyncReport> {
  const report: ReleaseSyncReport = {
    tracked: 0, added: 0, resumed: 0, paused: 0, probed: 0, problems: [],
  };

  const [row] = await db.query<{ value: unknown }>(
    `SELECT value FROM app_settings WHERE key = 'reading.tracked'`);
  const raw = row?.value;
  const tracked = Array.isArray(raw) ? raw.map(String) : [];
  report.tracked = tracked.length;

  // --- COLLECTION IS NOT GATED BY THE READING LIST ---------------------------
  //
  // This used to pause every release feed for a technology not named in
  // Settings, on the reasoning that fetching something the reader has told you
  // to hide is wasted work. That reasoning describes a different system.
  //
  // `reading.tracked` is a display filter, and the filter itself says so, in
  // buildWhere: "Nothing is lost: the stories are collected, tagged,
  // searchable, counted in the archive, and on Explore. What changes is what
  // the river shows." Two files read one setting and meant opposite things by
  // it -- the reader promised the archive still had everything, and this job
  // made sure it did not.
  //
  // The cost was not theoretical. The setting was empty, so this paused 19
  // feeds -- Bun, Vue, Supabase, Ollama, vLLM, llama.cpp, dbt, Traefik -- and
  // the archive went without them entirely while /all promised otherwise. An
  // empty list is supposed to mean a quiet river, not a starved archive.
  //
  // So: nothing is paused here any more. What was paused for this reason is
  // brought back, once, and the reading list governs only what News shows.
  //
  // TWO MECHANISMS PAUSE THESE ROWS AND THEY WRITE TWO DIFFERENT NOTES:
  //
  //   'paused: no longer tracked...'                        this function
  //   'not polled; kept only because a story ... cites it'  scripts/prune-sources.ts
  //
  // Only the first was matched. prune-sources reduces `sources` to a hardcoded
  // core list and pauses everything else a story cites; when it ran it took out
  // 179 GitHub release feeds -- .NET, Angular, Ansible, Arrow, Beam -- and left
  // them with a note nothing looks for. Every one had a feed_url and zero
  // failures, and fetch_log holds no row for any of them: registered, pruned,
  // and never polled once.
  //
  // The resume also sat BELOW the `tracked.length === 0` return, and
  // `reading.tracked` has never been written -- it is declared in settings.ts,
  // and app_settings holds only reading.fields and gates.backfillEnabled. So the
  // job ran four times a day and could not reach its own resume path.
  //
  // The predicate is the VOCABULARY rather than a hand-kept list: a feed derived
  // from stacks.repo_url is wanted for exactly as long as that stack exists. It
  // matches only the two machine-written notes above, so a source paused by hand
  // keeps its own note and is left alone -- a job on a six-hour timer must not
  // undo a person's decision. Curated rows are untouched, and a feed whose stack
  // has gone stays paused.
  //
  // STAGGERED, NOT ALL AT now(). Every one of these is github.com, so bringing
  // 179 back due at the same instant is one host taking 179 requests in a burst
  // -- the politeness gate is per host, so they would serialise into a six
  // minute march against a single origin on every resume. The offset is
  // hashtext(url) over the poll interval: deterministic, so a second run does
  // not reshuffle a feed that is already scheduled, and spread, so the archive
  // stops looking like a scraper.
  const unpaused = await db.query<{ x: number }>(
    `UPDATE sources SET health = 'healthy', consecutive_failures = 0,
            next_fetch_at = now() + make_interval(
              secs => abs(hashtext(url)) % greatest(poll_interval_seconds, 1)),
            -- The conditional-GET state is a claim that we already hold what
            -- this address last served, and for these rows it is false: they
            -- were fetched once, every item was refused, and nothing was
            -- stored. Keeping the etag makes the origin answer 304 forever and
            -- the feed produce nothing while looking perfectly healthy.
            -- Cleared once, on the way back in, so the current window is read.
            last_etag = NULL, last_modified = NULL,
            notes = 'derived from stacks.repo_url'
      WHERE kind = 'releases'
        AND health = 'paused'
        AND curated IS NOT TRUE
        AND feed_url IS NOT NULL
        AND (notes LIKE 'paused: no longer tracked%'
             OR notes = 'not polled; kept only because a story that survives cites it')
        AND EXISTS (SELECT 1 FROM stacks st WHERE st.repo_url = sources.url)
      RETURNING 1 AS x`);
  report.resumed = unpaused.length;

  if (tracked.length === 0) return report;

  // --- what should be polled and is not --------------------------------------
  //
  // The tracked-set resume that used to sit here is gone: it required
  // `st.slug = ANY(tracked)`, which is a strict subset of the vocabulary-backed
  // resume above, so it could only ever match rows that had already been
  // brought back. What remains below is the half that genuinely needs the
  // tracked list -- probing GitHub for a feed that does not exist yet.

  const missing = await db.query<Candidate & { repo_url: string }>(
    `SELECT st.slug, st.name, st.curated, st.repo_url
       FROM stacks st
      WHERE st.slug = ANY($1::text[])
        AND st.repo_url LIKE 'https://github.com/%'
        AND NOT EXISTS (
          SELECT 1 FROM sources s WHERE s.url = st.repo_url)
      ORDER BY st.slug`, [tracked]);

  if (missing.length === 0) return report;

  const token = opts.token ?? process.env.GITHUB_TOKEN;
  if (!token) {
    // Not an error. Unauthenticated probing is 60 requests an hour, and a
    // scheduler that burns that allowance every six hours to learn nothing is
    // worse than a scheduler that says why it did not try.
    report.skipped = `${missing.length} tracked technolog${missing.length === 1 ? 'y' : 'ies'} `
      + `have no release feed yet and GITHUB_TOKEN is not set, so none was probed.`;
    return report;
  }

  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': opts.userAgent ?? 'newstrack-source-sync',
  };
  const cutoff = Date.now() - (opts.months ?? 12) * 30 * 864e5;

  for (const entry of missing) {
    const repo = repoPath(entry.repo_url);
    if (!repo) continue;
    report.probed++;
    try {
      const kind = await probe(repo, headers, cutoff, entry.curated);
      if (!kind) continue;
      const feed = `https://github.com/${repo}/${kind}.atom`;
      await db.query(
        `INSERT INTO sources (name, url, feed_url, feed_kind, kind, roles, lang,
                              trust_weight, weight_content, never_canonical, fields,
                              poll_interval_seconds, politeness_seconds, shard, curated, notes)
         VALUES ($1,$2,$3,'atom','releases', ARRAY['PRIMARY']::source_role[], 'en',
                 1.0, 0.8, false, ARRAY[]::text[], $4, 2, $5, false, $6)
         ON CONFLICT (url) DO UPDATE SET
           feed_url = EXCLUDED.feed_url, kind = 'releases', health = 'healthy',
           consecutive_failures = 0, next_fetch_at = now(), notes = EXCLUDED.notes
         WHERE sources.curated IS NOT TRUE`,
        [
          `${entry.name} ${kind === 'tags' ? 'tags' : 'releases'}`,
          entry.repo_url, feed,
          // Something the reader explicitly tracks is checked four times a day.
          // `fields` is left empty on purpose: which field a story belongs to is
          // decided by the technologies tagged in it, through the taxonomy
          // closure, and copying a guess onto the source row would put a second,
          // weaker answer next to the real one.
          6 * 3600,
          1 + (report.added % 5),
          `derived from stacks.repo_url (${entry.slug}); tracked in Settings`,
        ]);
      await db.query(
        `UPDATE stacks SET release_feed_url = $2
          WHERE slug = $1 AND release_feed_url IS DISTINCT FROM $2`, [entry.slug, feed]);
      report.added++;
    } catch (err) {
      report.problems.push(`${entry.slug}: ${(err as Error).message.slice(0, 80)}`);
    }
  }

  return report;
}

/**
 * Does this repository announce anything worth polling?
 *
 * Tags are a thinner signal -- a version and a date, no notes -- so they are
 * taken only for entries a person put in the vocabulary. A repository that has
 * not published a release in a year is not dropped from the VOCABULARY; it stays
 * searchable and browsable. It is not made a SOURCE, because polling it forever
 * costs a request an hour to learn nothing.
 */
async function probe(
  repo: string,
  headers: Record<string, string>,
  cutoff: number,
  curated: boolean,
): Promise<'releases' | 'tags' | null> {
  const rel = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=5`, { headers });
  if (rel.status === 404) return null;
  if (!rel.ok) throw new Error(`releases http ${rel.status}`);
  const list = await rel.json() as { published_at: string | null; draft: boolean }[];
  const live = Array.isArray(list) ? list.filter((x) => !x.draft && x.published_at) : [];
  if (live.length > 0) {
    return Date.parse(live[0]!.published_at!) >= cutoff ? 'releases' : null;
  }
  if (!curated) return null;
  const tags = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=1`, { headers });
  const tagList = tags.ok ? await tags.json() as unknown[] : [];
  return Array.isArray(tagList) && tagList.length > 0 ? 'tags' : null;
}

/** One line for a job note. */
export function summariseReleases(r: ReleaseSyncReport): string {
  const bits = [`${r.tracked} tracked`];
  if (r.added) bits.push(`${r.added} added`);
  if (r.resumed) bits.push(`${r.resumed} resumed`);
  if (r.paused) bits.push(`${r.paused} paused`);
  if (r.probed && !r.added) bits.push(`${r.probed} probed, none usable`);
  if (r.skipped) bits.push(r.skipped);
  if (r.problems.length) bits.push(`${r.problems.length} problem(s)`);
  return bits.join(', ');
}

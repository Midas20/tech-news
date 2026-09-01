// Everything that used to be a command, on a schedule.
//
// This file is the answer to "what does NewsTrack do when nobody is watching",
// and it is meant to be read as a whole: the cadences are chosen against each
// other, not one at a time.
//
//   collect     30s   poll whatever is due. The source's own interval decides
//                     its freshness; this only decides how often we check.
//   snapshot    60s   time-critical. A +1h curve point captured at +3h is a
//                     different number and cannot be corrected later.
//   tag        120s   an untagged story is an INVISIBLE story -- News narrows by
//                     `stories.stacks && stack_expand(fields)` -- so this runs
//                     close behind collection rather than with the model work.
//   process     10m   dedup -> classify -> score. Costs model calls, so it runs
//                     on a batch rather than per story.
//   reference   10m   what each technology IS -- background, maker, licence --
//                     from Wikidata and Wikipedia. Ordered so the technologies
//                     that appear in the archive are filled in first.
//   adoption    15m   how many public projects carry each technology's topic.
//                     Paced by GitHub's SEARCH quota, which is 30 a MINUTE and
//                     counted separately from the 5,000-an-hour core quota.
//   discover     6h   propose vocabulary entries from what arrived, then refresh
//                     the rarity table the niche queries read.
//   releases     6h   make the release feeds match Settings, both directions.
//   tune         1h   move each source's interval toward its observed rate, and
//                     make sure next month's partition exists.
//   rollup     03:10  reduce every settled month to analysis that outlives it.
//   retain     03:40  delete what is past the window. AFTER rollup, always.
//   lapsed     04:10  favourites released more than the grace window ago.
//
// WHY THE ORDER OF THE DAILY THREE IS NOT A PREFERENCE
//
// Retention refuses to delete a month whose analysis does not exist, and says so
// rather than proceeding. Rollup at 03:10 is what clears that condition for
// 03:40. If rollup fails, retain runs, finds an unrolled month, refuses, and
// records why -- which is the correct outcome and visible on /admin/jobs. The
// half-hour between them is slack for a slow month, not a guess at how long
// rollup takes.

import type { Job } from './scheduler.ts';
import type { Db } from '../db/client.ts';
import { runCycle, tuneIntervals } from '../collect/cycle.ts';
import { PolitenessGate } from '../collect/fetcher.ts';
import { captureDueSnapshots } from '../process/snapshot.ts';
import { tagStacks } from '../process/tagstacks.ts';
import { tagPlatforms } from '../process/platforms.ts';
import { tagCompanies } from '../process/companies.ts';
import { discoverStacks } from '../process/discover.ts';
import { dedupRecent } from '../process/dedup.ts';
import { refreshAdoption, summariseAdoption } from '../collect/adoption.ts';
import { refreshReferences, summariseReferences } from '../collect/reference.ts';
import { classifyPending } from '../process/classify.ts';
import { scoreUnscored } from '../process/score.ts';
import { partitionMonthsBack } from '../lib/retention.ts';
import { rollupAll } from '../maintain/rollup.ts';
import { retain, summarise } from '../maintain/retain.ts';
import {
  auditionCandidates, auditionTracked, summarise as summariseSources,
} from '../maintain/sources.ts';
import { syncTrackedReleases, summariseReleases } from '../maintain/releases.ts';
import {
  classifySources, summariseClassify,
} from '../maintain/classify.ts';
import { evaluateSources, summariseEvaluate } from '../maintain/evaluate.ts';
import { saveDailyReport, summariseReport } from '../ui/movement.ts';
import { applyStoredSettings } from '../db/repos/settings.ts';
import { getConfig } from '../config.ts';
import type { LlmContext } from '../llm/router.ts';

export interface JobOptions {
  /** Sources per collection cycle. */
  batch?: number;
  /** Feeds fetched at once. */
  concurrency?: number;
  /** Off where outbound requests are metered; on everywhere else. */
  fetchArticles?: boolean;
  /** Model work costs money and quota. Off leaves collection running alone. */
  processing?: boolean;
}

/**
 * One politeness gate for the whole process.
 *
 * Politeness is per DOMAIN across every cycle, not per cycle, so a source polled
 * twice in a minute still waits its interval. Holding it here rather than
 * building one per run is the difference between a promise and a decoration.
 */
const politeness = new PolitenessGate(getConfig().fetch.politenessMs);

export function buildJobs(opts: JobOptions = {}): Job[] {
  const processing = opts.processing ?? true;

  const jobs: Job[] = [
    {
      name: 'collect',
      what: 'Poll every source whose own interval says it is due.',
      everySeconds: 30,
      // A cycle is bounded by its own deadline; the lease is for a process that
      // died holding the claim, which is a different and much longer number.
      leaseSeconds: 600,
      async run({ worker }) {
        // Settings saved in the UI override the environment, and they have to
        // land before anything reads a value off the config. One query.
        const active = await applyStoredSettings(worker);
        const report = await runCycle(worker, {
          limit: opts.batch ?? 40,
          concurrency: opts.concurrency ?? active.fetch.maxConcurrency,
          deadlineMs: 120_000,
          politeness,
          userAgent: active.fetch.userAgent,
          ...(opts.fetchArticles === undefined ? {} : { fetchArticles: opts.fetchArticles }),
        });
        if (report.sources === 0) return '';
        const bits = [`${report.sources} due`, `${report.kept} new`];
        if (report.duplicates) bits.push(`${report.duplicates} dup`);
        if (report.errors) bits.push(`${report.errors} err`);
        if (report.skipped) bits.push(`${report.skipped} left due`);
        return bits.join(', ');
      },
    },

    {
      name: 'snapshot',
      what: 'Capture coverage curve points that have come due.',
      everySeconds: 60,
      async run({ worker }) {
        const r = await captureDueSnapshots(worker, 200);
        return r.captured ? `${r.captured} of ${r.due} captured` : '';
      },
    },

    {
      name: 'tag',
      what: 'Match new stories against the technology, platform and company vocabularies.',
      everySeconds: 120,
      async run({ worker }) {
        // All three are string matching against closed vocabularies -- no model,
        // no budget, no gate -- and each story is examined once however often
        // this runs. That is why tagging is not behind the processing switch:
        // an untagged story cannot appear on News whatever it says, so this is
        // part of collection, not part of analysis.
        const stacks = await tagStacks(worker, 500);
        const platforms = await tagPlatforms(worker, 500);
        const companies = await tagCompanies(worker, 300);
        const total = stacks.tagged + platforms.tagged + companies.tagged;
        return total
          ? `${stacks.tagged} stacks, ${platforms.tagged} platforms, ${companies.tagged} companies`
          : '';
      },
    },

    {
      name: 'tune',
      what: 'Move each source toward its observed publication rate; keep partitions ahead.',
      everySeconds: 3600,
      // ensure_partitions creates tables, which the worker role cannot do.
      //
      // `stories` is partitioned by month and a missing partition does not
      // degrade anything -- it fails the INSERT outright. This used to live in a
      // monthly Worker cron on a deployment that did not exist, so the table had
      // partitions to a certain month and no plan for the day after. Every story
      // collected that day would have been lost with an error nobody was
      // watching for. Idempotent and instant, so hourly costs nothing.
      needs: 'owner',
      async run({ owner, worker }) {
        // Months BACK is the retention window, not a constant.
        //
        // A partition that does not exist does not degrade an insert, it fails
        // it -- and the archive is allowed to hold keepMonths of history, so a
        // fixed 1 was a promise the collector could not keep the moment the
        // window widened. Widening RETENTION_KEEP_MONTHS to reach back to May
        // 2026 found this: stories_2026_05 did not exist and nothing would have
        // created it. Same rule as everywhere else -- one range, read from one
        // place. See lib/retention.ts.
        //
        // partitionMonthsBack, NOT keepMonths. Under KEEP_FOREVER the window is
        // 0 and covers nothing behind this month, while collection reaches back
        // as far as a feed will offer -- so the two numbers came apart and the
        // partition range has to follow the one that inserts.
        await owner.query('SELECT ensure_partitions($1, 3)',
                          [partitionMonthsBack(getConfig().retention.keepMonths)]);
        const tuned = await tuneIntervals(worker);
        const [p] = await owner.query<{ last: string }>(
          `SELECT max(c.relname) AS last
             FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
            WHERE i.inhparent = 'stories'::regclass`);
        const through = (p?.last ?? '?').replace('stories_', '');
        return tuned.faster || tuned.slower
          ? `${tuned.faster} faster, ${tuned.slower} slower; partitions through ${through}`
          : `partitions through ${through}`;
      },
    },

    {
      name: 'adoption',
      what: 'Refresh how many public projects carry the GitHub topic for each technology.',
      // GitHub's SEARCH quota is 30 requests a MINUTE and is counted separately
      // from the 5,000-an-hour core quota. Twenty technologies every fifteen
      // minutes fits inside it with room for the star lookups, and brings the
      // whole registry round in about seventeen hours. An adoption figure does
      // not move in an hour, so that is the right rate to ask at, not a
      // concession to the limit.
      everySeconds: 900,
      leaseSeconds: 600,
      async run({ worker }) {
        return summariseAdoption(await refreshAdoption(worker, {
          userAgent: getConfig().fetch.userAgent,
        }));
      },
    },

    {
      name: 'reference',
      what: 'Fill in what each technology is, from Wikidata and Wikipedia.',
      // Wikimedia is generous and asks to be treated as such. Ten subjects every
      // ten minutes is four or five requests apiece with a wide margin under any
      // published limit, and the ordering puts technologies that actually appear
      // in the archive first -- 279 of 2,330 -- so the pages a reader can reach
      // from a story are filled in within hours rather than days.
      everySeconds: 600,
      leaseSeconds: 900,
      async run({ worker }) {
        return summariseReferences(await refreshReferences(worker));
      },
    },

    {
      name: 'releases',
      what: 'Add a release feed for each technology tracked in Settings; pause the rest.',
      everySeconds: 6 * 3600,
      leaseSeconds: 1800,
      async run({ worker }) {
        return summariseReleases(await syncTrackedReleases(worker));
      },
    },

    {
      name: 'report',
      what: 'Write the day’s movement report: what moved, on what evidence.',
      // After rollup and retain, so the day it describes is settled, and after
      // tag so the stories it counts carry their vocabulary. The page still
      // renders live -- this is the archive keeping its own record, which is the
      // half that survives the stories being pruned.
      everySeconds: 24 * 3600,
      atHour: 7,
      leaseSeconds: 1800,
      async run({ worker }) {
        const query = <T>(sql: string, params: unknown[] = []) =>
          worker.query<T>(sql, params);
        const ctx: LlmContext = { db: worker, env: process.env as Record<string, string> };
        return summariseReport(await saveDailyReport(query, 90, new Date(), ctx));
      },
    },
    {
      name: 'rollup',
      what: 'Reduce every settled month to the analysis that outlives its stories.',
      everySeconds: 24 * 3600,
      atHour: 3,
      leaseSeconds: 3600,
      async run({ worker }) {
        const months = await rollupAll(worker);
        if (months.length === 0) return '';
        const seen = months.reduce((n, m) => n + m.seen, 0);
        const stacks = months.reduce((n, m) => n + m.stacks, 0);
        return `${months.length} month(s): ${seen} stories -> ${stacks} stack-months`;
      },
    },

    {
      name: 'retain',
      what: 'Delete stories past the keep window, once their analysis is safe.',
      everySeconds: 24 * 3600,
      atHour: 3,
      leaseSeconds: 3600,
      // Deleting from `stories` is not granted to the worker role, deliberately:
      // the role that collects should not be able to remove what it collected.
      needs: 'owner',
      async run({ owner }) {
        const config = getConfig();
        const report = await retain(owner, {
          keepMonths: config.retention.keepMonths,
          graceHours: config.retention.favouriteGraceHours,
          // Never VACUUM FULL on a schedule: it holds an ACCESS EXCLUSIVE lock
          // and every read of `stories` blocks for its duration. See the note in
          // maintain/retain.ts.
          reclaim: 'vacuum',
        });
        if (report.refused) throw new Error(report.refused);
        return summarise(report);
      },
    },

    {
      name: 'sources',
      what: 'Audition domains the archive found by itself; promote the ones that '
        + 'prove first-party. Never pauses anything.',
      everySeconds: 24 * 3600,
      atHour: 5,
      leaseSeconds: 3600,
      needs: 'owner',
      async run({ owner }) {
        // Two channels, and the second is the one that pays. Outbound links
        // find THINGS the archive should track; the vocabulary finds the
        // vendors of things it already tracks -- 860 stacks and 151 platforms
        // whose own site nobody reads, Anthropic among them at 6,246 mentions.
        const found = await auditionCandidates(owner);
        const tracked = await auditionTracked(owner);
        return [summariseSources(found), summariseSources(tracked)]
          .filter(Boolean).join(' · ');
      },
    },

    {
      name: 'evaluate',
      what: 'Classify every source by what it IS, and measure what it produced. '
        + 'Changes priority and score only; never pauses or removes anything.',
      everySeconds: 24 * 3600,
      atHour: 6,
      leaseSeconds: 1800,
      needs: 'owner',
      async run({ owner }) {
        // Classification first: evaluate reads source_type when it decides how
        // much a source's evidence is worth, so a run that measured before it
        // classified would score today's new sources against yesterday's idea
        // of what they are.
        const classified = await classifySources(owner, { apply: true });
        const measured = await evaluateSources(owner, { apply: true });
        return [summariseClassify(classified), summariseEvaluate(measured)]
          .filter(Boolean).join(' · ');
      },
    },

    {
      name: 'lapsed',
      what: 'Sweep stories whose favourite was released more than the grace window ago.',
      everySeconds: 24 * 3600,
      atHour: 4,
      needs: 'owner',
      async run({ owner }) {
        const config = getConfig();
        const report = await retain(owner, {
          keepMonths: config.retention.keepMonths,
          graceHours: config.retention.favouriteGraceHours,
          lapsedOnly: true,
          reclaim: 'none',
        });
        return report.pruned ? `${report.pruned} lapsed favourites released` : '';
      },
    },
  ];

  if (processing) {
    jobs.push(
      {
        name: 'process',
        what: 'Deduplicate, classify and score what has arrived.',
        everySeconds: 600,
        leaseSeconds: 1800,
        async run({ worker }) {
          // Order matters: dedup before classification so a merged story is
          // classified once, and classification before scoring because scoring
          // reads is_tech.
          const ctx: LlmContext = { db: worker, env: process.env as Record<string, string> };
          const dedup = await dedupRecent(ctx);
          const classify = await classifyPending(ctx, 100);
          const score = await scoreUnscored(ctx, 100);
          const merged = dedup.autoMerged + dedup.modelMerged;
          const bits: string[] = [];
          if (merged) bits.push(`${merged} merged`);
          if (classify.classified) bits.push(`${classify.classified} classified`);
          if (classify.deferred) bits.push(`${classify.deferred} deferred`);
          if (score.scored) bits.push(`${score.scored} scored`);
          return bits.join(', ');
        },
      },
      {
        name: 'discover',
        what: 'Propose vocabulary entries from what arrived; refresh technology rarity.',
        everySeconds: 6 * 3600,
        leaseSeconds: 1800,
        async run({ worker }) {
          const found = await discoverStacks(worker, { days: 14 });
          // Rarity is read on every niche query and only changes when tagging
          // does, so it is refreshed here rather than on every page.
          await worker.query('SELECT refresh_stack_frequency()').catch(() => undefined);
          return found.proposed || found.promoted
            ? `${found.proposed} proposed, ${found.promoted} promoted, ${found.pending} pending`
            : '';
        },
      },
    );
  }

  return jobs;
}

/** What the scheduler would do, without a database. Used by the tests. */
export function jobNames(opts: JobOptions = {}): string[] {
  return buildJobs(opts).map((j) => j.name);
}

export type { Db };

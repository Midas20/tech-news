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
//   names        5m   read new stories for named tools and platforms the closed
//                     vocabulary cannot represent. The only step that can see a
//                     name nobody has heard of yet.
//   discover     6h   propose vocabulary entries from what arrived, then refresh
//                     the rarity table the niche queries read.
//   releases     6h   make the release feeds match Settings, both directions.
//   tune         1h   move each source's interval toward its observed rate, and
//                     make sure next month's partition exists.
//   period-rd    1h   read one unread week, month or year against what came
//                     before it. One model call each; the backlog drains itself
//                     whenever quota exists.
//   readings     3h   fill in the strategic readings the 07:00 report could not
//                     get. The report has one attempt and takes it at the hour
//                     the overnight ingestion has just emptied the free tiers;
//                     quotas refill during the day and nothing was reaching for
//                     them. Selects nothing on a day the report succeeded.
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
import { scanForNames } from '../process/emerging.ts';
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
import { runDailyReport, summariseReport } from '../analysis/briefing.ts';
import { topUpReadings, summariseTopUp } from '../analysis/readings.ts';
import { readBacklog, summariseRead } from '../analysis/periodread.ts';
import {
  resolveBacklog, refreshSeries, summariseResolve, summariseSeries,
} from '../analysis/downloads.ts';
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

    // ADOPTION AS A MEASUREMENT, across the registry rather than six packages.
    //
    // "The target of report is recognizing market change and finding new
    // market" (2026-09-10). Measured that morning: 35 of 5,993 stories were
    // classified `market`, 510 of 512 sources were news, and of 1,038
    // technologies with a GitHub repository exactly SIX had a download curve.
    // The only real market instrument in the system was pointed at six things.
    //
    // It was six because resolution happened inside the daily report, capped at
    // six subjects so one briefing does not spend its afternoon on registry
    // lookups. That cap is right for a report and wrong for a catalogue, so the
    // work moves here and walks the whole registry instead.
    {
      name: 'resolve-packages',
      what: 'Work out which package each technology ships as, and prove it.',
      // Twenty every five minutes brings 1,038 technologies round in about four
      // days, and each answer is cached for ever, so this is a one-time walk
      // that afterwards only picks up newly added rows. A resolution costs up
      // to six requests: two candidate names against three registries.
      //
      // Deliberately unhurried. Nothing here is urgent -- an adoption curve does
      // not move in an afternoon -- and these are free public APIs run by
      // volunteers and foundations. The rate is manners, not a limit we hit.
      everySeconds: 300,
      leaseSeconds: 600,
      async run({ worker }) {
        return summariseResolve(await resolveBacklog(worker));
      },
    },

    {
      name: 'download-series',
      what: 'Keep every verified package’s download curve current.',
      // One request each, forty at a time, oldest first. Anything fetched in
      // the last twenty hours is left alone, so once the backlog drains this
      // settles into refreshing each package about once a day -- the resolution
      // the curves are actually drawn at.
      everySeconds: 600,
      leaseSeconds: 900,
      async run({ worker }) {
        return summariseSeries(await refreshSeries(worker));
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
      what: 'Read the period’s stories field by field and write what happened.',
      // After rollup, retain and tag, so the stories it reads carry their
      // vocabulary and the day it describes is settled.
      //
      // SINCE THE LAST REPORT, not a rolling window. The first version read a
      // rolling fourteen days every morning: that window holds 2,237 readable
      // stories and about 171 arrive in a day, so consecutive reports shared
      // roughly 92% of their evidence and therefore said the same thing. A daily
      // report that does not change is not a daily report. `runDailyReport`
      // picks up where the last one stopped, so nothing is read twice and
      // nothing between two runs is skipped.
      //
      // The lease is long because this is fourteen model calls in sequence, one
      // per field, and they are deliberately not concurrent: fourteen at once is
      // how a provider rate limit turns one slow report into fourteen failures.
      everySeconds: 24 * 3600,
      atHour: 7,
      leaseSeconds: 3600,
      async run({ worker }) {
        const query = <T>(sql: string, params: unknown[] = []) =>
          worker.query<T>(sql, params);
        const ctx: LlmContext = { db: worker, env: process.env as Record<string, string> };
        return summariseReport(await runDailyReport(ctx, query));
      },
    },
    {
      name: 'readings',
      what: 'Fill in the strategic readings the morning report could not get.',
      // EVERY THREE HOURS, BECAUSE THE REPORT GETS ONE ATTEMPT AND TAKES IT AT
      // THE WORST HOUR OF THE DAY.
      //
      // The report runs at 07:00, by which time the overnight ingestion has
      // spent the free tiers on work that cannot wait -- 319 classify calls,
      // 281 entity_extraction and 53 dedup_pairs on 2026-09-10, roughly 650
      // model calls before the report asked for its first. It then failed on
      // every field and nothing tried again for twenty-four hours.
      //
      // Quotas refill during the day. Until now nothing was reaching for them.
      //
      // Cheap when there is nothing to do: the select returns no rows on a day
      // the report succeeded, and when it does return rows the budget table is
      // consulted before any research happens.
      everySeconds: 3 * 3600,
      leaseSeconds: 1800,
      async run({ worker }) {
        const query = <T>(sql: string, params: unknown[] = []) =>
          worker.query<T>(sql, params);
        const ctx: LlmContext = { db: worker, env: process.env as Record<string, string> };
        return summariseTopUp(await topUpReadings(ctx, query, worker));
      },
    },
    {
      name: 'period-reading',
      what: 'Read a week, month or year against the stories that came before it.',
      // ONE PERIOD PER RUN, hourly. Each is a single model call and the useful
      // property is not speed: it is that the backlog drains by itself whenever
      // quota exists, rather than waiting for somebody to ask for a month that
      // has never been read.
      //
      // The claim these pages used to make -- that a period of stories does not
      // fit in a prompt -- was true of the year and had never been checked
      // against a month. July 2026 holds 360 readable stories; a daily briefing
      // already reads 80 in a ~54,000 character prompt.
      everySeconds: 3600,
      leaseSeconds: 1800,
      async run({ worker }) {
        const query = <T>(sql: string, params: unknown[] = []) =>
          worker.query<T>(sql, params);
        const ctx: LlmContext = { db: worker, env: process.env as Record<string, string> };
        return summariseRead(await readBacklog(ctx, query, worker));
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
        name: 'names',
        what: 'Read new stories for named tools and platforms the taxonomy does not have.',
        // FASTER THAN `process`, AND THAT IS THE POINT. Everything else in this
        // catalogue matches stories against a closed vocabulary of 2,460 things
        // somebody already knew about, which is precisely why the reports found
        // incumbents and missed new markets. This is the one step that can see
        // a name nobody has heard of, and a name is only worth catching on its
        // first appearance -- by the time it reaches a curated feed the market
        // it belongs to is not new any more.
        //
        // Five minutes against ~30-90 stories a day is comfortably ahead of
        // collection, so the backlog stays at zero and first_seen_at means the
        // day the story arrived rather than the day the queue drained.
        everySeconds: 300,
        leaseSeconds: 900,
        async run({ worker }) {
          const ctx: LlmContext = { db: worker, env: process.env as Record<string, string> };
          // TWENTY-FOUR, NOT 120. Steady state is 30-90 stories a day, which
          // is two to eight batches -- this only looks small against the
          // one-off backlog, and draining that greedily is what starved every
          // other model job of budget. See scanForNames() for the rest.
          const found = await scanForNames(ctx, 24);
          const bits: string[] = [];
          if (found.discovered) bits.push(`${found.discovered} new names`);
          if (found.corroborated) bits.push(`${found.corroborated} corroborated`);
          if (found.promoted) bits.push(`${found.promoted} passed the second-source gate`);
          const deferred = Object.values(found.deferReasons).reduce((a, b) => a + b, 0);
          if (deferred) bits.push(`${deferred} batches deferred`);
          if (found.yielded) bits.push('yielded the model budget');
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

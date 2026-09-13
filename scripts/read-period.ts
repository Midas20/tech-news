// Read one period, or store a reading written outside the provider chain.
//
//   npm run read:period -- --month 2026-07          read it with the chain
//   npm run read:period -- --month 2026-07 --dump out.json
//   npm run read:period -- --month 2026-07 --from reading.json --by "who"
//   npm run read:period -- --backlog                 what the job would do next
//
// WHY THE --from PATH EXISTS, since it is the unusual one.
//
// Asked for on 2026-09-10, after /reports/month/2026-07 had spent a day unable
// to produce a reading: "I want you generate report without project's free
// plan." The archive's chain is five providers, four of which are out of
// credentials, quota or money on any given afternoon, and the fifth is the
// weakest reader of the five. That is a fact about the funding of this project
// and not about whether a month can be read.
//
// So a reading may be written by a reader that is not in the chain and handed
// back here. IT IS HELD TO EXACTLY THE SAME STANDARD: `validateStrategy` drops
// any claim that cannot cite both ends of the comparison it asserts, and
// `storedStrategy` resolves every citation index against the same corpus the
// reader was shown and drops what does not resolve. A claim that cannot survive
// its own citations does not reach the page, whoever wrote it.
//
// WHAT IS DIFFERENT IS `provider`, and it is required for that reason. The page
// prints it. A reader who wants to know whether an analysis came out of the
// archive's own pipeline or out of somebody's session can see which, and the
// distinction is not one to bury: a reading nobody can reproduce by re-running
// the archive is a different kind of artefact from one they can.

import { readFileSync, writeFileSync } from 'node:fs';
import { createDb, closePool } from '../src/db/client.ts';
import { applyStoredSettings } from '../src/db/repos/settings.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import {
  periodCorpus, readPeriod, readBacklog, summariseRead, storeReading, topShare,
} from '../src/analysis/periodread.ts';
import {
  rangeFor, isSpan, movementsIn, type Span,
} from '../src/analysis/period.ts';
import { labourPicture, techGap, techOf, controlsOf } from '../src/analysis/labour.ts';
import { workPicture } from '../src/analysis/workmarket.ts';
import { subjectsOf } from '../src/analysis/corpus.ts';
import { priorContext, historySpan } from '../src/analysis/context.ts';
import { validateStrategy } from '../src/analysis/strategy.ts';
import { storedStrategy } from '../src/analysis/briefing.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (name: string) => argv.includes(`--${name}`);

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);
await applyStoredSettings(db);
const query = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params);
const ctx = { db, env: process.env as Record<string, string> };

let span: Span | undefined;
let key: string | undefined;
for (const s of ['week', 'month', 'year'] as const) {
  const v = flag(s);
  if (v) { span = s; key = v; }
}

try {
  if (has('backlog')) {
    console.log(summariseRead(await readBacklog(ctx, query, db)));
  } else if (!span || !key || !isSpan(span)) {
    console.error('Give one of --week YYYY-MM-DD, --month YYYY-MM, --year YYYY,'
      + ' or --backlog.');
    process.exitCode = 1;
  } else {
    const range = rangeFor(span, key);
    if (!range) throw new Error(`not a ${span}: ${key}`);

    const dump = flag('dump');
    const from = flag('from');

    if (dump || from) {
      // The corpus and its earlier end, built exactly as `readPeriod` builds
      // them, so a reading written against the dump cites the same indices the
      // store resolves.
      // HOW MUCH OF THE PERIOD TO READ, and why it is a flag.
      //
      // "the amount of news that you analysis is still low" -- 2026-09-11. The
      // default 120 exists because the provider chain has to fit the corpus
      // into a prompt. A reading written here does not, so --cap raises it, and
      // the same value MUST be used for the dump and the store: the validator
      // resolves every citation against a corpus it rebuilds, and a reading
      // written against 500 stories and stored against 120 would have its
      // citations land on different stories entirely.
      const cap = Number(flag('cap') ?? 0) || undefined;
      const corpus = await periodCorpus(range, query, cap);
      const prior = await priorContext(
        span, { from: range.from, to: range.to }, subjectsOf(corpus, 20), query);

      if (dump) {
        // THE MEASURED FIGURES GO IN THE DUMP, and this is the whole reason a
        // reading can honestly mark a claim `data`.
        //
        // 2026-09-12, against "upgrade all report's quality". The page already
        // renders a verdict block, a labour block and a market block from
        // `labour_series` and `adoption_series` -- real numbers, published by
        // somebody else, re-fetchable by the reader. The READING was written
        // against the stories alone and never saw any of them. So the prose at
        // the top of the page and the figures underneath it were produced from
        // different evidence, every claim was `contested` because nothing
        // measured was in front of the writer, and the one instrument in this
        // archive whose numbers nobody has an interest in went uncited.
        //
        // These are not corpus entries and carry no citation index. The pairing
        // rule is about our own stories and is unchanged; a figure here is
        // context, and a claim resting on it says `data` and names the source
        // in its own reasoning so a reader can go and check it.
        const days = Math.max(1, Math.round(
          (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000));
        const [curves, labour, work] = await Promise.all([
          movementsIn(range, days, query),
          labourPicture(range, 'US', query),
          // THE MARKET FOR WORK, so a reading can say which kinds of work grew
          // and where they are posted rather than only what vendors shipped
          // (2026-09-13: "The report still focus on projects").
          workPicture(range, query),
        ]);
        const gap = techGap(labour);
        const measured = {
          note: 'Published measurements for this period. NOT corpus entries and '
            + 'NOT citable by index: a claim resting on one of these marks itself '
            + '`data` and names the publisher in its own reasoning.',
          labour: {
            source: 'Indeed Hiring Lab, job postings indexed to 2026-02-01 = 100',
            country: labour.country,
            daysOfData: labour.days,
            from: labour.from, to: labour.to,
            technology: techOf(labour),
            controls: controlsOf(labour),
            techVersusControls: gap,
            remoteShare: labour.remote,
            aiShareOfAllPostings: labour.ai,
          },
          work: {
            source: 'Hacker News monthly "Who is hiring?", "Who wants to be hired?" and '
              + '"Freelancer? Seeking freelancer?" threads, counted by kind of work, against '
              + 'the same threads a year earlier; remote boards and Superteam Earn bounties',
            now: work.now,
            yearEarlier: work.before,
            markets: work.markets,
            skills: work.skills,
            boards: work.boards,
            bounties: work.bounties,
          },
          downloads: {
            source: 'npm and PyPI public download APIs',
            daysCovered: curves.measured.days,
            seriesCovered: curves.measured.series,
            registryBreak: curves.shift,
            movements: curves.movements,
          },
        };
        const brief = (xs: typeof corpus) => xs.map((it, i) => ({
          n: i + 1, when: it.when, kind: it.kind, source: it.source,
          independent: it.independent, title: it.title,
          summary: (it.summary ?? '').slice(0, 320),
        }));
        writeFileSync(dump, JSON.stringify({
          span, key, label: range.label, from: range.from, to: range.to,
          note: 'Cite corpus entries as `now`/`evidence` by their n; cite prior '
            + 'entries as `then` by their n.',
          measured,
          corpus: brief(corpus), prior: brief(prior),
        }, null, 1));
        console.log(`${range.label}: ${corpus.length} in period${
          cap ? ` (cap ${cap})` : ''}, ${prior.length} earlier -> ${dump}`);
      }

      if (from) {
        const by = flag('by');
        if (!by) {
          console.error('--from requires --by "who wrote it". The page prints '
            + 'it, and a reading nobody can reproduce must say so.');
          process.exitCode = 1;
        } else {
          const raw = JSON.parse(readFileSync(from, 'utf8'));
          const kept = validateStrategy(raw, corpus.length, prior.length, 0);

          // WHAT THE VALIDATOR THREW AWAY, printed rather than swallowed. This
          // is the number that says whether a reading was written from the
          // corpus or around it.
          const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
          const dropped = [
            ['work', n(raw.work) - kept.work.length],
            ['direction', n(raw.direction) - kept.direction.length],
            ['positioning', n(raw.positioning) - kept.positioning.length],
            ['tensions', n(raw.tensions) - kept.tensions.length],
            ['openings', n(raw.openings) - kept.openings.length],
            ['shift', raw.shift && !kept.shift ? 1 : 0],
          ].filter(([, c]) => (c as number) > 0);
          console.log(dropped.length === 0
            ? 'every claim survived its own citations'
            : `dropped for missing citations: ${dropped
              .map(([k, c]) => `${c} ${k}`).join(', ')}`);

          const strategy = {
            ...kept,
            history: historySpan(prior),
            outside: null,
            provider: by,
            priorCorpus: prior,
          };
          const shaped = storedStrategy({ field: span, corpus, strategy } as never);
          if (!shaped) throw new Error('nothing survived validation');

          await storeReading(query, {
            span, key, range, corpus,
            sources: new Set(corpus.map((i) => i.source)).size,
            share: Math.round(topShare(corpus) * 100),
            provider: by,
            historyRead: strategy.history?.n ?? null,
            historyFrom: strategy.history?.from ?? null,
            strategy: shaped,
          });

          console.log(`stored ${span} ${key}: read from ${corpus.length} stories`
            + `, against ${prior.length} earlier, by ${by}`);
        }
      }
    } else {
      console.log(summariseRead(
        await readPeriod(ctx, span, key, query, db, has('force'))));
    }
  }
} finally {
  await closePool();
}

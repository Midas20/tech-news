// Re-extract stories whose stored text is page chrome.
//
//   npm run refit                  what would change, and 20 before/afters
//   npm run refit -- --apply       write it
//   npm run refit -- --limit 500   a slice of it
//   npm run refit -- --host huggingface.co    one publisher, for the ones a
//                                             rate-limited sweep could not reach
//   npm run refit -- --like 'Back to Articles%'   one known-bad shape, wherever
//                                                 it is, without re-crawling
//
// The repair for migration 0067 and for narrowToArticle(). Until 2026-08-29 the
// container vote returned an ancestor of the article whenever a page's chrome
// was prose rather than links, so what got stored as the summary was the
// masthead and what got stored as body_chars was the whole page. An InfoQ story
// held 3,769 characters of "InfoQ Homepage News ... Follow us on Youtube232K
// Followers" for an article of about 2,200.
//
// ONLY REWRITES A ROW IT CAN PROVE IT WROTE.
//
// The page is fetched once, and the stored summary is checked against EVERY
// element on the walk from the old whole-page winner down to the article. If
// any of them reproduces what is stored, this row is our handwriting and is
// replaced with what the walk lands on now. Where the page has changed since
// collection, or the publisher now refuses us, or the re-extraction is no
// better, the row is left exactly as it is.
//
// The whole chain rather than just the old container, because this script has
// now written two generations of summary. Its first pass ran while NARROW_SHARE
// was 0.6, which on a short post with a busy comment thread walks past the post
// and into the comments -- 1,216 rows were rewritten and one of them came back
// as "Bright8192 Feb 20 Big congrats to GGML and Hugging Face!". Matching only
// the old container would have left this script unable to correct its own
// mistake, which is not a property a repair should have.
//
// That asymmetry is deliberate. A summary is the only description most stories
// ever get, and this script cannot tell a good one it did not write from a bad
// one it did -- so it is allowed to recognise its own handwriting and nothing
// else.

import { parseHTML } from 'linkedom';
import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';
import { __test, extractArticle } from '../src/collect/extract.ts';
import { looksLikeChrome } from '../src/collect/pipeline.ts';
import { normalize, truncateSummary } from '../src/lib/text.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);

const apply = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 4000;
// A publisher that rate-limited a sweep can be picked up on its own afterwards,
// rather than by re-crawling everything to reach it.
const hostArg = process.argv.indexOf('--host');
const hostFilter = hostArg > -1 ? process.argv[hostArg + 1] ?? '' : '';
// And a known-bad shape can be repaired without re-crawling the host it lives
// on. Seventy-two rows still opened "Back to Articles" after a pass that had
// already fetched all 1,893 Hugging Face stories -- they were left behind
// because the rule that recognises them was written afterwards. Fetching 1,893
// pages a second time to reach 72 of them is not politeness, it is waste.
const likeArg = process.argv.indexOf('--like');
const likeFilter = likeArg > -1 ? process.argv[likeArg + 1] ?? '' : '';

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Enough of the stored head to identify it; short enough to survive a reflow. */
const FINGERPRINT = 90;

interface Row { id: string; url: string; summary: string; chars: number; host: string }

const rows = await db.query<Row>(
  `SELECT s.id::text, s.canonical_url AS url, s.summary_en AS summary,
          s.body_chars AS chars,
          split_part(split_part(s.canonical_url, '//', 2), '/', 1) AS host
     FROM stories s
    WHERE coalesce(s.summary_en, '') <> ''
      AND s.body_chars >= 400
      AND ($2 = '' OR s.canonical_url LIKE '%' || $2 || '%')
      AND ($3 = '' OR s.summary_en LIKE $3)
    ORDER BY s.collected_at DESC
    LIMIT $1`, [limit, hostFilter, likeFilter]);

console.log(`${rows.length.toLocaleString('en-US')} stories to check\n`);

// One request at a time per host, several hosts at once. The politeness that
// matters here is per-publisher, not global.
const byHost = new Map<string, Row[]>();
for (const r of rows) {
  const list = byHost.get(r.host) ?? [];
  list.push(r);
  byHost.set(r.host, list);
}

/**
 * How much of this reads like language: letters and spaces, over everything.
 *
 * The second way a row can be proved ours, and it exists because the first one
 * has a limit that only shows up once the SCORER changes. `walk()` starts from
 * whatever pickContainer() picks today, so it reproduces what the old container
 * did only while the vote still reaches the same element. The sentence floor
 * moved that vote: Decrypt's ticker no longer wins, so the walk starts at the
 * article and never passes through the ticker at all, and ten rows made of
 * nothing but a price bar came back "not ours" twice over.
 *
 * A summary cannot always be traced back. It can still be shown not to be
 * prose: "BTC$78,480.000.37%ETH$2,471.33" is 0.2 letters-and-spaces, English
 * runs above 0.9, and no feed description a publisher wrote by hand lands below
 * 0.6. So a row that is not language, replaced by an extraction that is,
 * carries its own justification -- a weaker claim than "we wrote this" and a
 * stronger one than "this is better".
 */
function prosiness(text: string): number {
  const head = text.slice(0, 300);
  if (!head) return 0;
  let letters = 0;
  for (const ch of head) if (/[\p{L}\s]/u.test(ch)) letters++;
  return letters / head.length;
}

/** Not language now, language after. */
function isRubbish(stored: string, extracted: string): boolean {
  return prosiness(stored) < 0.6 && prosiness(extracted) >= 0.8;
}

/**
 * The third way, and the third time the horizon moved.
 *
 * Removing a piece of FURNITURE has the same effect on provenance that changing
 * the scorer did: `pickContainer` strips it before anything is measured, so no
 * element on the walk can reproduce a summary that still contains it. Zig's 74
 * rows begin "<- Back to News page Announcing the Zig Software Foundation..."
 * and came back "not ours" for a rule written the same afternoon to remove that
 * exact block. The not-language test does not save them either: they ARE
 * language, with a nav link on the front.
 *
 * What can still be shown is the relationship between the two texts. If today's
 * extraction appears inside the stored summary a short way in, then the stored
 * summary is this extraction with something in front of it -- and something in
 * front of an article, in under sixty characters, is furniture.
 *
 * Sixty because Zig's prefix is twenty characters and Hugging Face's seventeen.
 * A feed description that happens to quote the article's opening usually has
 * more of its own to say first, and even where this is wrong it replaces a
 * summary with the article's own first words.
 */
function isFurniturePrefixed(stored: string, extracted: string): boolean {
  const head = bare(extracted).slice(0, 60);
  if (head.length < 40) return false;
  const at = bare(stored).indexOf(head);
  return at > 0 && at <= 60;
}

/** The same text with its numbers removed, so live data can still be matched. */
function bare(text: string): string {
  return text.replace(/\d/g, '');
}

/**
 * The text of every element from the whole-page winner down to the article,
 * which is every summary this script's rules have ever produced for this page.
 *
 * Deliberately NOT gated on the current share: it walks the greediest path so
 * that a row written under any past setting is still recognisable as ours.
 */
function walk(start: unknown): string[] {
  const out: string[] = [];
  let cur = start as { children: unknown[]; textContent?: string } | null;
  for (let depth = 0; cur && depth < 16; depth++) {
    out.push(normalize((cur as { textContent?: string }).textContent ?? ''));
    const kids = Array.from((cur as { children: Iterable<unknown> }).children ?? []);
    let best: { el: unknown; words: number } | null = null;
    for (const kid of kids) {
      const words = __test.proseWords(kid as never);
      if (!best || words > best.words) best = { el: kid, words };
    }
    if (!best || best.words === 0) break;
    cur = best.el as typeof cur;
  }
  return out;
}

interface Fix { id: string; host: string; before: string; after: string; chars: number; was: number }
const fixes: Fix[] = [];
const tally = { fetched: 0, unreachable: 0, notOurs: 0, unchanged: 0, stillChrome: 0 };

const sleep = (ms: number) => new Promise((f) => setTimeout(f, ms));

/**
 * Politeness on every request, not only on the ones that turn into a write.
 *
 * The first version slept 1.2s after a rewrite and not otherwise, which meant a
 * publisher whose rows mostly needed no change was asked as fast as the loop
 * could go. Hugging Face answered the way anyone would: 205 of 322 refused, all
 * of them recorded as "unreachable" and skipped -- a transient throttle read as
 * a permanent absence. A 429 is a publisher asking for a slower pace, so the
 * sweep takes one, waits, and asks once more before giving up on the row.
 */
async function get(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 || res.status === 503) {
        if (attempt === 0) { await sleep(20_000); continue; }
        return null;
      }
      if (!res.ok || !(res.headers.get('content-type') ?? '').toLowerCase().includes('html')) {
        return null;
      }
      return await res.text();
    } catch { return null; }
  }
  return null;
}

async function sweep(host: string, list: Row[]): Promise<void> {
  for (const r of list) {
    await sleep(1200);
    const html = await get(r.url);
    if (html === null) { tally.unreachable++; continue; }
    tally.fetched++;

    // Every element on the walk down, on the same HTML. If none of them
    // reproduces what is stored, this row did not come from here and is none of
    // our business.
    //
    // Compared with the digits taken out of both sides, because some of what
    // this has to recognise is LIVE DATA. Decrypt's price ticker was stored as
    // "BTC$78,480.000.37%ETH$2,471.33..." and the page serves different prices
    // every minute, so an exact comparison can never match: all ten rows came
    // back "not ours" -- the guard refusing to repair the very thing it had
    // been pointed at. Two texts identical but for their numbers came off the
    // same element, and ninety characters of that is not a coincidence anything
    // else produces.
    const storedHead = bare(normalize(r.summary)).slice(0, FINGERPRINT);
    const chain = walk(__test.pickContainer(parseHTML(html).document, false));
    const before = chain.find((t) => bare(t).startsWith(storedHead));
    const now = extractArticle(html, r.url);
    const stored = normalize(r.summary);
    if (before === undefined
        && !isRubbish(stored, now.text)
        && !isFurniturePrefixed(stored, now.text)) {
      tally.notOurs++; continue;
    }
    const after = truncateSummary(now.text);
    if (!after || after === normalize(r.summary)) { tally.unchanged++; continue; }
    if (looksLikeChrome(now.text)) { tally.stillChrome++; continue; }

    fixes.push({ id: r.id, host, before: normalize(r.summary), after,
                 chars: now.text.length, was: r.chars });
  }
}

const hosts = [...byHost.entries()];
const LANES = 8;
let next = 0;
await Promise.all(Array.from({ length: LANES }, async () => {
  for (;;) {
    const i = next++;
    if (i >= hosts.length) return;
    const [host, list] = hosts[i]!;
    await sweep(host, list);
    if (i % 20 === 0) console.log(`  ${i}/${hosts.length} hosts, ${fixes.length} to fix`);
  }
}));

console.log(`\nfetched ${tally.fetched}, unreachable ${tally.unreachable}`);
console.log(`not ours (page changed, or the summary came from the feed): ${tally.notOurs}`);
console.log(`already right: ${tally.unchanged}, still chrome after re-extraction: ${tally.stillChrome}`);
console.log(`\nWOULD REWRITE ${fixes.length}\n`);

const shown = fixes.slice(0, 20);
for (const f of shown) {
  console.log(`  ${f.host}  ${f.was.toLocaleString('en-US')} -> ${f.chars.toLocaleString('en-US')} chars`);
  console.log(`    was: ${f.before.slice(0, 96)}`);
  console.log(`    now: ${f.after.slice(0, 96)}`);
}

if (!apply) {
  console.log('\n(dry run. `npm run refit -- --apply` to write it.)');
  await closePool();
  process.exit(0);
}

let written = 0;
for (const f of fixes) {
  await db.query(
    `UPDATE stories SET summary_en = $2, body_chars = $3 WHERE id = $1::uuid`,
    [f.id, f.after, f.chars]);
  written++;
}
console.log(`\n${written} rewritten.`);
await closePool();

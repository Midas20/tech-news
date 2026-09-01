// Which element on a page is the article.
//
// Reported 2026-08-29 against a real reader page: a story headlined "Z.ai's
// GLM-5.3 goes open weight, but its new license aims at hyperscalers" -- a
// licence change, one of the highest-value classes this archive collects --
// rendered as 83 words of somebody else's newsletter signup:
//
//   We're so glad you're here. You can expect all the best TNS content ...
//   Check your inbox for a confirmation email ...
//   Become a TNS follower on LinkedIn.
//
// The article was on the page the whole time. It sits in
// `<div id="tns-post-body-content">` -- 19 paragraphs, matching NONE of
// CONTENT_SELECTORS -- while the only selector that matched anything was
// `.content`, a wrapper holding 15,736 characters of inline script and exactly
// five paragraphs of chrome.
//
// The old score was `total textContent - links + paragraphs`, and total
// textContent counts scripts, JSON-LD and widgets. The wrapper scored 15,449
// against the article's ~8,300 and won; because that cleared the fallback floor
// of 200, the generic scan that would have found the real div never ran.
//
// Counting only text inside BLOCK elements fixes it without a site rule.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractReadable } from '../src/collect/extract.ts';

const SOURCE = readFileSync(new URL('../src/collect/extract.ts', import.meta.url), 'utf8');

/** The shape of the page that broke it, reduced to its essentials. */
function page(): string {
  const chrome = [
    'We’re so glad you’re here. You can expect all the best TNS content to arrive Monday '
      + 'through Friday to keep you on top of the news and at the top of your game.',
    'Check your inbox for a confirmation email where you can adjust your preferences and '
      + 'even join additional groups.',
    'Follow TNS on your favorite social media networks.',
    'Become a TNS follower on LinkedIn.',
    'Check out the latest featured and trending stories while you wait for your first '
      + 'TNS newsletter.',
  ].map((t) => `<p>${t}</p>`).join('');

  // The wrapper's bulk is script, exactly as it is on the real page. It must
  // not count toward "this looks like an article".
  const filler = `<script>${'var x=1;'.repeat(1800)}</script>`
    + `<div class="poll">${'Angular 0% Astro 0% Svelte 0% '.repeat(60)}</div>`;

  const body = Array.from({ length: 19 }, (_, i) =>
    `<p>One thing Z.ai definitely changed is the model’s license, paragraph ${i}. `
    + 'While GLM-5.2 shipped under the permissive MIT license, GLM-5.3 arrives under a '
    + 'bespoke licence aimed squarely at hyperscalers rather than individuals.</p>').join('');

  return `<html><head><title>t</title></head><body>
    <div class="content">${filler}${chrome}</div>
    <div id="tns-post-body-content">${body}</div>
  </body></html>`;
}

describe('picking the article container', () => {
  const readable = extractReadable(page(), 'https://thenewstack.io/zai-glm-weights-license');

  it('finds the article even when it matches no known selector', () => {
    expect(readable.thin).toBe(false);
    expect(readable.words).toBeGreaterThan(400);
  });

  it('does not return the newsletter signup', () => {
    const text = readable.blocks.map((b) => b.text).join(' ');
    expect(text).not.toContain('Become a TNS follower');
    expect(text).not.toContain('Check your inbox for a confirmation email');
    expect(text).toContain('GLM-5.2 shipped under the permissive MIT license');
  });

  it('is not fooled by a wrapper whose bulk is script', () => {
    // The wrapper carries far more characters than the article. Only the
    // article carries more PROSE, and prose is the thing being measured.
    const src = SOURCE;
    expect(src).toContain('PROSE_SELECTOR');
    expect(src).not.toMatch(/const total = \(el\.textContent \?\? ''\)\.length;\s*\n\s*let linkChars/);
  });

  it('keeps table text countable, for the pages that are tables', () => {
    // LWN's "Security updates for Thursday" is a table with no <p> in it.
    // Dropping tr/td from the prose measure would score every candidate on that
    // page at zero and pick one at random.
    expect(SOURCE).toMatch(/PROSE_SELECTOR = '[^']*\btr\b/);
  });
});

// --- and the other direction: the winner that is the whole page --------------
//
// Reported 2026-08-29 against the reading page for an InfoQ story. It was
// stored with a correct headline and rendered as
//
//   InfoQ Homepage News Google Cloud Launches AI-powered Agents ... Follow us
//   on Youtube232K Followers Linkedin26K Followers InstagramNew RSS19K Readers
//   X57.1k Followers Facebook21K Likes BlueskyNew Listen to this article
//
// The block measure above fixed which CANDIDATE wins. It could not fix the
// deeper problem, which is that the vote is a TOTAL and a parent contains
// everything its children contain -- so an ancestor always scores at least as
// much as the article inside it. On most sites the chrome is links and the
// link penalty pays for the difference. InfoQ's chrome is prose: a byline, a
// conference promo, a sponsor paragraph. Prose does not pay the penalty, so
// `div.infoq` -- the entire page -- beat `div.article__data`.

describe('narrowing the winner to the article', () => {
  /** Chrome that is PROSE, wrapped the way InfoQ wraps it. */
  function infoqShaped(): string {
    const body = Array.from({ length: 12 }, (_, i) =>
      `<p>Google Cloud has introduced AI-powered Database Operations Agents, and this is `
      + `paragraph ${i} of the article explaining what the Onboarding Agent does and which `
      + 'database engines the Observability Agent supports today.</p>').join('');
    const rail = `<div class="rail">
      <p>QCon San Francisco: deep technical sessions and peer conversations that change how
         you think about building software at scale.</p>
      <p>Related Sponsor. Intelligent cloud infrastructure for your backup, data lakes and
         AI workloads, used by teams who need to slash recovery time.</p>
      <p>Design for Failure: How to Guarantee Data Access During Cloud Outages.</p></div>`;
    return `<html><body><div class="infoq"><main><article>
      <div class="container__inner"><div class="columns">
        <div class="article__main">
          <div class="article__content"><div class="article__data">${body}</div></div>
          ${rail}
        </div>
      </div></div>
    </article></main></div></body></html>`;
  }

  const readable = extractReadable(infoqShaped(), 'https://infoq.com/news/2026/08/x');

  it('returns the article, not the page it sits on', () => {
    const text = readable.blocks.map((b) => b.text).join(' ');
    expect(text).toContain('Onboarding Agent');
    expect(text).not.toContain('QCon San Francisco');
    expect(text).not.toContain('Related Sponsor');
  });

  it('walks down while one child holds most of the prose', () => {
    expect(SOURCE).toContain('function narrowToArticle');
    expect(SOURCE).toContain('NARROW_SHARE');
  });

  // The guard, and the reason it exists. A share on its own follows a long
  // table or changelog down and abandons the announcement above it: Debian
  // 13.5 lost its release notes to its own package table and Node.js 25.4.0
  // lost "Notable Changes" to its commit list, both to the same move.
  it('stops at an element that owns its own paragraphs', () => {
    const table = Array.from({ length: 40 }, (_, i) =>
      `<tr><td>package-${i}</td><td>Fix a heap overflow issue in the parser, `
      + `reported upstream and backported to the stable branch</td></tr>`).join('');
    const page = `<html><body><div id="content">
      <h1>Updated Debian 13: 13.5 released</h1>
      <p>The Debian project is pleased to announce the fifth update of its stable
         distribution Debian 13, which mainly adds corrections for security issues.</p>
      <p>Please note that the point release does not constitute a new version of Debian
         13 and there is no need to throw away old media.</p>
      <table>${table}</table>
    </div></body></html>`;
    const text = extractReadable(page, 'https://debian.org/News/2026/x')
      .blocks.map((b) => b.text).join(' ');
    expect(text).toContain('pleased to announce the fifth update');
    expect(text).toContain('no need to throw away old media');
    expect(text).toContain('package-39');
  });

  // Words, not characters. A SHA-256 digest is sixty-four characters of one
  // word, so under a character measure the Ruby 3.2.11 download block outweighed
  // the release notes three to one and the walk went straight into the hashes:
  // 278 words became 68.
  it('measures the share in words, so a block of digests cannot win', () => {
    expect(SOURCE).toContain('function proseWords');
    expect(SOURCE).not.toContain('function proseChars');
  });
});

// --- the two walls the share sits between ------------------------------------
//
// NARROW_SHARE is a tuned constant in a six-point window, so both of its walls
// are held here. Moving the number means answering these two tests.
//
// The lower wall was found the expensive way: the share shipped at 0.6, the
// repair pass wrote its output to 1,216 rows, and one of them turned out to be
// somebody's comment -- "Bright8192 Feb 20 Big congrats to GGML and Hugging
// Face!" -- stored as the summary of huggingface.co/blog/ggml-joins-hf.

describe('the walls on either side of the share', () => {
  /** A short post beside a busy discussion: the comments hold more prose. */
  function postWithComments(): string {
    const post = Array.from({ length: 8 }, (_, i) =>
      `<p>Paragraph ${i}. GGML and llama.cpp are joining Hugging Face to ensure the `
      + 'long-term progress of local AI, and this paragraph explains what that means for '
      + 'people running models on their own hardware today.</p>').join('');
    // Fifteen comments against eight paragraphs puts the thread at 0.66 of the
    // page's prose -- the real ratio on that page, and just under the wall.
    const thread = Array.from({ length: 15 }, (_, i) =>
      `<p>Commenter${i} Feb 20 Big congrats to GGML and Hugging Face! Great news for the `
      + 'Local AI community, excited to see llama.cpp grow stronger and keep making local '
      + 'inference something anyone can actually run.</p>').join('');
    // Tailwind utilities, exactly as the real page has them: nothing in the class
    // names says "comments", so no selector could strip this.
    return `<html><body><main><div class="container flex flex-row">
      <div class="max-w-full pb-16 pt-6">
        <div class="max-lg:overflow-hidden">${post}</div>
        <div class="mx-auto my-8 max-w-5xl border-t py-8"><h3>Community</h3>
          <div class="SVELTE_HYDRATER contents"><div class="relative">${thread}</div></div>
        </div>
      </div>
    </div></main></body></html>`;
  }

  it('does not follow a comment thread away from the post it is about', () => {
    const text = extractReadable(postWithComments(), 'https://huggingface.co/blog/ggml-joins-hf')
      .blocks.map((b) => b.text).join(' ');
    expect(text).toContain('long-term progress of local AI');
  });

  it('states the share it was measured at', () => {
    // 0.72 (Cointelegraph, must descend) above, 0.66 (Hugging Face, must not)
    // below. There is no room here for a round number.
    expect(SOURCE).toContain('const NARROW_SHARE = 0.7;');
  });

  it('does not use the headline to decide, because that was tried and it failed', () => {
    // "The article is the part holding the <h1>" is false on exactly the pages
    // this exists to fix: InfoQ and Cointelegraph put the headline in a SIBLING
    // of the body, so the guard blocked both fixes. Measured, then discarded.
    expect(SOURCE).not.toMatch(/narrowToArticle[\s\S]{0,900}querySelector\('h1'\)/);
  });
});


// --- a price ticker is not four hundred articles ------------------------------
//
// Reported 2026-08-30. A Decrypt story about Polygon patching security flaws
// rendered as the site's crypto price bar: "BTC $77,915.00 ETH $2,422.00 BNB
// $685.05 XRP $1.36 ..." for the length of the page.
//
// Decrypt marks every entry in that bar as its own <article>, so the semantic
// selector matched hundreds of them, and `blocks x 25` did the rest:
//
//                blocks   prose chars   blocks >= 40 chars   score
//   the ticker      497       2,975              0          13,945
//   the article      13       2,362             11           2,524
//
// The bonus exists to reward genuinely dense structure. A scrolling price bar is
// the densest thing on the internet by that measure and the least readable.

describe('a block too short to be a sentence is a label', () => {
  function pageWithTicker(): string {
    const coins = ['BTC$77,915.00', 'ETH$2,422.00', 'BNB$685.05', 'XRP$1.36', 'USDC$0.999814',
                   'SOL$102.18', 'TRX$0.336341', 'HYPE$80.72', 'ZEC$833.70', 'DOGE$0.082328'];
    // Two hundred chips, each its own <article>, exactly as Decrypt ships them.
    const ticker = Array.from({ length: 200 }, (_, i) =>
      `<article class="linkbox"><p>${coins[i % coins.length]}</p></article>`).join('');
    const body = Array.from({ length: 12 }, (_, i) =>
      `<p>Paragraph ${i}. Polygon Labs disclosed it patched a batch of security `
      + 'vulnerabilities through two hard forks, Austin on its Bor client and Kyoto on '
      + 'Heimdall, before saying anything publicly about either of them.</p>').join('');
    return `<html><body>
      <article class="ticker">${ticker}</article>
      <main><div class="post-content">${body}</div></main>
    </body></html>`;
  }

  const readable = extractReadable(pageWithTicker(), 'https://decrypt.co/376911/polygon');

  it('returns the article, not the price bar above it', () => {
    const text = readable.blocks.map((b) => b.text).join(' ');
    expect(text).toContain('two hard forks');
    expect(text).not.toContain('BTC$77,915.00');
  });

  it('scores only blocks long enough to be a sentence', () => {
    expect(SOURCE).toContain('SENTENCE_CHARS');
    expect(SOURCE).toContain('function proseBlocks');
  });

  it('keeps the floor under a table row that is genuinely the content', () => {
    // LWN's "Security updates for Thursday" is a table, and its rows read
    // "AlmaLinux ALSA-2026:60215 9 assertj-core 2026-08-27" -- about fifty
    // characters. The floor has to sit under that and over a price chip.
    expect(SOURCE).toMatch(/const SENTENCE_CHARS = 40;/);
    const rows = Array.from({ length: 30 }, (_, i) =>
      `<tr><td>AlmaLinux</td><td>ALSA-2026:6021${i}</td><td>assertj-core</td>`
      + '<td>2026-08-27</td></tr>').join('');
    const text = extractReadable(
      `<html><body><main><table>${rows}</table></main></body></html>`,
      'https://lwn.net/Articles/1/').blocks.map((b) => b.text).join(' ');
    expect(text).toContain('assertj-core');
  });
});

// --- the way back is not part of the way in ----------------------------------

describe('a link back out of the article', () => {
  const article = Array.from({ length: 10 }, (_, i) =>
    `<p>Paragraph ${i}. The Zig Software Foundation is a non-profit dedicated to `
    + 'supporting the development of the Zig programming language and its community '
    + 'over the long term.</p>').join('');

  it('drops it even though it sits inside the article container', () => {
    // Zig opens every post with it and Hugging Face with "Back to Articles",
    // both INSIDE the element holding the article, so no container choice can
    // leave them behind. Both were still arriving in new rows after the
    // container work was finished.
    for (const link of ['← Back to News page', 'Back to Articles', 'Back to blog']) {
      const text = extractReadable(
        `<html><body><div id="content"><a href="/news">${link}</a>${article}</div></body></html>`,
        'https://ziglang.org/news/x').blocks.map((b) => b.text).join(' ');
      expect(text).not.toContain(link);
      expect(text).toContain('non-profit dedicated to supporting');
    }
  });

  it('keeps a heading that only sounds like one', () => {
    // "Back to basics" is something somebody wrote. The destination list is
    // closed for exactly this reason.
    const text = extractReadable(
      `<html><body><div id="content"><h2>Back to basics</h2>${article}</div></body></html>`,
      'https://example.com/x').blocks.map((b) => b.text).join(' ');
    expect(text).toContain('Back to basics');
  });
});

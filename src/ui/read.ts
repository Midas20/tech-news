// Reading an article, as a page.
//
// This was a modal. A modal is the right shape for something you glance at and
// dismiss -- and wrong for the one thing on this site you sit and read. It
// capped the text at the height of a dialog, put a scrollbar inside a
// scrollbar, and made the article the only thing here with no address: you
// could not link to what you were reading, open it in a second tab, or come
// back to it with the back button, because it existed only as JavaScript state
// on top of a list.
//
// So the same payload the modal fetched is rendered server-side at /read/:id.
// The reading column gets the whole viewport, the URL names the article, and
// the page works with JavaScript switched off.
//
// Nothing is stored. readArticle() fetches on request and caches in memory for
// ten minutes (spec 0: no article body is ever written to the database), so
// this route is a view onto a fetch, not onto an archive. Blocks carry text and
// never markup, so nothing from a third-party page reaches the DOM as HTML.

import { readArticle, type ArticlePayload } from './article.ts';
import { one } from './db.ts';
import { favouriteOne, favButton } from './favourites.ts';
import { dismissButton, dismissState } from './dismiss.ts';
import { markRead } from './readstate.ts';
import { backFrom } from './nav.ts';
import { escapeHtml, wrap, icon, empty, relativeTime } from './html.ts';
import type { Block } from '../collect/extract.ts';

/** Roughly how long the prose takes to read, at a middling 230 words a minute. */
function minutes(words: number): number {
  return Math.max(1, Math.round(words / 230));
}

/**
 * One block, as the element it actually is.
 *
 * List items are grouped by the caller; everything else stands alone. `text` is
 * escaped rather than trusted, which is belt-and-braces given the extractor
 * already strips markup -- but this is the one place in the app where content
 * from a stranger's server reaches a page, and it is worth being obvious about.
 */
function block(b: Block): string {
  const t = escapeHtml(b.text);
  // The reader builds this tag itself, around a URL the extractor already
  // proved absolute and https. No attribute here comes through as markup.
  //
  //   loading=lazy         a long article is not a hundred simultaneous requests
  //   referrerpolicy       the publisher learns nothing about where this reader came from
  //   decoding=async       a slow image does not hold up the text
  if (b.kind === 'image') {
    if (!b.src) return '';
    return `<figure class="rd-fig"><img src="${escapeHtml(b.src)}" alt="${t}"
      loading="lazy" decoding="async" referrerpolicy="no-referrer">${
      b.text ? `<figcaption>${t}</figcaption>` : ''}</figure>`;
  }
  if (b.kind === 'h') return `<h2>${t}</h2>`;
  if (b.kind === 'quote') return `<blockquote>${t}</blockquote>`;
  if (b.kind === 'code') return `<pre><code>${t}</code></pre>`;
  return `<p>${t}</p>`;
}

/** Consecutive list items become one list, rather than a run of orphans. */
function body(blocks: Block[]): string {
  const out: string[] = [];
  let items: string[] = [];

  const flush = () => {
    if (!items.length) return;
    out.push(`<ul>${items.join('')}</ul>`);
    items = [];
  };

  for (const b of blocks) {
    if (b.kind === 'li') { items.push(`<li>${escapeHtml(b.text)}</li>`); continue; }
    flush();
    out.push(block(b));
  }
  flush();
  return out.join('');
}

/**
 * The article as plain text, for the copy button.
 *
 * Built here rather than scraped back out of the DOM: the blocks are already
 * typed, and re-parsing rendered HTML to recover the text it was built from is
 * how a copy button ends up with the page furniture in it. The attribution
 * leads, because prose copied with no idea where it came from is how a quote
 * ends up in a document unsourced.
 */
export function articleText(a: ArticlePayload): string {
  const head = [a.title, [a.source, a.author].filter(Boolean).join(' · '), a.url, ''];
  const rest = a.blocks.map((b) =>
    b.kind === 'li' ? `- ${b.text}` : b.kind === 'quote' ? `> ${b.text}`
      : b.kind === 'image' ? (b.text ? `[image: ${b.text}]` : '[image]') : b.text);
  return [...head, ...rest.flatMap((line) => [line, ''])]
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Where the reader came from, when it is somewhere on this site.
 *
 * The filters are part of the answer, not decoration on it -- see `backFrom`.
 */
function backLink(referer: string | null): { href: string; label: string } {
  const t = backFrom(referer, { href: '/all', label: 'Explore', phrase: 'the reader' },
    ['/read/']);
  return { href: t.href, label: t.phrase };
}

export async function renderRead(
  accountId: string, id: string, referer: string | null = null,
): Promise<string> {
  const article = await readArticle(id);

  if (!article) {
    return wrap(`
      <p class="crumbs"><a href="/all">Read</a></p>
      <h1>Not found</h1>
      ${empty('No story with that id. It may have been superseded by a later version — '
        + 'the archive keeps both, but only the latest is addressable here.')}
      <p><a class="btn" href="/all">Back to the reader</a></p>`);
  }

  const back = backLink(referer);
  // Reading something is the moment you decide whether to keep it, so the star
  // belongs beside the other actions rather than back on the list you came from.
  // Opening it IS reading it. Marked here rather than behind a button, because
  // a button you must press after reading is a button nobody presses -- and
  // the manual toggle on every row is the way back when a prefetch or a misclick
  // gets it wrong. See src/ui/readstate.ts.
  const [fav, gone] = await Promise.all([
    favouriteOne(accountId, id), dismissState(id), markRead(accountId, id)]);
  const stored = await one<{ source: string; collected: string; coverage: number }>(
    `SELECT src.name AS source, s.collected_at::text AS collected,
            s.coverage_count AS coverage
       FROM stories s JOIN sources src ON src.id = s.source_id
      WHERE s.id = $1::uuid`, [id]);

  const meta = [
    escapeHtml(article.source || stored?.source || article.host),
    article.author ? escapeHtml(article.author) : '',
    article.published ? escapeHtml(article.published.slice(0, 10)) : '',
    article.words > 0 ? `${article.words.toLocaleString('en-US')} words · ${
      minutes(article.words)} min` : '',
    stored ? `collected ${escapeHtml(relativeTime(stored.collected))} ago` : '',
  ].filter(Boolean).join(' <span class="sep">·</span> ');

  // The two states that are not "here is the article", said plainly rather than
  // shown as an empty column.
  const trouble = article.problem
    ? `<div class="readnote bad">${icon('alert', 15)}<div>
        <p>${escapeHtml(article.problem)}</p>
        ${article.origin ? `<p class="dim">${escapeHtml(article.origin)}</p>` : ''}
      </div></div>`
    : article.thin
      ? `<div class="readnote">${icon('alert', 15)}<div>
          <p>Only a fragment could be extracted — the original is probably worth opening.</p>
        </div></div>`
      : '';

  return wrap(`
    <article class="reading">
      <p class="backlink">
        <a href="${escapeHtml(back.href)}">${icon('arrow-left', 13)} Back to ${
          escapeHtml(back.label)}</a>
      </p>

      <header class="rd-head">
        <h1>${escapeHtml(article.title)}</h1>
        <p class="rd-meta">${meta}</p>
        <div class="rd-acts">
          <a class="btn primary" href="${escapeHtml(article.url)}"
             target="_blank" rel="noreferrer">Original ${icon('external', 12)}</a>
          ${favButton(article.id, fav, `/read/${article.id}`, false)}
          ${dismissButton(article.id, gone, `/read/${article.id}`)}
          <a class="btn" href="/story/${escapeHtml(article.id)}">${
            icon('pulse', 13)} Story record</a>
          <button class="btn" type="button" data-copy="text">${
            icon('copy', 13)} Copy text</button>
          <button class="btn" type="button" data-copy="link">${
            icon('link', 13)} Copy link</button>
        </div>
        <p class="rd-src"><a href="${escapeHtml(article.url)}" target="_blank"
          rel="noreferrer">${escapeHtml(article.url)}</a></p>
      </header>

      ${trouble}

      <div class="rd-body">${body(article.blocks)}</div>

      <footer class="rd-foot">
        <p>Fetched just now from ${escapeHtml(article.host)}, and not stored —
          this page is a view onto a request, not onto an archive.</p>
        <p><a href="${escapeHtml(article.url)}" target="_blank" rel="noreferrer">
          Read it at the source ${icon('external', 12)}</a></p>
      </footer>

      <script type="application/json" id="rd-text">${
        JSON.stringify({ text: articleText(article), url: article.url })
          .replace(/</g, '\\u003c')}</script>
    </article>`);
}

/**
 * The parts that decide what the page says, exposed for tests.
 *
 * renderRead() fetches and queries; these do neither, and they are where the
 * escaping and the block grouping live -- which is exactly what wants pinning
 * down by a test rather than by reading the output once.
 */
export const __test = { body, backLink, minutes };

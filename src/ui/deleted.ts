// What the reader deleted.
//
// A delete with nowhere to look afterwards is a trapdoor: the reader has no way
// to check what went, and no way back from a misclick. The whole reason
// dismissal keeps the row is that it can be undone, so there has to be a page
// where undoing happens.
//
// It doubles as the honest account of what "delete" did. The row is still in
// the archive and still counts toward every aggregate derived from it, and this
// page says so rather than letting the word do work it is not doing.

import { q } from './db.ts';
import { escapeHtml, empty, pageHead } from './html.ts';
import { dismissButton } from './dismiss.ts';
import { crumbsFor } from './nav.ts';

interface Row {
  id: string;
  title: string;
  url: string;
  source: string;
  published: string | null;
  dismissed_at: string;
  dismissed_reason: string | null;
}

export async function renderDeleted(_url: URL): Promise<string> {
  const rows = await q<Row>(
    `SELECT s.id::text, coalesce(s.title_en, s.title_original) AS title,
            s.canonical_url AS url, src.name AS source,
            s.published_at::text AS published,
            s.dismissed_at::text, s.dismissed_reason
       FROM stories s
       JOIN sources src ON src.id = s.source_id
      WHERE s.dismissed_at IS NOT NULL AND s.superseded_by IS NULL
      ORDER BY s.dismissed_at DESC
      LIMIT 500`);

  const body = rows.length === 0
    ? empty(`Nothing deleted. The delete button is on every story, beside the star —
        it takes the story out of every list here, and this page is where it comes back from.`)
    : `<div class="stacklist">${rows.map((r) => `
      <div class="delrow">
        <div style="min-width:0">
          <div class="dt"><a href="${escapeHtml(r.url)}" target="_blank"
            rel="noreferrer">${escapeHtml(r.title)}</a></div>
          <div class="dm">${escapeHtml(r.source)}
            ${r.published ? ` · ${escapeHtml(r.published.slice(0, 10))}` : ''}
            · deleted ${escapeHtml(r.dismissed_at.slice(0, 16).replace('T', ' '))}
            ${r.dismissed_reason ? ` · ${escapeHtml(r.dismissed_reason)}` : ''}</div>
        </div>
        ${dismissButton(r.id, 'dismissed', '/deleted')}
      </div>`).join('')}</div>`;

  return `
    ${pageHead('Deleted', `${rows.length.toLocaleString('en-US')} ${
      rows.length === 1 ? 'story' : 'stories'} you took out of the lists`, {
      crumbs: crumbsFor('/deleted', 'Deleted'),
    })}
    <p class="note">Deleting hides a story everywhere in this reader. It does not remove
      the row, and the difference matters: the month rollups, the coverage counts and every
      technology total are derived from stories, and a settled month is never recomputed —
      so a row that vanished would leave those numbers counting something that is not
      there. It stays, it stops being shown, and it comes back from here.</p>

    ${body}`;
}

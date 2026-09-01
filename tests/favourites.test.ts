// Favourites: the grace window, and the button that shows it.
//
// The database halves (setFavourite, renderFavourites) are one statement each
// and are exercised end to end against a real database. What is pinned down
// here is the arithmetic and the markup -- the parts where being wrong is
// invisible until someone loses a story.

import { describe, it, expect, beforeEach } from 'vitest';
import { hoursLeft, favButton, __test } from '../src/ui/favourites.ts';
import { setConfig, loadConfig } from '../src/config.ts';

beforeEach(() => {
  setConfig(loadConfig({ FAVOURITE_GRACE_HOURS: '24', RETENTION_KEEP_MONTHS: '1' }));
});

const NOW = Date.parse('2026-08-25T12:00:00Z');

describe('the grace window', () => {
  it('gives the full window to something just released', () => {
    expect(hoursLeft('2026-08-25T12:00:00Z', NOW)).toBe(24);
  });

  it('counts down', () => {
    expect(hoursLeft('2026-08-25T02:00:00Z', NOW)).toBe(14);
    expect(hoursLeft('2026-08-24T13:00:00Z', NOW)).toBe(1);
  });

  it('rounds up, so "1 hour" never means "gone in four minutes"', () => {
    expect(hoursLeft('2026-08-24T12:01:00Z', NOW)).toBe(1);
  });

  it('floors at zero rather than going negative', () => {
    expect(hoursLeft('2026-08-20T12:00:00Z', NOW)).toBe(0);
    expect(hoursLeft('2026-08-24T12:00:00Z', NOW)).toBe(0);
  });

  it('follows the configured window rather than a hardcoded day', () => {
    setConfig(loadConfig({ FAVOURITE_GRACE_HOURS: '72' }));
    expect(hoursLeft('2026-08-25T12:00:00Z', NOW)).toBe(72);
  });
});

describe('the button', () => {
  const id = '7d12fe99-1d71-44f1-a829-eb0e6e2119f6';

  it('posts, rather than linking', () => {
    const html = favButton(id, 'none', '/news');
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/favourite"');
  });

  it('offers the opposite of the current state', () => {
    expect(favButton(id, 'none', '/news')).toContain('name="keep" value="1"');
    expect(favButton(id, 'kept', '/news')).toContain('name="keep" value="0"');
    // Released is still off the list, so the offer is to put it back.
    expect(favButton(id, 'released', '/news')).toContain('name="keep" value="1"');
  });

  it('carries where you were standing, so the redirect goes back there', () => {
    expect(favButton(id, 'none', '/all?stack=rust&days=7'))
      .toContain('value="/all?stack=rust&amp;days=7"');
  });

  it('escapes the return path rather than trusting it', () => {
    const html = favButton(id, 'none', '/news?q="><script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('says its state to a screen reader, not only in colour', () => {
    expect(favButton(id, 'kept', '/news')).toContain('aria-pressed="true"');
    expect(favButton(id, 'none', '/news')).toContain('aria-pressed="false"');
  });

  it('marks kept and released differently, so CSS can tell them apart', () => {
    expect(favButton(id, 'kept', '/news')).toContain('class="fav on"');
    expect(favButton(id, 'released', '/news')).toContain('class="fav off"');
    expect(favButton(id, 'none', '/news')).toContain('class="fav"');
  });
});

describe('a row on the shelf', () => {
  const base = {
    id: '7d12fe99-1d71-44f1-a829-eb0e6e2119f6',
    title: 'Something worth keeping', summary: null,
    url: 'https://example.com/a', source: 'Example', collected: '2026-08-20T00:00:00Z',
    published: '2026-08-19T00:00:00Z', importance: 7, stacks: ['rust'],
    saved_at: '2026-08-21T00:00:00Z', unfavourited_at: null as string | null,
  };

  it('says it is kept when it is', () => {
    const html = __test.row(base, NOW);
    expect(html).toContain('kept');
    expect(html).not.toContain('deletes in');
  });

  it('counts down once released, and marks the row', () => {
    const html = __test.row({ ...base, unfavourited_at: '2026-08-25T02:00:00Z' }, NOW);
    expect(html).toContain('deletes in 14 hours');
    expect(html).toContain('lapsing');
  });

  it('says what actually happens next once the window has passed', () => {
    const html = __test.row({ ...base, unfavourited_at: '2026-08-01T00:00:00Z' }, NOW);
    // Not "deletes in 0 hours" -- nothing deletes it until retention runs, and
    // claiming otherwise would be a countdown to an event that may be a week off.
    expect(html).toContain('removed at the next retention run');
  });

  it('escapes a hostile title', () => {
    const html = __test.row({ ...base, title: '<img src=x onerror=alert(1)>' }, NOW);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

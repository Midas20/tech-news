// The rail's two menus, as URLs.
//
// Both cases here were reported the same way -- "the left sidebar works
// strangely, some fields can't select at the same time" -- and both were the
// same mistake in different clothes: a menu entry drawn as selected whose link
// did not behave like a selected entry's link.

import { describe, it, expect } from 'vitest';
import {
  parseFilters, toQuery, toggled, toggledKind, isActive, buildWhere, EVENT_DEFAULT,
  SORTS, SORT_LABELS, importanceTitle,
  STREAMS,
  ABOUT,
} from '../src/ui/filters.ts';
import { READING_DEFAULTS } from '../src/settings.ts';

const at = (query: string) => parseFilters(new URL(`http://ui/news${query}`));
/** The values of one repeated key, in URL order. */
const values = (href: string, key: string) =>
  [...new URL(href, 'http://ui').searchParams.getAll(key)];

describe('fields combine', () => {
  it('several are kept, not overwritten by the last one', () => {
    // Read through get(), two fields in a URL were one field and a discarded
    // one -- which is what "can't select at the same time" looked like.
    expect(at('?field=ai&field=security').field).toEqual(['ai', 'security']);
  });

  it('an unknown slug is dropped and the rest survive', () => {
    expect(at('?field=ai&field=not-a-field').field).toEqual(['ai']);
  });

  it('clicking a second field adds it', () => {
    const f = at('?field=ai');
    expect(values(toggled(f, 'field', 'security'), 'field')).toEqual(['ai', 'security']);
  });

  it('clicking a selected field removes only that one', () => {
    const f = at('?field=ai&field=security');
    expect(isActive(f, 'field', 'ai')).toBe(true);
    expect(values(toggled(f, 'field', 'ai'), 'field')).toEqual(['security']);
  });

  it('they union in SQL, in one expansion of the closure', () => {
    const { sql, params } = buildWhere(at('?field=ai&field=security'));
    expect(sql).toContain('stack_expand');
    expect(sql.match(/stack_expand/g)).toHaveLength(1);
    expect(params).toContainEqual(['ai', 'security']);
  });

  it('survives a round trip', () => {
    const f = at('?field=ai&field=security&sort=velocity');
    expect(parseFilters(new URL(toQuery(f), 'http://ui')).field).toEqual(['ai', 'security']);
  });
});

describe('event classes toggle from what the rail shows', () => {
  it('the default is everything except Articles', () => {
    // Four of five since `market` joined them: funding, acquisitions and which
    // way adoption is moving are half the project's purpose, so they are shown
    // by default exactly as launches and releases are.
    expect(at('').kind2).toEqual([]);
    expect(EVENT_DEFAULT).toEqual(['launch', 'release', 'change', 'market']);
  });

  it('adding Articles keeps the ones that were lit', () => {
    // The bug: toggled() read kind2, which is empty under the default, so this
    // produced a selection of exactly one and darkened the others.
    expect(values(toggledKind(at(''), 'article'), 'kind2').sort())
      .toEqual(['article', 'change', 'launch', 'market', 'release']);
  });

  it('removing one keeps the rest', () => {
    expect(values(toggledKind(at(''), 'change'), 'kind2').sort())
      .toEqual(['launch', 'market', 'release']);
  });

  it('coming back to the default writes no parameter at all', () => {
    // One view, one URL: every non-article class selected IS /news.
    const all = at('?kind2=launch&kind2=release&kind2=change&kind2=market&kind2=article');
    expect(values(toggledKind(all, 'article'), 'kind2')).toEqual([]);
  });

  it('turning the last one off returns to the default rather than to nothing', () => {
    const one = at('?kind2=change');
    expect(values(toggledKind(one, 'change'), 'kind2')).toEqual([]);
  });
});

describe('the News page asks the questions the page is for', () => {
  it('offers a sort by how new the TECHNOLOGY is', () => {
    // Newest-first answers "what happened lately". This answers the other half
    // of the page -- "what is new" -- which until now was only readable in the
    // rail and could not be applied to the list.
    // "Newcomers", not "First seen": the first names the things, the second
    // names the archive's bookkeeping about them.
    expect(SORT_LABELS.firstseen).toBe('Newcomers first');
    expect(SORTS.firstseen).toContain('stack_totals');
    // Through unnest and the unique index, never `t.slug = ANY(s.stacks)`,
    // which re-scans the matview once per candidate story.
    expect(SORTS.firstseen).toContain('unnest(s.stacks)');
    expect(SORTS.firstseen).not.toMatch(/ANY\(s\.stacks\)/);
    // A story naming nothing the archive knows must not sort to the top.
    expect(SORTS.firstseen).toContain('NULLS LAST');
  });

  it('drops the sort that duplicated another and needed a model to work', () => {
    // `niche` was a classifier score, NULL whenever classification is off, and
    // it ranked by inverse coverage -- which `coverage` already orders by and
    // `rarest` answers deterministically. Nothing linked to it.
    expect(SORTS.niche).toBeUndefined();
    expect(SORT_LABELS.niche).toBeUndefined();
  });

  it('filters by how recently a technology first appeared', () => {
    expect(at('?fresh=2').fresh).toBe(2);
    expect(at('').fresh).toBeNull();
    const { sql, params } = buildWhere(at('?fresh=2'));
    expect(sql).toContain('stack_totals');
    expect(sql).toContain('unnest(s.stacks)');
    expect(sql).toContain('make_interval');
    expect(params).toContain(2);
  });

  it('leaves the list alone when no age is asked for', () => {
    expect(buildWhere(at('')).sql).not.toContain('stack_totals');
  });

  it('carries the age filter through a round trip', () => {
    const f = at('?fresh=11&about=tool&sort=firstseen');
    const back = parseFilters(new URL(toQuery(f), 'http://ui'));
    expect([back.fresh, back.about, back.sort]).toEqual([11, 'tool', 'firstseen']);
  });

  it('falls back to newest when a retired sort is still in a saved link', () => {
    expect(SORTS[at('?sort=niche').sort] ?? SORTS.newest).toBe(SORTS.newest);
  });
});

describe('First seen is a stream, not a saved preset', () => {
  it('is defined by what the items are', () => {
    // The other three streams are "an event", "from a release feed", "from a
    // community board". This one is "about a technology the archive had never
    // seen before this quarter" -- the same kind of test, so it earns a tab.
    const { sql } = buildWhere(at('').base === '/news'
      ? parseFilters(new URL('http://ui/new'))
      : parseFilters(new URL('http://ui/new')));
    expect(sql).toContain('stack_totals');
    expect(sql).toContain('NOT s.is_prerelease');
    // Same three-month window as the rail group, so the tab and the group
    // cannot disagree about what new means.
    expect(sql).toContain("interval '2 months'");
  });

  it('is one of the two questions News answers', () => {
    // Releases and Community were streams defined by source kind -- where an
    // item arrived from, which is the definition News itself stopped using.
    expect(STREAMS.map((s) => s.path)).toEqual(['/news', '/new', '/all']);
  });

  it('still takes every other control', () => {
    const f = parseFilters(new URL('http://ui/new?about=tool&field=ai&sort=firstseen'));
    expect([f.kind, f.about, f.field, f.sort]).toEqual(['new', 'tool', ['ai'], 'firstseen']);
    expect(buildWhere(f).sql).toContain('stack_totals');
  });

  it('does not leak into the other streams', () => {
    for (const path of ['/news', '/all']) {
      expect(buildWhere(parseFilters(new URL(`http://ui${path}`))).sql)
        .not.toContain("interval '2 months'");
    }
  });
});

describe('the two News tabs are about two different recencies', () => {
  it('the About options use the same nouns as the tabs', () => {
    // "A technology" for kind='stack' was the umbrella word used for one of the
    // three things under it, so the same filter read "Stacks" in the rail and
    // "A technology" in the dropdown.
    const labels = ABOUT.map((a) => a.label);
    expect(labels).toContain('A stack');
    expect(labels).toContain('A tool');
    expect(labels).toContain('A platform');
    expect(labels).not.toContain('A technology');
    expect(labels).not.toContain('An earning platform');
  });

  it('First seen narrows inside its own stream and cannot widen past it', () => {
    // /new IS the last quarter. An option of "this year" would be ANDed against
    // that and change nothing, which is a control lying about what it does.
    const f = parseFilters(new URL('http://ui/new?fresh=0'));
    const { sql } = buildWhere(f);
    expect(sql).toContain("interval '2 months'");   // the stream
    expect(sql).toContain('make_interval');          // and the narrowing
  });
});

describe('importance says what the number counts', () => {
  it('names the band, in the words the scorer was given', () => {
    // A bare "8" in the margin is a rating of nothing in particular. The bands
    // are the ones the importance_triage prompt defines and assignTier() splits
    // on, so the badge, the filter and the delivery tier agree.
    expect(importanceTitle(9)).toContain('critical');
    expect(importanceTitle(8)).toContain('critical');
    expect(importanceTitle(7)).toContain('notable');
    expect(importanceTitle(6)).toContain('notable');
    expect(importanceTitle(5)).toContain('moderate');
    expect(importanceTitle(4)).toContain('moderate');
    expect(importanceTitle(3)).toContain('background');
    expect(importanceTitle(0)).toContain('background');
  });

  it('never reads an unscored story as an unimportant one', () => {
    // NULL is "nobody has judged this yet", and scoring happens a step after
    // classification -- so it is the normal state of a fresh story, not a
    // verdict. Every filter floor hides these rows, which is why the page says
    // so out loud when one is set.
    expect(importanceTitle(null)).toBe(
      'not scored yet — importance is judged after classification');
    expect(importanceTitle(null)).not.toContain('0');
  });
});

describe('releases are only news if you track the thing releasing', () => {
  it('hides every release on News when nothing is tracked', () => {
    // 320 curated repositories publish a version most days. Measured the day
    // the release feeds went in: 195 releases against 1 launch and 27 changes,
    // which buries the two classes a reader cannot afford to miss under the one
    // they can.
    const { sql } = buildWhere({ ...at(''), tracked: [] });
    expect(sql).toContain("s.event_kind IS DISTINCT FROM 'release'");
    expect(sql).not.toContain('stack_expand');
  });

  it('lets a tracked technology through, and only that one', () => {
    const { sql, params } = buildWhere({ ...at(''), tracked: ['postgresql', 'go'] });
    expect(sql).toContain("s.event_kind IS DISTINCT FROM 'release'");
    expect(sql).toContain('stack_expand');
    expect(params).toContainEqual(['postgresql', 'go']);
  });

  it('never touches launches, changes or anything unjudged', () => {
    // IS DISTINCT FROM, not <>: event_kind is NULL for anything the classifier
    // has not seen, and NULL must keep passing. Reading "not yet judged" as "a
    // release" would hide the unclassified archive.
    const { sql } = buildWhere({ ...at(''), tracked: [] });
    expect(sql).not.toContain("event_kind = 'launch'");
    expect(sql).toMatch(/IS DISTINCT FROM 'release'/);
  });

  it('does not apply on Explore, which never hides a thing that happened', () => {
    const explore = parseFilters(new URL('http://ui/all'),
      { ...READING_DEFAULTS, tracked: ['postgresql'] });
    expect(explore.tracked).toEqual([]);
    expect(buildWhere(explore).sql).not.toContain("IS DISTINCT FROM 'release'");
  });

  it('does not apply on Newcomers, whose subject is what you do not know yet', () => {
    // Filtering the tab that shows technologies the archive has just met by a
    // list of technologies you already depend on empties it by construction.
    const newcomers = parseFilters(new URL('http://ui/new'),
      { ...READING_DEFAULTS, tracked: ['postgresql'] });
    expect(newcomers.tracked).toEqual([]);
  });
});

describe('category filter', () => {
  const at = (q: string) => parseFilters(new URL(`http://x/all${q}`), READING_DEFAULTS);

  it('accepts the vocabulary categories', () => {
    expect(at('?category=language').category).toEqual(['language']);
    expect(at('?category=language&category=db').category).toEqual(['language', 'db']);
  });

  it('drops anything that is not one', () => {
    expect(at('?category=nonsense').category).toEqual([]);
    expect(at("?category=';DROP TABLE stacks--").category).toEqual([]);
  });

  it('de-duplicates, like every other multi-select', () => {
    expect(at('?category=db&category=db').category).toEqual(['db']);
  });

  it('survives a round trip through the query string', () => {
    const f = at('?category=language&category=framework');
    expect(toQuery(f, {})).toContain('category=language');
    expect(toQuery(f, {})).toContain('category=framework');
  });

  it('narrows rather than replaces when combined with a field', () => {
    // A category is what a thing IS; a field is the area it belongs to. Both
    // selected must mean both, which is the whole point of multi-select.
    const f = at('?category=db&field=security');
    const { sql } = buildWhere(f);
    expect(sql).toContain('stack_expand');
    expect(sql).toContain('k.category = ANY');
  });

  it('builds no category clause when nothing is chosen', () => {
    expect(buildWhere(at('')).sql).not.toContain('k.category');
  });
});

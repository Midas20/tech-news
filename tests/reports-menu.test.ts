// A report needed a way in, then it did not deserve a section, and now it does.
//
// The history is the argument, so it is written down rather than assumed:
//
//   2026-08-29  `/field/<slug>/report` reachable from one button most of the way
//               down the river it was written to replace. Not shipped, really.
//   2026-08-30  given a tab. Taken away the same day -- "this page isn't enough
//               to be individual menu" -- and that was right: the rail was
//               fourteen links to fourteen field reports, which is the index it
//               duplicates wearing a menu.
//   2026-09-01  a tab again, because a report is now written every morning and
//               kept. The section has two axes -- days down, fields across --
//               and neither is reachable from the other without a rail.
//
// What has to stay true through all three: a report is reachable without reading
// the river first, and the navigation agrees with itself about where you are.

import { describe, it, expect } from 'vitest';
import {
  SECTIONS, sectionFor, isOn, EXPLORE_ITEMS, ANALYSE_ITEMS, REPORT_ITEMS, crumbsFor,
} from '../src/ui/nav.ts';
import { FIELDS } from '../src/vocab/fields.ts';

const section = SECTIONS.find((s) => s.id === 'reports');

describe('reports is a section', () => {
  it('has a tab of its own, landing on the index', () => {
    expect(section).toBeDefined();
    expect(section!.home).toBe('/reports');
  });

  it('owns the index, a dated day, and every field report', () => {
    expect(sectionFor('/reports').id).toBe('reports');
    expect(sectionFor('/reports/2026-08-20').id).toBe('reports');
    for (const f of FIELDS) {
      expect(sectionFor(`/field/${f.slug}/report`).id).toBe('reports');
      expect(sectionFor(`/field/${f.slug}/report/2026-08-26`).id).toBe('reports');
    }
  });

  it('takes the composed briefing out of Analyse rather than listing it twice', () => {
    // A destination in two rails is how a reader learns to check both.
    expect(sectionFor('/trends/report').id).toBe('reports');
    expect(ANALYSE_ITEMS.some((i) => i.href === '/trends/report')).toBe(false);
    expect(ANALYSE_ITEMS.some((i) => i.href === '/reports')).toBe(false);
    expect(EXPLORE_ITEMS.some((i) => i.href === '/reports')).toBe(false);
  });

  it('leaves the series and the rivers where they were', () => {
    expect(sectionFor('/trends').id).toBe('analyse');
    expect(sectionFor('/trend/rust').id).toBe('analyse');
    expect(sectionFor('/fields').id).toBe('explore');
    for (const f of FIELDS) {
      expect(sectionFor(`/field/${f.slug}`).id).toBe('explore');
    }
  });
});

describe('the distinction a prefix cannot make', () => {
  // Every report lives UNDER '/field/<slug>', which is what Explore's Fields
  // entry matches. No ordering of prefixes separates them: Reports would have to
  // claim '/field/' and take the rivers with it.
  const fields = EXPLORE_ITEMS.find((i) => i.href === '/fields')!;

  it('does not light Fields on a report', () => {
    expect(isOn('/field/security/report', fields)).toBe(false);
    expect(isOn('/field/security/report/2026-08-26', fields)).toBe(false);
  });

  it('still lights Fields on the field itself', () => {
    expect(isOn('/field/security', fields)).toBe(true);
    expect(isOn('/fields', fields)).toBe(true);
  });

  it('separates them by a rule that survives a dated report', () => {
    // The guard was endsWith('/report'), which a dated URL walks straight past.
    expect(sectionFor('/field/security/report/2026-08-26').id).toBe('reports');
    expect(sectionFor('/field/security').id).toBe('explore');
  });

  it('does not claim a field whose slug merely starts with report', () => {
    expect(sectionFor('/field/reporting').id).toBe('explore');
  });
});

describe('the navigation agrees with itself', () => {
  it('never leaves a report path falling through to the default section', () => {
    // sectionFor() returns SECTIONS[0] for anything unclaimed, so a broken rule
    // shows up as the wrong tab rather than as an error.
    expect(SECTIONS[0]!.id).toBe('news');
    for (const p of ['/reports', '/reports/2026-08-20', '/field/ai/report',
      '/field/ai/report/2026-08-26', '/trends/report']) {
      expect(sectionFor(p).id, `${p} fell through`).toBe('reports');
    }
  });

  it('gives a report page a breadcrumb naming a section that exists', () => {
    // A breadcrumb that names a section the top bar does not have is worse than
    // none, because it is a claim about where you are.
    const trail = crumbsFor('/field/ai/report', 'AI & ML');
    expect(trail[0]).toMatchObject({ label: 'Reports', href: '/reports' });
  });

  it('says nothing on the section home, where the tab already says it', () => {
    expect(crumbsFor('/reports', 'Reports')).toEqual([]);
  });

  it('offers a rail entry for every report page a reader can open', () => {
    expect(REPORT_ITEMS.some((i) => i.href === '/reports')).toBe(true);
    expect(REPORT_ITEMS.some((i) => i.href === '/trends/report')).toBe(true);
  });

  it('keeps every section pointing at a page inside itself', () => {
    for (const s of SECTIONS) {
      expect(sectionFor(s.home).id, `${s.id} home is in another section`).toBe(s.id);
    }
  });
});

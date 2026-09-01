// The report needs a way in, and it does not need a section.
//
// `/field/<slug>/report` existed for a week reachable from exactly one place: a
// button most of the way down `/field/<slug>`. So the only route to the summary
// ran through the raw list it was written to replace, which is a fair
// description of not shipping it.
//
// The first fix overshot and gave it a tab of its own. It did not carry one --
// fourteen links to fourteen reports is a rail holding nothing but the index it
// duplicates. It lives under Explore, as one entry beside Fields.
//
// What has to stay true either way: a report is reachable without reading the
// river first, and the navigation agrees with itself about where you are.

import { describe, it, expect } from 'vitest';
import { SECTIONS, sectionFor, isOn, EXPLORE_ITEMS } from '../src/ui/nav.ts';
import { FIELDS } from '../src/vocab/fields.ts';

const reports = EXPLORE_ITEMS.find((i) => i.href === '/reports');

describe('the way in to a report', () => {
  it('is an entry in Explore, not a section of its own', () => {
    expect(reports).toBeDefined();
    expect(SECTIONS.some((s) => s.home === '/reports')).toBe(false);
  });

  it('puts the index and every report inside Explore', () => {
    expect(sectionFor('/reports').id).toBe('explore');
    for (const f of FIELDS) {
      expect(sectionFor(`/field/${f.slug}/report`).id).toBe('explore');
    }
  });

  it('lights Reports on a report and Fields on the field itself', () => {
    // The distinction a prefix cannot make. Every report lives UNDER
    // '/field/<slug>', which is exactly what the Fields entry matches, so
    // without a suffix rule both entries light or the wrong one does.
    const fields = EXPLORE_ITEMS.find((i) => i.href === '/fields')!;

    expect(isOn('/field/security/report', reports!)).toBe(true);
    expect(isOn('/field/security/report', fields)).toBe(false);

    expect(isOn('/field/security', fields)).toBe(true);
    expect(isOn('/field/security', reports!)).toBe(false);

    expect(isOn('/fields', fields)).toBe(true);
  });

  it('does not let a report path fall through to the default section', () => {
    // sectionFor() returns SECTIONS[0] for anything unclaimed, so a broken rule
    // shows up as the wrong tab rather than as an error.
    expect(SECTIONS[0]!.id).toBe('news');
    expect(sectionFor('/reports').id).not.toBe('news');
  });
});

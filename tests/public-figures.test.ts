// A number in a report has to be checkable by somebody who does not have our
// database.
//
// "If you want to use this value, collect public value of it in net"
// -- 2026-09-01. So the only quantities allowed near a briefing are GitHub's
// public topic census and star counts, and this file guards the two properties
// that make them worth quoting: they carry the date they were taken, and an
// unmeasured technology is never rendered as a zero.

import { describe, it, expect } from 'vitest';
import {
  describeFigure, bySize, oldestMeasurement, publicFigures, type PublicFigure,
} from '../src/analysis/public.ts';

function fig(over: Partial<PublicFigure> = {}): PublicFigure {
  return {
    slug: 'rust', name: 'Rust', projects: 41234, stars: 98765,
    measuredAt: '2026-08-28', repoUrl: null, source: 'github', ...over,
  };
}

describe('a figure states where it came from and when', () => {
  it('names the source and the measurement date', () => {
    const s = describeFigure(fig());
    expect(s).toContain('github');
    expect(s).toContain('2026-08-28');
  });

  it('says what the number is OF, because stars and projects are not the same thing', () => {
    const s = describeFigure(fig());
    expect(s).toContain('public GitHub project');
    expect(s).toContain('stars on its own repository');
  });

  it('groups digits, because 41234 is harder to read than 41,234', () => {
    expect(describeFigure(fig())).toContain('41,234');
  });

  it('reports only what exists when a repository was never identified', () => {
    const s = describeFigure(fig({ stars: null }));
    expect(s).toContain('public GitHub project');
    expect(s).not.toContain('stars');
  });

  it('states absence rather than implying nothing exists', () => {
    // "0 projects" and "we never asked" look identical in a column that
    // defaults to zero, and only one of them is a fact.
    expect(describeFigure(fig({ projects: null, stars: null })))
      .toContain('no public figure measured');
  });

  it('renders a genuine zero as a zero', () => {
    expect(describeFigure(fig({ projects: 0, stars: null })))
      .toContain('0 public GitHub projects');
  });

  it('gets the singular right', () => {
    expect(describeFigure(fig({ projects: 1, stars: null })))
      .toContain('1 public GitHub project carry');
  });
});

describe('ordering by size', () => {
  it('puts the larger population first', () => {
    const out = bySize([
      fig({ slug: 'tiny', projects: 90 }),
      fig({ slug: 'huge', projects: 40000 }),
    ]);
    expect(out.map((f) => f.slug)).toEqual(['huge', 'tiny']);
  });

  it('omits anything with no measured population rather than sorting it as zero', () => {
    const out = bySize([fig({ slug: 'known' }), fig({ slug: 'unknown', projects: null })]);
    expect(out.map((f) => f.slug)).toEqual(['known']);
  });
});

describe('staleness is visible', () => {
  it('reports the oldest measurement in the set', () => {
    expect(oldestMeasurement([
      fig({ measuredAt: '2026-08-28' }),
      fig({ measuredAt: '2025-01-04' }),
    ])).toBe('2025-01-04');
  });

  it('returns nothing rather than a date when nothing was measured', () => {
    expect(oldestMeasurement([fig({ measuredAt: null })])).toBeNull();
    expect(oldestMeasurement([])).toBeNull();
  });
});

describe('the lookup', () => {
  it('asks for nothing when there is nothing to ask about', async () => {
    let called = false;
    const q = async () => { called = true; return []; };
    expect((await publicFigures([], q as never)).size).toBe(0);
    expect(called).toBe(false);
  });

  it('keys by slug and coerces the driver\'s numerics', async () => {
    // The HTTP driver returns integers as strings often enough that a figure
    // arriving as "41234" and being rendered as "41234" is a real risk.
    const q = async () => [{
      slug: 'rust', name: 'Rust', projects: '41234', stars: null,
      measured_at: '2026-08-28', repo_url: null, source: 'github',
    }];
    const got = await publicFigures(['rust'], q as never);
    expect(got.get('rust')?.projects).toBe(41234);
    expect(got.get('rust')?.stars).toBeNull();
  });

  it('omits a technology that was never measured, so callers cannot read a zero', async () => {
    const q = async () => [];
    const got = await publicFigures(['never-asked'], q as never);
    expect(got.has('never-asked')).toBe(false);
  });
});

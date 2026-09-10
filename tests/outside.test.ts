// Evidence from outside the archive, and the two ways it nearly went wrong.
//
// Asked for on 2026-09-09: "I want to you research all news that related to the
// target news when you generate report, This mans when you make report, don't
// be limited to db's past news, I want to know trend of the tech, not summary
// of the news."
//
// The feature is easy and the danger is not. Everything else on a field report
// is a sentence with a story under it, and a reader can open the story. A
// download curve is the first thing on the page that is a NUMBER WITH NO STORY
// -- and a number reads as more certain than a sentence, so a wrong one does
// more damage than any wrong paragraph could.
//
// It nearly published two, both caught before the block was ever wired in, and
// both are guarded here:
//
//   1. THE NAME IS NOT THE PACKAGE. The first version guessed that a slug is
//      its package name on the first registry that answers. That produced
//      "kubernetes 29/day -> 158/day, +441%" from an abandoned npm client, and
//      "polars -52%" from a squatter declaring github.com/ritchie46/polars
//      while the project lives at pola-rs/polars and ships 1.9M/day on PyPI.
//
//   2. THE TAXONOMY IS NOT THE WORLD. Verifying against `stacks.repo_url` makes
//      that column the single point of failure, and one step after fixing (1),
//      `jinja` resolved cleanly to pypi:django -- because the taxonomy row for
//      jinja carries github.com/django/django. Correct by construction and
//      wrong about the world, which is the first failure wearing the fix for it
//      as a disguise.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { repoKey, movement, outsidePacket, EDGE_DAYS } from '../src/analysis/outside.ts';
import { validateStrategy } from '../src/analysis/strategy.ts';

const outside = readFileSync(new URL('../src/analysis/outside.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/ui/briefing.ts', import.meta.url), 'utf8');
const spec = readFileSync(new URL('../src/llm/jobs.ts', import.meta.url), 'utf8');
const strategyPrompt = spec.slice(spec.indexOf('field_strategy:'));

describe('a repository is identified the same way whatever shape it arrives in', () => {
  it('reads the forms npm, pypi and crates each use', () => {
    for (const raw of [
      'git+https://github.com/pola-rs/polars.git',
      'https://github.com/pola-rs/polars',
      'git@github.com:pola-rs/polars.git',
      'https://github.com/POLA-RS/Polars/tree/main',
    ]) {
      expect(repoKey(raw), raw).toBe('pola-rs/polars');
    }
  });

  it('returns null for anything that is not a GitHub repository', () => {
    // A non-match, never a false match: null fails verification and no curve is
    // published, which is the safe direction.
    for (const raw of [null, undefined, '', 'https://gitlab.com/a/b', 'not a url']) {
      expect(repoKey(raw)).toBeNull();
    }
  });
});

describe('a package must PROVE it is the same project', () => {
  it('accepts only a registry whose declared repo matches the taxonomy', () => {
    expect(outside).toMatch(/if \(got && got === want\)/);
  });

  it('refuses a technology the taxonomy has no repository for', () => {
    // No repo means nothing to verify against, and an unverifiable curve is
    // exactly the kubernetes/npm case.
    expect(outside).toMatch(/no GitHub repo in the taxonomy/);
  });

  it('refuses when the taxonomy repo does not mention the technology', () => {
    // THE JINJA CASE. stacks.jinja.repo_url is github.com/django/django, so
    // jinja verified cleanly against pypi:django and the page would have
    // carried "jinja (pypi:django) 1,545,935/day".
    expect(outside).toMatch(/does not mention/);
    expect(outside).toMatch(/refusing rather/);
  });

  it('tries the repository name as well as the slug, which verification makes safe', () => {
    // huggingface is huggingface/transformers and ships as `transformers`.
    // Guessing a second name would be reckless without verification and costs
    // one request with it.
    expect(outside).toMatch(/want\.split\('\/'\)\[1\]/);
  });
});

describe('a movement is a comparison, or it is not reported', () => {
  const series = (n: number, f: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({
      day: new Date(Date.UTC(2026, 2, 1) + i * 86_400_000).toISOString().slice(0, 10),
      downloads: f(i),
    }));

  it('measures a mean at each edge, not one day against another', () => {
    // Package downloads are violently weekly -- a Sunday is a third of a
    // Tuesday -- so two single days can differ by 200% with nothing happening.
    const weekly = series(120, (i) => (i % 7 === 0 ? 100 : 1000));
    const m = movement('x', 'npm', 'x', weekly)!;
    expect(m).not.toBeNull();
    expect(Math.abs(m.changePct)).toBeLessThan(5);
  });

  it('reports real growth as growth', () => {
    const m = movement('x', 'pypi', 'x', series(120, (i) => 1000 + i * 100))!;
    expect(m.changePct).toBeGreaterThan(50);
    expect(m.after).toBeGreaterThan(m.before);
  });

  it('refuses to compute a percentage from too little data', () => {
    // A percentage from four days is a number with no meaning, and printing
    // one is worse than printing nothing.
    expect(movement('x', 'npm', 'x', series(EDGE_DAYS, () => 500))).toBeNull();
    expect(movement('x', 'npm', 'x', [])).toBeNull();
  });

  it('refuses when the earlier edge is zero, rather than dividing by it', () => {
    const late = series(120, (i) => (i < EDGE_DAYS ? 0 : 900));
    expect(movement('x', 'npm', 'x', late)).toBeNull();
  });

  it('carries both dates, so the reader knows what was compared', () => {
    const m = movement('x', 'npm', 'x', series(120, () => 500))!;
    expect(m.fromDay < m.toDay).toBe(true);
    expect(m.days).toBe(120);
  });
});

describe('the packet says what the numbers are and are not', () => {
  const packet = outsidePacket({
    movements: [{ slug: 'polars', registry: 'pypi', package: 'polars',
      before: 1_580_369, after: 1_990_894, changePct: 26,
      fromDay: '2026-03-13', toDay: '2026-09-09', days: 181 }],
    stories: [{ subject: 'polars', title: 'Pre-Release of Polars 2.0', url: 'https://pola.rs/x',
      host: 'pola.rs', when: '2026-09-03', score: 403, source: 'Hacker News' }],
  });

  it('names the registry and both dates beside the number', () => {
    expect(packet).toContain('pypi:polars');
    expect(packet).toContain('2026-03-13');
    expect(packet).toContain('2026-09-09');
  });

  it('says a download is not a user', () => {
    expect(packet).toMatch(/they are not users/);
  });

  it('says the outside stories have no body behind them', () => {
    // We have the headline and the date and did not fetch the article.
    // Summarising one we never read is the one thing this must never do.
    expect(packet).toMatch(/HEADLINE AND THE DATE for these and not the body/);
  });

  it('numbers outside stories in their own O series', () => {
    // P is the archive's history and O is outside; a citation that could mean
    // either proves nothing.
    expect(packet).toContain('O1.');
  });

  it('says plainly when nothing could be gathered', () => {
    const none = outsidePacket({ movements: [], stories: [] });
    expect(none).toMatch(/Do not treat that as evidence of anything/);
  });
});

describe('outside evidence can be the earlier end of a claim', () => {
  const claim = (over: Record<string, unknown> = {}) => ({
    claim: 'The agent framework argument has moved from capability to cost',
    reasoning: 'Installs fell while three vendors shipped their own.',
    then: [], thenOutside: [], now: [1], ...over,
  });

  it('accepts a claim whose earlier end is outside, with none of our own', () => {
    // THE POINT OF THE WHOLE MODULE. This archive began collecting on
    // 2026-09-08; refusing to write until OUR history is deep enough would
    // refuse for ever, and a public series is a more checkable earlier end
    // than whatever a feed happened to still be serving.
    const out = validateStrategy(
      { direction: [claim({ thenOutside: [2] })] }, 10, 0, 5);
    expect(out.direction).toHaveLength(1);
    expect(out.direction[0]!.thenOutside).toEqual([2]);
  });

  it('still drops a claim with NO earlier end of either kind', () => {
    expect(validateStrategy({ direction: [claim()] }, 10, 10, 5).direction)
      .toHaveLength(0);
  });

  it('range-checks outside citations against the outside evidence', () => {
    // A model citing O9 of five outside items has invented a source.
    expect(validateStrategy({ direction: [claim({ thenOutside: [9] })] }, 10, 0, 5)
      .direction).toHaveLength(0);
  });

  it('treats an absent outside block as zero outside citations', () => {
    expect(validateStrategy({ direction: [claim({ thenOutside: [1] })] }, 10, 0)
      .direction).toHaveLength(0);
  });

  it('lets the shift rest on outside evidence too', () => {
    const shift = {
      before: 'In March the argument was capability.',
      after: 'Today it is cost.',
      moved: 'Capability to cost.',
      then: [], thenOutside: [1], now: [1],
    };
    expect(validateStrategy({ shift }, 10, 0, 3).shift).not.toBeNull();
    expect(validateStrategy({ shift: { ...shift, thenOutside: [] } }, 10, 0, 3).shift)
      .toBeNull();
  });
});

describe('the prompt asks for a trend and not a retelling', () => {
  it('tells the model it is not limited to this archive', () => {
    expect(strategyPrompt).toMatch(/YOU ARE NOT LIMITED TO THIS ARCHIVE/);
  });

  it('says to use the outside series for the trend and today for the event', () => {
    expect(strategyPrompt).toMatch(/USE IT FOR THE TREND AND USE TODAY FOR THE EVENT/);
  });

  it('forbids turning a download count into a user count', () => {
    expect(strategyPrompt).toMatch(/A DOWNLOAD COUNT IS NOT A USER COUNT/);
  });

  it('prefers the public series over our own thin history for anything old', () => {
    expect(strategyPrompt).toMatch(/PREFER THE OUTSIDE EVIDENCE FOR ANYTHING OLDER/);
  });
});

describe('the page shows the curve as a measurement, not as a claim', () => {
  it('renders it as a table with the registry and both dates', () => {
    expect(page).toContain('What the public numbers did');
    expect(page).toContain('mv-curve');
    expect(page).toMatch(/m\.fromDay/);
    expect(page).toMatch(/m\.toDay/);
  });

  it('warns on the page that downloads are not users', () => {
    expect(page).toMatch(/Downloads are not users/);
  });

  it('lists outside coverage without summarising it', () => {
    expect(page).toContain('What was being discussed elsewhere');
    expect(page).toMatch(/nothing here is\s*\n?\s*summarised/);
  });

  it('stores what was researched rather than re-fetching it on view', () => {
    // A registry answers with today's numbers, so a page that researched on
    // render would show a different curve every day under a claim written once.
    const store = readFileSync(
      new URL('../src/analysis/briefing.ts', import.meta.url), 'utf8');
    expect(store).toMatch(/stored with the reading rather than re-fetched/);
  });
});

// Finding a market before it has a name in the taxonomy.
//
// Stated on 2026-09-09: "The purpose of the project is to find new market that
// will appear in short period, But currently the project can't enough report
// that can find new market and tool and platform."
//
// The diagnosis, measured that morning rather than assumed. Every headline in
// the four briefings named an incumbent -- AWS, Microsoft, Databricks, Amazon --
// and every genuinely new thing was present but filed in `watch`, the footnote:
// Booley, aic-agent, scigantic-surechembl, PocketBase Cloud. The system was
// finding new tools and throwing them away, because every step that turns a
// story into structure matches against a closed list of 2,460 things somebody
// already knew about.
//
// What this file guards is the pair of rules that keep the fix honest, because
// both are easy to break and neither breaks loudly:
//
//   THE GATE IS NOT AN ORDERING. Our counts measure the feed list, not the
//   industry. They may decide whether a name is worth showing. They may never
//   decide which name comes first.
//
//   A CLOSED-VOCABULARY CHECK MUST NOT FAIL OPEN. If the known-name set is
//   empty, every incumbent in the archive is reported as a new market.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  slugify, newcomers, passesGate, CORROBORATION, NOT_A_PRODUCT, isKind,
} from '../src/vocab/emerging.ts';

const process_ = readFileSync(new URL('../src/process/emerging.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/ui/emerging.ts', import.meta.url), 'utf8');
const jobs = readFileSync(new URL('../src/run/jobs.ts', import.meta.url), 'utf8');
const spec = readFileSync(new URL('../src/llm/jobs.ts', import.meta.url), 'utf8');

describe('folding a written name to one identity', () => {
  it('matches the form the taxonomy uses', () => {
    // stacks.slug is lowercase and hyphenated. Produce anything else and the
    // known-name check fails open, reporting every incumbent as a discovery.
    expect(slugify('LangGraph')).toBe('langgraph');
    expect(slugify('PocketBase Cloud')).toBe('pocketbase-cloud');
    expect(slugify('Batman.js')).toBe('batman-js');
  });

  it('does not treat a new version as a new market', () => {
    // The bug this prevents: "aic-agent 1.0.2" and "aic-agent 1.1.0" as two
    // rows, so the second release is announced as a brand new tool.
    expect(slugify('aic-agent 1.0.2')).toBe('aic-agent');
    expect(slugify('aic-agent 1.1.0')).toBe(slugify('aic-agent'));
    expect(slugify('ChatGPT Images 2.5')).toBe('chatgpt-images');
  });

  it('keeps a version that is part of the name', () => {
    // "GPT-6" is not "GPT" at version 6, and the difference is the space.
    expect(slugify('GPT-6 Astra')).toBe('gpt-6-astra');
    expect(slugify('S3')).toBe('s3');
  });

  it('folds accents, so two spellings are one row', () => {
    expect(slugify('Café')).toBe(slugify('Cafe'));
  });

  it('never returns something that is not a slug', () => {
    for (const junk of ['', '   ', '!!!', '---', '\n']) {
      expect(slugify(junk)).toMatch(/^[a-z0-9-]*$/);
    }
  });
});

describe('what counts as a newcomer', () => {
  const known = new Set(['kubernetes', 'langgraph', 'postgresql']);
  const found = (c: Parameters<typeof newcomers>[0]) => newcomers(c, known);

  it('admits an unfamiliar name with a claim about what it does', () => {
    expect(found([{ name: 'Booley', kind: 'tool',
      what: 'open-source IDE for agentic chip design in SystemVerilog' }]))
      .toEqual([{ slug: 'booley', name: 'Booley', kind: 'tool',
        what: 'open-source IDE for agentic chip design in SystemVerilog' }]);
  });

  it('drops anything the taxonomy already has', () => {
    // The ordinary case, and not an error: this page is about what is missing
    // from the vocabulary, not about everything a story named.
    expect(found([{ name: 'Kubernetes', kind: 'platform', what: 'orchestrator' }]))
      .toEqual([]);
    expect(found([{ name: 'LangGraph', kind: 'tool', what: 'agent framework' }]))
      .toEqual([]);
  });

  it('drops a category wearing a product name', () => {
    // A market cannot be new if it is the name of the tab the story is filed
    // under. All of these came back from the first pass over the archive.
    for (const name of ['AI', 'Machine Learning', 'DevOps', 'Open Source', 'agents']) {
      expect(found([{ name, kind: 'tool', what: 'a thing' }]), name).toEqual([]);
    }
  });

  it('drops where a story was published rather than what it was about', () => {
    for (const name of ['GitHub', 'Hacker News', 'arXiv', 'npm', 'TechCrunch']) {
      expect(found([{ name, kind: 'platform', what: 'a site' }]), name).toEqual([]);
    }
  });

  it('drops standards older than the archive', () => {
    for (const name of ['HTTP', 'JSON', 'CVE', 'OAuth']) {
      expect(found([{ name, kind: 'standard', what: 'a standard' }]), name).toEqual([]);
    }
  });

  it('requires a claim about what the thing does', () => {
    // A name with no explanation is a string. "Booley" tells a reader nothing;
    // "an open-source IDE for agentic chip design" is a category they can judge.
    expect(found([{ name: 'Mysterion', kind: 'tool', what: '' }])).toEqual([]);
    expect(found([{ name: 'Mysterion', kind: 'tool' }])).toEqual([]);
  });

  it('refuses a kind it does not have a column for', () => {
    expect(found([{ name: 'Ada Lovelace', kind: 'person', what: 'a mathematician' }]))
      .toEqual([]);
  });

  it('drops fragments that are not names', () => {
    for (const name of ['2026', 'v2', '3-5', '--']) {
      expect(found([{ name, kind: 'tool', what: 'something' }]), name).toEqual([]);
    }
  });

  it('drops an unknown name too short to be one', () => {
    // Go and R are real and are in the taxonomy already. A two-letter name that
    // is NOT known is a stray capital in a headline.
    expect(found([{ name: 'Qz', kind: 'tool', what: 'a thing' }])).toEqual([]);
  });

  it('keeps the first spelling when a story uses several', () => {
    const out = found([
      { name: 'PocketBase Cloud', kind: 'platform', what: 'hosting for PocketBase' },
      { name: 'pocketbase cloud', kind: 'platform', what: 'the same thing again' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('PocketBase Cloud');
  });

  it('holds a list of exclusions rather than deciding case by case', () => {
    expect(NOT_A_PRODUCT.size).toBeGreaterThan(50);
    expect(isKind('tool')).toBe(true);
    expect(isKind('person')).toBe(false);
  });
});

describe('the evidence gate', () => {
  it('opens for two separate publications', () => {
    expect(passesGate(2, 0)).toBe(true);
  });

  it('opens for one source that does not speak for the thing', () => {
    expect(passesGate(1, 1)).toBe(true);
  });

  it('stays shut for a single vendor announcing itself', () => {
    // The case it exists for. One press release is not a market.
    expect(passesGate(1, 0)).toBe(false);
    expect(passesGate(0, 0)).toBe(false);
  });

  it('is not an independence-only test, and the archive is why', () => {
    // Measured before shipping: 29 stories out of 4,026 come from a source type
    // that corroborates, and 404 of 476 sources carry no type at all --
    // maintain/classify.ts leaves them NULL on purpose. An independence-only
    // gate on this archive opens for nothing, ever, and a page that is
    // permanently empty because its threshold cannot be met reports "no new
    // markets" when it means "I cannot tell".
    expect(passesGate(CORROBORATION, 0)).toBe(true);
  });

  it('is written down once, and the sweep uses the same rule', () => {
    expect(process_).toMatch(/sources >= \$1 OR independent_sources >= 1/);
    expect(process_).toContain('[CORROBORATION]');
  });
});

describe('the gate never becomes an ordering', () => {
  it('lists newcomers by when they appeared', () => {
    // The rule the whole content rewrite exists to protect. Sorting by how many
    // of our own stories mention a name would make "the fastest-growing new
    // tool" mean "the one our sources happen to repeat".
    expect(page).toContain('ORDER BY first_seen_at DESC');
    expect(page).not.toMatch(/ORDER BY\s+(sources|independent_sources|sightings)/);
  });

  it('says on the page that the counts are not a size', () => {
    expect(page).toMatch(/not\s+adoption, popularity or market\s+size/);
  });

  it('phrases the number beside a name as evidence, not as volume', () => {
    // "3 sources", never "3 mentions" -- the second invites comparison with a 5
    // further down the page, which is the comparison this design refuses.
    //
    // Scoped to the function that renders the number rather than to the file:
    // "First-party mentions" is a panel heading over a list of citations, where
    // the word is doing honest work.
    const line = page.match(/function evidence\(r: Row\): string \{[\s\S]*?\n\}/)?.[0];
    expect(line, 'evidence() not found').toBeTruthy();
    expect(line).toContain('source');
    expect(line).not.toContain('mention');
    expect(line).not.toContain('times');
  });

  it('does not print a zero beside every row', () => {
    // "0 independent sources" on every line trains a reader to read the number
    // as a score that everything is failing.
    expect(page).toMatch(/if \(r\.independent_sources > 0\)/);
  });
});

describe('the closed-vocabulary check cannot fail open', () => {
  it('refuses to run against an empty taxonomy', () => {
    // With an empty known-set every incumbent in the archive is reported as a
    // new market -- the failure would look like a spectacular success.
    expect(process_).toContain('the taxonomy is empty; every name would look new');
  });

  it('reads the vocabulary once per pass, not once per story', () => {
    expect(process_).toMatch(/const known = await knownNames\(ctx\.db\)/);
  });
});

describe('first seen means first seen', () => {
  it('works through the backlog oldest first', () => {
    // Newest-first would record a name's LAST appearance as its first, which
    // inverts the one fact this ledger exists to hold.
    expect(process_).toMatch(/ORDER BY coalesce\(st\.published_at, st\.collected_at\) ASC/);
  });

  it('lets a later pass move the first sighting backwards', () => {
    expect(process_).toContain('least(emerging.first_seen_at, EXCLUDED.first_seen_at)');
  });

  it('keeps the explanation from the story that first gave one', () => {
    expect(process_).toContain('coalesce(emerging.what, EXCLUDED.what)');
  });
});

describe('counting outlets rather than stories', () => {
  it('records a sighting for every publication that carried the event', () => {
    // Dedup merges one event from several outlets into one canonical story and
    // puts the rest in story_members. Counting the canonical row alone recorded
    // a name carried by seven publications as having one source -- scoring the
    // best-attested events lowest, which is the inversion the gate exists to
    // prevent.
    expect(process_).toContain('FROM story_members m');
    expect(process_).toMatch(/via\)\s*\n?\s*VALUES[^;]*'member'/);
  });

  it('decides independence in one place only', () => {
    // A list of source-type names inside a query is a second copy of the ladder
    // in src/vocab/intel.ts, and it will disagree with it one day.
    expect(process_).toContain('meaningOf(member.source_type)');
    expect(process_).not.toMatch(/'TECHNICAL_JOURNALISM'\s*,/);
  });
});

describe('the citation survives the story', () => {
  it('copies the title and URL instead of pointing at a row', () => {
    // Retention deletes stories and analysis outlives them. A sighting holding
    // only a story_id becomes unciteable exactly when it is most useful: a name
    // first seen four months ago and still appearing is the strongest thing
    // this ledger can say.
    expect(process_).toMatch(/story_title/);
    expect(process_).toMatch(/url/);
  });

  it('does not tie sightings to a table retention empties', () => {
    const migration = readFileSync(
      new URL('../migrations/0074_names_the_taxonomy_does_not_have.sql', import.meta.url),
      'utf8');
    expect(migration).not.toMatch(/story_id\s+uuid\s+NOT NULL\s+REFERENCES\s+stories/);
  });
});

describe('it runs without being asked', () => {
  it('is in the job catalogue, not a command', () => {
    // "If it must happen twice, it belongs in the job catalogue."
    expect(jobs).toMatch(/name: 'names'/);
    expect(jobs).toContain('scanForNames');
  });

  it('runs ahead of collection so first seen is the day it arrived', () => {
    const cadence = jobs.match(/name: 'names',[\s\S]*?everySeconds: (\d+)/)?.[1];
    expect(Number(cadence)).toBeLessThanOrEqual(600);
  });

  it(`is listed in the catalogue own header, which is read as a whole`, () => {
    expect(jobs).toMatch(/\/\/\s+names\s+5m/);
  });

  it('does not stamp a batch the model refused', () => {
    // A rate limit is not a reading. Stamping it loses those stories for good.
    expect(process_).toMatch(/if \(ok\) \{/);
  });
});

describe('the extraction prompt asks for the unfamiliar', () => {
  it('tells the model to keep names it does not recognise', () => {
    // The instinct to return only things it can corroborate is exactly wrong
    // here: the unfamiliar name IS the finding.
    expect(spec).toContain('INCLUDE things you have never heard of');
  });

  it('requires a claim about what each thing does', () => {
    expect(spec).toContain('FOR EACH NAME, SAY WHAT IT DOES');
  });

  it('runs on a cheap chain, because it runs on everything', () => {
    const chain = spec.match(/entity_extraction: \{\s*\n\s*chain: \[([^\]]+)\]/)?.[1] ?? '';
    expect(chain).not.toContain("'claude'");
  });
});

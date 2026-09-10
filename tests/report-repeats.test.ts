// Two ways one report said the same thing twice, and one way it said nothing.
//
// Asked on 2026-09-09, in three messages: "there are no change", then "I mean
// the report don't change", then "why do you repeat same sentences in report".
//
// The three turned out to be one investigation with two separate defects at the
// end of it, and neither was in the writing. Not one prose sentence was
// repeated across the whole day's report -- 199 distinct sentences, zero
// duplicates. What repeated was CITATIONS, and what did not change was the
// stored artifact, because the run that should have replaced it silently
// consumed its own window.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const briefing = readFileSync(
  new URL('../src/analysis/briefing.ts', import.meta.url), 'utf8');
const outside = readFileSync(
  new URL('../src/analysis/outside.ts', import.meta.url), 'utf8');
const strategy = readFileSync(
  new URL('../src/analysis/strategy.ts', import.meta.url), 'utf8');

describe('a report that wrote nothing has not read anything', () => {
  // THE DEFECT. `covered_to` is the read cursor: `lastCoverage` takes
  // max(covered_to) and the next run starts from it. `saveArchiveReport` wrote
  // it unconditionally, so a run that briefed zero fields still claimed to have
  // read its window.
  //
  // Measured on 2026-09-09. The job fired at 20:53:48. Every provider was
  // inside a cooldown -- cerebras and both Gemini tiers until 20:54:4x, groq
  // until 21:52, and claude has no key -- so all fourteen fields failed in 9.7
  // seconds and nothing was written. The row still recorded coverage to
  // 20:53:48, which meant the 291 summarised, tagged stories collected since
  // 07:00 would never be read by ANY future report. The job logged success.

  it('claims coverage only when at least one field was briefed', () => {
    expect(briefing).toMatch(/const wrote = report\.fields\.length > 0;/);
    expect(briefing).toMatch(/wrote \? report\.window\.to : null/);
  });

  it('still writes the day row, so the failure is on the record', () => {
    // A day the report could not be produced is a fact worth keeping. A null
    // covered_to simply leaves the window open, because `lastCoverage` already
    // filters on `covered_to IS NOT NULL`.
    expect(briefing).toMatch(/covered_to IS NOT NULL/);
    expect(briefing).toMatch(/leaves the window open for the next attempt/);
  });

  it('admits the partial case is still open', () => {
    // If `ai` briefs and `cloud` does not, `cloud` loses its stories. Fixing
    // that properly needs a per-field cursor. Recording the limit beats
    // implying it was handled.
    expect(briefing).toMatch(/A PARTIAL report does still claim the whole window/);
    expect(briefing).toMatch(/per-field cursor/);
  });
});

describe('two fields must not paste the same outside stories', () => {
  // THE SECOND DEFECT, and the one the question was actually about. Measured on
  // the same report: cloud and data carried 26 of 32 IDENTICAL outside stories,
  // and one headline -- "Google Chrome silently installs a 4 GB AI model" --
  // appeared in all four fields.
  //
  // The cause is that outside search subjects were the head of the frequency
  // list, and that head is broad tags in every field. cloud searched
  // `aws, ai, google, cloud, gcp, cve`; data searched
  // `data, google, database, cms, ai, cve`. Three shared terms, three shared
  // searches, one shared list.

  it('drops the field’s own category tag from its search terms', () => {
    // Searching Hacker News for `cloud` returns what Hacker News discussed,
    // which is the same answer whichever field asked.
    expect(outside).toMatch(/A CATEGORY IS NOT A SEARCH TERM EITHER/);
    expect(outside).toMatch(/const generic = new Set<string>/);
    expect(outside).toMatch(/field \? \[field\] : \[\]/);
  });

  it('reuses NOT_A_PRODUCT rather than listing generic words again', () => {
    // Same argument as the emerging ledger: two opinions about which words are
    // generic would drift, and the unattended one would be the one that drifted.
    expect(outside).toMatch(/import \{ NOT_A_PRODUCT \} from '\.\.\/vocab\/emerging\.ts'/);
  });

  it('gives a story to the FIRST field that wants it and no other', () => {
    expect(outside).toMatch(/FIRST FIELD TO WANT A STORY KEEPS IT/);
    expect(outside).toMatch(/if \(seen\?\.has\(s\.url\)\) continue;/);
  });

  it('keeps a story that has no URL rather than dropping it', () => {
    // It cannot be deduplicated, and discarding evidence to guard against a
    // repeat that cannot be detected is the wrong trade.
    expect(outside).toMatch(/cannot be deduplicated and is kept/);
  });

  it('shares ONE set across the whole run, not one per field', () => {
    // A per-field set would be no set at all: the repetition is between fields.
    expect(briefing).toMatch(/ONE SET FOR THE WHOLE RUN/);
    expect(briefing).toMatch(/const seenOutside = new Set<string>\(\);/);
  });

  it('threads the set through every layer between the loop and the search', () => {
    expect(briefing).toMatch(/seenOutside: Set<string> \| null = null/);
    expect(strategy).toMatch(/seenOutside: Set<string> \| null = null/);
    expect(outside).toMatch(/seen: Set<string> \| null = null/);
  });

  it('defaults to null, so a direct caller keeps the old behaviour', () => {
    // Every existing test calls these functions without the set.
    expect(outside).toMatch(/field: string \| null = null/);
  });
});

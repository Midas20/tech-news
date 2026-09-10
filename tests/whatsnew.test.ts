// The report that is not about a field.
//
// Asked for on 2026-09-09: "you make report on only fields that user selected,
// but the most important report is about new appearing fields and market, tool,
// platform." Then, minutes later: "You make all field's report even user didn't
// select favourite fields."
//
// The two are the same objection from both ends. `briefArchive` loops over
// FIELDS, a taxonomy written in advance, so it can only report on categories
// somebody already thought of -- and it did so for all fourteen of them whether
// or not anybody had chosen any, at two model calls each.
//
// A genuinely new thing arrives WITHOUT a field. It is one launch from one
// vendor, tagged with whichever existing label its words happened to match, and
// no field report can say "this did not exist last month".

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractNames, type NewThing } from '../src/analysis/whatsnew.ts';

const src = readFileSync(new URL('../src/analysis/whatsnew.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/ui/whatsnew.ts', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/analysis/briefing.ts', import.meta.url), 'utf8');

const story = (title: string, source = 'S', id = title): NewThing => ({
  id, title, url: 'https://e.test/x', source, independent: true,
  when: '2026-09-09', kind: 'launch', summary: null, subjects: [], importance: 1,
});

describe('names are read out of the headline, not out of our tagging', () => {
  it('finds a product named in the forms a launch headline uses', () => {
    const found = extractNames([
      story('Show HN: Booley – open-source IDE for agentic chip design'),
      story('Cymphony launches with $30M to track what AI agents can reach'),
      story('Harvey raises $550M more to develop AI tools for legal teams'),
      story('Introducing Consort: Test-driven development on a branching database'),
      story('AI-native CRM startup Lightfield raises $47M'),
    ], new Set());
    const slugs = found.map((f) => f.slug);
    for (const want of ['booley', 'cymphony', 'harvey', 'consort', 'lightfield']) {
      expect(slugs, want).toContain(want);
    }
  });

  it('takes the company being BOUGHT out of an acquisition', () => {
    // "Shopify acquires Tailwind" -- the newcomer to this archive is the thing
    // acquired, and the acquirer is by construction already known.
    const found = extractNames([story('Shopify acquires Tailwind')], new Set());
    expect(found.map((f) => f.slug)).toContain('tailwind');
  });

  it('REFUSES a headline that describes rather than names', () => {
    // The bug this caught: "Show HN: An open-source SAS interpreter" and
    // "Show HN: A free, open-source agent orchestrator" produced `an-open` and
    // `a-free`, which would have been the first thing a reader saw under "new
    // names". The author gave no name; inventing one from the first two words
    // is worse than reporting nothing.
    const found = extractNames([
      story('Show HN: An open-source SAS interpreter, written by agents'),
      story('Show HN: A free, open-source agent orchestrator for knowledge work'),
    ], new Set());
    expect(found).toEqual([]);
  });

  it('REFUSES a lowercase feature description after the keyword', () => {
    // Found generating the first year report. `/i` on the pattern made `[A-Z]`
    // match lowercase, which destroyed the only signal separating a product
    // name from a sentence. Six of nineteen names were feature descriptions or
    // phrases cut mid-clause.
    const slugs = extractNames([
      story('Introducing context-aware vulnerability discovery and remediation'),
      story('Announcing support for ClickStack in the Terraform provider'),
      story('Introducing computer use in Gemini 3.5 Flash'),
      story('Introducing agentic video understanding with Gemini'),
    ], new Set()).map((f) => f.slug);
    expect(slugs).toEqual([]);
  });

  it('stops a name at a lowercase connective rather than swallowing it', () => {
    // "Introducing GPT-6 Astra for developers" produced `gpt-6-astra-for`.
    const found = extractNames(
      [story('Introducing GPT-6 Astra for developers')], new Set());
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe('GPT-6 Astra');
  });

  it('still matches the keyword whatever case it is written in', () => {
    // The `i` flag was there for a reason; removing it must not cost the
    // keyword match that justified it.
    for (const t of ['Introducing Consort: a database', 'introducing Consort: a database',
      'Show HN: Booley – an IDE', 'show hn: Booley – an IDE']) {
      expect(extractNames([story(t)], new Set()).length, t).toBe(1);
    }
  });

  it('says nothing about a name the archive already knows', () => {
    expect(extractNames([story('Cymphony launches with $30M')],
      new Set(['cymphony']))).toEqual([]);
  });

  it('refuses a category word even when a headline introduces it', () => {
    // NOT_A_PRODUCT is shared with the emerging ledger rather than duplicated:
    // two opinions about what a product name is would drift, and the one
    // deciding unattended would be the one that drifted. It holds the words a
    // reader already has a tab for -- `agents`, `platform`, `database` -- and
    // NOT real products like Kubernetes, which the taxonomy excludes instead.
    const slugs = extractNames([
      story('Introducing Agents'),
      story('Announcing Analytics'),
    ], new Set()).map((f) => f.slug);
    expect(slugs).not.toContain('agents');
    expect(slugs).not.toContain('analytics');
  });

  it('counts publishers, not stories, and puts the corroborated first', () => {
    const found = extractNames([
      story('Cymphony launches with $30M', 'SiliconANGLE', 'a'),
      story('Cymphony launches with new funding', 'TechCrunch', 'b'),
      story('Booley launches with a chip IDE', 'SiliconANGLE', 'c'),
    ], new Set());
    expect(found[0]!.slug).toBe('cymphony');
    expect(found[0]!.sources).toBe(2);
    expect(found[0]!.stories).toHaveLength(2);
  });

  it('files one headline under one name, never two', () => {
    const found = extractNames(
      [story('Introducing Consort: Test-driven development')], new Set());
    expect(found).toHaveLength(1);
  });

  it('records that a set difference over our tagging was tried and refused', () => {
    // It returned `gmail`, `nasa`, `cooling` and `hacking` -- every one an
    // established thing whose taxonomy row says origin `seed` or `topic_index`.
    // That list reports TAGGER COVERAGE, not novelty.
    expect(src).toMatch(/THE FIRST VERSION OF THIS ASKED THE WRONG QUESTION/);
    expect(src).toMatch(/tagger coverage/i);
  });
});

describe('the lists are the pipeline’s own verdicts, with no model', () => {
  it('reads launches and market moves from the event classifier', () => {
    expect(src).toMatch(/event_kind::text = 'launch'/);
    expect(src).toMatch(/event_kind::text = 'market'/);
  });

  it('marks whether the source speaks for the subject', () => {
    // A launch announced by its own vendor is authoritative about what shipped
    // and worthless as evidence anybody wanted it.
    expect(src).toMatch(/function independentOf/);
    expect(page).toMatch(/says so itself/);
  });

  it('says on the page that no model wrote any of it', () => {
    expect(page).toMatch(/Nothing on this page was written by a model/);
  });

  it('says the strong version of the page needs one', () => {
    // The emerging ledger reads names out of prose and can find something no
    // headline named. It has been stalled since 23 June.
    expect(page).toMatch(/strong version of this page needs a model/);
  });

  it('never totals its lists into a trend', () => {
    expect(page).toMatch(/Nothing here is counted as a magnitude/);
  });

  it('admits that an absence here means nothing', () => {
    // It can only find a name somebody put in a headline in a recognised form.
    expect(page).toMatch(/an absence\s+here means nothing at all/);
  });
});

describe('the daily report asks for the fields somebody chose', () => {
  it('reads the choice from accounts rather than briefing everything', () => {
    expect(store).toMatch(/export async function reportFields/);
    expect(store).toMatch(/SELECT DISTINCT unnest\(fields\) AS slug FROM accounts/);
  });

  it('filters a saved choice against the current taxonomy', () => {
    // A field removed from FIELDS but still in somebody's saved list must not
    // make the job ask for a briefing on a slug that has no corpus.
    expect(store).toMatch(/known\.has\(s\)/);
  });

  it('falls back to everything when nobody has chosen, and says so', () => {
    // An archive that writes nothing until somebody visits Settings looks
    // broken on the day it is installed.
    expect(store).toMatch(/return \{ fields: FIELDS\.map\(\(f\) => f\.slug\), chosen: false \}/);
    expect(store).toMatch(/nobody has chosen any yet/);
  });
});

// The guards on a written report.
//
// Three failure modes, and this file is one describe block per failure:
//
//   the model writes from memory        -> validate() drops uncited themes
//   the model counts our stories        -> the prompt bans the vocabulary
//   the report quotes our own totals    -> the packet carries public figures only
//
// The first is the dangerous one. A model asked about technology trends will
// fluently supply the industry consensus from its training data, and a plausible
// paragraph about last year is indistinguishable from a finding to the reader.
// Citation is the only thing that separates them, so an uncited theme is dropped
// rather than flagged.

import { describe, it, expect } from 'vitest';
import {
  validate, composeTitle, reportDay, nextWindow, windowDays, corpusPacket, briefField, briefArchive,
  figuresPacket, fieldPacket, GENERATOR, MAX_CATCHUP_DAYS, FIRST_RUN_DAYS,
  summariseReport, type Briefing, type Theme,
} from '../src/analysis/briefing.ts';
import type { Item } from '../src/analysis/corpus.ts';
import type { PublicFigure } from '../src/analysis/public.ts';
import { JOBS } from '../src/llm/jobs.ts';

let n = 0;
function item(over: Partial<Item> = {}): Item {
  n += 1;
  return {
    id: `id-${n}`, title: `story ${n}`, summary: 'a summary of what happened',
    url: `https://example.test/${n}`, source: `Source ${n}`, sourceType: null,
    rung: 'announcement', independent: true, kind: 'launch', when: '2026-09-01',
    stacks: [], companies: [], platforms: [], importance: 5, ...over,
  };
}

const WIN = { from: '2026-08-31T07:00:00Z', to: '2026-09-01T07:00:00Z' };

function theme(over: Partial<Theme> = {}): Theme {
  return { title: 'A finding', body: 'What happened.', evidence: [1], ...over };
}

describe('a claim with no source is not a finding', () => {
  it('drops a theme citing nothing', () => {
    expect(validate([theme({ evidence: [] })], 10)).toHaveLength(0);
  });

  it('drops a theme citing a story that does not exist', () => {
    // The model returning [99] over a corpus of 10 is it inventing a source.
    expect(validate([theme({ evidence: [99] })], 10)).toHaveLength(0);
  });

  it('drops the invented citations but keeps a theme with a real one', () => {
    const [t] = validate([theme({ evidence: [2, 99, 0, -1] })], 10);
    expect(t?.evidence).toEqual([2]);
  });

  it('rejects citations outside the one-based range at both ends', () => {
    expect(validate([theme({ evidence: [0] })], 10)).toHaveLength(0);
    expect(validate([theme({ evidence: [11] })], 10)).toHaveLength(0);
    expect(validate([theme({ evidence: [10] })], 10)).toHaveLength(1);
  });

  it('drops a theme with no text, however well cited', () => {
    expect(validate([theme({ body: '   ', evidence: [1, 2, 3] })], 10)).toHaveLength(0);
    expect(validate([theme({ title: '', evidence: [1, 2, 3] })], 10)).toHaveLength(0);
  });

  it('survives a model that answers with the wrong types', () => {
    const junk = [
      { title: 'x', body: 'y', evidence: 'not an array' },
      { title: 'x', body: 'y', evidence: [1.5, '2', null] },
    ] as unknown as Theme[];
    const out = validate(junk, 10);
    expect(out).toHaveLength(1);
    expect(out[0]?.evidence).toEqual([2]);
  });
});

describe('the writer is forbidden to count', () => {
  // The prompt is written as wrapped source lines, so a phrase that matters can
  // straddle two of them. Match on the sentence, not on the formatting.
  const prompt = JOBS.field_briefing!.system.toLowerCase().replace(/\s+/g, ' ');

  it('bans the vocabulary that implies volume without a number', () => {
    // Each of these shipped in a real briefing before it was banned, or is the
    // obvious next way to say the same thing.
    for (const word of ['dominate', 'increasingly', 'most coverage', 'widespread',
      'a wave of', 'the majority of reports']) {
      expect(prompt, `"${word}" is not banned`).toContain(word);
    }
  });

  it('tells the writer why counting here is wrong, not just that it is', () => {
    expect(prompt).toContain('feed list');
    expect(prompt).toContain('incomplete archive');
  });

  it('permits only externally measured quantities', () => {
    expect(prompt).toContain('public figures');
    expect(prompt).toContain('date they were measured');
  });

  it('requires every theme to carry its story numbers', () => {
    const schema = JOBS.field_briefing!.schema as Record<string, any>;
    const theme = schema.properties.themes.items;
    expect(theme.required).toContain('evidence');
    expect(schema.required).toEqual(
      expect.arrayContaining(['headline', 'summary', 'themes', 'watch', 'gaps']));
  });

  it('was re-versioned when the rules changed, so the cache cannot serve v2', () => {
    expect(JOBS.field_briefing!.promptVersion).toBe('v3');
  });

  it('does not fail over silently to nothing', () => {
    expect(JOBS.field_briefing!.chain.length).toBeGreaterThan(1);
    expect(JOBS.field_briefing!.chain[0]).toBe('claude');
  });
});

describe('a silent field and a failed one are different claims', () => {
  const win = { from: '2026-08-31T07:00:00Z', to: '2026-09-01T07:00:00Z' };
  const corpus = (n: number) => Array.from({ length: n }, (_, i) =>
    item({ stacks: [`s-${i}`], source: `src-${i}` }));

  /** Stories for the corpus query, nothing for anything else. */
  const storiesOnly = (rows: Item[]) =>
    (async <T,>(sql: string): Promise<T[]> =>
      (sql.includes('FROM stories') ? rows : []) as T[]) as never;

  /** A context with a working database and no model key anywhere. */
  const noModel = { db: { query: async () => [] }, env: {} } as never;

  it('calls a field quiet only when there was too little to read', async () => {
    const out = await briefField(noModel, 'ai', win, storiesOnly(corpus(2)));
    expect(out.status).toBe('quiet');
    expect(out.status === 'quiet' && out.read).toBe(2);
  });

  it('never calls a field quiet when the model was the thing that failed', async () => {
    // This is the bug that shipped. 15-18 August wrote, the provider hit its
    // rate limit, and the next ten days recorded fourteen "quiet" fields each --
    // the page telling a reader the industry went silent while the archive held
    // some 1,800 readable stories from those days.
    const out = await briefField(noModel, 'ai', win, storiesOnly(corpus(40)));
    expect(out.status).toBe('unwritten');
  });

  it('says how much went unread, so the size of a gap is visible', async () => {
    const out = await briefField(noModel, 'ai', win, storiesOnly(corpus(40)));
    expect(out.status === 'unwritten' && out.read).toBeGreaterThan(0);
    expect(out.status === 'unwritten' && out.why).toBeTruthy();
  });

  it('files a field that threw as unwritten rather than losing the whole report',
    async () => {
      const exploding = (async () => { throw new Error('rate limited'); }) as never;
      const r = await briefArchive(noModel, win, new Date('2026-09-01T07:00:00Z'),
        exploding, ['ai', 'security']);
      expect(r.fields).toHaveLength(0);
      expect(r.quiet).toEqual([]);
      expect(r.unwritten.map((u) => u.field)).toEqual(['ai', 'security']);
    });

  it('keeps the two apart all the way into the stored report', async () => {
    const r = await briefArchive(noModel, win, new Date('2026-09-01T07:00:00Z'),
      storiesOnly(corpus(40)), ['ai']);
    expect(r.quiet).toEqual([]);
    expect(r.unwritten).toHaveLength(1);
  });

  it('treats a briefing that cites nothing real as unwritten, not as quiet', () => {
    // The model answered; the answer was unusable. There were stories to read,
    // so the failure belongs to the archive and not to the period.
    expect(validate([theme({ evidence: [99] })], 10)).toHaveLength(0);
  });
});

describe('the writer is told to write news, not a filing system', () => {
  const prompt = JOBS.field_briefing!.system.replace(/\s+/g, ' ');

  it('demands an actor and a verb in every title', () => {
    expect(prompt).toContain('EVERY TITLE IS A SENTENCE WITH SOMEBODY DOING SOMETHING');
  });

  it('shows what a filing label looks like, using ones it actually produced', () => {
    // v2 was accurate, cited, and unreadable as news. Its own worst titles are
    // now the examples, because an abstract rule about noun phrases did not
    // stop it and four concrete lines did.
    for (const bad of ['AI Agent Governance and Enterprise Infrastructure Updates',
      'New Cloud Hardware and Database Regions', 'Framework and Tooling Updates']) {
      expect(prompt, `${bad} should be shown as bad`).toContain(bad);
    }
  });

  it('shows what news looks like', () => {
    expect(prompt).toContain('GOOD AWS opens its Agent Registry to every account');
    expect(prompt).toContain('GOOD LangChain raises $125m');
  });

  it('bans the category-noun endings that made every title interchangeable', () => {
    for (const w of ['Updates', 'Releases', 'Enhancements', 'Roundup']) {
      expect(prompt).toContain(w);
    }
    expect(prompt).toContain('Never end a title with');
  });

  it('refuses titles that join two subjects, because those are two items', () => {
    expect(prompt).toContain('if two things happened, they are two items');
  });

  it('asks for the event in the first sentence of the body', () => {
    expect(prompt).toContain('who did what, and when, in the first sentence');
  });

  // NOT TESTED IN CODE, AND DELIBERATELY.
  //
  // The obvious guard is a validator that drops any title ending in Updates,
  // Releases, Fixes and so on. Measured against 155 real titles it flagged 12,
  // and all 12 were correct news sentences: "LanceDB releases version 0.38.0",
  // "Canonical patches OpenZFS and OpenSSL vulnerabilities in Ubuntu releases".
  // The banned words are verbs and objects as often as they are labels, so the
  // check rejects good writing to catch a fault the prompt already fixed --
  // none of those 155 titles lacked a verb. The rule belongs in the prompt and
  // the evidence belongs here, so nobody adds the validator later.
});

describe('what the writer is shown', () => {
  it('numbers the stories, because the numbers are the citation', () => {
    const packet = corpusPacket([item({ title: 'First' }), item({ title: 'Second' })]);
    expect(packet).toContain('[1] First');
    expect(packet).toContain('[2] Second');
  });

  it('says which stories speak for their own subject', () => {
    const packet = corpusPacket([
      item({ independent: false, title: 'Vendor ships thing' }),
      item({ independent: true, title: 'Someone else reports it' }),
    ]);
    expect(packet).toContain('first-party (speaks for the subject)');
    expect(packet).toContain('independent');
  });

  it('collapses whitespace so a summary cannot fake structure', () => {
    expect(corpusPacket([item({ summary: 'one\n\ntwo\tthree' })]))
      .toContain('one two three');
  });

  it('refuses all size claims when nothing public was measured', () => {
    expect(figuresPacket([])).toContain('Do not state any');
  });

  it('gives every public figure its measurement date', () => {
    const f: PublicFigure = {
      slug: 'rust', name: 'Rust', projects: 41234, stars: null,
      measuredAt: '2026-08-28', repoUrl: null, source: 'github',
    };
    const packet = figuresPacket([f]);
    expect(packet).toContain('41,234');
    expect(packet).toContain('2026-08-28');
    expect(packet).toContain('github');
  });

  it('tells the writer the corpus is a capped selection, not a survey', () => {
    const packet = fieldPacket('ai', WIN, [item(), item({ independent: false })], []);
    expect(packet).toContain('SELECTION');
    expect(packet).toContain('not everything published');
    expect(packet).toMatch(/1 are independent and 1 speak for the subject/);
  });

  it('states both ends of the period it read', () => {
    const packet = fieldPacket('ai', WIN, [item()], []);
    expect(packet).toContain('2026-08-31');
    expect(packet).toContain('2026-09-01');
  });

  it('tells the writer everything shown is new since the last briefing', () => {
    expect(fieldPacket('ai', WIN, [item()], []))
      .toContain('new since the last briefing');
  });
});

function briefing(over: Partial<Briefing> = {}): Briefing {
  return {
    field: 'ai', label: 'AI & ML', headline: 'h', summary: 's',
    themes: [theme({ evidence: [1] })], watch: [], gaps: '',
    corpus: [item({ stacks: ['langchain'] })], figures: [], ...over,
  };
}

describe('the title names the subject and the day', () => {
  it('uses the display name rather than the slug', () => {
    const t = composeTitle([briefing()], '2026-09-01',
      new Map([['langchain', 'LangChain']]));
    expect(t).toContain('LangChain');
    expect(t).not.toContain('langchain —');
  });

  it('falls back to a readable form when no name is known', () => {
    expect(composeTitle([briefing({
      corpus: [item({ stacks: ['ai-agents'] })],
    })], '2026-09-01')).toContain('Ai Agents');
  });

  it('never titles a report after the section it is in', () => {
    // Every story in the cloud briefing is tagged `cloud`, so a title built from
    // the field root says nothing at all.
    const t = composeTitle([briefing({
      field: 'cloud', corpus: [item({ stacks: ['cloud', 'aws'] })],
    })], '2026-09-01', new Map([['aws', 'AWS']]));
    expect(t).toContain('AWS');
    expect(t).not.toMatch(/\bCloud,/);
  });

  it('reports how many fields were briefed, not how many it named', () => {
    const many = Array.from({ length: 14 }, (_, i) => briefing({ field: `f${i}` }));
    expect(composeTitle(many, '2026-09-01')).toContain('14 fields briefed');
    expect(composeTitle([briefing()], '2026-09-01')).toContain('1 field briefed');
  });

  it('leads with money when the leading evidence is money', () => {
    const t = composeTitle([briefing({
      themes: [theme({ evidence: [1, 2] })],
      corpus: [item({ kind: 'market', stacks: ['a'] }), item({ kind: 'market', stacks: ['b'] })],
    })], '2026-09-01');
    expect(t.startsWith('Market moves:')).toBe(true);
  });

  it('does not cry market for a single funding round', () => {
    const t = composeTitle([briefing({
      corpus: [item({ kind: 'market', stacks: ['a'] })],
    })], '2026-09-01');
    expect(t.startsWith('Market moves:')).toBe(false);
  });

  it('carries the date in a form a person reads', () => {
    expect(composeTitle([briefing()], '2026-09-01')).toContain('1 September 2026');
  });

  it('says so plainly when there is nothing to report', () => {
    expect(composeTitle([], '2026-09-01')).toBe('Nothing to report — 1 September 2026');
  });
});

describe('a report is addressed by day', () => {
  it('accepts a calendar date', () => {
    expect(reportDay('2026-09-01')).toBe('2026-09-01');
    expect(reportDay('2024-02-29')).toBe('2024-02-29');
  });

  it('refuses anything that is not one', () => {
    // The value reaches a query as a parameter, but it also reaches a URL and a
    // heading, and "no report on 2026-13-45" is a worse answer than a 404.
    for (const bad of ['', 'latest', '2026-9-1', '2026-13-01', '2026-02-30',
      '2026-09-01T00:00:00Z', "2026-09-01'; DROP TABLE stories --", null, undefined]) {
      expect(reportDay(bad as string | null)).toBeNull();
    }
  });

  it('rejects a date that rolled over rather than silently normalising it', () => {
    // new Date('2026-02-30') is 2 March. Accepting it would put one day's report
    // at another day's address.
    expect(reportDay('2026-02-30')).toBeNull();
  });
});

describe('each report reads what the last one did not', () => {
  const at = (iso: string) => new Date(iso);

  it('starts where the previous report stopped', () => {
    const w = nextWindow(at('2026-09-02T07:00:00Z'), '2026-09-01T07:00:00Z');
    expect(w.from).toBe('2026-09-01T07:00:00.000Z');
    expect(w.to).toBe('2026-09-02T07:00:00.000Z');
  });

  it('leaves no gap and no overlap between consecutive runs', () => {
    const first = nextWindow(at('2026-09-01T07:00:00Z'), '2026-08-31T07:00:00Z');
    const second = nextWindow(at('2026-09-02T07:00:00Z'), first.to);
    expect(second.from).toBe(first.to);
  });

  it('reads a week on the very first run, so the first report is not thin', () => {
    const w = nextWindow(at('2026-09-01T07:00:00Z'), null);
    expect(windowDays(w)).toBe(FIRST_RUN_DAYS);
  });

  it('treats an unparseable stored timestamp as no previous report', () => {
    expect(windowDays(nextWindow(at('2026-09-01T07:00:00Z'), 'not a date')))
      .toBe(FIRST_RUN_DAYS);
  });

  it('does not turn an outage into a rolling window', () => {
    // Down for a month, the naive answer reads a month -- which is the rolling
    // window this version exists to remove, arriving through the back door.
    const w = nextWindow(at('2026-09-01T07:00:00Z'), '2026-08-01T07:00:00Z');
    expect(windowDays(w)).toBe(MAX_CATCHUP_DAYS);
  });

  it('measures its own length honestly', () => {
    expect(windowDays({ from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' })).toBe(1);
    expect(windowDays({ from: '2026-09-01T00:00:00Z', to: '2026-09-08T00:00:00Z' })).toBe(7);
  });

  it('never reports a zero-length window', () => {
    expect(windowDays({ from: '2026-09-01T00:00:00Z', to: '2026-09-01T00:10:00Z' })).toBe(1);
  });
});

describe('the record', () => {
  it('is versioned by what it means, not by what it says', () => {
    // v2 is the move from a rolling fourteen days to the gap since the last
    // report. Same prose, different evidence, so the rows must be tellable
    // apart.
    expect(GENERATOR).toBe('content-v2');
  });

  it('logs the reading rather than a verdict', () => {
    const line = summariseReport({ day: '2026-09-01', fields: 14, themes: 58, read: 499 });
    expect(line).toContain('14 fields briefed');
    expect(line).toContain('58 findings');
    expect(line).toContain('499 stories read');
  });

  it('says how long a run covered, so a catch-up is visible', () => {
    expect(summariseReport({ day: '2026-09-01', fields: 3, themes: 9, read: 40, days: 1 }))
      .toContain('over 1 day');
    expect(summariseReport({ day: '2026-09-01', fields: 3, themes: 9, read: 40, days: 7 }))
      .toContain('over 7 days');
  });
});

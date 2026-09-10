// What "unparseable output" was hiding.
//
// On 2026-09-10 the AI field's strategic reading failed on all five providers,
// and the report page told the operator this:
//
//   claude: no credentials; gemini-flash: budget exhausted; cerebras: 402
//   payment_required; groq: 429; gemini-flash-lite: unparseable output
//
// Four of those name a cause and a fix. The fifth names neither, and it is the
// only one that mattered -- it is the one provider that was reachable, had
// budget, and actually answered. The raw text was discarded at the point of
// failure, so there was nothing left to look at afterwards either.
//
// Probing it took three live runs to find that the answer was ~6,500 characters
// of complete, bracket-balanced JSON with a syntax error inside it, and that a
// second sample failed a different way. None of that was recoverable from the
// two words on the page.

import { describe, it, expect } from 'vitest';
import { describeUnparseable, FORMAT_ATTEMPTS, RETRY_TEMPERATURE } from '../src/llm/router.ts';

describe('an answer that is not there', () => {
  it('is not described as a parse failure', () => {
    // A provider that returns an empty body has refused, silently. Retrying the
    // same prompt asks for the same refusal, so this must not read like a
    // formatting slip.
    expect(describeUnparseable('', 0, 8000)).toBe('answered with nothing');
    expect(describeUnparseable('   \n  ', null, 8000)).toBe('answered with nothing');
  });
});

describe('an answer in prose', () => {
  it('says so, and shows the opening', () => {
    const d = describeUnparseable(
      'I am sorry, but I cannot analyse the stories you have provided.', 40, 8000);
    expect(d).toContain('answered in prose');
    expect(d).toContain('I am sorry');
  });

  it('is not confused with JSON that merely starts late', () => {
    const d = describeUnparseable('Here you go:\n{"read":"x"', 20, 8000);
    expect(d).not.toContain('prose');
    expect(d).toContain('truncated');
  });
});

describe('an answer that ran out of room', () => {
  it('is called truncated, and counts the levels left open', () => {
    const d = describeUnparseable('{"read":"x","openings":[{"what":"y"', 8000, 8000);
    expect(d).toContain('truncated');
    expect(d).toContain('3 levels left open');
  });

  it('names the ceiling when the ceiling is what it hit', () => {
    // THE DISTINCTION THAT MATTERS: this is our bug, not the model's. We asked
    // for more than we allowed room for, and the fix is a number in jobs.ts.
    expect(describeUnparseable('{"a":[1', 8000, 8000))
      .toContain('at the 8000-token ceiling');
  });

  it('does not blame the ceiling when the answer stopped well short of it', () => {
    // Same broken shape, a tenth of the budget spent. Raising maxTokens would
    // do nothing and the message must not suggest it.
    const d = describeUnparseable('{"a":[1', 800, 8000);
    expect(d).toContain('truncated');
    expect(d).not.toContain('ceiling');
  });

  it('counts a string left open as truncation', () => {
    // Cut mid-sentence: the brackets can still balance while the quote does
    // not, and JSON.parse fails on the string rather than the structure.
    expect(describeUnparseable('{"read":"the field has moved towards', 8000, 8000))
      .toContain('truncated');
  });
});

describe('an answer that is complete and still will not parse', () => {
  it('is called malformed, not truncated', () => {
    // THE ACTUAL 2026-09-10 SHAPE: balanced, ends with `}`, and rejected. A
    // trailing comma, a smart quote, an unescaped newline inside a string.
    const d = describeUnparseable('{"read":"x","limits":"y",}', 400, 8000);
    expect(d).toContain('malformed JSON');
    expect(d).not.toContain('truncated');
  });

  it('shows the tail, where the defect usually is', () => {
    const d = describeUnparseable('{"read":"x","limits":"unverified.",}', 400, 8000);
    expect(d).toContain('unverified.');
  });

  it('reports the size, so a short answer is distinguishable from a long one', () => {
    expect(describeUnparseable('{"a":1,}', 4, 8000)).toContain('8 chars');
  });
});

describe('brackets inside strings', () => {
  it('do not count as structure', () => {
    // A model quoting a headline containing a brace would otherwise look
    // permanently unbalanced, and every malformed answer would be reported as
    // truncated -- which points the operator at maxTokens, which is fine.
    const d = describeUnparseable('{"read":"the {agent} era [again]",}', 400, 8000);
    expect(d).toContain('malformed JSON');
    expect(d).not.toContain('truncated');
  });

  it('survive an escaped quote', () => {
    const d = describeUnparseable('{"read":"he said \\"yes\\" to {",}', 400, 8000);
    expect(d).toContain('malformed JSON');
  });
});

describe('the message itself', () => {
  it('stays on one line, because it is rendered into a report page', () => {
    const d = describeUnparseable('{"read":"a\nb\nc",}', 400, 8000);
    expect(d).not.toContain('\n');
  });
});

describe('the retry', () => {
  it('draws a second sample and no more', () => {
    // Two, not three. The budget is the binding constraint on this whole
    // system: on the day this was written, four of five providers were out of
    // quota by breakfast.
    expect(FORMAT_ATTEMPTS).toBe(2);
  });

  it('draws it at a temperature that makes it a different sample', () => {
    // Every provider here is called at temperature 0. Re-sending the identical
    // prompt at 0 is a request for the identical answer, which is a wasted call
    // and a wasted quota. A retry that is not a different draw is not a retry.
    expect(RETRY_TEMPERATURE).toBeGreaterThan(0);
    expect(RETRY_TEMPERATURE).toBeLessThan(1);
  });
});

// The prompt and the schema are one contract, and nothing was checking that.
//
// On 2026-09-10 every field in the daily report published a summary and no
// strategic reading. Five fields, five failures, and two of them were this:
//
//   cloud   schema: $.openings[0].what: required; $.openings[1].what: required
//   infra   schema: $.openings[0].what: required; $.openings[1].what: required
//
// `field_strategy` required `openings[].what` and its prompt never mentioned
// `what` in the openings paragraph -- it described `who` and `why` and stopped.
// The JSON skeleton above it showed the key, so a strong model inferred it from
// the shape and a weak one followed the prose and left it out. The router then
// threw away a complete, cited analysis over a key nobody had asked for by name.
//
// It reproduced on a second sample at a different temperature, which is what
// separates this from a model having a bad day: the format had not been stated,
// so no number of retries was going to produce it.
//
// THE TEST IS STRUCTURAL RATHER THAN PER-JOB on purpose. A test asserting that
// this one paragraph mentions `what` would have caught this one bug and no
// other. Every job here has the same seam, and the cost of the omission is not
// a degraded answer -- it is the whole document discarded, reported to the
// operator as one word.

import { describe, it, expect } from 'vitest';
import { JOBS } from '../src/llm/jobs.ts';
import type { JsonSchema } from '../src/llm/schema.ts';

/** Every property name the schema will reject a document for omitting. */
function requiredKeys(schema: JsonSchema, into = new Set<string>()): Set<string> {
  if (schema.type === 'object') {
    for (const k of schema.required ?? []) into.add(k);
    for (const sub of Object.values(schema.properties ?? {})) requiredKeys(sub, into);
  }
  if (schema.type === 'array' && schema.items) requiredKeys(schema.items, into);
  return into;
}

const promptOf = (spec: { system: string }) => spec.system;

describe('every required key is named in the prompt that must produce it', () => {
  for (const [name, spec] of Object.entries(JOBS)) {
    if (!spec.schema) continue;
    const keys = [...requiredKeys(spec.schema)];
    if (keys.length === 0) continue;

    it(name, () => {
      const prompt = promptOf(spec);
      // Named ANYWHERE in the prompt -- the JSON skeleton counts. This is the
      // weakest form of the check and it still catches the real failure: a key
      // the prompt never spells at all cannot be asked for.
      const missing = keys.filter((k) => !prompt.includes(k));
      expect(missing, `${name}: required but never named in its prompt`).toEqual([]);
    });
  }
});

describe('field_strategy openings, the case that cost a day of readings', () => {
  const prompt = JOBS.field_strategy!.system;

  it('describes what, who and why, not just who and why', () => {
    // The paragraph, not merely the skeleton. The skeleton already showed
    // `"openings":[{"what":...}]` on 2026-09-10 and gemini-flash-lite still
    // omitted it twice, so "the key appears somewhere" was demonstrably not
    // enough for the weakest model in the chain -- which is the one that
    // answers on a day the other four are out of quota.
    // Ends at the next key's paragraph or at a blank line: `limits` used to
    // follow it and was removed on 2026-09-13.
    const para = /openings: 2 to 4\.[\s\S]*?\n(?=[a-z]+:|\n)/.exec(prompt)?.[0] ?? '';
    expect(para, 'openings paragraph not found').not.toBe('');
    for (const key of ['what', 'who', 'why']) {
      expect(para, `openings paragraph does not describe \`${key}\``)
        .toContain(`\`${key}\``);
    }
  });

  it('was reissued under a new prompt version', () => {
    // llm_cache is keyed on (job_type, input_hash, prompt_version). A prompt
    // edited without a version bump is a prompt that keeps serving the answers
    // the old one gave.
    expect(JOBS.field_strategy!.promptVersion).not.toBe('v1');
  });
});

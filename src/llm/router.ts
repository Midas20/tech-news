// One entry point for every model call in the system.
//
//   llmCall(db, env, jobType, input)
//
// Everything the spec asks of the model layer lives here: cache by
// hash(job_type + input), a failover chain, runtime-discovered quotas, no
// blocking, and a hard refusal to send tenant-originated content to a provider
// whose free tier may train on it.

import type { Db } from '../db/client.ts';
import { jobCacheKey } from '../lib/hash.ts';
import { ALL_PROVIDERS, ProviderError, type Provider } from './providers.ts';
import { JOBS, type JobSpec } from './jobs.ts';
import { extractJson, validate } from './schema.ts';
import * as budgets from './budgets.ts';

/**
 * How many times one provider may be asked before the chain moves on.
 *
 * Two, not three: the second sample is cheap insurance against a model missing
 * the format once, and a provider that misses twice in a row on the same prompt
 * is telling us it cannot do this job. Every attempt beyond that spends tokens
 * from the budget that is already the binding constraint on this system.
 */
export const FORMAT_ATTEMPTS = 2;

/**
 * The temperature the second sample is drawn at.
 *
 * High enough to be a genuinely different draw, low enough that the answer is
 * still an analysis rather than an invention. At the default of 0 a retry is
 * a request for the same reply.
 */
export const RETRY_TEMPERATURE = 0.4;

export type LlmOutcome<T> =
  | { status: 'ok'; value: T; provider: string; cached: boolean }
  | { status: 'invalid'; errors: string[]; provider: string; raw: string }
  | { status: 'deferred'; reason: string };

export interface LlmContext {
  db: Db;
  env: Record<string, string | undefined>;
  /** Set for anything derived from tenant content rather than the public web. */
  tenantContent?: boolean;
}

export async function llmCall<T>(
  ctx: LlmContext,
  jobType: string,
  userPrompt: string,
  cacheInput: unknown = userPrompt,
): Promise<LlmOutcome<T>> {
  const spec = JOBS[jobType];
  if (!spec) throw new Error(`unknown job type: ${jobType}`);

  const key = await jobCacheKey(`${jobType}:${spec.promptVersion}`, cacheInput);

  const cached = await ctx.db.query<{ output_json: unknown; provider: string }>(
    `SELECT output_json, provider FROM llm_cache
      WHERE job_type = $1 AND input_hash = $2 AND prompt_version = $3`,
    [jobType, key, spec.promptVersion],
  );
  if (cached[0]) {
    return { status: 'ok', value: cached[0].output_json as T, provider: cached[0].provider, cached: true };
  }

  const budgetRows = await budgets.loadBudgets(ctx.db);
  const chain = resolveChain(spec, ctx);
  // EVERY PROVIDER'S REASON, not just the last one's. This was a single
  // `lastError` that each attempt overwrote, so a chain of five failures
  // reported one word.
  //
  // Measured on 2026-09-09, when the daily report wrote nothing fourteen times
  // in a row and the log said only "deferred":
  //
  //   claude              no API key
  //   gemini-flash        429, DAILY quota, not a per-minute limit
  //   gemini-flash-lite   429, same
  //   cerebras            402 payment_required -- the free tier is spent
  //   groq                429 tokens-per-day: 193,065 of 200,000 used
  //
  // Four different problems with four different fixes -- a credential, a day's
  // wait, money, and a day's wait -- reported as one. An operator reading
  // "deferred" goes and looks at the prompt.
  //
  // A NOTE ON THE MEASUREMENT ITSELF, because it nearly went in wrong: a 64-token
  // probe to groq answered in 530ms and looked healthy, which suggested our own
  // budget table was holding a stale cooldown over a working provider. It was
  // not. Groq's limit is tokens-per-DAY, so a tiny probe passes while the 54,000
  // character briefing that actually needs sending gets a 429. Probing a
  // provider with a request that does not resemble the real one measures
  // nothing.
  const tried: string[] = [];

  for (const provider of chain) {
    if (!provider.available(ctx.env)) {
      tried.push(`${provider.id}: no credentials`);
      continue;
    }
    if (!budgets.isUsable(budgetRows.get(provider.id))) {
      tried.push(`${provider.id}: budget exhausted`);
      continue;
    }

    // ONE SECOND SAMPLE, AND ONLY WHEN THE ANSWER WAS THE WRONG SHAPE.
    //
    // Measured on 2026-09-10 against the AI field's strategy call, twice, with
    // four of the five providers out of credentials or quota:
    //
    //   attempt 1   gemini-flash-lite: malformed JSON, 6,494 chars, brackets
    //               balanced, ends cleanly with `}`
    //   attempt 2   gemini-flash-lite: schema: $.openings[0].what: required;
    //                                          $.openings[1].what: required
    //
    // The same model, the same job, the same day, failing two different ways --
    // and in both cases it had written thousands of words of usable analysis
    // that were thrown away over punctuation and two missing keys. That is not a
    // provider that cannot do the job; it is a provider that misses sometimes,
    // and the chain had no way to express the difference between "missed" and
    // "unavailable". It fell through to the next provider, which was out of
    // quota, and the field published no reading at all.
    //
    // THE RETRY IS AT A HIGHER TEMPERATURE, which is the whole reason it is
    // worth spending the tokens. Every provider here is called at temperature 0
    // by default, so re-sending the identical prompt asks for the identical
    // answer and would reliably reproduce the identical defect. A different
    // sample is a different draw; the same sample is a wasted call.
    //
    // ONLY for a format failure. A 429 or a 402 is a fact about the account and
    // repeating it is rude to the provider and useless to us, so those still
    // break to the next provider immediately.
    for (let attempt = 1; attempt <= FORMAT_ATTEMPTS; attempt++) {
      const again = attempt > 1;
      const label = again ? `${provider.id} (retry)` : provider.id;
      try {
        const res = await provider.call(
          { system: spec.system, user: userPrompt, maxTokens: spec.maxTokens,
            effort: spec.effort, json: true, ...(again ? { temperature: RETRY_TEMPERATURE } : {}) },
          ctx.env,
        );
        await budgets.recordUsage(ctx.db, provider.id, res.rateLimit);

        const parsed = extractJson(res.text);
        if (parsed === null) {
          // WHY IT WOULD NOT PARSE, not merely that it would not.
          //
          // On 2026-09-10 the AI field's strategy call reported five failures:
          // four were a credential, a quota or a bill, and the fifth was
          // "gemini-flash-lite: unparseable output" -- the only provider that
          // actually answered, described in two words that name no cause. An
          // operator cannot tell truncation from prose from a refusal, and the
          // text itself is discarded here, so there is nothing left to look at.
          //
          // A truncated answer is the common case and it is worth separating,
          // because it has a different fix from every other one: the model was
          // capable and the ceiling was too low. `maxTokens` reached, with the
          // output still nested, is the signature.
          tried.push(`${label}: ${describeUnparseable(res.text, res.tokensOut, spec.maxTokens)}`);
          continue; // another sample, then the next provider
        }

        const valid = validate<T>(parsed, spec.schema);
        if (!valid.ok) {
          // Schema validation is what catches weaker models. Draw again, then
          // try the next one, rather than accepting output the rest of the
          // pipeline cannot trust.
          tried.push(`${label}: schema: ${valid.errors.slice(0, 3).join('; ')}`);
          continue;
        }

        await ctx.db.query(
          `INSERT INTO llm_cache (input_hash, job_type, output_json, provider, model,
                                  prompt_version, tokens_in, tokens_out)
           VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8)
           ON CONFLICT (job_type, input_hash, prompt_version) DO NOTHING`,
          [key, jobType, JSON.stringify(valid.value), provider.id, res.model,
           spec.promptVersion, res.tokensIn, res.tokensOut],
        );

        return { status: 'ok', value: valid.value, provider: provider.id, cached: false };
      } catch (err) {
        // NOT A FORMAT FAILURE, so a second sample cannot help: the account is
        // out of quota or out of money, and asking again is just another 429.
        if (err instanceof ProviderError && err.isRateLimit) {
          await budgets.recordRateLimit(ctx.db, provider.id, err.retryAfterSeconds);
          tried.push(`${label}: 429`);
          break;
        }
        await budgets.recordFailure(ctx.db, provider.id);
        tried.push(err instanceof Error ? `${label}: ${err.message}` : String(err));
        break;
      }
    }
  }

  // Nothing blocks. Unprocessed rows retry next cycle.
  return { status: 'deferred',
    reason: tried.length === 0 ? 'no provider available' : tried.join('; ') };
}

/**
 * Could this job reach any model right now?
 *
 * Asked BEFORE the expensive part. `analyseField` researches the open web --
 * registry lookups, download curves, story search -- and only then calls a
 * model, which is the right order for a report that is going to be written and
 * exactly the wrong one for a retry that cannot be. A top-up pass running every
 * few hours on a day when every provider is spent would otherwise re-run all of
 * that research, several times, to arrive back at "budget exhausted".
 *
 * Cheap and honest: it reads the same budget table the chain reads and answers
 * about credentials and cooldowns only. A provider that is reachable can still
 * refuse the actual prompt -- the daily token limits here are not visible until
 * a real request is sent -- so this is a floor, not a promise.
 */
export async function anyProviderUsable(
  ctx: LlmContext, jobType: string,
): Promise<boolean> {
  const spec = JOBS[jobType];
  if (!spec) throw new Error(`unknown job type: ${jobType}`);
  const budgetRows = await budgets.loadBudgets(ctx.db);
  return resolveChain(spec, ctx).some((p) =>
    p.available(ctx.env) && budgets.isUsable(budgetRows.get(p.id)));
}

/**
 * Say what shape the unusable answer was in, in one clause an operator can act on.
 *
 * THE FOUR CASES HAVE FOUR DIFFERENT FIXES, which is the entire reason this
 * exists rather than the words "unparseable output":
 *
 *   empty            the provider returned nothing -- a silent refusal, or a
 *                    safety filter. Retrying the same prompt will not help.
 *   truncated        brackets still open at the end. The model was writing
 *                    valid JSON and ran out of room: raise `maxTokens`, or ask
 *                    the job for less. THE MODEL IS NOT THE PROBLEM.
 *   no JSON at all   it answered in prose. A weaker model ignoring the format.
 *   malformed        brackets balance and it still will not parse -- a trailing
 *                    comma, a smart quote, an unescaped newline in a string.
 *
 * The tail is included because it is where truncation and malformation are
 * visible, and it is short because this string is shown on a report page.
 */
export function describeUnparseable(
  text: string, tokensOut: number | null, maxTokens: number,
): string {
  const trimmed = text.trim();
  if (trimmed === '') return 'answered with nothing';

  const start = trimmed.search(/[[{]/);
  if (start === -1) {
    return `answered in prose, not JSON (${trimmed.length} chars: `
      + `"${clip(trimmed.slice(0, 60))}…")`;
  }

  // Depth over the whole remainder, ignoring brackets inside strings -- an
  // opening brace in a quoted sentence is not structure.
  let depth = 0;
  let inString = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i]!;
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') depth -= 1;
  }

  if (depth > 0 || inString) {
    // AT THE CEILING is worth saying outright: it turns "the model failed" into
    // "we asked for more than we allowed", which is our bug and not theirs.
    const atCeiling = tokensOut !== null && tokensOut >= maxTokens - 8;
    return `output truncated${atCeiling ? ` at the ${maxTokens}-token ceiling` : ''}`
      + ` (${tokensOut ?? '?'} tokens, ${depth} level${depth === 1 ? '' : 's'} left open`
      + `, ends "${clip(trimmed.slice(-40))}")`;
  }

  return `malformed JSON (${trimmed.length} chars, ends "${clip(trimmed.slice(-40))}")`;
}

/** One line, no control characters: this ends up in HTML and in a log. */
function clip(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function resolveChain(spec: JobSpec, ctx: LlmContext): Provider[] {
  const wantsTenantSafety = spec.tenantContent || ctx.tenantContent;
  return spec.chain
    .map((id) => ALL_PROVIDERS[id])
    .filter((p): p is Provider => Boolean(p))
    // Free tiers may train on submitted data. Public tech news is harmless;
    // tenant discussion is not, and never routes to a training-eligible tier.
    .filter((p) => !(wantsTenantSafety && p.trainingEligible));
}

/**
 * Weekly agreement sampling (spec 4.4). Quality degradation is silent: a weak
 * model misclassifying a CVE produces no error, just a story that never arrives.
 * Below ~90% agreement, escalate the job class a tier.
 */
export async function sampleForQuality(
  ctx: LlmContext,
  jobType: string,
  userPrompt: string,
  cheapOutput: unknown,
  compare: (reference: unknown, cheap: unknown) => boolean,
): Promise<void> {
  const spec = JOBS[jobType];
  if (!spec) return;

  const claude = ALL_PROVIDERS.claude!;
  if (!claude.available(ctx.env)) return;

  const key = await jobCacheKey(`${jobType}:${spec.promptVersion}`, userPrompt);
  try {
    const res = await claude.call(
      { system: spec.system, user: userPrompt, maxTokens: spec.maxTokens, effort: spec.effort, json: true },
      ctx.env,
    );
    const reference = extractJson(res.text);
    await ctx.db.query(
      `INSERT INTO quality_samples (job_type, input_hash, cheap_provider, cheap_output,
                                    reference_output, agreed, reviewed_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6, now())`,
      [jobType, key, 'chain', JSON.stringify(cheapOutput), JSON.stringify(reference),
       reference ? compare(reference, cheapOutput) : null],
    );
  } catch {
    // Sampling must never break the pipeline it is measuring.
  }
}

export async function agreementRate(db: Db, jobType: string): Promise<number | null> {
  const rows = await db.query<{ agreement_rate: string | null }>(
    `SELECT agreement_rate::text FROM quality_agreement WHERE job_type = $1 LIMIT 1`,
    [jobType],
  );
  const raw = rows[0]?.agreement_rate;
  return raw == null ? null : Number(raw);
}

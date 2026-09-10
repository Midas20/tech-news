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

    try {
      const res = await provider.call(
        { system: spec.system, user: userPrompt, maxTokens: spec.maxTokens, effort: spec.effort, json: true },
        ctx.env,
      );
      await budgets.recordUsage(ctx.db, provider.id, res.rateLimit);

      const parsed = extractJson(res.text);
      if (parsed === null) {
        tried.push(`${provider.id}: unparseable output`);
        continue; // a different provider may well produce valid JSON
      }

      const valid = validate<T>(parsed, spec.schema);
      if (!valid.ok) {
        // Schema validation is what catches weaker models. Try the next one
        // rather than accepting output the rest of the pipeline cannot trust.
        tried.push(`${provider.id}: schema: ${valid.errors.slice(0, 3).join('; ')}`);
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
      if (err instanceof ProviderError && err.isRateLimit) {
        await budgets.recordRateLimit(ctx.db, provider.id, err.retryAfterSeconds);
        tried.push(`${provider.id}: 429`);
        continue;
      }
      await budgets.recordFailure(ctx.db, provider.id);
      tried.push(err instanceof Error ? `${provider.id}: ${err.message}` : String(err));
    }
  }

  // Nothing blocks. Unprocessed rows retry next cycle.
  return { status: 'deferred',
    reason: tried.length === 0 ? 'no provider available' : tried.join('; ') };
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

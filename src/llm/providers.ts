// Providers behind one interface. Everything above this file speaks job types,
// never provider names.
//
// Two rules encoded here:
//   - Free tiers may train on submitted data. Public tech news is harmless, but
//     anything user-originated (private Slack content, tenant discussion) must
//     route to a paid endpoint. `trainingEligible` marks which is which and the
//     router refuses to send tenant content to a provider marked true.
//   - Never create multiple accounts with one provider. Limits are enforced per
//     organization anyway, and it violates their terms. Use multiple PROVIDERS.

import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config.ts';

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
  /** OpenAI-compatible providers only. Removed on current Claude models. */
  temperature?: number;
  /** Claude only: output_config.effort, low..max. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  json?: boolean;
}

export interface RateLimitInfo {
  limitRequests: number | null;
  remainingRequests: number | null;
  resetSeconds: number | null;
}

export interface LlmResponse {
  text: string;
  provider: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  rateLimit: RateLimitInfo;
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    provider: string,
    status: number | null,
    message: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.provider = provider;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
  get isRateLimit(): boolean {
    return this.status === 429;
  }
}

export interface Provider {
  id: string;
  model: string;
  trainingEligible: boolean;
  available(env: Record<string, string | undefined>): boolean;
  call(req: LlmRequest, env: Record<string, string | undefined>): Promise<LlmResponse>;
}

/**
 * Quotas are read from response headers, never hardcoded. Published figures for
 * the same provider contradict each other and change without notice, so the only
 * trustworthy limit is the one the last response reported.
 */
export function parseRateLimit(headers: Headers): RateLimitInfo {
  const num = (...names: string[]): number | null => {
    for (const n of names) {
      const v = headers.get(n);
      if (v != null && Number.isFinite(Number(v))) return Number(v);
    }
    return null;
  };
  const duration = (...names: string[]): number | null => {
    for (const n of names) {
      const v = headers.get(n);
      if (!v) continue;
      const m = /^([\d.]+)(ms|s|m|h)?$/.exec(v.trim());
      if (!m) continue;
      const value = Number(m[1]);
      switch (m[2]) {
        case 'ms': return value / 1000;
        case 'm': return value * 60;
        case 'h': return value * 3600;
        default: return value;
      }
    }
    return null;
  };

  return {
    limitRequests: num('x-ratelimit-limit-requests', 'anthropic-ratelimit-requests-limit', 'ratelimit-limit'),
    remainingRequests: num('x-ratelimit-remaining-requests', 'anthropic-ratelimit-requests-remaining', 'ratelimit-remaining'),
    resetSeconds: duration('x-ratelimit-reset-requests', 'ratelimit-reset', 'retry-after'),
  };
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  provider: string,
): Promise<{ json: any; headers: Headers }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const retryAfter = res.headers.get('retry-after');
    throw new ProviderError(
      provider,
      res.status,
      `${provider} ${res.status}: ${text.slice(0, 300)}`,
      retryAfter ? Number(retryAfter) || null : null,
    );
  }
  return { json: await res.json(), headers: res.headers };
}

// --- OpenAI-compatible providers (Groq, Cerebras) --------------------------

function openAiCompatible(opts: {
  id: string;
  /** Read at call time so GROQ_MODEL_* / CEREBRAS_MODEL_* take effect. */
  model: () => string;
  endpoint: string;
  keyVar: string;
  trainingEligible: boolean;
}): Provider {
  return {
    id: opts.id,
    get model() { return opts.model(); },
    trainingEligible: opts.trainingEligible,
    available: (env) => Boolean(env[opts.keyVar]),
    async call(req, env) {
      const model = opts.model();
      const { json, headers } = await postJson(
        opts.endpoint,
        {
          model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          max_tokens: req.maxTokens ?? 2048,
          temperature: req.temperature ?? 0,
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        },
        { authorization: `Bearer ${env[opts.keyVar]}` },
        opts.id,
      );
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        provider: opts.id,
        model: json.model ?? model,
        tokensIn: json.usage?.prompt_tokens ?? null,
        tokensOut: json.usage?.completion_tokens ?? null,
        rateLimit: parseRateLimit(headers),
      };
    },
  };
}

export const groq = openAiCompatible({
  id: 'groq',
  model: () => getConfig().models.groqClassify,
  endpoint: 'https://api.groq.com/openai/v1/chat/completions',
  keyVar: 'GROQ_API_KEY',
  trainingEligible: true,
});

export const cerebras = openAiCompatible({
  id: 'cerebras',
  model: () => getConfig().models.cerebrasClassify,
  endpoint: 'https://api.cerebras.ai/v1/chat/completions',
  keyVar: 'CEREBRAS_API_KEY',
  trainingEligible: true,
});

// --- Gemini ----------------------------------------------------------------

function geminiProvider(model: () => string, id: string): Provider {
  return {
    id,
    get model() { return model(); },
    trainingEligible: true, // free tier: assume yes, and keep tenant content away
    available: (env) => Boolean(env.GEMINI_API_KEY),
    async call(req, env) {
      const { json, headers } = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent`,
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          generationConfig: {
            temperature: req.temperature ?? 0,
            maxOutputTokens: req.maxTokens ?? 2048,
            ...(req.json ? { responseMimeType: 'application/json' } : {}),
          },
        },
        { 'x-goog-api-key': env.GEMINI_API_KEY! },
        id,
      );
      return {
        text: json.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '',
        provider: id,
        model: model(),
        tokensIn: json.usageMetadata?.promptTokenCount ?? null,
        tokensOut: json.usageMetadata?.candidatesTokenCount ?? null,
        rateLimit: parseRateLimit(headers),
      };
    },
  };
}

export const geminiFlashLite = geminiProvider(() => getConfig().models.geminiClassify, 'gemini-flash-lite');
export const geminiFlash = geminiProvider(() => getConfig().models.geminiTranslate, 'gemini-flash');

// --- Claude ----------------------------------------------------------------
// Anything a user reads goes here: critical-item importance, the "why you are
// getting this" line, delivery translation.
//
// This one provider uses the official SDK rather than raw fetch. It buys typed
// errors (RateLimitError vs BadRequestError, which the router branches on) and
// keeps the request shape correct as the API moves -- `temperature` is REJECTED
// with a 400 on current Claude models, which a hand-rolled body copied from the
// OpenAI-compatible providers above would have sent.

/**
 * Default model. Every Claude call in this system is a judgment call a user will
 * read, so it runs on the most capable tier by default. Swapping to
 * `claude-sonnet-5` ($3/$15 per MTok) or `claude-haiku-4-5` ($1/$5) is a
 * one-line change here if the escalation volume ever justifies it.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

/** ANTHROPIC_MODEL_JUDGMENT overrides it; the default is the most capable tier. */
function claudeModel(): string {
  return getConfig().models.anthropicJudgment;
}

let claudeClient: Anthropic | null = null;

function getClaude(env: Record<string, string | undefined>): Anthropic {
  if (!claudeClient) claudeClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return claudeClient;
}

export const claude: Provider = {
  id: 'claude',
  get model() { return claudeModel(); },
  trainingEligible: false,
  available: (env) => Boolean(env.ANTHROPIC_API_KEY),
  async call(req, env) {
    try {
      const { data, response } = await getClaude(env)
        .messages.create({
          model: claudeModel(),
          max_tokens: req.maxTokens ?? 16000,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          ...(req.effort ? { output_config: { effort: req.effort } } : {}),
        })
        .withResponse();

      return {
        text: data.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join(''),
        provider: 'claude',
        model: data.model,
        tokensIn: data.usage?.input_tokens ?? null,
        tokensOut: data.usage?.output_tokens ?? null,
        rateLimit: parseRateLimit(response.headers),
      };
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        const retryAfter = err.headers?.get?.('retry-after');
        throw new ProviderError('claude', 429, err.message, retryAfter ? Number(retryAfter) || null : null);
      }
      if (err instanceof Anthropic.APIError) {
        throw new ProviderError('claude', err.status ?? null, err.message);
      }
      throw err;
    }
  },
};

export const ALL_PROVIDERS: Record<string, Provider> = {
  groq, cerebras,
  'gemini-flash-lite': geminiFlashLite,
  'gemini-flash': geminiFlash,
  claude,
};

// Job definitions: one prompt per job, provider-agnostic, plus the schema its
// output must satisfy and the provider chain it may use.
//
// The routing rule in one line: free tiers do triage, Claude does anything a
// user reads.

import type { JsonSchema } from './schema.ts';

export interface JobSpec {
  /** Failover chain, in order. `defer` is implicit at the end of every chain. */
  chain: string[];
  system: string;
  schema: JsonSchema;
  maxTokens: number;
  /**
   * Claude-only reasoning effort. Default (omitted) is `high`. Set `low` where
   * the job is mechanical and the tokens are the cost -- a one-line reason does
   * not need deep reasoning; a CVE severity call does.
   */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Contains tenant-originated text; must never reach a training-eligible tier. */
  tenantContent?: boolean;
  promptVersion: string;
}

export const CLASSIFY_BATCH = 20;
export const DEDUP_PAIR_BATCH = 10;
export const TITLE_TRANSLATE_BATCH = 20;
export const SUMMARY_BATCH = 15;

/**
 * Terminology that must survive translation untouched. Without a do-not-translate
 * glossary, technical terms get mangled ("Rust" becomes the metal, "React"
 * becomes a verb) and users stop trusting the feed within days.
 */
export const DO_NOT_TRANSLATE = [
  'React', 'Vue', 'Angular', 'Svelte', 'Rust', 'Go', 'Python', 'Node.js', 'Deno', 'Bun',
  'Kubernetes', 'Docker', 'Postgres', 'PostgreSQL', 'MySQL', 'Redis', 'Kafka', 'Terraform',
  'GitHub', 'GitLab', 'Linux', 'systemd', 'eBPF', 'WebAssembly', 'WebGPU', 'TypeScript',
  'Claude', 'GPT', 'Gemini', 'Llama', 'Qwen', 'DeepSeek', 'Hugging Face', 'PyTorch',
  'CVE', 'CVSS', 'TLS', 'QUIC', 'HTTP/3', 'OAuth', 'JWT', 'gRPC', 'GraphQL',
  'AWS', 'GCP', 'Azure', 'Cloudflare', 'Vercel', 'Fastly',
];

export const JOBS: Record<string, JobSpec> = {
  // Rubric-driven and quality-tolerant: exactly what a free tier is for.
  classify: {
    chain: ['groq', 'cerebras', 'gemini-flash-lite'],
    promptVersion: 'v1',
    maxTokens: 4000,
    system: [
      'You classify technology news items.',
      'For each numbered item decide whether it is a technology story, and which fields it belongs to.',
      'Fields MUST come from the provided vocabulary. Never invent a field name.',
      'If no vocabulary field fits, return an empty fields array rather than approximating.',
      'A marketing post, a job listing, a press release with no technical content, or a general',
      'business story that merely mentions a technology company is NOT a tech story.',
      'Return JSON only: {"results":[{"index":0,"is_tech":true,"fields":["rust"],"confidence":0.9}]}',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'is_tech', 'fields'],
            properties: {
              index: { type: 'integer', minimum: 0 },
              is_tech: { type: 'boolean' },
              fields: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
  },

  // Binary judgment on the pairs that hashing could not settle.
  dedup_pairs: {
    chain: ['groq', 'cerebras', 'gemini-flash-lite'],
    promptVersion: 'v1',
    maxTokens: 1024,
    system: [
      'You decide whether two headlines describe THE SAME underlying event.',
      'Same event: two outlets reporting one release, one outage, one CVE, one acquisition.',
      'Different events: two releases of the same project, a story and its follow-up,',
      'a general topic piece and a specific incident.',
      'Answer only from the text given. Do not speculate about what the articles might contain.',
      'Return JSON only: {"results":[{"index":0,"same":true}]}',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'same'],
            properties: {
              index: { type: 'integer', minimum: 0 },
              same: { type: 'boolean' },
            },
          },
        },
      },
    },
  },

  // Coarse triage. Anything scoring 6+ is re-scored by Claude below.
  importance_triage: {
    chain: ['gemini-flash', 'groq', 'cerebras'],
    promptVersion: 'v1',
    maxTokens: 2000,
    system: [
      'Score each item 0-10 for CONSEQUENCE to a working engineer.',
      'High (7-10): actively exploited vulnerability, breaking change, service shutdown,',
      '  forced migration, licence change, major version release of widely used software.',
      'Middle (4-6): notable release, significant deprecation with a long runway, new tool',
      '  with real adoption signal.',
      'Low (0-3): commentary, tutorial, funding round, benchmark, opinion, rumour.',
      'Consequence is not popularity. A widely covered story can be low; an obscure one high.',
      'Return JSON only: {"results":[{"index":0,"importance":7}]}',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'importance'],
            properties: {
              index: { type: 'integer', minimum: 0 },
              importance: { type: 'integer', minimum: 0, maximum: 10 },
            },
          },
        },
      },
    },
  },

  // A missed CVE costs trust. This tier exists for exactly that case.
  importance_critical: {
    chain: ['claude'],
    promptVersion: 'v1',
    maxTokens: 4000,
    // Being wrong here is the expensive case; this is not the place to save tokens.
    effort: 'high',
    system: [
      'You are re-scoring items a cheaper model flagged as potentially high-consequence.',
      'Score 0-10 for consequence to an engineer who depends on the affected technology.',
      'Be decisive about severity: an actively exploited vulnerability in widely deployed',
      'software, a breaking change with a short deadline, or an unplanned end-of-life is a 9-10.',
      'Downgrade confidently when the item turns out to be commentary, a roundup, or a',
      'vendor announcement with no operational consequence.',
      'Also return a one-sentence reason a reader can check against the headline.',
      'Return JSON only: {"results":[{"index":0,"importance":9,"reason":"..."}]}',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'importance'],
            properties: {
              index: { type: 'integer', minimum: 0 },
              importance: { type: 'integer', minimum: 0, maximum: 10 },
              reason: { type: 'string', maxLength: 300 },
            },
          },
        },
      },
    },
  },

  // Volume work, low stakes: only the hash of the output is consumed.
  translate_title: {
    chain: ['groq', 'gemini-flash-lite', 'cerebras'],
    promptVersion: 'v1',
    maxTokens: 4000,
    system: [
      'Translate each headline into English.',
      'Keep product, project, protocol and company names exactly as written.',
      'Do not add words that are not in the original. Do not explain.',
      'Return JSON only: {"results":[{"index":0,"title_en":"..."}]}',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'title_en'],
            properties: {
              index: { type: 'integer', minimum: 0 },
              title_en: { type: 'string', maxLength: 500 },
            },
          },
        },
      },
    },
  },

  // A user reads this. Translation and summary in one call, because the summary
  // is needed anyway and two calls would double the cost for the same output.
  translate_summarize: {
    chain: ['claude'],
    promptVersion: 'v1',
    maxTokens: 8000,
    effort: 'medium',
    system: [
      'For each item, produce an English title and a summary of about 400 characters.',
      'The summary must be understandable on its own years later, when the link may be dead:',
      'say what happened, to what, and what it means, not that "the article discusses" something.',
      'Keep every product, project, protocol and company name exactly as written.',
      'Never invent detail that is not in the supplied text. If the text is thin, be brief.',
      'Return JSON only: {"results":[{"index":0,"title_en":"...","summary_en":"..."}]}',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'title_en', 'summary_en'],
            properties: {
              index: { type: 'integer', minimum: 0 },
              title_en: { type: 'string', maxLength: 500 },
              summary_en: { type: 'string', maxLength: 900 },
            },
          },
        },
      },
    },
  },

  // This line is what makes users trust the filter, so it never goes to a
  // triage tier.
  relevance_reason: {
    chain: ['claude'],
    promptVersion: 'v1',
    maxTokens: 1200,
    effort: 'low',
    system: [
      'Write one short line explaining why this story is being sent to this user.',
      'Reference the specific interest that matched and the concrete consequence.',
      'Good: "Breaking change in Postgres 19 vacuum behaviour - you follow postgres."',
      'Bad: "This may be relevant to your interests."',
      'Maximum 140 characters. Return JSON only: {"reason":"..."}',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['reason'],
      properties: { reason: { type: 'string', maxLength: 200 } },
    },
  },

  // Weekly pass over accumulated candidate domains (spec 2.4).
  source_discovery: {
    chain: ['gemini-flash', 'claude'],
    promptVersion: 'v1',
    maxTokens: 4000,
    effort: 'low',
    system: [
      'For each candidate domain, decide whether it is a technology news or engineering',
      'content source worth polling, and which fields it covers.',
      'Reject: vendor marketing sites, documentation portals, package registries already',
      'covered, link shorteners, social platforms, and anything not primarily publishing.',
      'Fields must come from the supplied vocabulary.',
      'Return JSON only: {"results":[{"index":0,"is_source":true,"fields":["rust"],"role":"CONTENT","reason":"..."}]}',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'is_source'],
            properties: {
              index: { type: 'integer', minimum: 0 },
              is_source: { type: 'boolean' },
              fields: { type: 'array', items: { type: 'string' } },
              role: { type: 'string', enum: ['CONTENT', 'PRIMARY', 'DISCOVERY', 'COVERAGE', 'LAUNCH', 'EXPERIENCE'] },
              reason: { type: 'string', maxLength: 300 },
            },
          },
        },
      },
    },
  },

  // Structured extraction from forum posts and issue threads.
  experience_claims: {
    chain: ['groq', 'gemini-flash-lite'],
    promptVersion: 'v1',
    maxTokens: 4000,
    system: [
      'Extract concrete first-hand claims about using a tool or platform.',
      'A claim must be specific and checkable: a fee, a wait time, a failure, a limit.',
      'Discard opinions with no specifics, and anything that reads as promotion.',
      'Return JSON only: {"results":[{"index":0,"aspect":"payout","sentiment":-0.5,"claim":"..."}]}',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'aspect', 'sentiment', 'claim'],
            properties: {
              index: { type: 'integer', minimum: 0 },
              aspect: { type: 'string', maxLength: 60 },
              sentiment: { type: 'number', minimum: -1, maximum: 1 },
              claim: { type: 'string', maxLength: 500 },
            },
          },
        },
      },
    },
  },
};

/** Two-stage escalation threshold (spec 4.2). */
export const CRITICAL_ESCALATION_THRESHOLD = 6;

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

  // THE REPORT IS READ AND WRITTEN, NOT COUNTED.
  //
  // What this replaced compared how many stories each technology attracted this
  // window against the last and called the ratio a finding. Rejected on
  // 2026-09-01: "don't count news, it is fake value because we can't collect all
  // news". The denominator -- everything published anywhere -- is unknown, so a
  // ratio over it describes the feed list and nothing else.
  //
  // This prompt therefore FORBIDS COUNTING. The model is handed forty stories
  // with their text and told to say what is in them. The only quantities it may
  // use are public GitHub figures measured outside this archive, and it must
  // quote the date they were taken, because an adoption number without a date is
  // a claim about the present made from an unknown past.
  //
  // CITATIONS ARE STRUCTURAL, not stylistic. Every theme returns the story
  // numbers it was drawn from, and src/analysis/briefing.ts drops any theme that
  // cites nothing or cites a story that does not exist. That check is the only
  // defence against the real failure mode here: a model asked about technology
  // trends will fluently supply the industry consensus from its training data,
  // and a plausible paragraph about last year is indistinguishable from a
  // finding to the person reading it.
  //
  // The chain is long because a briefing nobody can generate is worth less than
  // a plainer one somebody can. ANTHROPIC_API_KEY is unset on this installation
  // and the Gemini free tier answers 429 to a prompt this size. The stored row
  // and the page both name the model that wrote them, so the degradation is
  // disclosed rather than smoothed over.
  field_briefing: {
    chain: ['claude', 'gemini-flash', 'gemini-flash-lite', 'cerebras', 'groq'],
    // v2 banned the volume vocabulary outright. v1 forbade counting and the model
    // obeyed the letter of it, then opened with "AI infrastructure and agent
    // platforms dominate updates" -- a claim about how many, made without a
    // number, and exactly the reading this rewrite exists to prevent.
    //
    // v3 MAKES IT WRITE NEWS. v2 was accurate, cited, and read like a filing
    // system: "AI Agent Governance and Enterprise Infrastructure Updates", "New
    // Cloud Hardware and Database Regions", "Framework and Tooling Updates".
    // Every title a noun phrase -- no actor, no verb, nothing that happened --
    // while the evidence underneath held AWS opening its Agent Registry,
    // LangChain raising $125m and Debian ruling on AI contributions. The model
    // was abstracting real events up into categories, which is the opposite of
    // the job, and a reader learns nothing from a category they did not already
    // know from the section heading. The rules now demand a subject and a verb,
    // and show four of v2's own titles as what not to write.
    promptVersion: 'v3',
    maxTokens: 4000,
    system: [
      'You are a technology analyst. You have been given the actual text of recent',
      'stories in one field. Read them and write what happened.',
      '',
      'RULES, in order of importance:',
      '',
      '1. NEVER COUNT THE STORIES, AND NEVER IMPLY A COUNT. Banned outright:',
      '   "seven stories", "most coverage", "the majority of reports", "dominate",',
      '   "dominant", "increasingly", "a wave of", "widespread", "everyone is",',
      '   "the trend", "growing interest", and any other phrase whose only evidence',
      '   is how many items you were shown. You were given a capped selection from',
      '   an incomplete archive: the quantities in front of you measure the feed',
      '   list, not the industry. Volume is not a finding here. Write what the',
      '   stories say happened, not how many of them there were.',
      '',
      '2. USE ONLY WHAT IS IN THE STORIES. Never introduce a technology, company,',
      '   product, version, funding round or event that does not appear in the text',
      '   you were given. You have no knowledge of anything outside it.',
      '',
      '3. CITE EVERYTHING. Each theme lists the story numbers it came from. A theme',
      '   you cannot cite must not be written. Two stories that say the same thing',
      '   from unrelated sources are worth more than five that repeat one vendor.',
      '',
      '4. THE ONLY NUMBERS YOU MAY USE are the public figures block, and you must',
      '   name the date they were measured. If that block is empty, state no size,',
      '   adoption or popularity figure at all.',
      '',
      '5. SEPARATE WHAT SOMEBODY DID FROM WHAT SOMEBODY SAYS. A story marked',
      '   first-party is the subject describing itself: authoritative about what',
      '   shipped, worthless as evidence that anyone wanted it. Say which you have.',
      '',
      '6. SAY WHAT IS ABSENT. If the stories do not settle a question a reader would',
      '   obviously ask, put that in "gaps". "The text does not say whether this',
      '   shipped to general availability" is a genuine finding.',
      '',
      'WHAT YOU ARE WRITING: news. Not a summary of news, not a taxonomy of it.',
      'Each item reports a thing that happened, or a thing several unrelated',
      'sources independently report. The reader should be able to learn what',
      'happened from your text alone and use the citations to check it.',
      '',
      'EVERY TITLE IS A SENTENCE WITH SOMEBODY DOING SOMETHING. A title with no',
      'actor and no verb is a filing label, and a page of filing labels tells a',
      'reader nothing they did not already know from the section heading.',
      '',
      '  BAD  AI Agent Governance and Enterprise Infrastructure Updates',
      '  BAD  New Cloud Hardware and Database Regions',
      '  BAD  Security Updates, Vulnerability Fixes and Agent Releases',
      '  BAD  Framework and Tooling Updates',
      '  GOOD AWS opens its Agent Registry to every account',
      '  GOOD Canonical patches OpenZFS in three Ubuntu releases',
      '  GOOD LangChain raises $125m and renames LangGraph Platform',
      '  GOOD Debian rules AI-generated contributions out of main',
      '',
      'Never end a title with Updates, Releases, Enhancements, Additions,',
      'Changes, Adjustments, Improvements, Features, Tooling, Fixes, Roundup or',
      'News. Never build one by joining two or three subjects with "and" -- if',
      'two things happened, they are two items.',
      '',
      'Open each body with the specific event: who did what, and when, in the',
      'first sentence. Then the detail that matters, then what somebody else said',
      'about it if anybody independent did. Do not open with a summary of the',
      'paragraph you are about to write.',
      '',
      'PREFER THE SPECIFIC. A version number, a price, a named product, a named',
      'company is worth more than any adjective. If the stories give you a figure',
      'that somebody else published -- a funding round, a limit, a price -- use it',
      'and say who published it.',
      '',
      'STYLE: plain declarative English, British spelling, present or simple past.',
      'No marketing register, no hedging padding, no scene-setting opener about a',
      'fast-moving landscape. Name things. Each body is one or two short',
      'paragraphs.',
      '',
      'Three to five items. Fewer, if the stories only support fewer -- two real',
      'events beat five categories every time.',
      '',
      'Return JSON only:',
      '{"headline":"...","summary":"...","themes":[{"title":"...","body":"...",',
      '"evidence":[1,4,9]}],"watch":["..."],"gaps":"..."}',
      'headline: the single most important thing that happened, as a sentence with',
      '  a subject and a verb. Under 90 characters. Not the name of the field, and',
      '  not a list of topics.',
      'summary: one sentence under 220 characters, what a reader should take away.',
      'themes: 3 to 5 news items, each titled as above, each with evidence as story',
      '  numbers from the list.',
      'watch: 2 to 4 short lines on what to watch next and why, each tied to a story.',
      'gaps: one or two sentences on what these stories could not tell you.',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['headline', 'summary', 'themes', 'watch', 'gaps'],
      properties: {
        headline: { type: 'string', maxLength: 200 },
        summary: { type: 'string', maxLength: 400 },
        themes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'body', 'evidence'],
            properties: {
              title: { type: 'string', maxLength: 160 },
              body: { type: 'string', maxLength: 2000 },
              evidence: { type: 'array', items: { type: 'integer' } },
            },
          },
        },
        watch: { type: 'array', items: { type: 'string', maxLength: 300 } },
        gaps: { type: 'string', maxLength: 600 },
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

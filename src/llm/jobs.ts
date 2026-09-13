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
    //
    // v4 KEEPS THE PROSE ON THE MARKET. "You have to say about new market and
    // market change in report, not source of report" (2026-09-13). `gaps` was
    // "what these stories could not tell you", which asked for a sentence about
    // the stories; it is now what the market has not yet decided.
    promptVersion: 'v4',
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
      '5. SEPARATE WHAT SOMEBODY DID FROM WHAT SOMEBODY SAYS. A company describing',
      '   its own product tells you what it shipped, not that anyone wanted it.',
      '   Write "Vercel launched X", never "Vercel says customers love X".',
      '',
      '6. WRITE ABOUT THE MARKET, NEVER ABOUT THE STORIES. Never mention the',
      '   stories, sources, publishers, feeds, this archive, the corpus, the',
      '   sample, citations, first-party or independent coverage, or this',
      '   briefing. The citations already carry where each fact came from; the',
      '   prose carries what happened.',
      '',
      '7. SAY WHAT IS STILL UNDECIDED IN THE MARKET. Put in "gaps" the questions',
      '   a buyer or a contractor would ask that nobody has answered yet: a price',
      '   not published, a date not set, a licence not stated. "Pricing for the',
      '   GA release has not been published" is a genuine finding.',
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
      'gaps: one or two sentences on what is still undecided in the market --',
      '  prices, dates, licences, availability. Never about the stories themselves.',
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

  // What the news MEANS, as opposed to what it says.
  //
  // Asked for on 2026-09-09, holding up a briefing that had repeated a
  // Databricks conference post: "I need strategy info in report not repeat of
  // news, The news is only data that prove your analysis result."
  //
  // WHY A SECOND CALL AND NOT A LONGER field_briefing PROMPT. The two jobs want
  // opposite things from the same stories. field_briefing must not generalise --
  // v2 abstracted real events up into categories and every title became a filing
  // label, and the rules that fixed it are rules against abstraction. Strategy
  // is abstraction, done deliberately and against evidence. Asking one prompt
  // for both produces the average of the two, which is a news summary with an
  // adjective in front of it.
  //
  // The mechanic that makes this analysis rather than opinion is the citation
  // rule: a claim about direction must cite BOTH an earlier story and a recent
  // one. A model cannot satisfy that by rewording a press release, and a reader
  // can check the two ends against each other. Claims that cannot be paired are
  // dropped by validateStrategy() rather than softened.
  field_strategy: {
    // gemini-flash-lite last rather than not at all. It is the weakest reader
    // here and a thin analysis that cites its evidence still beats no analysis;
    // the pairing rule in validateStrategy() throws out what it cannot support.
    chain: ['claude', 'gemini-flash', 'cerebras', 'groq', 'gemini-flash-lite'],
    // v2 names `openings[].what` in the prose, which v1 required and never
    // described. See the note on that line: it cost two of five fields their
    // entire reading on 2026-09-10.
    //
    // v3 DROPS `limits`. It asked for three or four sentences on what the
    // evidence could not show, and every answer was about the evidence: "Every
    // one of today's eleven stories is first-party", "Thirty developer-community
    // sources were added to this registry today". Rejected on 2026-09-13 -- a
    // report says what the market did, not what the archive read.
    promptVersion: 'v3',
    maxTokens: 8000,
    system: [
      'You are a strategy analyst reading a technology archive. You have TODAY\'S',
      'stories in one field and EARLIER stories on the same subjects. Your job is',
      'to say what is going on -- not what happened.',
      '',
      'THE READER ALREADY HAS THE NEWS. A sentence that tells them a company',
      'announced a thing they can read in the story above is wasted. Tell them',
      'what it indicates: where this is heading, what somebody is betting on,',
      'what is now possible that was not, what nobody has taken yet.',
      '',
      'RULES, in order of importance:',
      '',
      '1. EVERY CLAIM ABOUT CHANGE CITES BOTH ENDS. `now` is one or more numbers',
      '   from today. The EARLIER end is `then` (P numbers from the earlier',
      '   stories) or `thenOutside` (O numbers from the outside evidence), and at',
      '   least one of the two must be present. A claim you can only support from',
      '   one side is not a trend, it is a headline, and it will be discarded.',
      '',
      '   PREFER THE OUTSIDE EVIDENCE FOR ANYTHING OLDER THAN A FEW WEEKS. This',
      '   archive is new and its own history is thin and uneven; the download',
      '   curves and the Hacker News index reach back six months and are the same',
      '   for everybody. A claim resting on a public series is stronger than one',
      '   resting on whichever stories a feed happened to still be serving.',
      '',
      '2. NEVER COUNT THE STORIES, AND NEVER IMPLY A COUNT. Banned: "most',
      '   vendors", "a wave of", "increasingly", "everyone is", "the majority",',
      '   "dominant", "growing". You were given a capped selection from an',
      '   incomplete archive; the quantities in front of you measure a feed list,',
      '   not an industry. Convergence is shown by NAMING the parties: "Databricks,',
      '   Snowflake and Microsoft each shipped X" is evidence. "Vendors are',
      '   increasingly shipping X" is not.',
      '',
      '3. A VENDOR TALKING ABOUT ITSELF IS POSITIONING, NOT ADOPTION. A booth',
      '   schedule, a conference session, a customer-story blog and a launch post',
      '   are a company describing itself. They show what it has decided to sell,',
      '   not that anybody bought it, so write the claim as a bet: "Databricks is',
      '   making auditability its wedge into regulated finance" is supportable',
      '   from its own marketing; "banks are adopting it" is not.',
      '',
      '4. THE ONLY NUMBERS YOU MAY USE are those inside a story\'s text, attributed',
      '   to whoever published them, and the public figures block. Quote a survey',
      '   figure only with the surveyor\'s name. If a figure comes from a company',
      '   describing its own market, say so in the same sentence.',
      '',
      '5. NAME THINGS. A product, a company, a version, a price, a named customer.',
      '   Abstraction without a name attached is where analysis turns into',
      '   horoscope.',
      '',
      '6. WRITE ABOUT THE MARKET, NEVER ABOUT YOUR EVIDENCE. Every sentence is',
      '   about companies, products, prices, deadlines, skills and work. Never',
      '   mention the stories, sources, publishers, feeds, this archive, the',
      '   corpus, the sample, citations, first-party or independent coverage,',
      '   which sources were added, or this reading. "The earlier stories in this',
      '   archive were about capability" is written "In March the pitch was',
      '   capability". The citations already say where each fact came from.',
      '',
      'YOU ARE NOT LIMITED TO THIS ARCHIVE, and you are asked not to be.',
      '',
      'The OUTSIDE EVIDENCE block holds things this archive never collected: how',
      'many times a day a package was installed six months ago against now, from',
      'the registry that publishes it, and what was being discussed about these',
      'subjects on Hacker News across the same span. It is public, dated, and',
      'anybody can re-run the query and get the same answer.',
      '',
      'USE IT FOR THE TREND AND USE TODAY FOR THE EVENT. "langchain installs fell',
      'from 7.6M/day in March to 6.8M/day in September on PyPI, while today three',
      'vendors shipped agent frameworks of their own" is a reading. Repeating the',
      'three announcements is not.',
      '',
      'A DOWNLOAD COUNT IS NOT A USER COUNT. It includes continuous integration',
      'and mirrors. Say what it is, quote the registry and both dates, and do not',
      'convert it into a claim about how many people use something. A Hacker News',
      'point total is attention on one site on one day and nothing else.',
      '',
      'START WITH THE SHIFT, AND MAKE IT THE PLAINEST THING YOU WRITE.',
      '',
      'The earlier stories are grouped by month and run oldest first. Read the',
      'earliest group, then read today. `shift.before` describes the field as it',
      'stood at the earlier end -- what the vendors were arguing about, what the',
      'unsolved problem was, what the pitch was. `shift.after` describes it as it',
      'stands today. `shift.moved` is one sentence naming what is different, in',
      'terms a reader can disagree with.',
      '',
      'Write it as a change of subject, not a change of volume. "In March the',
      'argument was whether these models could do the work; today it is what a',
      'run costs and who is liable when it is wrong" is a shift. "There is more',
      'activity in this space" is a count, which rule 2 forbids, and it is also',
      'not interesting. If the earliest stories and today are about the same',
      'things in the same terms, say THAT -- a field standing still is a real and',
      'useful finding, and inventing motion in it is the worst thing you can do',
      'to a reader deciding where to spend six months.',
      '',
      'Omit `shift` entirely if the earlier coverage is too thin or too scattered',
      'to characterise. It is the first thing on the page and it must be the most',
      'defensible thing on it.',
      '',
      'WHAT TO LOOK FOR, in rough order of value to a reader:',
      '',
      '  SHIFT       what the field was about then, and what it is about now.',
      '  DIRECTION   what has moved between the earlier stories and today. The',
      '              strongest form is a change in what a company talks about:',
      '              last year the pitch was capability, this year it is control.',
      '  POSITIONING what a named company appears to be betting on, read from',
      '              what it ships and what it chooses to talk about. This is the',
      '              company\'s own thinking, and first-party sources are the RIGHT',
      '              evidence for it.',
      '  OPENING     something the stories show is now possible, needed or',
      '              unclaimed -- a gap between what is being sold and what the',
      '              evidence says is solved. Be concrete about who would do it.',
      '',
      'WHO IS READING THIS. One person, working remotely, deciding what to learn,',
      'what to build and what contract to chase. They are not an investor and not',
      'a product manager at a platform vendor. An opening that can only be taken',
      'by "EDA vendors" or "observability vendors" is useless to them, and naming',
      'one is a failure of this task rather than a finding.',
      '',
      'So `work` is the section that matters most. Each item is something ONE',
      'person could start on remotely, with evidence from the stories that',
      'somebody would pay for it. The strongest sources of those, in order:',
      '',
      '  A FORCED MIGRATION WITH A DEADLINE. A product going end-of-life, a',
      '  licence change, an API being withdrawn. Every team on it must move, most',
      '  cannot spare the people, and the work exists on the day of the',
      '  announcement. Say which product, which deadline, and who is stuck.',
      '',
      '  A TOOL SHIPPED WITH NO ECOSYSTEM. Something released that plainly needs',
      '  integrations, importers, templates or documentation that do not exist',
      '  yet. First mover on a small ecosystem is a position one person can hold.',
      '',
      '  A GAP BETWEEN WHAT IS SOLD AND WHAT IS NEEDED. Vendors shipping half of',
      '  a problem. Name the half nobody is selling.',
      '',
      '  A SKILL GOING SCARCE. A technology whose adoption is visibly running',
      '  ahead of the number of people who can work in it.',
      '',
      'Be concrete and be honest about difficulty. "Learn AI" is not work. "Teams',
      'on Atlassian Data Center must migrate before support ends and the vendor is',
      'selling webinars rather than a migration tool" is work. If the stories',
      'support none of this today, return an empty array -- inventing an',
      'opportunity costs the reader a week of their life.',
      '',
      'WHERE THE EVIDENCE ARGUES WITH ITSELF, SAY SO. Two sources pointing',
      'different ways is a finding, not a problem to be smoothed over -- and a',
      'vendor claim the independent coverage does not support is the most useful',
      'thing on the page. Put those in `tensions`.',
      '',
      'EVERY DIRECTIONAL CLAIM CARRIES ITS OWN FALSIFIER. State the specific,',
      'checkable thing that would show you wrong: an announcement that does not',
      'come, a price never published, a second practitioner reporting the',
      'opposite. "More evidence is needed" is not a falsifier. A claim you cannot',
      'say how to disprove is a claim you should not be making.',
      '',
      'Return JSON only:',
      '{"read":"...",',
      '"shift":{"before":"...","after":"...","moved":"...","then":[1],',
      '"thenOutside":[1],"now":[2]},',
      '"work":[{"what":"...","why":"...","skills":"...",',
      '"horizon":"now","evidence":[1]}],"direction":[{"claim":"...",',
      '"reasoning":"...","then":[1],"thenOutside":[1],"now":[2],',
      '"falsifier":"..."}],',
      '"positioning":[{"who":"...","bet":"...","evidence":[1],"firstParty":true}],',
      '"tensions":[{"what":"...","sides":"...","evidence":[1]}],',
      '"openings":[{"what":"...","why":"...","who":"...","evidence":[1]}]}',
      '',
      'read: one sentence, under 240 characters -- the single most useful thing a',
      '  strategist should take from today in this field. Not a summary of the',
      '  news; a reading of it.',
      'shift: the field then against the field now. `before` and `after` are two to',
      '  four sentences each; `moved` is one sentence. `then` cites P numbers from',
      '  the EARLIEST months you were given, not the most recent ones -- citing',
      '  last week as "before" is the failure this section exists to correct.',
      '  Both `then` and `now` are required and non-empty, and the whole object is',
      '  discarded without them.',
      'work: 0 to 4. `what` is the job, in one line, specific enough to start on.',
      '  `why` is the evidence that demand exists, naming the product, deadline or',
      '  gap. `skills` is what a person would need to already have or could pick',
      '  up. `horizon` is exactly one of "now" (the work exists today), "months"',
      '  (it will as the change lands) or "watch" (plausible, unproven).',
      'direction: 3 to 5. `now` is required. The earlier end is `then` (P numbers) or',
      '  `thenOutside` (O numbers) and at least one must be non-empty; prefer',
      '  `thenOutside` for anything older than a few weeks.',
      '  `reasoning` is two to four sentences: what the earlier evidence showed,',
      '  what today shows, and why the difference is a direction rather than a',
      '  coincidence. `falsifier` is required and specific.',
      'positioning: 2 to 6. `who` is a named company. `bet` says what they appear',
      '  to believe about the market, not what they shipped -- the shipping is in',
      '  the citation. `firstParty` is true when the evidence is that company',
      '  talking about itself.',
      'tensions: 0 to 3. `what` names the disagreement in one line; `sides` sets',
      '  out both readings and says which the evidence favours, if either. Leave',
      '  it empty rather than manufacturing a disagreement.',
      // `what` WAS NEVER DESCRIBED HERE, and it is required.
      //
      // Every other block in this list explains its own `what` -- work has "the
      // job, in one line", tensions has "names the disagreement in one line" --
      // and openings jumped straight to `who` and `why`. The skeleton above
      // shows the key, so a strong model fills it in from the shape; a weak one
      // follows the prose, writes the two keys the prose names, and omits the
      // one it does not.
      //
      // Measured on 2026-09-10, when every field's reading failed: two of the
      // five fields failed on exactly this, identically, and it reproduced on a
      // second sample at a different temperature --
      //
      //   cloud   schema: $.openings[0].what: required; $.openings[1].what: required
      //   infra   schema: $.openings[0].what: required; $.openings[1].what: required
      //
      // -- which is not a model missing the format. It is the format not having
      // been stated. The whole document was thrown away over a key the prompt
      // never asked for by name.
      'openings: 2 to 4. `what` names the gap itself in one line -- the thing',
      '  nobody is selling. `who` names the kind of party that could take it, and',
      '  `why` says what specifically is unserved -- not that a market is large.',
      '',
      'Be substantial. A reader who wanted the headlines has them above this; what',
      'they want here is the part that takes a paragraph to say properly. But',
      'well-evidenced beats numerous, and an empty array is a valid and honest',
      'answer when the stories do not support that kind of claim.',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['read', 'direction', 'positioning', 'openings'],
      properties: {
        read: { type: 'string', maxLength: 400 },
        shift: {
          type: 'object',
          required: ['before', 'after', 'moved', 'now'],
          properties: {
            before: { type: 'string', maxLength: 1200 },
            after: { type: 'string', maxLength: 1200 },
            moved: { type: 'string', maxLength: 400 },
            then: { type: 'array', items: { type: 'integer' } },
            thenOutside: { type: 'array', items: { type: 'integer' } },
            now: { type: 'array', items: { type: 'integer' } },
          },
        },
        work: {
          type: 'array',
          items: {
            type: 'object',
            required: ['what', 'why', 'evidence'],
            properties: {
              what: { type: 'string', maxLength: 240 },
              why: { type: 'string', maxLength: 1200 },
              skills: { type: 'string', maxLength: 300 },
              horizon: { type: 'string', enum: ['now', 'months', 'watch'] },
              evidence: { type: 'array', items: { type: 'integer' } },
            },
          },
        },
        direction: {
          type: 'array',
          items: {
            type: 'object',
            required: ['claim', 'reasoning', 'now'],
            properties: {
              claim: { type: 'string', maxLength: 240 },
              reasoning: { type: 'string', maxLength: 2000 },
              then: { type: 'array', items: { type: 'integer' } },
              thenOutside: { type: 'array', items: { type: 'integer' } },
              now: { type: 'array', items: { type: 'integer' } },
              falsifier: { type: 'string', maxLength: 500 },
            },
          },
        },
        positioning: {
          type: 'array',
          items: {
            type: 'object',
            required: ['who', 'bet', 'evidence'],
            properties: {
              who: { type: 'string', maxLength: 120 },
              bet: { type: 'string', maxLength: 1200 },
              evidence: { type: 'array', items: { type: 'integer' } },
              firstParty: { type: 'boolean' },
            },
          },
        },
        tensions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['what', 'sides', 'evidence'],
            properties: {
              what: { type: 'string', maxLength: 240 },
              sides: { type: 'string', maxLength: 1200 },
              evidence: { type: 'array', items: { type: 'integer' } },
            },
          },
        },
        openings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['what', 'why', 'evidence'],
            properties: {
              what: { type: 'string', maxLength: 240 },
              why: { type: 'string', maxLength: 1200 },
              who: { type: 'string', maxLength: 160 },
              evidence: { type: 'array', items: { type: 'integer' } },
            },
          },
        },
      },
    },
  },

  // Names, so that a new one can be noticed the second time it appears.
  //
  // WHY A SEPARATE JOB AND NOT PART OF classify. classify decides what a story
  // IS, against a closed vocabulary, and that closedness is the whole problem
  // this exists to solve: a tool the taxonomy has never heard of is exactly the
  // one worth knowing about, and every vocabulary-matching step in this system
  // is blind to it by construction.
  //
  // Cheap chain on purpose. This runs over every story that arrives, which is
  // the only way to catch a name on its FIRST appearance rather than after it
  // is already big enough to reach a curated feed. Naming things in a headline
  // is not a task that needs judgment; deciding what the names mean is, and
  // that happens in the briefing, which is on the expensive chain.
  entity_extraction: {
    chain: ['gemini-flash-lite', 'cerebras', 'groq', 'gemini-flash'],
    promptVersion: 'v1',
    maxTokens: 2000,
    effort: 'low',
    system: [
      'List the named products, tools, platforms, models and companies that each',
      'story is ABOUT. Nothing else.',
      '',
      'FOR EACH NAME, SAY WHAT IT DOES, in the words of the story. A name on its',
      'own is useless here: "Booley" means nothing, "an open-source IDE for',
      'agentic chip design in SystemVerilog" is a category a reader can judge.',
      'If the story does not say what a thing does, leave it out — you have not',
      'been told enough about it to be worth recording.',
      '',
      'INCLUDE things you have never heard of. That is the point of this task.',
      'An unfamiliar name attached to a clear claim is the most valuable thing',
      'you can return; do not drop it because you cannot corroborate it.',
      '',
      'EXCLUDE:',
      '  - categories and disciplines: AI, machine learning, DevOps, cloud,',
      '    security, open source, agents, databases',
      '  - where the story was published or hosted: GitHub, Reddit, Hacker News,',
      '    arXiv, npm, PyPI, the publication itself',
      '  - standards and formats older than the story: HTTP, JSON, CVE, OAuth',
      '  - people, job titles, places, funding-round names, conference names',
      '  - a thing mentioned only in passing as background or comparison',
      '',
      'kind is one of: tool, platform, model, company, standard, format.',
      'Use the name as the story writes it, including capitalisation. Do not',
      'append version numbers to the name; the version is not the identity.',
      '',
      'Return JSON only:',
      '{"results":[{"index":0,"entities":[{"name":"Booley","kind":"tool",',
      '"what":"open-source IDE for agentic chip design in SystemVerilog"}]}]}',
      '',
      'Return an entry for every story index you were given, with an empty',
      'entities array when a story names nothing that qualifies. Most stories',
      'name one or two things. A story naming more than six is a roundup, and',
      'you should return only the ones it is actually about.',
    ].join('\n'),
    schema: {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'entities'],
            properties: {
              index: { type: 'integer', minimum: 0 },
              entities: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'kind', 'what'],
                  properties: {
                    name: { type: 'string', maxLength: 80 },
                    kind: {
                      type: 'string',
                      enum: ['tool', 'platform', 'model', 'company', 'standard', 'format'],
                    },
                    what: { type: 'string', maxLength: 200 },
                  },
                },
              },
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

// The AI half of the registry, measured.
//
// Asked for on 2026-08-31: *"In AI field, there are many news, so we have to
// find proper sources, the rule that have to avoid noise is stable"*.
//
// The complaint that produced it was that a day held three stories. That number
// was real and mostly innocent -- Saturday averages 3 a day and Sunday 2,
// against 29-48 on weekdays, measured over twelve months -- but the ceiling
// underneath it was not. The registry held 97 healthy sources and SIX of them
// were AI-native: OpenAI's blog and changelog, DeepMind, Hugging Face, Mistral
// and NVIDIA's developer blog. The busiest subject in the archive was covered
// by six percent of it.
//
// AUDITIONED, NOT ARGUED. `npm run audition` fetched all 63 candidates live and
// put every item through the whole gauntlet in memory -- host, topic, build
// noise, event class, language, length -- calling the functions ingest calls,
// in ingest's order. Nothing was relaxed to make a source fit. That is the
// whole of "the rule that avoids noise is stable": the filters did not move,
// the registry grew to what those filters can already read.
//
// THE FIRST RUN WAS WRONG AND ITS ANSWER WAS INVERTED. It judged each item on
// the feed body alone, and most feeds carry one line, so the length gate
// refused nearly everything: OpenAI's feed scored 0 of 142, LangChain 0 of 100,
// vLLM 0 of 33. Ingest does not work that way -- when the feed body is short it
// fetches the article and extracts it. With that step restored vLLM scored 29
// of 30 and LangChain 22 of 30. A lazy harness does not produce a slightly
// pessimistic number, it produces a confident rejection.
//
// EVERY NUMBER IS A FLOOR. The audition samples at most 30 recent items per
// feed, and nine of these feeds returned every item they carry. `29/30` means
// the cap was reached, not that the source stopped.

export interface AiSource {
  name: string;
  url: string;
  feed: string;
  /** Kept of sampled, in the last 90 days, through the whole gauntlet. */
  kept: number;
  sampled: number;
  /** A first party writing about its own work. */
  primary: boolean;
  beat: 'model' | 'serving' | 'tooling' | 'data' | 'research' | 'market';
  why: string;
}

export const AI_SOURCES: AiSource[] = [
  // --- serving and inference: where a model becomes a thing you can call ----
  {
    name: 'vLLM blog', url: 'https://blog.vllm.ai/', feed: 'https://vllm.ai/blog/rss.xml',
    kept: 29, sampled: 30, primary: true, beat: 'serving',
    why: 'The highest rate of anything auditioned, and the engine most open-weight '
      + 'deployments actually run on. 29 of 30, capped by the sample.',
  },
  {
    name: 'Together AI blog', url: 'https://www.together.ai/blog',
    feed: 'https://www.together.ai/blog/rss.xml',
    kept: 24, sampled: 25, primary: true, beat: 'serving',
    why: 'Usually first to host a new open model, so its posts are the availability '
      + 'event rather than commentary on one.',
  },
  {
    name: 'Modal blog', url: 'https://modal.com/blog', feed: 'https://modal.com/blog/atom.xml',
    kept: 18, sampled: 18, primary: true, beat: 'serving',
    why: 'Every item kept. Serverless GPU platform changes, stated plainly.',
  },
  {
    name: 'Anyscale blog', url: 'https://www.anyscale.com/blog',
    feed: 'https://www.anyscale.com/rss.xml',
    kept: 17, sampled: 18, primary: true, beat: 'serving',
    why: 'Ray releases and distributed training changes.',
  },
  {
    name: 'CoreWeave blog', url: 'https://www.coreweave.com/blog',
    feed: 'https://www.coreweave.com/blog/rss.xml',
    kept: 18, sampled: 30, primary: true, beat: 'market',
    why: 'GPU capacity and contracts. Capacity announcements are a market signal '
      + 'this archive had almost no way to see.',
  },
  {
    name: 'Lambda blog', url: 'https://lambda.ai/blog', feed: 'https://lambda.ai/blog/rss.xml',
    kept: 10, sampled: 10, primary: true, beat: 'market',
    why: 'Every item kept. GPU cloud pricing and availability.',
  },
  {
    name: 'Ollama blog', url: 'https://ollama.com/blog', feed: 'https://ollama.com/blog/rss.xml',
    kept: 8, sampled: 8, primary: true, beat: 'serving',
    why: 'Every item kept. Local model releases, which is where a lot of adoption '
      + 'now starts.',
  },

  // --- research and models --------------------------------------------------
  {
    name: 'Google Research blog', url: 'https://research.google/blog/',
    feed: 'https://research.google/blog/rss/',
    kept: 24, sampled: 26, primary: true, beat: 'research',
    why: 'The research the archive was missing entirely: DeepMind was the only '
      + 'Google AI channel in the registry.',
  },
  {
    name: 'Google AI', url: 'https://blog.google/technology/ai/',
    feed: 'https://blog.google/technology/ai/rss/',
    kept: 15, sampled: 20, primary: true, beat: 'model',
    why: 'The AI section of The Keyword, not the firehose. Gemini launches land '
      + 'here first.',
  },
  {
    name: 'Microsoft Research blog', url: 'https://www.microsoft.com/en-us/research/blog/',
    feed: 'https://www.microsoft.com/en-us/research/feed/',
    kept: 8, sampled: 10, primary: true, beat: 'research',
    why: 'Phi releases and research. Two of the ten refused as media enclosures, '
      + 'which is a podcast feed sharing the channel.',
  },
  {
    name: 'Apple Machine Learning Research', url: 'https://machinelearning.apple.com/research',
    feed: 'https://machinelearning.apple.com/rss.xml',
    kept: 9, sampled: 10, primary: true, beat: 'research',
    why: 'On-device model work, rarely reported anywhere else first.',
  },
  {
    name: 'IBM Research blog', url: 'https://research.ibm.com/blog', feed: 'https://research.ibm.com/rss',
    kept: 15, sampled: 20, primary: true, beat: 'research',
    why: 'Granite releases and quantum, at a higher rate than expected.',
  },
  {
    name: 'PyTorch blog', url: 'https://pytorch.org/blog/', feed: 'https://pytorch.org/feed/',
    kept: 10, sampled: 10, primary: true, beat: 'tooling',
    why: 'Every item kept. Releases of the framework nearly all of this is built on, '
      + 'and the archive did not hold it.',
  },

  // --- agent and application frameworks ------------------------------------
  {
    name: 'LangChain blog', url: 'https://blog.langchain.com/', feed: 'https://blog.langchain.com/rss.xml',
    kept: 22, sampled: 30, primary: true, beat: 'tooling',
    why: 'Agent framework releases and breaking changes, at high cadence.',
  },
  {
    name: 'Sourcegraph blog', url: 'https://sourcegraph.com/blog', feed: 'https://sourcegraph.com/blog/feed.rss',
    kept: 10, sampled: 13, primary: true, beat: 'tooling',
    why: 'Code assistants and search, shipping often.',
  },
  {
    name: 'Roboflow blog', url: 'https://blog.roboflow.com/', feed: 'https://blog.roboflow.com/rss/',
    kept: 9, sampled: 15, primary: true, beat: 'tooling',
    why: 'Vision model releases and tooling. The only vision-shaped source here.',
  },
  {
    name: 'Azure AI Foundry blog', url: 'https://devblogs.microsoft.com/foundry/',
    feed: 'https://devblogs.microsoft.com/foundry/feed/',
    kept: 6, sampled: 10, primary: true, beat: 'model',
    why: 'Model availability on Azure. NOT the devblogs firehose, which is what feed '
      + 'discovery found first and would have duplicated the TypeScript and .NET '
      + 'feeds already held.',
  },

  // --- vector stores and data ----------------------------------------------
  {
    name: 'Qdrant blog', url: 'https://qdrant.tech/blog/', feed: 'https://qdrant.tech/index.xml',
    kept: 17, sampled: 26, primary: true, beat: 'data',
    why: 'Vector database releases, frequent and plainly stated.',
  },
  {
    name: 'Pinecone blog', url: 'https://www.pinecone.io/blog/', feed: 'https://www.pinecone.io/rss',
    kept: 13, sampled: 16, primary: true, beat: 'data',
    why: 'Vector database changes and pricing.',
  },
  {
    name: 'Weaviate blog', url: 'https://weaviate.io/blog', feed: 'https://weaviate.io/blog/rss.xml',
    kept: 8, sampled: 9, primary: true, beat: 'data',
    why: 'Open-source vector database releases.',
  },
  {
    name: 'MotherDuck blog', url: 'https://motherduck.com/blog/', feed: 'https://motherduck.com/rss.xml',
    kept: 24, sampled: 27, primary: true, beat: 'data',
    why: 'The second-highest rate auditioned. DuckDB-shaped analytics, shipping constantly.',
  },
  {
    name: 'Snowflake blog', url: 'https://www.snowflake.com/en/blog/', feed: 'https://www.snowflake.com/feed',
    kept: 19, sampled: 20, primary: true, beat: 'data',
    why: 'Warehouse and AI feature changes. Databricks was in the registry and its '
      + 'closest competitor was not.',
  },
  {
    name: 'dbt Labs blog', url: 'https://www.getdbt.com/blog', feed: 'https://www.getdbt.com/blog/rss.xml',
    kept: 19, sampled: 25, primary: true, beat: 'data',
    why: 'Transformation tooling releases.',
  },
  {
    name: 'AWS Machine Learning Blog', url: 'https://aws.amazon.com/blogs/machine-learning/',
    feed: 'https://aws.amazon.com/blogs/machine-learning/feed/',
    kept: 15, sampled: 20, primary: true, beat: 'model',
    why: 'Bedrock and SageMaker changes daily. The registry held three AWS feeds and '
      + 'none of them was the ML one.',
  },

  // --- market ---------------------------------------------------------------
  {
    name: 'NVIDIA newsroom', url: 'https://nvidianews.nvidia.com/news',
    feed: 'https://nvidianews.nvidia.com/rss.xml',
    kept: 15, sampled: 20, primary: true, beat: 'market',
    why: 'Hardware launches and partnerships. The developer blog was held; the half '
      + 'that carries the money was not.',
  },

  // --- adjacent, admitted on its number ------------------------------------
  {
    name: 'Rust Inside Out', url: 'https://blog.rust-lang.org/inside-rust/',
    feed: 'https://blog.rust-lang.org/inside-rust/feed.xml',
    kept: 9, sampled: 10, primary: true, beat: 'tooling',
    why: 'Not AI, and included because the number said so: 9 of 10, toolchain and '
      + 'governance changes that the main Rust feed does not carry.',
  },
];

/** Refused, with the number, so the decision is not re-litigated. */
export const AI_REFUSED: { name: string; note: string }[] = [
  { name: 'Hugging Face changelog', note: 'Feed discovery resolved it to huggingface.co/blog/feed.xml, '
    + 'which is the Hugging Face blog already polled. Same feed, different name.' },
  { name: 'OpenAI research', note: 'Resolves to openai.com/news/rss.xml -- the OpenAI blog already held.' },
  { name: 'Qwen blog', note: '44 items offered and NONE published in the last 90 days. A dormant feed '
    + 'ranked high on lifetime output is exactly the trap the 90-day rule exists for.' },
  { name: 'Stability AI news', note: '2 of 2. Below the bar of three, and the feed carries 20 items of '
    + 'which two are recent -- quiet rather than filtered out.' },
  { name: 'Replicate blog', note: '2 of 2 recent, from a feed of 124. Quiet.' },
  { name: 'Ars Technica AI', note: '0 of 20; 14 refused as articles. A magazine writing about AI is not '
    + 'an event in the history of a technology.' },
  { name: 'MIT Technology Review AI', note: '0 of 10, all articles.' },
  { name: 'VentureBeat AI', note: '0 of 7, six articles. Consistent with the 1-of-7 the general feed '
    + 'scored when it was refused on 2026-08-29.' },
  { name: 'Import AI', note: '0 of 11. Weekly analysis, which is the genre the event test removes.' },
  { name: 'Anthropic, AI at Meta, Cohere, Groq, DeepSeek, Fireworks, Cerebras, Baseten, LlamaIndex, '
    + 'Weights & Biases, ElevenLabs, AssemblyAI, Deepgram, Chroma, Zilliz, Runway, Luma, xAI, '
    + 'Perplexity, AI21, Reka, Moonshot, Z.ai, Salesforce AI',
    note: 'No discoverable feed. Every one was asked for rel=alternate and then probed on twenty '
      + 'candidate paths; several were probed by hand afterwards and returned 404 (anthropic.com/rss.xml, '
      + 'ai.meta.com/blog/rss/, elevenlabs.io/blog/rss.xml, groq.com/feed/). Two answered with an EMPTY '
      + 'feed -- cohere.com/blog/rss.xml and wandb.ai/site/blog/rss.xml -- which is worse than none, '
      + 'because it looks like a working source. These are the biggest names on the list and the archive '
      + 'cannot poll them; a page watcher, not a feed reader, is what they would need.' },
];

/**
 * One judgement call, left for a person.
 *
 * simonwillison.net keeps 20 of 30 through the whole gauntlet -- a higher event
 * rate than most first-party vendor blogs here. It is also one person's link
 * blog, and a personal blog scoring like a release feed is a fact about the
 * event classifier as much as about the blog. Adding it would put secondary
 * commentary into a lane built for first-party events, so it is recorded rather
 * than seeded.
 */
export const AI_JUDGEMENT = [
  { name: 'Simon Willison', feed: 'https://simonwillison.net/atom/everything/', kept: 20, sampled: 30 },
];

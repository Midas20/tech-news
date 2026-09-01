// Candidate sources, weighted towards AI.
//
// Asked for on 2026-08-31: *"In AI field, there are many news, so we have to
// find proper sources, the rule that have to avoid noise is stable"*.
//
// Both halves of that matter. The registry is thin where the subject is
// thickest -- 97 healthy sources and six of them AI-native (OpenAI's blog and
// changelog, DeepMind, Hugging Face, Mistral, NVIDIA's developer blog) -- while
// the weekday ceiling sits around forty items a day. And the filters stay as
// they are: this file exists to find sources the CURRENT rules can read, not to
// widen the rules until a source fits.
//
// Nothing here is admitted by being listed. `npm run audition` fetches each one
// live and puts every item through the whole gauntlet in memory, and the number
// that comes out is what decides it. Expect a good share of these to fail --
// that is the point of writing the list long.
//
// `site` is a page, not a feed. Feeds move, and half of these do not use the
// path anybody would guess; the audition asks the page what it advertises and
// only falls back to guessing.
//
// `primary` marks a first party writing about its own product. It changes how
// the topic filter treats the item, so it has to be honest: a lab writing about
// its own model is PRIMARY, a magazine writing about that lab is not.

export interface SourceCandidate {
  name: string;
  site: string;
  /** A first party writing about its own work. */
  primary: boolean;
  /** What it is expected to carry. Checked against the audition, not trusted. */
  why: string;
}

export const CANDIDATES: SourceCandidate[] = [
  // --- labs and model providers ---------------------------------------------
  { name: 'Anthropic news', site: 'https://www.anthropic.com/news', primary: true,
    why: 'Model releases, capability changes and pricing, first-party.' },
  { name: 'AI at Meta', site: 'https://ai.meta.com/blog/', primary: true,
    why: 'Llama releases and research from the group that ships them.' },
  { name: 'Google Research blog', site: 'https://research.google/blog/', primary: true,
    why: 'Research and model announcements outside DeepMind.' },
  { name: 'Microsoft Research blog', site: 'https://www.microsoft.com/en-us/research/blog/', primary: true,
    why: 'Phi releases and research; distinct from the Azure product feed.' },
  { name: 'Apple Machine Learning Research', site: 'https://machinelearning.apple.com/research', primary: true,
    why: 'On-device model work, rarely covered elsewhere first.' },
  { name: 'Cohere blog', site: 'https://cohere.com/blog', primary: true,
    why: 'Enterprise model releases and pricing changes.' },
  { name: 'AI21 Labs blog', site: 'https://www.ai21.com/blog/', primary: true,
    why: 'Jamba releases.' },
  { name: 'Stability AI news', site: 'https://stability.ai/news', primary: true,
    why: 'Open-weight image and audio model releases.' },
  { name: 'xAI news', site: 'https://x.ai/news', primary: true,
    why: 'Grok releases and API changes.' },
  { name: 'DeepSeek', site: 'https://api-docs.deepseek.com/news', primary: true,
    why: 'Model and API changes from a lab whose releases move the field.' },
  { name: 'Qwen blog', site: 'https://qwenlm.github.io/blog/', primary: true,
    why: 'Alibaba open-weight releases, frequent and dated.' },
  { name: 'Z.ai blog', site: 'https://z.ai/blog', primary: true,
    why: 'GLM releases and licence changes.' },
  { name: 'Moonshot AI', site: 'https://moonshotai.github.io/', primary: true,
    why: 'Kimi releases.' },
  { name: 'Reka AI blog', site: 'https://www.reka.ai/news', primary: true,
    why: 'Multimodal model releases.' },
  { name: 'Perplexity blog', site: 'https://www.perplexity.ai/hub/blog', primary: true,
    why: 'Product and model changes for a search-shaped assistant.' },

  // --- inference, serving and compute ---------------------------------------
  { name: 'Together AI blog', site: 'https://www.together.ai/blog', primary: true,
    why: 'Serving new open models, often first to host them.' },
  { name: 'Fireworks AI blog', site: 'https://fireworks.ai/blog', primary: true,
    why: 'Inference platform changes and model availability.' },
  { name: 'Groq news', site: 'https://groq.com/news/', primary: true,
    why: 'Hardware-backed inference; availability and pricing changes.' },
  { name: 'Cerebras blog', site: 'https://www.cerebras.ai/blog', primary: true,
    why: 'Inference speed and model hosting announcements.' },
  { name: 'Replicate blog', site: 'https://replicate.com/blog', primary: true,
    why: 'New models made runnable, close to a release feed for open weights.' },
  { name: 'Modal blog', site: 'https://modal.com/blog', primary: true,
    why: 'Serverless GPU platform changes.' },
  { name: 'Baseten blog', site: 'https://www.baseten.co/blog/', primary: true,
    why: 'Model deployment platform changes.' },
  { name: 'Anyscale blog', site: 'https://www.anyscale.com/blog', primary: true,
    why: 'Ray releases and distributed training changes.' },
  { name: 'Lambda blog', site: 'https://lambda.ai/blog', primary: true,
    why: 'GPU cloud capacity and pricing, which is a market signal.' },
  { name: 'CoreWeave blog', site: 'https://www.coreweave.com/blog', primary: true,
    why: 'GPU capacity announcements.' },
  { name: 'vLLM blog', site: 'https://blog.vllm.ai/', primary: true,
    why: 'The serving engine most open deployments run on.' },
  { name: 'Ollama blog', site: 'https://ollama.com/blog', primary: true,
    why: 'Local model releases, very frequent.' },

  // --- frameworks and developer tooling -------------------------------------
  { name: 'PyTorch blog', site: 'https://pytorch.org/blog/', primary: true,
    why: 'Releases of the framework nearly all of this is built on.' },
  { name: 'LangChain blog', site: 'https://blog.langchain.com/', primary: true,
    why: 'Agent framework releases and breaking changes.' },
  { name: 'LlamaIndex blog', site: 'https://www.llamaindex.ai/blog', primary: true,
    why: 'Retrieval framework changes.' },
  { name: 'Weights & Biases', site: 'https://wandb.ai/site/blog/', primary: true,
    why: 'Experiment tracking and evaluation tooling.' },
  { name: 'Roboflow blog', site: 'https://blog.roboflow.com/', primary: true,
    why: 'Vision model releases and tooling, high cadence.' },
  { name: 'Sourcegraph blog', site: 'https://sourcegraph.com/blog', primary: true,
    why: 'Code assistants and search; ships often.' },
  { name: 'Cursor changelog', site: 'https://cursor.com/changelog', primary: true,
    why: 'An editor changing weekly, and a platform developers are paid on.' },
  { name: 'Continue blog', site: 'https://blog.continue.dev/', primary: true,
    why: 'Open-source assistant releases.' },
  { name: 'Hugging Face changelog', site: 'https://huggingface.co/changelog', primary: true,
    why: 'Platform changes, distinct from the articles feed already held.' },

  // --- vector stores and data infrastructure --------------------------------
  { name: 'Pinecone blog', site: 'https://www.pinecone.io/blog/', primary: true,
    why: 'Vector database changes and pricing.' },
  { name: 'Weaviate blog', site: 'https://weaviate.io/blog', primary: true,
    why: 'Open-source vector database releases.' },
  { name: 'Qdrant blog', site: 'https://qdrant.tech/blog/', primary: true,
    why: 'Vector database releases, frequent.' },
  { name: 'Chroma blog', site: 'https://www.trychroma.com/blog', primary: true,
    why: 'Embedded vector store changes.' },
  { name: 'Zilliz blog', site: 'https://zilliz.com/blog', primary: true,
    why: 'Milvus releases.' },
  { name: 'Snowflake blog', site: 'https://www.snowflake.com/en/blog/', primary: true,
    why: 'Warehouse and AI feature changes; the half of data the registry lacks.' },
  { name: 'MotherDuck blog', site: 'https://motherduck.com/blog/', primary: true,
    why: 'DuckDB-shaped analytics platform changes.' },
  { name: 'dbt Labs blog', site: 'https://www.getdbt.com/blog', primary: true,
    why: 'Transformation tooling releases.' },

  // --- speech, video and generative media -----------------------------------
  { name: 'ElevenLabs blog', site: 'https://elevenlabs.io/blog', primary: true,
    why: 'Voice model releases and creator pricing.' },
  { name: 'AssemblyAI blog', site: 'https://www.assemblyai.com/blog', primary: true,
    why: 'Speech model releases.' },
  { name: 'Deepgram blog', site: 'https://deepgram.com/learn', primary: true,
    why: 'Speech recognition releases.' },
  { name: 'Runway research', site: 'https://runwayml.com/research', primary: true,
    why: 'Video model releases.' },
  { name: 'Luma AI news', site: 'https://lumalabs.ai/news', primary: true,
    why: 'Video and 3D model releases.' },

  // --- cloud AI product feeds the registry does not have --------------------
  { name: 'AWS Machine Learning Blog', site: 'https://aws.amazon.com/blogs/machine-learning/', primary: true,
    why: 'Bedrock and SageMaker changes, daily cadence.' },
  { name: 'Azure AI Foundry blog', site: 'https://devblogs.microsoft.com/foundry/', primary: true,
    why: 'Model availability on Azure.' },
  { name: 'NVIDIA newsroom', site: 'https://nvidianews.nvidia.com/news', primary: true,
    why: 'Hardware launches and partnerships; the market half of AI.' },
  { name: 'IBM Research blog', site: 'https://research.ibm.com/blog', primary: true,
    why: 'Granite releases and research.' },
  { name: 'Salesforce AI Research', site: 'https://www.salesforceairesearch.com/', primary: true,
    why: 'Enterprise agent research and releases.' },

  // --- security and platform, where AI now shows up -------------------------
  { name: 'Google Security Blog', site: 'https://security.googleblog.com/', primary: true,
    why: 'Security changes to platforms the archive already tracks.' },
  { name: 'Project Zero', site: 'https://googleprojectzero.blogspot.com/', primary: true,
    why: 'Vulnerability research, high value and low volume.' },
  { name: 'Chromium blog', site: 'https://blog.chromium.org/', primary: true,
    why: 'Browser platform changes upstream of Chrome for Developers.' },
  { name: 'Rust Inside Out (Rust blog releases)', site: 'https://blog.rust-lang.org/inside-rust/', primary: true,
    why: 'Toolchain and governance changes.' },
  { name: 'OpenAI research', site: 'https://openai.com/research/', primary: true,
    why: 'Papers and system cards, separate from the product blog already held.' },

  // --- the trade press that survived a gate once already --------------------
  //
  // Kept short and deliberately unglamorous. A magazine pays full price at the
  // topic filter, so only ones with a real event rate are worth the fetch.
  { name: 'VentureBeat AI', site: 'https://venturebeat.com/category/ai/', primary: false,
    why: 'Refused once on the general feed at 1 of 7; the AI section is the half that scored.' },
  { name: 'Ars Technica AI', site: 'https://arstechnica.com/ai/', primary: false,
    why: 'Section feed rather than the firehose.' },
  { name: 'MIT Technology Review AI', site: 'https://www.technologyreview.com/topic/artificial-intelligence/', primary: false,
    why: 'Low volume, high signal; may fail the event test entirely.' },
  { name: 'Import AI', site: 'https://importai.substack.com/', primary: false,
    why: 'Weekly, dense, and mostly analysis -- included to be measured, not because it will pass.' },
];

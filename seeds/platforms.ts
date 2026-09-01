// Where software runs and ships.
//
// This registry used to hold EARNING platforms -- freelance marketplaces,
// bounties, stock media, creator tips -- seeded for a Phase 7 feature that was
// never built. Fifty-six rows, hand-written, and not one of them tagged on a
// single collected story, because the technology press does not write about
// Fiverr's payout threshold. Meanwhile the rail said "Platforms are where a
// thing runs or is sold", which described a different registry entirely.
//
// These are that registry: the clouds, package registries, stores and model
// hosts that the sources in this archive actually write about. When npm changes
// its authentication rules or the App Store changes its review policy, that is a
// change to where software ships, and it belongs on a platform page next to the
// stories about it.
//
// The old rows are not deleted -- see migrations/0050. `platform_month` holds
// months of rollup history keyed by slug, and deleting the platforms would leave
// that history pointing at nothing. They are retired, which is what this archive
// does instead of forgetting.
//
// IDENTITY ONLY, still. Not one price, quota or fee is written here.
// `platform_facts` models a fact as a value with a source URL, a confidence and
// a validity window precisely because those numbers go stale, and typing
// "S3 costs $0.023/GB" into a seed file produces the confident, undated,
// unsourced claim that schema exists to prevent. What a platform charges is
// collected from the page that states it, or it is absent.

export interface PlatformSeed {
  slug: string;
  name: string;
  url: string;
  /** Which kind of platform this is. */
  channel: string;
  /** Pages that state the terms, for a watcher that does not exist yet. */
  factPages?: string[];
  /**
   * The name is an ordinary word or another product's name, so it must NEVER be
   * tagged on the name alone. See AMBIGUOUS below.
   */
  ambiguous?: true;
}

/**
 * Names that mean something else more often than they mean the platform.
 *
 * The tagger already demands a capital, which removes the ordinary-word class:
 * "impact" is not Impact, "medium" is not Medium. It does NOT remove the case
 * where the capitalised word is a DIFFERENT proper noun, and the crypto rows
 * added on 2026-08-29 walked straight into it. Measured on the first tagging
 * run, every single crypto tag in the archive was false:
 *
 *     7  cosmos    Azure Cosmos DB, NVIDIA Cosmos-H-Dreams, Cosmos3-Nano
 *     6  gate-io   Safari Technology Preview release notes
 *     1  coinbase  "Your guide to GitHub Universe 2026"
 *
 * Fourteen tags, fourteen wrong. This registry is unusually full of the problem
 * because crypto names ordinary English words on purpose: Base, Curve,
 * Compound, Foundation, Sky, Avalanche, Polygon, Optimism, Grass, Blur,
 * Jupiter, Helium, Gate, Cantina, Sherlock, Cosmos.
 *
 * OVER-TAGGING IS WORSE THAN UNDER-TAGGING, which this file already says and
 * which decides it: a platform page listing every story containing the word
 * "compound" is not a page about Compound. These are held out of name matching
 * entirely. They keep their row, they keep their identity, and they wait for a
 * signal stronger than a word -- a ticker, a domain, a linked announcement --
 * rather than being tagged on a coincidence in the meantime.
 */
export const AMBIGUOUS = new Set<string>([
  // crypto names that are ordinary English words
  'base-chain', 'curve-finance', 'compound-finance', 'sky-protocol', 'grass',
  'blur-io', 'foundation-app', 'optimism', 'polygon', 'avalanche', 'helium',
  'cosmos', 'gate-io', 'jupiter-exchange', 'cantina', 'sherlock-audit',
  // and short/shouty ones the capital rule cannot separate from prose
  'ton', 'near-protocol', 'sui', 'tron',

  // --- the earning rows, un-retired 2026-08-29 ---------------------------------
  //
  // THE CAPITAL RULE DOES NOT WORK ON A HEADLINE, which is the deeper reason
  // this set has to exist at all. `detectPlatforms` demands the name as the
  // platform writes it, capital included, on the theory that a proper noun is
  // capitalised and an ordinary word is not. That holds in body prose and
  // collapses in a title, because TITLES ARE TITLE CASE and capitalise every
  // word in them. Measured the moment these came back:
  //
  //   ghost   "Every UPDATE Leaves a Ghost: MVCC, Bloat, and VACUUM in PostgreSQL"
  //   ghost   "WAF - WAF Release - 2026-06-15"
  //   impact  "We're launching the Google DeepMind Accelerator program ..."
  //
  // A Postgres MVCC tuple is not the Ghost CMS. The file header already named
  // this exact list -- Arc, Impact, Maven, Ghost, Medium, Contra, Polar -- as
  // the reason for the capital rule; the rule was the wrong remedy for it, and
  // holding them out by name is the right one.
  'ghost', 'impact', 'medium', 'arc-dev', 'contra', 'maven', 'polar-sh',
  'devto', 'paddle', 'twitch',
]);

export const CHANNELS: { id: string; label: string; blurb: string }[] = [
  { id: 'cloud', label: 'Clouds and hosts', blurb: 'Where code is deployed and run.' },
  { id: 'registry', label: 'Package registries', blurb: 'Where a dependency is published and fetched from.' },
  { id: 'store', label: 'App and extension stores', blurb: 'Where finished software is distributed to users.' },
  { id: 'model', label: 'Model hosts', blurb: 'Where weights are served or downloaded.' },
  { id: 'ci', label: 'Build and CI', blurb: 'Where code is tested and released from.' },
  { id: 'data', label: 'Managed data', blurb: 'Databases and stores run by somebody else.' },

  // --- where a person can EARN, restored 2026-08-29 ----------------------------
  //
  // The header above records why these were retired: fifty-six earning rows, not
  // one tagged on a collected story, because the technology press does not write
  // about Fiverr's payout threshold. That diagnosis was right and the conclusion
  // was half of one -- the rows were not the problem, the SOURCES were. No feed
  // in the registry covered them, so the registry could not see them move, and a
  // platform nothing writes about looks identical to a platform where nothing
  // happens.
  //
  // Restored on the instruction of 2026-08-29: "add all sites that user can
  // create income, if the user can get crypto, it is high order, but the
  // activity have to high. To check activity, we can use news."
  //
  // ACTIVITY IS ALREADY MEASURED. `platform_month` holds stories,
  // distinct_sources and share per platform per month. It is the metric that
  // instruction describes, and it was built before the instruction existed. What
  // it needs is something to count -- which is a sources problem, not this file.
  //
  // Nine of the fifteen below were in the database all along, tagged on rows the
  // UI could not label because they were missing from THIS list, so every one of
  // them rendered as "unclassified".
  { id: 'exchange', label: 'Crypto exchanges', blurb: 'Where a coin is bought, sold and staked.' },
  { id: 'chain', label: 'Chains and networks', blurb: 'Where a validator earns and fees are paid.' },
  { id: 'defi', label: 'DeFi protocols', blurb: 'Lending, liquidity and yield run by contract rather than company.' },
  { id: 'depin', label: 'DePIN', blurb: 'Paid for supplying hardware, bandwidth or storage.' },
  { id: 'web3-infra', label: 'Web3 infrastructure', blurb: 'RPC, indexing and storage the rest is built on.' },
  { id: 'nft', label: 'NFT and creator markets', blurb: 'Where work is minted, listed and resold.' },
  { id: 'freelance', label: 'Freelance marketplaces', blurb: 'Selling time and skill by the contract.' },
  { id: 'bounty', label: 'Bounties and audits', blurb: 'Paid per bug found or per issue closed.' },
  { id: 'creator', label: 'Creator funding', blurb: 'Sponsorship, tips and recurring support.' },
  { id: 'content', label: 'Publishing', blurb: 'Where writing and video are published and paid for.' },
  { id: 'digital-goods', label: 'Digital goods', blurb: 'Selling a file, a template or a licence.' },
  { id: 'education', label: 'Teaching', blurb: 'Courses and lessons sold to a class.' },
  { id: 'stock', label: 'Stock media', blurb: 'Photography, video and audio licensed per download.' },
  { id: 'affiliate', label: 'Affiliate networks', blurb: 'Paid a share of what a referral spends.' },
  { id: 'compute', label: 'Credits and grants', blurb: 'Compute given rather than sold, to start something.' },
];

export const PLATFORMS: PlatformSeed[] = [
  // --- clouds and hosts --------------------------------------------------------
  { slug: 'aws', name: 'Amazon Web Services', url: 'https://aws.amazon.com/', channel: 'cloud' },
  { slug: 'google-cloud', name: 'Google Cloud', url: 'https://cloud.google.com/', channel: 'cloud' },
  { slug: 'azure', name: 'Microsoft Azure', url: 'https://azure.microsoft.com/en-us/', channel: 'cloud' },
  { slug: 'cloudflare', name: 'Cloudflare', url: 'https://www.cloudflare.com/', channel: 'cloud' },
  { slug: 'vercel', name: 'Vercel', url: 'https://vercel.com/', channel: 'cloud' },
  { slug: 'netlify', name: 'Netlify', url: 'https://www.netlify.com/', channel: 'cloud' },
  { slug: 'fly-io', name: 'Fly.io', url: 'https://fly.io/', channel: 'cloud' },
  { slug: 'render', name: 'Render', url: 'https://render.com/', channel: 'cloud' },
  { slug: 'railway', name: 'Railway', url: 'https://railway.com/', channel: 'cloud' },
  { slug: 'heroku', name: 'Heroku', url: 'https://www.heroku.com/', channel: 'cloud' },
  { slug: 'digitalocean', name: 'DigitalOcean', url: 'https://www.digitalocean.com/', channel: 'cloud' },
  { slug: 'hetzner', name: 'Hetzner', url: 'https://www.hetzner.com/', channel: 'cloud' },
  { slug: 'linode', name: 'Akamai Linode', url: 'https://www.linode.com/', channel: 'cloud' },
  { slug: 'ovhcloud', name: 'OVHcloud', url: 'https://www.ovhcloud.com/', channel: 'cloud' },
  { slug: 'scaleway', name: 'Scaleway', url: 'https://www.scaleway.com/', channel: 'cloud' },
  { slug: 'oracle-cloud', name: 'Oracle Cloud', url: 'https://www.oracle.com/cloud/', channel: 'cloud' },
  { slug: 'ibm-cloud', name: 'IBM Cloud', url: 'https://www.ibm.com/cloud', channel: 'cloud' },
  { slug: 'deno-deploy', name: 'Deno Deploy', url: 'https://deno.com/deploy', channel: 'cloud' },

  // --- package registries ------------------------------------------------------
  { slug: 'npm', name: 'npm', url: 'https://www.npmjs.com/', channel: 'registry' },
  { slug: 'pypi', name: 'PyPI', url: 'https://pypi.org/', channel: 'registry' },
  { slug: 'crates-io', name: 'crates.io', url: 'https://crates.io/', channel: 'registry' },
  { slug: 'maven-central', name: 'Maven Central', url: 'https://central.sonatype.com/', channel: 'registry' },
  { slug: 'nuget', name: 'NuGet', url: 'https://www.nuget.org/', channel: 'registry' },
  { slug: 'rubygems', name: 'RubyGems', url: 'https://rubygems.org/', channel: 'registry' },
  { slug: 'packagist', name: 'Packagist', url: 'https://packagist.org/', channel: 'registry' },
  { slug: 'go-packages', name: 'Go package index', url: 'https://pkg.go.dev/', channel: 'registry' },
  { slug: 'docker-hub', name: 'Docker Hub', url: 'https://hub.docker.com/', channel: 'registry' },
  { slug: 'homebrew', name: 'Homebrew', url: 'https://brew.sh/', channel: 'registry' },
  { slug: 'hex-pm', name: 'Hex', url: 'https://hex.pm/', channel: 'registry' },
  { slug: 'metacpan', name: 'MetaCPAN', url: 'https://metacpan.org/', channel: 'registry' },
  { slug: 'conda-forge', name: 'conda-forge', url: 'https://conda-forge.org/', channel: 'registry' },
  { slug: 'artifact-hub', name: 'Artifact Hub', url: 'https://artifacthub.io/', channel: 'registry' },
  { slug: 'ghcr', name: 'GitHub Container Registry', url: 'https://github.com/features/packages', channel: 'registry' },

  // --- app and extension stores ------------------------------------------------
  // `app-store` and `chrome-web-store` already existed in the old registry under
  // an earning channel. The slug is kept so their collected history survives;
  // only the channel moves.
  { slug: 'app-store', name: 'Apple App Store', url: 'https://developer.apple.com/app-store/', channel: 'store' },
  { slug: 'google-play', name: 'Google Play', url: 'https://play.google.com/console/about/', channel: 'store' },
  { slug: 'chrome-web-store', name: 'Chrome Web Store', url: 'https://chromewebstore.google.com/', channel: 'store' },
  { slug: 'firefox-addons', name: 'Firefox Add-ons', url: 'https://addons.mozilla.org/', channel: 'store' },
  { slug: 'vscode-marketplace', name: 'Visual Studio Marketplace', url: 'https://marketplace.visualstudio.com/', channel: 'store' },
  { slug: 'jetbrains-marketplace', name: 'JetBrains Marketplace', url: 'https://plugins.jetbrains.com/', channel: 'store' },
  { slug: 'github-marketplace', name: 'GitHub Marketplace', url: 'https://github.com/marketplace', channel: 'store' },
  { slug: 'steam', name: 'Steam', url: 'https://store.steampowered.com/', channel: 'store' },
  { slug: 'microsoft-store', name: 'Microsoft Store', url: 'https://apps.microsoft.com/', channel: 'store' },
  { slug: 'wordpress-plugins', name: 'WordPress Plugin Directory', url: 'https://wordpress.org/plugins/', channel: 'store' },
  { slug: 'flathub', name: 'Flathub', url: 'https://flathub.org/', channel: 'store' },
  // Already in the old registry as an earning channel, and an app store in
  // both readings -- kept, with the slug it already had.
  { slug: 'shopify-app-store', name: 'Shopify App Store', url: 'https://apps.shopify.com/', channel: 'store' },

  // --- model hosts -------------------------------------------------------------
  { slug: 'hugging-face', name: 'Hugging Face', url: 'https://huggingface.co/', channel: 'model' },
  { slug: 'replicate', name: 'Replicate', url: 'https://replicate.com/', channel: 'model' },
  { slug: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/', channel: 'model' },
  { slug: 'ollama', name: 'Ollama', url: 'https://ollama.com/', channel: 'model' },
  { slug: 'together-ai', name: 'Together AI', url: 'https://www.together.ai/', channel: 'model' },
  { slug: 'fireworks-ai', name: 'Fireworks AI', url: 'https://fireworks.ai/', channel: 'model' },
  { slug: 'modal', name: 'Modal', url: 'https://modal.com/', channel: 'model' },
  { slug: 'bedrock', name: 'Amazon Bedrock', url: 'https://aws.amazon.com/bedrock/', channel: 'model' },

  // --- build and CI ------------------------------------------------------------
  { slug: 'github-actions', name: 'GitHub Actions', url: 'https://github.com/features/actions', channel: 'ci' },
  { slug: 'gitlab-ci', name: 'GitLab CI/CD', url: 'https://about.gitlab.com/topics/ci-cd/', channel: 'ci' },
  { slug: 'circleci', name: 'CircleCI', url: 'https://circleci.com/', channel: 'ci' },
  { slug: 'buildkite', name: 'Buildkite', url: 'https://buildkite.com/', channel: 'ci' },
  { slug: 'jenkins', name: 'Jenkins', url: 'https://www.jenkins.io/', channel: 'ci' },

  // --- managed data ------------------------------------------------------------
  { slug: 'supabase', name: 'Supabase', url: 'https://supabase.com/', channel: 'data' },
  { slug: 'neon-db', name: 'Neon', url: 'https://neon.com/', channel: 'data' },
  { slug: 'planetscale', name: 'PlanetScale', url: 'https://planetscale.com/', channel: 'data' },
  { slug: 'mongodb-atlas', name: 'MongoDB Atlas', url: 'https://www.mongodb.com/atlas', channel: 'data' },
  { slug: 'upstash', name: 'Upstash', url: 'https://upstash.com/', channel: 'data' },
  { slug: 'snowflake', name: 'Snowflake', url: 'https://www.snowflake.com/', channel: 'data' },
  { slug: 'databricks', name: 'Databricks', url: 'https://www.databricks.com/', channel: 'data' },
  // === WHERE A PERSON CAN EARN =================================================
  //
  // Identity only, the same rule as everything above: not one APY, fee, payout
  // threshold or minimum is written here. Those are the numbers that go stale
  // fastest in this category. `platform_facts` models a fact as a value with a
  // source URL and a validity window, and a yield typed into a seed file is
  // exactly the confident, undated, unsourced claim that schema exists to
  // prevent.
  //
  // Crypto is listed first because the instruction of 2026-08-29 put it first:
  // "if the user can get crypto, it is high order". Listing is not endorsement
  // and carries no view on whether any of it is a good idea. This is a registry
  // of where activity can be MEASURED, and the measurement is `platform_month`.

  // --- crypto exchanges --------------------------------------------------------
  { slug: 'coinbase', name: 'Coinbase', url: 'https://www.coinbase.com/', channel: 'exchange' },
  { slug: 'binance', name: 'Binance', url: 'https://www.binance.com/', channel: 'exchange' },
  { slug: 'kraken', name: 'Kraken', url: 'https://www.kraken.com/', channel: 'exchange' },
  { slug: 'okx', name: 'OKX', url: 'https://www.okx.com/', channel: 'exchange' },
  { slug: 'bybit', name: 'Bybit', url: 'https://www.bybit.com/', channel: 'exchange' },
  { slug: 'kucoin', name: 'KuCoin', url: 'https://www.kucoin.com/', channel: 'exchange' },
  { slug: 'crypto-com', name: 'Crypto.com', url: 'https://crypto.com/', channel: 'exchange' },
  { slug: 'gemini-exchange', name: 'Gemini', url: 'https://www.gemini.com/', channel: 'exchange' },
  { slug: 'bitstamp', name: 'Bitstamp', url: 'https://www.bitstamp.net/', channel: 'exchange' },
  { slug: 'bitget', name: 'Bitget', url: 'https://www.bitget.com/', channel: 'exchange' },
  { slug: 'gate-io', name: 'Gate', url: 'https://www.gate.com/', channel: 'exchange' },
  { slug: 'mexc', name: 'MEXC', url: 'https://www.mexc.com/', channel: 'exchange' },
  { slug: 'upbit', name: 'Upbit', url: 'https://upbit.com/', channel: 'exchange' },
  { slug: 'htx', name: 'HTX', url: 'https://www.htx.com/', channel: 'exchange' },

  // --- chains and networks -----------------------------------------------------
  { slug: 'bitcoin', name: 'Bitcoin', url: 'https://bitcoin.org/', channel: 'chain' },
  { slug: 'ethereum', name: 'Ethereum', url: 'https://ethereum.org/', channel: 'chain' },
  { slug: 'solana', name: 'Solana', url: 'https://solana.com/', channel: 'chain' },
  { slug: 'cardano', name: 'Cardano', url: 'https://cardano.org/', channel: 'chain' },
  { slug: 'polkadot', name: 'Polkadot', url: 'https://polkadot.com/', channel: 'chain' },
  { slug: 'cosmos', name: 'Cosmos', url: 'https://cosmos.network/', channel: 'chain' },
  { slug: 'avalanche', name: 'Avalanche', url: 'https://www.avax.network/', channel: 'chain' },
  { slug: 'near-protocol', name: 'NEAR', url: 'https://near.org/', channel: 'chain' },
  { slug: 'aptos', name: 'Aptos', url: 'https://aptosfoundation.org/', channel: 'chain' },
  { slug: 'sui', name: 'Sui', url: 'https://sui.io/', channel: 'chain' },
  { slug: 'ton', name: 'TON', url: 'https://ton.org/', channel: 'chain' },
  { slug: 'tron', name: 'TRON', url: 'https://tron.network/', channel: 'chain' },
  { slug: 'polygon', name: 'Polygon', url: 'https://polygon.technology/', channel: 'chain' },
  { slug: 'arbitrum', name: 'Arbitrum', url: 'https://arbitrum.io/', channel: 'chain' },
  { slug: 'optimism', name: 'Optimism', url: 'https://www.optimism.io/', channel: 'chain' },
  { slug: 'base-chain', name: 'Base', url: 'https://www.base.org/', channel: 'chain' },
  { slug: 'zksync', name: 'zkSync', url: 'https://zksync.io/', channel: 'chain' },
  { slug: 'starknet', name: 'Starknet', url: 'https://www.starknet.io/', channel: 'chain' },
  { slug: 'celestia', name: 'Celestia', url: 'https://celestia.org/', channel: 'chain' },

  // --- defi --------------------------------------------------------------------
  { slug: 'uniswap', name: 'Uniswap', url: 'https://uniswap.org/', channel: 'defi' },
  { slug: 'aave', name: 'Aave', url: 'https://aave.com/', channel: 'defi' },
  { slug: 'lido', name: 'Lido', url: 'https://lido.fi/', channel: 'defi' },
  { slug: 'eigenlayer', name: 'EigenLayer', url: 'https://www.eigenlayer.xyz/', channel: 'defi' },
  { slug: 'curve-finance', name: 'Curve', url: 'https://curve.finance/', channel: 'defi' },
  { slug: 'compound-finance', name: 'Compound', url: 'https://compound.finance/', channel: 'defi' },
  { slug: 'sky-protocol', name: 'Sky', url: 'https://sky.money/', channel: 'defi' },
  { slug: 'jupiter-exchange', name: 'Jupiter', url: 'https://jup.ag/', channel: 'defi' },
  { slug: 'raydium', name: 'Raydium', url: 'https://raydium.io/', channel: 'defi' },
  { slug: 'pancakeswap', name: 'PancakeSwap', url: 'https://pancakeswap.finance/', channel: 'defi' },
  { slug: 'pendle', name: 'Pendle', url: 'https://www.pendle.finance/', channel: 'defi' },
  { slug: 'ethena', name: 'Ethena', url: 'https://ethena.fi/', channel: 'defi' },
  { slug: 'morpho', name: 'Morpho', url: 'https://morpho.org/', channel: 'defi' },
  { slug: 'rocket-pool', name: 'Rocket Pool', url: 'https://rocketpool.net/', channel: 'defi' },
  { slug: 'gmx', name: 'GMX', url: 'https://gmx.io/', channel: 'defi' },

  // --- depin: paid for supplying something physical ----------------------------
  { slug: 'helium', name: 'Helium', url: 'https://www.helium.com/', channel: 'depin' },
  { slug: 'filecoin', name: 'Filecoin', url: 'https://filecoin.io/', channel: 'depin' },
  { slug: 'arweave', name: 'Arweave', url: 'https://www.arweave.org/', channel: 'depin' },
  { slug: 'render-network', name: 'Render Network', url: 'https://rendernetwork.com/', channel: 'depin' },
  { slug: 'akash', name: 'Akash Network', url: 'https://akash.network/', channel: 'depin' },
  { slug: 'io-net', name: 'io.net', url: 'https://io.net/', channel: 'depin' },
  { slug: 'hivemapper', name: 'Hivemapper', url: 'https://hivemapper.com/', channel: 'depin' },
  { slug: 'grass', name: 'Grass', url: 'https://www.grass.io/', channel: 'depin' },

  // --- web3 infrastructure -----------------------------------------------------
  { slug: 'alchemy', name: 'Alchemy', url: 'https://www.alchemy.com/', channel: 'web3-infra' },
  { slug: 'infura', name: 'Infura', url: 'https://www.infura.io/', channel: 'web3-infra' },
  { slug: 'quicknode', name: 'QuickNode', url: 'https://www.quicknode.com/', channel: 'web3-infra' },
  { slug: 'helius', name: 'Helius', url: 'https://www.helius.dev/', channel: 'web3-infra' },
  { slug: 'chainstack', name: 'Chainstack', url: 'https://chainstack.com/', channel: 'web3-infra' },
  { slug: 'ankr', name: 'Ankr', url: 'https://www.ankr.com/', channel: 'web3-infra' },
  { slug: 'the-graph', name: 'The Graph', url: 'https://thegraph.com/', channel: 'web3-infra' },
  { slug: 'thirdweb', name: 'thirdweb', url: 'https://thirdweb.com/', channel: 'web3-infra' },
  { slug: 'pinata', name: 'Pinata', url: 'https://pinata.cloud/', channel: 'web3-infra' },
  { slug: 'moralis', name: 'Moralis', url: 'https://moralis.com/', channel: 'web3-infra' },

  // --- nft and creator markets -------------------------------------------------
  { slug: 'opensea', name: 'OpenSea', url: 'https://opensea.io/', channel: 'nft' },
  { slug: 'blur-io', name: 'Blur', url: 'https://blur.io/', channel: 'nft' },
  { slug: 'magic-eden', name: 'Magic Eden', url: 'https://magiceden.io/', channel: 'nft' },
  { slug: 'zora', name: 'Zora', url: 'https://zora.co/', channel: 'nft' },
  { slug: 'foundation-app', name: 'Foundation', url: 'https://foundation.app/', channel: 'nft' },

  // --- audit contests, which is bounty work priced in crypto -------------------
  { slug: 'code4rena', name: 'Code4rena', url: 'https://code4rena.com/', channel: 'bounty' },
  { slug: 'sherlock-audit', name: 'Sherlock', url: 'https://www.sherlock.xyz/', channel: 'bounty' },
  { slug: 'cantina', name: 'Cantina', url: 'https://cantina.xyz/', channel: 'bounty' },
  { slug: 'superteam-earn', name: 'Superteam Earn', url: 'https://earn.superteam.fun/', channel: 'bounty' },
  { slug: 'yeswehack', name: 'YesWeHack', url: 'https://www.yeswehack.com/', channel: 'bounty' },
];

// Is this a technology story, or is it something else printed by a technology
// outlet.
//
// The archive is meant to hold technical announcements and technical
// discussion. What it was actually holding, measured on three days of live
// collection, was a great deal of neither: Labor Day Costco deals, travel
// chargers, down jackets, six separate interviews about a video game, mountain
// bike streaming schedules, and a steady drip of "new study finds bosses are
// comfortable sharing documents with AI".
//
// None of that is a broken feed. TechRadar, ZDNET and their kind are consumer
// publications that also cover computing, and the shopping content is the
// business. The mistake was subscribing to the outlet and expecting the beat.
//
// So this judges the ITEM, not the source. It is lexical and deterministic --
// no model call, no budget, no gate to be switched off, and the same answer
// every time for the same title, which is what makes a rejection auditable.
//
// Two ideas do all the work:
//
//   REJECT MARKERS say what a piece of writing is for. "38% off", "season 3",
//   "how to watch", "raises $12M", "new survey finds" are all reliable, and
//   they are reliable because they are about the FORM of the piece rather than
//   its nouns.
//
//   A TECHNOLOGY SIGNAL rescues the soft ones. The vocabulary this project
//   already maintains -- 1,361 entries with aliases -- is a far better judge of
//   "is this about a technology" than any word list written by hand here, so
//   detectStacks() is the primary evidence and the phrase lists below are only
//   what it cannot see: version numbers, release language, and the shape of a
//   technical argument.
//
// The split between hard and soft is the whole design. A deal is a deal even if
// it is a deal on a GPU; an article about a lawsuit may still be an article
// about how a piece of software works. So commerce, entertainment and sport are
// refused outright, and politics, crime, business and consumer coverage are
// refused only when nothing in the title says technology.
//
// Every rejection is recorded with its category and the phrase that triggered
// it (see story_rejects). A filter you cannot audit is a filter that quietly
// eats a beat you cared about, and the first version of anything like this is
// always wrong somewhere.

import type { Db } from '../db/client.ts';
import {
  detectStacks, loadStackVocabulary, type StackVocabulary,
} from '../process/tagstacks.ts';

export type OffTopic =
  | 'speculation'
  | 'commerce'
  | 'entertainment'
  | 'sport'
  | 'politics'
  | 'crime'
  | 'business'
  | 'consumer';

export interface TopicVerdict {
  keep: boolean;
  /** Why it was refused. Absent when kept. */
  category?: OffTopic;
  /** The phrase that decided it, for the audit log. */
  matched?: string;
  /** What the vocabulary recognised, if anything. */
  stacks?: string[];
}

/**
 * How much evidence overturns a rejection.
 *
 *   none    nothing does. A deal on a GPU is still a deal.
 *   strong  only the TITLE sounding technical -- a version number, a release,
 *           a post-mortem. Naming a technology is not enough, because "OpenAI
 *           bans Russian accounts" and "report finds 40% of firms use
 *           Kubernetes" both name one and neither is what this archive is for.
 *   signal  naming a technology anywhere is enough.
 *
 * The middle one is the interesting case and it is where the first draft of
 * this was wrong: with a plain technology signal, every political story about
 * a tech company and every vendor survey walked straight back in.
 */
type Rescue = 'none' | 'strong' | 'signal';

interface Rule {
  category: OffTopic;
  rescue: Rescue;
  patterns: RegExp[];
  /**
   * Phrases that make the whole rule inapplicable to this title. "War" is a
   * political word in almost every sentence except the ones about the Cold War,
   * the browser wars and Gears of War.
   */
  except?: RegExp[];
  /**
   * Whether the rule applies to a first-party source at all.
   *
   * "DeepSeek V4 Flash is 90% off through Novita on AI Gateway" is a pricing
   * announcement on Vercel's own blog. Read as a headline it is indistinguishable
   * from a shopping listicle, and the difference is not in the words -- it is
   * that the publisher is the subject. A vendor writing about its own product is
   * announcing something even when the something is a price, so the shopping and
   * consumer-gear rules do not run on PRIMARY sources.
   */
  firstParty?: false;
}

// Word-boundary helper. \b is wrong around the punctuation these names carry --
// it splits "next.js" and "argo-cd" -- so boundaries are letter/digit based,
// the same convention detectStacks uses.
const B = (body: string) => new RegExp(`(^|[^a-z0-9])(${body})([^a-z0-9]|$)`, 'i');

const RULES: Rule[] = [
  {
    // Speculation, which is what arrives the moment the beat widens to money.
    //
    // This rule exists BEFORE the sources that need it, on purpose. Measured on
    // 2026-08-29, against the rules as they then stood, the gauntlet kept
    //
    //   "Top 10 best crypto to buy now before they explode"   -> market
    //   "Bitcoin price prediction: BTC could hit $200,000"    -> change
    //
    // and dropped "Binance adds USDC staking", "Uniswap v5 launches on
    // mainnet" and "Ethereum Foundation ships Fusaka upgrade to mainnet". The
    // filter was exactly backwards for the beat it was about to be pointed at,
    // and widening the sources first would have filled the archive with the
    // worst writing on the internet before anything caught it.
    //
    // rescue: 'none'. Naming a technology cannot redeem a price prediction --
    // every one of them names a technology, that is what they are predictions
    // ABOUT. This is the same judgement the commerce rule makes: no arrangement
    // of these phrases is an announcement.
    //
    // It runs on FIRST PARTIES TOO, which almost nothing else here does. An
    // exchange's own blog forecasting its own token is not a vendor announcing
    // a product, it is the thing this rule is for.
    category: 'speculation',
    rescue: 'none',
    patterns: [
      // Forecasts. The verb is conditional or predictive; a settled fact is not
      // written this way.
      B('price (prediction|forecast|target|analysis)'),
      // A FORECAST NEEDS A FIGURE. Written as a bare verb list this matched
      // "Azure Databricks Runtime 10.4 LTS will reach end of life" -- an
      // end-of-life notice, which is one of the most useful things here.
      B('(could|may|might|will|set to|poised to|expected to) '
        + '(hit|reach|top|surge to|soar to|climb to) '
        + '[$\u00a3\u20ac]?\\d[\\d,.]*'),   // never a bare digit: see the commerce rule
      B('(bull|bear) (run|market|case)|to the moon|next bull run'),
      // Not a bare 100x: "Training 100x Cheaper Retrieval models" is a
      // performance claim, and 100x is how engineers write those.
      B('\\d+x (gains?|returns?|profits?|potential)'),
      // Movement, but only when the subject is a price rather than traffic --
      // "DDoS attacks soar 40%" is a threat report, not a pump.
      B('(price|token|coin|btc|eth|xrp|stock|shares?) [\\w ]{0,14}'
        + '(surges?|soars?|plunges?|plummets?|rallies|tanks?|jumps?) \\d+%'),
      // Advice to buy, which is the same content with an imperative.
      B('(best|top) \\d* ?(crypto|coins?|tokens?|altcoins?|meme ?coins?) to (buy|watch|invest)'),
      B('(should you|worth) (buy|buying|investing)|buy (now|the dip)|before (it|they) (explodes?|moons?)'),
      B('(coins?|tokens?|altcoins?) to (buy|watch) (now|today|in \\d{4})'),
      B('investment (advice|opportunity)|not financial advice'),
      // Get-rich writing. "How I made $X" is a genre, and it is never a change
      // to a platform.
      B('how i (made|earned|turned) [$\u00a3\u20ac]?\\d[\\d,.]*'),
      B('(make|earn) [$\u00a3\u20ac]\\d[\\d,.]*( |-)?(a|per) (day|week|month|year)'),
      B('passive income|get rich|financial freedom|quit my job'),
      B('earn free (crypto|money|bitcoin|tokens?)|free (crypto|bitcoin) (giveaway|airdrop)'),
    ],
    except: [
      // A protocol's own scheduled emission change is not a forecast, and the
      // word "target" is load-bearing in both sentences.
      B('block reward|emission (schedule|curve)|halving'),
      // Moonshot AI ships models. The genre and the company share a word.
      B('moonshot ai|kimi'),
    ],
  },
  {
    // Shopping. The single largest category by volume, and the least
    // ambiguous: no arrangement of these phrases is a technical announcement.
    category: 'commerce',
    rescue: 'none',
    firstParty: false,
    patterns: [
      B('deals?'),
      B('on sale'),
      B('\\d{1,3}% off'),
      // A price is `\d[\d,.]*`, never a bare `\d`. Written as `under [$£€]\d`
      // the boundary check that follows lands on the SECOND digit of "$90" and
      // the pattern never fires -- which is exactly what let a page of monitor
      // deals through the first dry run.
      B('save (up to )?[$£€]?\\d[\\d,.]*'),
      B('discount(s|ed)?'),
      B('coupons?'),
      B('black friday|cyber monday|prime day|labor day|labour day|boxing day'),
      B('price (drop|cut|match)'),
      B('cheapest|lowest price|best price'),
      B('buying guide|gift (guide|ideas)'),
      B('shop (now|these)'),
      B('clearance'),
      B('for (just |only )?[$£€]\\d[\\d,.]*'),
      B('(under|below) [$£€]\\d[\\d,.]*'),
      // Retail verbs and retailers. "Drops to $250 at Best Buy" is "38% off"
      // with the arithmetic left to the reader.
      B('drops? to [$£€]\\d[\\d,.]*|now [$£€]\\d[\\d,.]* at'),
      B('best buy|amazon bonus|walmart|costco|newegg'),
      B('savings|price (hike|hikes)|is now [$£€]\\d[\\d,.]*'),
      B("don'?t miss (this|these)|grab (it|one|this)|snag (a|this)"),
      B('pre-?order(s|ing)?'),
    ],
    except: [
      // Retrospectives borrow the vocabulary of retail and mean the opposite of
      // it: "Windows NT 4 went on sale 30 years ago today".
      B('went on sale|years ago|anniversary|back in \d{4}'),
    ],
  },
  {
    // Television, film, music, celebrity and video games. Brands are avoided on
    // purpose -- "Netflix" and "Spotify" publish some of the best engineering
    // writing there is -- so these match the vocabulary of coverage instead.
    category: 'entertainment',
    rescue: 'none',
    patterns: [
      B('season \\d|episodes?|trailers?|box office|premieres?|spoilers?'),
      B('showrunner|screenwriter|soundtrack|the cast of|red carpet'),
      B('video games?|gameplay|dlc|expansion pack|speedrun'),
      B('xbox|playstation|nintendo|steam deck'),
      B('creative director|executive producer'),
      B('how to watch|where to stream|streaming (this|next) (week|month)'),
      B('celebrity|celebrities'),
      B('gamescom|comic-?con|the game awards|opening night live'),
      B('spin-?off (show|series)|confirmed cast|the cast|new series'),
      B('fighting game|roguelike|platformer|indie game|game studio|studio behind'),
      B('photographer of the year|film festival|blockbuster'),
    ],
  },
  {
    category: 'sport',
    rescue: 'none',
    patterns: [
      B('football|soccer|basketball|baseball|cricket|rugby|tennis|golf'),
      B('nba|nfl|mlb|nhl|ufc|premier league|la liga|serie a'),
      B('world cup|olympics?|championships?|grand prix|formula 1|f1 \\d'),
      B('fixtures?|kick-?off|half-?time|playoffs?'),
    ],
  },
  {
    // Government, elections and geopolitics. Refused on request, and softly:
    // export controls and privacy law genuinely change what engineers may ship,
    // and a title that names the technology still gets through.
    category: 'politics',
    rescue: 'strong',
    patterns: [
      B('elections?|voters?|ballot|campaign trail|polling station'),
      B('senate|congress|parliament|lawmakers?|legislature|governor'),
      B('president(ial)?|prime minister|minister|white house|kremlin|downing street'),
      B('tariffs?|sanctions?|embargo|geopolitic(s|al)'),
      B('war|invasion|ceasefire|troops|military|missiles?|drone (strike|interceptor)'),
      B('investigation into|opens? an inquiry|probe into|cease[- ]and[- ]desist'),
      B('immigration|deportation|asylum'),
      // "Visa" is also a payments company, and "Visa to cut 7% of workforce" is
      // not an immigration story. The word earns its rejection only in the
      // phrases immigration actually uses.
      B('h-?1b|work visas?|student visas?|visa (application|holder|lottery|rules|uncertainty)'),
      B('antitrust|monopoly probe|regulators?|regulatory (crackdown|probe)'),
      B('lawsuits?|sues?|sued|court (ruling|filing)|settlement|fined [$£€]?\\d[\\d,.]*'),
      B('democrat(s|ic)?|republican(s)?|conservative party|labour party'),
      // The shape of a story about state influence rather than about software.
      // "OpenAI bans Russian accounts posing as a fake Israeli think tank"
      // names a technology company and is not a technology story.
      B('propaganda|disinformation|influence operations?|think tanks?'),
    ],
    // "War" is a political word in almost every sentence except the ones about
    // the Cold War, the browser wars and Gears of War.
    except: [
      B('cold war|great war|world war ?(i|ii|1|2)?|star wars|gears of war'),
      B('(price|format|browser|flame|edit|console|bidding|ad blocking) wars?'),
      B('war stor(y|ies)|tug of war'),
      // Open source governs itself with the vocabulary of government. The
      // Python Packaging Council holds an election; it is not politics.
      B('(steering|packaging|governing) council|technical (steering )?committee'),
      B('(board|maintainer|core team|foundation|working group) election'),
    ],
  },
  {
    // Ordinary crime. Security incidents are NOT this: "theft" and "stolen"
    // are how breaches are described, so the technology signal does the
    // separating, helped by the security terms in TECH_PHRASES below.
    category: 'crime',
    rescue: 'strong',
    patterns: [
      B('stolen|theft|robbery|burglary|shoplifting'),
      B('arrested|indicted|convicted|sentenced to|pleads? guilty|jailed|prison'),
      B('murder|homicide|assault|kidnapp?(ed|ing)|smuggl(ed|ing)'),
    ],
  },
  {
    // WHOSE MONEY, AND ATTACHED TO WHAT.
    //
    // This rule used to be one list at `strong`, and it was the archive's
    // largest miss against its own purpose. "ClickHouse raises $400M Series D"
    // names a technology, has no version number in it, and so was refused --
    // along with ClickHouse's other two rounds, both of Supabase's, Mistral's
    // 1.7B and Hugging Face's $100M. Nine rounds from six of the most-watched
    // infrastructure companies in the registry, every one announced by the
    // company itself, every one thrown away as though it were a vendor survey.
    //
    // The project's purpose is "finding new stacks and market via news", so
    // capital IS the beat, not an off-topic category to be rescued from. It is
    // still a rule rather than nothing, because a funding round naming no
    // technology is business press and always was -- so `signal` is the right
    // threshold: name a technology anywhere and this is market news.
    category: 'business',
    rescue: 'signal',
    patterns: [
      B('raise[sd]? [$£€]?\\d[\\d,.]*[mbk]?|funding round|series [a-e] '),
      B('seed round|valuation|ipo|goes public|stock (price|market)|shares? (fall|rise|jump|slide)'),
      B('market (size|share|research|forecast|outlook)'),
    ],
  },
  {
    // The reports. Earnings, market research and the endless vendor survey --
    // writing ABOUT the industry rather than a move within it.
    //
    // Still `strong`, for the sentence that made the split necessary in the
    // other direction: "report finds 40% of firms use Kubernetes" names a
    // technology and reports nothing that happened. A survey is a survey
    // however good its subject.
    category: 'business',
    rescue: 'strong',
    patterns: [
      B('earnings|quarterly results|revenue (growth|jumps|falls)|market cap|profit warning'),
      B('layoffs?|job cuts|hiring freeze|restructuring'),
      B('(survey|study|report|research) (finds|found|says|shows|reveals|suggests|warns)'),
      B('new (study|survey|report)|according to (a|the) (study|survey|report)'),
      B('analysts? (say|expect|predict)|poll (finds|of)'),
      // The houses by name. An analyst pronouncement is not an event whoever
      // makes it, and "McKinsey says enterprise AI is on the road to ROI" was
      // walking through every pattern above it.
      B('(gartner|forrester|idc|mckinsey|bain|deloitte|accenture|pwc|kpmg)'
        + ' (say|says|find|finds|predict|predicts|expect|expects|report|reports)'),
      B('state of \\w+ report|\\d{4} trends report'),
      B('% of (businesses|companies|organi[sz]ations|workers|employees|it leaders)'),
    ],
  },
  {
    // Consumer gear coverage that is not a deal: the review, the round-up, the
    // "I tried it for a week". Soft, because a laptop review can be a genuine
    // hardware piece and the hardware field is one somebody may follow.
    category: 'consumer',
    rescue: 'signal',
    firstParty: false,
    patterns: [
      B('headphones|earbuds|smartwatch|fitness tracker|air fryer|mattress'),
      // Not bare "vacuum": Hackaday writes about vacuum tubes and vacuum
      // chambers, which are the opposite end of the same word.
      B('vacuum cleaner|robot vacuum'),
      B('jackets?|sneakers?|treadmill|e-?bike|scooter'),
      B('the best \\w+ (for|to|of|under)'),
      B('i (tried|tested|wore|used) (it|this|these)'),
      B('hands-on with|first impressions'),
      B('tvs?, |smart tv|streaming stick|soundbar'),
    ],
  },
];

/**
 * What a technical piece sounds like, beyond naming a technology.
 *
 * These exist because detectStacks() cannot see a version number, and a great
 * many of the best items in the archive -- "Fixes a panic in the SOCKS5
 * handshake", "3.14.0 released" -- name no technology in their title at all.
 */
/** See the note under TECH_PHRASES, which splices these in. */
const EARN_PHRASES: RegExp[] = [
  // Running the thing that pays: validation, settlement, the chain itself.
  B('staking|restaking|validators?|slashing|mainnet|testnet|hard ?forks?'),
  B('on-?chain|smart contracts?|rollups?|layer[- ]?2|sequencers?'),
  B('liquidity (pool|provider)|tvl|governance (vote|proposal)|tokenomics'),
  // Being paid by a platform, which is the non-crypto half of the same target.
  B('revenue share|payout(s|ed)?|monetis(e|ed|ation)|monetiz(e|ed|ation)'),
  B('creator fund|tip(s|ping)?|affiliate (program|payouts?)|commission rate'),
  B('(grants?|bounty|bounties|rewards?|incentives?|airdrop) programs?'),
  // How a network describes changing what it pays out. Scoped forms only:
  // a bare 'rewards' is a word in half of marketing.
  B('rewards? (structure|scheme|rate|pool|distribution|split)'),
  B('(emission|reward) (schedule|curve)|fee (split|switch|rebate)'),
  B('apy|apr\\b|yield (farming|program)?'),
  // Being paid BY a platform for what you put on it. Scoped to the words
  // that name a seller rather than a shopper: bare 'pricing' and bare
  // 'subscription' would make every consumer price story read as on-beat,
  // and the commerce rule is not guaranteed to catch them all.
  B('(paid|creator|seller|publisher|partner|author|contributor) [\\w ]{0,12}(subscriptions?|pricing|plans?|tiers?)'),
  B('per[- ](task|seat|unit|item|job|gig|listing) pricing'),
];

const TECH_PHRASES: RegExp[] = [
  // A version, in any of the forms release notes use.
  /(^|[^a-z0-9])v?\d+\.\d+(\.\d+)?([-.][a-z0-9]+)?([^a-z0-9]|$)/i,
  B('releas(e|ed|es|ing)|now available|general availability|shipping'),
  B('beta|alpha|release candidate|rc\\d|nightly|preview build'),
  B('changelog|patch(es|ed|ing)?|hotfix|bugfix|regression'),
  B('deprecat(e|ed|ing|ion)|end of life|eol|breaking change|migrat(e|ed|ion|ing)'),
  B('api|sdk|cli|repl|ide|orm|rpc|grpc|graphql|rest api|webhook'),
  B('open[- ]source|source code|repositor(y|ies)|pull requests?|commits?|fork(ed)?'),
  B('compiler|interpreter|runtime|kernel|driver|firmware|toolchain|linker'),
  B('framework|librar(y|ies)|package|dependency|dependencies|module'),
  B('database|query|index(es|ing)?|schema|transaction|replica(tion)?|shard(ing)?'),
  B('latency|throughput|benchmark(s|ed|ing)?|profil(e|ed|ing)|memory leak|race condition'),
  B('algorithm|data structure|type system|garbage collect(or|ion)|concurrency'),
  // Security, which shares its vocabulary with crime and must outrank it.
  B('cve-\\d{4}|vulnerabilit(y|ies)|exploits?|zero[- ]day|malware|ransomware'),
  B('phishing|breach|backdoor|privilege escalation|patch tuesday|hardening'),
  // Networking and traffic, which is what a threat report is made of. Without
  // these, "Cloudflare DDoS Threat Report: 1 Tbps attacks soar" reads as a
  // political story because the word "geopolitical" appears in its subtitle.
  B('ddos|dns|bgp|tcp|udp|http/?[23]|botnets?|packets?|bandwidth|[tgm]bps'),
  B('encrypt(ed|ion)|authentication|authori[sz]ation|tls|ssl|oauth|certificates?'),
  // The shape of a technical argument, which is the "discussion" half.
  B('how (we|i) (built|scaled|migrated|debugged|shipped|made)'),
  B('lessons (from|learned)|post-?mortem|deep dive|under the hood'),
  B('architecture|implementation|design of|internals|writing an?|building an?'),
  B('why (we|i) (chose|moved|left|rewrote|switched)'),
  B('self-?host(ed|ing)|on-?prem|cluster|container|serverless|edge (function|runtime)'),
  ...EARN_PHRASES,
];

/**
 * What an announcement about EARNING sounds like.
 *
 * Kept as its own list rather than folded into the block above, because these
 * are not "technical" in the sense the rest of that list means -- they are the
 * mechanics of getting paid by a platform, which became a target of this
 * archive on 2026-08-29 and was not one before.
 *
 * They are spliced into TECH_PHRASES because there is exactly one question
 * being asked -- is this title on the beat -- and two functions answering it
 * would drift. The comment is the separation; the behaviour is one gate.
 *
 * Without these, `isTechnicalTitle` returns false for "Binance adds USDC
 * staking with 8% APY" and "Kraken lists Monad and opens staking rewards", so
 * neither survives the evidence check that every unvetted source must pass.
 */

export interface TopicOptions {
  /**
   * The closed vocabulary. When absent the phrase lists carry the whole
   * technology signal, which is weaker -- callers that have a database should
   * always pass it.
   */
  vocab?: StackVocabulary;
  /**
   * Kinds whose items are technical by construction. A release feed publishes
   * releases; running a shopping filter over it can only produce mistakes.
   */
  trustedKinds?: readonly string[];
  sourceKind?: string;
  /** sources.roles for this feed. PRIMARY means the publisher is the subject. */
  sourceRoles?: readonly string[] | null;
}

const DEFAULT_TRUSTED = ['releases', 'status', 'research'] as const;

interface Signal {
  /** Technologies the vocabulary recognised in the title. */
  stacks: string[];
  /** The title itself sounds technical: a version, a release, a post-mortem. */
  technical: boolean;
}

function technologySignal(
  title: string, body: string, vocab?: StackVocabulary,
): Signal {
  return {
    stacks: vocab ? detectStacks(title, vocab, { max: 4 }) : [],
    // Read from the title only. A political article whose summary happens to
    // say "API" is still a political article, and letting the summary vote here
    // is what made the first draft rescue half of what it had just refused.
    technical: TECH_PHRASES.some((p) => p.test(title)),
  };
}

function rescued(rule: Rule, signal: Signal, body: string): boolean {
  if (rule.rescue === 'none') return false;
  if (rule.rescue === 'strong') return signal.technical;
  return signal.stacks.length > 0 || signal.technical
    || TECH_PHRASES.some((p) => p.test(body));
}

/**
 * Judge one item.
 *
 * The title decides a rejection on its own. The summary can only ADD evidence
 * for the rescuable categories -- a political story is often political in its
 * second sentence -- and never for the outright ones, so a passing mention of
 * Netflix in a summary cannot make a technical article into television.
 */
export function judgeTopic(
  title: string, summary: string, opts: TopicOptions = {},
): TopicVerdict {
  const kind = opts.sourceKind ?? '';
  const trusted = opts.trustedKinds ?? DEFAULT_TRUSTED;
  if (kind && trusted.includes(kind)) return { keep: true };

  const firstParty = (opts.sourceRoles ?? []).includes('PRIMARY');

  const head = title.trim();
  if (!head) return { keep: true };
  // Enough of the summary to catch the subject, not so much that a long article
  // is judged on a phrase in its twentieth paragraph.
  const tail = summary.slice(0, 400);

  const signal = technologySignal(head, tail, opts.vocab);

  for (const rule of RULES) {
    if (firstParty && rule.firstParty === false) continue;
    if (rule.except?.some((e) => e.test(head))) continue;
    if (rescued(rule, signal, tail)) continue;
    const haystack = rule.rescue === 'none' ? head : `${head} ${tail}`;
    for (const pattern of rule.patterns) {
      const hit = pattern.exec(haystack);
      if (!hit) continue;
      return {
        keep: false,
        category: rule.category,
        matched: hit[2]?.trim() ?? hit[0]?.trim(),
        stacks: signal.stacks,
      };
    }
  }

  return { keep: true, stacks: signal.stacks };
}

/**
 * Does this title sound like technical writing, independent of any rejection.
 *
 * The same evidence the `strong` rescue uses, exported because the source audit
 * asks a question the topic filter does not: not "should this be refused" but
 * "is this feed about technology at all". A general-interest board publishes a
 * great deal that no rule here refuses and that names no technology either.
 */
export function isTechnicalTitle(title: string): boolean {
  return TECH_PHRASES.some((p) => p.test(title));
}

/** Exposed for the tuning report and the tests. */
export const __test = { RULES, TECH_PHRASES, technologySignal };


// --- the vocabulary, once ----------------------------------------------------

let vocabCache: { at: number; vocab: StackVocabulary } | null = null;

/**
 * The closed vocabulary, cached across collection cycles.
 *
 * 6,607 aliases, and it changes when someone adds an entry -- which is to say
 * roughly never on the timescale of a thirty-second poll. Reloading it per
 * cycle would be a 6,000-row query every thirty seconds to learn nothing.
 *
 * A failure returns the previous copy rather than nothing: judging without the
 * vocabulary is not neutral, it makes the rescues weaker and the filter
 * harsher, so a transient database error must not silently start refusing more.
 */
export async function topicVocabulary(
  db: Db, ttlMs = 600_000,
): Promise<StackVocabulary | undefined> {
  if (vocabCache && Date.now() - vocabCache.at < ttlMs) return vocabCache.vocab;
  try {
    const vocab = await loadStackVocabulary(db);
    vocabCache = { at: Date.now(), vocab };
    return vocab;
  } catch {
    return vocabCache?.vocab;
  }
}

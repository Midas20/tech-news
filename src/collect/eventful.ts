// Is this an EVENT in a technology's life, or an article about one.
//
// topical.ts asks "is this about technology". This asks the narrower question
// the archive actually exists to answer: did something HAPPEN to a stack, a
// tool or a platform.
//
//   A new thing exists.          Introducing Agent Plugins 1.0.0
//   A new version exists.        Next.js 16.3 support on Vercel
//   Something changed.           Vercel WAF for Blob is now generally available
//                                Python 3.9 has reached end of life
//   The MARKET moved.            ClickHouse raises $400M Series D
//                                MotherDuck acquires the startup
//                                Self-hosted email is in steep decline
//
// THE FOURTH CLASS IS NEW AND IT IS HALF THE POINT. The project's purpose,
// stated 2026-08-28, is "finding new stacks and market via news" -- two
// targets, and until now this file implemented one. Which stack is being bet
// on, bought, adopted or abandoned is not a fact about a codebase and is
// exactly what a reader deciding where to spend a year of their life needs.
//
// Measured against the corpus: every one of ClickHouse's three funding rounds,
// both of Supabase's, Mistral's 1.7B and Hugging Face's $100M was refused --
// not as an article, but earlier, as `business` off-topic. The single largest
// miss in the archive against its own purpose.
//
// Everything else is an article: the tutorial, the opinion column, the
// benchmark, the interview, the engineering war story. All of it can be good
// writing and none of it is an event. "How Factory scaled its cloud backend to
// one billion monthly requests" tells you something true about Vercel and
// changes nothing about what Vercel IS -- and an archive built to answer what
// rose and fell in a technology over years is built out of the second kind of
// sentence, not the first.
//
// The distinction is in the GRAMMAR, which is what makes it decidable without a
// model. An announcement is a transitive claim about a named thing: X ships, X
// adds Y, X is now available, introducing X. An article is a question, a
// first-person report, or an editorial verb: how we, why you should, what I
// learned, X is putting Y on steroids. Those two sets barely overlap, and the
// handful of titles that carry both are nearly always announcements written up
// by a journalist -- so the announcement patterns are tested first.
//
// Deliberately independent of the vocabulary. detectStacks() cannot help here
// and would actively hurt: a genuinely NEW tool is by definition not in a closed
// vocabulary yet, and requiring a known name would filter out exactly the
// launches this is for.

export type EventKind = 'launch' | 'release' | 'change' | 'market' | 'article';

export interface EventVerdict {
  kind: EventKind;
  /** The phrase that decided it, for the audit log and the tuning report. */
  matched?: string;
}

/**
 * True when the story reports something happening, rather than discussing it.
 *
 * `market` is an event. A funding round is something that happened to a
 * technology's prospects in the way a release is something that happened to its
 * code, and the whole reason for the class is that the archive was throwing
 * those away.
 */
export function isEvent(kind: EventKind): boolean {
  return kind !== 'article';
}

// Letter/digit boundaries rather than \b, so "next.js" and "argo-cd" survive.
import { moneyClasses } from '../vocab/money.ts';

const B = (body: string) => new RegExp(`(^|[^a-z0-9])(${body})([^a-z0-9]|$)`, 'i');
/**
 * Anchored at the start, for the patterns that are only meaningful as openers.
 *
 * The leading group is empty-but-present on purpose, so the body is group 2 in
 * BOTH helpers. Without it the body sat at group 1 here and at group 2 in B(),
 * firstMatch() read group 2 either way, and an anchored hit reported its single
 * trailing character -- which trims to "" and reads as falsy. Every
 * "Introducing X" title in the corpus was classified as an article by a
 * successful match that looked like a failure.
 */
const S = (body: string) => new RegExp(`^(\\s*["'‘“]?)(${body})([^a-z0-9]|$)`, 'i');

/**
 * Titles that announce what KIND of piece they are, before saying anything.
 *
 * InfoQ prefixes every one: "Article:", "Presentation:", "Podcast:". Simon
 * Willison posts "Quoting Paul Dix". These are the cheapest and most certain
 * signals available and they are checked before anything else, because a
 * conference talk about a 2.0 release is still a talk.
 */
const DECLARED_ARTICLE: RegExp[] = [
  S('article|presentation|podcast|interview|video|talk|webinar|slides'),
  S('quoting|link|note|til|ask hn|tell hn|poll'),
  S('opinion|editorial|column|newsletter|digest|roundup|weekly|monthly'),
  // A digest is a digest wherever the word sits. "Java News Roundup: JDK
  // 27-RC1, OpenJDK JEPs, Jakarta EE, BellSoft, Helidon..." is six
  // announcements in a trench coat, and filing it as a release attaches all
  // six to whichever one the pattern happened to match first.
  B('news roundup|weekly roundup|link roundup|this week in|last week in'),
];

/**
 * Retrospectives, which borrow every verb an announcement uses.
 *
 * "Windows XP was released to manufacturing a quarter of a century ago" and
 * "One gigabyte of RAM cost as much as a house back in 1995" both match RELEASE
 * on its strongest pattern. Checked before the event classes, because the tense
 * is the whole difference and the tense lives in the date, not the verb.
 */
const RETROSPECTIVE: RegExp[] = [
  B('\\d+ years ago|years ago today|a (decade|century) ago|quarter of a century'),
  B('anniversary|back in (19|20)\\d{2}|history of|looking back'),
];

/** A thing that did not exist before now does. */
const LAUNCH: RegExp[] = [
  // `meet` and not `meet `, because the trailing boundary group already
  // requires the space -- spelling it twice demanded TWO non-alphanumerics and
  // matched nothing at all. The boundary is not "meeting": that fails on the i.
  S('introducing|announcing|presenting|meet'),
  B('introducing|announcing'),
  B('we(\'| a)?re (launching|releasing|open[- ]sourcing|shipping)'),
  B('(is|are) (now )?(here|live|out|available|open source)'),
  B('now (in )?(general(ly)? available|ga|public (beta|preview)|open beta)'),
  B('launch(es|ed|ing)?|debuts?|unveil(s|ed|ing)?|comes? out of stealth'),
  B('first (public )?(release|version|preview|beta)|1\\.0(\\.0)?|v1\\.0'),
  B('open[- ]sourc(e[sd]?|ing)'),
];

/** A new version of a thing that already existed. */
const RELEASE: RegExp[] = [
  B('releas(e|ed|es|ing)'),
  // A version number carrying a verb of arrival. The version alone is not
  // enough -- "Postgres 17 is slower than you think" is a benchmark post.
  /(^|[^a-z0-9])v?\d+\.\d+(\.\d+)?([-.][a-z0-9]+)?\s+(is\s+)?(out|here|released|available|ships?|shipping|landed?)([^a-z0-9]|$)/i,
  /(^|[^a-z0-9])(released?|ships?|shipping|out now|available)\s*:?\s*v?\d+\.\d+/i,
  // The "now" family, which is how a changelog says a thing changed. Written
  // narrowly at first ("now supports") it missed "now support", "can now be
  // made public", "are now up to 33% faster" and "now install" -- four
  // different verbs in four consecutive Vercel entries, every one an
  // announcement.
  B('(is|are|can|will) now'),
  B('now (available|supported|supports?|includes?|installs?|works?|runs?|ships?|accepts?|handles?|free|included|open)'),
  B('support (for|is) (now )?(here|available|added)|support on|support for'),
  B('lands? (in|on)|arrives? (in|on)|comes? to|rolling out|rolls? out'),
  B('changelog|patch (release|tuesday)|security release|hotfix|point release'),
  B('lts|long[- ]term support|release candidate|rc\\d|nightly build'),
];

/** The same thing, materially different. */
const CHANGE: RegExp[] = [
  B('deprecat(e|es|ed|ing|ion)|end[- ]of[- ]life|eol|sunset(s|ting|ted)?'),
  B('discontinu(e|ed|ing)|shut(ting)? down|shuts down|winding down|retired?'),
  B('breaking changes?|backwards[- ]incompatible|no longer supports?'),
  B('drops? support|removes? support|adds? support|now includes?|now ships with'),
  B('add(s|ed|ing)? (a |an |the )?\\w+ (support|api|backend|driver|integration|mode)'),
  // A version number followed by a verb of change. "Diagrid Catalyst 2.0 Adds
  // Durable Execution" is an announcement in exactly the way "Catalyst 2.0
  // released" is, and only the second form was being caught.
  /(^|[^a-z0-9])v?\d+\.\d+(\.\d+)?\s+\w*\s*(adds?|brings?|introduces?|includes?|gains?|gets?|drops?|removes?|deprecates?|supports?)([^a-z0-9]|$)/i,
  B('relicens(e|ed|ing)|licen[cs]e change|changes? (its )?licen[cs]e|moves? to (the )?[a-z]+ licen[cs]e'),
  // Not a bare "moves to": "U.S. gov't moves to suppress pushback on data
  // centers" is a sentence about a government, and the verb does no work for us
  // there. The named forms are the ones that mean a technology moved.
  B('rewritten in|ported to|migrat(es|ed|ing) to|switch(es|ed|ing) to'),
  B('moves? to (the )?(rust|go|c\\+\\+|typescript|python|java|zig|swift|wasm)'),
  B('renamed|rebrand(s|ed|ing)?|forks?|merged into|joins the'),
  B('price (increase|change)|pricing (change|update)|free tier|now free|raises? prices'),
  B('outage|incident|post-?mortem of|degraded service|status update'),
  B('cve-\\d{4}|security advisor(y|ies)|patched a|fixes? a (critical|severe|remote)'),
  // A disclosed vulnerability is an event in a stack's life in exactly the way
  // a release is: it changes what the thing is safe to run.
  B('vulnerabilit(y|ies)|zero[- ]day|exploited in the wild|actively exploited'),
  B('reaches? (general availability|stable|v\\d)|graduat(es|ed) (to|from)'),
];

/**
 * The market moved: who is being funded, bought, adopted or abandoned.
 *
 * Three questions, and each is a different kind of evidence about where a
 * technology is going:
 *
 *   capital     somebody with money looked at this and bet on it
 *   ownership   it now belongs to someone else, which decides its future
 *   position    people are moving toward it, or away
 *
 * ACQUISITION MOVED HERE FROM `change`. It was matching, and being filed as a
 * product change, which is the wrong label for the money lens and for a reader
 * scanning the class: "MotherDuck bought the startup" changes nothing about
 * what MotherDuck IS this week and everything about what it will be.
 *
 * The capital patterns are deliberately about the ROUND rather than the number.
 * "raises $400M" and "Series D" are unambiguous; a bare large number is not,
 * and topical.ts already refuses the shopping half of that vocabulary.
 *
 * Position is the thinnest of the three and the one to watch: "taking over"
 * and "in steep decline" are how a journalist says market share, and they are
 * also how a journalist says anything. They are kept narrow and paired with a
 * direction word for that reason.
 */
/** A title that asks rather than states. Ends in a question mark, or opens as one. */
const INTERROGATIVE = /(\?\s*$)|^\s*["‘“]?(how|why|what|when|where|which|who|should|is|are|can|does|do|will|if)\b/i;

/**
 * Which way the world is moving: share, growth, decline, dominance.
 *
 * Checked BEFORE the release grammar, and it is the only part of MARKET that
 * is. "Postgres is now the most popular database among new projects" matches
 * RELEASE on `(is|are|can|will) now` -- the idiom a changelog uses for every
 * feature it ships -- and reads as a release of Postgres, which it is not.
 *
 * Safe to check first precisely because these phrases are unambiguous: no
 * release note says "overtakes", "in steep decline" or "market share". The
 * capital and ownership halves are NOT safe that way -- "acquires" appears in
 * plenty of sentences about features -- so they stay after the product classes
 * and take what is left.
 */
const POSITION: RegExp[] = [
  B('market share|share of the market|overtakes?|leapfrogs?|dethrones?'),
  B('fastest[- ]growing|steep(est)? decline|in decline|losing ground|taking over'),
  B('most (popular|used|deployed|downloaded)|dominant|dominates?'),
  B('adoption (of|is|has|grew|grows|doubles?)|now used by \\d'),
];

/**
 * A change to how a platform PAYS, which is a change like any other.
 *
 * Filed as `change` rather than as a new event kind on purpose. "Binance adds
 * USDC staking" is Binance changing; "YouTube raises creator revenue share" is
 * YouTube changing. Inventing an `earn` kind would mean a migration, a filter,
 * a chip and a fifth thing for a reader to hold, to say something the existing
 * word already says.
 *
 * These exist because the general grammar misses every one of them. Measured
 * 2026-08-29, all four were filed `article` and dropped:
 *
 *   Binance adds USDC staking with 8% APY
 *   Kraken lists Monad and opens staking rewards
 *   Ethereum Foundation ships Fusaka upgrade to mainnet
 *   YouTube raises creator revenue share on Shorts
 *
 * The reason is narrow and worth keeping: CHANGE matches `adds <word>
 * support|api|backend|driver|integration|mode` -- a closed list of nouns that
 * predates this target and contains no way to be paid. `raises` reaches MARKET
 * only with a currency figure after it, and a revenue share is a percentage.
 */
const EARN: RegExp[] = [
  B('(adds?|added|introduces?|enables?|opens?|expands?|brings?) [\\w ]{0,24}'
    + '(staking|restaking|rewards?|yield|payouts?|revenue share|monetisation'
    + '|monetization|creator fund|tipping|earnings|subscriptions?)'),
  B('(raises?|increases?|cuts?|lowers?|reduces?|changes?) [\\w ]{0,24}'
    + '(revenue share|payouts?|commissions?|fees?|rewards?|rates?)'),
  B('(ships?|deploys?|activates?|completes?|rolls? out) [\\w ]{0,24}'
    + '(upgrade|hard ?fork|mainnet|testnet)'),
  B('(mainnet|testnet|hard ?fork) (is )?(live|launch(es|ed)?|goes live|activated)'),
  B('(grants?|bounty|bounties|rewards?|incentives?|airdrop) programs?'),
  B('(launch(es|ed)?|opens?) [\\w ]{0,24}(marketplace|payouts?|earning|rewards?)'),
];

/**
 * Money and ownership: who is being funded, and who now owns what.
 *
 * Checked last of the classes, after launch, release and change. When one
 * sentence is both -- "Vercel acquires Nuxt: Nuxt 5.0 is now available" -- what
 * the technology DID is the more useful label, because a reader can install a
 * release and cannot install an acquisition.
 */
const MARKET: RegExp[] = [
  B('raise[sd]? [$£€]?\\d[\\d,.]*\\s*(m|bn?|k|million|billion)?'),
  B('series [a-j](\\s|$)|seed round|funding round|new funding|led by'),
  B('valuation|valued at|ipo|goes public|files? to go public'),
  B('acquir(es|ed|ing)|acquisition of|bought by|buys|to buy|merges? with'),
  B('takes? a stake|majority stake|spins? out|spun out of'),
];

/**
 * The shape of a piece of writing rather than a report of an event.
 *
 * Two jobs. For an ordinary source it only explains a verdict -- the default is
 * already `article`, so a match here changes nothing except the label in the
 * audit log, and a label is the difference between a list you can act on and a
 * list you can only trust.
 *
 * For a FIRST-PARTY source it decides. There the default flips: a vendor post
 * about the vendor's own product is an event unless it looks like writing, and
 * this is the "looks like writing" test.
 */
/**
 * "What’s new in X": the one interrogative opening that announces something.
 *
 * "What’s new in ClickStack - March 2026", "What’s new in Postgres Managed by
 * ClickHouse: RBAC, Terraform, ClickPipes", "What’s new in two: June 2026 edition" --
 * a vendor’s periodic changelog, which is the densest announcement format any of
 * these publishers produce, refused on its first word by the interrogative
 * opener below.
 *
 * An exception rather than dropping `what` from that list, because "What are
 * PostgreSQL Templates?" is a tutorial and shares the opener. Checked in
 * classifyEvent BEFORE the article shapes are consulted at all.
 */
const WHATS_NEW = /^\s*["‘“]?what[’']?s\s+new\s+(in|for|with|at)\b/i;

const ARTICLE_SHAPE: RegExp[] = [
  S('how|why|what|when|where|which|who|should|is|are|can|does|do|will|if'),
  B('how (to|i|we|they|it)|why (i|we|you|it|they)'),
  B('lessons (from|learned)|what i learned|things i|my (experience|journey|take)'),
  B('a (guide|primer|tour|deep dive|beginner)|the case for|in defen[cs]e of'),
  B('tutorial|walkthrough|explained|understanding|demystif|cheat sheet'),
  B('review|hands[- ]on|benchmark(s|ed|ing)?|compared?|versus| vs '),
  B('best practices|anti-?patterns?|considered harmful|you should'),
  B('part \\d|series|chapter \\d|episode \\d'),
  B('thoughts on|notes on|reflections|musings|rant'),
];

export interface EventOptions {
  /**
   * The publisher is the subject: sources.roles contains PRIMARY.
   *
   * A vendor's own blog IS a changelog. Vercel writes "Share Container Registry
   * repositories across teams" and "Set your own project avatars" -- imperative
   * sentences with no announcement verb in them, indistinguishable by grammar
   * from a how-to, and each one a feature that did not exist last week. Read as
   * anonymous headlines they are articles; read as what they are -- a
   * first-party post about the publisher's own product -- they are events.
   *
   * So a first-party post is an event unless it says otherwise, and it can say
   * otherwise: "Article:", "How we built X", an interrogative opening. Those are
   * checked first and still win.
   */
  firstParty?: boolean;
  /**
   * Kinds whose items are events by construction.
   *
   * A release feed publishes releases -- that is the entire contract of the
   * format, and 325 of this system's sources are one. Reading their titles for
   * announcement grammar would be guessing at something already known, and
   * guessing wrong on the many release notes that are just a version string.
   */
  eventKinds?: readonly string[];
  sourceKind?: string;
}

const DEFAULT_EVENT_KINDS = ['releases', 'status'] as const;

/**
 * A title that IS a version rather than a sentence about one.
 *
 * Two shapes, both from real feeds: a bare tag with no whitespace at all
 * ("pkg/machinery/v1.13.9", "b10647"), and a short name ending in a version
 * ("Rspack v2.2.1", "Anthropic Claude v2.1.239").
 *
 * The four-word ceiling is what keeps "AWS Glue 5.1 is now available in AWS
 * European Sovereign Cloud" out: it contains a version and is an announcement
 * about a region, and the grammar reads it correctly once it is allowed to.
 */
function looksLikeVersion(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (!/\s/.test(t)) return true;
  const words = t.split(/\s+/);
  if (words.length > 4) return false;
  return /^[vb]?\d[\w.\-+]*$/i.test(words[words.length - 1] ?? '');
}

/**
 * The phrase that matched, or undefined when nothing did.
 *
 * Never returns an empty string, and the callers test `!== undefined` rather
 * than truthiness. Both halves of that matter: a match reporting nothing
 * readable is indistinguishable from no match at all, which is precisely how
 * every "Introducing X" title in the corpus came to be filed as an article.
 */
function firstMatch(patterns: RegExp[], text: string): string | undefined {
  for (const p of patterns) {
    const hit = p.exec(text);
    if (!hit) continue;
    const body = (hit[2] ?? '').trim() || (hit[1] ?? '').trim() || hit[0].trim();
    return body || 'matched';
  }
  return undefined;
}

/**
 * Judge one item.
 *
 * Read from the TITLE only. A summary is the first paragraph of the piece, and
 * the first paragraph of a tutorial about Kubernetes 1.32 says "Kubernetes 1.32
 * was released last week" -- which is true, is not what the piece is, and turns
 * every article about a release into a release.
 */
export function classifyEvent(title: string, opts: EventOptions = {}): EventVerdict {
  const kind = opts.sourceKind ?? '';
  const head = title.trim();

  // A release feed publishes releases -- except when it publishes an ending.
  //
  // "Billing is now enabled for R2 SQL", "Retirement: Support for Node 22 LTS
  // ends on April 30, 2027" and "HashiCorp adopts the Business Source License"
  // all arrive on feeds whose every other entry is a version number, and not
  // one of them is a release. They are the changes with a price attached, and
  // filing them as releases put them behind the one rule News applies to
  // releases -- shown only for technologies you track -- which is precisely
  // backwards: a price change matters most for the things you have NOT been
  // watching closely.
  //
  // Checked before the source's word is taken, and only for these patterns.
  // Everything else on a release feed is still a release by construction: a
  // version string carries no money vocabulary, so this cannot misfile one.
  if (head && moneyClasses(head).length > 0) {
    return { kind: 'change', matched: `money: ${moneyClasses(head).join('+')}` };
  }

  // A release feed's word is taken for a VERSION, not for a sentence.
  //
  // "A release feed publishes releases" is true of a repository's
  // releases.atom, where every entry is a tag. It is false of a vendor
  // changelog, which is the same feed kind and publishes prose:
  //
  //   Amazon Cognito adds admin API operation to reset user TOTP
  //   Global model policy generally available
  //   Mountpoint for Amazon S3 adds memory usage controls
  //
  // None of those is a new version of anything; they are launches and changes,
  // and filing them as releases hid them behind the rule News applies to
  // releases. Measured the day the registry was cut back to sixteen sources:
  // 155 of 169 stories were classed `release` and News showed 11 of them.
  //
  // So the shortcut applies to titles that ARE a version -- a bare tag, or a
  // name ending in one -- and everything else goes through the grammar below,
  // which knows "released", "now available", "adds" and "deprecated" perfectly
  // well. A first-party post the grammar cannot place still ends as a change,
  // never as an article.
  // A TITLE THAT IS A VERSION IS A RELEASE, whoever publishes it.
  //
  // This was gated on the source's kind alone, which is a fact about the feed
  // and not about the sentence. "Bun 1.4", "Deno 2.9", "Astro 7.2" are posts on
  // blogs classed `news`, so the shortcut did not apply and the grammar could
  // not place them either -- they survived only on the first-party fallback and
  // were filed as unclassified changes. A version release is the core event
  // this archive exists to find; reading it as "something happened, we cannot
  // say what" is the worst available answer.
  //
  // Safe because looksLikeVersion is strict -- at most four words, the last of
  // which IS a version -- and because isBuildNoise has already run, so a bare
  // tag with no notes behind it never reaches here.
  const versionTitle = looksLikeVersion(head);
  if (versionTitle
      && (opts.firstParty
          || (kind && (opts.eventKinds ?? DEFAULT_EVENT_KINDS).includes(kind)))) {
    return { kind: 'release', matched: kind ? `${kind} feed` : 'version title' };
  }

  if (!head) return { kind: 'article' };

  // `!== undefined` rather than truthiness, for the reason firstMatch spells
  // out: an empty label must never be able to reverse a decision.
  // A vendor's periodic changelog, before anything reads its first word as a
  // question. See WHATS_NEW: it is the densest announcement format these
  // publishers produce and it opens with "What".
  if (WHATS_NEW.test(head)) return { kind: 'change', matched: "what's new" };

  const declared = firstMatch(DECLARED_ARTICLE, head);
  if (declared !== undefined) return { kind: 'article', matched: declared };

  const retro = firstMatch(RETROSPECTIVE, head);
  if (retro !== undefined) return { kind: 'article', matched: retro };

  const launch = firstMatch(LAUNCH, head);
  if (launch !== undefined) return { kind: 'launch', matched: launch };

  // Before the release grammar; see POSITION for why this one class jumps the
  // queue and the other market patterns do not.
  //
  // Not for a question, though. "Beyond LoRA: Can you beat the most popular
  // fine-tuning technique?" is an article that happens to contain a superlative
  // about somebody else, and jumping the queue means POSITION is read before
  // the article shapes get their say. A market claim is a claim; a title asking
  // whether something is true is not making it.
  if (!INTERROGATIVE.test(head)) {
    const position = firstMatch(POSITION, head);
    if (position !== undefined) return { kind: 'market', matched: position };
  }

  const release = firstMatch(RELEASE, head);
  if (release !== undefined) return { kind: 'release', matched: release };

  const change = firstMatch(CHANGE, head);
  if (change !== undefined) return { kind: 'change', matched: change };

  // After CHANGE, because anything the general grammar can already place should
  // be placed by it -- this list is the gap, not a competing opinion.
  const earn = firstMatch(EARN, head);
  if (earn !== undefined) return { kind: 'change', matched: earn };

  // Market last of the four, deliberately.
  //
  // A product event and a market event can both be true of one sentence --
  // "Supabase Series F" is only market, but "Vercel acquires Nuxt and ships it
  // in v5" is both -- and when they are, what the technology DID is the more
  // useful label: it is the thing a reader can install. So launch, release and
  // change get first refusal and market catches what is left, which is the
  // funding round, the acquisition, and the share of the world moving.
  const market = firstMatch(MARKET, head);
  if (market !== undefined) return { kind: 'market', matched: market };

  const shape = firstMatch(ARTICLE_SHAPE, head);

  // Nothing in the grammar decided it. For a first-party post that is not
  // shaped like a piece of writing, the publisher decides -- see `firstParty`.
  if (opts.firstParty && shape === undefined) {
    return { kind: 'change', matched: 'first-party post' };
  }

  return { kind: 'article', matched: shape };
}

export const __test = {
  LAUNCH, RELEASE, CHANGE, MARKET, POSITION, DECLARED_ARTICLE, ARTICLE_SHAPE, WHATS_NEW,
  looksLikeVersion,
};

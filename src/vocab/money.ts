// The three ways a technology story is about money.
//
// The archive's purpose is not "know what happened" for its own sake -- it is to
// learn a stack and to earn or save money with what you learn. Two of those are
// already served: what to learn is the technology registry and the Articles
// class, and what happened is the event classes. The third was invisible, and it
// is the one with a number attached to it.
//
// A price change, a licence change and an end-of-life notice are all filed as
// `change` by the event classifier, which is correct and not enough: they are
// the changes that cost or save money, and they are buried among API
// deprecations and shutdown notices for features nobody billed for.
//
// READ FROM THE TITLE ONLY, the same rule classifyEvent follows and for the same
// reason: the first paragraph of a release note about Claude mentions pricing,
// the first paragraph of half of everything mentions cost, and matching a
// summary turns a lens into a smear. Measured on this archive -- 635 stories --
// title-and-summary matched 29 items of which most were noise; title alone
// matched 16, of which 15 were exactly right.
//
// WORD BOUNDARIES ARE NOT OPTIONAL HERE. The first version of the licence
// pattern listed `SSPL` as a bare alternative and matched "Cro-sspl-ane", a
// Kubernetes project with no licence news in it at all. Every acronym below is
// wrapped in \y, and there is a test that holds it there.

export interface MoneyLens {
  value: string;
  label: string;
  blurb: string;
  /** A Postgres regex, applied to the title and to nothing else. */
  pattern: string;
}

/**
 * Postgres and JavaScript disagree about how to write a word boundary -- \y
 * against \b -- and about nothing else in these patterns. One source, two
 * dialects, so the SQL and the tests can never describe different rules.
 */
const toJs = (pattern: string): RegExp => new RegExp(pattern.replace(/\\y/g, '\\b'), 'i');

export const MONEY: MoneyLens[] = [
  {
    value: 'cost',
    label: 'Costs money',
    blurb: 'Pricing, billing, free tiers, quotas and discounts.',
    // "Billing is now enabled for R2 SQL" is the shape this exists to catch: a
    // thing that was free is now not, announced in a changelog entry nobody
    // writes an article about.
    pattern: '(\\ypricing\\y|\\yprice\\y|price (cut|rise|increase|change)|\\yfree tier\\y'
      + '|\\ybilling\\y|\\ybilled\\y|\\ypaid plan\\y|\\ysubscription\\y|[0-9]+% off'
      + '|\\ydiscount\\y|\\ycheaper\\y|\\yquota\\y|\\yrate limit'
      + '|\\ysavings plan\\y|\\yreserved instance|\\yspot (price|instance)'
      + '|\\ycredits\\y|\\yper (month|seat|user|request|token)\\y)',
  },
  {
    value: 'licence',
    label: 'Licence changed',
    blurb: 'Relicensing, source-available moves, trademark and terms.',
    // The class that decides whether you may keep using a thing commercially,
    // and the one whose cost arrives years later.
    pattern: '(licen[cs]e|licen[cs]ing|relicen[cs]|\\yBUSL\\y|\\yBSL\\y|\\ySSPL\\y|\\yAGPL\\y'
      + '|\\yELv2\\y|source[- ]available|\\yopen[- ]core\\y|\\ytrademark\\y'
      + '|terms of service|\\yToS\\y|\\yCLA\\y)',
  },
  {
    value: 'eol',
    label: 'Ends or retires',
    blurb: 'End of life, sunsets, shutdowns, retirements and deprecations.',
    // A migration you have not budgeted for is the most expensive thing in this
    // archive, and it is always announced in advance by the vendor.
    pattern: '(end[- ]of[- ]life|end of support|\\yEOL\\y|\\ysunset|\\yshut(ting)? down\\y'
      + '|\\yshutdown\\y|discontinu|\\yretirement\\y|\\yretiring\\y|will be retired'
      + '|\\ydeprecat|no longer (supported|available|maintained)|\\yarchived\\y'
      // "ends" on its own is a verb half of English uses. Anchored to the thing
      // that is ending, or to the date it ends on, it is the plainest way a
      // vendor says this: "Heroku free tier ends in November".
      + '|(free tier|support|maintenance|service|plan)s? (ends|ending)'
      + '|\\yends (on|in)\\y)',
  },
];

const COMPILED = MONEY.map((m) => ({ value: m.value, re: toJs(m.pattern) }));

/**
 * Which money lenses a title falls under, in MONEY order.
 *
 * A title can be in more than one and often is: "Heroku free tier ends in
 * November" is both a cost and an end of life, and forcing a single answer
 * would make the two lists lie about each other.
 */
export function moneyClasses(title: string): string[] {
  const head = title.trim();
  if (!head) return [];
  return COMPILED.filter((m) => m.re.test(head)).map((m) => m.value);
}

/** The SQL for one lens, against whatever expression holds the title. */
export function moneySql(value: string, titleExpr: string): string | null {
  const lens = MONEY.find((m) => m.value === value);
  return lens ? `${titleExpr} ~* '${lens.pattern}'` : null;
}

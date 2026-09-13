// A report is about the market. It is never about its own sources.
//
// Asked for on 2026-09-13, quoting a paragraph from a stored reading: "Thirty
// developer-community sources were added to this registry today, so today's
// corpus is drawn from a wider set of publishers than the earlier one ...
// These are unnecessary content in report, You have to say about new market
// and market change in report, not source of report."
//
// Every sentence of that kind was put there on purpose. The prompts asked for
// a `limits` paragraph, the pages printed "this is a reading of 44 publishers",
// and the readings themselves opened with "the 382 stories from 49 publishers,
// 56% from three vendors". Each was defensible as honesty about the evidence,
// and together they made a report that spent a fifth of its words describing
// the feed list to a reader who wanted to know where the work is. Provenance
// already lives in the citations under every claim; the prose does not repeat
// it.
//
// TWO PASSES, BECAUSE THERE ARE TWO KINDS OF SENTENCE.
//
//   passing     "the agent announcements in this archive were claims about
//               intelligence" -- a market sentence with a phrase about the
//               archive in it. The phrase goes and the sentence stays.
//   about us    "Every one of today's eleven stories is first-party" -- the
//               whole sentence is about the evidence. It goes.
//
// Biased toward keeping text, like `nearlySame`: every pattern below names the
// archive, the corpus or the sampling explicitly. "package registry", "customer
// stories", "open-source" and "independent audit" are market words and survive.

/** Phrases that mention the archive inside a sentence about the market. */
const PASSING: [RegExp, string][] = [
  [/\s+with independent coverage of (?:the|its) (?:launch|release|announcement)\b/gi, ''],
  [/\s+(?:and\s+)?(?:earlier\s+)?(?:in|from|across)\s+(?:this|the|our)\s+(?:archive|corpus)\b/gi, ''],
  [/\s+(?:that\s+)?this archive (?:caught|held|holds|tracks)\b/gi, ''],
  [/\s+in today['’]s (?:set|archive)\b/gi, ''],
  // "On 2026-09-09, independent publisher LWN.net reported that ..."
  [/\bindependent publisher\s+/gi, ''],
  // "Earlier archive coverage focused heavily on ..."
  [/\bEarlier archive coverage\b/g, 'Earlier the market'],
  [/\bthis reading\b/gi, 'this claim'],
  // "InfoQ — the only independent source in today's set — reports that ..."
  [/\s*[—–]\s*the (?:only|one) independent source\s*[—–]\s*/gi, ' '],
  [/\bthe (?:only|one) independent source reports\b/gi, 'reports say'],
  // "..., according to a first-party announcement on Hacker News." The comma
  // is required: at the start of a sentence this is a lead-in, handled below,
  // and removing it here would glue the claim onto the previous full stop.
  [/,\s+according to (?:a|the) (?:first-party|independent)[^.,;:]*/gi, ''],
  // "an absolute claim about one library, and one of the few pieces of
  // independent coverage in this field" -- the claim stays, the aside goes.
  [/,?\s*(?:and\s+)?one of the few pieces of independent coverage(?: in this field)?/gi, ''],
];

/**
 * A lead-in that attributes the rest of the sentence to a kind of source.
 *
 * "The first-party announcement states that the model provides deeper
 * reasoning" is a sentence about the model with six words about the evidence
 * in front of it. The words go and the claim is capitalised, rather than the
 * whole sentence being dropped for its opening.
 */
const LEAD_IN = new RegExp(
  '^(?:according to (?:a|the) (?:first-party|independent) [^,]{0,60},\\s*'
  + '|(?:the|this|a) (?:independent source|first-party (?:announcement|blog post|post|article'
  + '|documentation|project description|account|report|release))'
  // "describes" and "details" only with "that": "The first-party article
  // describes the implementation" has no claim after the lead-in, so it is
  // left whole for ABOUT_US to drop rather than cut into a fragment.
  + '\\s+(?:(?:states|reports|reported|notes|explains|says)(?:\\s+that)?|(?:describes|details)\\s+that)\\s+'
  + '|first-party documentation (?:notes|states|says)(?:\\s+that)?\\s+)',
  'i');

function withoutLeadIn(sentence: string): string {
  const stripped = sentence.replace(LEAD_IN, '');
  if (stripped === sentence || stripped === '') return sentence;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** A sentence that is about the evidence rather than the market. */
const ABOUT_US: RegExp[] = [
  /\barchive['’]s\b/i,
  /\b(?:this|the|our) archive\b/i,
  /\bcorpus\b/i,
  /\bfirst-party\b(?!\s+(?:analytics|cookies?|data|apps?|integrations?|support|sdks?|packages?|tools?))/i,
  /\bindependent (?:source|sources|coverage|outlets?|telemetry)\b/i,
  /\b(?:stories|posts|items) from (?:only )?\d+\b/i,
  /\b\d+ publishers\b/i,
  /\b(?:capped|diversified)(?:,\s*diversified)? sample\b/i,
  // Not "the data-source list" in a Grafana upgrade report.
  /(?<![-\w])source list\b/i,
  /\b(?:developer-community|new) sources\b/i,
  /\bsources? (?:were|was) added\b/i,
  /\bcitations?\b/i,
  /\bthis (?:page|report|briefing)\b/i,
  /\b(?:these|today['’]s) stories\b/i,
  /\bthe text does not say\b/i,
  /\b(?:evidence|analysis) (?:is |was )?(?:heavily |primarily |entirely )?(?:weighted|drawn|relies|rests)\b/i,
];

/** True when a single sentence is about the sources rather than the market. */
export function isAboutTheSources(sentence: string): boolean {
  return ABOUT_US.some((re) => re.test(sentence));
}

/**
 * The text with every sentence about its own sources removed.
 *
 * Paragraph breaks are kept, because briefing bodies are split on them.
 */
export function aboutTheMarket(text: string): string {
  const src = String(text ?? '');
  if (src.trim() === '') return '';
  return src.split(/\n{2,}/).map((para) => {
    let p = para;
    for (const [re, to] of PASSING) p = p.replace(re, to);
    return p
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘(])/)
      .map(withoutLeadIn)
      .filter((s) => !isAboutTheSources(s))
      .join(' ')
      .trim();
  }).filter(Boolean).join('\n\n');
}

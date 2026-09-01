// Language detection, gated to {en, ja, de, zh}.
//
// Detection is per ITEM, never per source. German sites publish English posts,
// Japanese engineering blogs publish English release notes, and a source-level
// language assumption gets both wrong in the same week.
//
// Script analysis settles JA and ZH almost for free: kana are exclusive to
// Japanese, so Han text without kana is Chinese. Only the Latin case needs
// stopword scoring, and there the job is narrower than it looks -- it is not
// "which of 100 languages", it is "English, German, or drop it".

export type DetectedLang = 'en' | 'ja' | 'de' | 'zh';
export type LangResult = { lang: DetectedLang | 'other'; confidence: number };

const HIRAGANA = /[\u3040-\u309F]/g;
const KATAKANA = /[\u30A0-\u30FF]/g;
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
const HANGUL = /[\uAC00-\uD7AF\u1100-\u11FF]/g;
const CYRILLIC = /[\u0400-\u04FF]/g;
const ARABIC = /[\u0600-\u06FF]/g;
const DEVANAGARI = /[\u0900-\u097F]/g;
const THAI = /[\u0E00-\u0E7F]/g;
const GREEK = /[\u0370-\u03FF]/g;

const EN_STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'has', 'not',
  'are', 'was', 'were', 'you', 'your', 'but', 'they', 'their', 'which', 'when',
  'what', 'about', 'would', 'there', 'been', 'more', 'will', 'can', 'all',
  'into', 'than', 'them', 'these', 'some', 'also', 'other', 'only', 'over',
]);

const DE_STOPWORDS = new Set([
  'der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'einen', 'einem',
  'mit', 'auf', 'für', 'von', 'den', 'dem', 'des', 'sich', 'auch', 'sind',
  'wird', 'werden', 'wurde', 'noch', 'nach', 'bei', 'aber', 'oder', 'wenn',
  'sie', 'man', 'kann', 'mehr', 'schon', 'durch', 'über', 'unter', 'wie',
]);

// Not target languages, but worth recognising so they are dropped confidently
// rather than mistaken for English by a low stopword count.
const OTHER_LATIN_STOPWORDS = new Set([
  'les', 'des', 'une', 'pour', 'dans', 'est', 'sur', 'avec', 'sont', 'plus',   // fr
  'que', 'los', 'las', 'por', 'para', 'con', 'una', 'como', 'este', 'pero',    // es
  'não', 'uma', 'são', 'mais', 'como', 'pelo',                                  // pt
  'che', 'per', 'con', 'del', 'sono', 'anche', 'come',                          // it
  'het', 'een', 'van', 'zijn', 'niet', 'voor', 'maar',                          // nl
  'och', 'att', 'som', 'för', 'inte', 'med',                                    // sv
]);

function countMatches(s: string, re: RegExp): number {
  const m = s.match(re);
  return m ? m.length : 0;
}

export function detectLanguage(text: string): LangResult {
  const sample = text.slice(0, 4000);
  if (!sample.trim()) return { lang: 'other', confidence: 0 };

  const len = sample.length;
  const kana = countMatches(sample, HIRAGANA) + countMatches(sample, KATAKANA);
  const han = countMatches(sample, HAN);
  const hangul = countMatches(sample, HANGUL);

  // Kana are exclusive to Japanese. Even a small proportion is decisive, because
  // Japanese technical writing is often majority Han and Latin by character count.
  if (kana / len > 0.02) {
    return { lang: 'ja', confidence: Math.min(1, 0.7 + (kana / len) * 3) };
  }
  if (han / len > 0.15) {
    return { lang: 'zh', confidence: Math.min(1, 0.7 + (han / len)) };
  }
  if (hangul / len > 0.05) return { lang: 'other', confidence: 0.9 };

  for (const re of [CYRILLIC, ARABIC, DEVANAGARI, THAI, GREEK]) {
    if (countMatches(sample, re) / len > 0.05) return { lang: 'other', confidence: 0.9 };
  }

  const words = sample
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length < 8) {
    // Too short to score honestly. Say so rather than guessing English.
    return { lang: 'en', confidence: 0.3 };
  }

  let en = 0, de = 0, other = 0;
  for (const w of words) {
    if (EN_STOPWORDS.has(w)) en++;
    if (DE_STOPWORDS.has(w)) de++;
    if (OTHER_LATIN_STOPWORDS.has(w)) other++;
  }

  // German orthography is a strong independent signal on top of stopwords.
  const umlauts = countMatches(sample, /[\u00E4\u00F6\u00FC\u00DF\u00C4\u00D6\u00DC]/g);
  de += umlauts * 0.5;
  // Long compounds and capitalised nouns mid-sentence are German tells.
  const longCompounds = words.filter((w) => w.length > 14).length;
  de += longCompounds * 0.5;

  const total = en + de + other;
  if (total === 0) return { lang: 'en', confidence: 0.35 };

  if (other > en && other > de) return { lang: 'other', confidence: other / total };
  if (de > en) return { lang: 'de', confidence: Math.min(1, de / total) };
  return { lang: 'en', confidence: Math.min(1, en / total) };
}

/** The ingest gate: only these four survive (spec 2.3). */
export function passesLanguageGate(result: LangResult): result is { lang: DetectedLang; confidence: number } {
  return result.lang !== 'other';
}

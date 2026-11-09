// app/lib/singlishToSinhala.ts
/**
 * High-accuracy Singlish to Unicode Sinhala phonetic transliterator.
 * Converts English phonetic typing into Sinhala script in real-time.
 * E.g.: "ayahapath kalagunaya (wahi)" -> "අයහපත් කාලගුණය (වැසි)"
 */

// Common words dictionary for Sri Lankan official and everyday lottery phrases
const SINGLISH_WORD_MAP: Record<string, string> = {
  ayahapath: "අයහපත්",
  ayahaPath: "අයහපත්",
  kalagunaya: "කාලගුණය",
  kaalagunaya: "කාලගුණය",
  kaalaguna: "කාලගුණ",
  wahi: "වැසි",
  vahi: "වැසි",
  wasi: "වැසි",
  vasi: "වැසි",
  wassa: "වැස්ස",
  wessa: "වැස්ස",
  vassa: "වැස්ස",
  warshawa: "වර්ෂාව",
  warshaawa: "වර්ෂාව",
  adhika: "අධික",
  hethuwen: "හේතුවෙන්",
  hEthuwen: "හේතුවෙන්",
  hethuwa: "හේතුව",
  hethu: "හේතු",
  alavi: "අලෙවි",
  alawi: "අලෙවි",
  niyojithayin: "නියෝජිතයින්",
  niyojithayan: "නියෝජිතයන්",
  nopaminima: "නොපැමිණීම",
  nopæminima: "නොපැමිණීම",
  nopenimima: "නොපැමිණීම",
  nopamina: "නොපැමිණ",
  paminima: "පැමිණීම",
  nisa: "නිසා",
  nisA: "නිසා",
  prawahana: "ප්‍රවාහන",
  pravahana: "ප්‍රවාහන",
  apahasutha: "අපහසුතා",
  apahasuthaa: "අපහසුතා",
  marga: "මාර්ග",
  mArga: "මාර්ග",
  awahiratha: "අවහිරතා",
  awahirathaa: "අවහිරතා",
  hartal: "හර්තාල්",
  harathaal: "හර්තාල්",
  niwadu: "නිවාඩු",
  nivaadu: "නිවාඩු",
  gamwathura: "ගංවතුර",
  ganwathura: "ගංවතුර",
  nayayam: "නායයෑම්",
  nAyayAm: "නායයෑම්",
  thatwaya: "තත්ත්වය",
  thathwaya: "තත්ත්වය",
  sidhuwi: "සිදුවී",
  sidhuwima: "සිදුවීම",
  athara: "අතර",
  sahitha: "සහිත",
  pradesheye: "ප්‍රදේශයේ",
  pradeshaye: "ප්‍රදේශයේ",
  paminimata: "පැමිණීමට",
  nohaki: "නොහැකි",
  nohakiwiya: "නොහැකිවිය",
  karunakarala: "කරුණාකරලා",
  karunaakarala: "කරුණාකරලා",
  karunaawen: "කරුණාවෙන්",
  awashya: "අවශ්‍ය",
  nivedana: "නිවේදන",
  rathu: "රතු",
  andiri: "ඇඳිරි",
  neethiya: "නීතිය",
  curfew: "ඇඳිරි නීතිය",
  flood: "ගංවතුර",
  rain: "වැස්ස",
  heavy: "අධික",
};

const INDEP_VOWELS: [string, string][] = [
  ["aae", "ඈ"],
  ["a\\", "ඇ"],
  ["ae", "ඇ"],
  ["aa", "ආ"],
  ["A", "ආ"],
  ["a", "අ"],
  ["ii", "ඊ"],
  ["I", "ඊ"],
  ["i", "ඉ"],
  ["uu", "ඌ"],
  ["U", "ඌ"],
  ["u", "උ"],
  ["ee", "ඒ"],
  ["E", "ඒ"],
  ["ea", "ඒ"],
  ["e", "එ"],
  ["ai", "ඓ"],
  ["oo", "ඕ"],
  ["O", "ඕ"],
  ["o", "ඔ"],
  ["au", "ඖ"],
];

const DEP_VOWELS: [string, string][] = [
  ["aae", "\u0DD1"], // ෑ
  ["a\\", "\u0DD0"], // ැ
  ["ae", "\u0DD0"],  // ැ
  ["aa", "\u0DCF"],  // ා
  ["A", "\u0DCF"],   // ා
  ["ii", "\u0DD3"],  // ී
  ["I", "\u0DD3"],   // ී
  ["i", "\u0DD2"],   // ි
  ["uu", "\u0DD6"],  // ූ
  ["U", "\u0DD6"],   // ූ
  ["u", "\u0DD4"],   // ු
  ["ee", "\u0DD9\u0DCA"], // ේ
  ["E", "\u0DD9\u0DCA"],  // ේ
  ["ea", "\u0DD9\u0DCA"], // ේ
  ["e", "\u0DD9"],   // ෙ
  ["ai", "\u0DDB"],  // ෛ
  ["oo", "\u0DDC"],  // ෝ
  ["O", "\u0DDC"],   // ෝ
  ["o", "\u0DDA"],   // ො
  ["au", "\u0DDD"],  // ෞ
  ["a", ""],         // inherent vowel (removes hal kirima)
];

const CONSONANTS: [string, string][] = [
  ["n.g", "ඞ"],
  ["n.j", "ඤ"],
  ["nnd", "ඬ"],
  ["nd", "ඳ"],
  ["nb", "ඹ"],
  ["ng", "ඟ"],
  ["th", "ත"],
  ["Th", "ථ"],
  ["dh", "ද"],
  ["Dh", "ඪ"],
  ["kh", "ඛ"],
  ["Kh", "ඛ"],
  ["gh", "ඝ"],
  ["Gh", "ඝ"],
  ["ch", "ච"],
  ["Ch", "ඡ"],
  ["jh", "ඣ"],
  ["Jh", "ඣ"],
  ["sh", "ශ"],
  ["Sh", "ෂ"],
  ["ph", "ඵ"],
  ["bh", "භ"],
  ["Bh", "භ"],
  ["k", "ක"],
  ["K", "ඛ"],
  ["g", "ග"],
  ["G", "ඝ"],
  ["t", "ට"],
  ["T", "ඨ"],
  ["d", "ද"],
  ["D", "ඩ"],
  ["p", "ප"],
  ["P", "ඵ"],
  ["b", "බ"],
  ["B", "භ"],
  ["m", "ම"],
  ["y", "ය"],
  ["r", "ර"],
  ["l", "ල"],
  ["L", "ළ"],
  ["v", "ව"],
  ["w", "ව"],
  ["s", "ස"],
  ["S", "ශ"],
  ["h", "හ"],
  ["n", "න"],
  ["N", "ණ"],
  ["c", "ච"],
  ["C", "ඡ"],
  ["j", "ජ"],
  ["J", "ඣ"],
  ["f", "ෆ"],
  ["F", "ෆ"],
];

const HAL = "\u0DCA";
const ZWJ = "\u200D";

function parsePhoneticWord(word: string): string {
  let result = "";
  let i = 0;
  const n = word.length;

  while (i < n) {
    const sub = word.slice(i);

    // If at start of word or after vowel, check for independent vowel
    if (i === 0) {
      let matchedVowel = false;
      for (const [vKey, vChar] of INDEP_VOWELS) {
        if (sub.startsWith(vKey)) {
          result += vChar;
          i += vKey.length;
          matchedVowel = true;
          break;
        }
      }
      if (matchedVowel) continue;
    }

    // Try matching consonant
    let matchedConsonant = false;
    for (const [cKey, cBase] of CONSONANTS) {
      if (sub.startsWith(cKey)) {
        matchedConsonant = true;
        const cLen = cKey.length;
        const nextSub = word.slice(i + cLen);

        // Special conjunct: Rakaransaya (c + r + vowel, e.g. pr, kr, tr)
        if (nextSub.startsWith("r") && nextSub.length > 1 && !nextSub.startsWith("rr")) {
          const afterR = nextSub.slice(1);
          let hasVowelAfterR = false;
          let depVowel = "";
          let vLen = 0;
          for (const [vKey, vSign] of DEP_VOWELS) {
            if (afterR.startsWith(vKey)) {
              hasVowelAfterR = true;
              depVowel = vSign;
              vLen = vKey.length;
              break;
            }
          }
          if (hasVowelAfterR) {
            result += cBase + HAL + ZWJ + "ර" + depVowel;
            i += cLen + 1 + vLen;
            break;
          }
        }

        // Special conjunct: Yansaya (c + y + vowel, e.g. vy, ky)
        if (nextSub.startsWith("y") && nextSub.length > 1 && !nextSub.startsWith("yy")) {
          const afterY = nextSub.slice(1);
          let hasVowelAfterY = false;
          let depVowel = "";
          let vLen = 0;
          for (const [vKey, vSign] of DEP_VOWELS) {
            if (afterY.startsWith(vKey)) {
              hasVowelAfterY = true;
              depVowel = vSign;
              vLen = vKey.length;
              break;
            }
          }
          if (hasVowelAfterY) {
            result += cBase + HAL + ZWJ + "ය" + depVowel;
            i += cLen + 1 + vLen;
            break;
          }
        }

        // Check for dependent vowel attached to this consonant
        let matchedDepVowel = false;
        for (const [vKey, vSign] of DEP_VOWELS) {
          if (nextSub.startsWith(vKey)) {
            result += cBase + vSign;
            i += cLen + vKey.length;
            matchedDepVowel = true;
            break;
          }
        }

        // If no vowel followed, this consonant takes hal kirima ්
        if (!matchedDepVowel) {
          result += cBase + HAL;
          i += cLen;
        }

        break;
      }
    }

    if (matchedConsonant) continue;

    // Check independent vowel mid-word
    let matchedMidVowel = false;
    for (const [vKey, vChar] of INDEP_VOWELS) {
      if (sub.startsWith(vKey)) {
        result += vChar;
        i += vKey.length;
        matchedMidVowel = true;
        break;
      }
    }
    if (matchedMidVowel) continue;

    // Pass-through any other character (numbers, symbols, Sinhala characters)
    result += word[i];
    i++;
  }

  return result;
}

/**
 * Main function: Translates Singlish text (e.g. "ayahapath kalagunaya") to Sinhala script.
 * Preserves spaces, punctuation, Sinhala characters already typed, and numbers.
 */
export function singlishToSinhala(text: string): string {
  if (!text) return "";

  // Split into words and non-alphabetic tokens
  return text.replace(/[a-zA-Z\\`~]+|[^a-zA-Z\\`~]+/g, (token) => {
    if (!/^[a-zA-Z\\`~]+$/.test(token)) {
      return token;
    }

    // Check dictionary first (case-insensitive)
    const lower = token.toLowerCase();
    if (SINGLISH_WORD_MAP[lower]) {
      return SINGLISH_WORD_MAP[lower];
    }
    if (SINGLISH_WORD_MAP[token]) {
      return SINGLISH_WORD_MAP[token];
    }

    // Phonetic character parsing
    return parsePhoneticWord(token);
  });
}

/**
 * Common official return reasons in Sri Lanka lotteries for quick selection
 */
export const COMMON_RETURN_REASONS = [
  "අයහපත් කාලගුණය (අධික වර්ෂාව)",
  "අලෙවි නියෝජිතයින් නොපැමිණීම",
  "ප්‍රවාහන අපහසුතා සහ මාර්ග අවහිරතා",
  "ප්‍රදේශයේ ඇතිවූ විශේෂ හර්තාල් / නිවාඩු තත්ත්වය",
  "ගංවතුර සහ නායයෑම් ආපදා තත්ත්වය",
];

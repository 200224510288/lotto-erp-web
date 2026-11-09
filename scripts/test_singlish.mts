// Test script for Singlish to Sinhala transliteration
export function convertSinglishToSinhala(text: string): string {
  if (!text) return "";

  // Common phrase & word dictionary for high-accuracy phonetic typing
  const WORD_DICTIONARY: Record<string, string> = {
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
    alavi: "අලෙවි",
    alawi: "අලෙවි",
    niyojithayin: "නියෝජිතයින්",
    niyojithayan: "නියෝජිතයන්",
    nopaminima: "නොපැමිණීම",
    nopæminima: "නොපැමිණීම",
    nopenimima: "නොපැමිණීම",
    nopamina: "නොපැමිණ",
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
    athara: "අතර",
    sahitha: "සහිත",
    padeshe: "ප්‍රදේශයේ",
    pradesheye: "ප්‍රදේශයේ",
    pradeshaye: "ප්‍රදේශයේ",
    paminimata: "පැමිණීමට",
    nohaki: "නොහැකි",
    nohakiwiya: "නොහැකිවිය",
  };

  // Split into words, punctuation, spaces
  return text.replace(/[a-zA-Z\\`~]+|[^a-zA-Z\\`~]+/g, (token) => {
    // If not alphabetic, keep as-is
    if (!/^[a-zA-Z\\`~]+$/.test(token)) {
      return token;
    }

    // Check exact word dictionary match (case insensitive)
    const lower = token.toLowerCase();
    if (WORD_DICTIONARY[lower]) {
      return WORD_DICTIONARY[lower];
    }
    if (WORD_DICTIONARY[token]) {
      return WORD_DICTIONARY[token];
    }

    // Otherwise phonetically parse character by character
    return parsePhoneticWord(token);
  });
}

function parsePhoneticWord(word: string): string {
  let result = "";
  let i = 0;
  const n = word.length;

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

  while (i < n) {
    const sub = word.slice(i);

    // If at start of word or previous was resolved, check for independent vowel
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
        let cLen = cKey.length;
        let nextSub = word.slice(i + cLen);

        // Check for special conjuncts:
        // 1. Rakaransaya: c + r + vowel (e.g. pr, kr, tr)
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

        // 2. Yansaya: c + y + vowel (e.g. vy, ky)
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

        // If no vowel followed, this consonant is Hal (has hal kirima ්)
        if (!matchedDepVowel) {
          result += cBase + HAL;
          i += cLen;
        }

        break;
      }
    }

    if (matchedConsonant) continue;

    // If an independent vowel appears mid-word after another vowel or symbol
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

    // Unknown char: pass through
    result += word[i];
    i++;
  }

  return result;
}

// Run test
console.log("1. ayahapath kalagunaya (wahi) ->", convertSinglishToSinhala("ayahapath kalagunaya (wahi)"));
console.log("2. alavi niyojithayin nopaminima ->", convertSinglishToSinhala("alavi niyojithayin nopaminima"));
console.log("3. prawahana apahasutha ->", convertSinglishToSinhala("prawahana apahasutha"));
console.log("4. gamwathura saha nayayam ->", convertSinglishToSinhala("gamwathura saha nayayam"));
console.log("5. Custom word: karunaakarala ->", convertSinglishToSinhala("karunaakarala"));
console.log("6. Custom word: wessaa ->", convertSinglishToSinhala("wessaa"));


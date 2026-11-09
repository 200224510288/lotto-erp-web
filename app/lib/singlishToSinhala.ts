// app/lib/singlishToSinhala.ts
/**
 * High-accuracy Singlish to Unicode Sinhala real-time phonetic typing engine.
 * Converts English phonetic typing into Sinhala script character-by-character as you type.
 * Also supports word auto-correction on Space and full batch transliteration for pasted text.
 */

// 1. Base mapping for individual English characters to initial Sinhala letters with Hal-kirima
const baseMapping: Record<string, string> = {
  a: "අ",
  A: "ඇ",
  i: "ඉ",
  I: "ඊ",
  u: "උ",
  U: "ඌ",
  e: "එ",
  E: "ඒ",
  o: "ඔ",
  O: "ඕ",
  k: "ක්",
  K: "ක්",
  c: "ක්\u200C",
  C: "ක්\u200C",
  g: "ග්",
  G: "ග්",
  j: "ජ්",
  t: "ට්",
  d: "ද්",
  q: "ද්",
  n: "න්",
  p: "ප්",
  P: "ප්",
  b: "බ්",
  m: "ම්",
  M: "ම්",
  y: "ය්",
  Y: "ය්",
  r: "ර්",
  l: "ල්",
  v: "ව්",
  V: "ව්",
  w: "ව්",
  W: "ව්",
  s: "ස්",
  h: "හ්",
  f: "ෆ්",
  F: "ෆ්",
  N: "ණ්",
  L: "ළ්",
  S: "ෂ්",
  J: "ඣ්",
  T: "ට්",
  D: "ඩ්",
  Q: "ධ්",
  B: "ඹ්",
  R: "ඍ",
  H: "ඃ",
  x: "ං",
  X: "ඞ",
  z: "z",
};

// 2. Keystroke State Transition Rules:
// When the cursor has text ending in `regex` and the user presses `char`, replace with `replace`
const stateRules: Array<{ regex: RegExp; char: string; replace: string }> = [
  // Rakaransaya + vowels (e.g. pr, kr, tr)
  { regex: /(.)්\u200Dර්$/, char: "u", replace: "$1ෘ" },
  { regex: /(.)්\u200Dර්$/, char: "a", replace: "$1්\u200Dර" },
  { regex: /(.)්\u200Dය්$/, char: "a", replace: "$1්\u200Dය" },

  // Long vowels & diphthongs extending previous vowel signs
  { regex: /(.)ැ$/, char: "a", replace: "$1ෑ" },
  { regex: /(.)ැ$/, char: "A", replace: "$1ෑ" },
  { regex: /(.)ි$/, char: "i", replace: "$1ී" },
  { regex: /(.)ු$/, char: "u", replace: "$1ූ" },
  { regex: /(.)ෙ$/, char: "e", replace: "$1ේ" },
  { regex: /(.)ෙ$/, char: "i", replace: "$1ෛ" },
  { regex: /(.)ො$/, char: "o", replace: "$1ෝ" },
  { regex: /(.)ො$/, char: "u", replace: "$1ෞ" },
  { regex: /(.)ා$/, char: "u", replace: "$1ෞ" },
  { regex: /(.)ෘ$/, char: "u", replace: "$1ෲ" },

  // Consonant digraph combinations with 'h'
  { regex: /ච්$/, char: "h", replace: "ඡ්" },
  { regex: /ත්$/, char: "h", replace: "ථ්" },
  { regex: /ද්$/, char: "h", replace: "ධ්" }, // d (ද්) + h -> ධ් (e.g. adhika -> අධික)
  { regex: /ඩ්$/, char: "h", replace: "ඪ්" },
  { regex: /ඬ්$/, char: "h", replace: "ඳ්" },
  { regex: /ට්$/, char: "h", replace: "ත්" }, // t (ට්) + h -> ත් (e.g. hethu -> හේතු)
  { regex: /ස්$/, char: "h", replace: "ශ්" }, // s (ස්) + h -> ශ්
  { regex: /ෂ්$/, char: "h", replace: "ෂ්" },
  { regex: /ක්\u200C$/, char: "h", replace: "ච්" }, // c + h -> ch (ච්)
  { regex: /ක්$/, char: "h", replace: "ඛ්" }, // k + h -> kh (ඛ්)
  { regex: /ප්$/, char: "h", replace: "ඵ්" }, // p + h -> ph (ඵ්)
  { regex: /බ්$/, char: "h", replace: "භ්" }, // b + h -> bh (භ්)
  { regex: /ග්$/, char: "h", replace: "ඝ්" }, // g + h -> gh (ඝ්)

  // Conjunct triggers (Rakaransaya & Yansaya)
  { regex: /(.)්$/, char: "r", replace: "$1්\u200Dර්" },
  { regex: /(.)්$/, char: "y", replace: "$1්\u200Dය්" },
  { regex: /ක්\u200C$/, char: "r", replace: "ක්\u200Dර්" },
  { regex: /ක්\u200C$/, char: "y", replace: "ක්\u200Dය්" },

  // Special nasal combinations
  { regex: /z$/, char: "g", replace: "ඟ්" },
  { regex: /z$/, char: "j", replace: "ඦ්" },
  { regex: /z$/, char: "d", replace: "ඬ්" },
  { regex: /z$/, char: "h", replace: "ඥ්" },
  { regex: /z$/, char: "k", replace: "ඤ්" },
  { regex: /z$/, char: "n", replace: "ං" },
  { regex: /ළ්$/, char: "u", replace: "ඏ" },

  // Independent vowel extensions (when typing vowels at the start of a word or standalone)
  { regex: /අ$/, char: "a", replace: "ආ" },
  { regex: /අ$/, char: "i", replace: "ඓ" },
  { regex: /අ$/, char: "u", replace: "ඖ" },
  { regex: /ඇ$/, char: "a", replace: "ඈ" },
  { regex: /ඇ$/, char: "A", replace: "ඈ" },
  { regex: /ඉ$/, char: "i", replace: "ඊ" },
  { regex: /උ$/, char: "u", replace: "ඌ" },
  { regex: /එ$/, char: "e", replace: "ඒ" },
  { regex: /එ$/, char: "i", replace: "ඓ" },
  { regex: /ඔ$/, char: "o", replace: "ඕ" },
  { regex: /ඔ$/, char: "u", replace: "ඖ" },
  { regex: /ඍ$/, char: "u", replace: "ඎ" },

  // Dependent vowel sign attachments to consonants with Hal-kirima
  { regex: /(.)්$/, char: "a", replace: "$1" }, // Removes hal-kirima: e.g. ක් + a -> ක
  { regex: /ක්\u200C$/, char: "a", replace: "ක" },
  { regex: /([\u0D9A-\u0DC6])$/, char: "a", replace: "$1ා" }, // Second 'a' extends: e.g. ක + a -> කා (aa)
  { regex: /([\u0D9A-\u0DC6])$/, char: "i", replace: "$1ෛ" }, // e.g. ක + i -> කෛ (ai)
  { regex: /([\u0D9A-\u0DC6])$/, char: "u", replace: "$1ෞ" }, // e.g. ක + u -> කෞ (au)
  { regex: /(.)්$/, char: "A", replace: "$1ැ" },
  { regex: /ක්\u200C$/, char: "A", replace: "කැ" },
  { regex: /(.)්$/, char: "i", replace: "$1ි" },
  { regex: /ක්\u200C$/, char: "i", replace: "කි" },
  { regex: /(.)්$/, char: "u", replace: "$1ු" },
  { regex: /ක්\u200C$/, char: "u", replace: "කු" },
  { regex: /(.)්$/, char: "e", replace: "$1ෙ" },
  { regex: /ක්\u200C$/, char: "e", replace: "කෙ" },
  { regex: /(.)්$/, char: "o", replace: "$1ො" },
  { regex: /ක්\u200C$/, char: "o", replace: "කො" },
];

/**
 * Common phonetic word corrections on Space/Word Boundary.
 * When a user types a word with informal or short vowels (e.g. 'kalagunaya', 'wahi', 'wassa'),
 * pressing Space automatically upgrades it to formal, grammatically accurate Sinhala script.
 */
export const SINHALA_WORD_CORRECTIONS: Record<string, string> = {
  // Weather & Calamities
  කලගුනය: "කාලගුණය",
  කාලගුනය: "කාලගුණය",
  කලගුනයා: "කාලගුණය",
  වහි: "වැසි",
  වසි: "වැසි",
  වස්ස: "වැස්ස",
  වර්ශව: "වර්ෂාව",
  වර්ශාව: "වර්ෂාව",
  අදික: "අධික",
  ගම්වතුර: "ගංවතුර",
  ගන්වතුර: "ගංවතුර",
  නයයම්: "නායයෑම්",
  නායයම්: "නායයෑම්",

  // Reasons & Conditions
  හෙතුවෙන්: "හේතුවෙන්",
  හේතුවෙන්: "හේතුවෙන්",
  හෙතුව: "හේතුව",
  හෙතු: "හේතු",
  හේතු: "හේතු",
  නිස: "නිසා",
  තත්ව්‍ය: "තත්ත්වය",
  තත්වය: "තත්ත්වය",
  තත්වෙ: "තත්ත්වය",
  සිධුවිම: "සිදුවීම",
  සිදුවිම: "සිදුවීම",
  සිධුවීම: "සිදුවීම",

  // Transport & Roads
  ප්‍රවහන: "ප්‍රවාහන",
  ප්‍රවාහන: "ප්‍රවාහන",
  මර්ග: "මාර්ග",
  මාර්ග: "මාර්ග",
  අපහසුත: "අපහසුතා",
  අපහසුතා: "අපහසුතා",
  අවහිරත: "අවහිරතා",
  අවහිරතා: "අවහිරතා",

  // Agents & Attendance
  අලවි: "අලෙවි",
  අලෙවි: "අලෙවි",
  නියොජිතයින්: "නියෝජිතයින්",
  නියෝජිතයින්: "නියෝජිතයින්",
  නියෝජිතයන්: "නියෝජිතයින්",
  නොපමිනිම: "නොපැමිණීම",
  නොපැමිනිම: "නොපැමිණීම",
  නොපැමිණිම: "නොපැමිණීම",
  නොපැමිණීම: "නොපැමිණීම",
  පැමිනිම: "පැමිණීම",
  පැමිණිම: "පැමිණීම",
  නොපමින: "නොපැමිණ",
  නොපැමින: "නොපැමිණ",

  // Holidays & Strikes
  නිවඩු: "නිවාඩු",
  නිවාඩු: "නිවාඩු",
  හර්තල්: "හර්තාල්",
  හර්තාල්: "හර්තාල්",
  ප්‍රදෙශයෙ: "ප්‍රදේශයේ",
  ප්‍රදේශයෙ: "ප්‍රදේශයේ",
  ප්‍රඩෙශෙයෙ: "ප්‍රදේශයේ",
  ඇඳිරි: "ඇඳිරි",
  නීතිය: "නීතිය",

  // Courtesies
  කරුනාවෙන්: "කරුණාවෙන්",
  කරුනාවෙන්ද: "කරුණාවෙන්",
  කරුණාවෙන්: "කරුණාවෙන්",
  ඉල්ලමි: "ඉල්ලමි",
  සලකබල: "සලකා බලා",
  කොමිස්: "කොමිස්",
};

/**
 * Process a single keystroke phonetically against current preceding text.
 */
export function processKeystroke(currentText: string, char: string): string {
  for (const rule of stateRules) {
    if (rule.regex.test(currentText) && rule.char === char) {
      return currentText.replace(rule.regex, rule.replace);
    }
  }
  const mapped = baseMapping[char] || char;
  return currentText + mapped;
}

/**
 * Handle input keystroke including Space and punctuation auto-correction.
 */
export function handleInputKeystroke(
  textBefore: string,
  key: string
): { transformedBefore: string } {
  if (key === " " || key === "," || key === "." || key === ")" || key === "(" || key === "-" || key === "/" || key === "Enter") {
    // Check preceding word token for auto-correction
    const tokens = textBefore.split(/([ \t,.)(\n\-/]+)/);
    for (let idx = tokens.length - 1; idx >= 0; idx--) {
      const token = tokens[idx];
      if (token && !/^[ \t,.)(\n\-/]+$/.test(token)) {
        if (SINHALA_WORD_CORRECTIONS[token]) {
          tokens[idx] = SINHALA_WORD_CORRECTIONS[token];
        }
        break;
      }
    }
    const joined = tokens.join("");
    return { transformedBefore: joined + (key === "Enter" ? "" : key) };
  }

  return { transformedBefore: processKeystroke(textBefore, key) };
}

// English Singlish Word Map for pasted text or batch conversion
export const SINGLISH_WORD_MAP: Record<string, string> = {
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
  niyojithayan: "නියෝජිතයින්",
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
  rathu: "රතු",
  andiri: "ඇඳිරි",
  neethiya: "නීතිය",
  curfew: "ඇඳිරි නීතිය",
  flood: "ගංවතුර",
  rain: "වැස්ස",
  heavy: "අධික",
};

/**
 * Translates an entire string or pasted text from Singlish to Sinhala script.
 */
export function singlishToSinhala(text: string): string {
  if (!text) return "";

  // Split into words and tokens
  return text.replace(/[a-zA-Z\\`~]+|[^a-zA-Z\\`~]+/g, (token) => {
    if (!/^[a-zA-Z\\`~]+$/.test(token)) {
      return token;
    }

    const lower = token.toLowerCase();
    if (SINGLISH_WORD_MAP[lower]) {
      return SINGLISH_WORD_MAP[lower];
    }
    if (SINGLISH_WORD_MAP[token]) {
      return SINGLISH_WORD_MAP[token];
    }

    // Convert character-by-character using the phonetic state engine
    let converted = "";
    for (const ch of token) {
      converted = processKeystroke(converted, ch);
    }

    // Check if the resulting Sinhala word has an auto-correction
    if (SINHALA_WORD_CORRECTIONS[converted]) {
      return SINHALA_WORD_CORRECTIONS[converted];
    }

    return converted;
  });
}

/**
 * Quick preset return reasons for 1-click insertion
 */
export const COMMON_RETURN_REASONS = [
  "අයහපත් කාලගුණය (අධික වර්ෂාව)",
  "අලෙවි නියෝජිතයින් නොපැමිණීම",
  "ප්‍රවාහන අපහසුතා සහ මාර්ග අවහිරතා",
  "ප්‍රදේශයේ ඇතිවූ විශේෂ හර්තාල් / නිවාඩු තත්ත්වය",
  "ගංවතුර සහ නායයෑම් ආපදා තත්ත්වය",
];

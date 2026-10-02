import {
  ERP_GAME_MAP,
  OFFICIAL_GAMES,
  detectERPCodeFromFileNameAnyDay,
  suggestGameFromFileName,
} from "../app/lib/gameAutoSelect";

console.log("Testing Wasi ERP Code Detection and Suggestion:");
const tests = [
  { file: "WM_file.xlsx", date: "2026-10-05", expectedErp: "WM", expectedOfficial: "WMO" }, // Monday
  { file: "WA_file.xlsx", date: "2026-10-06", expectedErp: "WA", expectedOfficial: "WTU" }, // Tuesday
  { file: "WW_file.xlsx", date: "2026-10-07", expectedErp: "WW", expectedOfficial: "WWD" }, // Wednesday
  { file: "WT_file.xlsx", date: "2026-10-08", expectedErp: "WT", expectedOfficial: "WTH" }, // Thursday
  { file: "WF_file.xlsx", date: "2026-10-09", expectedErp: "WF", expectedOfficial: "WFR" }, // Friday
  { file: "WS_file.xlsx", date: "2026-10-10", expectedErp: "WS", expectedOfficial: "WSA" }, // Saturday
  { file: "WI_file.xlsx", date: "2026-10-11", expectedErp: "WI", expectedOfficial: "WSU" }, // Sunday
  // Regression check: Ensure 3-letter codes containing W are NOT shadowed
  { file: "LWM_file.xlsx", date: "2026-10-05", expectedErp: "LWM", expectedOfficial: "LMO" },
  { file: "LWA_file.xlsx", date: "2026-10-06", expectedErp: "LWA", expectedOfficial: "LWT" },
  { file: "LWW_file.xlsx", date: "2026-10-07", expectedErp: "LWW", expectedOfficial: "LWW" },
  { file: "LWF_file.xlsx", date: "2026-10-09", expectedErp: "LWF", expectedOfficial: "LWF" },
  { file: "LWS_file.xlsx", date: "2026-10-10", expectedErp: "LWS", expectedOfficial: "LSA" },
  { file: "LWI_file.xlsx", date: "2026-10-11", expectedErp: "LWI", expectedOfficial: "LWS" },
];

for (const t of tests) {
  const detected = detectERPCodeFromFileNameAnyDay(t.file);
  const suggestion = suggestGameFromFileName(t.file, t.date);
  if (detected !== t.expectedErp) {
    throw new Error(`Failed detection for ${t.file}: expected ${t.expectedErp}, got ${detected}`);
  }
  if (suggestion.status !== "ok" || suggestion.official !== t.expectedOfficial) {
    throw new Error(`Failed suggestion for ${t.file}: expected ${t.expectedOfficial}, got ${JSON.stringify(suggestion)}`);
  }
  console.log(`✓ PASS: ${t.file} (${t.date}) -> ERP: ${detected} -> Official: ${suggestion.official}`);
}

const wasiOfficial = ["WMO", "WTU", "WWD", "WTH", "WFR", "WSA", "WSU"];
for (const code of wasiOfficial) {
  if (!OFFICIAL_GAMES.some((g) => g.id === code)) {
    throw new Error(`Missing ${code} from OFFICIAL_GAMES`);
  }
  console.log(`✓ PASS: ${code} is in OFFICIAL_GAMES list`);
}
console.log("ALL WASI LOTTERY TESTS PASSED!");

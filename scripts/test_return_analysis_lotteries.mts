import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";
import {
  OFFICIAL_SINHALA_LOTTERIES,
  detectLotteryFromMetadata,
  parseReturnSheetDetailed,
  toSinhalaDistrict,
  toSinhalaAgentName,
  toSinhalaReason,
} from "../app/return-analysis/page";

console.log("=== 1. VERIFY 9 OFFICIAL LOTTERIES LIST ===");
const expectedLotteries = [
  "අද කෝටිපති",
  "කප්රුක",
  "ලග්න",
  "සසිරි",
  "ශනිදා",
  "සුපර් බෝල්",
  "සුපිරි ධන සම්පත",
  "ජය සම්පත",
  "වාසි",
];

for (let i = 0; i < expectedLotteries.length; i++) {
  if (OFFICIAL_SINHALA_LOTTERIES[i] !== expectedLotteries[i]) {
    throw new Error(`Lottery index ${i} mismatch: expected ${expectedLotteries[i]}, got ${OFFICIAL_SINHALA_LOTTERIES[i]}`);
  }
}
console.log("✓ PASS: All 9 official Sinhala lotteries match exact required order and names.");

console.log("\n=== 2. VERIFY LOTTERY DETECTION FROM VARIOUS CODES & NAMES ===");
const detectionCases = [
  // 1. Ada Kotipathi
  { input: { fileName: "AMO.xlsx" }, expected: "අද කෝටිපති" },
  { input: { gameName: "Ada Kotipathi Fortune" }, expected: "අද කෝටිපති" },
  { input: { gameId: "AKM" }, expected: "අද කෝටිපති" },
  { input: { gameName: "අද කෝටිපති" }, expected: "අද කෝටිපති" },

  // 2. Kapruka
  { input: { fileName: "KPM_file.xlsx" }, expected: "කප්රුක" },
  { input: { gameName: "Koti Kapruka" }, expected: "කප්රුක" },
  { input: { gameId: "KTT" }, expected: "කප්රුක" },

  // 3. Lagna
  { input: { fileName: "LMO.xlsx" }, expected: "ලග්න" },
  { input: { gameName: "Lagna Wasana" }, expected: "ලග්න" },
  { input: { gameId: "LWM" }, expected: "ලග්න" },

  // 4. Sasiri / Jayoda
  { input: { fileName: "JMO.xlsx" }, expected: "සසිරි" },
  { input: { gameName: "Sasiri" }, expected: "සසිරි" },
  { input: { gameName: "Jayoda Fortune" }, expected: "සසිරි" },

  // 5. Shanida
  { input: { fileName: "SFM.xlsx" }, expected: "ශනිදා" },
  { input: { gameName: "Shanida Fortune" }, expected: "ශනිදා" },
  { input: { gameId: "SFT" }, expected: "ශනිදා" },

  // 6. Super Ball
  { input: { fileName: "SBM.xlsx" }, expected: "සුපර් බෝල්" },
  { input: { gameName: "Super Ball" }, expected: "සුපර් බෝල්" },
  { input: { gameId: "BTU" }, expected: "සුපර් බෝල්" },

  // 7. Supiri Dhana Sampatha
  { input: { fileName: "SRM.xlsx" }, expected: "සුපිරි ධන සම්පත" },
  { input: { gameName: "Development Fortune" }, expected: "සුපිරි ධන සම්පත" },
  { input: { gameName: "Supiri Dhana Sampatha" }, expected: "සුපිරි ධන සම්පත" },
  { input: { gameId: "SPM" }, expected: "සුපිරි ධන සම්පත" },

  // 8. Jaya Sampatha
  { input: { fileName: "Jaya_Sampatha_Fri.xlsx" }, expected: "ජය සම්පත" },
  { input: { gameName: "Jaya Sampatha" }, expected: "ජය සම්පත" },
  { input: { gameId: "JS" }, expected: "ජය සම්පත" },

  // 9. Vasi / Dhana Nidhanaya
  { input: { fileName: "WMO.xlsx" }, expected: "වාසි" },
  { input: { fileName: "DMO.xlsx" }, expected: "වාසි" },
  { input: { gameName: "Wasi" }, expected: "වාසි" },
  { input: { gameName: "Dhana Nidhanaya" }, expected: "වාසි" },
  { input: { gameId: "VM" }, expected: "වාසි" },
];

for (const c of detectionCases) {
  const detected = detectLotteryFromMetadata(c.input);
  if (detected !== c.expected) {
    throw new Error(`Failed detection for ${JSON.stringify(c.input)}: expected "${c.expected}", got "${detected}"`);
  }
}
console.log(`✓ PASS: All ${detectionCases.length} detection tests succeeded!`);

console.log("\n=== 3. TEST PARSING ON SAMPLE RETURN EXCEL FILES ===");
const sampleDir = path.resolve("./sample_files");

// Test V1.xlsx
const v1Path = path.join(sampleDir, "V1.xlsx");
const v1Buf = fs.readFileSync(v1Path);
const v1Wb = XLSX.read(v1Buf, { type: "buffer" });
const v1Data = XLSX.utils.sheet_to_json(v1Wb.Sheets[v1Wb.SheetNames[0]], { header: 1 }) as any[][];
const v1Res = parseReturnSheetDetailed(v1Data, { fileName: "V1.xlsx" });

console.log("V1.xlsx result:", {
  lottery: v1Res.lottery,
  distributorCode: v1Res.distributorCode,
  distributorName: v1Res.distributorName,
  district: v1Res.district,
  totalQty: v1Res.totalQty,
  agentRowsCount: v1Res.agentReturns.length,
});

if (v1Res.lottery !== "ජය සම්පත") {
  throw new Error(`V1.xlsx expected lottery "ජය සම්පත", got "${v1Res.lottery}"`);
}
if (v1Res.distributorCode !== "030409") {
  throw new Error(`V1.xlsx expected distributorCode "030409", got "${v1Res.distributorCode}"`);
}
if (v1Res.totalQty !== 23) {
  throw new Error(`V1.xlsx expected totalQty 23, got ${v1Res.totalQty}`);
}
console.log("✓ PASS: V1.xlsx correctly parsed as Jaya Sampatha returns for distributor 030409 (Qty: 23).");

// Test raw ecel 2(1).xls
const rawPath = path.join(sampleDir, "raw ecel 2(1).xls");
const rawBuf = fs.readFileSync(rawPath);
const rawWb = XLSX.read(rawBuf, { type: "buffer" });
const rawData = XLSX.utils.sheet_to_json(rawWb.Sheets[rawWb.SheetNames[0]], { header: 1 }) as any[][];
const rawRes = parseReturnSheetDetailed(rawData, { fileName: "raw ecel 2(1).xls" });

console.log("raw ecel 2(1).xls result:", {
  lottery: rawRes.lottery,
  distributorCode: rawRes.distributorCode,
  district: rawRes.district,
  totalQty: rawRes.totalQty,
  agentRowsCount: rawRes.agentReturns.length,
});

if (rawRes.lottery !== "කප්රුක") {
  throw new Error(`raw ecel expected lottery "කප්රුක", got "${rawRes.lottery}"`);
}
if (rawRes.distributorCode !== "030409") {
  throw new Error(`raw ecel expected distributorCode "030409", got "${rawRes.distributorCode}"`);
}
if (rawRes.district !== "KANDY") {
  throw new Error(`raw ecel expected district "KANDY", got "${rawRes.district}"`);
}
console.log("✓ PASS: raw ecel 2(1).xls correctly parsed as Kapruka returns for distributor 030409 (Kandy).");

console.log("\n=== 4. TEST SINHALA TRANSLATION HELPERS ===");
if (toSinhalaDistrict("KANDY") !== "මහනුවර") throw new Error("toSinhalaDistrict Kandy failed");
if (toSinhalaDistrict("COLOMBO") !== "කොළඹ") throw new Error("toSinhalaDistrict Colombo failed");
if (toSinhalaAgentName("S.W OSMAN DE SILVA", "030409") !== "එස් ඩබ් ඕ සිල්වා") throw new Error("toSinhalaAgentName failed");
if (!toSinhalaReason("RAIN / AGENT(s) ABSENT").includes("වැසි")) throw new Error("toSinhalaReason failed");
console.log("✓ PASS: Sinhala translation helpers work properly.");

console.log("\n=======================================================");
console.log("=== ALL RETURN ANALYSIS LOTTERY TESTS PASSED! ✓✓✓ ===");
console.log("=======================================================");


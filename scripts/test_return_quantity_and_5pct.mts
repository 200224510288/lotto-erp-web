// scripts/test_return_quantity_and_5pct.mts
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { extractFileReturnQuantity } from "../app/returns/page";
import { getGameSafeReturnLimit, isSpecialTenPercentLottery } from "../app/lib/gameAutoSelect";

async function testReturnsAnd5Percent() {
  console.log("=================================================================");
  console.log("=== TEST SUITE: RETURN QUANTITY & SAFE LIMIT COMPLIANCE LOGIC ===");
  console.log("=================================================================\n");

  const sampleDir = path.resolve("./sample_files");
  const v1Path = path.join(sampleDir, "V1.xlsx");
  const raw2Path = path.join(sampleDir, "raw ecel 2(1).xls");

  // 1. Test V1.xlsx
  console.log("1. Testing V1.xlsx return quantity extraction...");
  const v1Buf = fs.readFileSync(v1Path);
  const v1Wb = XLSX.read(v1Buf, { type: "buffer" });
  const v1Cells = XLSX.utils.sheet_to_json(v1Wb.Sheets[v1Wb.SheetNames[0]], { header: 1 }) as any[][];
  const v1Qty = extractFileReturnQuantity(v1Cells);
  console.log(`   V1.xlsx detected return quantity: ${v1Qty} tickets`);
  if (v1Qty !== 23) {
    throw new Error(`Expected V1.xlsx return qty to be 23, got ${v1Qty}`);
  }
  console.log("   ✓ PASS: V1.xlsx return quantity matches exactly (23 tickets)\n");

  // 2. Test raw ecel 2(1).xls
  console.log("2. Testing raw ecel 2(1).xls return quantity extraction...");
  const raw2Buf = fs.readFileSync(raw2Path);
  const raw2Wb = XLSX.read(raw2Buf, { type: "buffer" });
  const raw2Cells = XLSX.utils.sheet_to_json(raw2Wb.Sheets[raw2Wb.SheetNames[0]], { header: 1 }) as any[][];
  const raw2Qty = extractFileReturnQuantity(raw2Cells);
  console.log(`   raw ecel 2(1).xls detected return quantity: ${raw2Qty} tickets`);
  if (raw2Qty !== 1491) {
    throw new Error(`Expected raw ecel 2(1).xls return qty to be 1491, got ${raw2Qty}`);
  }
  console.log("   ✓ PASS: raw ecel 2(1).xls return quantity matches exactly (1,491 tickets)\n");

  // 3. Test 10% Safe Return Limit Classification (Lagna, Super Ball, Kapruka vs others)
  console.log("3. Testing 10% Safe Return Limit rules (Lagna, Super Ball, Kapruka)...");
  const tenPercentGames = [
    "Lagna", "lagana", "ලග්න", "LMO", "LWT", "LWM", "LWA",
    "Super Ball", "superball", "සුපර් බෝල්", "SBM", "BTU", "SBS",
    "Kapruka", "kapruka", "කප්රුක", "KPM", "KPT", "KTM", "KOTI KAPRUKA-MONDAY",
  ];
  for (const g of tenPercentGames) {
    if (!isSpecialTenPercentLottery(g)) {
      throw new Error(`Expected ${g} to be recognized as 10% special return lottery!`);
    }
    const limit = getGameSafeReturnLimit(g);
    if (limit !== 10.0) {
      throw new Error(`Expected ${g} limit to be 10.0%, got ${limit}%`);
    }
  }
  console.log(`   ✓ PASS: Verified all 10% special allowance lotteries: ${tenPercentGames.length} test cases\n`);

  const fivePercentGames = [
    "Ada Kotipathi", "අද කෝටිපති", "AMO", "AKM",
    "Shanida", "ශනිදා", "SFM", "SFT",
    "Sasiri", "සසිරි", "JMO", "SM",
    "Supiri Dhana Sampatha", "සුපිරි ධන සම්පත", "SRM", "SPM",
    "Jaya Sampatha", "ජය සම්පත", "DMO", "VM",
    "Wasi", "වාසි", "WMO", "WM",
  ];
  for (const g of fivePercentGames) {
    if (isSpecialTenPercentLottery(g)) {
      throw new Error(`Expected ${g} to be standard 5% lottery, not 10%!`);
    }
    const limit = getGameSafeReturnLimit(g);
    if (limit !== 5.0) {
      throw new Error(`Expected ${g} limit to be 5.0%, got ${limit}%`);
    }
  }
  console.log(`   ✓ PASS: Verified standard 5% lotteries: ${fivePercentGames.length} test cases\n`);

  // 4. Test Kapruka Return Scenario with 10% limit
  console.log("4. Testing Kapruka Return File (raw ecel 2(1).xls) with 10% quota...");
  // raw ecel 2(1).xls is KOTI KAPRUKA-MONDAY with 1491 returns
  const kaprukaSales = 30000;
  const kaprukaLimit = getGameSafeReturnLimit("KOTI KAPRUKA-MONDAY");
  const kaprukaAllowed = kaprukaSales * (kaprukaLimit / 100); // 3,000 tickets
  const kaprukaReturnPct = (raw2Qty / kaprukaSales) * 100; // 4.97%
  const isKaprukaExceeded = raw2Qty > kaprukaAllowed; // false!
  const kaprukaSafeMargin = kaprukaAllowed - raw2Qty; // 3000 - 1491 = 1509 tickets

  console.log(`   Kapruka 1,491 returns on 30,000 sales:`);
  console.log(`     Return rate = ${kaprukaReturnPct.toFixed(2)}%`);
  console.log(`     Safe limit = ${kaprukaLimit}% (Allowed = ${kaprukaAllowed} tickets)`);
  console.log(`     Exceeded: ${isKaprukaExceeded}`);
  console.log(`     Safe margin = ${kaprukaSafeMargin} tickets`);
  if (kaprukaLimit !== 10.0 || isKaprukaExceeded || kaprukaSafeMargin !== 1509) {
    throw new Error(`Kapruka 10% compliance check failed!`);
  }
  console.log("   ✓ PASS: Kapruka correctly evaluated under 10% quota (1,509 tickets buffer remaining)\n");

  console.log("=================================================================");
  console.log("=== ALL RETURN QUANTITY & 10%/5% LIMIT TESTS PASSED! ✓✓✓ ===");
  console.log("=================================================================");
}

testReturnsAnd5Percent().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});


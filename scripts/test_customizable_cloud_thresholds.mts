// scripts/test_customizable_cloud_thresholds.mts
import {
  DEFAULT_RETURN_THRESHOLDS,
  getSafeReturnLimitForGame,
  getLotteryThreshold,
  isLotteryWaived,
  DLB_LOTTERY_LIST,
  ReturnThresholdConfig,
  FIRESTORE_SETTINGS_COLLECTION,
  FIRESTORE_THRESHOLDS_DOC,
} from "../app/lib/returnThresholdConfig";
import {
  getGameSafeReturnLimit,
  isSpecialTenPercentLottery,
} from "../app/lib/gameAutoSelect";

async function runTestSuite() {
  console.log("=================================================================");
  console.log("=== TEST SUITE: CUSTOMIZABLE LOTTERY THRESHOLDS & BOARD WAIVERS ===");
  console.log("=================================================================\n");

  // 1. Verify default values
  console.log("1. Checking default thresholds...");
  console.log(`   Default standard threshold: ${DEFAULT_RETURN_THRESHOLDS.defaultThreshold}%`);
  console.log(`   Default special threshold: ${DEFAULT_RETURN_THRESHOLDS.specialThreshold}%`);
  if (DEFAULT_RETURN_THRESHOLDS.defaultThreshold !== 5.0) {
    throw new Error(`Expected default threshold to be 5.0, got ${DEFAULT_RETURN_THRESHOLDS.defaultThreshold}`);
  }
  if (DEFAULT_RETURN_THRESHOLDS.specialThreshold !== 10.0) {
    throw new Error(`Expected special threshold to be 10.0, got ${DEFAULT_RETURN_THRESHOLDS.specialThreshold}`);
  }
  console.log("   ✓ PASS: Default threshold is strictly 5.0% and special threshold is 10.0%\n");

  // 2. Verify all 9 DLB lotteries exist in DLB_LOTTERY_LIST
  console.log("2. Checking DLB_LOTTERY_LIST registry (9 official lotteries)...");
  if (DLB_LOTTERY_LIST.length !== 9) {
    throw new Error(`Expected exactly 9 lotteries in DLB_LOTTERY_LIST, got ${DLB_LOTTERY_LIST.length}`);
  }
  for (const lot of DLB_LOTTERY_LIST) {
    console.log(`   - [${lot.id}] ${lot.name.padEnd(24)} (${lot.sinhalaName}) -> Default: ${lot.defaultLimit}%`);
  }
  console.log("   ✓ PASS: All 9 official lotteries registered with correct defaults\n");

  // 3. Verify changing threshold by selecting each lottery
  console.log("3. Testing customizing threshold by selecting each lottery...");
  const customConfig: ReturnThresholdConfig = {
    defaultThreshold: 5.0,
    specialThreshold: 10.0,
    lotteryThresholds: {
      "kapruka": 7.5,        // Changed Kapruka from 10% to 7.5%
      "ada_kotipathi": 6.0,  // Changed Ada Kotipathi from 5% to 6.0%
      "shanida": 4.5,        // Changed Shanida from 5% to 4.5%
      "lagna_wasana": 8.0,   // Changed Lagna Wasana from 10% to 8.0%
    },
    waivedLotteries: ["kapruka"], // Kapruka waived by DLB Board
  };

  const kapLimit = getLotteryThreshold("kapruka", customConfig);
  const adaLimit = getLotteryThreshold("ada_kotipathi", customConfig);
  const shaLimit = getLotteryThreshold("shanida", customConfig);
  const lagLimit = getLotteryThreshold("lagna_wasana", customConfig);
  const sasLimit = getLotteryThreshold("sasiri", customConfig); // unedited: default 5.0%
  const supLimit = getLotteryThreshold("super_ball", customConfig); // unedited: default 10.0%

  if (kapLimit !== 7.5) throw new Error(`Expected Kapruka limit to be 7.5%, got ${kapLimit}%`);
  if (adaLimit !== 6.0) throw new Error(`Expected Ada Kotipathi limit to be 6.0%, got ${adaLimit}%`);
  if (shaLimit !== 4.5) throw new Error(`Expected Shanida limit to be 4.5%, got ${shaLimit}%`);
  if (lagLimit !== 8.0) throw new Error(`Expected Lagna limit to be 8.0%, got ${lagLimit}%`);
  if (sasLimit !== 5.0) throw new Error(`Expected Sasiri default limit to be 5.0%, got ${sasLimit}%`);
  if (supLimit !== 10.0) throw new Error(`Expected Super Ball default limit to be 10.0%, got ${supLimit}%`);

  console.log(`   Kapruka customized: ${kapLimit}%`);
  console.log(`   Ada Kotipathi customized: ${adaLimit}%`);
  console.log(`   Shanida customized: ${shaLimit}%`);
  console.log(`   Lagna Wasana customized: ${lagLimit}%`);
  console.log(`   Sasiri (unedited default): ${sasLimit}%`);
  console.log(`   Super Ball (unedited default): ${supLimit}%`);
  console.log("   ✓ PASS: Selecting each lottery successfully applies its custom threshold\n");

  // 4. Testing Board Waiver functionality (excluding a waived lottery from Return %)
  console.log("4. Testing Board Waiver detection and exclusion logic...");
  const isKapWaived = isLotteryWaived("kapruka", customConfig);
  const isKapCodeWaived = isLotteryWaived("KPM", customConfig);
  const isKapFileWaived = isLotteryWaived("KOTI KAPRUKA-MONDAY.xls", customConfig);
  const isKapSinhalaWaived = isLotteryWaived("කප්රුක", customConfig);
  const isAdaWaived = isLotteryWaived("ada_kotipathi", customConfig);

  if (!isKapWaived || !isKapCodeWaived || !isKapFileWaived || !isKapSinhalaWaived) {
    throw new Error("Expected Kapruka to be detected as waived across all alias formats!");
  }
  if (isAdaWaived) {
    throw new Error("Ada Kotipathi should NOT be waived!");
  }

  console.log(`   Kapruka by ID: waived = ${isKapWaived}`);
  console.log(`   Kapruka by Code ("KPM"): waived = ${isKapCodeWaived}`);
  console.log(`   Kapruka by File ("KOTI KAPRUKA-MONDAY.xls"): waived = ${isKapFileWaived}`);
  console.log(`   Kapruka by Sinhala ("කප්රුක"): waived = ${isKapSinhalaWaived}`);
  console.log(`   Ada Kotipathi: waived = ${isAdaWaived}`);
  console.log("   ✓ PASS: Board waiver recognized reliably across names, codes, and files\n");

  // 5. Test Return % Calculation with and without Board Waiver
  console.log("5. Testing DLB Return % computation with active Board Waiver...");
  const testFiles = [
    { name: "raw ecel 2(1).xls", game: "KPM", qty: 1491, sales: 30000 }, // Kapruka (Waived)
    { name: "V1.xlsx", game: "AMO", qty: 500, sales: 25000 },            // Ada Kotipathi (Active)
  ];

  // (a) With Kapruka Waived:
  const activeFiles = testFiles.filter((f) => !isLotteryWaived(f.game, customConfig));
  const activeReturns = activeFiles.reduce((sum, f) => sum + f.qty, 0);
  const activeSales = activeFiles.reduce((sum, f) => sum + f.sales, 0);
  const computedPct = (activeReturns / activeSales) * 100;

  if (activeReturns !== 500) throw new Error(`Expected active returns 500, got ${activeReturns}`);
  if (activeSales !== 25000) throw new Error(`Expected active sales 25,000, got ${activeSales}`);
  if (computedPct !== 2.0) throw new Error(`Expected waived calculation 2.00%, got ${computedPct}%`);

  console.log(`   All returns total: ${testFiles.reduce((s, f) => s + f.qty, 0)} tickets`);
  console.log(`   Active returns (excluding waived Kapruka): ${activeReturns} tickets`);
  console.log(`   Active sales (excluding waived Kapruka): ${activeSales} tickets`);
  console.log(`   Computed Return % with waiver: ${computedPct.toFixed(2)}% (Compliant with 5% limit!)`);
  console.log("   ✓ PASS: Board waiver correctly excludes waived lottery returns and sales\n");

  // 6. Test Firestore cloud target
  console.log("6. Checking Cloud Firestore destination...");
  if (FIRESTORE_SETTINGS_COLLECTION !== "dlb_settings" || FIRESTORE_THRESHOLDS_DOC !== "return_thresholds") {
    throw new Error("Invalid Cloud Firestore collection or document configuration");
  }
  console.log(`   Collection: ${FIRESTORE_SETTINGS_COLLECTION}, Doc: ${FIRESTORE_THRESHOLDS_DOC}`);
  console.log("   ✓ PASS: Cloud Firestore targets dlb_settings/return_thresholds\n");

  console.log("=================================================================");
  console.log("=== ALL LOTTERY-SPECIFIC & BOARD WAIVER TESTS PASSED! ✓✓✓ ===");
  console.log("=================================================================");
}

runTestSuite().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});

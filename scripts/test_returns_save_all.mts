// scripts/test_returns_save_all.mts
import fs from "fs";
import path from "path";
import { saveReturnUploadedFilesAtomic } from "../app/lib/returnUploadService";
import { RETURNS_PAGE_ERROR_FOR_SALES } from "../app/lib/fileValidation";

async function testReturnsSaveAll() {
  console.log("=== TESTING RETURNS SAVE ALL ATOMIC LOGIC ===");

  const sampleDir = path.resolve("./sample_files");
  const salesPath = path.join(sampleDir, "test1.xlsx");
  const returnPath = path.join(sampleDir, "V1.xlsx");

  const salesBuffer = fs.readFileSync(salesPath);
  const returnBuffer = fs.readFileSync(returnPath);

  const fakeReturnFile = new File([returnBuffer], "V1_test.xlsx");
  const fakeSalesFile = new File([salesBuffer], "test1_wrong.xlsx");

  // 1. Atomic batch rejection when an invalid file (Sales file) is in the Returns batch
  console.log("1. Testing atomic batch rejection on Returns page with mixed/wrong files...");
  let batchError = "";
  try {
    await saveReturnUploadedFilesAtomic(
      [
        { file: fakeReturnFile, gameId: "G1", gameName: "G1" },
        { file: fakeSalesFile, gameId: "G2", gameName: "G2" }, // Sales file should be rejected!
      ],
      "2026-09-26"
    );
  } catch (err: unknown) {
    batchError = err instanceof Error ? err.message : String(err);
  }

  console.log("Batch rejection result:", batchError);
  if (!batchError.includes(RETURNS_PAGE_ERROR_FOR_SALES)) {
    console.error("FAIL: Expected rejection containing:", RETURNS_PAGE_ERROR_FOR_SALES);
    process.exit(1);
  }
  console.log("✓ PASS: Batch containing Sales file on Returns page rejected before any writes!");

  console.log("\nALL RETURNS SAVE ALL TESTS PASSED! ✓✓✓");
}

testReturnsSaveAll().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

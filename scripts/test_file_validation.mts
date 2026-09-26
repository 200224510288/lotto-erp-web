// scripts/test_file_validation.mts
import fs from "fs";
import path from "path";
import {
  validateFileData,
  SALES_PAGE_ERROR_FOR_RETURN,
  RETURNS_PAGE_ERROR_FOR_SALES,
  UNRECOGNIZED_FILE_ERROR,
} from "../app/lib/fileValidation";

async function main() {
  console.log("=== RUNNING FILE TYPE VALIDATION TESTS ===");

  const sampleDir = path.resolve("./sample_files");
  const salesFilePath = path.join(sampleDir, "test1.xlsx");
  const returnFilePath = path.join(sampleDir, "V1.xlsx");

  if (!fs.existsSync(salesFilePath) || !fs.existsSync(returnFilePath)) {
    console.error("FAIL: Sample files not found in sample_files directory!");
    process.exit(1);
  }

  const salesBuffer = fs.readFileSync(salesFilePath);
  const returnBuffer = fs.readFileSync(returnFilePath);

  console.log("\n1. Test Sales sample file (test1.xlsx) on Sales page");
  const salesOnSales = await validateFileData(salesBuffer, "sales");
  console.log("Result:", salesOnSales);
  if (!salesOnSales.isValid || salesOnSales.detectedType !== "sales") {
    console.error("FAIL: Sales file on Sales page should be valid!");
    process.exit(1);
  }
  console.log("✓ PASS: Sales file on Sales page accepted.");

  console.log("\n2. Test Sales sample file (test1.xlsx) on Returns page (Wrong page upload)");
  const salesOnReturns = await validateFileData(salesBuffer, "return");
  console.log("Result:", salesOnReturns);
  if (
    salesOnReturns.isValid ||
    salesOnReturns.detectedType !== "sales" ||
    salesOnReturns.error !== RETURNS_PAGE_ERROR_FOR_SALES
  ) {
    console.error("FAIL: Sales file on Returns page should be blocked with exact message!");
    process.exit(1);
  }
  console.log(`✓ PASS: Correctly blocked with message: "${salesOnReturns.error}"`);

  console.log("\n3. Test Return sample file (V1.xlsx) on Returns page");
  const returnOnReturns = await validateFileData(returnBuffer, "return");
  console.log("Result:", returnOnReturns);
  if (!returnOnReturns.isValid || returnOnReturns.detectedType !== "return") {
    console.error("FAIL: Return file on Returns page should be valid!");
    process.exit(1);
  }
  console.log("✓ PASS: Return file on Returns page accepted.");

  console.log("\n4. Test Return sample file (V1.xlsx) on Sales page (Wrong page upload)");
  const returnOnSales = await validateFileData(returnBuffer, "sales");
  console.log("Result:", returnOnSales);
  if (
    returnOnSales.isValid ||
    returnOnSales.detectedType !== "return" ||
    returnOnSales.error !== SALES_PAGE_ERROR_FOR_RETURN
  ) {
    console.error("FAIL: Return file on Sales page should be blocked with exact message!");
    process.exit(1);
  }
  console.log(`✓ PASS: Correctly blocked with message: "${returnOnSales.error}"`);

  console.log("\n5. Test Unrecognized file (random buffer / text)");
  const dummyBuffer = Buffer.from("this is a random non-excel file content");
  const dummyResult = await validateFileData(dummyBuffer, "sales");
  console.log("Result:", dummyResult);
  if (dummyResult.isValid || dummyResult.error !== UNRECOGNIZED_FILE_ERROR) {
    console.error("FAIL: Dummy file should be rejected as unrecognized!");
    process.exit(1);
  }
  console.log(`✓ PASS: Correctly rejected with message: "${dummyResult.error}"`);

  console.log("\nALL DIRECT VALIDATION TESTS PASSED! ✓✓✓");
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});

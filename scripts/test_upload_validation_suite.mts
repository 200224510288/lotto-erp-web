// scripts/test_upload_validation_suite.mts
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import {
  validateFileData,
  inspectWorkbook,
  RAW_SALES_FILE_ERROR,
  SALES_PAGE_ERROR_FOR_RETURN,
  RETURNS_PAGE_ERROR_FOR_SALES,
  UNRECOGNIZED_FILE_ERROR,
} from "../app/lib/fileValidation";
import { saveUploadedFile, saveUploadedFilesAtomic } from "../app/lib/uploadService";
import { saveReturnUploadedFile, saveReturnUploadedFilesAtomic } from "../app/lib/returnUploadService";
import { saveNlbCleanedFile } from "../app/lib/nlbUploadService";
import { saveNlbReturnFile } from "../app/lib/nlbReturnUploadService";

const BASE_URL = "http://localhost:3000";

async function runTests() {
  console.log("=================================================================");
  console.log("=== COMPREHENSIVE FILE-TYPE VALIDATION & SECURITY TEST SUITE ===");
  console.log("=================================================================\n");

  const sampleDir = path.resolve("./sample_files");
  const salesPath = path.join(sampleDir, "test1.xlsx");
  const returnPath = path.join(sampleDir, "V1.xlsx");
  const mse2Path = path.join(sampleDir, "mse(2).xls");
  const rawEcelPath = path.join(sampleDir, "raw ecel 2(1).xls");

  if (!fs.existsSync(salesPath) || !fs.existsSync(returnPath)) {
    console.error("FAIL: Sample files test1.xlsx or V1.xlsx not found in sample_files!");
    process.exit(1);
  }

  const salesBuffer = fs.readFileSync(salesPath);
  const returnBuffer = fs.readFileSync(returnPath);
  const mse2Buffer = fs.readFileSync(mse2Path);
  const rawEcelBuffer = fs.readFileSync(rawEcelPath);

  // -------------------------------------------------------------
  // TEST GROUP 1: CORE SALES CLASSIFICATION (mse(2).xls vs raw ecel 2(1).xls)
  // -------------------------------------------------------------
  console.log("--- TEST GROUP 1: Core Sales Classification & Rejection of Raw Files ---");

  // 1.1 Processed Sales file mse(2).xls must be ACCEPTED on Sales page
  const m1 = await validateFileData(mse2Buffer, "sales");
  console.log("1.1 mse(2).xls on Sales page:", m1);
  if (!m1.isValid || m1.detectedType !== "sales") {
    throw new Error("mse(2).xls should be accepted on Sales page!");
  }
  console.log("✓ PASS: mse(2).xls is accepted on Sales page.");

  // 1.2 Raw sales file raw ecel 2(1).xls must be REJECTED with exact raw error
  const rEcel = await validateFileData(rawEcelBuffer, "sales");
  console.log("1.2 raw ecel 2(1).xls on Sales page:", rEcel);
  if (rEcel.isValid || rEcel.error !== RAW_SALES_FILE_ERROR) {
    throw new Error(`Expected error: "${RAW_SALES_FILE_ERROR}", got: "${rEcel.error}"`);
  }
  console.log(`✓ PASS: raw ecel 2(1).xls rejected with: "${rEcel.error}"`);

  // 1.3 test1.xlsx on Sales page
  const s1 = await validateFileData(salesBuffer, "sales");
  console.log("1.3 test1.xlsx on Sales page:", s1);
  if (!s1.isValid || s1.detectedType !== "sales") {
    throw new Error("test1.xlsx on Sales page should be accepted.");
  }
  console.log("✓ PASS: test1.xlsx on Sales page accepted.");

  // 1.4 Return file V1.xlsx on Sales page
  const rOnSales = await validateFileData(returnBuffer, "sales");
  console.log("1.4 Return file on Sales page:", rOnSales);
  if (rOnSales.isValid || rOnSales.error !== SALES_PAGE_ERROR_FOR_RETURN) {
    throw new Error(`Expected error: "${SALES_PAGE_ERROR_FOR_RETURN}", got: "${rOnSales.error}"`);
  }
  console.log(`✓ PASS: Return file on Sales page rejected with: "${rOnSales.error}"`);

  // 1.5 Unrecognized format (missing markers)
  const wbNoSummary = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbNoSummary, XLSX.utils.aoa_to_sheet([["data"]]), "Sheet1");
  const noSummaryBuf = XLSX.write(wbNoSummary, { type: "buffer", bookType: "xlsx" });
  const u1 = await validateFileData(noSummaryBuf, "sales");
  console.log("1.5 Missing markers:", u1);
  if (u1.isValid || u1.error !== UNRECOGNIZED_FILE_ERROR) {
    throw new Error(`Expected unrecognized error, got: "${u1.error}"`);
  }
  console.log(`✓ PASS: Missing markers blocked with: "${u1.error}"`);

  // 1.6 Returns page unchanged: V1.xlsx accepted on Returns page
  const rOnReturns = await validateFileData(returnBuffer, "return");
  console.log("1.6 V1.xlsx on Returns page:", rOnReturns);
  if (!rOnReturns.isValid || rOnReturns.detectedType !== "return") {
    throw new Error("V1.xlsx should be accepted on Returns page.");
  }
  console.log("✓ PASS: V1.xlsx accepted on Returns page.");

  // -------------------------------------------------------------
  // TEST GROUP 2: LIVE BACKEND API ENDPOINTS (/api/validate-file & /api/save-upload)
  // -------------------------------------------------------------
  console.log("\n--- TEST GROUP 2: Live Backend API Endpoints ---");

  // 2.1 /api/validate-file accepts mse(2).xls on Sales page
  {
    const fd = new FormData();
    fd.append("file", new Blob([mse2Buffer]), "mse(2).xls");
    fd.append("targetPage", "sales");
    const res = await fetch(`${BASE_URL}/api/validate-file`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("2.1 API validate mse(2).xls on Sales:", res.status, json);
    if (res.status !== 200 || !json.isValid || json.detectedType !== "sales") {
      throw new Error("API failed to accept mse(2).xls on Sales page");
    }
    console.log("✓ PASS: API returned 200 for mse(2).xls on Sales page.");
  }

  // 2.2 /api/validate-file rejects raw ecel 2(1).xls with exact raw error
  {
    const fd = new FormData();
    fd.append("file", new Blob([rawEcelBuffer]), "raw ecel 2(1).xls");
    fd.append("targetPage", "sales");
    const res = await fetch(`${BASE_URL}/api/validate-file`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("2.2 API validate raw ecel 2(1).xls on Sales:", res.status, json);
    if (res.status !== 400 || json.isValid || json.error !== RAW_SALES_FILE_ERROR) {
      throw new Error(`API failed to block raw ecel 2(1).xls: ${JSON.stringify(json)}`);
    }
    console.log(`✓ PASS: API returned 400 with "${json.error}"`);
  }

  // 2.3 /api/save-upload rejects raw ecel 2(1).xls before any database writes
  {
    const fd = new FormData();
    fd.append("file", new Blob([rawEcelBuffer]), "raw ecel 2(1).xls");
    fd.append("targetPage", "sales");
    const res = await fetch(`${BASE_URL}/api/save-upload`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("2.3 API save-upload rejects raw ecel 2(1).xls:", res.status, json);
    if (res.status !== 400 || json.success !== false || json.error !== RAW_SALES_FILE_ERROR) {
      throw new Error("Backend save did not reject raw sales file before database writes!");
    }
    console.log(`✓ PASS: API save-upload blocked raw file with: "${json.error}"`);
  }

  // 2.4 /api/nlb-preprocess rejects raw ecel 2(1).xls
  {
    const fd = new FormData();
    fd.append("file", new Blob([rawEcelBuffer]), "MSE.xlsx");
    const res = await fetch(`${BASE_URL}/api/nlb-preprocess`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("2.4 /api/nlb-preprocess with raw sales file:", res.status, json);
    if (res.status !== 400 || json.error !== RAW_SALES_FILE_ERROR) {
      throw new Error(`NLB preprocess did not reject raw sales file: ${JSON.stringify(json)}`);
    }
    console.log(`✓ PASS: /api/nlb-preprocess rejected raw file with: "${json.error}"`);
  }

  // -------------------------------------------------------------
  // TEST GROUP 3: SERVICE-LEVEL DATABASE GUARDS BEFORE WRITES
  // -------------------------------------------------------------
  console.log("\n--- TEST GROUP 3: Service-Level Validation Rejection Before Writes ---");

  // 3.1 DLB saveUploadedFile rejects raw ecel 2(1).xls
  {
    const fakeRawFile = new File([rawEcelBuffer], "raw ecel 2(1).xls");
    let caughtError = "";
    try {
      await saveUploadedFile(fakeRawFile, "TEST", "TEST", "2026-09-26");
    } catch (e: unknown) {
      caughtError = e instanceof Error ? e.message : String(e);
    }
    if (caughtError !== RAW_SALES_FILE_ERROR) {
      throw new Error(`Expected saveUploadedFile to throw "${RAW_SALES_FILE_ERROR}", got: "${caughtError}"`);
    }
    console.log(`✓ PASS: DLB saveUploadedFile rejected raw file with: "${caughtError}"`);
  }

  // 3.2 NLB saveNlbCleanedFile rejects raw ecel 2(1).xls
  {
    const fakeRawFile = new File([rawEcelBuffer], "raw ecel 2(1).xls");
    let caughtError = "";
    try {
      await saveNlbCleanedFile(
        new Blob(["test"]),
        "MSE.xlsx",
        "MSE",
        "100",
        10,
        "2026-09-26",
        fakeRawFile
      );
    } catch (e: unknown) {
      caughtError = e instanceof Error ? e.message : String(e);
    }
    if (caughtError !== RAW_SALES_FILE_ERROR) {
      throw new Error(`Expected saveNlbCleanedFile to throw "${RAW_SALES_FILE_ERROR}", got: "${caughtError}"`);
    }
    console.log(`✓ PASS: NLB saveNlbCleanedFile rejected raw file before writes with: "${caughtError}"`);
  }

  // 3.3 Atomic batch reject on Sales page if any file is raw
  {
    const fakeMse2File = new File([mse2Buffer], "mse(2).xls");
    const fakeRawFile = new File([rawEcelBuffer], "raw ecel 2(1).xls");
    let batchError = "";
    try {
      await saveUploadedFilesAtomic(
        [
          { file: fakeMse2File, gameId: "G1", gameName: "G1" },
          { file: fakeRawFile, gameId: "G2", gameName: "G2" },
        ],
        "2026-09-26"
      );
    } catch (e: unknown) {
      batchError = e instanceof Error ? e.message : String(e);
    }
    if (!batchError.includes(RAW_SALES_FILE_ERROR)) {
      throw new Error(`saveUploadedFilesAtomic did not reject batch containing raw file: ${batchError}`);
    }
    console.log(`✓ PASS: saveUploadedFilesAtomic atomically rejected batch containing raw file.`);
  }

  console.log("\n=================================================================");
  console.log("=== ALL TEST SUITE CHECKS COMPLETED SUCCESSFULLY! ✓✓✓ ===");
  console.log("=================================================================\n");
}

runTests().catch((err) => {
  console.error("Test suite failure:", err);
  process.exit(1);
});

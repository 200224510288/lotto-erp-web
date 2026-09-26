// scripts/test_upload_validation_suite.mts
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import {
  validateFileData,
  SALES_PAGE_ERROR_FOR_RETURN,
  RETURNS_PAGE_ERROR_FOR_SALES,
  UNRECOGNIZED_FILE_ERROR,
} from "../app/lib/fileValidation";
import { saveUploadedFile, saveUploadedFilesAtomic } from "../app/lib/uploadService";
import { saveReturnUploadedFile, saveReturnUploadedFilesAtomic } from "../app/lib/returnUploadService";

const BASE_URL = "http://localhost:3000";

async function runTests() {
  console.log("=================================================================");
  console.log("=== COMPREHENSIVE FILE-TYPE VALIDATION & SECURITY TEST SUITE ===");
  console.log("=================================================================\n");

  const sampleDir = path.resolve("./sample_files");
  const salesPath = path.join(sampleDir, "test1.xlsx");
  const returnPath = path.join(sampleDir, "V1.xlsx");

  if (!fs.existsSync(salesPath) || !fs.existsSync(returnPath)) {
    console.error("FAIL: Sample files test1.xlsx or V1.xlsx not found in sample_files!");
    process.exit(1);
  }

  const salesBuffer = fs.readFileSync(salesPath);
  const returnBuffer = fs.readFileSync(returnPath);

  // -------------------------------------------------------------
  // TEST GROUP 1: CORE CLASSIFICATION & VALIDATION
  // -------------------------------------------------------------
  console.log("--- TEST GROUP 1: Core File Validation Logic ---");

  // 1.1 Sales file on Sales page
  const s1 = await validateFileData(salesBuffer, "sales");
  console.log("1.1 Sales file on Sales page:", s1);
  if (!s1.isValid || s1.detectedType !== "sales") {
    throw new Error("Sales file on Sales page should be accepted.");
  }
  console.log("✓ PASS: Sales file on Sales page accepted.");

  // 1.2 Sales file on Returns page (Wrong page)
  const s2 = await validateFileData(salesBuffer, "return");
  console.log("1.2 Sales file on Returns page (Wrong page):", s2);
  if (s2.isValid || s2.detectedType !== "sales" || s2.error !== RETURNS_PAGE_ERROR_FOR_SALES) {
    throw new Error(`Expected error: "${RETURNS_PAGE_ERROR_FOR_SALES}", got: "${s2.error}"`);
  }
  console.log(`✓ PASS: Sales file on Returns page blocked with: "${s2.error}"`);

  // 1.3 Return file on Returns page
  const r1 = await validateFileData(returnBuffer, "return");
  console.log("1.3 Return file on Returns page:", r1);
  if (!r1.isValid || r1.detectedType !== "return") {
    throw new Error("Return file on Returns page should be accepted.");
  }
  console.log("✓ PASS: Return file on Returns page accepted.");

  // 1.4 Return file on Sales page (Wrong page)
  const r2 = await validateFileData(returnBuffer, "sales");
  console.log("1.4 Return file on Sales page (Wrong page):", r2);
  if (r2.isValid || r2.detectedType !== "return" || r2.error !== SALES_PAGE_ERROR_FOR_RETURN) {
    throw new Error(`Expected error: "${SALES_PAGE_ERROR_FOR_RETURN}", got: "${r2.error}"`);
  }
  console.log(`✓ PASS: Return file on Sales page blocked with: "${r2.error}"`);

  // 1.5 Unrecognized format (missing Summary sheet)
  const wbNoSummary = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbNoSummary, XLSX.utils.aoa_to_sheet([["data"]]), "Sheet1");
  const noSummaryBuf = XLSX.write(wbNoSummary, { type: "buffer", bookType: "xlsx" });
  const u1 = await validateFileData(noSummaryBuf, "sales");
  console.log("1.5 Missing Summary sheet:", u1);
  if (u1.isValid || u1.error !== UNRECOGNIZED_FILE_ERROR) {
    throw new Error(`Expected unrecognized error, got: "${u1.error}"`);
  }
  console.log(`✓ PASS: Missing Summary sheet blocked with: "${u1.error}"`);

  // 1.6 Ambiguous file (contains both sales and return headers)
  const wbAmbiguous = XLSX.utils.book_new();
  const ambSheet = XLSX.utils.aoa_to_sheet([]);
  ambSheet["A2"] = { v: " SALES SUMMARY " };
  ambSheet["A3"] = { v: "name" };
  ambSheet["C3"] = { v: "from" };
  ambSheet["D3"] = { v: "to" };
  ambSheet["E3"] = { v: "qty" };
  ambSheet["B4"] = { v: "DISTRIBUTOR RETURN" };
  ambSheet["B14"] = { v: "agent code" };
  ambSheet["C14"] = { v: "from" };
  ambSheet["H14"] = { v: "to" };
  ambSheet["I14"] = { v: "qty" };
  XLSX.utils.book_append_sheet(wbAmbiguous, ambSheet, "Summary");
  const ambBuf = XLSX.write(wbAmbiguous, { type: "buffer", bookType: "xlsx" });
  const aRes = await validateFileData(ambBuf, "sales");
  console.log("1.6 Ambiguous file (both matched):", aRes);
  if (aRes.isValid || aRes.error !== UNRECOGNIZED_FILE_ERROR) {
    throw new Error(`Ambiguous file should be rejected with: "${UNRECOGNIZED_FILE_ERROR}"`);
  }
  console.log(`✓ PASS: Ambiguous file blocked with: "${aRes.error}"`);

  // -------------------------------------------------------------
  // TEST GROUP 2: LIVE BACKEND API (/api/validate-file)
  // -------------------------------------------------------------
  console.log("\n--- TEST GROUP 2: Live Backend /api/validate-file Endpoint ---");

  // 2.1 Sales sample on Sales page via API
  {
    const fd = new FormData();
    fd.append("file", new Blob([salesBuffer]), "test1.xlsx");
    fd.append("targetPage", "sales");
    const res = await fetch(`${BASE_URL}/api/validate-file`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("2.1 API validate Sales on Sales:", res.status, json);
    if (res.status !== 200 || !json.isValid || json.detectedType !== "sales") {
      throw new Error("API validation failed for Sales file on Sales page");
    }
    console.log("✓ PASS: API returned 200 for Sales file on Sales page.");
  }

  // 2.2 Sales sample on Returns page (Wrong page) via API
  {
    const fd = new FormData();
    fd.append("file", new Blob([salesBuffer]), "test1.xlsx");
    fd.append("targetPage", "return");
    const res = await fetch(`${BASE_URL}/api/validate-file`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("2.2 API validate Sales on Returns:", res.status, json);
    if (res.status !== 400 || json.isValid || json.error !== RETURNS_PAGE_ERROR_FOR_SALES) {
      throw new Error(`API failed to block Sales file on Returns page: ${JSON.stringify(json)}`);
    }
    console.log(`✓ PASS: API returned 400 with "${json.error}"`);
  }

  // 2.3 Return sample on Returns page via API
  {
    const fd = new FormData();
    fd.append("file", new Blob([returnBuffer]), "V1.xlsx");
    fd.append("targetPage", "return");
    const res = await fetch(`${BASE_URL}/api/validate-file`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("2.3 API validate Return on Returns:", res.status, json);
    if (res.status !== 200 || !json.isValid || json.detectedType !== "return") {
      throw new Error("API validation failed for Return file on Returns page");
    }
    console.log("✓ PASS: API returned 200 for Return file on Returns page.");
  }

  // 2.4 Return sample on Sales page (Wrong page) via API
  {
    const fd = new FormData();
    fd.append("file", new Blob([returnBuffer]), "V1.xlsx");
    fd.append("targetPage", "sales");
    const res = await fetch(`${BASE_URL}/api/validate-file`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("2.4 API validate Return on Sales:", res.status, json);
    if (res.status !== 400 || json.isValid || json.error !== SALES_PAGE_ERROR_FOR_RETURN) {
      throw new Error(`API failed to block Return file on Sales page: ${JSON.stringify(json)}`);
    }
    console.log(`✓ PASS: API returned 400 with "${json.error}"`);
  }

  // 2.5 Corrupted / random file via API
  {
    const fd = new FormData();
    fd.append("file", new Blob(["not an excel file"]), "corrupt.xlsx");
    fd.append("targetPage", "sales");
    const res = await fetch(`${BASE_URL}/api/validate-file`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("2.5 API validate corrupt file:", res.status, json);
    if (res.status !== 400 || json.error !== UNRECOGNIZED_FILE_ERROR) {
      throw new Error(`API failed to block corrupt file: ${JSON.stringify(json)}`);
    }
    console.log(`✓ PASS: API returned 400 with "${json.error}"`);
  }

  // -------------------------------------------------------------
  // TEST GROUP 3: BACKEND DATABASE WRITES ENFORCEMENT & ATOMICITY
  // -------------------------------------------------------------
  console.log("\n--- TEST GROUP 3: Backend /api/save-upload Atomic Rejection ---");

  // 3.1 Rejected file on /api/save-upload must NOT write to database
  {
    const fd = new FormData();
    fd.append("file", new Blob([salesBuffer]), "test1.xlsx");
    fd.append("targetPage", "return"); // wrong page!
    const res = await fetch(`${BASE_URL}/api/save-upload`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("3.1 Backend Save Wrong Page (Sales on Returns):", res.status, json);
    if (res.status !== 400 || json.success !== false || json.error !== RETURNS_PAGE_ERROR_FOR_SALES) {
      throw new Error("Backend save did not reject wrong page file before database writes!");
    }
    console.log("✓ PASS: Backend save blocked before database write with exact message.");
  }

  // 3.2 Rejected Return file on Sales page
  {
    const fd = new FormData();
    fd.append("file", new Blob([returnBuffer]), "V1.xlsx");
    fd.append("targetPage", "sales"); // wrong page!
    const res = await fetch(`${BASE_URL}/api/save-upload`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("3.2 Backend Save Wrong Page (Return on Sales):", res.status, json);
    if (res.status !== 400 || json.success !== false || json.error !== SALES_PAGE_ERROR_FOR_RETURN) {
      throw new Error("Backend save did not reject wrong page file before database writes!");
    }
    console.log("✓ PASS: Backend save blocked before database write with exact message.");
  }

  // 3.3 Atomic Batch Rejection: If any file in batch is invalid, ALL are rejected
  {
    const fd = new FormData();
    fd.append("files", new Blob([salesBuffer]), "valid_sales.xlsx");
    fd.append("files", new Blob([returnBuffer]), "invalid_return.xlsx"); // mixed invalid file!
    fd.append("targetPage", "sales");
    const res = await fetch(`${BASE_URL}/api/save-upload`, { method: "POST", body: fd });
    const json = await res.json();
    console.log("3.3 Backend Mixed Batch Rejection:", res.status, json);
    if (res.status !== 400 || json.success !== false || json.error !== SALES_PAGE_ERROR_FOR_RETURN) {
      throw new Error("Batch import was not atomically rejected!");
    }
    console.log("✓ PASS: Batch import atomically rejected before any database writes.");
  }

  // 3.4 Service-level validation rejection
  console.log("\n--- TEST GROUP 4: Service-Level Validation Rejection ---");
  {
    const fakeReturnFile = new File([returnBuffer], "V1.xlsx");
    let caughtSalesError = "";
    try {
      await saveUploadedFile(fakeReturnFile, "TEST", "TEST", "2026-09-26");
    } catch (e: unknown) {
      caughtSalesError = e instanceof Error ? e.message : String(e);
    }
    if (caughtSalesError !== SALES_PAGE_ERROR_FOR_RETURN) {
      throw new Error(`Expected saveUploadedFile to throw "${SALES_PAGE_ERROR_FOR_RETURN}", got: "${caughtSalesError}"`);
    }
    console.log(`✓ PASS: saveUploadedFile rejected Return file with: "${caughtSalesError}"`);

    const fakeSalesFile = new File([salesBuffer], "test1.xlsx");
    let caughtReturnError = "";
    try {
      await saveReturnUploadedFile(fakeSalesFile, "TEST", "TEST", "2026-09-26");
    } catch (e: unknown) {
      caughtReturnError = e instanceof Error ? e.message : String(e);
    }
    if (caughtReturnError !== RETURNS_PAGE_ERROR_FOR_SALES) {
      throw new Error(`Expected saveReturnUploadedFile to throw "${RETURNS_PAGE_ERROR_FOR_SALES}", got: "${caughtReturnError}"`);
    }
    console.log(`✓ PASS: saveReturnUploadedFile rejected Sales file with: "${caughtReturnError}"`);

    // Atomic batch save rejection at service level
    let batchError = "";
    try {
      await saveUploadedFilesAtomic(
        [
          { file: fakeSalesFile, gameId: "G1", gameName: "G1" },
          { file: fakeReturnFile, gameId: "G2", gameName: "G2" },
        ],
        "2026-09-26"
      );
    } catch (e: unknown) {
      batchError = e instanceof Error ? e.message : String(e);
    }
    if (!batchError.includes(SALES_PAGE_ERROR_FOR_RETURN)) {
      throw new Error(`saveUploadedFilesAtomic did not reject batch: ${batchError}`);
    }
    console.log(`✓ PASS: saveUploadedFilesAtomic atomically rejected batch containing invalid file.`);
  }

  console.log("\n=================================================================");
  console.log("=== ALL TEST SUITE CHECKS COMPLETED SUCCESSFULLY! ✓✓✓ ===");
  console.log("=================================================================\n");
}

runTests().catch((err) => {
  console.error("Test suite failure:", err);
  process.exit(1);
});

// app/lib/balanceOrganizerService.ts
import * as XLSX from "xlsx";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";

/* =============================================================
   TYPES & INTERFACES
   ============================================================= */

export type BalanceCheckingStatus = "pending" | "partially_checked" | "completed";

export interface DailyBalanceReport {
  id: string; // usually the balance date: "YYYY-MM-DD"
  balanceDate: string; // "YYYY-MM-DD"
  originalFileName: string;
  uploadedAt: string; // ISO string
  uploadedBy: string; // email or officer name
  totalRows: number;
  totalWin: number;
  totalCashAndCheque: number;
  totalCalculatedBalance: number;
  checkedCount: number;
  pendingCount: number;
  status: BalanceCheckingStatus;
  notes?: string;
  updatedAt?: string;
}

export interface BalanceRecordRow {
  id: string; // e.g., "row_0", "row_1", etc.
  reportId: string;
  balanceDate: string;
  rowIndex: number; // 0-indexed, preserves original Excel row order
  serialNo: string;
  agentName: string;
  win: number;
  cashAndCheque: number;
  balance: number; // CASH & CHE. - WIN
  isChecked: boolean;
  checkedBy: string | null;
  checkedAt: string | null; // ISO string
  rawOriginalData?: Record<string, string | number | null>;
}

export interface ExcelParseResult {
  isValid: boolean;
  error?: string;
  fileName: string;
  sheetName: string;
  headerRowIndex: number;
  detectedHeaders: {
    serialNoCol: number;
    agentNameCol: number;
    winCol: number;
    cashChequeCol: number;
    balanceCol?: number;
  };
  rows: Omit<BalanceRecordRow, "id" | "reportId">[];
  totalRows: number;
  totalWin: number;
  totalCashAndCheque: number;
  totalCalculatedBalance: number;
}

export interface BalancingProgressSummary {
  totalRecords: number;
  checkedRecords: number;
  pendingRecords: number;
  totalCashAndCheque: number;
  totalWin: number;
  totalBalance: number;
  checkedCashAndCheque: number;
  checkedWin: number;
  pendingCashAndCheque: number;
  pendingWin: number;
  percentChecked: number;
}

/* =============================================================
   CORE FORMULA & UTILITIES
   ============================================================= */

/**
 * Balance Calculation:
 * Both Cash & Cheques and Winning tickets are treated as money received from the agent.
 * Balance = CASH & CHE. + WIN
 */
export function calculateRecordBalance(cashAndCheque: number, win: number): number {
  return roundToTwoDecimals(cashAndCheque + win);
}

/**
 * Clean and round floating point values to 2 decimals.
 */
export function roundToTwoDecimals(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Robust numeric parser for Excel data:
 * Handles strings, commas, currency prefixes, negative values in parentheses `(1,200.50)` or `-1200.50`,
 * dashes `-`, empty spaces, etc.
 */
export function cleanNumericValue(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : roundToTwoDecimals(val);

  let str = String(val).trim();
  if (!str || str === "-" || str === "--" || str.toUpperCase() === "N/A" || str.toUpperCase() === "NIL") {
    return 0;
  }

  // Remove common currency abbreviations e.g. "Rs.", "Rs", "LKR", "USD", "$", etc.
  str = str.replace(/^(?:rs\.?|lkr|usd|\$|€|£)\s*/i, "").trim();

  let isNegative = false;
  // Check for parenthesis format (12,345.67)
  if (str.startsWith("(") && str.endsWith(")")) {
    isNegative = true;
    str = str.slice(1, -1).trim();
  } else if (str.startsWith("-")) {
    isNegative = true;
    str = str.slice(1).trim();
  }

  // Remove all commas and spaces
  str = str.replace(/[,\s]/g, "");

  // If there's any remaining non-digit non-dot, strip it
  str = str.replace(/[^0-9.]/g, "");

  // If multiple dots exist, keep only digits and the last dot
  const dotCount = (str.match(/\./g) || []).length;
  if (dotCount > 1) {
    const lastDotIdx = str.lastIndexOf(".");
    const wholePart = str.slice(0, lastDotIdx).replace(/\./g, "");
    const decimalPart = str.slice(lastDotIdx + 1);
    str = `${wholePart}.${decimalPart}`;
  }

  const num = parseFloat(str);
  if (isNaN(num)) return 0;

  const result = isNegative ? -num : num;
  return roundToTwoDecimals(result);
}

/**
 * Clean string value from Excel cell
 */
export function cleanStringValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

/**
 * Sri Lankan Currency Formatter
 * Output: Rs. 125,450.00 or -Rs. 2,300.00
 */
export function formatCurrency(amount: number | null | undefined): string {
  const val = typeof amount === "number" && !isNaN(amount) ? amount : 0;
  const isNeg = val < 0;
  const absVal = Math.abs(val);

  const formatted = absVal.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return isNeg ? `-Rs. ${formatted}` : `Rs. ${formatted}`;
}

/**
 * Format timestamp or ISO date string for display
 */
export function formatDisplayDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return dateStr;
  }
}

/* =============================================================
   EXCEL PARSING & VALIDATION
   ============================================================= */

const PRIMARY_SERIAL_KEYWORDS = [
  "serial no",
  "serial no.",
  "serial",
  "serial number",
  "s/n",
  "s.no",
  "sl no",
  "sl. no",
  "sl.no",
  "serial_no",
];

const FALLBACK_SERIAL_KEYWORDS = [
  "acc no",
  "account no",
  "account no.",
  "a/c no",
  "a/c",
  "code",
  "agent code",
  "dealer code",
  "no.",
  "no",
  "no#",
];

const AGENT_KEYWORDS = [
  "account",
  "account name",
  "account_name",
  "account/agent",
  "agent",
  "agent name",
  "agent_name",
  "dealer",
  "dealer name",
  "customer",
  "customer name",
  "name",
  "distributor",
  "party",
  "party name",
];

const WIN_KEYWORDS = [
  "win",
  "winning",
  "winnings",
  "win amount",
  "total win",
  "ticket win",
  "win.",
];

const CASH_CHEQUE_KEYWORDS = [
  "cash & che.",
  "cash & che",
  "cash & cheque",
  "cash & chq",
  "cash & chq.",
  "cash and cheque",
  "cash/cheque",
  "cash / cheque",
  "cash & cheque amount",
  "cash&cheque",
  "cash+cheque",
  "cash",
  "cheque",
];

const BALANCE_KEYWORDS = [
  "balance",
  "bal",
  "total balance",
  "net balance",
  "due",
  "balance amount",
];

function matchKeyword(cellText: string, keywords: string[]): boolean {
  const normalized = cellText.toLowerCase().replace(/\s+/g, " ").trim();
  return keywords.some((kw) => {
    if (normalized === kw) return true;
    if (normalized.startsWith(kw + " ") || normalized.endsWith(" " + kw) || normalized.includes(" " + kw + " ")) {
      return true;
    }
    return false;
  });
}

/**
 * Parse an Excel file (.xls or .xlsx) and extract rows for the Daily Balance Organizer.
 * Validates header detection, skips empty rows, preserves row order, and computes totals.
 */
export async function parseDailyBalanceExcel(file: File, balanceDate: string): Promise<ExcelParseResult> {
  const fileName = file.name;
  const isXlsx = fileName.toLowerCase().endsWith(".xlsx");
  const isXls = fileName.toLowerCase().endsWith(".xls");

  if (!isXlsx && !isXls) {
    return {
      isValid: false,
      error: "Invalid file type. Please upload a valid Excel file (.xls or .xlsx).",
      fileName,
      sheetName: "",
      headerRowIndex: -1,
      detectedHeaders: { serialNoCol: -1, agentNameCol: -1, winCol: -1, cashChequeCol: -1 },
      rows: [],
      totalRows: 0,
      totalWin: 0,
      totalCashAndCheque: 0,
      totalCalculatedBalance: 0,
    };
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return {
      isValid: false,
      error: "The Excel workbook has no sheets.",
      fileName,
      sheetName: "",
      headerRowIndex: -1,
      detectedHeaders: { serialNoCol: -1, agentNameCol: -1, winCol: -1, cashChequeCol: -1 },
      rows: [],
      totalRows: 0,
      totalWin: 0,
      totalCashAndCheque: 0,
      totalCalculatedBalance: 0,
    };
  }

  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawSheetData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];

  if (!rawSheetData || rawSheetData.length === 0) {
    return {
      isValid: false,
      error: "The selected sheet is completely empty.",
      fileName,
      sheetName,
      headerRowIndex: -1,
      detectedHeaders: { serialNoCol: -1, agentNameCol: -1, winCol: -1, cashChequeCol: -1 },
      rows: [],
      totalRows: 0,
      totalWin: 0,
      totalCashAndCheque: 0,
      totalCalculatedBalance: 0,
    };
  }

  // Detect header row by scanning first 35 rows
  let headerRowIndex = -1;
  let serialCol = -1;
  let agentCol = -1;
  let winCol = -1;
  let cashChequeCol = -1;
  let balanceCol = -1;

  const maxScanRows = Math.min(rawSheetData.length, 35);

  for (let r = 0; r < maxScanRows; r++) {
    const row = rawSheetData[r];
    if (!row || !Array.isArray(row)) continue;

    let candidateSerial = -1;
    let candidateAgent = -1;
    let candidateWin = -1;
    let candidateCash = -1;
    let candidateBalance = -1;

    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? "").trim();
      if (!cell) continue;

      if (candidateSerial === -1 && matchKeyword(cell, PRIMARY_SERIAL_KEYWORDS)) {
        candidateSerial = c;
      }
      if (candidateWin === -1 && matchKeyword(cell, WIN_KEYWORDS)) {
        candidateWin = c;
      }
      if (candidateCash === -1 && matchKeyword(cell, CASH_CHEQUE_KEYWORDS)) {
        candidateCash = c;
      }
      if (candidateBalance === -1 && matchKeyword(cell, BALANCE_KEYWORDS)) {
        candidateBalance = c;
      }
    }

    // Secondary pass for Agent Name and fallback serial
    for (let c = 0; c < row.length; c++) {
      if (c === candidateSerial || c === candidateWin || c === candidateCash) continue;
      const cell = String(row[c] ?? "").trim();
      if (!cell) continue;

      if (candidateAgent === -1 && matchKeyword(cell, AGENT_KEYWORDS)) {
        candidateAgent = c;
      }
    }

    if (candidateSerial === -1) {
      for (let c = 0; c < row.length; c++) {
        if (c === candidateAgent || c === candidateWin || c === candidateCash) continue;
        const cell = String(row[c] ?? "").trim();
        if (matchKeyword(cell, FALLBACK_SERIAL_KEYWORDS)) {
          candidateSerial = c;
          break;
        }
      }
    }

    // A valid header row must have at least WIN and CASH (or AGENT + WIN or AGENT + CASH)
    const matchesCount = [
      candidateSerial !== -1,
      candidateAgent !== -1,
      candidateWin !== -1,
      candidateCash !== -1,
    ].filter(Boolean).length;

    if (matchesCount >= 2 && (candidateWin !== -1 || candidateCash !== -1)) {
      headerRowIndex = r;
      serialCol = candidateSerial;
      agentCol = candidateAgent;
      winCol = candidateWin;
      cashChequeCol = candidateCash;
      balanceCol = candidateBalance;
      break;
    }
  }

  // Fallback heuristic if explicit keywords weren't all found
  if (headerRowIndex === -1) {
    for (let r = 0; r < maxScanRows; r++) {
      const row = rawSheetData[r];
      if (!row || !Array.isArray(row)) continue;
      const textRow = row.map((c) => String(c ?? "").trim().toUpperCase()).join(" ");
      if (textRow.includes("WIN") && (textRow.includes("CASH") || textRow.includes("CHE"))) {
        headerRowIndex = r;
        // Map columns by simple index
        for (let c = 0; c < row.length; c++) {
          const txt = String(row[c] ?? "").trim().toUpperCase();
          if (txt.includes("SERIAL") || txt.includes("S/N")) serialCol = c;
          if (txt.includes("ACCOUNT") || txt.includes("AGENT") || txt.includes("NAME") || txt.includes("DEALER")) agentCol = c;
          if (txt.includes("WIN")) winCol = c;
          if (txt.includes("CASH") || txt.includes("CHE")) cashChequeCol = c;
        }
        break;
      }
    }
  }

  if (headerRowIndex === -1 || (winCol === -1 && cashChequeCol === -1)) {
    return {
      isValid: false,
      error:
        "Could not detect required table headers (Agent Name, WIN, CASH & CHE.). Please check that your Excel file contains standard balance columns.",
      fileName,
      sheetName,
      headerRowIndex: -1,
      detectedHeaders: { serialNoCol: -1, agentNameCol: -1, winCol: -1, cashChequeCol: -1 },
      rows: [],
      totalRows: 0,
      totalWin: 0,
      totalCashAndCheque: 0,
      totalCalculatedBalance: 0,
    };
  }

  // If serialCol was not found, default to first column or column before agent
  if (serialCol === -1) {
    serialCol = agentCol > 0 ? 0 : -1;
  }

  // Extract header names for rawOriginalData mapping
  const headerRow = rawSheetData[headerRowIndex] || [];
  const columnHeaders = headerRow.map((c, idx) => {
    const name = String(c ?? "").trim();
    return name || `Col_${idx + 1}`;
  });

  const parsedRows: Omit<BalanceRecordRow, "id" | "reportId">[] = [];
  let totalWin = 0;
  let totalCashAndCheque = 0;

  // Process rows after header
  let currentRowIndex = 0;
  for (let r = headerRowIndex + 1; r < rawSheetData.length; r++) {
    const row = rawSheetData[r];
    if (!row || !Array.isArray(row)) continue;

    // Check if row is completely empty
    const isEmpty = row.every((c) => c === null || c === undefined || String(c).trim() === "");
    if (isEmpty) continue;

    // Extract cell values
    const rawSerial = serialCol !== -1 && serialCol < row.length ? row[serialCol] : "";
    const rawAgent = agentCol !== -1 && agentCol < row.length ? row[agentCol] : "";
    const rawWin = winCol !== -1 && winCol < row.length ? row[winCol] : "";
    const rawCashCheque = cashChequeCol !== -1 && cashChequeCol < row.length ? row[cashChequeCol] : "";

    const serialNoStr = cleanStringValue(rawSerial);
    const agentNameStr = cleanStringValue(rawAgent);

    const isBlankOrDash = (s: string) => !s || s === "-" || s === "--" || s === "." || s === "---";

    // If both serial and agent are blank or dash (like Row 6 which is "- | | | 3,121,810.0 | 7,409,142.0"), skip it!
    if (isBlankOrDash(serialNoStr) && isBlankOrDash(agentNameStr)) {
      continue;
    }

    // Skip summary / grand total footer rows that might be in the Excel file
    const lowerAgent = agentNameStr.toLowerCase();
    const lowerSerial = serialNoStr.toLowerCase();
    if (
      lowerAgent.includes("grand total") ||
      lowerAgent.includes("total:") ||
      lowerAgent === "total" ||
      lowerAgent === "summary" ||
      lowerSerial.includes("grand total") ||
      lowerSerial === "total" ||
      lowerSerial === "summary"
    ) {
      continue;
    }

    const winVal = cleanNumericValue(rawWin);
    const cashChequeVal = cleanNumericValue(rawCashCheque);

    // Individual balance calculation: CASH & CHE. - WIN
    const calculatedBalance = calculateRecordBalance(cashChequeVal, winVal);

    // Preserve original raw data of this row
    const rawOriginalData: Record<string, string | number | null> = {};
    for (let c = 0; c < row.length; c++) {
      const colName = columnHeaders[c] || `Col_${c + 1}`;
      const cellVal = row[c];
      rawOriginalData[colName] = cellVal !== undefined && cellVal !== null ? (cellVal as string | number) : "";
    }

    const resolvedAgentName = agentNameStr || (serialNoStr ? `Agent ${serialNoStr}` : "Unknown Agent");
    const resolvedSerialNo = serialNoStr || String(currentRowIndex + 1);

    parsedRows.push({
      balanceDate,
      rowIndex: currentRowIndex,
      serialNo: resolvedSerialNo,
      agentName: resolvedAgentName,
      win: winVal,
      cashAndCheque: cashChequeVal,
      balance: calculatedBalance,
      isChecked: false,
      checkedBy: null,
      checkedAt: null,
      rawOriginalData,
    });

    totalWin += winVal;
    totalCashAndCheque += cashChequeVal;
    currentRowIndex++;
  }

  if (parsedRows.length === 0) {
    return {
      isValid: false,
      error: "No valid data rows found in the uploaded file after headers.",
      fileName,
      sheetName,
      headerRowIndex,
      detectedHeaders: {
        serialNoCol: serialCol,
        agentNameCol: agentCol,
        winCol,
        cashChequeCol,
        balanceCol: balanceCol !== -1 ? balanceCol : undefined,
      },
      rows: [],
      totalRows: 0,
      totalWin: 0,
      totalCashAndCheque: 0,
      totalCalculatedBalance: 0,
    };
  }

  totalWin = roundToTwoDecimals(totalWin);
  totalCashAndCheque = roundToTwoDecimals(totalCashAndCheque);
  const totalCalculatedBalance = calculateRecordBalance(totalCashAndCheque, totalWin);

  return {
    isValid: true,
    fileName,
    sheetName,
    headerRowIndex,
    detectedHeaders: {
      serialNoCol: serialCol,
      agentNameCol: agentCol,
      winCol,
      cashChequeCol,
      balanceCol: balanceCol !== -1 ? balanceCol : undefined,
    },
    rows: parsedRows,
    totalRows: parsedRows.length,
    totalWin,
    totalCashAndCheque,
    totalCalculatedBalance,
  };
}

/* =============================================================
   FIRESTORE DATABASE OPERATIONS
   ============================================================= */

const REPORTS_COLLECTION = "daily_balance_reports";

/**
 * Fetch a daily balance report and all its individual records for a given date.
 */
export async function getDailyBalanceReport(
  balanceDate: string
): Promise<{ report: DailyBalanceReport | null; rows: BalanceRecordRow[] }> {
  if (!balanceDate) return { report: null, rows: [] };

  try {
    const reportRef = doc(db, REPORTS_COLLECTION, balanceDate);
    const reportSnap = await getDoc(reportRef);

    if (!reportSnap.exists()) {
      return { report: null, rows: [] };
    }

    const reportData = reportSnap.data() as DailyBalanceReport;
    const report: DailyBalanceReport = {
      ...reportData,
      id: reportSnap.id,
    };

    // Fetch individual rows subcollection ordered by original rowIndex
    const rowsColRef = collection(db, REPORTS_COLLECTION, balanceDate, "rows");
    const rowsQuery = query(rowsColRef, orderBy("rowIndex", "asc"));
    const rowsSnap = await getDocs(rowsQuery);

    const rows: BalanceRecordRow[] = [];
    rowsSnap.forEach((rowDoc) => {
      const data = rowDoc.data() as BalanceRecordRow;
      rows.push({
        ...data,
        id: rowDoc.id,
        reportId: balanceDate,
      });
    });

    // Compute active checkedCount and pendingCount
    const checkedCount = rows.filter((r) => r.isChecked).length;
    report.checkedCount = checkedCount;
    report.pendingCount = rows.length - checkedCount;
    report.totalRows = rows.length;

    return { report, rows };
  } catch (error) {
    console.error("Error fetching daily balance report:", error);
    throw error;
  }
}

/**
 * Save an uploaded daily balance report and all individual rows to Firestore.
 * Handles batched writes (up to 450 ops per batch) to ensure scalability.
 * If overwriting an existing report, previous records are cleanly replaced.
 */
export async function saveDailyBalanceReport(
  reportData: Omit<DailyBalanceReport, "id">,
  rows: Array<Omit<BalanceRecordRow, "id" | "reportId">>
): Promise<{ reportId: string; totalSaved: number }> {
  const balanceDate = reportData.balanceDate;
  if (!balanceDate) throw new Error("Balance Date is required.");

  try {
    const reportRef = doc(db, REPORTS_COLLECTION, balanceDate);

    // Check if previous rows exist to clean up if replacing
    const rowsColRef = collection(db, REPORTS_COLLECTION, balanceDate, "rows");
    const existingRowsSnap = await getDocs(rowsColRef);

    if (!existingRowsSnap.empty) {
      // Delete existing subcollection docs in batches
      const deleteBatches: (typeof existingRowsSnap.docs)[] = [];
      let currentDeleteChunk: typeof existingRowsSnap.docs = [];
      for (const d of existingRowsSnap.docs) {
        currentDeleteChunk.push(d);
        if (currentDeleteChunk.length >= 450) {
          deleteBatches.push(currentDeleteChunk);
          currentDeleteChunk = [];
        }
      }
      if (currentDeleteChunk.length > 0) {
        deleteBatches.push(currentDeleteChunk);
      }

      for (const chunk of deleteBatches) {
        const batch = writeBatch(db);
        chunk.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }

    // Save report document
    const reportPayload: DailyBalanceReport = {
      ...reportData,
      id: balanceDate,
      checkedCount: 0,
      pendingCount: rows.length,
      status: "pending",
      updatedAt: new Date().toISOString(),
    };

    await setDoc(reportRef, reportPayload);

    // Save all rows in chunks of 450
    const rowBatches: (typeof rows)[] = [];
    let currentChunk: typeof rows = [];

    for (const r of rows) {
      currentChunk.push(r);
      if (currentChunk.length >= 450) {
        rowBatches.push(currentChunk);
        currentChunk = [];
      }
    }
    if (currentChunk.length > 0) {
      rowBatches.push(currentChunk);
    }

    for (let batchIdx = 0; batchIdx < rowBatches.length; batchIdx++) {
      const chunk = rowBatches[batchIdx];
      const batch = writeBatch(db);

      for (let i = 0; i < chunk.length; i++) {
        const row = chunk[i];
        const rowId = `row_${row.rowIndex}`;
        const rowDocRef = doc(db, REPORTS_COLLECTION, balanceDate, "rows", rowId);

        const rowPayload: BalanceRecordRow = {
          ...row,
          id: rowId,
          reportId: balanceDate,
          isChecked: false,
          checkedBy: null,
          checkedAt: null,
        };

        batch.set(rowDocRef, rowPayload);
      }

      await batch.commit();
    }

    return { reportId: balanceDate, totalSaved: rows.length };
  } catch (error) {
    console.error("Error saving daily balance report to database:", error);
    throw error;
  }
}

/**
 * Mark a single row as checked or pending.
 * Updates the database immediately and updates the parent report's checked status.
 */
export async function updateBalanceRowCheckStatus(
  reportId: string,
  rowId: string,
  isChecked: boolean,
  userEmail: string
): Promise<{ isChecked: boolean; checkedBy: string | null; checkedAt: string | null }> {
  if (!reportId || !rowId) throw new Error("Report ID and Row ID are required.");

  const rowRef = doc(db, REPORTS_COLLECTION, reportId, "rows", rowId);
  const nowIso = new Date().toISOString();

  const updateData = {
    isChecked,
    checkedBy: isChecked ? userEmail || "Authorized Officer" : null,
    checkedAt: isChecked ? nowIso : null,
  };

  await updateDoc(rowRef, updateData);

  // Sync parent report status asynchronously
  try {
    const rowsSnap = await getDocs(collection(db, REPORTS_COLLECTION, reportId, "rows"));
    let checkedCount = 0;
    const totalCount = rowsSnap.size;

    rowsSnap.forEach((d) => {
      if (d.data().isChecked) checkedCount++;
    });

    const status: BalanceCheckingStatus =
      checkedCount === 0
        ? "pending"
        : checkedCount === totalCount
        ? "completed"
        : "partially_checked";

    await updateDoc(doc(db, REPORTS_COLLECTION, reportId), {
      checkedCount,
      pendingCount: totalCount - checkedCount,
      status,
      updatedAt: nowIso,
    });
  } catch (err) {
    console.warn("Parent report summary sync notice:", err);
  }

  return {
    isChecked,
    checkedBy: updateData.checkedBy,
    checkedAt: updateData.checkedAt,
  };
}

/**
 * Delete a balance report and all its rows from the database
 */
export async function deleteDailyBalanceReport(reportId: string): Promise<void> {
  if (!reportId) return;

  const rowsColRef = collection(db, REPORTS_COLLECTION, reportId, "rows");
  const rowsSnap = await getDocs(rowsColRef);

  if (!rowsSnap.empty) {
    const batch = writeBatch(db);
    rowsSnap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  await deleteDoc(doc(db, REPORTS_COLLECTION, reportId));
}

/* =============================================================
   SEPARATE SECURE AUTHENTICATION (BALANCE OFFICER PIN / PASSCODE)
   ============================================================= */

const SECURITY_DOC = "system_settings";
const SECURITY_ITEM = "balance_security";
const DEFAULT_FALLBACK_PIN = "8899"; // Default secure officer PIN if uninitialized

/**
 * Verify entered passcode against the balance security configuration in Firestore.
 */
export async function verifyBalancePasscode(enteredPin: string): Promise<boolean> {
  const pin = enteredPin.trim();
  if (!pin) return false;

  try {
    const ref = doc(db, SECURITY_DOC, SECURITY_ITEM);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      // Auto initialize default PIN in Firestore if not set
      await setDoc(ref, {
        pin: DEFAULT_FALLBACK_PIN,
        updatedAt: new Date().toISOString(),
        updatedBy: "system",
      });
      return pin === DEFAULT_FALLBACK_PIN;
    }

    const data = snap.data();
    const storedPin = data?.pin ? String(data.pin).trim() : DEFAULT_FALLBACK_PIN;
    return pin === storedPin;
  } catch (err) {
    console.error("Passcode check notice, falling back to local verification:", err);
    return pin === DEFAULT_FALLBACK_PIN;
  }
}

/**
 * Change the Balance Officer PIN
 */
export async function updateBalancePasscode(
  currentPin: string,
  newPin: string,
  userEmail: string
): Promise<{ success: boolean; message?: string }> {
  if (!newPin || newPin.trim().length < 4) {
    return { success: false, message: "New PIN must be at least 4 characters long." };
  }

  const isValidCurrent = await verifyBalancePasscode(currentPin);
  if (!isValidCurrent) {
    return { success: false, message: "Current PIN is incorrect." };
  }

  try {
    const ref = doc(db, SECURITY_DOC, SECURITY_ITEM);
    await setDoc(
      ref,
      {
        pin: newPin.trim(),
        updatedAt: new Date().toISOString(),
        updatedBy: userEmail || "Authorized Officer",
      },
      { merge: true }
    );
    return { success: true };
  } catch (err) {
    console.error("Failed to update PIN:", err);
    return { success: false, message: "Failed to update PIN in database." };
  }
}

/* =============================================================
   SUMMARY CALCULATIONS
   ============================================================= */

export function calculateBalancingProgress(rows: BalanceRecordRow[]): BalancingProgressSummary {
  const totalRecords = rows.length;
  let checkedRecords = 0;
  let totalCashAndCheque = 0;
  let totalWin = 0;
  let checkedCashAndCheque = 0;
  let checkedWin = 0;

  for (const r of rows) {
    totalCashAndCheque += r.cashAndCheque;
    totalWin += r.win;
    if (r.isChecked) {
      checkedRecords++;
      checkedCashAndCheque += r.cashAndCheque;
      checkedWin += r.win;
    }
  }

  totalCashAndCheque = roundToTwoDecimals(totalCashAndCheque);
  totalWin = roundToTwoDecimals(totalWin);
  checkedCashAndCheque = roundToTwoDecimals(checkedCashAndCheque);
  checkedWin = roundToTwoDecimals(checkedWin);

  const pendingRecords = totalRecords - checkedRecords;
  const pendingCashAndCheque = roundToTwoDecimals(totalCashAndCheque - checkedCashAndCheque);
  const pendingWin = roundToTwoDecimals(totalWin - checkedWin);
  const totalBalance = calculateRecordBalance(totalCashAndCheque, totalWin);
  const percentChecked = totalRecords > 0 ? Math.round((checkedRecords / totalRecords) * 100) : 0;

  return {
    totalRecords,
    checkedRecords,
    pendingRecords,
    totalCashAndCheque,
    totalWin,
    totalBalance,
    checkedCashAndCheque,
    checkedWin,
    pendingCashAndCheque,
    pendingWin,
    percentChecked,
  };
}

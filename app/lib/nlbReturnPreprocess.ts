// app/lib/nlbReturnPreprocess.ts
// Authoritative engine for NLB Agent Return reports

import * as XLSX from "xlsx";
import { applyNlbAgentMapping } from "./nlbPreprocess";

/* =====================================================
   CONSTANTS & TYPES
   ===================================================== */

export const ALLOWED_RETURN_CODES = [
  "ADE",
  "DNE",
  "GSE",
  "HAE",
  "MPE",
  "MSE",
  "NJE",
  "SDE",
] as const;

export type ReturnLotteryCode = (typeof ALLOWED_RETURN_CODES)[number];

export const INVALID_RETURN_FILENAME_ERROR =
  "Invalid return filename. Allowed return codes are: ADE, DNE, GSE, HAE, MPE, MSE, NJE, SDE.";

// Shorthand aliases mapping to standard NLB codes
const RETURN_CODE_ALIASES: Record<string, ReturnLotteryCode> = {
  ADE: "ADE",
  DNE: "DNE",
  GSE: "GSE",
  HAE: "HAE",
  MPE: "MPE",
  MSE: "MSE",
  NJE: "NJE",
  SDE: "SDE",
  // Legacy shorthand codes:
  MSM: "MSE",
  MPM: "MPE",
  GSM: "GSE",
  AM: "ADE",
  HM: "HAE",
  DNM: "DNE",
  NJM: "NJE",
  SDM: "SDE",
};

export type ReturnProcessedRow = {
  drawNumber: string;
  agentCode: string; // N######
  startingBarcode: string; // text representation
  quantity: number; // positive integer
};

export type ReturnPreprocessResult = {
  code: string;
  status: "completed" | "failed";
  drawNumber: string | null;
  rows: ReturnProcessedRow[];
  rowCount: number;
  totalReturnQuantity: number;
  warnings: string[];
  errors: string[];
};

export type Cell = string | number | boolean | null | undefined;

/* =====================================================
   FILENAME VALIDATION
   ===================================================== */

/**
 * Validates return filename according to specification:
 * - Allowed codes: ADE, DNE, GSE, HAE, MPE, MSE, NJE, SDE (and legacy aliases MSM, MPM, etc.)
 * - Case-insensitive
 * - Supports filenames with "return", e.g.:
 *   "MSE.xls", "mse.xlsx", "MSE return.xls", "MSE_return.xls", "MSE RETURN.xls", "MSE_RETURN.xlsx"
 *   "ADE.xls", "ADE return.xlsx", "MSM return.xls"
 * - Normalizes to standard uppercase code (ADE, DNE, GSE, HAE, MPE, MSE, NJE, SDE)
 * - Rejects unrelated filenames (test.xls, ABC.xls, MSE old.xls, MSE sales.xls)
 */
export function validateReturnFilename(
  filename: string
): { valid: boolean; code: string | null; rawCode?: string; error: string | null } {
  if (!filename || typeof filename !== "string") {
    return { valid: false, code: null, error: "No filename provided." };
  }

  const trimmed = filename.trim();

  // Check file extension (.xls or .xlsx)
  const extMatch = trimmed.match(/\.(xlsx?)$/i);
  if (!extMatch) {
    return { valid: false, code: null, error: INVALID_RETURN_FILENAME_ERROR };
  }

  // Strip extension
  const base = trimmed.replace(/\.(xlsx?)$/i, "").trim();

  // Regex for allowed codes (official 8 codes + legacy shorthands)
  const codeGroup = "ADE|DNE|GSE|HAE|MPE|MSE|NJE|SDE|MSM|MPM|GSM|AM|HM|DNM|NJM|SDM";
  const allowedPattern = new RegExp(
    `^(?:(${codeGroup})(?:[_\\s-]+(?:return|returns))?|(?:(?:return|returns)[_\\s-]+)(${codeGroup}))$`,
    "i"
  );

  const match = base.match(allowedPattern);
  if (!match) {
    return { valid: false, code: null, error: INVALID_RETURN_FILENAME_ERROR };
  }

  const rawCode = (match[1] || match[2]).toUpperCase();
  const normalizedCode = RETURN_CODE_ALIASES[rawCode];

  if (normalizedCode && (ALLOWED_RETURN_CODES as readonly string[]).includes(normalizedCode)) {
    return { valid: true, code: normalizedCode, rawCode, error: null };
  }

  return { valid: false, code: null, error: INVALID_RETURN_FILENAME_ERROR };
}

/* =====================================================
   AGENT CODE NORMALIZATION
   ===================================================== */

/**
 * Normalizes every Agent Code into N######
 * - Trim spaces
 * - Convert to uppercase
 * - Add N if missing
 * - Correct legacy letter O / zero issue (NO -> N0)
 * - Final Agent Code must match: ^N\d{6}$
 * If code cannot safely be normalized, reports an error instead of guessing.
 */
export function normalizeAgentCode(
  raw: string
): { valid: boolean; normalized: string; error: string | null } {
  if (!raw || !raw.trim()) {
    return { valid: false, normalized: "", error: "Empty agent code." };
  }

  let s = raw.trim().toUpperCase();

  // Fix legacy "NO" prefix where letter-O was used instead of digit-0
  s = s.replace(/^NO(?=\d)/, "N0");

  // Case 1: Already has 'N' prefix followed by digits: e.g. N040064, N40064, N40308
  const nMatch = s.match(/^N(\d+)$/);
  if (nMatch) {
    const digits = nMatch[1];
    if (digits.length < 4 || digits.length > 6) {
      return {
        valid: false,
        normalized: s,
        error: `Agent code digit count invalid (${digits.length}): "${raw}". Expected 4-6 digits.`,
      };
    }
    const padded = "N" + digits.padStart(6, "0");
    if (/^N\d{6}$/.test(padded)) {
      return { valid: true, normalized: padded, error: null };
    }
  }

  // Case 2: Pure digits without 'N': e.g. 040064, 40064, 40308
  const dMatch = s.match(/^\d+$/);
  if (dMatch) {
    const digits = dMatch[0];
    if (digits.length < 4 || digits.length > 6) {
      return {
        valid: false,
        normalized: s,
        error: `Agent code digit count invalid (${digits.length}): "${raw}". Expected 4-6 digits.`,
      };
    }
    const padded = "N" + digits.padStart(6, "0");
    if (/^N\d{6}$/.test(padded)) {
      return { valid: true, normalized: padded, error: null };
    }
  }

  return {
    valid: false,
    normalized: s,
    error: `Cannot safely normalize agent code: "${raw}". Expected format N######.`,
  };
}

/* =====================================================
   CELL EXTRACTION & CONVERSION HELPERS
   ===================================================== */

export function cellToString(value: Cell): string {
  if (value == null) return "";
  if (typeof value === "boolean") return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    // Integer within safe range
    if (Number.isSafeInteger(Math.trunc(value))) {
      return String(Math.trunc(value));
    }
    // High precision number (e.g. 14 digit barcode stored as numeric)
    return Math.trunc(value).toFixed(0);
  }
  const s = String(value).trim();
  // Handle scientific notation strings (e.g. "8.006317010325E+13")
  if (/e/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && Number.isSafeInteger(Math.trunc(n))) {
      return String(Math.trunc(n));
    }
  }
  return s;
}

export function cellToDigits(value: Cell): string {
  return cellToString(value).replace(/[^\d]/g, "");
}

function isTotalRow(row: Cell[]): boolean {
  return row.some(
    (c) => typeof c === "string" && /TOTAL/i.test(c)
  );
}

function isEmptyRow(row: Cell[]): boolean {
  return row.every((c) => {
    if (c == null) return true;
    if (typeof c === "string") return c.trim() === "";
    return false;
  });
}

/* =====================================================
   DRAW NUMBER EXTRACTION
   ===================================================== */

/**
 * Extracts Draw Number from the raw return report.
 * Examples:
 * - "DRAW NO 6317"
 * - "DRAW NO 6317 DRAW DATE 2026-09-21"
 * - "DRAW NUMBER: 6317"
 * - "D/N 6317"
 * Extracts only pure numeric digits e.g. "6317".
 */
export function extractReturnDrawNumber(data: Cell[][]): string | null {
  const headerRows = data.slice(0, 15);

  // 1. Explicit pattern: DRAW NO 6317, DRAW NUMBER 6317, DRAW NO: 6317, D/N 6317
  for (const row of headerRows) {
    for (const cell of row) {
      if (typeof cell === "string") {
        const match = cell.match(/(?:DRAW\s*(?:NO\.?|NUMBER|#)?|D\/N)\s*[:.-]?\s*(\d{1,6})/i);
        if (match) return match[1];
      }
    }
  }

  // 2. Title row with Draw Number e.g. "MSM RETURN REPORT - 6317" or "6317 MSM RETURN"
  for (const row of headerRows) {
    for (const cell of row) {
      if (typeof cell === "string") {
        const matchPrefix = cell.match(/^\s*(\d{3,6})\s*[-–—\s]+[A-Za-z]/i);
        if (matchPrefix) return matchPrefix[1];

        const matchSuffix = cell.match(/(?:RETURN|RETURNS|REPORT)\s*[-–—:\s]+(\d{3,6})/i);
        if (matchSuffix) return matchSuffix[1];
      }
    }
  }

  // 3. Any cell containing DRAW and another cell in the same row having 3-6 digits
  for (const row of headerRows) {
    const hasDraw = row.some(
      (c) => typeof c === "string" && /DRAW/i.test(c)
    );
    if (hasDraw) {
      for (const cell of row) {
        const s = cellToString(cell).trim();
        if (/^\d{3,6}$/.test(s)) {
          return s;
        }
      }
    }
  }

  // 4. Barcode fallback: 14-digit standard barcode characters 3..7 (e.g. 8006317... -> 6317)
  for (const row of data.slice(2, 25)) {
    for (const cell of row) {
      const digits = cellToDigits(cell);
      if (digits.length >= 13 && digits.length <= 15) {
        // NLB standard format: usually starts with 800 + 4-digit draw number e.g. 800631701...
        if (digits.startsWith("800") && digits.length >= 7) {
          const cand = digits.slice(3, 7).replace(/^0+/, "");
          if (cand.length >= 3 && cand.length <= 5) {
            return cand;
          }
        }
      }
    }
  }

  return null;
}

/* =====================================================
   QUANTITY CALCULATION (BigInt precision safety)
   ===================================================== */

/**
 * Calculates Quantity = TO - FROM + 1
 * Uses BigInt to ensure zero precision loss for 14+ digit barcodes.
 * Quantity must be a positive integer.
 */
export function calculateReturnQuantity(
  fromStr: string,
  toStr: string
): { valid: boolean; quantity: number; error: string | null } {
  try {
    const fromBig = BigInt(fromStr);
    const toBig = BigInt(toStr);

    if (toBig < fromBig) {
      return {
        valid: false,
        quantity: 0,
        error: `Invalid barcode range: TO (${toStr}) is less than FROM (${fromStr}).`,
      };
    }

    const qtyBig = toBig - fromBig + BigInt(1);

    if (qtyBig <= BigInt(0)) {
      return {
        valid: false,
        quantity: 0,
        error: `Calculated quantity must be positive, got ${qtyBig.toString()}.`,
      };
    }

    if (qtyBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      return {
        valid: false,
        quantity: 0,
        error: `Calculated quantity too large: ${qtyBig.toString()}.`,
      };
    }

    return { valid: true, quantity: Number(qtyBig), error: null };
  } catch {
    return {
      valid: false,
      quantity: 0,
      error: `Cannot compute quantity from barcodes FROM="${fromStr}", TO="${toStr}".`,
    };
  }
}

/* =====================================================
   ROW PARSING & DETECTION
   ===================================================== */

type RawReturnRow = {
  sourceRowIndex: number;
  rawAgentCode: string;
  fromBarcode: string;
  toBarcode: string;
};

/**
 * Detect agent code in a single row.
 * Prioritizes:
 * 1. Cell with 'N' or 'NO' prefix followed by 4-6 digits (e.g. N040064, NO40444)
 * 2. 5-6 digit string/number that does not match the draw number
 */
function detectAgentCodeInReturnRow(row: Cell[], drawNumber: string | null): string | null {
  // First pass: explicit N-prefix
  for (const cell of row) {
    const s = cellToString(cell);
    if (!s) continue;
    if (/^N[O0]?\d{4,6}$/i.test(s.toUpperCase())) {
      return s;
    }
  }

  // Second pass: pure 5-6 digit numbers (excluding the draw number)
  for (const cell of row) {
    const s = cellToString(cell);
    if (!s) continue;
    if (/^\d{5,6}$/.test(s)) {
      if (drawNumber && s === drawNumber) continue;
      return s;
    }
  }

  // Third pass: 4-digit number if it does not equal the draw number
  for (const cell of row) {
    const s = cellToString(cell);
    if (!s) continue;
    if (/^\d{4}$/.test(s)) {
      if (drawNumber && s === drawNumber) continue;
      return s;
    }
  }

  return null;
}

/**
 * Detect barcode-like values (10+ digits) in a row.
 * Returns exact strings without conversion to float.
 */
function detectBarcodesInReturnRow(row: Cell[]): string[] {
  const barcodes: string[] = [];
  for (const cell of row) {
    const digits = cellToDigits(cell);
    // Standard NLB return barcodes are usually 13-15 digits (e.g. 80063170103250)
    if (digits.length >= 10) {
      barcodes.push(digits);
    }
  }
  return barcodes;
}

/**
 * Parses raw return report sheet into extracted return rows.
 * Preserves duplicate agent rows separately!
 */
export function extractReturnBarcodeRanges(
  data: Cell[][],
  drawNumber: string | null
): { rows: RawReturnRow[]; parseWarnings: string[]; parseErrors: string[] } {
  const rows: RawReturnRow[] = [];
  const parseWarnings: string[] = [];
  const parseErrors: string[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    if (isEmptyRow(row)) continue;
    if (isTotalRow(row)) continue;

    // Detect agent code
    const rawAgent = detectAgentCodeInReturnRow(row, drawNumber);
    if (!rawAgent) continue;

    // Detect barcodes
    const barcodes = detectBarcodesInReturnRow(row);

    if (barcodes.length < 2) {
      if (barcodes.length === 1) {
        parseErrors.push(
          `Row ${i + 1}: Agent "${rawAgent}" has only 1 barcode (${barcodes[0]}). Both FROM and TO barcodes are required.`
        );
      }
      continue;
    }

    if (barcodes.length > 2) {
      parseWarnings.push(
        `Row ${i + 1}: Agent "${rawAgent}" has ${barcodes.length} barcode-like values. Using the first two as FROM and TO.`
      );
    }

    rows.push({
      sourceRowIndex: i + 1,
      rawAgentCode: rawAgent,
      fromBarcode: barcodes[0],
      toBarcode: barcodes[1],
    });
  }

  return { rows, parseWarnings, parseErrors };
}

/* =====================================================
   MAIN PREPROCESSING FUNCTION
   ===================================================== */

/**
 * Preprocesses a raw return worksheet.
 * Authoritative pipeline:
 * 1. Extract and validate Draw Number
 * 2. Parse return barcode ranges (FROM and TO)
 * 3. Normalize Agent Codes to N###### (strict ^N\d{6}$)
 * 4. Verify TO >= FROM and compute Quantity = TO - FROM + 1
 * 5. Preserve multiple return rows for the same agent in original order
 * 6. Compute Total Return Quantity for UI
 */
export function preprocessReturnSheet(
  data: Cell[][],
  code: string,
  agentAliases?: Record<string, string>
): ReturnPreprocessResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Draw Number
  const drawNumber = extractReturnDrawNumber(data);
  if (!drawNumber) {
    return {
      code,
      status: "failed",
      drawNumber: null,
      rows: [],
      rowCount: 0,
      totalReturnQuantity: 0,
      warnings: [],
      errors: ["Draw Number could not be detected from the return report."],
    };
  }

  // 2. Extract Return Barcode Ranges
  const {
    rows: rawRows,
    parseWarnings,
    parseErrors,
  } = extractReturnBarcodeRanges(data, drawNumber);

  warnings.push(...parseWarnings);
  errors.push(...parseErrors);

  if (rawRows.length === 0) {
    return {
      code,
      status: "failed",
      drawNumber,
      rows: [],
      rowCount: 0,
      totalReturnQuantity: 0,
      warnings,
      errors: [
        ...errors,
        "No valid agent return rows found in the uploaded file.",
      ],
    };
  }

  // 3. Normalize Agent Codes, Starting Barcode, and Calculate Quantities
  const processedRows: ReturnProcessedRow[] = [];
  let totalReturnQuantity = 0;

  for (const raw of rawRows) {
    // Validate & Normalize Agent Code
    const agentResult = normalizeAgentCode(raw.rawAgentCode);
    if (!agentResult.valid) {
      errors.push(`Row ${raw.sourceRowIndex}: ${agentResult.error}`);
      continue;
    }

    // Validate Starting Barcode (FROM)
    if (!raw.fromBarcode) {
      errors.push(`Row ${raw.sourceRowIndex}: Missing Starting Barcode (FROM).`);
      continue;
    }

    // Validate TO Barcode
    if (!raw.toBarcode) {
      errors.push(`Row ${raw.sourceRowIndex}: Missing TO barcode.`);
      continue;
    }

    // Check Barcode Precision
    if (raw.fromBarcode.length > 18) {
      warnings.push(
        `Row ${raw.sourceRowIndex}: Starting Barcode length (${raw.fromBarcode.length} digits) is unusually long.`
      );
    }

    // Calculate Quantity: TO - FROM + 1
    const qtyResult = calculateReturnQuantity(raw.fromBarcode, raw.toBarcode);
    if (!qtyResult.valid) {
      errors.push(`Row ${raw.sourceRowIndex}: ${qtyResult.error}`);
      continue;
    }

    if (qtyResult.quantity <= 0) {
      errors.push(
        `Row ${raw.sourceRowIndex}: Quantity must be positive, got ${qtyResult.quantity}.`
      );
      continue;
    }

    totalReturnQuantity += qtyResult.quantity;

    const mappedAgentCode = agentAliases
      ? applyNlbAgentMapping(agentResult.normalized, agentAliases)
      : agentResult.normalized;

    // DO NOT merge multiple returns for the same agent — keep each allocation separate!
    processedRows.push({
      drawNumber,
      agentCode: mappedAgentCode,
      startingBarcode: raw.fromBarcode, // Treated strictly as text
      quantity: qtyResult.quantity,
    });
  }

  // If any critical errors occurred during row processing, mark file as failed
  if (errors.length > 0 || processedRows.length === 0) {
    return {
      code,
      status: "failed",
      drawNumber,
      rows: processedRows,
      rowCount: processedRows.length,
      totalReturnQuantity,
      warnings,
      errors,
    };
  }

  return {
    code,
    status: "completed",
    drawNumber,
    rows: processedRows,
    rowCount: processedRows.length,
    totalReturnQuantity,
    warnings,
    errors: [],
  };
}

/* =====================================================
   CLEAN EXCEL WORKBOOK GENERATOR
   ===================================================== */

/**
 * Generates the clean output Excel file.
 * Exactly 4 columns:
 *   A = Draw Number
 *   B = Agent Code
 *   C = Starting Barcode
 *   D = Quantity
 * Starting Barcode is strictly formatted as TEXT (cell.t = 's', cell.z = '@').
 * No additional columns or summary rows are included.
 */
export function generateReturnCleanedXlsx(rows: ReturnProcessedRow[]): Blob {
  const headers = ["Draw Number", "Agent Code", "Starting Barcode", "Quantity"];
  const aoa: (string | number)[][] = [
    headers,
    ...rows.map((r) => [r.drawNumber, r.agentCode, r.startingBarcode, r.quantity]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Force Starting Barcode column (C) to TEXT type to prevent Excel scientific notation
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let R = range.s.r + 1; R <= range.e.r; R++) {
    const cellRef = XLSX.utils.encode_cell({ r: R, c: 2 });
    const cell = ws[cellRef];
    if (cell) {
      cell.t = "s";
      cell.z = "@";
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });

  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

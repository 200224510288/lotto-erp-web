// app/lib/nlbPreprocess.ts
// Core preprocessing logic for NLB raw Excel reports
// This file is shared between the API route (server) and page (client: types only)

/* =====================================================
   CONSTANTS & TYPES
   ===================================================== */

export const ALLOWED_CODES = [
  "MSE", "MPE", "GSE", "ADE", "HAE", "DNE", "NJE", "SDE",
] as const;

export type LotteryCode = (typeof ALLOWED_CODES)[number];

export type ProcessedRow = {
  drawNumber: string;
  agentCode: string;        // N + 6 digits
  startingBarcode: string;  // text — no precision loss
  quantity: number;         // positive integer
};

export type PreprocessResult = {
  code: string;
  status: "completed" | "failed";
  reportType?: "sales_summary";
  drawNumber: string | null;
  rows: ProcessedRow[];
  rowCount: number;
  warnings: string[];
  errors: string[];
};

export type PurchaseRow = {
  drawNumber: string;
  drawDate: string;
  txType: "PURCHASE" | "RETURN";
  txDate: string;
  serialNumber: string;
  reference: string;
  startingBarcode: string;
  endingBarcode: string;
  quantity: number;
};

export type PurchaseReportResult = {
  code: string;
  status: "completed" | "failed";
  reportType: "purchase_range";
  gameName: string | null;
  drawNumber: string | null;
  drawDate: string | null;
  rows: PurchaseRow[];
  rowCount: number;
  totalPurchase: number;
  totalReturn: number;
  netQuantity: number;
  warnings: string[];
  errors: string[];
};

export type AnyPreprocessResult = PreprocessResult | PurchaseReportResult;

type Cell = string | number | boolean | null | undefined;

/* =====================================================
   FILENAME VALIDATION
   ===================================================== */

export function validateFilename(
  filename: string
): { valid: boolean; code: string | null; error: string | null; isStock?: boolean } {
  if (!filename) {
    return { valid: false, code: null, error: "No filename provided." };
  }

  // Strip .xls / .xlsx extension
  const base = filename.replace(/\.(xlsx?)$/i, "").trim();
  const isStock = /_stock|_purchase/i.test(base);
  const cleanCode = base.replace(/(_stock|_purchase)$/i, "").trim().toUpperCase();

  // Allow standard codes or any 2-5 letter lottery code (e.g. MST, GSM, ADE, MSE)
  if ((ALLOWED_CODES as readonly string[]).includes(cleanCode) || /^[A-Z]{2,5}$/.test(cleanCode)) {
    return { valid: true, code: cleanCode, error: null, isStock };
  }

  return {
    valid: false,
    code: null,
    error: `Invalid filename "${filename}". Allowed lottery codes are MSE, ADE, MST, GSE, etc.`,
    isStock,
  };
}

/* =====================================================
   AGENT CODE NORMALIZATION
   ===================================================== */

export function normalizeAgentCode(
  raw: string
): { valid: boolean; normalized: string; error: string | null } {
  if (!raw || !raw.trim()) {
    return { valid: false, normalized: "", error: "Empty agent code" };
  }

  let s = raw.trim().toUpperCase();

  // Fix legacy "NO" prefix where letter-O was used instead of digit-0
  s = s.replace(/^NO/, "N0");

  // Pattern: N + digits
  const nMatch = s.match(/^N(\d+)$/);
  if (nMatch) {
    const digits = nMatch[1];
    if (digits.length < 4 || digits.length > 6) {
      return {
        valid: false,
        normalized: s,
        error: `Agent code digit count invalid (${digits.length}): "${raw}"`,
      };
    }
    return { valid: true, normalized: "N" + digits.padStart(6, "0"), error: null };
  }

  // Pattern: pure digits
  const dMatch = s.match(/^\d+$/);
  if (dMatch) {
    const digits = dMatch[0];
    if (digits.length < 4 || digits.length > 6) {
      return {
        valid: false,
        normalized: s,
        error: `Agent code digit count invalid (${digits.length}): "${raw}"`,
      };
    }
    return { valid: true, normalized: "N" + digits.padStart(6, "0"), error: null };
  }

  return {
    valid: false,
    normalized: s,
    error: `Cannot normalize agent code: "${raw}"`,
  };
}

/* =====================================================
   CELL HELPERS
   ===================================================== */

function cellToString(value: Cell): string {
  if (value == null) return "";
  if (typeof value === "boolean") return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    // Safe integer → exact string; otherwise try best-effort
    if (Number.isSafeInteger(Math.trunc(value))) {
      return String(Math.trunc(value));
    }
    return Math.trunc(value).toFixed(0);
  }
  const s = String(value).trim();
  // Handle scientific notation strings (e.g., "8.00631001075E+13")
  if (/e/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && Number.isSafeInteger(Math.trunc(n))) {
      return String(Math.trunc(n));
    }
  }
  return s;
}

function cellToDigits(value: Cell): string {
  return cellToString(value).replace(/[^\d]/g, "");
}

function isTotalRow(row: Cell[]): boolean {
  return row.some(
    (c) => typeof c === "string" && c.toUpperCase().includes("TOTAL")
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

export function extractDrawNumber(data: Cell[][]): string | null {
  const headerRows = data.slice(0, 15);

  // 1. Explicit DRAW NO / DRAW / D/N pattern anywhere in cell
  for (const row of headerRows) {
    for (const cell of row) {
      if (typeof cell === "string") {
        const match = cell.match(/(?:DRAW\s*(?:NO\.?|NUMBER|#)?|D\/N)\s*[:.-]?\s*(\d+)/i);
        if (match) return match[1];
      }
    }
  }

  // 2. Title row starting with draw number, e.g.:
  //    "881  ADA SAMPATHA-THURSDAY SALES SUMMARY"
  //    "881 - ADA SAMPATHA SALES SUMMARY"
  for (const row of headerRows) {
    for (const cell of row) {
      if (typeof cell === "string") {
        const match = cell.match(/^\s*(\d{1,6})\s*[-–—\s]+[A-Za-z].*(?:SALES|SUMMARY)/i);
        if (match) return match[1];
      }
    }
  }

  // 3. Title row with draw number following SALES / SUMMARY, e.g.:
  //    "ADA SAMPATHA SALES SUMMARY - 881"
  for (const row of headerRows) {
    for (const cell of row) {
      if (typeof cell === "string") {
        const match = cell.match(/(?:SALES|SUMMARY)\s*[-–—:\s]+(\d{1,6})/i);
        if (match) return match[1];
      }
    }
  }

  // 4. Any row containing SALES or SUMMARY where another cell has 1-6 digits
  for (const row of headerRows) {
    const hasSummaryKeyword = row.some(
      (c) => typeof c === "string" && /(?:SALES|SUMMARY)/i.test(c)
    );
    if (hasSummaryKeyword) {
      for (const cell of row) {
        const s = cellToString(cell).trim();
        if (/^\d{1,6}$/.test(s)) {
          return s;
        }
      }
    }
  }

  // 5. Any cell in top 6 rows starting with a number and followed by letters
  for (let i = 0; i < Math.min(6, data.length); i++) {
    const row = data[i];
    for (const cell of row) {
      if (typeof cell === "string") {
        const match = cell.match(/^\s*(\d{1,6})\s+[-–—\s]*[A-Za-z]/i);
        if (match) return match[1];
      }
    }
  }

  // 6. Barcode fallback: extract draw number from standard 14-digit barcodes
  // e.g. 86008810018000 -> characters 3..7 are "0881" -> draw number "881"
  for (const row of data.slice(2, 20)) {
    for (const cell of row) {
      const digits = cellToDigits(cell);
      if (digits.length === 14) {
        const candidate = digits.slice(3, 7).replace(/^0+/, "");
        if (candidate.length > 0 && candidate.length <= 5) {
          return candidate;
        }
      }
    }
  }

  return null;
}

/* =====================================================
   ROW DETECTION
   ===================================================== */

type ParsedAgentRow = {
  rowIndex: number;
  rawAgentCode: string;
  fromBarcode: string;
  toBarcode: string;
};

/**
 * Detect an agent code in a row.
 * Scans left-to-right — the first match wins (agent codes appear before quantities).
 */
function detectAgentCodeInRow(row: Cell[]): string | null {
  for (const cell of row) {
    const s = cellToString(cell);
    if (!s) continue;
    const upper = s.toUpperCase();

    // N-prefixed: N040064, NO40444, N40064 etc.
    if (/^N[O0]?\d{4,6}$/i.test(upper)) return s;

    // Pure 5-6 digit number (avoids draw numbers ≤4 digits and quantities)
    if (/^\d{5,6}$/.test(s)) return s;
  }
  return null;
}

/**
 * Collect all barcode-like values (10+ digits) from a row, left-to-right.
 */
function detectBarcodesInRow(row: Cell[]): string[] {
  const barcodes: string[] = [];
  for (const cell of row) {
    const digits = cellToDigits(cell);
    if (digits.length >= 10) barcodes.push(digits);
  }
  return barcodes;
}

/**
 * Parse all data rows from the sheet.
 */
function parseDataRows(data: Cell[][]): {
  rows: ParsedAgentRow[];
  parseWarnings: string[];
} {
  const rows: ParsedAgentRow[] = [];
  const parseWarnings: string[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    if (isEmptyRow(row)) continue;
    if (isTotalRow(row)) continue;

    const rawAgent = detectAgentCodeInRow(row);
    if (!rawAgent) continue;

    const barcodes = detectBarcodesInRow(row);

    if (barcodes.length < 2) {
      if (barcodes.length === 1) {
        parseWarnings.push(
          `Row ${i + 1}: Agent "${rawAgent}" has only 1 barcode (${barcodes[0]}). Need both FROM and TO.`
        );
      }
      // Row has agent code but no/insufficient barcodes — skip
      continue;
    }

    if (barcodes.length > 2) {
      parseWarnings.push(
        `Row ${i + 1}: Agent "${rawAgent}" has ${barcodes.length} barcode-like values. Using first two as FROM/TO.`
      );
    }

    rows.push({
      rowIndex: i,
      rawAgentCode: rawAgent,
      fromBarcode: barcodes[0],
      toBarcode: barcodes[1],
    });
  }

  return { rows, parseWarnings };
}

/* =====================================================
   QUANTITY CALCULATION (BigInt for precision safety)
   ===================================================== */

function calculateQuantity(
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
        error: `TO (${toStr}) < FROM (${fromStr})`,
      };
    }

    const qty = toBig - fromBig + BigInt(1);

    if (qty > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { valid: false, quantity: 0, error: `Quantity too large: ${qty}` };
    }

    return { valid: true, quantity: Number(qty), error: null };
  } catch {
    return {
      valid: false,
      quantity: 0,
      error: `Cannot compute quantity from barcodes "${fromStr}" → "${toStr}"`,
    };
  }
}

/* =====================================================
   CONTINUITY CHECK
   ===================================================== */

function checkContinuity(rows: ProcessedRow[]): string[] {
  if (rows.length < 2) return [];

  const warnings: string[] = [];
  const sorted = [...rows].sort((a, b) => {
    if (BigInt(a.startingBarcode) < BigInt(b.startingBarcode)) return -1;
    if (BigInt(a.startingBarcode) > BigInt(b.startingBarcode)) return 1;
    return 0;
  });

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const prevEnd =
      BigInt(prev.startingBarcode) + BigInt(prev.quantity) - BigInt(1);
    const currFrom = BigInt(curr.startingBarcode);
    const expectedNext = prevEnd + BigInt(1);

    if (currFrom > expectedNext) {
      const gap = currFrom - expectedNext;
      warnings.push(
        `Gap: ${gap.toString()} tickets between ${prev.agentCode} (ends ${prevEnd}) and ${curr.agentCode} (starts ${currFrom}).`
      );
    } else if (currFrom < expectedNext) {
      const overlap = expectedNext - currFrom;
      warnings.push(
        `Overlap: ${overlap.toString()} tickets between ${prev.agentCode} (ends ${prevEnd}) and ${curr.agentCode} (starts ${currFrom}).`
      );
    }
  }

  return warnings;
}

/* =====================================================
   MAIN PREPROCESSING FUNCTION
   ===================================================== */

export function applyNlbAgentMapping(
  agentCode: string,
  aliases?: Record<string, string>
): string {
  if (!agentCode || !aliases) return agentCode;
  const raw = agentCode.trim().toUpperCase();
  const digits = raw.replace(/[^\d]/g, "");

  // 1. Direct match
  if (aliases[raw]) return aliases[raw];

  // 2. Normalized N + 6 digits match
  if (digits) {
    const nForm = "N" + digits.padStart(6, "0");
    if (aliases[nForm]) return aliases[nForm];

    // 3. Raw 6 digits match
    const dForm = digits.padStart(6, "0");
    if (aliases[dForm]) return aliases[dForm];

    // 4. Raw unpadded digits
    if (aliases[digits]) return aliases[digits];
  }

  return agentCode;
}

export function preprocessRawSheet(
  data: Cell[][],
  code: string,
  agentAliases?: Record<string, string>
): PreprocessResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Draw number
  const drawNumber = extractDrawNumber(data);
  if (!drawNumber) {
    return {
      code,
      status: "failed",
      drawNumber: null,
      rows: [],
      rowCount: 0,
      warnings: [],
      errors: ["Draw Number could not be detected."],
    };
  }

  // 2. Parse data rows
  const { rows: parsedRows, parseWarnings } = parseDataRows(data);
  warnings.push(...parseWarnings);

  if (parsedRows.length === 0) {
    return {
      code,
      status: "failed",
      drawNumber,
      rows: [],
      rowCount: 0,
      warnings,
      errors: [
        ...errors,
        "No valid agent allocation rows found in the file.",
      ],
    };
  }

  // 3. Normalize + validate each row
  const processedRows: ProcessedRow[] = [];

  for (const parsed of parsedRows) {
    const agentResult = normalizeAgentCode(parsed.rawAgentCode);
    if (!agentResult.valid) {
      errors.push(`Row ${parsed.rowIndex + 1}: ${agentResult.error}`);
      continue;
    }

    // Barcode presence
    if (!parsed.fromBarcode || !parsed.toBarcode) {
      errors.push(`Row ${parsed.rowIndex + 1}: Missing barcode value.`);
      continue;
    }

    // Barcode precision warning
    if (parsed.fromBarcode.length > 15) {
      warnings.push(
        `Row ${parsed.rowIndex + 1}: FROM barcode very long (${parsed.fromBarcode.length} digits). Verify precision.`
      );
    }
    if (parsed.toBarcode.length > 15) {
      warnings.push(
        `Row ${parsed.rowIndex + 1}: TO barcode very long (${parsed.toBarcode.length} digits). Verify precision.`
      );
    }

    // Quantity
    const qtyResult = calculateQuantity(
      parsed.fromBarcode,
      parsed.toBarcode
    );
    if (!qtyResult.valid) {
      errors.push(`Row ${parsed.rowIndex + 1}: ${qtyResult.error}`);
      continue;
    }
    if (qtyResult.quantity <= 0) {
      errors.push(
        `Row ${parsed.rowIndex + 1}: Quantity must be positive, got ${qtyResult.quantity}.`
      );
      continue;
    }

    const mappedAgentCode = agentAliases
      ? applyNlbAgentMapping(agentResult.normalized, agentAliases)
      : agentResult.normalized;

    processedRows.push({
      drawNumber,
      agentCode: mappedAgentCode,
      startingBarcode: parsed.fromBarcode,
      quantity: qtyResult.quantity,
    });
  }

  if (processedRows.length === 0) {
    return {
      code,
      status: "failed",
      drawNumber,
      rows: [],
      rowCount: 0,
      warnings,
      errors: [...errors, "No valid rows remain after validation."],
    };
  }

  // 4. Continuity check
  warnings.push(...checkContinuity(processedRows));

  // Determine final status: completed if at least some rows succeeded
  const hasRowErrors = errors.length > 0;

  return {
    code,
    status: "completed",
    drawNumber,
    rows: processedRows,
    rowCount: processedRows.length,
    warnings: hasRowErrors
      ? [...warnings, `${errors.length} row(s) had errors and were excluded.`]
      : warnings,
    errors,
  };
}

/* =====================================================
   PURCHASE & PURCHASE RETURN REPORT (STOCK REPORT)
   ===================================================== */

function formatExcelDate(val: Cell): string {
  if (val == null) return "";
  if (typeof val === "number") {
    // Excel serial date (e.g. 46276 -> 2026-09-11)
    if (val >= 30000 && val <= 60000) {
      try {
        const d = new Date((val - 25569) * 86400 * 1000);
        return d.toISOString().slice(0, 10);
      } catch {
        return String(val);
      }
    }
    return String(val);
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return s;
}

function cleanBarcodeNumber(val: Cell): string {
  if (val == null) return "";
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return "";
    return String(Math.round(val));
  }
  const s = String(val).trim();
  if (/e/i.test(s)) {
    const n = Number(s);
    if (!Number.isNaN(n)) return String(Math.round(n));
  }
  return s.replace(/[^\d]/g, "");
}

/**
 * Check whether a sheet is a Purchase and Purchase Return Report
 */
export function isPurchaseReportSheet(data: Cell[][]): boolean {
  for (const row of data.slice(0, 10)) {
    for (const cell of row) {
      if (
        typeof cell === "string" &&
        /Purchase\s+and\s+Purcha[se]+\s+Return\s+Report/i.test(cell)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Preprocess Purchase and Purchase Return Report sheet into structured rows
 */
export function preprocessPurchaseSheet(
  data: Cell[][],
  code: string
): PurchaseReportResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  let gameName: string | null = null;
  let drawNumber: string | null = null;
  let drawDate: string | null = null;

  // Extract game name, draw number, draw date from header
  for (const row of data.slice(0, 12)) {
    for (const cell of row) {
      if (typeof cell === "string") {
        const m = cell.match(
          /^(.*?)\s*\(\s*DRAW\s*NO\s*&\s*DATE\s*\*(\d+)\*\s*(\d{4}-\d{2}-\d{2})\s*\)/i
        );
        if (m) {
          gameName = m[1].trim();
          drawNumber = m[2].trim();
          drawDate = m[3].trim();
          break;
        }

        const starMatch = cell.match(/\*(\d{2,6})\*/);
        if (starMatch && !drawNumber) {
          drawNumber = starMatch[1];
        }

        const dateMatch = cell.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch && !drawDate) {
          drawDate = dateMatch[1];
        }
      }
    }
    if (drawNumber && drawDate) break;
  }

  if (!drawNumber) {
    errors.push("Draw Number could not be detected in Purchase Report header.");
  }

  // Parse transaction blocks (PURCHASE vs RETURN)
  let currentTxType: "PURCHASE" | "RETURN" | null = null;
  const rows: PurchaseRow[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    for (const cell of row) {
      if (typeof cell === "string") {
        const upper = cell.trim().toUpperCase();
        if (upper === "PURCHASE" || upper.startsWith("PURCHASE ")) {
          currentTxType = "PURCHASE";
          break;
        } else if (upper === "RETURN" || upper.startsWith("RETURN ")) {
          currentTxType = "RETURN";
          break;
        } else if (upper === "NET" || upper.startsWith("NET ")) {
          currentTxType = null;
          break;
        }
      }
    }

    if (!currentTxType) continue;

    const barcodes: string[] = [];
    for (const cell of row) {
      const b = cleanBarcodeNumber(cell);
      if (b.length >= 10) barcodes.push(b);
    }

    if (barcodes.length >= 2) {
      let txDate = "";
      let serial = "";
      let ref = "";
      let qty = 0;

      for (const cell of row) {
        if (typeof cell === "number") {
          if (cell >= 30000 && cell <= 60000 && !txDate) {
            txDate = formatExcelDate(cell);
          } else if (cell < 1000000 && cell !== 0 && !qty) {
            qty = Math.abs(cell);
          }
        } else if (typeof cell === "string") {
          const s = cell.trim();
          if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(s) && !txDate) {
            txDate = formatExcelDate(s);
          } else if (/^[A-Z]\d{5,10}$/i.test(s) && !serial) {
            serial = s;
          } else if (/^[A-Z]$/i.test(s) && !ref) {
            ref = s;
          }
        }
      }

      if (!qty && barcodes.length >= 2) {
        try {
          qty = Number(BigInt(barcodes[1]) - BigInt(barcodes[0]) + BigInt(1));
        } catch {
          qty = 0;
        }
      }

      rows.push({
        drawNumber: drawNumber || "",
        drawDate: drawDate || "",
        txType: currentTxType,
        txDate,
        serialNumber: serial,
        reference: ref,
        startingBarcode: barcodes[0],
        endingBarcode: barcodes[1],
        quantity: qty,
      });
    }
  }

  const totalPurchase = rows
    .filter((r) => r.txType === "PURCHASE")
    .reduce((sum, r) => sum + r.quantity, 0);

  const totalReturn = rows
    .filter((r) => r.txType === "RETURN")
    .reduce((sum, r) => sum + r.quantity, 0);

  const netQuantity = totalPurchase - totalReturn;

  const status = errors.length === 0 && rows.length > 0 ? "completed" : "failed";

  return {
    code: code.toUpperCase(),
    status,
    reportType: "purchase_range",
    gameName,
    drawNumber,
    drawDate,
    rows,
    rowCount: rows.length,
    totalPurchase,
    totalReturn,
    netQuantity,
    warnings,
    errors,
  };
}

/**
 * Generate standard clean 9-column XLSX for Purchase Range detailed file
 */
export function generatePurchaseXlsx(rows: PurchaseRow[]): Blob {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx");
  const header = [
    "Draw Number",
    "Draw Date",
    "Transaction Type",
    "Transaction Date",
    "Serial Number",
    "Reference",
    "Starting Barcode",
    "Ending Barcode",
    "Quantity",
  ];

  const aoa: (string | number)[][] = [
    header,
    ...rows.map((r) => [
      r.drawNumber,
      r.drawDate,
      r.txType,
      r.txDate,
      r.serialNumber,
      r.reference,
      r.startingBarcode,
      r.endingBarcode,
      r.quantity,
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Force barcode columns G (col 6) and H (col 7) to TEXT
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let R = range.s.r + 1; R <= range.e.r; R++) {
    for (const C of [6, 7]) {
      const ref = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[ref];
      if (cell) {
        cell.t = "s";
        cell.z = "@";
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stock");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });

  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

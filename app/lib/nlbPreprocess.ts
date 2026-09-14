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
  drawNumber: string | null;
  rows: ProcessedRow[];
  rowCount: number;
  warnings: string[];
  errors: string[];
};

type Cell = string | number | boolean | null | undefined;

/* =====================================================
   FILENAME VALIDATION
   ===================================================== */

export function validateFilename(
  filename: string
): { valid: boolean; code: LotteryCode | null; error: string | null } {
  if (!filename) {
    return { valid: false, code: null, error: "No filename provided." };
  }

  // Strip .xls / .xlsx extension
  const base = filename.replace(/\.(xlsx?)$/i, "").trim();
  const upper = base.toUpperCase();

  if ((ALLOWED_CODES as readonly string[]).includes(upper)) {
    return { valid: true, code: upper as LotteryCode, error: null };
  }

  return {
    valid: false,
    code: null,
    error: `Invalid filename "${filename}". Allowed file names are: ${ALLOWED_CODES.join(", ")}.`,
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

export function preprocessRawSheet(
  data: Cell[][],
  code: string
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

    processedRows.push({
      drawNumber,
      agentCode: agentResult.normalized,
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

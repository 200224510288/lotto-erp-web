// app/lib/fileValidation.ts
import * as XLSX from "xlsx";

export type DetectedFileType = "sales" | "raw_sales" | "return" | "unrecognized";

export interface FileInspectionResult {
  detectedType: DetectedFileType;
  isSales: boolean;
  isRawSales: boolean;
  isReturn: boolean;
  summarySheetFound: boolean;
  summarySheetName: string | null;
  cellValues?: {
    a2: string;
    a3: string;
    c3: string;
    d3: string;
    e3: string;
    b4: string;
    b14: string;
    c14: string;
    h14: string;
    i14: string;
  };
}

export interface FileValidationResult {
  isValid: boolean;
  detectedType: DetectedFileType;
  error: string | null;
}

export const RAW_SALES_FILE_ERROR =
  "This is a raw sales file. Please upload the processed Sales Summary file.";
export const SALES_PAGE_ERROR_FOR_RETURN =
  "This is a Returns file. Please upload it on the Returns page.";
export const RETURNS_PAGE_ERROR_FOR_SALES =
  "This is a Sales file. Please upload it on the Sales page.";
export const UNRECOGNIZED_FILE_ERROR =
  "Unrecognized or ambiguous file format. Please ask staff to check the file.";

/**
 * Safely extracts trimmed string value from a worksheet cell.
 */
function getCleanCellValue(sheet: XLSX.WorkSheet, cellAddress: string): string {
  const cell = sheet[cellAddress];
  if (!cell || cell.v === undefined || cell.v === null) return "";
  return String(cell.v).trim();
}

/**
 * Checks if a worksheet is a raw sales file:
 * - Has an ITEM line (starts with or contains "ITEM" / "ITEM :")
 * - Has a DRAW NO line (contains "DRAW NO" / "DRAW NUMBER" / "D/N")
 * - Headers in columns D, F, H, and I:
 *   - Col D (index 3): NAME
 *   - Col F (index 5): FROM
 *   - Col H (index 7): TO
 *   - Col I (index 8): QTY
 */
function isRawSalesSheet(sheet: XLSX.WorkSheet): boolean {
  const data = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  }) as (string | number | null | undefined)[][];

  const openingRows = data.slice(0, 35);

  let hasItemLine = false;
  let hasDrawNoLine = false;

  for (const row of openingRows) {
    if (!row) continue;
    for (const cell of row) {
      if (cell != null) {
        const text = String(cell).trim().toUpperCase();
        if (text.startsWith("ITEM") || text.includes("ITEM :") || text.includes("ITEM:")) {
          hasItemLine = true;
        }
        if (text.includes("DRAW NO") || text.includes("DRAW NUMBER")) {
          hasDrawNoLine = true;
        }
      }
    }
  }

  let hasDFHIHeaders = false;
  for (const row of openingRows) {
    if (!row) continue;
    const colD = row[3] != null ? String(row[3]).trim().toUpperCase() : "";
    const colF = row[5] != null ? String(row[5]).trim().toUpperCase() : "";
    const colH = row[7] != null ? String(row[7]).trim().toUpperCase() : "";
    const colI = row[8] != null ? String(row[8]).trim().toUpperCase() : "";

    if (
      (colD === "NAME" || colD === "AGENT NAME") &&
      colF === "FROM" &&
      colH === "TO" &&
      (colI === "QTY" || colI.startsWith("QTY"))
    ) {
      hasDFHIHeaders = true;
      break;
    }
  }

  return hasItemLine && hasDrawNoLine && hasDFHIHeaders;
}

/**
 * Checks if a worksheet is a processed Sales Summary file:
 * - In the Summary sheet:
 *   1) Title contains SALES SUMMARY (case-insensitive, trimmed; ignore lottery name, draw number, filename)
 *   2) Row 3 (1-indexed row 3, 0-indexed row 2) has:
 *      NAME in A, FROM in C, TO in D, and QTY in E
 *   3) Following rows match that layout (Col A: Agent Name/Code, Col C: FROM, Col D: TO, Col E: QTY)
 */
function isProcessedSalesSummarySheet(sheet: XLSX.WorkSheet): boolean {
  const data = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  }) as (string | number | null | undefined)[][];

  if (data.length < 4) return false;

  // 1. Check title in opening rows (rows 1-5)
  const openingRows = data.slice(0, 10);
  const hasSalesSummaryTitle = openingRows.some((row) =>
    row?.some((cell) => {
      if (cell == null) return false;
      return String(cell).trim().toUpperCase().includes("SALES SUMMARY");
    })
  );

  if (!hasSalesSummaryTitle) return false;

  // 2. Row 3 (index 2) has NAME in A (0), FROM in C (2), TO in D (3), QTY in E (4)
  // Check index 2 primarily, or look within the first 5 rows for the exact A, C, D, E layout
  let headerRowIndex = -1;
  const candidateIndices = [2, 1, 3]; // Row 3 is index 2

  for (const idx of candidateIndices) {
    const row = data[idx];
    if (!row) continue;
    const colA = row[0] != null ? String(row[0]).trim().toUpperCase() : "";
    const colC = row[2] != null ? String(row[2]).trim().toUpperCase() : "";
    const colD = row[3] != null ? String(row[3]).trim().toUpperCase() : "";
    const colE = row[4] != null ? String(row[4]).trim().toUpperCase() : "";

    if (
      (colA === "NAME" || colA === "AGENT NAME") &&
      colC === "FROM" &&
      colD === "TO" &&
      (colE === "QTY" || colE.startsWith("QTY"))
    ) {
      headerRowIndex = idx;
      break;
    }
  }

  if (headerRowIndex === -1) return false;

  // 3. Following rows match that layout
  let hasValidFollowingRows = false;
  for (let r = headerRowIndex + 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row.length === 0) continue;
    const a = row[0] != null ? String(row[0]).trim() : "";
    const c = row[2] != null ? String(row[2]).trim() : "";
    const d = row[3] != null ? String(row[3]).trim() : "";
    const e = row[4] != null ? String(row[4]).trim() : "";

    // Skip blank row
    if (!a && !c && !d && !e) continue;

    // Check for a data row matching agent code, barcodes, and quantity
    if (a && c && d && e) {
      if (!a.toUpperCase().includes("TOTAL")) {
        hasValidFollowingRows = true;
        break;
      }
    }
  }

  return hasValidFollowingRows;
}

/**
 * Checks if a worksheet is a Return file:
 * - Opening rows contain "DISTRIBUTOR RETURN"
 * - Table row has AGENT CODE, FROM, TO, QTY
 */
function isReturnSheet(sheet: XLSX.WorkSheet): boolean {
  const data = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  }) as (string | number | null | undefined)[][];

  const openingRows = data.slice(0, 35);

  const hasReturnTitle = openingRows.some((row) =>
    row?.some((cell) => {
      if (cell == null) return false;
      return String(cell).trim().toUpperCase().includes("DISTRIBUTOR RETURN");
    })
  );

  let hasReturnHeaders = false;
  for (const row of openingRows) {
    if (!row) continue;
    const tokens = row
      .map((c) =>
        c != null
          ? String(c)
              .trim()
              .toUpperCase()
              .replace(/\s+/g, " ")
          : ""
      )
      .filter(Boolean);

    const hasAgentCode = tokens.some(
      (t) =>
        t === "AGENT CODE" ||
        t === "AGENTCODE" ||
        t === "AGENT NO" ||
        t === "AGENT_CODE"
    );
    const hasFrom = tokens.some((t) => t === "FROM");
    const hasTo = tokens.some((t) => t === "TO");
    const hasQty = tokens.some((t) => t === "QTY" || t.startsWith("QTY"));

    if (hasAgentCode && hasFrom && hasTo && hasQty) {
      hasReturnHeaders = true;
      break;
    }
  }

  return hasReturnTitle && hasReturnHeaders;
}

/**
 * Inspects a workbook and classifies it as:
 * - "raw_sales": Raw sales file with ITEM line, DRAW NO line, and headers in D, F, H, I
 * - "sales": Processed Sales Summary file with SALES SUMMARY title, Row 3 headers A, C, D, E, and matching following rows
 * - "return": Return file with DISTRIBUTOR RETURN title and return headers
 * - "unrecognized": Any other or ambiguous layout
 */
export function inspectWorkbook(workbook: XLSX.WorkBook): FileInspectionResult {
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return {
      detectedType: "unrecognized",
      isSales: false,
      isRawSales: false,
      isReturn: false,
      summarySheetFound: false,
      summarySheetName: null,
    };
  }

  // 1. Check if any sheet matches a raw sales file
  for (const sName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sName];
    if (sheet && isRawSalesSheet(sheet)) {
      return {
        detectedType: "raw_sales",
        isSales: false,
        isRawSales: true,
        isReturn: false,
        summarySheetFound: workbook.SheetNames.some(
          (n) => n.trim().toUpperCase() === "SUMMARY"
        ),
        summarySheetName: sName,
      };
    }
  }

  // 2. Check for Summary sheet
  const summarySheetName =
    workbook.SheetNames.find(
      (name) => name.trim().toUpperCase() === "SUMMARY"
    ) ?? null;

  const sheetsToCheck = summarySheetName
    ? [summarySheetName]
    : workbook.SheetNames;

  let anySales = false;
  let anyReturn = false;
  let matchedSheetName: string | null = null;

  for (const sName of sheetsToCheck) {
    const sheet = workbook.Sheets[sName];
    if (!sheet) continue;

    if (isProcessedSalesSummarySheet(sheet)) {
      anySales = true;
      matchedSheetName = sName;
    }
    if (isReturnSheet(sheet)) {
      anyReturn = true;
      matchedSheetName = sName;
    }
  }

  // Also check non-summary sheets for return if not yet detected
  if (!anySales && !anyReturn) {
    for (const sName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sName];
      if (sheet && isReturnSheet(sheet)) {
        anyReturn = true;
        matchedSheetName = sName;
        break;
      }
    }
  }

  // Cell values for backwards-compatible metadata
  const summarySheet = summarySheetName ? workbook.Sheets[summarySheetName] : null;
  const a2 = summarySheet ? getCleanCellValue(summarySheet, "A2") : "";
  const a3 = summarySheet ? getCleanCellValue(summarySheet, "A3") : "";
  const c3 = summarySheet ? getCleanCellValue(summarySheet, "C3") : "";
  const d3 = summarySheet ? getCleanCellValue(summarySheet, "D3") : "";
  const e3 = summarySheet ? getCleanCellValue(summarySheet, "E3") : "";
  const b4 = summarySheet ? getCleanCellValue(summarySheet, "B4") : "";
  const b14 = summarySheet ? getCleanCellValue(summarySheet, "B14") : "";
  const c14 = summarySheet ? getCleanCellValue(summarySheet, "C14") : "";
  const h14 = summarySheet ? getCleanCellValue(summarySheet, "H14") : "";
  const i14 = summarySheet ? getCleanCellValue(summarySheet, "I14") : "";

  let detectedType: DetectedFileType = "unrecognized";
  if (anySales && !anyReturn) {
    detectedType = "sales";
  } else if (anyReturn && !anySales) {
    detectedType = "return";
  } else {
    detectedType = "unrecognized";
  }

  return {
    detectedType,
    isSales: detectedType === "sales",
    isRawSales: false,
    isReturn: detectedType === "return",
    summarySheetFound: Boolean(summarySheetName),
    summarySheetName: summarySheetName ?? matchedSheetName,
    cellValues: {
      a2,
      a3,
      c3,
      d3,
      e3,
      b4,
      b14,
      c14,
      h14,
      i14,
    },
  };
}

/**
 * Validates a detected type against the expected page ('sales' or 'return').
 */
export function validateFileTypeForPage(
  detectedType: DetectedFileType,
  targetPage: "sales" | "return"
): FileValidationResult {
  if (targetPage === "sales") {
    if (detectedType === "sales") {
      return { isValid: true, detectedType, error: null };
    }
    if (detectedType === "raw_sales") {
      return {
        isValid: false,
        detectedType,
        error: RAW_SALES_FILE_ERROR,
      };
    }
    if (detectedType === "return") {
      return {
        isValid: false,
        detectedType,
        error: SALES_PAGE_ERROR_FOR_RETURN,
      };
    }
    return {
      isValid: false,
      detectedType,
      error: UNRECOGNIZED_FILE_ERROR,
    };
  }

  if (targetPage === "return") {
    if (detectedType === "return") {
      return { isValid: true, detectedType, error: null };
    }
    if (detectedType === "sales" || detectedType === "raw_sales") {
      return {
        isValid: false,
        detectedType,
        error: RETURNS_PAGE_ERROR_FOR_SALES,
      };
    }
    return {
      isValid: false,
      detectedType,
      error: UNRECOGNIZED_FILE_ERROR,
    };
  }

  return {
    isValid: false,
    detectedType: "unrecognized",
    error: UNRECOGNIZED_FILE_ERROR,
  };
}

/**
 * Converts various input formats into an XLSX workbook and validates it against the target page.
 */
export async function validateFileData(
  input: File | Blob | ArrayBuffer | Uint8Array | Buffer | XLSX.WorkBook,
  targetPage: "sales" | "return"
): Promise<FileValidationResult> {
  try {
    let workbook: XLSX.WorkBook;

    if ("SheetNames" in input && "Sheets" in input) {
      workbook = input as XLSX.WorkBook;
    } else if (typeof Blob !== "undefined" && input instanceof Blob) {
      const arrayBuf = await input.arrayBuffer();
      workbook = XLSX.read(arrayBuf, { type: "array" });
    } else if (input instanceof ArrayBuffer) {
      workbook = XLSX.read(input, { type: "array" });
    } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
      workbook = XLSX.read(input, { type: "buffer" });
    } else if (input instanceof Uint8Array) {
      workbook = XLSX.read(input, { type: "array" });
    } else {
      return {
        isValid: false,
        detectedType: "unrecognized",
        error: UNRECOGNIZED_FILE_ERROR,
      };
    }

    const inspection = inspectWorkbook(workbook);
    return validateFileTypeForPage(inspection.detectedType, targetPage);
  } catch (err) {
    console.error("File validation parse error:", err);
    return {
      isValid: false,
      detectedType: "unrecognized",
      error: UNRECOGNIZED_FILE_ERROR,
    };
  }
}

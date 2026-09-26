// app/lib/fileValidation.ts
import * as XLSX from "xlsx";

export type DetectedFileType = "sales" | "return" | "unrecognized";

export interface FileInspectionResult {
  detectedType: DetectedFileType;
  isSales: boolean;
  isReturn: boolean;
  summarySheetFound: boolean;
  summarySheetName: string | null;
  cellValues: {
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
 * Inspects a workbook's Summary sheet and determines if it is a Sales or Return file.
 */
export function inspectWorkbook(workbook: XLSX.WorkBook): FileInspectionResult {
  const summarySheetName =
    workbook.SheetNames.find(
      (name) => name.trim().toUpperCase() === "SUMMARY"
    ) ?? null;

  if (!summarySheetName) {
    return {
      detectedType: "unrecognized",
      isSales: false,
      isReturn: false,
      summarySheetFound: false,
      summarySheetName: null,
      cellValues: {
        a2: "",
        a3: "",
        c3: "",
        d3: "",
        e3: "",
        b4: "",
        b14: "",
        c14: "",
        h14: "",
        i14: "",
      },
    };
  }

  const sheet = workbook.Sheets[summarySheetName];

  const a2 = getCleanCellValue(sheet, "A2");
  const a3 = getCleanCellValue(sheet, "A3");
  const c3 = getCleanCellValue(sheet, "C3");
  const d3 = getCleanCellValue(sheet, "D3");
  const e3 = getCleanCellValue(sheet, "E3");

  const b4 = getCleanCellValue(sheet, "B4");
  const b14 = getCleanCellValue(sheet, "B14");
  const c14 = getCleanCellValue(sheet, "C14");
  const h14 = getCleanCellValue(sheet, "H14");
  const i14 = getCleanCellValue(sheet, "I14");

  // Sales conditions:
  // - A2 contains SALES SUMMARY (trimmed, case-insensitive)
  // - Row 3 headers: NAME in col A, FROM in col C, TO in col D, QTY in col E
  const isSales =
    a2.toUpperCase().includes("SALES SUMMARY") &&
    a3.toUpperCase() === "NAME" &&
    c3.toUpperCase() === "FROM" &&
    d3.toUpperCase() === "TO" &&
    e3.toUpperCase() === "QTY";

  // Return conditions:
  // - B4 contains DISTRIBUTOR RETURN (trimmed, case-insensitive)
  // - Row 14 headers: AGENT CODE in col B, FROM in col C, TO in col H, QTY in col I
  const isReturn =
    b4.toUpperCase().includes("DISTRIBUTOR RETURN") &&
    b14.toUpperCase() === "AGENT CODE" &&
    c14.toUpperCase() === "FROM" &&
    h14.toUpperCase() === "TO" &&
    i14.toUpperCase() === "QTY";

  let detectedType: DetectedFileType = "unrecognized";
  if (isSales && !isReturn) {
    detectedType = "sales";
  } else if (isReturn && !isSales) {
    detectedType = "return";
  } else {
    // Both matched (ambiguous) or neither matched (unrecognized)
    detectedType = "unrecognized";
  }

  return {
    detectedType,
    isSales,
    isReturn,
    summarySheetFound: true,
    summarySheetName,
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
  if (detectedType === "unrecognized") {
    return {
      isValid: false,
      detectedType,
      error: UNRECOGNIZED_FILE_ERROR,
    };
  }

  if (targetPage === "sales") {
    if (detectedType === "sales") {
      return { isValid: true, detectedType, error: null };
    }
    return {
      isValid: false,
      detectedType,
      error: SALES_PAGE_ERROR_FOR_RETURN,
    };
  }

  if (targetPage === "return") {
    if (detectedType === "return") {
      return { isValid: true, detectedType, error: null };
    }
    return {
      isValid: false,
      detectedType,
      error: RETURNS_PAGE_ERROR_FOR_SALES,
    };
  }

  return {
    isValid: false,
    detectedType: "unrecognized",
    error: UNRECOGNIZED_FILE_ERROR,
  };
}

/**
 * Converts various input formats (File, Blob, ArrayBuffer, Buffer, Uint8Array) into an XLSX workbook
 * and validates it against the target page.
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

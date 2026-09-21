// app/api/nlb-return-preprocess/route.ts
// Backend endpoint — authoritative NLB Agent Return preprocessor

import * as XLSX from "xlsx";
import {
  validateReturnFilename,
  preprocessReturnSheet,
} from "../../lib/nlbReturnPreprocess";
import type { ReturnPreprocessResult } from "../../lib/nlbReturnPreprocess";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json(
        { error: "No file uploaded." } as Record<string, unknown>,
        { status: 400 }
      );
    }

    // 1. Authoritative server-side filename validation
    const validation = validateReturnFilename(file.name);
    if (!validation.valid || !validation.code) {
      return Response.json(
        { error: validation.error } as Record<string, unknown>,
        { status: 400 }
      );
    }

    // 2. Read legacy .xls (BIFF) or .xlsx workbook
    const arrayBuffer = await file.arrayBuffer();
    let workbook;
    try {
      workbook = XLSX.read(arrayBuffer, { type: "array" });
    } catch {
      return Response.json(
        failResult(
          validation.code,
          "File could not be read as a valid Excel workbook."
        ),
        { status: 200 }
      );
    }

    if (workbook.SheetNames.length === 0) {
      return Response.json(
        failResult(validation.code, "Workbook contains no sheets."),
        { status: 200 }
      );
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // raw: true preserves original cell values without formatting coercion
    const data = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
    }) as (string | number | boolean | null)[][];

    if (!data || data.length === 0) {
      return Response.json(
        failResult(validation.code, "Worksheet is empty."),
        { status: 200 }
      );
    }

    // 3. Run return preprocessing pipeline
    const result = preprocessReturnSheet(data, validation.code);
    return Response.json(result);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown server error.";
    return Response.json(
      failResult("UNKNOWN", `Server error: ${message}`),
      { status: 500 }
    );
  }
}

/** Helper — build a minimal failed result */
function failResult(code: string, error: string): ReturnPreprocessResult {
  return {
    code,
    status: "failed",
    drawNumber: null,
    rows: [],
    rowCount: 0,
    totalReturnQuantity: 0,
    warnings: [],
    errors: [error],
  };
}

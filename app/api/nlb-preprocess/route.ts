// app/api/nlb-preprocess/route.ts
// Backend endpoint — authoritative NLB raw‑Excel preprocessor
import * as XLSX from "xlsx";
import {
  validateFilename,
  preprocessRawSheet,
  isPurchaseReportSheet,
  preprocessPurchaseSheet,
} from "../../lib/nlbPreprocess";
import type { PreprocessResult } from "../../lib/nlbPreprocess";
import { getNlbAgentAliases } from "../../lib/nlbAgentConfig";

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

    // 1. Validate filename on the server (authoritative)
    const validation = validateFilename(file.name);
    if (!validation.valid || !validation.code) {
      return Response.json(
        { error: validation.error } as Record<string, unknown>,
        { status: 400 }
      );
    }

    // 2. Read the uploaded Excel (supports both .xls BIFF and .xlsx)
    const arrayBuffer = await file.arrayBuffer();
    let workbook;
    try {
      workbook = XLSX.read(arrayBuffer, { type: "array" });
    } catch {
      return Response.json(
        failResult(validation.code, "File could not be read as a valid Excel workbook."),
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

    // raw: true → preserves numeric precision for barcodes within safe‑integer range
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

    // 3. Preprocess (Auto-detect report type)
    if (isPurchaseReportSheet(data)) {
      const result = preprocessPurchaseSheet(data, validation.code);
      return Response.json(result);
    } else {
      let aliases: Record<string, string> = {};
      try {
        aliases = await getNlbAgentAliases();
      } catch (err) {
        console.error("Could not fetch NLB agent aliases:", err);
      }
      const result = preprocessRawSheet(data, validation.code, aliases);
      return Response.json({ ...result, reportType: "sales_summary" });
    }
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
function failResult(code: string, error: string): PreprocessResult {
  return {
    code,
    status: "failed",
    drawNumber: null,
    rows: [],
    rowCount: 0,
    warnings: [],
    errors: [error],
  };
}

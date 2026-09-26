// app/api/save-upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { validateFileData } from "@/app/lib/fileValidation";
import { saveUploadedFile, deleteUploadedFile, UploadedFileRecord } from "@/app/lib/uploadService";
import { saveReturnUploadedFile, deleteReturnUploadedFile, ReturnUploadedFileRecord } from "@/app/lib/returnUploadService";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const targetPage = formData.get("targetPage") as "sales" | "return";
    const gameId = (formData.get("gameId") as string) || "UNKNOWN";
    const gameName = (formData.get("gameName") as string) || gameId;
    const uploadDate = (formData.get("uploadDate") as string) || new Date().toISOString().slice(0, 10);
    const dryRun = formData.get("dryRun") === "true";

    if (targetPage !== "sales" && targetPage !== "return") {
      return NextResponse.json(
        { success: false, error: "Invalid targetPage. Must be 'sales' or 'return'." },
        { status: 400 }
      );
    }

    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if ((key === "file" || key === "files") && value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "No files uploaded." },
        { status: 400 }
      );
    }

    // 1. Strict pre-validation of ALL files before ANY database/storage writes
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const validation = await validateFileData(arrayBuffer, targetPage);
      if (!validation.isValid) {
        return NextResponse.json(
          {
            success: false,
            error: validation.error,
            detectedType: validation.detectedType,
            failedFile: file.name,
          },
          { status: 400 }
        );
      }
    }

    // Dry-run mode for tests or validation checks
    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        message: `All ${files.length} file(s) passed ${targetPage} validation. No records written.`,
      });
    }

    // 2. Perform writes with atomic rollback if any error occurs
    const savedRecords: (UploadedFileRecord | ReturnUploadedFileRecord)[] = [];

    try {
      for (const file of files) {
        if (targetPage === "sales") {
          const rec = await saveUploadedFile(file, gameId, gameName, uploadDate);
          savedRecords.push(rec);
        } else {
          const rec = await saveReturnUploadedFile(file, gameId, gameName, uploadDate);
          savedRecords.push(rec);
        }
      }

      return NextResponse.json({
        success: true,
        count: savedRecords.length,
        records: savedRecords,
      });
    } catch (saveErr) {
      // Atomic rollback: remove any records/storage created in this request
      for (const rec of savedRecords) {
        try {
          if (targetPage === "sales") {
            await deleteUploadedFile(rec as UploadedFileRecord);
          } else {
            await deleteReturnUploadedFile(rec as ReturnUploadedFileRecord);
          }
        } catch (rbErr) {
          console.error("Rollback failed during save-upload:", rbErr);
        }
      }

      const msg = saveErr instanceof Error ? saveErr.message : "Save failed.";
      return NextResponse.json(
        { success: false, error: `Import failed atomically: ${msg}` },
        { status: 500 }
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unexpected server error.";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}

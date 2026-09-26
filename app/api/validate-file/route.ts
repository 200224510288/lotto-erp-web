// app/api/validate-file/route.ts
import { NextRequest, NextResponse } from "next/server";
import { validateFileData } from "@/app/lib/fileValidation";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const targetPage = formData.get("targetPage") as "sales" | "return";

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { isValid: false, error: "No file provided in form data." },
        { status: 400 }
      );
    }

    if (targetPage !== "sales" && targetPage !== "return") {
      return NextResponse.json(
        { isValid: false, error: "Invalid targetPage. Must be 'sales' or 'return'." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await validateFileData(arrayBuffer, targetPage);

    if (!result.isValid) {
      return NextResponse.json(
        {
          isValid: false,
          detectedType: result.detectedType,
          error: result.error,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      isValid: true,
      detectedType: result.detectedType,
      error: null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Validation failed.";
    return NextResponse.json(
      { isValid: false, error: msg },
      { status: 500 }
    );
  }
}

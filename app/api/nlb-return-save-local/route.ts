// app/api/nlb-return-save-local/route.ts
// Direct local disk writer for NLB Return files into C:\nlb return

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DEFAULT_RETURN_FOLDER = "C:\\nlb return";

export async function GET() {
  try {
    const targetDir = DEFAULT_RETURN_FOLDER;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const files = fs.readdirSync(targetDir).filter((f) => {
      try {
        return fs.statSync(path.join(targetDir, f)).isFile();
      } catch {
        return false;
      }
    });
    return NextResponse.json({
      success: true,
      folder: targetDir,
      fileCount: files.length,
      files,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to inspect folder." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const queryFilename = url.searchParams.get("filename");
    const headerFilename = req.headers.get("x-filename");

    const contentType = req.headers.get("content-type") || "";

    let filename = queryFilename || headerFilename || "";
    let buffer: Buffer;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const formFilename = formData.get("filename") as string | null;

      if (!file) {
        return NextResponse.json(
          { success: false, error: "No file provided in form data." },
          { status: 400 }
        );
      }

      filename = formFilename || file.name || filename;
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      const data = await req.arrayBuffer();
      buffer = Buffer.from(data);
    }

    if (!filename) {
      return NextResponse.json(
        { success: false, error: "Filename is required." },
        { status: 400 }
      );
    }

    // Ensure target folder exists: C:\nlb return
    const targetDir = DEFAULT_RETURN_FOLDER;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetFile = path.join(targetDir, filename);

    // Write file directly to C:\nlb return\<filename>
    fs.writeFileSync(targetFile, buffer);

    return NextResponse.json({
      success: true,
      message: `Saved successfully to ${targetFile}`,
      path: targetFile,
      folder: targetDir,
      filename,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to save locally." },
      { status: 500 }
    );
  }
}

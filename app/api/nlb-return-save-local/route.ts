// app/api/nlb-return-save-local/route.ts
// Direct local disk writer for NLB Return files into C:\nlb return
// Includes path validation ("File not found" if directory missing) and saves folder path to DB

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/app/lib/firebase";
import { doc, setDoc, addDoc, collection, Timestamp } from "firebase/firestore";

const DEFAULT_RETURN_FOLDER = "C:\\nlb return";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const targetDir =
      url.searchParams.get("folder") ||
      req.headers.get("x-folder") ||
      DEFAULT_RETURN_FOLDER;

    // Validation: Check if the folder exists on the path - DO NOT auto-create
    if (!fs.existsSync(targetDir)) {
      return NextResponse.json(
        {
          success: false,
          exists: false,
          error: `File not found: Target folder does not exist on path "${targetDir}".`,
          folder: targetDir,
          fileCount: 0,
          files: [],
        },
        { status: 404 }
      );
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
      exists: true,
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
    const targetDir =
      url.searchParams.get("folder") ||
      req.headers.get("x-folder") ||
      DEFAULT_RETURN_FOLDER;

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

    // Validation: Verify if the folder exists on the path - DO NOT auto-create
    if (!fs.existsSync(targetDir)) {
      return NextResponse.json(
        {
          success: false,
          error: `File not found: Target folder does not exist on path "${targetDir}".`,
          folder: targetDir,
        },
        { status: 404 }
      );
    }

    const targetFile = path.join(targetDir, filename);

    // Write file directly to target directory
    fs.writeFileSync(targetFile, buffer);

    // Save folder path & local save record in Firestore DB
    try {
      await setDoc(
        doc(db, "nlb_settings", "return_folder"),
        {
          folderPath: targetDir,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );

      await addDoc(collection(db, "nlb_return_local_saves"), {
        fileName: filename,
        folderPath: targetDir,
        fullPath: targetFile,
        size: buffer.length,
        savedAt: Timestamp.now(),
      });
    } catch (dbErr) {
      console.warn("Could not record local save in DB:", dbErr);
    }

    return NextResponse.json({
      success: true,
      message: `Saved successfully to ${targetFile}`,
      path: targetFile,
      folder: targetDir,
      folderPath: targetDir,
      filename,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to save locally." },
      { status: 500 }
    );
  }
}

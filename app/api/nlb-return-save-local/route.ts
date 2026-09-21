// app/api/nlb-return-save-local/route.ts
// Direct local disk writer for NLB Return files into C:\nlb return
// Includes directory validation ("Folder unavailable" if directory missing or invalid) and saves folder path to DB

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

    // Check directory existence and ensure it is a DIRECTORY, not a file
    let exists = false;
    let isDirectory = false;

    try {
      if (fs.existsSync(targetDir)) {
        exists = true;
        isDirectory = fs.statSync(targetDir).isDirectory();
      }
    } catch {
      exists = false;
      isDirectory = false;
    }

    if (!exists || !isDirectory) {
      return NextResponse.json(
        {
          success: false,
          exists,
          isDirectory,
          status: "Folder unavailable",
          error: !exists
            ? `Target folder does not exist: "${targetDir}"`
            : `Path exists but is not a directory: "${targetDir}"`,
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
      isDirectory: true,
      status: "Folder accessible",
      folder: targetDir,
      fileCount: files.length,
      files,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        status: "Folder unavailable",
        error: err.message || "Failed to inspect directory.",
        folder: DEFAULT_RETURN_FOLDER,
        fileCount: 0,
        files: [],
      },
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

    // Validation: Verify directory exists and is a directory - DO NOT auto-create
    let exists = false;
    let isDirectory = false;
    try {
      if (fs.existsSync(targetDir)) {
        exists = true;
        isDirectory = fs.statSync(targetDir).isDirectory();
      }
    } catch {
      exists = false;
      isDirectory = false;
    }

    if (!exists || !isDirectory) {
      return NextResponse.json(
        {
          success: false,
          status: "Folder unavailable",
          error: !exists
            ? `Target folder does not exist: "${targetDir}"`
            : `Target path is not a directory: "${targetDir}"`,
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
      status: "Folder accessible",
      isDirectory: true,
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

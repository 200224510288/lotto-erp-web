// app/lib/uploadService.ts
import { db, storage } from "./firebase";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  deleteDoc,
  doc,
  Timestamp,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";

import {
  validateFileData,
  UNRECOGNIZED_FILE_ERROR,
} from "./fileValidation";

export type UploadedFileRecord = {
  id: string;
  fileName: string;
  gameId: string;
  gameName: string;
  uploadDate: string; // YYYY-MM-DD
  downloadUrl: string;
  size: number; // bytes
  storagePath: string;
  createdAt?: Timestamp;
};

const COLLECTION = "erp_uploads";

/**
 * Save an uploaded ERP Excel file to Firebase:
 * - validates file type is Sales before any database or storage writes
 * - content to Storage
 * - metadata to Firestore
 * - atomic: cleans up Storage if Firestore metadata creation fails
 */
export async function saveUploadedFile(
  file: File,
  gameId: string,
  gameName: string,
  uploadDate: string
): Promise<UploadedFileRecord> {
  // 1. Strict validation before ANY database/storage writes
  const validation = await validateFileData(file, "sales");
  if (!validation.isValid) {
    throw new Error(validation.error || UNRECOGNIZED_FILE_ERROR);
  }

  const safeDate = uploadDate || new Date().toISOString().slice(0, 10);
  const storagePath = `erp-uploads/${safeDate}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, storagePath);

  // Upload binary to Storage
  await uploadBytes(storageRef, file);

  let downloadUrl = "";
  try {
    downloadUrl = await getDownloadURL(storageRef);
  } catch (err) {
    await deleteObject(storageRef).catch(() => {});
    throw err;
  }

  // Store metadata in Firestore
  const meta = {
    fileName: file.name,
    gameId,
    gameName,
    uploadDate: safeDate,
    downloadUrl,
    size: file.size,
    storagePath,
    createdAt: Timestamp.now(),
  };

  try {
    const docRef = await addDoc(collection(db, COLLECTION), meta);
    return {
      id: docRef.id,
      ...meta,
    };
  } catch (err) {
    // Atomic rollback: remove uploaded binary if document write fails
    await deleteObject(storageRef).catch(() => {});
    throw err;
  }
}

/**
 * Atomically save multiple Sales files to Firebase.
 * Pre-validates ALL files before performing any writes.
 * If any write fails, all previously uploaded files in this batch are rolled back.
 */
export async function saveUploadedFilesAtomic(
  items: Array<{ file: File; gameId: string; gameName: string }>,
  uploadDate: string
): Promise<UploadedFileRecord[]> {
  // Pre-validate all files before ANY database/storage writes
  for (const item of items) {
    const validation = await validateFileData(item.file, "sales");
    if (!validation.isValid) {
      throw new Error(`File "${item.file.name}" rejected: ${validation.error}`);
    }
  }

  const savedRecords: UploadedFileRecord[] = [];
  try {
    for (const item of items) {
      const rec = await saveUploadedFile(
        item.file,
        item.gameId,
        item.gameName,
        uploadDate
      );
      savedRecords.push(rec);
    }
    return savedRecords;
  } catch (err) {
    // Rollback all saved records from this batch
    for (const rec of savedRecords) {
      try {
        await deleteUploadedFile(rec);
      } catch (rollbackErr) {
        console.error("Rollback failed for", rec.fileName, rollbackErr);
      }
    }
    throw err;
  }
}

/**
 * List all uploaded files for a given business date (YYYY-MM-DD).
 */
export async function listUploadedFilesByDate(
  uploadDate: string
): Promise<UploadedFileRecord[]> {
  if (!uploadDate) return [];

  const q = query(
    collection(db, COLLECTION),
    where("uploadDate", "==", uploadDate),
    orderBy("createdAt", "asc")
  );

  const snap = await getDocs(q);

  const result: UploadedFileRecord[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() as UploadedFileRecord;
    result.push({
      id: docSnap.id,
      fileName: data.fileName ?? "",
      gameId: data.gameId ?? "",
      gameName: data.gameName ?? "",
      uploadDate: data.uploadDate ?? "",
      downloadUrl: data.downloadUrl ?? "",
      size: data.size ?? 0,
      storagePath: data.storagePath ?? "",
      createdAt: data.createdAt,
    });
  });

  return result;
}

/**
 * Delete an uploaded file:
 * - remove from Storage
 * - remove from Firestore
 */
export async function deleteUploadedFile(
  record: UploadedFileRecord
): Promise<void> {
  if (record.storagePath) {
    const storageRef = ref(storage, record.storagePath);
    await deleteObject(storageRef).catch(() => {
      // If Storage delete fails, we still delete Firestore doc
    });
  }

  await deleteDoc(doc(db, COLLECTION, record.id));
}

/**
 * List all uploaded files for a given business date range.
 */
export async function listUploadedFilesByDateRange(
  startDate: string,
  endDate: string
): Promise<UploadedFileRecord[]> {
  if (!startDate || !endDate) return [];

  const q = query(
    collection(db, COLLECTION),
    where("uploadDate", ">=", startDate),
    where("uploadDate", "<=", endDate)
  );

  const snap = await getDocs(q);

  const result: UploadedFileRecord[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() as UploadedFileRecord;
    result.push({
      id: docSnap.id,
      fileName: data.fileName ?? "",
      gameId: data.gameId ?? "",
      gameName: data.gameName ?? "",
      uploadDate: data.uploadDate ?? "",
      downloadUrl: data.downloadUrl ?? "",
      size: data.size ?? 0,
      storagePath: data.storagePath ?? "",
      createdAt: data.createdAt,
    });
  });

  // Sort in memory to avoid index requirements
  result.sort((a, b) => {
    if (a.uploadDate !== b.uploadDate) {
      return a.uploadDate.localeCompare(b.uploadDate);
    }
    const tA = a.createdAt?.toMillis() ?? 0;
    const tB = b.createdAt?.toMillis() ?? 0;
    return tA - tB;
  });

  return result;
}

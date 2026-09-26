// app/lib/returnUploadService.ts
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
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

import {
  validateFileData,
  UNRECOGNIZED_FILE_ERROR,
} from "./fileValidation";

export type ReturnUploadedFileRecord = {
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

// ✅ MUST be different from Sales collection
const COLLECTION = "return_uploads";

// ✅ MUST be different from Sales storage folder
const STORAGE_ROOT = "return-uploads";

/**
 * Save an uploaded Return Excel file to Firebase:
 * - validates file type is Return before any database or storage writes
 * - content to Storage
 * - metadata to Firestore
 * - atomic: cleans up Storage if Firestore metadata creation fails
 */
export async function saveReturnUploadedFile(
  file: File,
  gameId: string,
  gameName: string,
  uploadDate: string
): Promise<ReturnUploadedFileRecord> {
  // 1. Strict validation before ANY database/storage writes
  const validation = await validateFileData(file, "return");
  if (!validation.isValid) {
    throw new Error(validation.error || UNRECOGNIZED_FILE_ERROR);
  }

  const safeDate = uploadDate || new Date().toISOString().slice(0, 10);
  const storagePath = `${STORAGE_ROOT}/${safeDate}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file);

  let downloadUrl = "";
  try {
    downloadUrl = await getDownloadURL(storageRef);
  } catch (err) {
    await deleteObject(storageRef).catch(() => {});
    throw err;
  }

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
 * Atomically save multiple Return files to Firebase.
 * Pre-validates ALL files before performing any writes.
 * If any write fails, all previously uploaded files in this batch are rolled back.
 */
export async function saveReturnUploadedFilesAtomic(
  items: Array<{ file: File; gameId: string; gameName: string }>,
  uploadDate: string
): Promise<ReturnUploadedFileRecord[]> {
  // Pre-validate all files before ANY database/storage writes
  for (const item of items) {
    const validation = await validateFileData(item.file, "return");
    if (!validation.isValid) {
      throw new Error(`File "${item.file.name}" rejected: ${validation.error}`);
    }
  }

  const savedRecords: ReturnUploadedFileRecord[] = [];
  try {
    for (const item of items) {
      const rec = await saveReturnUploadedFile(
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
        await deleteReturnUploadedFile(rec);
      } catch (rollbackErr) {
        console.error("Rollback failed for", rec.fileName, rollbackErr);
      }
    }
    throw err;
  }
}

/**
 * List all Return uploaded files for a given business date (YYYY-MM-DD).
 */
export async function listReturnUploadedFilesByDate(
  uploadDate: string
): Promise<ReturnUploadedFileRecord[]> {
  if (!uploadDate) return [];

  const q = query(
    collection(db, COLLECTION),
    where("uploadDate", "==", uploadDate),
    orderBy("createdAt", "asc")
  );

  const snap = await getDocs(q);

  const result: ReturnUploadedFileRecord[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() as Partial<ReturnUploadedFileRecord>;
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
 * Delete an uploaded Return file:
 * - remove from Storage
 * - remove from Firestore
 */
export async function deleteReturnUploadedFile(
  record: ReturnUploadedFileRecord
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
 * List all Return uploaded files for a given business date range.
 */
export async function listReturnUploadedFilesByDateRange(
  startDate: string,
  endDate: string
): Promise<ReturnUploadedFileRecord[]> {
  if (!startDate || !endDate) return [];

  const q = query(
    collection(db, COLLECTION),
    where("uploadDate", ">=", startDate),
    where("uploadDate", "<=", endDate)
  );

  const snap = await getDocs(q);

  const result: ReturnUploadedFileRecord[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() as Partial<ReturnUploadedFileRecord>;
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

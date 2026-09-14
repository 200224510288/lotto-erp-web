// app/lib/nlbUploadService.ts
import { db, storage } from "./firebase";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
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

export type NlbUploadedFileRecord = {
  id: string;
  fileName: string;
  code: string;
  drawNumber: string;
  rowCount: number;
  uploadDate: string; // YYYY-MM-DD
  downloadUrl: string;
  size: number; // bytes
  storagePath: string;
  createdAt?: Timestamp;
};

const COLLECTION = "nlb_uploads";
const STORAGE_ROOT = "nlb-uploads";

/**
 * Save a cleaned NLB Excel file to Firebase:
 * - content to Storage
 * - metadata to Firestore
 * Overwrites any prior record for the same code + date to avoid duplicates.
 */
export async function saveNlbCleanedFile(
  blob: Blob,
  fileName: string,
  code: string,
  drawNumber: string,
  rowCount: number,
  uploadDate: string
): Promise<NlbUploadedFileRecord> {
  const safeDate = uploadDate || new Date().toISOString().slice(0, 10);

  // 1. Check & delete prior file for the same lottery code on this date
  try {
    const existing = await listNlbUploadedFilesByDate(safeDate);
    const prev = existing.find((f) => f.code.toUpperCase() === code.toUpperCase());
    if (prev) {
      await deleteNlbUploadedFile(prev);
    }
  } catch {
    // Non-fatal if prior check fails
  }

  // 2. Upload binary to Storage
  const storagePath = `${STORAGE_ROOT}/${safeDate}/${Date.now()}_${fileName}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, blob);
  const downloadUrl = await getDownloadURL(storageRef);

  // 3. Store metadata in Firestore
  const meta = {
    fileName,
    code: code.toUpperCase(),
    drawNumber: drawNumber || "",
    rowCount: rowCount || 0,
    uploadDate: safeDate,
    downloadUrl,
    size: blob.size,
    storagePath,
    createdAt: Timestamp.now(),
  };

  const docRef = await addDoc(collection(db, COLLECTION), meta);

  return {
    id: docRef.id,
    ...meta,
  };
}

/**
 * List all saved NLB files for a given date (YYYY-MM-DD).
 */
export async function listNlbUploadedFilesByDate(
  uploadDate: string
): Promise<NlbUploadedFileRecord[]> {
  if (!uploadDate) return [];

  const q = query(
    collection(db, COLLECTION),
    where("uploadDate", "==", uploadDate)
  );

  const snap = await getDocs(q);

  const result: NlbUploadedFileRecord[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() as Partial<NlbUploadedFileRecord>;
    result.push({
      id: docSnap.id,
      fileName: data.fileName ?? "",
      code: data.code ?? "",
      drawNumber: data.drawNumber ?? "",
      rowCount: data.rowCount ?? 0,
      uploadDate: data.uploadDate ?? "",
      downloadUrl: data.downloadUrl ?? "",
      size: data.size ?? 0,
      storagePath: data.storagePath ?? "",
      createdAt: data.createdAt,
    });
  });

  result.sort((a, b) => a.code.localeCompare(b.code));
  return result;
}

/**
 * Delete an NLB uploaded file from Firebase (Storage + Firestore).
 */
export async function deleteNlbUploadedFile(
  record: NlbUploadedFileRecord
): Promise<void> {
  if (record.storagePath) {
    const storageRef = ref(storage, record.storagePath);
    await deleteObject(storageRef).catch(() => {
      // Ignore if file doesn't exist in Storage
    });
  }

  await deleteDoc(doc(db, COLLECTION, record.id));
}

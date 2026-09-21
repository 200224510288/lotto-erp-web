// app/lib/nlbReturnUploadService.ts
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

export type NlbReturnFileRecord = {
  id: string;
  fileName: string;
  code: string;
  drawNumber: string;
  rowCount: number;
  totalReturnQuantity: number;
  uploadDate: string; // YYYY-MM-DD
  downloadUrl: string;
  size: number; // bytes
  storagePath: string;
  createdAt?: Timestamp;
};

const RETURN_COLLECTION = "nlb_return_uploads";
const RETURN_STORAGE_ROOT = "nlb-returns";

/**
 * Save a cleaned NLB Agent Return Excel file to Firebase:
 * - Stored in dedicated Storage: `nlb-returns/${date}/...`
 * - Stored in dedicated Firestore collection: `nlb_return_uploads`
 */
export async function saveNlbReturnFile(
  blob: Blob,
  fileName: string,
  code: string,
  drawNumber: string,
  rowCount: number,
  totalReturnQuantity: number,
  uploadDate: string
): Promise<NlbReturnFileRecord> {
  const safeDate = uploadDate || new Date().toISOString().slice(0, 10);

  // 1. Delete prior file for the same lottery code on this date
  try {
    const existing = await listNlbReturnFilesByDate(safeDate);
    const prev = existing.find(
      (f) => f.code.toUpperCase() === code.toUpperCase()
    );
    if (prev) {
      await deleteNlbReturnUploadedFile(prev);
    }
  } catch {
    // Non-fatal
  }

  // 2. Upload binary to dedicated storage
  const storagePath = `${RETURN_STORAGE_ROOT}/${safeDate}/${Date.now()}_${fileName}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, blob);
  const downloadUrl = await getDownloadURL(storageRef);

  // 3. Store metadata
  const meta = {
    fileName,
    code: code.toUpperCase(),
    drawNumber: drawNumber || "",
    rowCount: rowCount || 0,
    totalReturnQuantity: totalReturnQuantity || 0,
    uploadDate: safeDate,
    downloadUrl,
    size: blob.size,
    storagePath,
    createdAt: Timestamp.now(),
  };

  const docRef = await addDoc(collection(db, RETURN_COLLECTION), meta);

  return {
    id: docRef.id,
    ...meta,
  };
}

/**
 * List all saved NLB return files for a given date
 */
export async function listNlbReturnFilesByDate(
  dateStr: string
): Promise<NlbReturnFileRecord[]> {
  const q = query(
    collection(db, RETURN_COLLECTION),
    where("uploadDate", "==", dateStr)
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      fileName: data.fileName,
      code: data.code,
      drawNumber: data.drawNumber,
      rowCount: data.rowCount,
      totalReturnQuantity: data.totalReturnQuantity || 0,
      uploadDate: data.uploadDate,
      downloadUrl: data.downloadUrl,
      size: data.size,
      storagePath: data.storagePath,
      createdAt: data.createdAt,
    };
  });
}

/**
 * Delete an uploaded return file from Firestore & Storage
 */
export async function deleteNlbReturnUploadedFile(
  record: NlbReturnFileRecord
): Promise<void> {
  try {
    const storageRef = ref(storage, record.storagePath);
    await deleteObject(storageRef);
  } catch {
    // Non-fatal if storage file already removed
  }
  await deleteDoc(doc(db, RETURN_COLLECTION, record.id));
}

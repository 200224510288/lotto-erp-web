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
 * - content to Storage
 * - metadata to Firestore
 */
export async function saveReturnUploadedFile(
  file: File,
  gameId: string,
  gameName: string,
  uploadDate: string
): Promise<ReturnUploadedFileRecord> {
  const safeDate = uploadDate || new Date().toISOString().slice(0, 10);

  const storagePath = `${STORAGE_ROOT}/${safeDate}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file);

  const downloadUrl = await getDownloadURL(storageRef);

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

  const docRef = await addDoc(collection(db, COLLECTION), meta);

  return {
    id: docRef.id,
    ...meta,
  };
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

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
 * - content to Storage
 * - metadata to Firestore
 */
export async function saveUploadedFile(
  file: File,
  gameId: string,
  gameName: string,
  uploadDate: string
): Promise<UploadedFileRecord> {
  const safeDate = uploadDate || new Date().toISOString().slice(0, 10);

  const storagePath = `erp-uploads/${safeDate}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, storagePath);

  // Upload binary to Storage
  await uploadBytes(storageRef, file);

  const downloadUrl = await getDownloadURL(storageRef);

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

  const docRef = await addDoc(collection(db, COLLECTION), meta);

  return {
    id: docRef.id,
    ...meta,
  };
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

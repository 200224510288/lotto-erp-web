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
  reportType: "sales_summary" | "purchase_range";
  drawNumber: string;
  drawDate?: string;
  rowCount: number;
  totalPurchase?: number;
  totalReturn?: number;
  netQuantity?: number;
  uploadDate: string; // YYYY-MM-DD
  downloadUrl: string;
  size: number; // bytes
  storagePath: string;
  createdAt?: Timestamp;
};

// Distinct Firestore collections and Storage locations for Sales vs Purchase
const SALES_COLLECTION = "nlb_sales_uploads";
const PURCHASE_COLLECTION = "nlb_purchase_uploads";
const LEGACY_COLLECTION = "nlb_uploads";

const SALES_STORAGE_ROOT = "nlb-sales";
const PURCHASE_STORAGE_ROOT = "nlb-purchases";

/**
 * Save a cleaned NLB Sales Summary Excel file to Firebase:
 * - Content stored in dedicated location: `nlb-sales/${date}/...`
 * - Metadata stored in dedicated collection: `nlb_sales_uploads`
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
    const existing = await listNlbSalesFilesByDate(safeDate);
    const prev = existing.find(
      (f) => f.code.toUpperCase() === code.toUpperCase()
    );
    if (prev) {
      await deleteNlbUploadedFile(prev);
    }
  } catch {
    // Non-fatal
  }

  // 2. Upload binary to dedicated sales Storage location
  const storagePath = `${SALES_STORAGE_ROOT}/${safeDate}/${Date.now()}_${fileName}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, blob);
  const downloadUrl = await getDownloadURL(storageRef);

  // 3. Store metadata in dedicated sales collection
  const meta = {
    fileName,
    code: code.toUpperCase(),
    reportType: "sales_summary" as const,
    drawNumber: drawNumber || "",
    rowCount: rowCount || 0,
    uploadDate: safeDate,
    downloadUrl,
    size: blob.size,
    storagePath,
    createdAt: Timestamp.now(),
  };

  const docRef = await addDoc(collection(db, SALES_COLLECTION), meta);

  return {
    id: docRef.id,
    ...meta,
  };
}

/**
 * Save a cleaned NLB Purchase Range (Stock) file to Firebase:
 * - Content stored in dedicated location: `nlb-purchases/${date}/...`
 * - Metadata stored in dedicated collection: `nlb_purchase_uploads`
 */
export async function saveNlbPurchaseFile(
  blob: Blob,
  fileName: string,
  code: string,
  drawNumber: string,
  drawDate: string,
  rowCount: number,
  totalPurchase: number,
  totalReturn: number,
  netQuantity: number,
  uploadDate: string
): Promise<NlbUploadedFileRecord> {
  const safeDate = uploadDate || new Date().toISOString().slice(0, 10);

  // 1. Check & delete prior purchase file for the same lottery code on this date
  try {
    const existing = await listNlbPurchaseFilesByDate(safeDate);
    const prev = existing.find(
      (f) => f.code.toUpperCase() === code.toUpperCase()
    );
    if (prev) {
      await deleteNlbUploadedFile(prev);
    }
  } catch {
    // Non-fatal
  }

  // 2. Upload binary to dedicated purchases Storage location
  const storagePath = `${PURCHASE_STORAGE_ROOT}/${safeDate}/${Date.now()}_${fileName}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, blob);
  const downloadUrl = await getDownloadURL(storageRef);

  // 3. Store metadata in dedicated purchases collection
  const meta = {
    fileName,
    code: code.toUpperCase(),
    reportType: "purchase_range" as const,
    drawNumber: drawNumber || "",
    drawDate: drawDate || "",
    rowCount: rowCount || 0,
    totalPurchase,
    totalReturn,
    netQuantity,
    uploadDate: safeDate,
    downloadUrl,
    size: blob.size,
    storagePath,
    createdAt: Timestamp.now(),
  };

  const docRef = await addDoc(collection(db, PURCHASE_COLLECTION), meta);

  return {
    id: docRef.id,
    ...meta,
  };
}

/**
 * List saved Sales files for a given date.
 * Also checks legacy collection for backwards compatibility.
 */
export async function listNlbSalesFilesByDate(
  uploadDate: string
): Promise<NlbUploadedFileRecord[]> {
  if (!uploadDate) return [];

  const records: NlbUploadedFileRecord[] = [];
  const seenCodes = new Set<string>();

  // Primary: dedicated sales collection
  try {
    const q = query(
      collection(db, SALES_COLLECTION),
      where("uploadDate", "==", uploadDate)
    );
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const data = d.data() as Partial<NlbUploadedFileRecord>;
      const rec: NlbUploadedFileRecord = {
        id: d.id,
        fileName: data.fileName ?? "",
        code: data.code ?? "",
        reportType: "sales_summary",
        drawNumber: data.drawNumber ?? "",
        rowCount: data.rowCount ?? 0,
        uploadDate: data.uploadDate ?? "",
        downloadUrl: data.downloadUrl ?? "",
        size: data.size ?? 0,
        storagePath: data.storagePath ?? "",
        createdAt: data.createdAt,
      };
      records.push(rec);
      seenCodes.add(rec.code.toUpperCase());
    });
  } catch (err) {
    console.warn("Could not read sales collection:", err);
  }

  // Legacy fallback: check nlb_uploads for sales_summary
  try {
    const qLegacy = query(
      collection(db, LEGACY_COLLECTION),
      where("uploadDate", "==", uploadDate)
    );
    const snapLegacy = await getDocs(qLegacy);
    snapLegacy.forEach((d) => {
      const data = d.data() as Partial<NlbUploadedFileRecord>;
      if (data.reportType === "purchase_range") return;
      const codeUpper = (data.code ?? "").toUpperCase();
      if (!seenCodes.has(codeUpper)) {
        records.push({
          id: d.id,
          fileName: data.fileName ?? "",
          code: data.code ?? "",
          reportType: "sales_summary",
          drawNumber: data.drawNumber ?? "",
          rowCount: data.rowCount ?? 0,
          uploadDate: data.uploadDate ?? "",
          downloadUrl: data.downloadUrl ?? "",
          size: data.size ?? 0,
          storagePath: data.storagePath ?? "",
          createdAt: data.createdAt,
        });
        seenCodes.add(codeUpper);
      }
    });
  } catch {
    // Non-fatal
  }

  records.sort((a, b) => a.code.localeCompare(b.code));
  return records;
}

/**
 * List saved Purchase files for a given date.
 * Also checks legacy collection for backwards compatibility.
 */
export async function listNlbPurchaseFilesByDate(
  uploadDate: string
): Promise<NlbUploadedFileRecord[]> {
  if (!uploadDate) return [];

  const records: NlbUploadedFileRecord[] = [];
  const seenCodes = new Set<string>();

  // Primary: dedicated purchase collection
  try {
    const q = query(
      collection(db, PURCHASE_COLLECTION),
      where("uploadDate", "==", uploadDate)
    );
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const data = d.data() as Partial<NlbUploadedFileRecord>;
      const rec: NlbUploadedFileRecord = {
        id: d.id,
        fileName: data.fileName ?? "",
        code: data.code ?? "",
        reportType: "purchase_range",
        drawNumber: data.drawNumber ?? "",
        drawDate: data.drawDate ?? "",
        rowCount: data.rowCount ?? 0,
        totalPurchase: data.totalPurchase,
        totalReturn: data.totalReturn,
        netQuantity: data.netQuantity,
        uploadDate: data.uploadDate ?? "",
        downloadUrl: data.downloadUrl ?? "",
        size: data.size ?? 0,
        storagePath: data.storagePath ?? "",
        createdAt: data.createdAt,
      };
      records.push(rec);
      seenCodes.add(rec.code.toUpperCase());
    });
  } catch (err) {
    console.warn("Could not read purchase collection:", err);
  }

  // Legacy fallback: check nlb_uploads for purchase_range
  try {
    const qLegacy = query(
      collection(db, LEGACY_COLLECTION),
      where("uploadDate", "==", uploadDate)
    );
    const snapLegacy = await getDocs(qLegacy);
    snapLegacy.forEach((d) => {
      const data = d.data() as Partial<NlbUploadedFileRecord>;
      if (data.reportType !== "purchase_range") return;
      const codeUpper = (data.code ?? "").toUpperCase();
      if (!seenCodes.has(codeUpper)) {
        records.push({
          id: d.id,
          fileName: data.fileName ?? "",
          code: data.code ?? "",
          reportType: "purchase_range",
          drawNumber: data.drawNumber ?? "",
          drawDate: data.drawDate ?? "",
          rowCount: data.rowCount ?? 0,
          totalPurchase: data.totalPurchase,
          totalReturn: data.totalReturn,
          netQuantity: data.netQuantity,
          uploadDate: data.uploadDate ?? "",
          downloadUrl: data.downloadUrl ?? "",
          size: data.size ?? 0,
          storagePath: data.storagePath ?? "",
          createdAt: data.createdAt,
        });
        seenCodes.add(codeUpper);
      }
    });
  } catch {
    // Non-fatal
  }

  records.sort((a, b) => a.code.localeCompare(b.code));
  return records;
}

/**
 * List all saved NLB files for a given date (combines sales and purchase).
 */
export async function listNlbUploadedFilesByDate(
  uploadDate: string
): Promise<NlbUploadedFileRecord[]> {
  const [sales, purchases] = await Promise.all([
    listNlbSalesFilesByDate(uploadDate),
    listNlbPurchaseFilesByDate(uploadDate),
  ]);
  return [...sales, ...purchases];
}

/**
 * Delete an NLB uploaded file from Firebase (Storage + Firestore).
 * Checks the appropriate collection based on reportType or attempts all.
 */
export async function deleteNlbUploadedFile(
  record: NlbUploadedFileRecord
): Promise<void> {
  // 1. Delete binary from Storage
  if (record.storagePath) {
    const storageRef = ref(storage, record.storagePath);
    await deleteObject(storageRef).catch(() => {
      // Ignore if missing in Storage
    });
  }

  // 2. Delete document from corresponding Firestore collection
  const targetCollection =
    record.reportType === "purchase_range"
      ? PURCHASE_COLLECTION
      : SALES_COLLECTION;

  try {
    await deleteDoc(doc(db, targetCollection, record.id));
  } catch {
    // If not found in target collection, try legacy collection
    try {
      await deleteDoc(doc(db, LEGACY_COLLECTION, record.id));
    } catch {
      // Non-fatal
    }
  }
}

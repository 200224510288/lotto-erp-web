"use client";

import Link from "next/link";
import { DragEvent, ChangeEvent, useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";

import {
  ALLOWED_CODES,
  validateFilename,
  generatePurchaseXlsx,
} from "../lib/nlbPreprocess";
import type {
  PreprocessResult,
  ProcessedRow,
  PurchaseRow,
  PurchaseReportResult,
  AnyPreprocessResult,
} from "../lib/nlbPreprocess";
import {
  saveNlbCleanedFile,
  saveNlbPurchaseFile,
  listNlbSalesFilesByDate,
  listNlbPurchaseFilesByDate,
  deleteNlbUploadedFile,
} from "../lib/nlbUploadService";
import type { NlbUploadedFileRecord } from "../lib/nlbUploadService";

/* =====================================================
   TYPES
   ==================================================== */

type FileEntry = {
  id: string;
  file: File;
  code: string;
  category: "sales" | "purchase";
  status: "waiting" | "processing" | "completed" | "failed";
  result: AnyPreprocessResult | null;
  errorMessage: string | null;
  isSavedToFirebase?: boolean;
};

type ModalPreviewData = {
  title: string;
  code: string;
  reportType: "sales_summary" | "purchase_range";
  drawNumber: string;
  drawDate?: string;
  salesRows?: ProcessedRow[];
  purchaseRows?: PurchaseRow[];
  totalPurchase?: number;
  totalReturn?: number;
  netQuantity?: number;
  onDownload?: () => void;
  onSaveToFirebase?: () => void;
  onDelete?: () => void;
  isSaved?: boolean;
  currentIndex?: number;
  totalCount?: number;
  onNext?: () => void;
  onPrevious?: () => void;
  isLoading?: boolean;
};

/* =====================================================
   XLSX GENERATOR HELPER FOR SALES
   ===================================================== */

function generateCleanedXlsx(rows: ProcessedRow[]): Blob {
  const header = ["Draw Number", "Agent Code", "Starting Barcode", "Quantity"];
  const aoa: (string | number)[][] = [
    header,
    ...rows.map((r) => [r.drawNumber, r.agentCode, r.startingBarcode, r.quantity]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Force Starting Barcode column (C) to TEXT
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let R = range.s.r + 1; R <= range.e.r; R++) {
    const ref = XLSX.utils.encode_cell({ r: R, c: 2 });
    const cell = ws[ref];
    if (cell) {
      cell.t = "s";
      cell.z = "@";
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });

  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/* =====================================================
   DOWNLOAD & LOCATION PICKER HELPERS
   ===================================================== */

async function triggerDownload(blob: Blob, filename: string): Promise<boolean> {
  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "Excel File (*.xlsx)",
            accept: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
                ".xlsx",
              ],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err: any) {
      if (err.name === "AbortError") return false;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

async function saveFilesToDirectory(
  filesToSave: { name: string; blob: Blob }[]
): Promise<{ success: boolean; savedCount: number; message?: string }> {
  if (filesToSave.length === 0) return { success: false, savedCount: 0 };

  if (filesToSave.length === 1) {
    const ok = await triggerDownload(filesToSave[0].blob, filesToSave[0].name);
    return {
      success: ok,
      savedCount: ok ? 1 : 0,
      message: ok ? `Saved ${filesToSave[0].name}` : "Download cancelled.",
    };
  }

  if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      let count = 0;
      for (const item of filesToSave) {
        const fileHandle = await dirHandle.getFileHandle(item.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(item.blob);
        await writable.close();
        count++;
      }
      return {
        success: true,
        savedCount: count,
        message: `Successfully saved ${count} file(s) into selected folder.`,
      };
    } catch (err: any) {
      if (err.name === "AbortError") {
        return { success: false, savedCount: 0, message: "Folder selection cancelled." };
      }
    }
  }

  let count = 0;
  for (const item of filesToSave) {
    const ok = await triggerDownload(item.blob, item.name);
    if (ok) count++;
  }
  return {
    success: true,
    savedCount: count,
    message: `Downloaded ${count} file(s).`,
  };
}

async function fetchFileBlobFromUrl(url: string): Promise<Blob> {
  try {
    const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      return await res.blob();
    }
  } catch {
    // Fall back to direct fetch
  }
  const direct = await fetch(url);
  if (!direct.ok) throw new Error("Could not fetch file content from storage.");
  return await direct.blob();
}

/* =====================================================
   MAIN COMPONENT
   ===================================================== */

export default function NlbPreprocessPage() {
  // Sales files state
  const [salesFiles, setSalesFiles] = useState<FileEntry[]>([]);
  const [selectedSalesIds, setSelectedSalesIds] = useState<Set<string>>(new Set());
  const [salesValidationErrors, setSalesValidationErrors] = useState<string[]>([]);
  const [isSalesDragOver, setIsSalesDragOver] = useState(false);
  const [isProcessingSales, setIsProcessingSales] = useState(false);

  // Purchase files state
  const [purchaseFiles, setPurchaseFiles] = useState<FileEntry[]>([]);
  const [selectedPurchaseIds, setSelectedPurchaseIds] = useState<Set<string>>(new Set());
  const [purchaseValidationErrors, setPurchaseValidationErrors] = useState<string[]>([]);
  const [isPurchaseDragOver, setIsPurchaseDragOver] = useState(false);
  const [isProcessingPurchase, setIsProcessingPurchase] = useState(false);

  // Business date for Firebase tagging
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );

  // Saved Sales files in Firebase (nlb-sales)
  const [savedSalesFiles, setSavedSalesFiles] = useState<NlbUploadedFileRecord[]>([]);
  const [selectedSavedSalesIds, setSelectedSavedSalesIds] = useState<Set<string>>(new Set());
  const [savedSalesLoading, setSavedSalesLoading] = useState(false);
  const [savedSalesError, setSavedSalesError] = useState<string | null>(null);

  // Saved Purchase files in Firebase (nlb-purchases)
  const [savedPurchaseFiles, setSavedPurchaseFiles] = useState<NlbUploadedFileRecord[]>([]);
  const [selectedSavedPurchaseIds, setSelectedSavedPurchaseIds] = useState<Set<string>>(new Set());
  const [savedPurchaseLoading, setSavedPurchaseLoading] = useState(false);
  const [savedPurchaseError, setSavedPurchaseError] = useState<string | null>(null);

  // Action states
  const [isSavingFirebase, setIsSavingFirebase] = useState(false);
  const [savingFileId, setSavingFileId] = useState<string | null>(null);
  const [isDownloadingSelected, setIsDownloadingSelected] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Popup Preview Modal state
  const [previewModal, setPreviewModal] = useState<ModalPreviewData | null>(null);

  /* ---- Load saved files from Firebase for selectedDate ---- */

  const loadSavedSales = useCallback(async (date: string) => {
    if (!date) return;
    setSavedSalesLoading(true);
    setSavedSalesError(null);
    try {
      const records = await listNlbSalesFilesByDate(date);
      setSavedSalesFiles(records);
      setSelectedSavedSalesIds(new Set());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading saved sales files.";
      setSavedSalesError(msg);
      setSavedSalesFiles([]);
    } finally {
      setSavedSalesLoading(false);
    }
  }, []);

  const loadSavedPurchases = useCallback(async (date: string) => {
    if (!date) return;
    setSavedPurchaseLoading(true);
    setSavedPurchaseError(null);
    try {
      const records = await listNlbPurchaseFilesByDate(date);
      setSavedPurchaseFiles(records);
      setSelectedSavedPurchaseIds(new Set());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading saved purchase files.";
      setSavedPurchaseError(msg);
      setSavedPurchaseFiles([]);
    } finally {
      setSavedPurchaseLoading(false);
    }
  }, []);

  const loadAllSavedFiles = useCallback(
    async (date: string) => {
      await Promise.all([loadSavedSales(date), loadSavedPurchases(date)]);
    },
    [loadSavedSales, loadSavedPurchases]
  );

  useEffect(() => {
    loadAllSavedFiles(selectedDate);
  }, [selectedDate, loadAllSavedFiles]);

  const makeId = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /* ---- Helpers to get Clean Name & Blob ---- */

  function getCleanFileName(entry: FileEntry): string {
    const rawCode = entry.code.replace(/_STOCK$/i, "");
    if (entry.category === "purchase" || entry.result?.reportType === "purchase_range") {
      return `${rawCode}_stock.xlsx`;
    }
    return `${rawCode}.xlsx`;
  }

  function getEntryBlob(entry: FileEntry): Blob | null {
    if (!entry.result || entry.result.rows.length === 0) return null;
    if (entry.result.reportType === "purchase_range") {
      return generatePurchaseXlsx((entry.result as PurchaseReportResult).rows);
    }
    return generateCleanedXlsx((entry.result as PreprocessResult).rows);
  }

  /* =====================================================
     SALES SUMMARY FILES HANDLERS
     ===================================================== */

  const updateSalesEntry = useCallback(
    (id: string, patch: Partial<FileEntry>) =>
      setSalesFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
      ),
    []
  );

  function addSalesFiles(incoming: File[]) {
    const errs: string[] = [];
    const accepted: FileEntry[] = [];

    for (const file of incoming) {
      if (!/\.(xlsx?)$/i.test(file.name)) {
        errs.push(`"${file.name}": Only .xls and .xlsx files are allowed.`);
        continue;
      }

      const v = validateFilename(file.name);
      if (!v.valid || !v.code) {
        errs.push(v.error || `Invalid file: "${file.name}"`);
        continue;
      }

      const existingCodes = salesFiles.map((f) => f.code);
      const batchCodes = accepted.map((f) => f.code);

      if (existingCodes.includes(v.code) || batchCodes.includes(v.code)) {
        errs.push(`Duplicate: "${file.name}" is already added.`);
        continue;
      }

      accepted.push({
        id: makeId(),
        file,
        code: v.code,
        category: "sales",
        status: "waiting",
        result: null,
        errorMessage: null,
        isSavedToFirebase: false,
      });
    }

    setSalesValidationErrors(errs);
    if (accepted.length > 0) {
      setSalesFiles((prev) => [...prev, ...accepted]);
    }
  }

  async function processAllSales() {
    const toProcess = salesFiles.filter((f) => f.status === "waiting");
    if (toProcess.length === 0) return;

    setIsProcessingSales(true);

    for (const entry of toProcess) {
      updateSalesEntry(entry.id, { status: "processing", errorMessage: null });

      try {
        const formData = new FormData();
        formData.append("file", entry.file);

        const res = await fetch("/api/nlb-preprocess", {
          method: "POST",
          body: formData,
        });

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          updateSalesEntry(entry.id, {
            status: "failed",
            errorMessage: `Server returned ${res.status} ${res.statusText}`,
          });
          continue;
        }

        const body = await res.json();
        if (body.error && !body.status) {
          updateSalesEntry(entry.id, {
            status: "failed",
            errorMessage: body.error,
          });
          continue;
        }

        const result = body as AnyPreprocessResult;
        updateSalesEntry(entry.id, {
          status: result.status === "completed" ? "completed" : "failed",
          result,
          errorMessage:
            result.status === "failed" ? result.errors.join("; ") : null,
        });

        if (result.status === "completed") {
          setSelectedSalesIds((prev) => new Set(prev).add(entry.id));
        }
      } catch (err: unknown) {
        updateSalesEntry(entry.id, {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "Processing error.",
        });
      }
    }

    setIsProcessingSales(false);
  }

  /* =====================================================
     PURCHASE FILES HANDLERS
     ===================================================== */

  const updatePurchaseEntry = useCallback(
    (id: string, patch: Partial<FileEntry>) =>
      setPurchaseFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
      ),
    []
  );

  function addPurchaseFiles(incoming: File[]) {
    const errs: string[] = [];
    const accepted: FileEntry[] = [];

    for (const file of incoming) {
      if (!/\.(xlsx?)$/i.test(file.name)) {
        errs.push(`"${file.name}": Only .xls and .xlsx files are allowed.`);
        continue;
      }

      const v = validateFilename(file.name);
      if (!v.valid || !v.code) {
        errs.push(v.error || `Invalid file: "${file.name}"`);
        continue;
      }

      const fileKey = `${v.code}_STOCK`;
      const existingKeys = purchaseFiles.map((f) => f.code);
      const batchKeys = accepted.map((f) => f.code);

      if (existingKeys.includes(fileKey) || batchKeys.includes(fileKey)) {
        errs.push(`Duplicate: "${file.name}" is already added.`);
        continue;
      }

      accepted.push({
        id: makeId(),
        file,
        code: fileKey,
        category: "purchase",
        status: "waiting",
        result: null,
        errorMessage: null,
        isSavedToFirebase: false,
      });
    }

    setPurchaseValidationErrors(errs);
    if (accepted.length > 0) {
      setPurchaseFiles((prev) => [...prev, ...accepted]);
    }
  }

  async function processAllPurchase() {
    const toProcess = purchaseFiles.filter((f) => f.status === "waiting");
    if (toProcess.length === 0) return;

    setIsProcessingPurchase(true);

    for (const entry of toProcess) {
      updatePurchaseEntry(entry.id, { status: "processing", errorMessage: null });

      try {
        const formData = new FormData();
        formData.append("file", entry.file);

        const res = await fetch("/api/nlb-preprocess", {
          method: "POST",
          body: formData,
        });

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          updatePurchaseEntry(entry.id, {
            status: "failed",
            errorMessage: `Server returned ${res.status} ${res.statusText}`,
          });
          continue;
        }

        const body = await res.json();
        if (body.error && !body.status) {
          updatePurchaseEntry(entry.id, {
            status: "failed",
            errorMessage: body.error,
          });
          continue;
        }

        const result = body as AnyPreprocessResult;
        updatePurchaseEntry(entry.id, {
          status: result.status === "completed" ? "completed" : "failed",
          result,
          errorMessage:
            result.status === "failed" ? result.errors.join("; ") : null,
        });

        if (result.status === "completed") {
          setSelectedPurchaseIds((prev) => new Set(prev).add(entry.id));
        }
      } catch (err: unknown) {
        updatePurchaseEntry(entry.id, {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "Processing error.",
        });
      }
    }

    setIsProcessingPurchase(false);
  }

  /* =====================================================
     COMMON ACTIONS (Download, Save, Popup View)
     ===================================================== */

  async function handleDownloadSingle(entry: FileEntry) {
    const blob = getEntryBlob(entry);
    if (!blob) return;
    await triggerDownload(blob, getCleanFileName(entry));
  }

  async function handleDownloadBatch(entries: FileEntry[]) {
    if (entries.length === 0) return;
    setIsDownloadingSelected(true);
    try {
      const filesToSave = entries.map((e) => ({
        name: getCleanFileName(e),
        blob: getEntryBlob(e)!,
      }));

      const res = await saveFilesToDirectory(filesToSave);
      if (res.message) {
        setFeedbackMessage({ type: res.success ? "success" : "error", text: res.message });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error downloading files.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setIsDownloadingSelected(false);
    }
  }

  async function handleSaveSingleToFirebase(entry: FileEntry) {
    const blob = getEntryBlob(entry);
    if (!blob || !entry.result) return;
    const r = entry.result;
    const fileName = getCleanFileName(entry);
    const rawCode = entry.code.replace(/_STOCK$/i, "");

    setSavingFileId(entry.id);
    try {
      if (r.reportType === "purchase_range") {
        const pr = r as PurchaseReportResult;
        await saveNlbPurchaseFile(
          blob,
          fileName,
          rawCode,
          pr.drawNumber || "",
          pr.drawDate || "",
          pr.rowCount,
          pr.totalPurchase,
          pr.totalReturn,
          pr.netQuantity,
          selectedDate
        );
      } else {
        const sr = r as PreprocessResult;
        await saveNlbCleanedFile(
          blob,
          fileName,
          rawCode,
          sr.drawNumber || "",
          sr.rowCount,
          selectedDate
        );
      }

      if (r.reportType === "purchase_range") {
        updatePurchaseEntry(entry.id, { isSavedToFirebase: true });
        setFeedbackMessage({
          type: "success",
          text: `Saved ${fileName} to Firebase (nlb-purchases) for date ${selectedDate}!`,
        });
        await loadSavedPurchases(selectedDate);
      } else {
        updateSalesEntry(entry.id, { isSavedToFirebase: true });
        setFeedbackMessage({
          type: "success",
          text: `Saved ${fileName} to Firebase (nlb-sales) for date ${selectedDate}!`,
        });
        await loadSavedSales(selectedDate);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving to Firebase.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setSavingFileId(null);
    }
  }

  async function handleSaveBatchToFirebase(entries: FileEntry[]) {
    if (entries.length === 0) return;
    setIsSavingFirebase(true);
    try {
      let saved = 0;
      let hasSales = false;
      let hasPurchases = false;

      for (const entry of entries) {
        const blob = getEntryBlob(entry);
        if (!blob || !entry.result) continue;
        const r = entry.result;
        const fileName = getCleanFileName(entry);
        const rawCode = entry.code.replace(/_STOCK$/i, "");

        if (r.reportType === "purchase_range") {
          const pr = r as PurchaseReportResult;
          await saveNlbPurchaseFile(
            blob,
            fileName,
            rawCode,
            pr.drawNumber || "",
            pr.drawDate || "",
            pr.rowCount,
            pr.totalPurchase,
            pr.totalReturn,
            pr.netQuantity,
            selectedDate
          );
          updatePurchaseEntry(entry.id, { isSavedToFirebase: true });
          hasPurchases = true;
        } else {
          const sr = r as PreprocessResult;
          await saveNlbCleanedFile(
            blob,
            fileName,
            rawCode,
            sr.drawNumber || "",
            sr.rowCount,
            selectedDate
          );
          updateSalesEntry(entry.id, { isSavedToFirebase: true });
          hasSales = true;
        }
        saved++;
      }
      setFeedbackMessage({
        type: "success",
        text: `Saved ${saved} file(s) to Firebase for date ${selectedDate}!`,
      });
      if (hasSales) await loadSavedSales(selectedDate);
      if (hasPurchases) await loadSavedPurchases(selectedDate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving to Firebase.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setIsSavingFirebase(false);
    }
  }

  /* ---- Open Popup View Modal ---- */

  function handleOpenPopupView(
    entry: FileEntry,
    index?: number,
    list?: FileEntry[]
  ) {
    if (!entry.result) return;
    const r = entry.result;
    const cleanName = getCleanFileName(entry);
    const rawCode = entry.code.replace(/_STOCK$/i, "");
    const currentIndex =
      index ?? (list ? list.findIndex((f) => f.id === entry.id) : undefined);
    const totalCount = list?.length;

    const navProps = {
      currentIndex,
      totalCount,
      onPrevious:
        list && currentIndex != null && currentIndex > 0
          ? () => handleOpenPopupView(list[currentIndex - 1], currentIndex - 1, list)
          : undefined,
      onNext:
        list && currentIndex != null && currentIndex < list.length - 1
          ? () => handleOpenPopupView(list[currentIndex + 1], currentIndex + 1, list)
          : undefined,
    };

    const onDelete = () => {
      setSalesFiles((prev) => prev.filter((f) => f.id !== entry.id));
      setPurchaseFiles((prev) => prev.filter((f) => f.id !== entry.id));
      setSelectedSalesIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
      setSelectedPurchaseIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
      setPreviewModal(null);
    };

    if (r.reportType === "purchase_range") {
      const pr = r as PurchaseReportResult;
      setPreviewModal({
        title: cleanName,
        code: rawCode,
        reportType: "purchase_range",
        drawNumber: pr.drawNumber || "-",
        drawDate: pr.drawDate || "-",
        purchaseRows: pr.rows,
        totalPurchase: pr.totalPurchase,
        totalReturn: pr.totalReturn,
        netQuantity: pr.netQuantity,
        onDownload: () => handleDownloadSingle(entry),
        onSaveToFirebase: () => handleSaveSingleToFirebase(entry),
        onDelete,
        isSaved: entry.isSavedToFirebase,
        ...navProps,
      });
    } else {
      const sr = r as PreprocessResult;
      setPreviewModal({
        title: cleanName,
        code: rawCode,
        reportType: "sales_summary",
        drawNumber: sr.drawNumber || "-",
        salesRows: sr.rows,
        onDownload: () => handleDownloadSingle(entry),
        onSaveToFirebase: () => handleSaveSingleToFirebase(entry),
        onDelete,
        isSaved: entry.isSavedToFirebase,
        ...navProps,
      });
    }
  }

  async function handleOpenSavedPopupView(
    rec: NlbUploadedFileRecord,
    index?: number,
    list?: NlbUploadedFileRecord[]
  ) {
    const currentIndex =
      index ?? (list ? list.findIndex((f) => f.id === rec.id) : undefined);
    const totalCount = list?.length;

    const navProps = {
      currentIndex,
      totalCount,
      onPrevious:
        list && currentIndex != null && currentIndex > 0
          ? () => handleOpenSavedPopupView(list[currentIndex - 1], currentIndex - 1, list)
          : undefined,
      onNext:
        list && currentIndex != null && currentIndex < list.length - 1
          ? () => handleOpenSavedPopupView(list[currentIndex + 1], currentIndex + 1, list)
          : undefined,
    };

    const onDelete = async () => {
      await handleDeleteSaved(rec);
      setPreviewModal(null);
    };

    // Show immediate feedback with loading state
    setPreviewModal((prev) => ({
      ...(prev || {
        title: rec.fileName,
        code: rec.code,
        reportType: rec.reportType,
        drawNumber: rec.drawNumber || "-",
      }),
      title: rec.fileName,
      code: rec.code,
      reportType: rec.reportType,
      drawNumber: rec.drawNumber || "-",
      drawDate: rec.drawDate || "-",
      totalPurchase: rec.totalPurchase,
      totalReturn: rec.totalReturn,
      netQuantity: rec.netQuantity,
      onDownload: () => handleDownloadSingleSaved(rec),
      onDelete,
      isSaved: true,
      isLoading: true,
      ...navProps,
    }));

    try {
      const blob = await fetchFileBlobFromUrl(rec.downloadUrl);
      const ab = await blob.arrayBuffer();
      const wb = XLSX.read(ab, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      if (rec.reportType === "purchase_range") {
        const rows: PurchaseRow[] = [];
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (!row || row.length < 9) continue;
          rows.push({
            drawNumber: String(row[0]),
            drawDate: String(row[1]),
            txType: row[2] as "PURCHASE" | "RETURN",
            txDate: String(row[3]),
            serialNumber: String(row[4]),
            reference: String(row[5]),
            startingBarcode: String(row[6]),
            endingBarcode: String(row[7]),
            quantity: Number(row[8]),
          });
        }
        setPreviewModal({
          title: rec.fileName,
          code: rec.code,
          reportType: "purchase_range",
          drawNumber: rec.drawNumber || "-",
          drawDate: rec.drawDate || "-",
          purchaseRows: rows,
          totalPurchase: rec.totalPurchase,
          totalReturn: rec.totalReturn,
          netQuantity: rec.netQuantity,
          onDownload: () => handleDownloadSingleSaved(rec),
          onDelete,
          isSaved: true,
          isLoading: false,
          ...navProps,
        });
      } else {
        const rows: ProcessedRow[] = [];
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (!row || row.length < 4) continue;
          rows.push({
            drawNumber: String(row[0]),
            agentCode: String(row[1]),
            startingBarcode: String(row[2]),
            quantity: Number(row[3]),
          });
        }
        setPreviewModal({
          title: rec.fileName,
          code: rec.code,
          reportType: "sales_summary",
          drawNumber: rec.drawNumber || "-",
          salesRows: rows,
          onDownload: () => handleDownloadSingleSaved(rec),
          onDelete,
          isSaved: true,
          isLoading: false,
          ...navProps,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error opening preview.";
      setFeedbackMessage({ type: "error", text: msg });
      setPreviewModal((prev) => (prev ? { ...prev, isLoading: false } : null));
    }
  }

  /* ---- Saved Firebase Actions ---- */

  async function handleDownloadSingleSaved(rec: NlbUploadedFileRecord) {
    try {
      const blob = await fetchFileBlobFromUrl(rec.downloadUrl);
      await triggerDownload(blob, rec.fileName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error downloading file.";
      setFeedbackMessage({ type: "error", text: msg });
    }
  }

  async function handleDownloadSelectedSavedSales() {
    const recordsToDownload = savedSalesFiles.filter((f) => selectedSavedSalesIds.has(f.id));
    if (recordsToDownload.length === 0) return;

    setIsDownloadingSelected(true);
    try {
      const filesToSave: { name: string; blob: Blob }[] = [];
      for (const rec of recordsToDownload) {
        const blob = await fetchFileBlobFromUrl(rec.downloadUrl);
        filesToSave.push({ name: rec.fileName, blob });
      }

      const res = await saveFilesToDirectory(filesToSave);
      if (res.message) {
        setFeedbackMessage({ type: res.success ? "success" : "error", text: res.message });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error downloading selected sales files.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setIsDownloadingSelected(false);
    }
  }

  async function handleDownloadSelectedSavedPurchases() {
    const recordsToDownload = savedPurchaseFiles.filter((f) => selectedSavedPurchaseIds.has(f.id));
    if (recordsToDownload.length === 0) return;

    setIsDownloadingSelected(true);
    try {
      const filesToSave: { name: string; blob: Blob }[] = [];
      for (const rec of recordsToDownload) {
        const blob = await fetchFileBlobFromUrl(rec.downloadUrl);
        filesToSave.push({ name: rec.fileName, blob });
      }

      const res = await saveFilesToDirectory(filesToSave);
      if (res.message) {
        setFeedbackMessage({ type: res.success ? "success" : "error", text: res.message });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error downloading selected purchase files.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setIsDownloadingSelected(false);
    }
  }

  async function handleDeleteSaved(rec: NlbUploadedFileRecord) {
    if (typeof window !== "undefined" && window.confirm) {
      if (!window.confirm(`Delete ${rec.fileName} from Firebase?`)) return;
    }
    setDeletingRecordId(rec.id);

    // Optimistic removal so file disappears immediately
    setSavedPurchaseFiles((prev) => prev.filter((f) => f.id !== rec.id && f.fileName !== rec.fileName));
    setSavedSalesFiles((prev) => prev.filter((f) => f.id !== rec.id && f.fileName !== rec.fileName));
    setSelectedSavedPurchaseIds((prev) => {
      const next = new Set(prev);
      next.delete(rec.id);
      return next;
    });
    setSelectedSavedSalesIds((prev) => {
      const next = new Set(prev);
      next.delete(rec.id);
      return next;
    });

    try {
      await deleteNlbUploadedFile(rec);
      await Promise.all([
        loadSavedSales(selectedDate),
        loadSavedPurchases(selectedDate),
      ]);
      setFeedbackMessage({
        type: "success",
        text: `Deleted ${rec.fileName} from Firebase.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error deleting file.";
      setFeedbackMessage({ type: "error", text: msg });
      await Promise.all([
        loadSavedSales(selectedDate),
        loadSavedPurchases(selectedDate),
      ]);
    } finally {
      setDeletingRecordId(null);
    }
  }

  async function handleDeleteSelectedSavedSales() {
    const recordsToDelete = savedSalesFiles.filter((f) => selectedSavedSalesIds.has(f.id));
    if (recordsToDelete.length === 0) return;
    if (typeof window !== "undefined" && window.confirm) {
      if (!window.confirm(`Delete ${recordsToDelete.length} selected Sales file(s) from Firebase?`)) return;
    }

    const idsToDelete = new Set(recordsToDelete.map((r) => r.id));
    setSavedSalesFiles((prev) => prev.filter((f) => !idsToDelete.has(f.id)));
    setSelectedSavedSalesIds(new Set());

    try {
      for (const rec of recordsToDelete) {
        await deleteNlbUploadedFile(rec);
      }
      await loadSavedSales(selectedDate);
      setFeedbackMessage({
        type: "success",
        text: `Deleted ${recordsToDelete.length} Sales file(s) from Firebase.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error deleting sales files.";
      setFeedbackMessage({ type: "error", text: msg });
      await loadSavedSales(selectedDate);
    }
  }

  async function handleDeleteSelectedSavedPurchases() {
    const recordsToDelete = savedPurchaseFiles.filter((f) => selectedSavedPurchaseIds.has(f.id));
    if (recordsToDelete.length === 0) return;
    if (typeof window !== "undefined" && window.confirm) {
      if (!window.confirm(`Delete ${recordsToDelete.length} selected Purchase file(s) from Firebase?`)) return;
    }

    const idsToDelete = new Set(recordsToDelete.map((r) => r.id));
    setSavedPurchaseFiles((prev) => prev.filter((f) => !idsToDelete.has(f.id)));
    setSelectedSavedPurchaseIds(new Set());

    try {
      for (const rec of recordsToDelete) {
        await deleteNlbUploadedFile(rec);
      }
      await loadSavedPurchases(selectedDate);
      setFeedbackMessage({
        type: "success",
        text: `Deleted ${recordsToDelete.length} Purchase file(s) from Firebase.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error deleting purchase files.";
      setFeedbackMessage({ type: "error", text: msg });
      await loadSavedPurchases(selectedDate);
    }
  }

  const completedSales = salesFiles.filter(
    (f) => f.status === "completed" && f.result && f.result.rows.length > 0
  );
  const completedPurchase = purchaseFiles.filter(
    (f) => f.status === "completed" && f.result && f.result.rows.length > 0
  );

  /* =====================================================
     RENDER
     ===================================================== */

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-900 py-8 px-4">
      <div className="w-full max-w-6xl p-6 rounded-xl bg-white shadow-sm border border-gray-200 space-y-6">
        {/* ---------- Header ---------- */}
        <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-gray-200">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              NLB File Manager
            </h1>
            <p className="text-xs text-gray-500">
              Process, verify, and export sales allocations and stock range reports
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/nlb-returns"
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
            >
              NLB Returns →
            </Link>
          </div>
        </div>

        {/* ---------- Feedback Alert Banner ---------- */}
        {feedbackMessage && (
          <div
            className={`p-3 rounded-lg border flex items-center justify-between text-xs font-medium transition-all ${
              feedbackMessage.type === "success"
                ? "bg-green-50 border-green-300 text-green-800"
                : "bg-red-50 border-red-300 text-red-800"
            }`}
          >
            <span>{feedbackMessage.text}</span>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="ml-3 text-gray-400 hover:text-gray-700 font-bold px-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* ---------- Date Bar ---------- */}
        <div className="flex items-center justify-between gap-4 flex-wrap bg-gray-50 px-4 py-2.5 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2.5">
            <label htmlFor="nlb-date-input" className="text-xs font-semibold text-gray-700">
              Processing Date:
            </label>
            <input
              id="nlb-date-input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs bg-white font-medium shadow-2xs focus:ring-2 focus:ring-teal-500 focus:outline-hidden cursor-pointer"
            />
          </div>

          <span className="text-xs text-gray-400 font-mono">
            {selectedDate}
          </span>
        </div>

        {/* =====================================================
            SECTION 1: SALES ALLOCATION FILES
            ===================================================== */}
        <section className="border border-teal-200 rounded-xl p-5 bg-teal-50/20 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-600"></span>
              <h2 className="text-sm font-bold text-teal-950">
                Sales Allocation Files
              </h2>
            </div>
            <span className="text-[11px] font-mono text-teal-700 bg-teal-100/70 px-2 py-0.5 rounded">
              {ALLOWED_CODES.join(", ")}
            </span>
          </div>

          {/* Sales Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsSalesDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsSalesDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsSalesDragOver(false);
              if (e.dataTransfer.files) addSalesFiles(Array.from(e.dataTransfer.files));
            }}
            className={`flex flex-col items-center justify-center p-5 rounded-xl border-2 border-dashed transition-colors ${
              isSalesDragOver
                ? "border-teal-500 bg-teal-100/40"
                : "border-teal-300 bg-white"
            }`}
          >
            <label
              htmlFor="nlb-sales-input"
              className="cursor-pointer bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2 px-5 rounded-lg shadow-xs text-xs transition-all"
            >
              Upload Sales Files
            </label>
            <p className="text-gray-400 text-xs mt-1.5">
              Drag &amp; drop .xls or .xlsx allocation reports
            </p>
            <input
              id="nlb-sales-input"
              type="file"
              accept=".xls,.xlsx"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addSalesFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
          </div>

          {salesValidationErrors.length > 0 && (
            <div className="border border-red-300 bg-red-50 rounded p-2.5 space-y-1">
              {salesValidationErrors.map((msg, i) => (
                <p key={i} className="text-xs text-red-800">✕ {msg}</p>
              ))}
            </div>
          )}

          {/* Sales Batch Cards */}
          {salesFiles.length > 0 && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-gray-700">
                  Current Batch ({salesFiles.length})
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  {salesFiles.filter((f) => f.status === "waiting").length > 0 && (
                    <button
                      type="button"
                      onClick={processAllSales}
                      disabled={isProcessingSales}
                      className="px-3 py-1 rounded bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer"
                    >
                      {isProcessingSales ? "Processing…" : "Process All"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSalesFiles([]);
                      setSelectedSalesIds(new Set());
                    }}
                    className="px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-700 text-xs hover:bg-gray-50 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Ticking Toolbar for Sales */}
              {completedSales.length > 0 && (
                <div className="flex items-center justify-between bg-teal-100/60 border border-teal-300 rounded-lg p-2 flex-wrap gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-teal-900 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        selectedSalesIds.size === completedSales.length &&
                        completedSales.length > 0
                      }
                      onChange={() => {
                        if (selectedSalesIds.size === completedSales.length) {
                          setSelectedSalesIds(new Set());
                        } else {
                          setSelectedSalesIds(new Set(completedSales.map((e) => e.id)));
                        }
                      }}
                      className="rounded text-teal-600 focus:ring-teal-500"
                    />
                    <span>Select All ({selectedSalesIds.size}/{completedSales.length})</span>
                  </label>

                  {selectedSalesIds.size > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleDownloadBatch(
                            salesFiles.filter((f) => selectedSalesIds.has(f.id))
                          )
                        }
                        disabled={isDownloadingSelected}
                        className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer"
                      >
                        Download ({selectedSalesIds.size})
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleSaveBatchToFirebase(
                            salesFiles.filter((f) => selectedSalesIds.has(f.id))
                          )
                        }
                        disabled={isSavingFirebase}
                        className="px-3 py-1 rounded bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer"
                      >
                        Save to Cloud ({selectedSalesIds.size})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSalesFiles((prev) => prev.filter((f) => !selectedSalesIds.has(f.id)));
                          setSelectedSalesIds(new Set());
                        }}
                        className="px-2.5 py-1 rounded border border-red-300 text-red-600 text-xs bg-white hover:bg-red-50 font-medium cursor-pointer"
                      >
                        Remove ({selectedSalesIds.size})
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {salesFiles.map((entry, idx) => (
                  <FileCard
                    key={entry.id}
                    entry={entry}
                    cleanFileName={getCleanFileName(entry)}
                    isSelected={selectedSalesIds.has(entry.id)}
                    onToggleSelect={() => {
                      setSelectedSalesIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(entry.id)) next.delete(entry.id);
                        else next.add(entry.id);
                        return next;
                      });
                    }}
                    onRemove={() => {
                      setSalesFiles((prev) => prev.filter((f) => f.id !== entry.id));
                      setSelectedSalesIds((prev) => {
                        const next = new Set(prev);
                        next.delete(entry.id);
                        return next;
                      });
                    }}
                    onDownload={() => handleDownloadSingle(entry)}
                    onSaveToFirebase={() => handleSaveSingleToFirebase(entry)}
                    onOpenPopupView={() => handleOpenPopupView(entry, idx, salesFiles)}
                    isSavingFirebase={savingFileId === entry.id}
                    isProcessingAll={isProcessingSales}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ---------------- Saved Sales Files ---------------- */}
          <div className="mt-4 pt-4 border-t border-teal-200/70 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-teal-600"></span>
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-900">
                  Saved Sales Files ({savedSalesFiles.length})
                </h3>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {selectedSavedSalesIds.size > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handleDownloadSelectedSavedSales}
                      disabled={isDownloadingSelected}
                      className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer"
                    >
                      Download ({selectedSavedSalesIds.size})
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSelectedSavedSales}
                      className="px-2.5 py-1 rounded border border-red-300 text-red-600 text-xs bg-white hover:bg-red-50 font-medium cursor-pointer"
                    >
                      Delete ({selectedSavedSalesIds.size})
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => loadSavedSales(selectedDate)}
                  disabled={savedSalesLoading}
                  className="px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-700 text-xs font-medium hover:bg-gray-100 disabled:opacity-60 cursor-pointer"
                >
                  {savedSalesLoading ? "Loading…" : "Refresh"}
                </button>
              </div>
            </div>

            {savedSalesLoading && (
              <p className="text-xs text-gray-500 py-2 text-center">
                Loading saved files…
              </p>
            )}

            {savedSalesError && (
              <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200">
                ✕ {savedSalesError}
              </p>
            )}

            {savedSalesFiles.length === 0 && !savedSalesLoading && !savedSalesError && (
              <div className="bg-white p-3 rounded-lg border border-dashed border-teal-300 text-center text-xs text-gray-500">
                No saved files found for {selectedDate}.
              </div>
            )}

            {savedSalesFiles.length > 0 && (
              <div className="border border-teal-200 rounded-lg overflow-hidden bg-white shadow-xs">
                <table className="min-w-full text-xs">
                  <thead className="bg-teal-50/80 border-b border-teal-200">
                    <tr>
                      <th className="w-10 px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={
                            selectedSavedSalesIds.size === savedSalesFiles.length &&
                            savedSalesFiles.length > 0
                          }
                          onChange={() => {
                            if (selectedSavedSalesIds.size === savedSalesFiles.length) {
                              setSelectedSavedSalesIds(new Set());
                            } else {
                              setSelectedSavedSalesIds(new Set(savedSalesFiles.map((f) => f.id)));
                            }
                          }}
                          className="rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
                        />
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-teal-950">File</th>
                      <th className="px-3 py-2 text-left font-semibold text-teal-950">Draw</th>
                      <th className="px-3 py-2 text-right font-semibold text-teal-950">Rows</th>
                      <th className="px-3 py-2 text-right font-semibold text-teal-950">Size</th>
                      <th className="px-3 py-2 text-center font-semibold text-teal-950">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {savedSalesFiles.map((rec, idx) => (
                      <tr
                        key={rec.id}
                        className={`hover:bg-teal-50/40 transition-colors ${
                          selectedSavedSalesIds.has(rec.id) ? "bg-teal-50/60" : ""
                        }`}
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedSavedSalesIds.has(rec.id)}
                            onChange={() => {
                              setSelectedSavedSalesIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(rec.id)) next.delete(rec.id);
                                else next.add(rec.id);
                                return next;
                              });
                            }}
                            className="rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono font-bold text-teal-800">{rec.fileName}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-gray-700">
                          {rec.drawNumber || "-"}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-800">
                          {rec.rowCount}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500 font-mono text-[11px]">
                          {(rec.size / 1024).toFixed(1)} KB
                        </td>
                        <td className="px-3 py-2 text-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenSavedPopupView(rec, idx, savedSalesFiles)}
                            className="px-2.5 py-1 rounded bg-teal-50 text-teal-800 hover:bg-teal-100 border border-teal-200 text-[11px] font-semibold cursor-pointer"
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadSingleSaved(rec)}
                            className="px-2.5 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-[11px] font-medium shadow-xs cursor-pointer"
                          >
                            Download
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSaved(rec)}
                            disabled={deletingRecordId === rec.id}
                            className="px-2 py-1 rounded border border-red-300 text-red-600 text-[11px] hover:bg-red-50 disabled:opacity-50 cursor-pointer"
                          >
                            {deletingRecordId === rec.id ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* =====================================================
            SECTION 2: PURCHASE & RETURN REPORTS (STOCK)
            ===================================================== */}
        <section className="border border-indigo-200 rounded-xl p-5 bg-indigo-50/20 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
              <h2 className="text-sm font-bold text-indigo-950">
                Purchase &amp; Return Reports (Stock)
              </h2>
            </div>
            <span className="text-[11px] font-mono text-indigo-700 bg-indigo-100/70 px-2 py-0.5 rounded">
              e.g. MST, ADE, GSE
            </span>
          </div>

          {/* Purchase Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsPurchaseDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsPurchaseDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsPurchaseDragOver(false);
              if (e.dataTransfer.files) addPurchaseFiles(Array.from(e.dataTransfer.files));
            }}
            className={`flex flex-col items-center justify-center p-5 rounded-xl border-2 border-dashed transition-colors ${
              isPurchaseDragOver
                ? "border-indigo-500 bg-indigo-100/40"
                : "border-indigo-300 bg-white"
            }`}
          >
            <label
              htmlFor="nlb-purchase-input"
              className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-5 rounded-lg shadow-xs text-xs transition-all"
            >
              Upload Purchase Files
            </label>
            <p className="text-gray-400 text-xs mt-1.5">
              Drag &amp; drop .xls or .xlsx stock range reports
            </p>
            <input
              id="nlb-purchase-input"
              type="file"
              accept=".xls,.xlsx"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addPurchaseFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
          </div>

          {purchaseValidationErrors.length > 0 && (
            <div className="border border-red-300 bg-red-50 rounded p-2.5 space-y-1">
              {purchaseValidationErrors.map((msg, i) => (
                <p key={i} className="text-xs text-red-800">✕ {msg}</p>
              ))}
            </div>
          )}

          {/* Purchase Batch Cards */}
          {purchaseFiles.length > 0 && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-gray-700">
                  Current Batch ({purchaseFiles.length})
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  {purchaseFiles.filter((f) => f.status === "waiting").length > 0 && (
                    <button
                      type="button"
                      onClick={processAllPurchase}
                      disabled={isProcessingPurchase}
                      className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer"
                    >
                      {isProcessingPurchase ? "Processing…" : "Process All"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setPurchaseFiles([]);
                      setSelectedPurchaseIds(new Set());
                    }}
                    className="px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-700 text-xs hover:bg-gray-50 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Ticking Toolbar for Purchase */}
              {completedPurchase.length > 0 && (
                <div className="flex items-center justify-between bg-indigo-100/60 border border-indigo-300 rounded-lg p-2 flex-wrap gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-indigo-900 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        selectedPurchaseIds.size === completedPurchase.length &&
                        completedPurchase.length > 0
                      }
                      onChange={() => {
                        if (selectedPurchaseIds.size === completedPurchase.length) {
                          setSelectedPurchaseIds(new Set());
                        } else {
                          setSelectedPurchaseIds(new Set(completedPurchase.map((e) => e.id)));
                        }
                      }}
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Select All ({selectedPurchaseIds.size}/{completedPurchase.length})</span>
                  </label>

                  {selectedPurchaseIds.size > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleDownloadBatch(
                            purchaseFiles.filter((f) => selectedPurchaseIds.has(f.id))
                          )
                        }
                        disabled={isDownloadingSelected}
                        className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer"
                      >
                        Download ({selectedPurchaseIds.size})
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleSaveBatchToFirebase(
                            purchaseFiles.filter((f) => selectedPurchaseIds.has(f.id))
                          )
                        }
                        disabled={isSavingFirebase}
                        className="px-3 py-1 rounded bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer"
                      >
                        Save ({selectedPurchaseIds.size})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPurchaseFiles((prev) => prev.filter((f) => !selectedPurchaseIds.has(f.id)));
                          setSelectedPurchaseIds(new Set());
                        }}
                        className="px-2.5 py-1 rounded border border-red-300 text-red-600 text-xs bg-white hover:bg-red-50 font-medium cursor-pointer"
                      >
                        Remove ({selectedPurchaseIds.size})
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {purchaseFiles.map((entry, idx) => (
                  <FileCard
                    key={entry.id}
                    entry={entry}
                    cleanFileName={getCleanFileName(entry)}
                    isSelected={selectedPurchaseIds.has(entry.id)}
                    onToggleSelect={() => {
                      setSelectedPurchaseIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(entry.id)) next.delete(entry.id);
                        else next.add(entry.id);
                        return next;
                      });
                    }}
                    onRemove={() => {
                      setPurchaseFiles((prev) => prev.filter((f) => f.id !== entry.id));
                      setSelectedPurchaseIds((prev) => {
                        const next = new Set(prev);
                        next.delete(entry.id);
                        return next;
                      });
                    }}
                    onDownload={() => handleDownloadSingle(entry)}
                    onSaveToFirebase={() => handleSaveSingleToFirebase(entry)}
                    onOpenPopupView={() => handleOpenPopupView(entry, idx, purchaseFiles)}
                    isSavingFirebase={savingFileId === entry.id}
                    isProcessingAll={isProcessingPurchase}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ---------------- Saved Purchase Files ---------------- */}
          <div className="mt-4 pt-4 border-t border-indigo-200/70 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-900">
                  Saved Purchase Files ({savedPurchaseFiles.length})
                </h3>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {selectedSavedPurchaseIds.size > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handleDownloadSelectedSavedPurchases}
                      disabled={isDownloadingSelected}
                      className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer"
                    >
                      Download ({selectedSavedPurchaseIds.size})
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSelectedSavedPurchases}
                      className="px-2.5 py-1 rounded border border-red-300 text-red-600 text-xs bg-white hover:bg-red-50 font-medium cursor-pointer"
                    >
                      Delete ({selectedSavedPurchaseIds.size})
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => loadSavedPurchases(selectedDate)}
                  disabled={savedPurchaseLoading}
                  className="px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-700 text-xs font-medium hover:bg-gray-100 disabled:opacity-60 cursor-pointer"
                >
                  {savedPurchaseLoading ? "Loading…" : "Refresh"}
                </button>
              </div>
            </div>

            {savedPurchaseLoading && (
              <p className="text-xs text-gray-500 py-2 text-center">
                Loading saved files…
              </p>
            )}

            {savedPurchaseError && (
              <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200">
                ✕ {savedPurchaseError}
              </p>
            )}

            {savedPurchaseFiles.length === 0 && !savedPurchaseLoading && !savedPurchaseError && (
              <div className="bg-white p-3 rounded-lg border border-dashed border-indigo-300 text-center text-xs text-gray-500">
                No saved purchase files found for {selectedDate}.
              </div>
            )}

            {savedPurchaseFiles.length > 0 && (
              <div className="border border-indigo-200 rounded-lg overflow-hidden bg-white shadow-xs">
                <table className="min-w-full text-xs">
                  <thead className="bg-indigo-50/80 border-b border-indigo-200">
                    <tr>
                      <th className="w-10 px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={
                            selectedSavedPurchaseIds.size === savedPurchaseFiles.length &&
                            savedPurchaseFiles.length > 0
                          }
                          onChange={() => {
                            if (selectedSavedPurchaseIds.size === savedPurchaseFiles.length) {
                              setSelectedSavedPurchaseIds(new Set());
                            } else {
                              setSelectedSavedPurchaseIds(new Set(savedPurchaseFiles.map((f) => f.id)));
                            }
                          }}
                          className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-indigo-950">File</th>
                      <th className="px-3 py-2 text-left font-semibold text-indigo-950">Draw</th>
                      <th className="px-3 py-2 text-right font-semibold text-indigo-950">Purchase</th>
                      <th className="px-3 py-2 text-right font-semibold text-indigo-950">Return</th>
                      <th className="px-3 py-2 text-right font-semibold text-indigo-950">Net Quantity</th>
                      <th className="px-3 py-2 text-right font-semibold text-indigo-950">Size</th>
                      <th className="px-3 py-2 text-center font-semibold text-indigo-950">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {savedPurchaseFiles.map((rec, idx) => (
                      <tr
                        key={rec.id}
                        className={`hover:bg-indigo-50/40 transition-colors ${
                          selectedSavedPurchaseIds.has(rec.id) ? "bg-indigo-50/60" : ""
                        }`}
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedSavedPurchaseIds.has(rec.id)}
                            onChange={() => {
                              setSelectedSavedPurchaseIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(rec.id)) next.delete(rec.id);
                                else next.add(rec.id);
                                return next;
                              });
                            }}
                            className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono font-bold text-indigo-800">{rec.fileName}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-gray-700">
                          {rec.drawNumber || "-"}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-green-700">
                          {rec.totalPurchase != null ? rec.totalPurchase.toLocaleString() : "-"}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-red-600">
                          {rec.totalReturn != null ? `-${rec.totalReturn.toLocaleString()}` : "-"}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-indigo-900">
                          {rec.netQuantity != null ? rec.netQuantity.toLocaleString() : `${rec.rowCount}`}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500 font-mono text-[11px]">
                          {(rec.size / 1024).toFixed(1)} KB
                        </td>
                        <td className="px-3 py-2 text-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenSavedPopupView(rec, idx, savedPurchaseFiles)}
                            className="px-2.5 py-1 rounded bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-200 text-[11px] font-semibold cursor-pointer"
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadSingleSaved(rec)}
                            className="px-2.5 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-[11px] font-medium shadow-xs cursor-pointer"
                          >
                            Download
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSaved(rec)}
                            disabled={deletingRecordId === rec.id}
                            className="px-2 py-1 rounded border border-red-300 text-red-600 text-[11px] hover:bg-red-50 disabled:opacity-50 cursor-pointer"
                          >
                            {deletingRecordId === rec.id ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* =====================================================
          FILE PREVIEW MODAL
          ===================================================== */}
      {previewModal && (
        <FilePreviewModal
          data={previewModal}
          onClose={() => setPreviewModal(null)}
        />
      )}
    </main>
  );
}

/* =====================================================
   FILE CARD SUB-COMPONENT
   ===================================================== */

function FileCard({
  entry,
  cleanFileName,
  isSelected,
  onToggleSelect,
  onRemove,
  onDownload,
  onSaveToFirebase,
  onOpenPopupView,
  isSavingFirebase,
  isProcessingAll,
}: {
  entry: FileEntry;
  cleanFileName: string;
  isSelected: boolean;
  onToggleSelect: () => void;
  onRemove: () => void;
  onDownload: () => void;
  onSaveToFirebase: () => void;
  onOpenPopupView: () => void;
  isSavingFirebase: boolean;
  isProcessingAll: boolean;
}) {
  const r = entry.result;
  const isPurchase = r?.reportType === "purchase_range" || entry.category === "purchase";
  const pr = r?.reportType === "purchase_range" ? (r as PurchaseReportResult) : null;
  const sr = r?.reportType !== "purchase_range" && r ? (r as PreprocessResult) : null;

  const statusColors: Record<FileEntry["status"], string> = {
    waiting: "bg-gray-100 text-gray-700 border-gray-300",
    processing: "bg-amber-100 text-amber-800 border-amber-300",
    completed: "bg-green-100 text-green-800 border-green-300",
    failed: "bg-red-100 text-red-800 border-red-300",
  };

  const statusLabels: Record<FileEntry["status"], string> = {
    waiting: "Ready",
    processing: "Processing…",
    completed: "Processed",
    failed: "Failed",
  };

  return (
    <div
      className={`border rounded-lg bg-white p-3.5 space-y-2 transition-all shadow-2xs ${
        isSelected
          ? isPurchase
            ? "border-indigo-400 bg-indigo-50/20"
            : "border-teal-400 bg-teal-50/20"
          : "border-gray-200"
      }`}
    >
      {/* Top row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          {entry.status === "completed" && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className={`rounded cursor-pointer ${
                isPurchase ? "text-indigo-600 focus:ring-indigo-500" : "text-teal-600 focus:ring-teal-500"
              }`}
            />
          )}

          <span
            className={`font-mono text-sm font-bold shrink-0 ${
              isPurchase ? "text-indigo-700" : "text-teal-700"
            }`}
          >
            {entry.code.replace(/_STOCK$/i, "")}
          </span>

          <span className="text-xs text-gray-500 truncate font-mono">
            {entry.file.name}
          </span>

          <span
            className={`px-2 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${statusColors[entry.status]}`}
          >
            {statusLabels[entry.status]}
          </span>

          {entry.isSavedToFirebase && (
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 shrink-0">
              Saved
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {entry.status === "completed" && r && r.rows.length > 0 && (
            <>
              <button
                type="button"
                onClick={onOpenPopupView}
                className="px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 text-xs font-semibold shadow-2xs cursor-pointer"
              >
                Preview
              </button>

              <button
                type="button"
                onClick={onDownload}
                className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-medium shadow-2xs cursor-pointer"
              >
                Download
              </button>

              <button
                type="button"
                onClick={onSaveToFirebase}
                disabled={isSavingFirebase}
                className={`px-2.5 py-1 rounded text-white text-xs font-medium shadow-2xs disabled:opacity-60 cursor-pointer ${
                  isPurchase
                    ? "bg-indigo-700 hover:bg-indigo-800"
                    : "bg-teal-700 hover:bg-teal-800"
                }`}
              >
                {isSavingFirebase ? "Saving…" : "Save"}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onRemove}
            disabled={isProcessingAll && entry.status === "processing"}
            className="px-2 py-1 rounded border border-gray-300 text-gray-600 text-xs bg-white hover:bg-gray-100 hover:text-red-600 disabled:opacity-40 cursor-pointer"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Metadata row */}
      {entry.status === "completed" && r && (
        <div className="text-xs text-gray-600 pt-0.5">
          {isPurchase && pr ? (
            <div className="flex items-center gap-3 flex-wrap text-[11px]">
              <span>Draw <strong className="font-mono text-gray-900">{pr.drawNumber}</strong> {pr.drawDate ? `(${pr.drawDate})` : ""}</span>
              <span className="text-gray-300">•</span>
              <span>Purchase: <strong className="text-green-700 font-mono">{pr.totalPurchase.toLocaleString()}</strong></span>
              <span className="text-gray-300">•</span>
              <span>Return: <strong className="text-red-600 font-mono">-{pr.totalReturn.toLocaleString()}</strong></span>
              <span className="text-gray-300">•</span>
              <span>Net: <strong className="text-teal-800 font-mono font-bold">{pr.netQuantity.toLocaleString()}</strong></span>
            </div>
          ) : sr ? (
            <div className="flex items-center gap-3 flex-wrap text-[11px]">
              <span>Draw <strong className="font-mono text-gray-900">{sr.drawNumber}</strong></span>
              <span className="text-gray-300">•</span>
              <span>Allocations: <strong className="text-teal-800 font-mono">{sr.rowCount.toLocaleString()}</strong> rows</span>
            </div>
          ) : null}
        </div>
      )}

      {entry.status === "failed" && (
        <p className="text-xs text-red-700">
          ✕ {entry.errorMessage || "Processing failed."}
        </p>
      )}
    </div>
  );
}

/* =====================================================
   POPUP VIEW MODAL ("FILE CHECK IT POPUP VIEW")
   ===================================================== */

function FilePreviewModal({
  data,
  onClose,
}: {
  data: ModalPreviewData;
  onClose: () => void;
}) {
  const isPurchase = data.reportType === "purchase_range";

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && data.onPrevious && !data.isLoading) {
        data.onPrevious();
      }
      if (e.key === "ArrowRight" && data.onNext && !data.isLoading) {
        data.onNext();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, data.onPrevious, data.onNext, data.isLoading]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-300 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span
              className={`text-xl font-bold font-mono px-2.5 py-1 rounded-lg border ${
                isPurchase
                  ? "text-indigo-800 bg-indigo-50 border-indigo-200"
                  : "text-teal-800 bg-teal-50 border-teal-200"
              }`}
            >
              {data.code}
            </span>
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2.5 flex-wrap">
                <span>{data.title}</span>
                <span className="px-3 py-1 rounded-md text-sm font-mono font-black bg-blue-100 text-blue-900 border border-blue-300 shadow-xs">
                  Draw #{data.drawNumber}
                </span>
                {isPurchase ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800">
                    Purchase &amp; Return
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800">
                    Sales Allocation
                  </span>
                )}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Header Next / Previous Pager */}
            {data.totalCount != null && data.totalCount > 1 && (
              <div className="flex items-center gap-1 bg-white border border-gray-300 rounded-lg p-1 shadow-xs">
                <button
                  type="button"
                  onClick={data.onPrevious}
                  disabled={!data.onPrevious || data.isLoading}
                  className="px-2.5 py-1 text-xs font-bold rounded text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer transition-colors"
                  title="Previous File (Left Arrow ←)"
                >
                  ◀ Prev
                </button>
                <span className="text-xs font-mono font-medium text-gray-500 px-2 border-x border-gray-200 select-none">
                  {data.currentIndex !== undefined ? data.currentIndex + 1 : "?"} / {data.totalCount}
                </span>
                <button
                  type="button"
                  onClick={data.onNext}
                  disabled={!data.onNext || data.isLoading}
                  className="px-2.5 py-1 text-xs font-bold rounded text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer transition-colors"
                  title="Next File (Right Arrow →)"
                >
                  Next ▶
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200 text-lg leading-none cursor-pointer"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal KPI Summary Cards */}
        <div className="px-6 py-3.5 bg-white border-b border-gray-100 flex items-center gap-4 flex-wrap">
          {/* Bigger, High-Prominence Draw Number */}
          <div className="flex items-center gap-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-2 rounded-xl border border-blue-300 shadow-xs">
            <span className="text-blue-800 font-bold text-xs uppercase tracking-wider">Draw No:</span>
            <span className="font-mono font-black text-blue-950 text-2xl tracking-tight leading-none">
              {data.drawNumber}
            </span>
          </div>

          {data.drawDate && (
            <div className="flex items-center gap-2 bg-gray-50 px-3.5 py-2 rounded-xl border border-gray-200 text-xs">
              <span className="text-gray-500 font-medium">Draw Date:</span>
              <span className="font-mono font-bold text-gray-900 text-sm">{data.drawDate}</span>
            </div>
          )}

          {isPurchase ? (
            <>
              <div className="flex items-center gap-2 bg-green-50 px-3.5 py-2 rounded-xl border border-green-200 text-xs">
                <span className="text-green-700 font-medium">Total Purchase:</span>
                <span className="font-mono font-bold text-green-800 text-sm">
                  {data.totalPurchase != null ? data.totalPurchase.toLocaleString() : "-"}
                </span>
              </div>

              <div className="flex items-center gap-2 bg-red-50 px-3.5 py-2 rounded-xl border border-red-200 text-xs">
                <span className="text-red-700 font-medium">Total Return:</span>
                <span className="font-mono font-bold text-red-800 text-sm">
                  {data.totalReturn != null ? `-${data.totalReturn.toLocaleString()}` : "-"}
                </span>
              </div>

              <div className="flex items-center gap-2.5 bg-teal-50 px-4 py-2 rounded-xl border border-teal-300 text-xs shadow-xs">
                <span className="text-teal-800 font-bold text-xs uppercase tracking-wider">Net Quantity:</span>
                <span className="font-mono font-black text-teal-950 text-lg leading-none">
                  {data.netQuantity != null ? data.netQuantity.toLocaleString() : "-"}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2.5 bg-teal-50 px-4 py-2 rounded-xl border border-teal-300 text-xs shadow-xs">
              <span className="text-teal-800 font-bold text-xs uppercase tracking-wider">Total Tickets:</span>
              <span className="font-mono font-black text-teal-950 text-lg leading-none">
                {data.salesRows
                  ? data.salesRows.reduce((sum, r) => sum + r.quantity, 0).toLocaleString()
                  : "-"}
              </span>
            </div>
          )}
        </div>

        {/* Modal Scrollable Table Body */}
        <div className="p-6 flex-1 overflow-auto">
          {data.isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
              <div className="w-8 h-8 border-3 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm font-medium text-gray-700">Loading file content…</p>
              <p className="text-xs text-gray-400 font-mono">{data.title}</p>
            </div>
          ) : isPurchase && data.purchaseRows ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden shadow-xs">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-100 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">#</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Type</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Tx Date</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Starting Barcode</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Ending Barcode</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.purchaseRows.map((row, idx) => (
                    <tr
                      key={idx}
                      className={
                        row.txType === "PURCHASE"
                          ? "bg-green-50/40 hover:bg-green-50/70"
                          : "bg-red-50/40 hover:bg-red-50/70"
                      }
                    >
                      <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-2 font-bold">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] ${
                            row.txType === "PURCHASE"
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {row.txType}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-700">{row.txDate}</td>
                      <td className="px-3 py-2 font-mono font-medium text-teal-900 bg-teal-50/30">
                        {row.startingBarcode}
                      </td>
                      <td className="px-3 py-2 font-mono font-medium text-teal-900 bg-teal-50/30">
                        {row.endingBarcode}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-gray-900">
                        {row.quantity.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : data.salesRows ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden shadow-xs">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-100 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">#</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Draw Number</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Agent Code</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Starting Barcode</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.salesRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-2 font-mono text-gray-700">{row.drawNumber}</td>
                      <td className="px-3 py-2 font-mono font-bold text-teal-700">{row.agentCode}</td>
                      <td className="px-3 py-2 font-mono text-gray-900">{row.startingBarcode}</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-900">
                        {row.quantity.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500 text-xs">
              No row details available for this file.
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-gray-200 bg-gray-50 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              {isPurchase
                ? `${data.purchaseRows?.length || 0} range transactions`
                : `${data.salesRows?.length || 0} allocation rows`}
            </span>
            {data.isLoading && (
              <span className="inline-flex items-center gap-1.5 text-xs text-teal-700 font-medium bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-pulse"></span>
                Loading…
              </span>
            )}
          </div>

          {/* Navigation Controls in Footer */}
          {data.totalCount != null && data.totalCount > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={data.onPrevious}
                disabled={!data.onPrevious || data.isLoading}
                className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-xs cursor-pointer transition-all active:scale-95"
                title="Previous File (Left Arrow ←)"
              >
                <span>←</span>
                <span>Previous</span>
              </button>

              <span className="text-xs font-mono font-bold text-gray-600 bg-gray-200/80 px-2.5 py-1 rounded">
                {data.currentIndex !== undefined ? data.currentIndex + 1 : "?"} of {data.totalCount}
              </span>

              <button
                type="button"
                onClick={data.onNext}
                disabled={!data.onNext || data.isLoading}
                className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-xs cursor-pointer transition-all active:scale-95"
                title="Next File (Right Arrow →)"
              >
                <span>Next</span>
                <span>→</span>
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            {data.onDownload && (
              <button
                type="button"
                onClick={data.onDownload}
                className="px-4 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors"
              >
                Download
              </button>
            )}

            {data.onSaveToFirebase && (
              <button
                type="button"
                onClick={data.onSaveToFirebase}
                className="px-4 py-1.5 rounded bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors"
              >
                {data.isSaved ? "Re-Save" : "Save"}
              </button>
            )}

            {data.onDelete && (
              <button
                type="button"
                onClick={data.onDelete}
                className="px-3.5 py-1.5 rounded border border-red-300 text-red-600 bg-white hover:bg-red-50 text-xs font-semibold shadow-2xs cursor-pointer transition-colors"
              >
                Delete
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-gray-300 bg-white text-gray-700 text-xs font-medium hover:bg-gray-100 cursor-pointer transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

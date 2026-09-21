"use client";

import Link from "next/link";
import { DragEvent, ChangeEvent, useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";

import {
  ALLOWED_RETURN_CODES,
  INVALID_RETURN_FILENAME_ERROR,
  validateReturnFilename,
  generateReturnCleanedXlsx,
} from "../lib/nlbReturnPreprocess";
import type {
  ReturnPreprocessResult,
  ReturnProcessedRow,
  ReturnLotteryCode,
} from "../lib/nlbReturnPreprocess";
import {
  saveNlbReturnFile,
  listNlbReturnFilesByDate,
  deleteNlbReturnUploadedFile,
  getReturnFolderPathFromDb,
  saveReturnFolderPathToDb,
} from "../lib/nlbReturnUploadService";
import type { NlbReturnFileRecord } from "../lib/nlbReturnUploadService";

/* =====================================================
   TYPES
   ===================================================== */

type ReturnFileEntry = {
  id: string;
  file: File;
  code: ReturnLotteryCode | "UNKNOWN";
  status: "waiting" | "processing" | "completed" | "failed";
  result: ReturnPreprocessResult | null;
  errorMessage: string | null;
  isSavedToFirebase?: boolean;
};

type ModalPreviewData = {
  title: string;
  code: string;
  drawNumber: string;
  rowCount: number;
  totalReturnQuantity: number;
  rows: ReturnProcessedRow[];
  folderPath?: string;
  onSaveToLocal?: () => void;
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

type LocalFolderStatus = {
  folder: string;
  fileCount: number;
  files: string[];
  exists?: boolean;
  error?: string | null;
};

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
            description: "Excel Workbook (*.xlsx)",
            accept: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                [".xlsx"],
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
        const fileHandle = await dirHandle.getFileHandle(item.name, {
          create: true,
        });
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
        return {
          success: false,
          savedCount: 0,
          message: "Folder selection cancelled.",
        };
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

export default function NlbReturnsPage() {
  // Return files state
  const [returnFiles, setReturnFiles] = useState<ReturnFileEntry[]>([]);
  const [selectedReturnIds, setSelectedReturnIds] = useState<Set<string>>(
    new Set()
  );
  const [returnValidationErrors, setReturnValidationErrors] = useState<
    string[]
  >([]);
  const [isReturnDragOver, setIsReturnDragOver] = useState(false);
  const [isProcessingReturns, setIsProcessingReturns] = useState(false);

  // Business date
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );

  // Saved Return files in Firebase (nlb-returns)
  const [savedReturnFiles, setSavedReturnFiles] = useState<
    NlbReturnFileRecord[]
  >([]);
  const [selectedSavedReturnIds, setSelectedSavedReturnIds] = useState<
    Set<string>
  >(new Set());
  const [savedReturnLoading, setSavedReturnLoading] = useState(false);
  const [savedReturnError, setSavedReturnError] = useState<string | null>(null);

  // Local target folder status & editing state
  const [localFolderStatus, setLocalFolderStatus] =
    useState<LocalFolderStatus | null>(null);
  const [isCheckingFolder, setIsCheckingFolder] = useState(false);
  const [isEditingFolder, setIsEditingFolder] = useState(false);
  const [folderInput, setFolderInput] = useState("C:\\nlb return");
  const [isSavingFolderPath, setIsSavingFolderPath] = useState(false);

  // Action states
  const [isSavingFirebase, setIsSavingFirebase] = useState(false);
  const [savingFileId, setSavingFileId] = useState<string | null>(null);
  const [savingLocalFileId, setSavingLocalFileId] = useState<string | null>(
    null
  );
  const [isSavingLocalBatch, setIsSavingLocalBatch] = useState(false);
  const [isDownloadingSelected, setIsDownloadingSelected] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "error";
    text: string;
    filePath?: string;
  } | null>(null);

  // Auto-dismiss success notifications after 4.5 seconds
  useEffect(() => {
    if (!feedbackMessage || feedbackMessage.type !== "success") return;
    const timer = setTimeout(() => {
      setFeedbackMessage(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [feedbackMessage]);

  function notifySaveSuccess(
    message: string,
    details?: { filePath?: string; count?: number }
  ) {
    setFeedbackMessage({
      type: "success",
      text: message,
      filePath: details?.filePath,
    });
  }

  // Popup Preview Modal state
  const [previewModal, setPreviewModal] = useState<ModalPreviewData | null>(
    null
  );

  /* ---- Check target return folder & load path from DB ---- */
  const checkLocalFolder = useCallback(async (customPath?: string) => {
    setIsCheckingFolder(true);
    try {
      let targetPath = customPath;
      if (!targetPath) {
        try {
          const dbFolder = await getReturnFolderPathFromDb();
          if (dbFolder) {
            targetPath = dbFolder;
          }
        } catch {
          // non-fatal
        }
      }

      const activePath = targetPath || "C:\\nlb return";
      setFolderInput(activePath);

      const res = await fetch(
        `/api/nlb-return-save-local?folder=${encodeURIComponent(activePath)}`
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setLocalFolderStatus({
          folder: data.folder || activePath,
          fileCount: data.fileCount || 0,
          files: data.files || [],
          exists: true,
          error: null,
        });
      } else {
        setLocalFolderStatus({
          folder: data.folder || activePath,
          fileCount: 0,
          files: [],
          exists: false,
          error: data.error || "File not found: Target folder does not exist on path",
        });
      }
    } catch {
      setLocalFolderStatus({
        folder: "C:\\nlb return",
        fileCount: 0,
        files: [],
        exists: false,
        error: "File not found: Target folder does not exist on path",
      });
    } finally {
      setIsCheckingFolder(false);
    }
  }, []);

  useEffect(() => {
    checkLocalFolder();
  }, [checkLocalFolder]);

  /* ---- Save modified folder path to DB & validate ---- */
  async function handleSaveFolderPath() {
    const trimmed = folderInput.trim();
    if (!trimmed) return;
    setIsSavingFolderPath(true);
    try {
      // 1. Save to DB first
      await saveReturnFolderPathToDb(trimmed);

      // 2. Validate existence with API
      const res = await fetch(
        `/api/nlb-return-save-local?folder=${encodeURIComponent(trimmed)}`
      );
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        setLocalFolderStatus({
          folder: data.folder || trimmed,
          fileCount: data.fileCount || 0,
          files: data.files || [],
          exists: true,
          error: null,
        });
        notifySaveSuccess(`✓ Save location updated & saved to DB: ${trimmed}`);
      } else {
        setLocalFolderStatus({
          folder: trimmed,
          fileCount: 0,
          files: [],
          exists: false,
          error: data.error || "File not found: Target folder does not exist on path",
        });
        setFeedbackMessage({
          type: "error",
          text: data.error || `File not found: Folder does not exist on path "${trimmed}". Saved to DB.`,
        });
      }
      setIsEditingFolder(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving folder path.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setIsSavingFolderPath(false);
    }
  }

  /* ---- Load saved files for selectedDate ---- */
  const loadSavedReturns = useCallback(async (dateStr: string) => {
    setSavedReturnLoading(true);
    setSavedReturnError(null);
    try {
      const records = await listNlbReturnFilesByDate(dateStr);
      setSavedReturnFiles(records);
    } catch (err: any) {
      console.error("Failed to load saved return files:", err);
      setSavedReturnError("Failed to fetch saved return files from cloud.");
    } finally {
      setSavedReturnLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSavedReturns(selectedDate);
  }, [selectedDate, loadSavedReturns]);

  function getCleanFileName(entry: ReturnFileEntry): string {
    return `${entry.code}_RETURN.xlsx`;
  }

  function getEntryBlob(entry: ReturnFileEntry): Blob | null {
    if (!entry.result || entry.result.rows.length === 0) return null;
    return generateReturnCleanedXlsx(entry.result.rows);
  }

  function updateReturnEntry(
    id: string,
    updates: Partial<ReturnFileEntry>
  ) {
    setReturnFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  }

  /* ---- Add Return Files with Validation & Duplicate Prevention ---- */
  const addReturnFiles = useCallback(
    (files: File[]) => {
      const newEntries: ReturnFileEntry[] = [];
      const errors: string[] = [];

      for (const file of files) {
        const val = validateReturnFilename(file.name);
        if (!val.valid || !val.code) {
          errors.push(
            val.error || `Invalid return filename: "${file.name}"`
          );
          continue;
        }

        const code = val.code as ReturnLotteryCode;

        // Duplicate prevention within queue and batch
        const alreadyInQueue = returnFiles.some(
          (f) => f.code.toUpperCase() === code.toUpperCase()
        );
        const alreadyInBatch = newEntries.some(
          (f) => f.code.toUpperCase() === code.toUpperCase()
        );

        if (alreadyInQueue || alreadyInBatch) {
          errors.push(
            `Duplicate ignored: "${file.name}" for lottery code "${code}" is already in the queue.`
          );
          continue;
        }

        newEntries.push({
          id: `${code}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          file,
          code,
          status: "waiting",
          result: null,
          errorMessage: null,
        });
      }

      setReturnValidationErrors(errors);

      if (newEntries.length > 0) {
        setReturnFiles((prev) => [...prev, ...newEntries]);
      }
    },
    [returnFiles]
  );

  /* ---- Process Single Return File ---- */
  async function processReturnEntry(
    entry: ReturnFileEntry
  ): Promise<ReturnPreprocessResult | null> {
    updateReturnEntry(entry.id, { status: "processing", errorMessage: null });

    try {
      const formData = new FormData();
      formData.append("file", entry.file);

      const res = await fetch("/api/nlb-return-preprocess", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg =
          errData.error || `Server error (${res.status}): ${res.statusText}`;
        updateReturnEntry(entry.id, { status: "failed", errorMessage: msg });
        return null;
      }

      const data: ReturnPreprocessResult = await res.json();

      if (data.status === "failed") {
        const msg =
          data.errors && data.errors.length > 0
            ? data.errors.join("; ")
            : "Return report processing failed.";
        updateReturnEntry(entry.id, {
          status: "failed",
          result: data,
          errorMessage: msg,
        });
        return null;
      }

      updateReturnEntry(entry.id, {
        status: "completed",
        result: data,
        errorMessage: null,
      });
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error.";
      updateReturnEntry(entry.id, { status: "failed", errorMessage: msg });
      return null;
    }
  }

  /* ---- Process All Return Files in Batch ---- */
  async function processAllReturns() {
    setIsProcessingReturns(true);
    for (const entry of returnFiles) {
      if (entry.status === "waiting") {
        await processReturnEntry(entry);
      }
    }
    setIsProcessingReturns(false);
  }

  /* ---- Save directly to local return folder ---- */
  async function saveBlobToLocalReturnFolder(
    blob: Blob,
    filename: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const folderParam = localFolderStatus?.folder
        ? `&folder=${encodeURIComponent(localFolderStatus.folder)}`
        : "";
      const res = await fetch(
        `/api/nlb-return-save-local?filename=${encodeURIComponent(filename)}${folderParam}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          body: blob,
        }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        return {
          success: true,
          message: data.message || `Saved to ${data.folder || "C:\\nlb return"}\\${filename}`,
        };
      }
      return { success: false, message: data.error || "Local save failed" };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || "Failed to reach save-local endpoint",
      };
    }
  }

  /* ---- Direct Local Save Action (Single) ---- */
  async function handleSaveSingleToLocal(entry: ReturnFileEntry) {
    const blob = getEntryBlob(entry);
    if (!blob) return;
    const fileName = getCleanFileName(entry);
    setSavingLocalFileId(entry.id);

    try {
      const res = await saveBlobToLocalReturnFolder(blob, fileName);
      if (res.success) {
        notifySaveSuccess(
          `✓ File saved successfully to ${localFolderStatus?.folder || "C:\\nlb return"}\\${fileName}`,
          { filePath: `${localFolderStatus?.folder || "C:\\nlb return"}\\${fileName}` }
        );
        await checkLocalFolder();
      } else {
        setFeedbackMessage({
          type: "error",
          text: `Failed to save locally: ${res.message}`,
        });
      }
    } finally {
      setSavingLocalFileId(null);
    }
  }

  /* ---- Direct Local Save Action (Batch) ---- */
  async function handleSaveBatchToLocal(entries: ReturnFileEntry[]) {
    if (entries.length === 0) return;
    setIsSavingLocalBatch(true);
    let savedCount = 0;
    let lastError: string | null = null;

    try {
      for (const entry of entries) {
        const blob = getEntryBlob(entry);
        if (blob) {
          const fileName = getCleanFileName(entry);
          const res = await saveBlobToLocalReturnFolder(blob, fileName);
          if (res.success) {
            savedCount++;
          } else {
            lastError = res.message;
          }
        }
      }
      if (savedCount > 0) {
        notifySaveSuccess(
          `✓ Successfully saved ${savedCount} file(s) to ${localFolderStatus?.folder || "C:\\nlb return"}!`,
          { filePath: `${localFolderStatus?.folder || "C:\\nlb return"}\\`, count: savedCount }
        );
      } else if (lastError) {
        setFeedbackMessage({
          type: "error",
          text: `Failed to save locally: ${lastError}`,
        });
      }
      await checkLocalFolder();
    } finally {
      setIsSavingLocalBatch(false);
    }
  }

  /* ---- Download Handlers ---- */
  async function handleDownloadSingle(entry: ReturnFileEntry) {
    const blob = getEntryBlob(entry);
    if (!blob) return;
    const fileName = getCleanFileName(entry);

    // Save directly to C:\nlb return
    const saveRes = await saveBlobToLocalReturnFolder(blob, fileName);
    if (saveRes.success) {
      notifySaveSuccess(
        `✓ File saved successfully to C:\\nlb return\\${fileName}`,
        { filePath: `C:\\nlb return\\${fileName}` }
      );
      await checkLocalFolder();
      return;
    }

    // Fallback to browser picker
    await triggerDownload(blob, fileName);
  }

  async function handleDownloadBatch(entries: ReturnFileEntry[]) {
    setIsDownloadingSelected(true);
    try {
      // First attempt direct disk save to C:\nlb return
      let savedCount = 0;
      for (const entry of entries) {
        const blob = getEntryBlob(entry);
        if (blob) {
          const fileName = getCleanFileName(entry);
          const res = await saveBlobToLocalReturnFolder(blob, fileName);
          if (res.success) savedCount++;
        }
      }

      if (savedCount > 0) {
        notifySaveSuccess(
          `✓ Successfully saved ${savedCount} return file(s) to C:\\nlb return!`,
          { filePath: `C:\\nlb return\\`, count: savedCount }
        );
        await checkLocalFolder();
        return;
      }

      // Fallback
      const items: { name: string; blob: Blob }[] = [];
      for (const entry of entries) {
        const blob = getEntryBlob(entry);
        if (blob) {
          items.push({ name: getCleanFileName(entry), blob });
        }
      }
      const res = await saveFilesToDirectory(items);
      if (res.message) {
        setFeedbackMessage({
          type: res.success ? "success" : "error",
          text: res.message,
        });
      }
    } finally {
      setIsDownloadingSelected(false);
    }
  }

  /* ---- Saved Firebase Actions ---- */
  async function handleDownloadSingleSaved(rec: NlbReturnFileRecord) {
    try {
      const blob = await fetchFileBlobFromUrl(rec.downloadUrl);
      const res = await saveBlobToLocalReturnFolder(blob, rec.fileName);
      if (res.success) {
        notifySaveSuccess(
          `✓ File saved successfully to C:\\nlb return\\${rec.fileName}`,
          { filePath: `C:\\nlb return\\${rec.fileName}` }
        );
        await checkLocalFolder();
        return;
      }
      await triggerDownload(blob, rec.fileName);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Could not download file.";
      setFeedbackMessage({ type: "error", text: msg });
    }
  }

  async function handleDownloadSelectedSavedReturns() {
    setIsDownloadingSelected(true);
    try {
      const recordsToDownload = savedReturnFiles.filter((f) =>
        selectedSavedReturnIds.has(f.id)
      );

      let savedCount = 0;
      for (const rec of recordsToDownload) {
        try {
          const blob = await fetchFileBlobFromUrl(rec.downloadUrl);
          const res = await saveBlobToLocalReturnFolder(blob, rec.fileName);
          if (res.success) savedCount++;
        } catch {
          // ignore
        }
      }

      if (savedCount > 0) {
        notifySaveSuccess(
          `✓ Successfully saved ${savedCount} file(s) to C:\\nlb return!`,
          { filePath: `C:\\nlb return\\`, count: savedCount }
        );
        await checkLocalFolder();
        return;
      }

      const items: { name: string; blob: Blob }[] = [];
      for (const rec of recordsToDownload) {
        try {
          const blob = await fetchFileBlobFromUrl(rec.downloadUrl);
          items.push({ name: rec.fileName, blob });
        } catch {
          // ignore
        }
      }
      const res = await saveFilesToDirectory(items);
      if (res.message) {
        setFeedbackMessage({
          type: res.success ? "success" : "error",
          text: res.message,
        });
      }
    } finally {
      setIsDownloadingSelected(false);
    }
  }

  /* ---- Firebase Save Handlers ---- */
  async function handleSaveSingleToFirebase(entry: ReturnFileEntry) {
    const blob = getEntryBlob(entry);
    if (!blob || !entry.result) return;
    setSavingFileId(entry.id);
    try {
      const fileName = getCleanFileName(entry);
      const targetFolder = localFolderStatus?.folder || "C:\\nlb return";
      await saveNlbReturnFile(
        blob,
        fileName,
        entry.code,
        entry.result.drawNumber || "",
        entry.result.rowCount,
        entry.result.totalReturnQuantity,
        selectedDate,
        targetFolder
      );
      updateReturnEntry(entry.id, { isSavedToFirebase: true });
      notifySaveSuccess(
        `✓ Saved ${fileName} to Cloud for date ${selectedDate}!`,
        { filePath: `Cloud Storage: ${selectedDate}/${fileName} (Target: ${targetFolder})` }
      );
      await loadSavedReturns(selectedDate);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error saving to Firebase.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setSavingFileId(null);
    }
  }

  async function handleSaveBatchToFirebase(entries: ReturnFileEntry[]) {
    setIsSavingFirebase(true);
    const targetFolder = localFolderStatus?.folder || "C:\\nlb return";
    try {
      let saved = 0;
      for (const entry of entries) {
        const blob = getEntryBlob(entry);
        if (!blob || !entry.result) continue;
        const fileName = getCleanFileName(entry);
        await saveNlbReturnFile(
          blob,
          fileName,
          entry.code,
          entry.result.drawNumber || "",
          entry.result.rowCount,
          entry.result.totalReturnQuantity,
          selectedDate,
          targetFolder
        );
        updateReturnEntry(entry.id, { isSavedToFirebase: true });
        saved++;
      }
      notifySaveSuccess(
        `✓ Saved ${saved} return file(s) to Cloud for date ${selectedDate}!`,
        { filePath: `Cloud Storage: ${selectedDate}/` }
      );
      await loadSavedReturns(selectedDate);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error saving to Firebase.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setIsSavingFirebase(false);
    }
  }

  /* ---- Delete Saved Records ---- */
  async function handleDeleteSaved(rec: NlbReturnFileRecord) {
    if (!confirm(`Delete saved file ${rec.fileName}?`)) return;
    setDeletingRecordId(rec.id);
    try {
      await deleteNlbReturnUploadedFile(rec);
      setSavedReturnFiles((prev) => prev.filter((f) => f.id !== rec.id));
      setSelectedSavedReturnIds((prev) => {
        const next = new Set(prev);
        next.delete(rec.id);
        return next;
      });
      setFeedbackMessage({
        type: "success",
        text: `Deleted ${rec.fileName}.`,
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error deleting file.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setDeletingRecordId(null);
    }
  }

  async function handleDeleteSelectedSavedReturns() {
    if (
      !confirm(
        `Delete ${selectedSavedReturnIds.size} selected return file(s)?`
      )
    )
      return;
    try {
      const targets = savedReturnFiles.filter((f) =>
        selectedSavedReturnIds.has(f.id)
      );
      for (const rec of targets) {
        await deleteNlbReturnUploadedFile(rec);
      }
      setSavedReturnFiles((prev) =>
        prev.filter((f) => !selectedSavedReturnIds.has(f.id))
      );
      setSelectedSavedReturnIds(new Set());
      setFeedbackMessage({
        type: "success",
        text: `Deleted ${targets.length} file(s).`,
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error deleting files.";
      setFeedbackMessage({ type: "error", text: msg });
    }
  }

  /* ---- Open Popup View Modal ---- */
  function handleOpenPopupView(
    entry: ReturnFileEntry,
    index?: number,
    list?: ReturnFileEntry[]
  ) {
    if (!entry.result) return;
    const r = entry.result;
    const cleanName = getCleanFileName(entry);
    const currentIndex =
      index ?? (list ? list.findIndex((f) => f.id === entry.id) : undefined);
    const totalCount = list?.length;

    const navProps = {
      currentIndex,
      totalCount,
      onPrevious:
        list && currentIndex != null && currentIndex > 0
          ? () =>
              handleOpenPopupView(list[currentIndex - 1], currentIndex - 1, list)
          : undefined,
      onNext:
        list && currentIndex != null && currentIndex < list.length - 1
          ? () =>
              handleOpenPopupView(list[currentIndex + 1], currentIndex + 1, list)
          : undefined,
    };

    const onDelete = () => {
      setReturnFiles((prev) => prev.filter((f) => f.id !== entry.id));
      setSelectedReturnIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
      setPreviewModal(null);
    };

    setPreviewModal({
      title: cleanName,
      code: entry.code,
      drawNumber: r.drawNumber || "-",
      rowCount: r.rowCount,
      totalReturnQuantity: r.totalReturnQuantity,
      rows: r.rows,
      folderPath: localFolderStatus?.folder || "C:\\nlb return",
      onSaveToLocal: () => handleSaveSingleToLocal(entry),
      onDownload: () => handleDownloadSingle(entry),
      onSaveToFirebase: () => handleSaveSingleToFirebase(entry),
      onDelete,
      isSaved: entry.isSavedToFirebase,
      ...navProps,
    });
  }

  async function handleOpenSavedPopupView(
    rec: NlbReturnFileRecord,
    index?: number,
    list?: NlbReturnFileRecord[]
  ) {
    const currentIndex =
      index ?? (list ? list.findIndex((f) => f.id === rec.id) : undefined);
    const totalCount = list?.length;

    const navProps = {
      currentIndex,
      totalCount,
      onPrevious:
        list && currentIndex != null && currentIndex > 0
          ? () =>
              handleOpenSavedPopupView(
                list[currentIndex - 1],
                currentIndex - 1,
                list
              )
          : undefined,
      onNext:
        list && currentIndex != null && currentIndex < list.length - 1
          ? () =>
              handleOpenSavedPopupView(
                list[currentIndex + 1],
                currentIndex + 1,
                list
              )
          : undefined,
    };

    const onDelete = async () => {
      await handleDeleteSaved(rec);
      setPreviewModal(null);
    };

    setPreviewModal({
      title: rec.fileName,
      code: rec.code,
      drawNumber: rec.drawNumber || "-",
      rowCount: rec.rowCount,
      totalReturnQuantity: rec.totalReturnQuantity,
      rows: [],
      folderPath: rec.folderPath || rec.localFolderPath || localFolderStatus?.folder || "C:\\nlb return",
      onSaveToLocal: () => handleDownloadSingleSaved(rec),
      onDownload: () => handleDownloadSingleSaved(rec),
      onDelete,
      isSaved: true,
      isLoading: true,
      ...navProps,
    });

    try {
      const blob = await fetchFileBlobFromUrl(rec.downloadUrl);
      const ab = await blob.arrayBuffer();
      const wb = XLSX.read(ab, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: false,
      }) as (string | number)[][];

      const parsedRows: ReturnProcessedRow[] = [];
      for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;
        parsedRows.push({
          drawNumber: String(row[0] || rec.drawNumber || ""),
          agentCode: String(row[1] || ""),
          startingBarcode: String(row[2] || ""),
          quantity: Number(row[3]) || 0,
        });
      }

      setPreviewModal((prev) =>
        prev
          ? {
              ...prev,
              rows: parsedRows,
              isLoading: false,
            }
          : null
      );
    } catch (err: any) {
      console.error("Failed to parse saved return file:", err);
      setPreviewModal((prev) => (prev ? { ...prev, isLoading: false } : null));
      setFeedbackMessage({
        type: "error",
        text: `Failed to load details for ${rec.fileName}`,
      });
    }
  }

  const completedReturns = returnFiles.filter((f) => f.status === "completed");

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100/80 text-slate-900 py-8 px-4 font-sans">
      <div className="w-full max-w-6xl p-6 md:p-8 rounded-2xl bg-white shadow-sm border border-slate-200 space-y-6">
        {/* =====================================================
            TOP NAVIGATION & HEADER
            ===================================================== */}
        <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-900 text-white text-xs font-black">
                NLB
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Agent Returns
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Process and export daily lottery return allocations
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/nlb"
              className="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors flex items-center gap-1.5"
            >
              ← NLB Sales
            </Link>
          </div>
        </div>

        {/* =====================================================
            TOOLBAR: DATE PICKER & DESTINATION STATUS
            ===================================================== */}
        <div className="flex items-center justify-between gap-4 flex-wrap bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2">
            <label
              htmlFor="nlb-return-date-input"
              className="text-xs font-semibold text-slate-700"
            >
              Date:
            </label>
            <input
              id="nlb-return-date-input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs bg-white text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-400 shadow-2xs font-medium cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
            {isEditingFolder ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveFolderPath();
                }}
                className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-slate-300 shadow-2xs"
              >
                <span className="text-slate-400">Target:</span>
                <input
                  type="text"
                  value={folderInput}
                  onChange={(e) => setFolderInput(e.target.value)}
                  placeholder="e.g. C:\nlb return"
                  className="border border-slate-300 rounded px-2 py-0.5 text-xs font-mono font-medium text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-500 w-56"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isSavingFolderPath}
                  className="px-2 py-0.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  title="Save location path to DB"
                >
                  {isSavingFolderPath ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFolderInput(localFolderStatus?.folder || "C:\\nlb return");
                    setIsEditingFolder(false);
                  }}
                  className="px-1.5 py-0.5 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded text-[11px] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 shadow-2xs">
                <span className="text-slate-400">Target:</span>
                <span className="font-mono font-bold text-slate-800">
                  {localFolderStatus?.folder || "C:\\nlb return"}
                </span>

                {localFolderStatus?.exists === false ? (
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 cursor-help"
                    title={localFolderStatus.error || "File not found: Target folder does not exist on path"}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                    File not found
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    {localFolderStatus
                      ? `${localFolderStatus.fileCount} file${localFolderStatus.fileCount === 1 ? "" : "s"}`
                      : "Ready"}
                  </span>
                )}

                {/* Modify Folder Button */}
                <button
                  type="button"
                  onClick={() => {
                    setFolderInput(localFolderStatus?.folder || "C:\\nlb return");
                    setIsEditingFolder(true);
                  }}
                  className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition-colors cursor-pointer ml-1"
                  title="Modify save location path"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                </button>

                {/* Refresh Status Button */}
                <button
                  type="button"
                  onClick={() => checkLocalFolder(localFolderStatus?.folder)}
                  disabled={isCheckingFolder}
                  className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition-colors cursor-pointer"
                  title="Refresh local folder count"
                >
                  <svg
                    className={`w-3.5 h-3.5 ${isCheckingFolder ? "animate-spin text-slate-600" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* =====================================================
            FEEDBACK ALERT BANNER
            ===================================================== */}
        {feedbackMessage && (
          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs font-medium transition-all ${
              feedbackMessage.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-rose-50 border-rose-200 text-rose-900"
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm">
                {feedbackMessage.type === "success" ? "✓" : "✕"}
              </span>
              <span>{feedbackMessage.text}</span>
              {feedbackMessage.filePath && (
                <span className="font-mono text-[11px] bg-white/80 px-2 py-0.5 rounded border border-emerald-200 text-emerald-800">
                  {feedbackMessage.filePath}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="ml-3 text-slate-400 hover:text-slate-700 font-bold px-1.5 py-0.5 rounded cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* =====================================================
            SECTION 1: RETURN ALLOCATION FILES
            ===================================================== */}
        <section className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-800"></span>
              <h2 className="text-sm font-bold text-slate-900">
                Return Reports
              </h2>
            </div>
          </div>

          {/* Return Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsReturnDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsReturnDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsReturnDragOver(false);
              if (e.dataTransfer.files)
                addReturnFiles(Array.from(e.dataTransfer.files));
            }}
            className={`flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed transition-all ${
              isReturnDragOver
                ? "border-slate-800 bg-slate-100"
                : "border-slate-300 hover:border-slate-400 bg-white"
            }`}
          >
            <label
              htmlFor="nlb-return-input"
              className="cursor-pointer bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2 px-5 rounded-lg shadow-xs text-xs transition-all flex items-center gap-2"
            >
              <span>Upload Return Reports</span>
            </label>
            <p className="text-slate-500 text-xs mt-2">
              Drop Excel files here (.xlsx, .xls) or click to browse
            </p>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Supported: {ALLOWED_RETURN_CODES.join(", ")}
            </p>
            <input
              id="nlb-return-input"
              type="file"
              accept=".xls,.xlsx"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files)
                  addReturnFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
          </div>

          {returnValidationErrors.length > 0 && (
            <div className="border border-rose-200 bg-rose-50 rounded-xl p-3 space-y-1">
              {returnValidationErrors.map((msg, i) => (
                <p key={i} className="text-xs text-rose-800 font-medium">
                  ✕ {msg}
                </p>
              ))}
            </div>
          )}

          {/* Return Batch Cards */}
          {returnFiles.length > 0 && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-slate-800">
                  Current Queue ({returnFiles.length})
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  {returnFiles.filter((f) => f.status === "waiting").length >
                    0 && (
                    <button
                      type="button"
                      onClick={processAllReturns}
                      disabled={isProcessingReturns}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer transition-colors"
                    >
                      {isProcessingReturns ? "Processing…" : "Process All"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setReturnFiles([]);
                      setSelectedReturnIds(new Set());
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              {/* Ticking Toolbar for Returns */}
              {completedReturns.length > 0 && (
                <div className="flex items-center justify-between bg-slate-100 border border-slate-200 rounded-xl p-2.5 flex-wrap gap-2">
                  <label className="flex items-center gap-2 text-xs text-slate-800 font-medium cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={
                        selectedReturnIds.size === completedReturns.length &&
                        completedReturns.length > 0
                      }
                      onChange={() => {
                        if (
                          selectedReturnIds.size === completedReturns.length
                        ) {
                          setSelectedReturnIds(new Set());
                        } else {
                          setSelectedReturnIds(
                            new Set(completedReturns.map((e) => e.id))
                          );
                        }
                      }}
                      className="rounded text-slate-900 focus:ring-slate-500 cursor-pointer"
                    />
                    <span>
                      Select All ({selectedReturnIds.size}/
                      {completedReturns.length})
                    </span>
                  </label>

                  {selectedReturnIds.size > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() =>
                          handleSaveBatchToLocal(
                            returnFiles.filter((f) =>
                              selectedReturnIds.has(f.id)
                            )
                          )
                        }
                        disabled={isSavingLocalBatch}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer flex items-center gap-1.5"
                        title="Save files directly into C:\nlb return"
                      >
                        <span>💾</span>
                        <span>
                          {isSavingLocalBatch
                            ? "Saving…"
                            : `Save Local (${selectedReturnIds.size})`}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleDownloadBatch(
                            returnFiles.filter((f) =>
                              selectedReturnIds.has(f.id)
                            )
                          )
                        }
                        disabled={isDownloadingSelected}
                        className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer"
                      >
                        Download ({selectedReturnIds.size})
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleSaveBatchToFirebase(
                            returnFiles.filter((f) =>
                              selectedReturnIds.has(f.id)
                            )
                          )
                        }
                        disabled={isSavingFirebase}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer"
                      >
                        {isSavingFirebase
                          ? "Saving…"
                          : `Save to Cloud (${selectedReturnIds.size})`}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setReturnFiles((prev) =>
                            prev.filter((f) => !selectedReturnIds.has(f.id))
                          );
                          setSelectedReturnIds(new Set());
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 text-xs bg-white hover:bg-rose-50 font-medium cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Cards List */}
              <div className="space-y-2.5">
                {returnFiles.map((entry, idx) => (
                  <FileCard
                    key={entry.id}
                    entry={entry}
                    cleanFileName={getCleanFileName(entry)}
                    isSelected={selectedReturnIds.has(entry.id)}
                    onToggleSelect={() => {
                      setSelectedReturnIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(entry.id)) next.delete(entry.id);
                        else next.add(entry.id);
                        return next;
                      });
                    }}
                    onRemove={() => {
                      setReturnFiles((prev) =>
                        prev.filter((f) => f.id !== entry.id)
                      );
                      setSelectedReturnIds((prev) => {
                        const next = new Set(prev);
                        next.delete(entry.id);
                        return next;
                      });
                    }}
                    onSaveToLocal={() => handleSaveSingleToLocal(entry)}
                    onDownload={() => handleDownloadSingle(entry)}
                    onSaveToFirebase={() => handleSaveSingleToFirebase(entry)}
                    onOpenPopupView={() =>
                      handleOpenPopupView(entry, idx, returnFiles)
                    }
                    isSavingLocal={savingLocalFileId === entry.id}
                    isSavingFirebase={savingFileId === entry.id}
                    isProcessingAll={isProcessingReturns}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ---------------- Saved Return Files Table ---------------- */}
          <div className="mt-6 pt-6 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-700"></span>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Cloud Returns ({savedReturnFiles.length})
                </h3>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {selectedSavedReturnIds.size > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handleDownloadSelectedSavedReturns}
                      disabled={isDownloadingSelected}
                      className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60 cursor-pointer flex items-center gap-1.5"
                    >
                      <span>💾 Save Local ({selectedSavedReturnIds.size})</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSelectedSavedReturns}
                      className="px-2.5 py-1 rounded-lg border border-rose-200 text-rose-600 text-xs bg-white hover:bg-rose-50 font-medium cursor-pointer"
                    >
                      Delete ({selectedSavedReturnIds.size})
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => loadSavedReturns(selectedDate)}
                  disabled={savedReturnLoading}
                  className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
                >
                  {savedReturnLoading ? "Loading…" : "Refresh"}
                </button>
              </div>
            </div>

            {savedReturnLoading && (
              <p className="text-xs text-slate-500 py-3 text-center">
                Loading saved files…
              </p>
            )}

            {savedReturnError && (
              <p className="text-xs text-rose-700 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                ✕ {savedReturnError}
              </p>
            )}

            {savedReturnFiles.length === 0 &&
              !savedReturnLoading &&
              !savedReturnError && (
                <div className="bg-white p-4 rounded-xl border border-dashed border-slate-300 text-center text-xs text-slate-500">
                  No saved return files found in cloud for {selectedDate}.
                </div>
              )}

            {savedReturnFiles.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                    <tr>
                      <th className="w-10 px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={
                            selectedSavedReturnIds.size ===
                              savedReturnFiles.length &&
                            savedReturnFiles.length > 0
                          }
                          onChange={() => {
                            if (
                              selectedSavedReturnIds.size ===
                              savedReturnFiles.length
                            ) {
                              setSelectedSavedReturnIds(new Set());
                            } else {
                              setSelectedSavedReturnIds(
                                new Set(savedReturnFiles.map((f) => f.id))
                              );
                            }
                          }}
                          className="rounded text-slate-900 focus:ring-slate-500 cursor-pointer"
                        />
                      </th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-800">
                        File
                      </th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-800">
                        Draw
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-800">
                        Return Rows
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-800">
                        Total Return Qty
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-800">
                        Size
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold text-slate-800">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {savedReturnFiles.map((rec, idx) => (
                      <tr
                        key={rec.id}
                        className={`hover:bg-slate-50/70 transition-colors ${
                          selectedSavedReturnIds.has(rec.id)
                            ? "bg-slate-50"
                            : ""
                        }`}
                      >
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={selectedSavedReturnIds.has(rec.id)}
                            onChange={() => {
                              setSelectedSavedReturnIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(rec.id)) next.delete(rec.id);
                                else next.add(rec.id);
                                return next;
                              });
                            }}
                            className="rounded text-slate-900 focus:ring-slate-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono font-bold text-slate-900">
                            {rec.fileName}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono">
                          <span className="font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            #{rec.drawNumber || "-"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-slate-800 font-mono">
                          {rec.rowCount}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-emerald-700 font-mono">
                          {rec.totalReturnQuantity.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-500 font-mono text-[11px]">
                          {(rec.size / 1024).toFixed(1)} KB
                        </td>
                        <td className="px-3 py-2.5 text-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleOpenSavedPopupView(
                                rec,
                                idx,
                                savedReturnFiles
                              )
                            }
                            className="px-2.5 py-1 rounded-md bg-white text-slate-700 hover:bg-slate-100 border border-slate-300 text-[11px] font-semibold cursor-pointer"
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadSingleSaved(rec)}
                            className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium shadow-2xs cursor-pointer"
                            title="Save directly into C:\nlb return"
                          >
                            Save Local
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSaved(rec)}
                            disabled={deletingRecordId === rec.id}
                            className="px-2 py-1 rounded-md border border-rose-200 text-rose-600 text-[11px] hover:bg-rose-50 disabled:opacity-50 cursor-pointer"
                          >
                            {deletingRecordId === rec.id
                              ? "Deleting…"
                              : "Delete"}
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
  onSaveToLocal,
  onDownload,
  onSaveToFirebase,
  onOpenPopupView,
  isSavingLocal,
  isSavingFirebase,
  isProcessingAll,
}: {
  entry: ReturnFileEntry;
  cleanFileName: string;
  isSelected: boolean;
  onToggleSelect: () => void;
  onRemove: () => void;
  onSaveToLocal: () => void;
  onDownload: () => void;
  onSaveToFirebase: () => void;
  onOpenPopupView: () => void;
  isSavingLocal: boolean;
  isSavingFirebase: boolean;
  isProcessingAll: boolean;
}) {
  const r = entry.result;

  const statusColors: Record<ReturnFileEntry["status"], string> = {
    waiting: "bg-slate-100 text-slate-700 border-slate-300",
    processing: "bg-blue-50 text-blue-800 border-blue-200",
    completed: "bg-emerald-50 text-emerald-800 border-emerald-200",
    failed: "bg-rose-50 text-rose-800 border-rose-200",
  };

  const statusLabels: Record<ReturnFileEntry["status"], string> = {
    waiting: "Ready",
    processing: "Processing…",
    completed: "Processed",
    failed: "Failed",
  };

  return (
    <div
      className={`border rounded-xl bg-white p-4 space-y-2.5 transition-all shadow-2xs ${
        isSelected
          ? "border-slate-800 ring-1 ring-slate-800/10 bg-slate-50/40"
          : "border-slate-200 hover:border-slate-300"
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
              className="rounded text-slate-900 focus:ring-slate-500 cursor-pointer"
            />
          )}

          <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md shrink-0">
            {entry.code}
          </span>

          <span className="text-xs text-slate-600 truncate font-mono">
            {entry.file.name}
          </span>

          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${
              statusColors[entry.status]
            }`}
          >
            {statusLabels[entry.status]}
          </span>

          {entry.isSavedToFirebase && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200 shrink-0">
              Cloud Saved
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {entry.status === "completed" && r && r.rows.length > 0 && (
            <>
              <button
                type="button"
                onClick={onOpenPopupView}
                className="px-2.5 py-1 rounded-lg bg-white text-slate-700 hover:bg-slate-100 border border-slate-300 text-xs font-semibold shadow-2xs cursor-pointer"
              >
                Preview
              </button>

              <button
                type="button"
                onClick={onSaveToLocal}
                disabled={isSavingLocal}
                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-2xs cursor-pointer flex items-center gap-1"
                title="Save directly into C:\nlb return"
              >
                <span>💾</span>
                <span>{isSavingLocal ? "Saving…" : "Save Local"}</span>
              </button>

              <button
                type="button"
                onClick={onDownload}
                className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-2xs cursor-pointer"
              >
                Download
              </button>

              <button
                type="button"
                onClick={onSaveToFirebase}
                disabled={isSavingFirebase}
                className="px-2.5 py-1 rounded-lg text-white text-xs font-medium shadow-2xs disabled:opacity-60 cursor-pointer bg-indigo-600 hover:bg-indigo-700"
              >
                {isSavingFirebase ? "Saving…" : "Cloud"}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onRemove}
            disabled={isProcessingAll && entry.status === "processing"}
            className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 text-xs bg-white hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 disabled:opacity-40 cursor-pointer transition-colors"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Metadata row */}
      {entry.status === "completed" && r && (
        <div className="text-xs text-slate-600 pt-1 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap text-[11px]">
            <span className="flex items-center gap-1">
              <span className="text-slate-400">Draw:</span>
              <strong className="font-mono text-slate-900 bg-slate-100 px-1.5 py-0.2 rounded">
                #{r.drawNumber}
              </strong>
            </span>
            <span className="text-slate-300">•</span>
            <span>
              <span className="text-slate-400">Return Rows:</span>{" "}
              <strong className="text-slate-900 font-mono">
                {r.rowCount}
              </strong>
            </span>
            <span className="text-slate-300">•</span>
            <span>
              <span className="text-slate-400">Total Return Qty:</span>{" "}
              <strong className="text-emerald-700 font-mono font-bold">
                {r.totalReturnQuantity.toLocaleString()}
              </strong>
            </span>
          </div>

          {r.warnings.length > 0 && (
            <p className="text-[11px] text-amber-700 font-medium">
              ⚠ {r.warnings.join(" | ")}
            </p>
          )}
        </div>
      )}

      {entry.status === "failed" && entry.errorMessage && (
        <p className="text-xs text-rose-600 font-medium pt-1">
          ✕ {entry.errorMessage}
        </p>
      )}
    </div>
  );
}

/* =====================================================
   FILE PREVIEW MODAL SUB-COMPONENT
   ===================================================== */

function FilePreviewModal({
  data,
  onClose,
}: {
  data: ModalPreviewData;
  onClose: () => void;
}) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold font-mono px-2.5 py-1 rounded-lg border text-slate-900 bg-white border-slate-200">
              {data.code}
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2.5 flex-wrap">
                <span>{data.title}</span>
                <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-slate-200 text-slate-800">
                  Draw #{data.drawNumber}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Cleaned Return
                </span>
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Header Next / Previous Pager */}
            {data.totalCount != null && data.totalCount > 1 && (
              <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg p-1 shadow-xs">
                <button
                  type="button"
                  onClick={data.onPrevious}
                  disabled={!data.onPrevious || data.isLoading}
                  className="px-2.5 py-1 text-xs font-bold rounded text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer transition-colors"
                  title="Previous File (Left Arrow ←)"
                >
                  ◀ Prev
                </button>
                <span className="text-xs font-mono font-medium text-slate-500 px-2 border-x border-slate-200 select-none">
                  {data.currentIndex !== undefined
                    ? data.currentIndex + 1
                    : "?"}{" "}
                  / {data.totalCount}
                </span>
                <button
                  type="button"
                  onClick={data.onNext}
                  disabled={!data.onNext || data.isLoading}
                  className="px-2.5 py-1 text-xs font-bold rounded text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer transition-colors"
                  title="Next File (Right Arrow →)"
                >
                  Next ▶
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 text-lg leading-none cursor-pointer"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal KPI Summary Cards */}
        <div className="px-6 py-3 bg-white border-b border-slate-100 flex items-center gap-4 flex-wrap">
          {/* Draw Number */}
          <div className="flex items-center gap-2.5 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-slate-500 font-semibold text-xs uppercase tracking-wider">
              Draw No:
            </span>
            <span className="font-mono font-black text-slate-900 text-xl tracking-tight leading-none">
              {data.drawNumber}
            </span>
          </div>

          {/* Row Count */}
          <div className="flex items-center gap-2 bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 text-xs">
            <span className="text-slate-500 font-medium">Return Rows:</span>
            <span className="font-mono font-bold text-slate-900 text-sm">
              {data.rowCount}
            </span>
          </div>

          {/* Total Return Quantity */}
          <div className="flex items-center gap-2 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-200 text-xs">
            <span className="text-emerald-700 font-medium">
              Total Return Qty:
            </span>
            <span className="font-mono font-black text-emerald-800 text-base">
              {data.totalReturnQuantity.toLocaleString()}
            </span>
          </div>

          {/* Destination Notice */}
          <div className="ml-auto text-[11px] text-slate-500 font-mono">
            Target: <span className="font-bold text-slate-700">{data.folderPath || "C:\\nlb return"}</span>
          </div>
        </div>

        {/* Modal Body / Table */}
        <div className="p-6 overflow-y-auto flex-1 bg-white">
          {data.isLoading ? (
            <div className="py-12 text-center text-xs text-slate-500">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-800 border-t-transparent rounded-full mr-2" />
              Loading file details…
            </div>
          ) : data.rows.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No return allocation rows to preview.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold sticky top-0">
                  <tr>
                    <th className="px-3 py-2.5 text-center w-12 text-slate-400">
                      #
                    </th>
                    <th className="px-3 py-2.5 text-left">Draw Number</th>
                    <th className="px-3 py-2.5 text-left">Agent Code</th>
                    <th className="px-3 py-2.5 text-left font-mono">
                      Starting Barcode
                    </th>
                    <th className="px-3 py-2.5 text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {data.rows.map((row, idx) => (
                    <tr
                      key={idx}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-3 py-2 text-center text-slate-400 font-sans">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2 text-slate-800 font-medium">
                        {row.drawNumber}
                      </td>
                      <td className="px-3 py-2 font-bold text-indigo-700">
                        {row.agentCode}
                      </td>
                      <td className="px-3 py-2 text-slate-900 tracking-wider">
                        {row.startingBarcode}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-700">
                        {row.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {data.onDelete && (
              <button
                type="button"
                onClick={data.onDelete}
                className="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-medium cursor-pointer"
              >
                Delete File
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium cursor-pointer"
            >
              Close
            </button>

            {data.onSaveToFirebase && !data.isSaved && (
              <button
                type="button"
                onClick={data.onSaveToFirebase}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
              >
                Save to Cloud
              </button>
            )}

            {data.onSaveToLocal && (
              <button
                type="button"
                onClick={data.onSaveToLocal}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs cursor-pointer flex items-center gap-1.5"
                title="Save directly to C:\nlb return"
              >
                <span>💾</span>
                <span>Save Local</span>
              </button>
            )}

            {data.onDownload && (
              <button
                type="button"
                onClick={data.onDownload}
                className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs cursor-pointer"
              >
                Download (.xlsx)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

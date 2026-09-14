"use client";

import Link from "next/link";
import { DragEvent, ChangeEvent, useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";

import {
  ALLOWED_CODES,
  validateFilename,
} from "../lib/nlbPreprocess";
import type {
  PreprocessResult,
  ProcessedRow,
} from "../lib/nlbPreprocess";
import {
  saveNlbCleanedFile,
  listNlbUploadedFilesByDate,
  deleteNlbUploadedFile,
} from "../lib/nlbUploadService";
import type { NlbUploadedFileRecord } from "../lib/nlbUploadService";

/* =====================================================
   TYPES
   ===================================================== */

type FileEntry = {
  id: string;
  file: File;
  code: string;
  status: "waiting" | "processing" | "completed" | "failed";
  result: PreprocessResult | null;
  errorMessage: string | null;
  isSavedToFirebase?: boolean;
};

/* =====================================================
   XLSX GENERATOR HELPER
   ===================================================== */

function generateCleanedXlsx(rows: ProcessedRow[]): Blob {
  const header = ["Draw Number", "Agent Code", "Starting Barcode", "Quantity"];
  const aoa: (string | number)[][] = [
    header,
    ...rows.map((r) => [r.drawNumber, r.agentCode, r.startingBarcode, r.quantity]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Force Starting Barcode column (C) to TEXT to prevent precision loss
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

/**
 * Single file download with location selection dialog (showSaveFilePicker)
 */
async function triggerDownload(blob: Blob, filename: string): Promise<boolean> {
  // Modern Browser Save Prompt (Allows user to select location)
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
      if (err.name === "AbortError") return false; // User cancelled the picker
    }
  }

  // Fallback to standard browser download prompt
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

/**
 * Save multiple files to a directory chosen by the user via showDirectoryPicker,
 * with fallback to showSaveFilePicker / standard download.
 */
async function saveFilesToDirectory(
  filesToSave: { name: string; blob: Blob }[]
): Promise<{ success: boolean; savedCount: number; message?: string }> {
  if (filesToSave.length === 0) return { success: false, savedCount: 0 };

  // Single file: use showSaveFilePicker directly
  if (filesToSave.length === 1) {
    const ok = await triggerDownload(filesToSave[0].blob, filesToSave[0].name);
    return {
      success: ok,
      savedCount: ok ? 1 : 0,
      message: ok ? `Saved ${filesToSave[0].name}` : "Download cancelled.",
    };
  }

  // Multiple files: try Directory Picker first so user selects folder once
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
      // If permission or error, fall through to sequential save
    }
  }

  // Fallback: sequential save
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

/**
 * Fetch file Blob from a download URL (using local proxy to bypass CORS)
 */
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
   COMPONENT
   ===================================================== */

export default function NlbPreprocessPage() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);

  // Business date for Firebase tagging
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );

  // Saved files in Firebase
  const [savedFiles, setSavedFiles] = useState<NlbUploadedFileRecord[]>([]);
  const [selectedSavedIds, setSelectedSavedIds] = useState<Set<string>>(new Set());
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);

  // Action states
  const [isSavingFirebase, setIsSavingFirebase] = useState(false);
  const [savingFileId, setSavingFileId] = useState<string | null>(null);
  const [isDownloadingSelected, setIsDownloadingSelected] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  /* ---- Load saved files from Firebase for selectedDate ---- */

  const loadSavedFiles = useCallback(async (date: string) => {
    if (!date) return;
    setSavedLoading(true);
    setSavedError(null);
    try {
      const records = await listNlbUploadedFilesByDate(date);
      setSavedFiles(records);
      setSelectedSavedIds(new Set());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading saved files.";
      setSavedError(msg);
      setSavedFiles([]);
    } finally {
      setSavedLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSavedFiles(selectedDate);
  }, [selectedDate, loadSavedFiles]);

  /* ---- Helpers ---- */

  const updateEntry = useCallback(
    (id: string, patch: Partial<FileEntry>) =>
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
      ),
    []
  );

  const makeId = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /* ---- File validation & addition ---- */

  function addFiles(incoming: File[]) {
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

      const existingCodes = files.map((f) => f.code);
      const batchCodes = accepted.map((f) => f.code);

      if (existingCodes.includes(v.code) || batchCodes.includes(v.code)) {
        errs.push(
          `Duplicate: "${file.name}" — ${v.code} is already uploaded.`
        );
        continue;
      }

      accepted.push({
        id: makeId(),
        file,
        code: v.code,
        status: "waiting",
        result: null,
        errorMessage: null,
        isSavedToFirebase: false,
      });
    }

    setValidationErrors(errs);
    if (accepted.length > 0) {
      setFiles((prev) => [...prev, ...accepted]);
    }
  }

  /* ---- Drag and drop & input handlers ---- */

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    addFiles(Array.from(e.target.files));
    e.target.value = "";
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (!e.dataTransfer.files) return;
    addFiles(Array.from(e.dataTransfer.files));
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function clearAll() {
    setFiles([]);
    setSelectedIds(new Set());
    setValidationErrors([]);
  }

  /* ---- Processing ---- */

  async function processAll() {
    const toProcess = files.filter((f) => f.status === "waiting");
    if (toProcess.length === 0) return;

    setIsProcessingAll(true);

    for (const entry of toProcess) {
      updateEntry(entry.id, { status: "processing", errorMessage: null });

      try {
        const formData = new FormData();
        formData.append("file", entry.file);

        const res = await fetch("/api/nlb-preprocess", {
          method: "POST",
          body: formData,
        });

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          updateEntry(entry.id, {
            status: "failed",
            errorMessage: `Server returned ${res.status} ${res.statusText}`,
          });
          continue;
        }

        const body = await res.json();

        if (body.error && !body.status) {
          updateEntry(entry.id, {
            status: "failed",
            errorMessage: body.error,
          });
          continue;
        }

        const result = body as PreprocessResult;

        updateEntry(entry.id, {
          status: result.status === "completed" ? "completed" : "failed",
          result,
          errorMessage:
            result.status === "failed"
              ? result.errors.join("; ")
              : null,
        });

        // Automatically tick successfully completed files
        if (result.status === "completed") {
          setSelectedIds((prev) => new Set(prev).add(entry.id));
        }
      } catch (err: unknown) {
        updateEntry(entry.id, {
          status: "failed",
          errorMessage:
            err instanceof Error ? err.message : "Network or unknown error.",
        });
      }
    }

    setIsProcessingAll(false);
  }

  /* ---- Selection Handling (Uploaded Batch) ---- */

  const completedEntries = files.filter(
    (f) => f.status === "completed" && f.result && f.result.rows.length > 0
  );

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleToggleSelectAllCompleted() {
    if (selectedIds.size === completedEntries.length && completedEntries.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(completedEntries.map((e) => e.id)));
    }
  }

  /* ---- Single / Batch Download (Uploaded Batch) ---- */

  async function handleDownloadSingle(entry: FileEntry) {
    if (!entry.result || entry.result.rows.length === 0) return;
    const blob = generateCleanedXlsx(entry.result.rows);
    await triggerDownload(blob, `${entry.code}.xlsx`);
  }

  async function handleDownloadSelectedBatch() {
    const entriesToDownload = files.filter(
      (f) => selectedIds.has(f.id) && f.status === "completed" && f.result && f.result.rows.length > 0
    );
    if (entriesToDownload.length === 0) return;

    setIsDownloadingSelected(true);
    try {
      const filesToSave = entriesToDownload.map((e) => ({
        name: `${e.code}.xlsx`,
        blob: generateCleanedXlsx(e.result!.rows),
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

  /* ---- Save to Firebase (Uploaded Batch) ---- */

  async function handleSaveSingleToFirebase(entry: FileEntry) {
    if (!entry.result || entry.result.rows.length === 0) return;
    setSavingFileId(entry.id);
    try {
      const blob = generateCleanedXlsx(entry.result.rows);
      await saveNlbCleanedFile(
        blob,
        `${entry.code}.xlsx`,
        entry.code,
        entry.result.drawNumber || "",
        entry.result.rowCount,
        selectedDate
      );
      updateEntry(entry.id, { isSavedToFirebase: true });
      setFeedbackMessage({
        type: "success",
        text: `Saved ${entry.code}.xlsx to Firebase for date ${selectedDate}!`,
      });
      await loadSavedFiles(selectedDate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving to Firebase.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setSavingFileId(null);
    }
  }

  async function handleSaveSelectedToFirebase() {
    const entriesToSave = files.filter(
      (f) => selectedIds.has(f.id) && f.status === "completed" && f.result && f.result.rows.length > 0
    );
    if (entriesToSave.length === 0) return;

    setIsSavingFirebase(true);
    try {
      let saved = 0;
      for (const entry of entriesToSave) {
        if (!entry.result) continue;
        const blob = generateCleanedXlsx(entry.result.rows);
        await saveNlbCleanedFile(
          blob,
          `${entry.code}.xlsx`,
          entry.code,
          entry.result.drawNumber || "",
          entry.result.rowCount,
          selectedDate
        );
        updateEntry(entry.id, { isSavedToFirebase: true });
        saved++;
      }
      setFeedbackMessage({
        type: "success",
        text: `Successfully saved ${saved} file(s) to Firebase for ${selectedDate}!`,
      });
      await loadSavedFiles(selectedDate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving to Firebase.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setIsSavingFirebase(false);
    }
  }

  /* ---- Selection & Download for Saved Firebase Records ---- */

  function handleToggleSaved(id: string) {
    setSelectedSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleToggleAllSaved() {
    if (selectedSavedIds.size === savedFiles.length && savedFiles.length > 0) {
      setSelectedSavedIds(new Set());
    } else {
      setSelectedSavedIds(new Set(savedFiles.map((f) => f.id)));
    }
  }

  async function handleDownloadSingleSaved(rec: NlbUploadedFileRecord) {
    try {
      const blob = await fetchFileBlobFromUrl(rec.downloadUrl);
      await triggerDownload(blob, rec.fileName || `${rec.code}.xlsx`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error downloading file.";
      setFeedbackMessage({ type: "error", text: msg });
    }
  }

  async function handleDownloadSelectedSaved() {
    const recordsToDownload = savedFiles.filter((f) => selectedSavedIds.has(f.id));
    if (recordsToDownload.length === 0) return;

    setIsDownloadingSelected(true);
    try {
      const filesToSave: { name: string; blob: Blob }[] = [];
      for (const rec of recordsToDownload) {
        const blob = await fetchFileBlobFromUrl(rec.downloadUrl);
        filesToSave.push({
          name: rec.fileName || `${rec.code}.xlsx`,
          blob,
        });
      }

      const res = await saveFilesToDirectory(filesToSave);
      if (res.message) {
        setFeedbackMessage({ type: res.success ? "success" : "error", text: res.message });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error downloading selected files.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setIsDownloadingSelected(false);
    }
  }

  async function handleDeleteSaved(rec: NlbUploadedFileRecord) {
    if (!confirm(`Are you sure you want to delete ${rec.fileName} from Firebase?`)) return;
    setDeletingRecordId(rec.id);
    try {
      await deleteNlbUploadedFile(rec);
      setSelectedSavedIds((prev) => {
        const next = new Set(prev);
        next.delete(rec.id);
        return next;
      });
      await loadSavedFiles(selectedDate);
      setFeedbackMessage({
        type: "success",
        text: `Deleted ${rec.fileName} from Firebase.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error deleting file.";
      setFeedbackMessage({ type: "error", text: msg });
    } finally {
      setDeletingRecordId(null);
    }
  }

  async function handleDeleteSelectedSaved() {
    const recordsToDelete = savedFiles.filter((f) => selectedSavedIds.has(f.id));
    if (recordsToDelete.length === 0) return;
    if (!confirm(`Delete ${recordsToDelete.length} selected file(s) from Firebase?`)) return;

    try {
      for (const rec of recordsToDelete) {
        await deleteNlbUploadedFile(rec);
      }
      setSelectedSavedIds(new Set());
      await loadSavedFiles(selectedDate);
      setFeedbackMessage({
        type: "success",
        text: `Deleted ${recordsToDelete.length} file(s) from Firebase.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error deleting files.";
      setFeedbackMessage({ type: "error", text: msg });
    }
  }

  /* ---- Derived counts ---- */

  const waitingCount = files.filter((f) => f.status === "waiting").length;
  const completedCount = files.filter((f) => f.status === "completed").length;
  const failedCount = files.filter((f) => f.status === "failed").length;

  /* =====================================================
     RENDER
     ===================================================== */

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-900 py-8 px-4">
      <div className="w-full max-w-6xl p-6 rounded-lg bg-white shadow border border-gray-300 space-y-6">
        {/* ---------- Header ---------- */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              NLB Raw Excel Preprocessing
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Upload raw reports → preprocess → save to Firebase by date → tick and download to selected folder
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium shadow"
            >
              ← DLB Sales
            </Link>
            <Link
              href="/returns"
              className="px-3 py-1.5 rounded bg-purple-700 hover:bg-purple-800 text-white text-xs font-medium shadow"
            >
              Returns
            </Link>
            <Link
              href="/return-analysis"
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium shadow"
            >
              Analyzer
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
              className="ml-3 text-gray-400 hover:text-gray-700 font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* ---------- Business Date Section ---------- */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">
              Business Date / Processing Date
            </h2>
            <p className="text-[11px] text-gray-600">
              Cleaned files saved to Firebase are categorized under this date for record keeping and fast retrieval.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="nlb-date-input" className="text-xs font-medium text-gray-700">
              Date:
            </label>
            <input
              id="nlb-date-input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs bg-white font-medium shadow-sm focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>
        </section>

        {/* ---------- Upload Zone ---------- */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <h2 className="text-sm font-medium text-gray-800">
            Upload Raw NLB Files
          </h2>
          <p className="text-[11px] text-gray-600">
            Allowed filenames:{" "}
            <span className="font-mono font-medium text-teal-700">
              {ALLOWED_CODES.join(", ")}
            </span>{" "}
            (.xls / .xlsx)
          </p>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center p-8 rounded-xl border-2 border-dashed transition-colors ${
              isDragOver
                ? "border-teal-500 bg-teal-50"
                : "border-gray-400 bg-white"
            }`}
          >
            <label
              htmlFor="nlb-raw-file"
              className="cursor-pointer bg-teal-600 hover:bg-teal-700 text-white font-bold py-3.5 px-8 rounded-xl shadow hover:shadow-md text-base transition-all text-center"
            >
              Browse Files
            </label>
            <p className="text-gray-500 text-xs mt-2">
              or drag &amp; drop .xls / .xlsx files here
            </p>
            <input
              id="nlb-raw-file"
              type="file"
              accept=".xls,.xlsx"
              multiple
              className="hidden"
              onChange={handleInputChange}
            />
          </div>

          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="border border-red-300 bg-red-50 rounded p-3 space-y-1">
              {validationErrors.map((msg, i) => (
                <p key={i} className="text-xs text-red-800">
                  ✕ {msg}
                </p>
              ))}
            </div>
          )}
        </section>

        {/* ---------- Uploaded Batch List ---------- */}
        {files.length > 0 && (
          <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-gray-800">
                  Uploaded Batch ({files.length})
                </h2>
                {completedCount > 0 && (
                  <span className="text-green-700 text-xs font-semibold ml-2">
                    ✓ {completedCount} completed
                  </span>
                )}
                {failedCount > 0 && (
                  <span className="text-red-600 text-xs font-semibold ml-2">
                    ✕ {failedCount} failed
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {waitingCount > 0 && (
                  <button
                    type="button"
                    onClick={processAll}
                    disabled={isProcessingAll}
                    className="px-3.5 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow disabled:opacity-60"
                  >
                    {isProcessingAll
                      ? "Processing…"
                      : `Process All (${waitingCount})`}
                  </button>
                )}

                <button
                  type="button"
                  onClick={clearAll}
                  disabled={isProcessingAll}
                  className="px-3 py-1.5 rounded border border-gray-300 bg-white text-gray-700 text-xs font-medium disabled:opacity-60 hover:bg-gray-50"
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Batch Action Toolbar for Completed / Ticked Files */}
            {completedEntries.length > 0 && (
              <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-lg p-2.5 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-teal-900 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        selectedIds.size === completedEntries.length &&
                        completedEntries.length > 0
                      }
                      onChange={handleToggleSelectAllCompleted}
                      className="rounded text-teal-600 focus:ring-teal-500"
                    />
                    <span>
                      Select All Completed ({selectedIds.size}/{completedEntries.length})
                    </span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  {selectedIds.size > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={handleDownloadSelectedBatch}
                        disabled={isDownloadingSelected}
                        className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shadow flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <span>
                          {isDownloadingSelected
                            ? "Saving..."
                            : `Download Selected (${selectedIds.size}) to Location`}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={handleSaveSelectedToFirebase}
                        disabled={isSavingFirebase}
                        className="px-3 py-1 rounded bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <span>
                          {isSavingFirebase
                            ? "Saving to Firebase…"
                            : `Save Selected (${selectedIds.size}) to Firebase (${selectedDate})`}
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Per-file cards */}
            <div className="space-y-3">
              {files.map((entry) => (
                <FileCard
                  key={entry.id}
                  entry={entry}
                  isSelected={selectedIds.has(entry.id)}
                  onToggleSelect={() => handleToggleSelect(entry.id)}
                  onRemove={() => removeFile(entry.id)}
                  onDownload={() => handleDownloadSingle(entry)}
                  onSaveToFirebase={() => handleSaveSingleToFirebase(entry)}
                  isSavingFirebase={savingFileId === entry.id}
                  isProcessingAll={isProcessingAll}
                />
              ))}
            </div>
          </section>
        )}

        {/* ---------- Saved NLB Files in Firebase Section ---------- */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-800">
                  Saved NLB Files in Firebase ({savedFiles.length})
                </h2>
                <span className="text-xs text-teal-800 font-semibold bg-teal-100 px-2 py-0.5 rounded">
                  {selectedDate}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Processed lottery reports stored in Firebase for this date. Tick items to download to your chosen location.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {selectedSavedIds.size > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleDownloadSelectedSaved}
                    disabled={isDownloadingSelected}
                    className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shadow disabled:opacity-60 flex items-center gap-1"
                  >
                    <span>
                      {isDownloadingSelected
                        ? "Saving…"
                        : `Download Selected (${selectedSavedIds.size}) to Location`}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDeleteSelectedSaved}
                    className="px-2.5 py-1 rounded border border-red-300 text-red-600 text-xs bg-white hover:bg-red-50 font-medium"
                  >
                    Delete Selected ({selectedSavedIds.size})
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => loadSavedFiles(selectedDate)}
                disabled={savedLoading}
                className="px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-700 text-xs font-medium hover:bg-gray-100 disabled:opacity-60"
              >
                {savedLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          {savedLoading && (
            <p className="text-xs text-gray-500 py-3 text-center">
              Loading saved files for {selectedDate}…
            </p>
          )}

          {savedError && (
            <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200">
              ✕ {savedError}
            </p>
          )}

          {savedFiles.length === 0 && !savedLoading && !savedError && (
            <div className="bg-white p-4 rounded-lg border border-gray-200 text-center text-xs text-gray-500">
              No NLB files saved in Firebase for date{" "}
              <span className="font-semibold text-gray-700">{selectedDate}</span>.
              Process raw files above and click &quot;Save to Firebase&quot;.
            </div>
          )}

          {savedFiles.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-100 border-b border-gray-200">
                  <tr>
                    <th className="w-10 px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={
                          selectedSavedIds.size === savedFiles.length &&
                          savedFiles.length > 0
                        }
                        onChange={handleToggleAllSaved}
                        className="rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Lottery Code / File
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Draw Number
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">
                      Rows
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">
                      Size (KB)
                    </th>
                    <th className="px-3 py-2 text-center font-semibold text-gray-700">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {savedFiles.map((rec) => (
                    <tr
                      key={rec.id}
                      className={`hover:bg-teal-50/50 transition-colors ${
                        selectedSavedIds.has(rec.id) ? "bg-teal-50/70" : ""
                      }`}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedSavedIds.has(rec.id)}
                          onChange={() => handleToggleSaved(rec.id)}
                          className="rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono font-bold text-teal-800">
                        {rec.fileName}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-700">
                        {rec.drawNumber || "-"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800">
                        {rec.rowCount}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">
                        {Math.round(rec.size / 1024)} KB
                      </td>
                      <td className="px-3 py-2 text-center space-x-2">
                        <button
                          type="button"
                          onClick={() => handleDownloadSingleSaved(rec)}
                          className="px-2.5 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-[11px] font-medium shadow-sm"
                        >
                          Download to Location
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSaved(rec)}
                          disabled={deletingRecordId === rec.id}
                          className="px-2 py-1 rounded border border-red-300 text-red-600 text-[11px] hover:bg-red-50 disabled:opacity-50"
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
        </section>
      </div>
    </main>
  );
}

/* =====================================================
   FILE CARD SUB-COMPONENT
   ===================================================== */

function FileCard({
  entry,
  isSelected,
  onToggleSelect,
  onRemove,
  onDownload,
  onSaveToFirebase,
  isSavingFirebase,
  isProcessingAll,
}: {
  entry: FileEntry;
  isSelected: boolean;
  onToggleSelect: () => void;
  onRemove: () => void;
  onDownload: () => void;
  onSaveToFirebase: () => void;
  isSavingFirebase: boolean;
  isProcessingAll: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const r = entry.result;

  const statusColors: Record<FileEntry["status"], string> = {
    waiting: "bg-gray-200 text-gray-700",
    processing: "bg-yellow-200 text-yellow-800",
    completed: "bg-green-200 text-green-800",
    failed: "bg-red-200 text-red-800",
  };

  const statusLabels: Record<FileEntry["status"], string> = {
    waiting: "Waiting",
    processing: "Processing…",
    completed: "Completed",
    failed: "Failed",
  };

  return (
    <div
      className={`border rounded-lg bg-white p-3 space-y-2 transition-all ${
        isSelected ? "border-teal-400 bg-teal-50/20" : "border-gray-200"
      }`}
    >
      {/* Top row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Checkbox for completed entries */}
          {entry.status === "completed" && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
            />
          )}

          <span className="font-mono text-sm font-bold text-teal-700 shrink-0">
            {entry.code}
          </span>
          <span className="text-xs text-gray-500 truncate">
            {entry.file.name} ({Math.round(entry.file.size / 1024)} KB)
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${statusColors[entry.status]}`}
          >
            {statusLabels[entry.status]}
          </span>
          {entry.isSavedToFirebase && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-100 text-teal-800 shrink-0">
              ✓ In Firebase
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {entry.status === "completed" && r && r.rows.length > 0 && (
            <>
              <button
                type="button"
                onClick={onDownload}
                className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-medium shadow"
              >
                Download {entry.code}.xlsx
              </button>

              <button
                type="button"
                onClick={onSaveToFirebase}
                disabled={isSavingFirebase}
                className="px-2.5 py-1 rounded bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium shadow disabled:opacity-60"
              >
                {isSavingFirebase ? "Saving…" : "Save to Firebase"}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onRemove}
            disabled={isProcessingAll && entry.status === "processing"}
            className="px-2 py-1 rounded border border-red-300 text-red-600 text-xs bg-white hover:bg-red-50 disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Status details */}
      {entry.status === "completed" && r && (
        <div className="text-xs text-gray-700 space-y-0.5">
          <p>
            ✓ Filename valid &nbsp;|&nbsp; ✓ Draw{" "}
            <span className="font-mono font-semibold">{r.drawNumber}</span>{" "}
            detected &nbsp;|&nbsp; ✓{" "}
            <span className="font-semibold">{r.rowCount}</span> rows
            processed
            {r.warnings.length > 0 && (
              <span className="text-amber-600 ml-2">
                ⚠ {r.warnings.length} warning(s)
              </span>
            )}
            {r.errors.length > 0 && (
              <span className="text-red-600 ml-2">
                ✕ {r.errors.length} row error(s) excluded
              </span>
            )}
          </p>
        </div>
      )}

      {entry.status === "failed" && (
        <p className="text-xs text-red-700">
          ✕ {entry.errorMessage || "Processing failed."}
        </p>
      )}

      {/* Expandable details */}
      {r &&
        (r.warnings.length > 0 ||
          r.errors.length > 0 ||
          r.rows.length > 0) && (
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="text-[11px] text-blue-600 hover:underline"
          >
            {showDetails ? "Hide details ▲" : "Show details ▼"}
          </button>
        )}

      {showDetails && r && (
        <div className="space-y-2 pt-1">
          {/* Warnings */}
          {r.warnings.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded p-2">
              <p className="text-[11px] font-semibold text-amber-800 mb-1">
                Warnings ({r.warnings.length})
              </p>
              <ul className="list-disc pl-4 text-[11px] text-amber-700 space-y-0.5">
                {r.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Errors */}
          {r.errors.length > 0 && (
            <div className="border border-red-200 bg-red-50 rounded p-2">
              <p className="text-[11px] font-semibold text-red-800 mb-1">
                Errors ({r.errors.length})
              </p>
              <ul className="list-disc pl-4 text-[11px] text-red-700 space-y-0.5">
                {r.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Processed rows preview */}
          {r.rows.length > 0 && (
            <div className="max-h-64 overflow-auto border border-gray-200 rounded">
              <table className="min-w-full text-[11px]">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">#</th>
                    <th className="px-2 py-1 text-left font-medium">
                      Draw Number
                    </th>
                    <th className="px-2 py-1 text-left font-medium">
                      Agent Code
                    </th>
                    <th className="px-2 py-1 text-left font-medium">
                      Starting Barcode
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      Quantity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row, idx) => (
                    <tr
                      key={idx}
                      className={`border-t border-gray-100 ${
                        idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                      }`}
                    >
                      <td className="px-2 py-0.5 text-gray-400">
                        {idx + 1}
                      </td>
                      <td className="px-2 py-0.5 font-mono">
                        {row.drawNumber}
                      </td>
                      <td className="px-2 py-0.5 font-mono">
                        {row.agentCode}
                      </td>
                      <td className="px-2 py-0.5 font-mono">
                        {row.startingBarcode}
                      </td>
                      <td className="px-2 py-0.5 text-right font-medium">
                        {row.quantity.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

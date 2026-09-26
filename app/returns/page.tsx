"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import * as XLSX from "xlsx";

import {
  buildReturnRows,
  Cell,
  ReturnRow,
  renderCell,
} from "../lib/returnTransformer";

import MasterDealerEditor from "../components/MasterDealerEditor";
import DealerAliasEditor from "../components/DealerAliasEditor";

import {
  ReturnUploadedFileRecord,
  saveReturnUploadedFile,
  saveReturnUploadedFilesAtomic,
  listReturnUploadedFilesByDate,
  deleteReturnUploadedFile,
} from "../lib/returnUploadService";
import { validateFileData } from "../lib/fileValidation";



// ✅ auto game select (same as Sales page)
import { OFFICIAL_GAMES, suggestGameFromFileName } from "../lib/gameAutoSelect";

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateToDDMMYYYY(raw: string): string {
  if (!raw) return "";
  const [y, m, d] = raw.split("-");
  return `${d}/${m}/${y}`;
}

function normalizeSheetToCells(rawData: Cell[][]): Cell[][] {
  const maxCols = rawData.reduce((max, row) => (row.length > max ? row.length : max), 0);
  return rawData.map((row) => {
    const newRow: Cell[] = new Array(maxCols).fill("");
    for (let i = 0; i < row.length; i++) newRow[i] = row[i];
    return newRow;
  });
}

async function readFirstSheet(file: File): Promise<Cell[][]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as Cell[][];
  return normalizeSheetToCells(rawData);
}

/* =============================================================
   PAGE TYPES
   ============================================================= */

type ReturnFileConfig = {
  id: string;
  file: File;

  // Auto-selected OFFICIAL code, e.g. "SFT"
  gameId: string;

  // Draw derived from top business date (NO per-file picker)
  draw: string;     // dd/mm/yyyy
  drawDate: string; // yyyy-mm-dd

  // Trim first N digits before final 7-digit barcode
  trimDigits: number;

  // Auto-detect diagnostics
  autoDetectedGameId: string | null;
  autoDetectNote: string | null;
  autoDetectStatus: "ok" | "mismatch_day" | "ambiguous" | "not_found";
};

export default function ReturnsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ Top business date drives: uploads list, draw date, and game-day auto detect
  const [businessDate, setBusinessDate] = useState<string>(todayKey());

  const [previewTable, setPreviewTable] = useState<Cell[][]>([]);
  const [previewLabel, setPreviewLabel] = useState<string>("");

  const [structuredReturns, setStructuredReturns] = useState<ReturnRow[]>([]);
  const [downloadBlob, setDownloadBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState<string>("Agent_Returns_structured.xlsx");

  // Return files
  const [fileConfigs, setFileConfigs] = useState<ReturnFileConfig[]>([]);

  // Upload history
  const [uploads, setUploads] = useState<ReturnUploadedFileRecord[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsError, setUploadsError] = useState<string | null>(null);
  const [savingFileId, setSavingFileId] = useState<string | null>(null);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [showDeleteOldFilesModal, setShowDeleteOldFilesModal] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);
  const [isLoadingAllIntoProcessor, setIsLoadingAllIntoProcessor] = useState(false);

  function updateFileConfig(id: string, updater: (old: ReturnFileConfig) => ReturnFileConfig) {
    setFileConfigs((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  }

  async function loadUploads(dateKey: string) {
    if (!dateKey) return;
    setUploadsError(null);
    setUploadsLoading(true);
    try {
const list = await listReturnUploadedFilesByDate(dateKey);
      setUploads(list);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading uploaded files.";
      setUploadsError(msg);
      setUploads([]);
    } finally {
      setUploadsLoading(false);
    }
  }

  useEffect(() => {
    void loadUploads(businessDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Apply auto-detection using businessDate day mapping
  function applyAutoDetection(dateKey: string, configs: ReturnFileConfig[]): ReturnFileConfig[] {
    return configs.map((cfg) => {
      const s = suggestGameFromFileName(cfg.file.name, dateKey);

      if (s.status === "ok") {
        return {
          ...cfg,
          gameId: s.official,
          autoDetectedGameId: s.official,
          autoDetectNote: s.note,
          autoDetectStatus: "ok",
        };
      }

      if (s.status === "mismatch_day") {
        return {
          ...cfg,
          gameId: s.official,
          autoDetectedGameId: s.official,
          autoDetectNote: s.note,
          autoDetectStatus: "mismatch_day",
        };
      }

      return {
        ...cfg,
        gameId: "",
        autoDetectedGameId: null,
        autoDetectNote: s.note,
        autoDetectStatus: s.status,
      };
    });
  }

  // ✅ When businessDate changes: update uploads list + drawDate/draw for all files + rerun auto-detect
  function handleBusinessDateChange(v: string) {
    setBusinessDate(v);
    void loadUploads(v);

    setFileConfigs((prev) =>
      applyAutoDetection(
        v,
        prev.map((cfg) => ({
          ...cfg,
          drawDate: v,
          draw: formatDateToDDMMYYYY(v),
        }))
      )
    );
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const inputEl = e.target;
    const files = inputEl.files;

    if (!files || files.length === 0) {
      setFileConfigs([]);
      setPreviewTable([]);
      setPreviewLabel("");
      setStructuredReturns([]);
      setDownloadBlob(null);
      setError(null);
      return;
    }

    // Inspect the Summary sheet before importing records into configuration
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const validation = await validateFileData(f, "return");
      if (!validation.isValid) {
        setError(validation.error);
        inputEl.value = "";
        setFileConfigs([]);
        setPreviewTable([]);
        setPreviewLabel("");
        setStructuredReturns([]);
        setDownloadBlob(null);
        return;
      }
    }

    const list: ReturnFileConfig[] = [];
    const now = Date.now();

    for (let i = 0; i < files.length; i++) {
      const f = files[i];

      list.push({
        id: `${f.name}-${i}-${now}`,
        file: f,

        gameId: "",

        // ✅ draw comes from top date picker
        drawDate: businessDate,
        draw: formatDateToDDMMYYYY(businessDate),

        // ✅ default trim digits (as requested)
        trimDigits: 2,

        autoDetectedGameId: null,
        autoDetectNote: null,
        autoDetectStatus: "not_found",
      });
    }

    setFileConfigs(applyAutoDetection(businessDate, list));
    setPreviewTable([]);
    setPreviewLabel("");
    setStructuredReturns([]);
    setDownloadBlob(null);
    setError(null);
  }

  async function handlePreviewFile(cfgId: string) {
    const cfg = fileConfigs.find((f) => f.id === cfgId);
    if (!cfg) return;

    try {
      const normalized = await readFirstSheet(cfg.file);
      setPreviewTable(normalized);
      setPreviewLabel(cfg.file.name);
    } catch (err) {
      console.error(err);
      setPreviewTable([]);
      setPreviewLabel("");
    }
  }

  async function handleSaveFile(cfgId: string) {
    const cfg = fileConfigs.find((f) => f.id === cfgId);
    if (!cfg) return;

    if (!businessDate) {
      setError("Please pick a business date before saving.");
      return;
    }

    if (cfg.autoDetectStatus !== "ok") {
      setError(`Cannot save "${cfg.file.name}": ${cfg.autoDetectNote || "Auto-detection failed."}`);
      return;
    }

    if (!cfg.gameId) {
      setError(`Game not set for file: ${cfg.file.name}`);
      return;
    }

    try {
      setError(null);
      setSavingFileId(cfg.id);

      // Validate Summary sheet before database writes
      const validation = await validateFileData(cfg.file, "return");
      if (!validation.isValid) {
        setError(validation.error);
        return;
      }

      // Save under gameId as both id and name (same pattern you used in Sales page)
      await saveReturnUploadedFile(cfg.file, cfg.gameId, cfg.gameId, businessDate);

      await loadUploads(businessDate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving return file to Firebase.";
      setError(msg);
    } finally {
      setSavingFileId(null);
    }
  }

  // ------------- Save All Files to Firebase -------------
  async function handleSaveAll(shouldDeleteOld: boolean = false) {
    if (!businessDate) {
      setError("Please pick a business date at the top before saving files.");
      return;
    }

    const validConfigs = fileConfigs.filter(
      (cfg) => cfg.autoDetectStatus === "ok" && !!cfg.gameId
    );

    if (validConfigs.length === 0) {
      setError("No valid return files to save (check auto-detect status and game ID).");
      return;
    }

    // Strict pre-validation of all files before ANY database/storage writes
    for (const cfg of validConfigs) {
      const validation = await validateFileData(cfg.file, "return");
      if (!validation.isValid) {
        setError(validation.error);
        return;
      }
    }

    setIsSavingAll(true);
    setError(null);
    setSaveSuccessMessage(null);

    try {
      if (shouldDeleteOld) {
        for (const u of uploads) {
          try {
            await deleteReturnUploadedFile(u);
          } catch (e) {
            console.error("Failed to delete old return file:", e);
          }
        }
      }

      // Atomic batch save with automatic rollback on partial failure
      await saveReturnUploadedFilesAtomic(
        validConfigs.map((cfg) => ({
          file: cfg.file,
          gameId: cfg.gameId,
          gameName: cfg.gameId,
        })),
        businessDate
      );

      await loadUploads(businessDate);
      setSaveSuccessMessage(`Successfully saved ${validConfigs.length} return file(s) to Firebase!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving return files to Firebase.";
      setError(`Error during Save All: ${msg}`);
    } finally {
      setSavingFileId(null);
      setIsSavingAll(false);
    }
  }

  async function handleDeleteUpload(record: ReturnUploadedFileRecord) {
    try {
      setDeletingUploadId(record.id);
      await deleteReturnUploadedFile(record);
      await loadUploads(businessDate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error deleting uploaded file.";
      setUploadsError(msg);
    } finally {
      setDeletingUploadId(null);
    }
  }

  // ------------- Load All Uploads into Processor -------------
  async function handleLoadAllIntoProcessor() {
    if (uploads.length === 0) return;
    setIsLoadingAllIntoProcessor(true);
    setError(null);
    try {
      const now = Date.now();
      const list: ReturnFileConfig[] = [];
      let index = 0;

      for (const u of uploads) {
        if (!u.downloadUrl) continue;
        try {
          const proxyUrl = `/api/proxy?url=${encodeURIComponent(u.downloadUrl)}`;
          const res = await fetch(proxyUrl);
          const blob = await res.blob();
          
          const file = new File([blob], u.fileName, { type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

          list.push({
            id: `${file.name}-${index}-${now}`,
            file: file,
            gameId: u.gameName || "", 
            drawDate: businessDate,
            draw: formatDateToDDMMYYYY(businessDate),
            trimDigits: 2, // default for returns
            autoDetectedGameId: null,
            autoDetectNote: null,
            autoDetectStatus: "not_found",
          });
          index++;
        } catch (err) {
          console.error(`Failed to load ${u.fileName}`, err);
        }
      }

      const finalList = applyAutoDetection(businessDate, list);
      setFileConfigs(finalList);
      setPreviewTable([]);
      setPreviewLabel("");
      setStructuredReturns([]);
      setDownloadBlob(null);
    } catch (err) {
      console.error("Error loading files:", err);
      alert("Failed to load files into the processor.");
    } finally {
      setIsLoadingAllIntoProcessor(false);
    }
  }

  // ------------- Load Individual Upload into Processor -------------
  async function handleLoadIndividualIntoProcessor(u: ReturnUploadedFileRecord) {
    if (!u.downloadUrl) return;
    setIsLoadingAllIntoProcessor(true);
    setError(null);
    try {
      const now = Date.now();
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(u.downloadUrl)}`;
      const res = await fetch(proxyUrl);
      const blob = await res.blob();
      
      const file = new File([blob], u.fileName, { type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

      const newConfig: ReturnFileConfig = {
        id: `${file.name}-1-${now}`,
        file: file,
        gameId: u.gameName || "", 
        drawDate: businessDate,
        draw: formatDateToDDMMYYYY(businessDate),
        trimDigits: 2,
        autoDetectedGameId: null,
        autoDetectNote: null,
        autoDetectStatus: "not_found",
      };

      const newList = [...fileConfigs, newConfig];
      const updatedList = applyAutoDetection(businessDate, newList);
      setFileConfigs(updatedList);
    } catch (err) {
      console.error(`Failed to load ${u.fileName}`, err);
      alert(`Failed to load ${u.fileName} into the processor.`);
    } finally {
      setIsLoadingAllIntoProcessor(false);
    }
  }



  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStructuredReturns([]);
    setDownloadBlob(null);

    if (fileConfigs.length === 0) {
      setError("Please select at least one return Excel file.");
      return;
    }

    for (const cfg of fileConfigs) {
      const validation = await validateFileData(cfg.file, "return");
      if (!validation.isValid) {
        setError(validation.error);
        return;
      }
      if (cfg.autoDetectStatus !== "ok") {
        setError(`Fix file "${cfg.file.name}": ${cfg.autoDetectNote || "Auto-detection failed."}`);
        return;
      }
      if (!cfg.gameId) {
        setError(`Game not set for return file: ${cfg.file.name}`);
        return;
      }
      if (!businessDate) {
        setError("Please pick a business date at the top.");
        return;
      }
    }

    setIsLoading(true);

    try {
      const allRows: ReturnRow[] = [];

      for (const cfg of fileConfigs) {
        const normalized = await readFirstSheet(cfg.file);

        const rows = await buildReturnRows(
          normalized,
          cfg.gameId,                       // official code
          formatDateToDDMMYYYY(businessDate),
          cfg.trimDigits
        );

        allRows.push(...rows);
      }

      setStructuredReturns(allRows);

      if (allRows.length === 0) {
        setError("No valid return rows detected.");
      } else {
        const ws = XLSX.utils.json_to_sheet(allRows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Returns");
        const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });

        setDownloadBlob(
          new Blob([wbout], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          })
        );
      }

      setFileName("Agent_Returns_structured.xlsx");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error while processing the return files.";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDownload() {
    if (!downloadBlob) return;
    
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocal) {
      try {
        const res = await fetch('/api/save-local', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
          },
          body: downloadBlob,
        });
        
        const result = await res.json();
        if (res.ok && result.success) {
          alert(result.message || 'File saved successfully to C:\\DLB\\1.xlsx');
          return;
        } else {
          console.warn(`Local save failed: ${result.error}. Falling back to browser download.`);
        }
      } catch (err: unknown) {
        console.warn("Local save network error:", err, "Falling back to browser download.");
      }
    }

    // Fallback to standard browser download
    try {
      const url = window.URL.createObjectURL(downloadBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "1.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Error saving file: ${err.message}`);
    }
  }

  const totalQty = structuredReturns.reduce((sum, r) => sum + (r.Qty || 0), 0);



  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-900">
      <div className="w-full max-w-6xl p-6 rounded-lg bg-white shadow border border-gray-300 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Agent Return Report → Structured Return Table</h1>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-800 text-white text-xs font-medium shadow"
            >
              Go to Sales Page
            </Link>
          </div>
        </div>

        {/* Business Date + Upload History */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-gray-800">Business date / upload date</h2>
              <p className="text-[11px] text-gray-600">
                This date is also used as the <b>Draw Date</b> for all return files.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="date"
                value={businessDate}
                onChange={(e) => handleBusinessDateChange(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm bg-white"
              />
              <div className="text-[11px] text-gray-700">
                Draw: <b>{formatDateToDDMMYYYY(businessDate)}</b>
              </div>
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-2 bg-white">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-800">
                Uploaded return files for {businessDate}
              </span>
              <div className="flex items-center gap-2">
                {uploadsLoading && <span className="text-[11px] text-gray-500">Loading…</span>}
                {uploads.length > 0 && (
                  <button
                    type="button"
                    onClick={handleLoadAllIntoProcessor}
                    disabled={isLoadingAllIntoProcessor}
                    className="px-2 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-medium hover:bg-indigo-100 disabled:opacity-60"
                  >
                    {isLoadingAllIntoProcessor ? "Loading..." : "Load to Processor"}
                  </button>
                )}
              </div>
            </div>

            {uploadsError && <p className="text-[11px] text-red-600 mb-1">{uploadsError}</p>}

            {uploads.length === 0 && !uploadsLoading && !uploadsError && (
              <p className="text-[11px] text-gray-500">No return files saved for this date.</p>
            )}

            {uploads.length > 0 && (
              <div className="max-h-40 overflow-auto">
                <table className="min-w-full text-[11px]">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">File</th>
                      <th className="px-2 py-1 text-left font-medium">Game</th>
                      <th className="px-2 py-1 text-right font-medium">Size (KB)</th>
                      <th className="px-2 py-1 text-center font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploads.map((u) => (
                      <tr key={u.id} className="border-t border-gray-200">
                        <td className="px-2 py-1 whitespace-nowrap">{u.fileName}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{u.gameName || "-"}</td>
                        <td className="px-2 py-1 text-right">{Math.round((u.size || 0) / 1024)}</td>
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => void handleLoadIndividualIntoProcessor(u)}
                            className="text-indigo-600 font-medium hover:underline mr-2 text-[11px]"
                          >
                            Load
                          </button>
                          <a
                            href={u.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline mr-2"
                          >
                            Download
                          </a>
                          <button
                            type="button"
                            onClick={() => void handleDeleteUpload(u)}
                            disabled={deletingUploadId === u.id}
                            className="text-red-600 text-[11px] px-2 py-0.5 rounded border border-red-300 bg-white disabled:opacity-60"
                          >
                            {deletingUploadId === u.id ? "Deleting…" : "Delete"}
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

        {/* Dealer mapping */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <h2 className="text-sm font-medium text-gray-800">Dealer Mapping Configuration</h2>
          <MasterDealerEditor />
          <DealerAliasEditor />
        </section>



        {/* Main form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-4">
            <div>
              <label className="block text-sm mb-1" htmlFor="return-file">
                Upload DLB Return Report files (.xls or .xlsx)
              </label>
              <input
                id="return-file"
                name="return-file"
                type="file"
                accept=".xls,.xlsx"
                multiple
                onChange={handleFileChange}
                className="w-full text-sm"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                Select multiple return files. Game is auto-detected from file name + selected business date.
              </p>
            </div>

            {/* Per-file config cards */}
            {fileConfigs.length > 0 && (
              <div className="space-y-3">
                {/* Save All Control Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg shadow-sm">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold text-blue-800 bg-blue-100 rounded-full">
                        {fileConfigs.length} File{fileConfigs.length > 1 ? "s" : ""}
                      </span>
                      <h3 className="text-sm font-semibold text-gray-800">
                        Batch Return Uploads
                      </h3>
                    </div>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      Save all valid return files to Firebase Storage & Firestore at once instead of clicking each.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (uploads.length > 0) {
                        setShowDeleteOldFilesModal(true);
                      } else {
                        void handleSaveAll(false);
                      }
                    }}
                    disabled={isSavingAll || !businessDate}
                    className="px-4 py-2 bg-green-700 hover:bg-green-600 active:bg-green-800 disabled:opacity-50 text-white rounded-lg font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isSavingAll ? (
                      <>
                        <span className="inline-block animate-spin mr-1">⏳</span>
                        <span>Saving All Files…</span>
                      </>
                    ) : (
                      <>
                        <span>💾</span>
                        <span>Save All to Firebase</span>
                      </>
                    )}
                  </button>
                </div>

                {saveSuccessMessage && (
                  <div className="p-3 bg-green-50 border border-green-300 text-green-800 text-xs rounded-lg flex items-center justify-between shadow-sm">
                    <span className="font-medium">✓ {saveSuccessMessage}</span>
                    <button
                      type="button"
                      onClick={() => setSaveSuccessMessage(null)}
                      className="text-green-700 hover:text-green-900 font-bold ml-2 text-sm"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {fileConfigs.map((cfg, idx) => {
                  const canSave =
                    !!businessDate &&
                    cfg.autoDetectStatus === "ok" &&
                    !!cfg.gameId &&
                    savingFileId !== cfg.id;

                  return (
                    <div key={cfg.id} className="border border-gray-300 rounded-lg p-3 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-gray-800">
                          File {idx + 1}: {cfg.file.name}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-gray-600">
                          <button
                            type="button"
                            onClick={() => void handlePreviewFile(cfg.id)}
                            className="px-2 py-0.5 rounded border border-gray-300 bg-gray-100 hover:bg-gray-200"
                          >
                            Preview raw return Excel
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleSaveFile(cfg.id)}
                            disabled={!canSave}
                            className="px-2 py-0.5 rounded border border-blue-500 bg-blue-50 text-blue-700 disabled:opacity-60"
                          >
                            {savingFileId === cfg.id ? "Saving…" : "Save to Firebase"}
                          </button>
                        </div>
                      </div>

                      {/* Draw date from top */}
                      <div className="text-[11px] text-gray-700">
                        Draw Date (from top): <b>{formatDateToDDMMYYYY(businessDate)}</b>
                      </div>

                      {/* Trim digits */}
                      <div>
                        <label className="block text-xs mb-1 text-gray-700">
                          Trim prefix digits (barcode trimming)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={cfg.trimDigits}
                          onChange={(e) => {
                            const raw = Number(e.target.value || 0);
                            const v = Math.max(0, Math.min(10, Number.isFinite(raw) ? raw : 0));
                            updateFileConfig(cfg.id, (old) => ({
                              ...old,
                              trimDigits: Math.trunc(v),
                            }));
                          }}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                        />
                        <p className="text-[11px] text-gray-600 mt-1">
                          Default is <b>2</b>. Example: Trim=2 turns &quot;056600001&ldquo; → &quot;6600001&quot; then output stays as 7 digits.
                        </p>
                      </div>

                      {/* Auto-selected game (display only) */}
                      <div>
                        <select
                          value={cfg.gameId}
                          disabled
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-gray-100 cursor-not-allowed"
                        >
                          <option value="">-- Auto selected --</option>
                          {OFFICIAL_GAMES.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>

                        {cfg.autoDetectNote && (
                          <p
                            className={`mt-1 text-[11px] ${
                              cfg.autoDetectStatus === "ok" ? "text-gray-600" : "text-red-600"
                            }`}
                          >
                            {cfg.autoDetectNote}
                          </p>
                        )}
                      </div>


                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isLoading || fileConfigs.length === 0}
              className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-60 cursor-pointer"
            >
              {isLoading ? "Processing returns..." : "Build structured return table"}
            </button>

            {fileConfigs.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (uploads.length > 0) {
                    setShowDeleteOldFilesModal(true);
                  } else {
                    void handleSaveAll(false);
                  }
                }}
                disabled={isSavingAll || !businessDate}
                className="px-4 py-2 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium shadow flex items-center gap-2 cursor-pointer transition-colors"
              >
                {isSavingAll ? "Saving All Files…" : "💾 Save All to Firebase"}
              </button>
            )}
          </div>
        </form>

        {/* Preview */}
        {previewTable.length > 0 && (
          <section className="space-y-2">
            <div className="text-sm text-gray-800">
              <span className="font-medium">Raw return Excel preview</span>
              <span className="ml-2 text-gray-600">
                ({previewTable.length} rows, file: {previewLabel})
              </span>
            </div>

            <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
              <div className="max-h-72 overflow-auto">
                <table className="min-w-full text-xs border-collapse">
                  <tbody>
                    {previewTable.map((row, rIdx) => (
                      <tr key={rIdx} className={rIdx % 2 === 0 ? "bg-white" : "bg-gray-100"}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="px-3 py-1.5 border border-gray-200 whitespace-nowrap">
                            {renderCell(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Output */}
        {structuredReturns.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-800">
                <span className="font-medium">
                  Structured Agent Returns (DealerCode / Game / Draw / From / Qty)
                </span>
                <span className="ml-2 text-gray-600">
                  ({structuredReturns.length} rows, total qty: {totalQty})
                </span>
              </div>

              <button
                onClick={handleDownload}
                disabled={!downloadBlob}
                className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium disabled:opacity-60"
              >
                Download {fileName}
              </button>
            </div>

            <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
              <div className="max-h-72 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">DealerCode</th>
                      <th className="px-3 py-2 text-left font-medium">Game</th>
                      <th className="px-3 py-2 text-left font-medium">Draw</th>
                      <th className="px-3 py-2 text-right font-medium">From</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {structuredReturns.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-100"}>
                        <td className="px-3 py-1.5 whitespace-nowrap">{row.DealerCode}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{row.Game}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{row.Draw}</td>
                        <td className="px-3 py-1.5 text-right">{row.From}</td>
                        <td className="px-3 py-1.5 text-right">{row.Qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {previewTable.length === 0 && structuredReturns.length === 0 && !isLoading && !error && (
          <p className="text-xs text-gray-600">
            Upload return files, confirm auto-detected game, then build the structured Excel.
          </p>
        )}

        {/* Modal for Deleting Old Files */}
        {showDeleteOldFilesModal && (
          <div className="fixed inset-0 bg-slate-900/80 flex flex-col items-center justify-center z-[70] p-6 backdrop-blur-sm">
            <div className="bg-white text-slate-800 p-8 rounded-3xl border border-gray-300 max-w-xl text-center shadow-2xl">
              <h2 className="text-2xl font-bold mb-3 text-gray-900">
                Existing return files found for this date
              </h2>
              <p className="text-sm text-gray-600 mb-6">
                There are already <b>{uploads.length}</b> return file(s) saved for <b>{businessDate}</b>.<br />
                Do you want to remove old files before saving the new ones, or keep both?
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button 
                  type="button"
                  onClick={() => {
                    setShowDeleteOldFilesModal(false);
                    void handleSaveAll(true);
                  }}
                  className="px-5 py-3 bg-red-700 text-white text-sm font-bold rounded-xl hover:bg-red-600 transition-colors shadow cursor-pointer"
                >
                  Remove Old & Save All
                </button>

                <button 
                  type="button"
                  onClick={() => {
                    setShowDeleteOldFilesModal(false);
                    void handleSaveAll(false);
                  }}
                  className="px-5 py-3 bg-blue-700 text-white text-sm font-bold rounded-xl hover:bg-blue-600 transition-colors shadow cursor-pointer"
                >
                  Keep Old & Save All
                </button>

                <button 
                  type="button"
                  onClick={() => setShowDeleteOldFilesModal(false)}
                  className="px-5 py-3 bg-gray-200 text-gray-700 text-sm font-bold rounded-xl hover:bg-gray-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import {
  buildReturnRows,
  Cell,
  ReturnRow,
  V1ExistingRow,
  renderCell,
} from "../lib/returnTransformer";

import MasterDealerEditor from "../components/MasterDealerEditor";
import DealerAliasEditor from "../components/DealerAliasEditor";

import {
  ReturnUploadedFileRecord,
  saveReturnUploadedFile,
  listReturnUploadedFilesByDate,
  deleteReturnUploadedFile,
} from "../lib/returnUploadService";



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

/**
 * Parse V1 table into exclusion rows.
 * Expected V1 formats (flexible):
 * - DealerCode | From | To
 * - DealerCode | From | Qty
 * - DealerCode | Game | Draw | From | To
 * - DealerCode | Game | Draw | From | Qty
 */
function toDigits(value: Cell): string {
  if (value == null) return "";
  if (typeof value === "number") return String(Math.trunc(value));
  const raw = String(value).trim();
  if (!raw) return "";
  if (/e/i.test(raw)) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return String(Math.trunc(n));
  }
  return raw.replace(/[^\d]/g, "");
}

function detectDealerCodeInRow(row: Cell[]): string | null {
  for (const cell of row) {
    const d = toDigits(cell);
    if (d.length === 5 || d.length === 6) return d;
  }
  return null;
}

function detectTwoSerials(row: Cell[]): { from: string | null; to: string | null } {
  let first: string | null = null;
  let second: string | null = null;

  for (const cell of row) {
    const d = toDigits(cell);
    if (d.length >= 7) {
      if (!first) first = d;
      else {
        second = d;
        break;
      }
    }
  }
  return { from: first, to: second };
}

function detectQtyInRow(row: Cell[]): number | null {
  for (let i = row.length - 1; i >= 0; i--) {
    const d = toDigits(row[i]);
    if (d.length > 0 && d.length <= 5) {
      const n = Number(d);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function detectGameDrawFromRow(row: Cell[]): { game?: string; draw?: string } {
  let game: string | undefined;
  let draw: string | undefined;

  for (const cell of row) {
    if (typeof cell === "string") {
      const s = cell.trim();
      if (!game && /^[A-Za-z]{2,5}$/.test(s)) game = s.toUpperCase();
      if (!draw && /^\d{2}\/\d{2}\/\d{4}$/.test(s)) draw = s;
    }
  }
  return { game, draw };
}

function parseV1FromSheet(sheet: Cell[][]): V1ExistingRow[] {
  const out: V1ExistingRow[] = [];

  for (const row of sheet) {
    if (row.every((c) => c == null || String(c).trim() === "")) continue;

    const dealer = detectDealerCodeInRow(row);
    const { from, to } = detectTwoSerials(row);
    const qty = detectQtyInRow(row);
    const { game, draw } = detectGameDrawFromRow(row);

    if (!dealer || !from) continue;

    const rec: V1ExistingRow = {
      DealerCode: dealer,
      From: from,
    };

    if (to) rec.To = to;
    else if (qty != null) rec.Qty = qty;

    if (game) rec.Game = game;
    if (draw) rec.Draw = draw;

    out.push(rec);
  }

  return out;
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

  // ✅ per-file optional V1 selection
  v1Id: string | null;
  strictMatchGameDraw: boolean;
};

type V1FileBundle = {
  id: string;
  fileName: string;
  rows: V1ExistingRow[];
  error: string | null;
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
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);

  // ✅ Multiple V1 files (library), and each return file chooses one (or none)
  const [v1Bundles, setV1Bundles] = useState<V1FileBundle[]>([]);
  const [v1LibraryError, setV1LibraryError] = useState<string | null>(null);

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

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;

    if (!files || files.length === 0) {
      setFileConfigs([]);
      setPreviewTable([]);
      setPreviewLabel("");
      setStructuredReturns([]);
      setDownloadBlob(null);
      setError(null);
      return;
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

        // ✅ per-file V1 selection defaults to NONE
        v1Id: null,
        strictMatchGameDraw: false,
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

  // ✅ Upload multiple V1 files into a library
  async function handleV1LibraryChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    setV1LibraryError(null);

    if (!files || files.length === 0) {
      setV1Bundles([]);
      // also clear per-file selection
      setFileConfigs((prev) => prev.map((c) => ({ ...c, v1Id: null })));
      return;
    }

    const bundles: V1FileBundle[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const id = `${f.name}-${i}-${Date.now()}`;

      try {
        const sheet = await readFirstSheet(f);
        const rows = parseV1FromSheet(sheet);

        bundles.push({
          id,
          fileName: f.name,
          rows,
          error: rows.length === 0
            ? "No valid V1 rows detected (need DealerCode + From + To/Qty)."
            : null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to read V1 file.";
        bundles.push({
          id,
          fileName: f.name,
          rows: [],
          error: msg,
        });
      }
    }

    setV1Bundles(bundles);

    // If old v1Id selections are now invalid, reset them
    const validIds = new Set(bundles.map((b) => b.id));
    setFileConfigs((prev) =>
      prev.map((c) => (c.v1Id && !validIds.has(c.v1Id) ? { ...c, v1Id: null } : c))
    );

    // Surface a summary error if all failed
    const hasAnyGood = bundles.some((b) => b.rows.length > 0 && !b.error);
    if (!hasAnyGood) {
      setV1LibraryError("V1 files loaded, but none produced valid rows. Check V1 format.");
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

        // ✅ pick V1 rows per file (or none)
        const v1ForThisFile =
          cfg.v1Id ? (v1Bundles.find((b) => b.id === cfg.v1Id)?.rows ?? []) : [];

        const rows = await buildReturnRows(
          normalized,
          cfg.gameId,                       // official code
          formatDateToDDMMYYYY(businessDate),
          cfg.trimDigits,
          v1ForThisFile,
          { strictMatchGameDraw: cfg.strictMatchGameDraw }
        );

        allRows.push(...rows);
      }

      setStructuredReturns(allRows);

      if (allRows.length === 0) {
        setError("No valid return rows detected (or everything was excluded by selected V1).");
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

  function handleDownload() {
    if (!downloadBlob) return;
    const url = window.URL.createObjectURL(downloadBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  const totalQty = structuredReturns.reduce((sum, r) => sum + (r.Qty || 0), 0);

  const v1LibraryStatus = useMemo(() => {
    if (v1Bundles.length === 0) return "No V1 files loaded (per-file exclusion disabled).";
    const ok = v1Bundles.filter((b) => b.rows.length > 0 && !b.error).length;
    const bad = v1Bundles.length - ok;
    return `V1 library loaded: ${v1Bundles.length} files (${ok} OK, ${bad} with issues).`;
  }, [v1Bundles]);

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
              {uploadsLoading && <span className="text-[11px] text-gray-500">Loading…</span>}
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

        {/* ✅ V1 library (multiple files) */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <div>
            <h2 className="text-sm font-medium text-gray-800">V1 Exclusion Library (optional)</h2>
            <p className="text-[11px] text-gray-600">
              Upload one or more V1 tables. Then, for each return file you can choose: <b>None</b> or select which V1
              file to exclude against.
            </p>
          </div>

          <div className="bg-white border border-gray-300 rounded-lg p-3 space-y-2">
            <input
              type="file"
              accept=".xls,.xlsx"
              multiple
              onChange={handleV1LibraryChange}
              className="w-full text-sm"
            />
            <p className="text-[11px] text-gray-700">
              Status: <b>{v1LibraryStatus}</b>
            </p>
            {v1LibraryError && <p className="text-[11px] text-red-600">{v1LibraryError}</p>}

            {v1Bundles.length > 0 && (
              <div className="max-h-40 overflow-auto border border-gray-200 rounded p-2">
                <table className="min-w-full text-[11px]">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">V1 File</th>
                      <th className="px-2 py-1 text-right font-medium">Rows</th>
                      <th className="px-2 py-1 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v1Bundles.map((b) => (
                      <tr key={b.id} className="border-t border-gray-200">
                        <td className="px-2 py-1 whitespace-nowrap">{b.fileName}</td>
                        <td className="px-2 py-1 text-right">{b.rows.length}</td>
                        <td className="px-2 py-1">
                          {b.error ? <span className="text-red-600">{b.error}</span> : "OK"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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

                      {/* ✅ Per-file V1 selection */}
                      <div className="border border-gray-200 rounded p-3 bg-gray-50 space-y-2">
                        <div className="text-xs font-medium text-gray-800">V1 Exclusion (optional, per file)</div>

                        <div>
                          <label className="block text-[11px] mb-1 text-gray-700">
                            Select V1 file to exclude against
                          </label>
                          <select
                            value={cfg.v1Id ?? ""}
                            onChange={(e) =>
                              updateFileConfig(cfg.id, (old) => ({
                                ...old,
                                v1Id: e.target.value ? e.target.value : null,
                              }))
                            }
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                          >
                            <option value="">None (no exclusion)</option>
                            {v1Bundles.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.fileName} ({b.rows.length} rows){b.error ? " - ERROR" : ""}
                              </option>
                            ))}
                          </select>
                          <p className="text-[11px] text-gray-600 mt-1">
                            You can keep it <b>None</b> for some files and select a V1 for others.
                          </p>
                        </div>

                        <label className="text-[11px] text-gray-700 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={cfg.strictMatchGameDraw}
                            onChange={(e) =>
                              updateFileConfig(cfg.id, (old) => ({
                                ...old,
                                strictMatchGameDraw: e.target.checked,
                              }))
                            }
                          />
                          Strict match Dealer + Game + Draw (only if your V1 includes Game/Draw)
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={isLoading || fileConfigs.length === 0}
            className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-60"
          >
            {isLoading ? "Processing returns..." : "Build structured return table"}
          </button>
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
            Upload return files, confirm auto-detected game, optionally select a V1 exclusion per file, then build the structured Excel.
          </p>
        )}
      </div>
    </main>
  );
}

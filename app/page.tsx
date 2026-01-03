// app/page.tsx
"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import * as XLSX from "xlsx";

import {
  buildStructuredRows,
  renderCell,
  trimBarcodeNumber,
  toNumber,
} from "./lib/erpTransformer";

import type {
  StructuredRow,
  StructuredRowInternal,
  Cell,
  BreakingSegment,
} from "./lib/erpTransformer";

import {
  UploadedFileRecord,
  saveUploadedFile,
  listUploadedFilesByDate,
  deleteUploadedFile,
} from "./lib/uploadService";

import DealerAliasEditor from "./components/DealerAliasEditor";
import MasterDealerEditor from "./components/MasterDealerEditor";

import { OFFICIAL_GAMES, suggestGameFromFileName } from "./lib/gameAutoSelect";

// Per-file available block for today’s stock
type AvailabilityBlock = {
  id: string;
  from: string; // UI text
  to: string; // UI text
};

// Each uploaded file has its own config
type FileConfig = {
  id: string;
  file: File;

  // Selected game (OFFICIAL CODE, e.g., "SFT")
  gameId: string;

  // Draw date override
  drawDate: string; // YYYY-MM-DD

  // Trim first N digits from barcodes (ERP + blocks)
  trimDigits: number;

  // Auto-detect safety
  autoDetectedGameId: string | null;
  autoDetectNote: string | null;
  autoDetectStatus: "ok" | "mismatch_day" | "ambiguous" | "not_found";

  // Available blocks (FROM–TO)
  blocks: AvailabilityBlock[];
  blockDraftFrom: string;
  blockDraftTo: string;

  // Gap filling behaviour
  enableGapFill: boolean;

  validationWarning: string | null;
};

type UiWarning = {
  fileId: string;
  fileName: string;
  messages: string[];
};

// Utility: today as YYYY-MM-DD (local)
function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Build a merged, sorted list of availability segments from the UI blocks (trim-aware)
function buildAvailabilitySegments(
  blocks: AvailabilityBlock[],
  trimDigits: number
): BreakingSegment[] {
  const segs: BreakingSegment[] = [];

  for (const b of blocks) {
    const fromNumRaw = toNumber(b.from as Cell);
    const toNumRaw = toNumber(b.to as Cell);

    if (fromNumRaw !== null && toNumRaw !== null) {
      const fromNum = trimBarcodeNumber(fromNumRaw, trimDigits);
      const toNum = trimBarcodeNumber(toNumRaw, trimDigits);

      if (fromNum !== null && toNum !== null && fromNum <= toNum) {
        segs.push({ start: fromNum, end: toNum });
      }
    }
  }

  segs.sort((a, b) => a.start - b.start);
  return segs;
}

function formatRange(a: number, b: number): string {
  return `${a}–${b}`;
}

// Validation 1: Overlap between different dealers (needs INTERNAL rows with To)
function detectDealerOverlaps(rows: StructuredRowInternal[]): string[] {
  const sorted = [...rows].sort((a, b) => a.From - b.From || a.To - b.To);

  const msgs: string[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];

    if (cur.From <= prev.To && cur.DealerCode !== prev.DealerCode) {
      const overlapFrom = Math.max(cur.From, prev.From);
      const overlapTo = Math.min(cur.To, prev.To);

      msgs.push(
        `Range conflict: Dealer ${prev.DealerCode} (${formatRange(
          prev.From,
          prev.To
        )}) overlaps Dealer ${cur.DealerCode} (${formatRange(
          cur.From,
          cur.To
        )}) at ${formatRange(overlapFrom, overlapTo)}.`
      );
    }
  }

  return msgs;
}

// Simple validation: check blocks that have partial data or FROM>TO
function recalcValidationBlocks(blocks: AvailabilityBlock[]): string | null {
  for (const b of blocks) {
    const hasFrom = !!b.from.trim();
    const hasTo = !!b.to.trim();

    if (hasFrom !== hasTo) {
      return `Block with FROM "${b.from}" and TO "${b.to}" is incomplete. Both are required or leave both empty.`;
    }

    if (hasFrom && hasTo) {
      const fromNum = toNumber(b.from as Cell);
      const toNum = toNumber(b.to as Cell);

      if (fromNum === null || toNum === null) {
        return `Block "${b.from}–${b.to}" must be numeric barcodes.`;
      }
      if (fromNum > toNum) {
        return `Block "${b.from}–${b.to}" has FROM greater than TO.`;
      }
    }
  }
  return null;
}

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<UiWarning[]>([]);

  // Business date / upload date selection
  const [selectedDate, setSelectedDate] = useState<string>(todayKey());

  // Preview of one selected file (on-demand)
  const [previewTable, setPreviewTable] = useState<Cell[][]>([]);
  const [previewLabel, setPreviewLabel] = useState<string>("");

  // Combined VIEW rows for all files (NO To)
  const [structured, setStructured] = useState<StructuredRow[]>([]);
  const [downloadBlob, setDownloadBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState<string>("Structured.xlsx");

  // Uploaded files + per-file config (for current local run)
  const [fileConfigs, setFileConfigs] = useState<FileConfig[]>([]);

  // Saved uploads (history) for the selected date
  const [uploads, setUploads] = useState<UploadedFileRecord[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsError, setUploadsError] = useState<string | null>(null);

  // Small state flags for per-item operations
  const [savingFileId, setSavingFileId] = useState<string | null>(null);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);

  // ------------- FileConfig update helper -------------
  function updateFileConfig(
    cfgId: string,
    updater: (oldCfg: FileConfig) => FileConfig
  ) {
    setFileConfigs((prev) =>
      prev.map((cfg) => {
        if (cfg.id !== cfgId) return cfg;
        const updated = updater(cfg);
        const warning = recalcValidationBlocks(updated.blocks);
        return { ...updated, validationWarning: warning };
      })
    );
  }

  // ------------- Load uploads for selected date -------------
  async function loadUploads(dateKey: string) {
    if (!dateKey) return;
    setUploadsError(null);
    setUploadsLoading(true);
    try {
      const list = await listUploadedFilesByDate(dateKey);
      setUploads(list);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading uploaded files.";
      setUploadsError(msg);
      setUploads([]);
    } finally {
      setUploadsLoading(false);
    }
  }

  // ------------- Apply auto-detection (NO manual selection) -------------
  function applyAutoDetection(dateKey: string, configs: FileConfig[]): FileConfig[] {
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

      // ambiguous / not_found → block
      return {
        ...cfg,
        gameId: "",
        autoDetectedGameId: null,
        autoDetectNote: s.note,
        autoDetectStatus: s.status,
      };
    });
  }

  // ------------- Initial load -------------
  useEffect(() => {
    void loadUploads(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------- Re-run auto-detection when date changes -------------
  useEffect(() => {
    if (fileConfigs.length === 0) return;
    setFileConfigs((prev) => applyAutoDetection(selectedDate, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // ------------- File selection -------------
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;

    if (!files || files.length === 0) {
      setFileConfigs([]);
      setPreviewTable([]);
      setPreviewLabel("");
      setStructured([]);
      setDownloadBlob(null);
      setError(null);
      return;
    }

    const now = Date.now();
    const list: FileConfig[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];

      list.push({
        id: `${f.name}-${i}-${now}`,
        file: f,

        gameId: "",
        drawDate: selectedDate,

        trimDigits: 0, // default

        autoDetectedGameId: null,
        autoDetectNote: null,
        autoDetectStatus: "not_found",

        blocks: [{ id: `block-1-${i}-${now}`, from: "", to: "" }],
        blockDraftFrom: "",
        blockDraftTo: "",
        enableGapFill: true,
        validationWarning: null,
      });
    }

    setFileConfigs(applyAutoDetection(selectedDate, list));
    setPreviewTable([]);
    setPreviewLabel("");
    setStructured([]);
    setDownloadBlob(null);
    setError(null);
  }

  // ------------- On-demand raw preview for a single file -------------
  async function handlePreviewFile(cfgId: string) {
    const cfg = fileConfigs.find((f) => f.id === cfgId);
    if (!cfg) return;

    try {
      const arrayBuffer = await cfg.file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      const rawData = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
      }) as Cell[][];

      const maxCols = rawData.reduce(
        (max, row) => (row.length > max ? row.length : max),
        0
      );

      const normalized: Cell[][] = rawData.map((row) => {
        const newRow: Cell[] = new Array(maxCols).fill("");
        for (let i = 0; i < row.length; i++) newRow[i] = row[i];
        return newRow;
      });

      setPreviewTable(normalized);
      setPreviewLabel(cfg.file.name);
    } catch (err) {
      console.error("Preview error:", err);
      setPreviewTable([]);
      setPreviewLabel("");
    }
  }

  // ------------- Save a file to Firebase (Storage + Firestore) -------------
  async function handleSaveFile(cfgId: string) {
    const cfg = fileConfigs.find((f) => f.id === cfgId);
    if (!cfg) return;

    if (!selectedDate) {
      setError("Please pick a business date at the top before saving files.");
      return;
    }

    if (cfg.autoDetectStatus !== "ok") {
      setError(
        `Cannot save "${cfg.file.name}": ${cfg.autoDetectNote || "Auto-detection failed."}`
      );
      return;
    }

    if (!cfg.gameId) {
      setError(`Game not set for file: ${cfg.file.name}`);
      return;
    }

    try {
      setError(null);
      setSavingFileId(cfg.id);

      await saveUploadedFile(cfg.file, cfg.gameId, cfg.gameId, selectedDate);

      await loadUploads(selectedDate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving file to Firebase.";
      setError(msg);
    } finally {
      setSavingFileId(null);
    }
  }

  // ------------- Delete an uploaded record -------------
  async function handleDeleteUpload(record: UploadedFileRecord) {
    try {
      setDeletingUploadId(record.id);
      await deleteUploadedFile(record);
      await loadUploads(selectedDate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error deleting uploaded file.";
      setUploadsError(msg);
    } finally {
      setDeletingUploadId(null);
    }
  }

  // ------------- Submit / Process files → structured table -------------
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setError(null);
    setStructured([]);
    setDownloadBlob(null);

    if (fileConfigs.length === 0) {
      setError("Please select at least one ERP file (.xls or .xlsx).");
      return;
    }

    for (const cfg of fileConfigs) {
      if (cfg.autoDetectStatus !== "ok") {
        setError(
          `Fix file "${cfg.file.name}": ${cfg.autoDetectNote || "Auto-detection failed."}`
        );
        return;
      }
      if (!cfg.gameId) {
        setError(`Game not set for file: ${cfg.file.name}`);
        return;
      }
      if (!cfg.drawDate) {
        setError(`Draw date not set for file: ${cfg.file.name}`);
        return;
      }
      if (cfg.validationWarning) {
        setError(
          `Please fix availability blocks for file: ${cfg.file.name} → ${cfg.validationWarning}`
        );
        return;
      }
    }

    setIsLoading(true);

    try {
      const allStructuredInternal: StructuredRowInternal[] = [];
      const allWarnings: UiWarning[] = [];

      for (const cfg of fileConfigs) {
        const file = cfg.file;
        const gameNameOverride = cfg.gameId;

        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const rawData = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
        }) as Cell[][];

        const maxCols = rawData.reduce(
          (max, row) => (row.length > max ? row.length : max),
          0
        );

        const normalized: Cell[][] = rawData.map((row) => {
          const newRow: Cell[] = new Array(maxCols).fill("");
          for (let i = 0; i < row.length; i++) newRow[i] = row[i];
          return newRow;
        });

        // Trim-aware segments from UI blocks
        const availabilitySegments = buildAvailabilitySegments(cfg.blocks, cfg.trimDigits);

        const msgs: string[] = [];

        // Build internal rows (with To)
        const structuredRowsForFile = await buildStructuredRows(
          normalized,
          availabilitySegments,
          gameNameOverride,
          cfg.enableGapFill,
          cfg.drawDate,
          cfg.trimDigits
        );

        // Only overlap warnings remain
        msgs.push(...detectDealerOverlaps(structuredRowsForFile));

        if (msgs.length > 0) {
          allWarnings.push({
            fileId: cfg.id,
            fileName: cfg.file.name,
            messages: msgs,
          });
        }

        allStructuredInternal.push(...structuredRowsForFile);
      }

      // INTERNAL → VIEW rows (no To)
      const allStructuredView: StructuredRow[] = allStructuredInternal.map((r) => ({
        DealerCode: r.DealerCode,
        Game: r.Game,
        Draw: r.Draw,
        From: r.From,
        Qty: r.Qty,
      }));

      setStructured(allStructuredView);
      setWarnings(allWarnings);

      if (allWarnings.length > 0) {
        const text = allWarnings
          .map((w) => `File: ${w.fileName}\n- ${w.messages.join("\n- ")}`)
          .join("\n\n");

        alert(`Warnings detected:\n\n${text}`);
      }

      if (allStructuredView.length === 0) {
        setError("No dealer rows / gaps detected in the uploaded files.");
      } else {
        const ws = XLSX.utils.json_to_sheet(allStructuredView);
        const newWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWb, ws, "Structured");

        const wbout = XLSX.write(newWb, { bookType: "xlsx", type: "array" });
        const blob = new Blob([wbout], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

        setDownloadBlob(blob);
      }

      setFileName("AllGames_structured.xlsx");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error while processing the files.";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  // ------------- Download -------------
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

  const totalQty = structured.reduce((sum, r) => sum + (r.Qty || 0), 0);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-900">
      <div className="w-full max-w-6xl p-6 rounded-lg bg-white shadow border border-gray-300 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">
            ERP Summary → Structured Dealer Table (multi-game, per-file ranges)
          </h1>
         <Link
      href="/returns"
      className="px-3 py-1.5 rounded bg-purple-700 hover:bg-purple-800 text-white text-xs font-medium shadow"
    >
      Go to Returns Page
    </Link>

          {warnings.length > 0 && (
            <div className="border border-amber-300 bg-amber-50 rounded p-3 text-[12px] text-amber-900">
              <div className="font-medium mb-1">Warnings</div>
              <div className="space-y-2">
                {warnings.map((w) => (
                  <div key={w.fileId}>
                    <div className="font-medium">{w.fileName}</div>
                    <ul className="list-disc pl-5">
                      {w.messages.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Business Date + Upload History */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-gray-800">Business date / upload date</h2>
              <p className="text-[11px] text-gray-600">
                Files saved to Firebase are tagged with this date and can be fetched or deleted later.
              </p>
            </div>

            <div>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedDate(v);
                  void loadUploads(v);
                }}
                className="rounded border border-gray-300 px-2 py-1 text-sm bg-white"
              />
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-2 bg-white">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-800">
                Uploaded ERP files for {selectedDate}
              </span>
              {uploadsLoading && <span className="text-[11px] text-gray-500">Loading…</span>}
            </div>

            {uploadsError && <p className="text-[11px] text-red-600 mb-1">{uploadsError}</p>}

            {uploads.length === 0 && !uploadsLoading && !uploadsError && (
              <p className="text-[11px] text-gray-500">No ERP files saved for this date.</p>
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

        {/* Dealer Configuration */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <h2 className="text-sm font-medium text-gray-800">Dealer Mapping Configuration</h2>
          <p className="text-[11px] text-gray-600">
            Configure how ERP dealer codes are normalized. The master dealer receives credit, alias dealers are mapped to it.
          </p>
          <MasterDealerEditor />
          <DealerAliasEditor />
        </section>

        {/* Upload + per-file config */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-4">
            <div>
              <label className="block text-sm mb-1" htmlFor="file">
                Upload ERP Summary files (.xls or .xlsx)
              </label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".xls,.xlsx"
                multiple
                onChange={handleFileChange}
                className="w-full text-sm"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                Select multiple files (each file = one game). Game will auto-detect from file name and selected business date.
              </p>
            </div>

            {fileConfigs.length > 0 && (
              <div className="space-y-3">
                {fileConfigs.map((cfg, index) => {
                  const canSave =
                    !!selectedDate &&
                    cfg.autoDetectStatus === "ok" &&
                    !!cfg.gameId &&
                    savingFileId !== cfg.id;

                  return (
                    <div key={cfg.id} className="border border-gray-300 rounded-lg p-3 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-gray-800">
                          File {index + 1}: {cfg.file.name}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-gray-500">
                          <span>Size: {Math.round(cfg.file.size / 1024)} KB</span>

                          <button
                            type="button"
                            onClick={() => void handlePreviewFile(cfg.id)}
                            className="px-2 py-0.5 rounded border border-gray-300 bg-gray-100 hover:bg-gray-200"
                          >
                            Preview ERP rows
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

                      {/* Draw date + Trim */}
                      <div className="space-y-2">
                        <div>
                          <label className="block text-xs mb-1 text-gray-700">
                            Draw date for this file
                          </label>
                          <input
                            type="date"
                            value={cfg.drawDate}
                            onChange={(e) =>
                              updateFileConfig(cfg.id, (old) => ({
                                ...old,
                                drawDate: e.target.value,
                              }))
                            }
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                          />
                          <p className="text-[11px] text-gray-500 mt-1">
                            New ERP report has no DRAW DATE field. This selected date will be used in the output.
                          </p>
                        </div>

                        <div>
                          <label className="block text-xs mb-1 text-gray-700">
                            Trim prefix digits (ERP + Available blocks)
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
                          <p className="text-[11px] text-gray-500 mt-1">
                            Example: Trim=2 turns &quot;324040404&quot; → &quot;4040404&quot;.
                          </p>
                        </div>
                      </div>

                      {/* Game select (DISABLED: no manual selection) */}
                      <div>
                        <select
                          value={cfg.gameId}
                          disabled
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-gray-100 cursor-not-allowed"
                        >
                          <option value="">-- Auto selected --</option>
                          {OFFICIAL_GAMES.map((g: (typeof OFFICIAL_GAMES)[0]) => (
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

                      {/* Gap fill toggle */}
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          id={`gap-${cfg.id}`}
                          type="checkbox"
                          checked={cfg.enableGapFill}
                          onChange={(e) =>
                            updateFileConfig(cfg.id, (old) => ({
                              ...old,
                              enableGapFill: e.target.checked,
                            }))
                          }
                          className="h-3 w-3"
                        />
                        <label htmlFor={`gap-${cfg.id}`} className="text-[11px] text-gray-800">
                          Enable master gap filling inside available blocks (rows with &quot;#&quot; will create MASTER ranges).
                        </label>
                      </div>

                      {/* Availability blocks */}
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-800">
                            Available stock blocks (FROM–TO)
                          </span>
                          <span className="text-[11px] text-gray-500">
                            Enter original values; Trim applies automatically.
                          </span>
                        </div>

                        {/* Existing blocks list */}
                        <div className="space-y-1">
                          {cfg.blocks.map((b, idx) => (
                            <div key={b.id} className="flex items-center gap-2 text-[11px]">
                              <span className="w-5 text-right">{idx + 1}.</span>

                              <input
                                type="text"
                                value={b.from}
                                onChange={(e) =>
                                  updateFileConfig(cfg.id, (old) => ({
                                    ...old,
                                    blocks: old.blocks.map((bb) =>
                                      bb.id === b.id ? { ...bb, from: e.target.value } : bb
                                    ),
                                  }))
                                }
                                className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs bg-white"
                                placeholder="FROM barcode"
                              />

                              <span className="text-gray-600">→</span>

                              <input
                                type="text"
                                value={b.to}
                                onChange={(e) =>
                                  updateFileConfig(cfg.id, (old) => ({
                                    ...old,
                                    blocks: old.blocks.map((bb) =>
                                      bb.id === b.id ? { ...bb, to: e.target.value } : bb
                                    ),
                                  }))
                                }
                                className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs bg-white"
                                placeholder="TO barcode"
                              />

                              {cfg.blocks.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateFileConfig(cfg.id, (old) => ({
                                      ...old,
                                      blocks: old.blocks.filter((bb) => bb.id !== b.id),
                                    }))
                                  }
                                  className="px-2 py-0.5 rounded border border-gray-300 bg-white"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* New block draft row */}
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="w-5 text-right">+</span>

                          <input
                            type="text"
                            value={cfg.blockDraftFrom}
                            onChange={(e) =>
                              updateFileConfig(cfg.id, (old) => ({
                                ...old,
                                blockDraftFrom: e.target.value,
                              }))
                            }
                            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs bg-white"
                            placeholder="FROM barcode"
                          />

                          <span className="text-gray-600">→</span>

                          <input
                            type="text"
                            value={cfg.blockDraftTo}
                            onChange={(e) =>
                              updateFileConfig(cfg.id, (old) => ({
                                ...old,
                                blockDraftTo: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const from = cfg.blockDraftFrom.trim();
                                const to = cfg.blockDraftTo.trim();
                                if (!from || !to) return;

                                const newId = `block-${Date.now()}-${Math.random()}`;

                                updateFileConfig(cfg.id, (old) => ({
                                  ...old,
                                  blocks: [...old.blocks, { id: newId, from, to }],
                                  blockDraftFrom: "",
                                  blockDraftTo: "",
                                }));
                              }
                            }}
                            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs bg-white"
                            placeholder="TO barcode"
                          />

                          <button
                            type="button"
                            onClick={() => {
                              const from = cfg.blockDraftFrom.trim();
                              const to = cfg.blockDraftTo.trim();
                              if (!from || !to) return;

                              const newId = `block-${Date.now()}-${Math.random()}`;

                              updateFileConfig(cfg.id, (old) => ({
                                ...old,
                                blocks: [...old.blocks, { id: newId, from, to }],
                                blockDraftFrom: "",
                                blockDraftTo: "",
                              }));
                            }}
                            className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium"
                          >
                            Add block
                          </button>
                        </div>

                        {cfg.validationWarning && (
                          <p className="mt-1 text-[11px] text-amber-700">{cfg.validationWarning}</p>
                        )}
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
            disabled={isLoading}
            className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-60"
          >
            {isLoading ? "Processing..." : "Build combined structured table"}
          </button>
        </form>

        {/* Raw preview of selected file */}
        {previewTable.length > 0 && (
          <section className="space-y-2">
            <div className="text-sm text-gray-800">
              <span className="font-medium">Raw ERP summary preview</span>
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

        {/* Combined structured table + download */}
        {structured.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-800">
                <span className="font-medium">
                  Combined structured table (DealerCode / Game / Draw / From / Qty)
                </span>
                <span className="ml-2 text-gray-600">
                  ({structured.length} rows, total qty: {totalQty})
                </span>
              </div>

              <button
                type="button"
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
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {structured.map((row, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-100"}>
                        <td className="px-3 py-1.5 whitespace-nowrap">{row.DealerCode}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{row.Game}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{row.Draw}</td>
                        <td className="px-3 py-1.5 text-right">{row.Qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {previewTable.length === 0 && structured.length === 0 && !isLoading && !error && (
          <p className="text-xs text-gray-600">
            Upload one or more ERP Summary files, define available stock blocks and gap behaviour per file, then build a
            single combined structured Excel for your Power Automate flow.
          </p>
        )}
      </div>
    </main>
  );
}

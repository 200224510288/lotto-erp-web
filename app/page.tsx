// app/page.tsx
"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import {
  buildStructuredRows,
  Cell,
  StructuredRow,
  renderCell,
  toNumber,
  BreakingSegment,
} from "./lib/erpTransformer";

import { GameDef, fetchGames } from "./lib/gameService";
import { GameAdmin } from "./components/GameAdmin";

import {
  UploadedFileRecord,
  saveUploadedFile,
  listUploadedFilesByDate,
  deleteUploadedFile,
} from "./lib/uploadService";

import DealerAliasEditor from "./components/DealerAliasEditor";
import MasterDealerEditor from "./components/MasterDealerEditor";

import {
  ERP_GAME_MAP,
  detectERPCodeFromFileNameForDay,
  getDayFromDate,
  mapERPToOfficial,
} from "./lib/gameAutoMap";

// ---------------- Types ----------------

type AvailabilityBlock = {
  id: string;
  from: string;
  to: string;
};

type FileSource =
  | { kind: "local"; file: File }
  | {
      kind: "firebase";
      downloadUrl: string;
      fileName: string;
      size?: number;
      gameId?: string;
      gameName?: string;
    };

type FileConfig = {
  id: string;
  source: FileSource;

  gameId: string; // Firestore Game doc id
  autoMapped: boolean; // true if set by filename mapping
  validationWarning: string | null;

  // NEW: keep detection results (so we can remap after games load)
  detectedDay: keyof typeof ERP_GAME_MAP;
  detectedERP: string | null;
  detectedOfficial: string | null;

  blocks: AvailabilityBlock[];
  blockDraftFrom: string;
  blockDraftTo: string;

  enableGapFill: boolean;
};

// ---------------- Utils ----------------

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fileDisplayName(src: FileSource): string {
  return src.kind === "local" ? src.file.name : src.fileName;
}

function fileDisplaySizeKb(src: FileSource): number {
  if (src.kind === "local") return Math.round(src.file.size / 1024);
  return Math.round((src.size || 0) / 1024);
}

async function getArrayBufferFromSource(source: FileSource): Promise<ArrayBuffer> {
  if (source.kind === "local") return await source.file.arrayBuffer();

  const res = await fetch(source.downloadUrl);
  if (!res.ok) throw new Error(`Failed to fetch uploaded file. HTTP ${res.status}`);
  const blob = await res.blob();
  return await blob.arrayBuffer();
}

function buildAvailabilitySegments(blocks: AvailabilityBlock[]): BreakingSegment[] {
  const raw: BreakingSegment[] = [];
  for (const b of blocks) {
    const fromNum = toNumber(b.from as Cell);
    const toNum = toNumber(b.to as Cell);
    if (fromNum !== null && toNum !== null && fromNum <= toNum) {
      raw.push({ start: fromNum, end: toNum });
    }
  }

  if (raw.length === 0) return [];

  raw.sort((a, b) => a.start - b.start);

  const merged: BreakingSegment[] = [];
  for (const seg of raw) {
    if (merged.length === 0) {
      merged.push({ ...seg });
      continue;
    }
    const last = merged[merged.length - 1];
    if (seg.start <= last.end + 1) {
      last.end = Math.max(last.end, seg.end);
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

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

/**
 * Auto-pick gameId based on:
 * fileName -> ERP (day-aware) -> Official -> Firestore games
 *
 * IMPORTANT: Your Firestore "games" has:
 *   name: "SFT", "JFR" etc
 *   shortCode: optional (recommended to store official codes here too)
 *
 * Matching order:
 * 1) games.shortCode == official
 * 2) games.name == official
 */
function autoPickGameIdFromFileName(
  fileName: string,
  businessDate: string,
  games: GameDef[]
): {
  gameId: string;
  mapped: boolean;
  official?: string;
  erp?: string;
  day?: keyof typeof ERP_GAME_MAP;
  reason?: string;
} {
  if (!businessDate) return { gameId: "", mapped: false, reason: "No date selected" };

  const day = getDayFromDate(businessDate);
  const erp = detectERPCodeFromFileNameForDay(fileName, day);
  if (!erp) return { gameId: "", mapped: false, day, reason: `ERP code not detected for ${day}` };

  const official = mapERPToOfficial(day, erp);
  if (!official) return { gameId: "", mapped: false, day, erp, reason: `No mapping for ${day}/${erp}` };

  const OFF = official.toUpperCase();

  // Match by shortCode OR by name (both case-insensitive)
  const found = games.find((g) => {
    const sc = (g.shortCode || "").toUpperCase();
    const nm = (g.name || "").toUpperCase();
    return sc === OFF || nm === OFF;
  });

  if (!found) {
    return {
      gameId: "",
      mapped: false,
      day,
      erp,
      official,
      reason: `Game Master missing (${official}) in shortCode or name`,
    };
  }

  return { gameId: found.id, mapped: true, day, erp, official };
}
// ---------------- Component ----------------

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string>(todayKey());

  const [previewTable, setPreviewTable] = useState<Cell[][]>([]);
  const [previewLabel, setPreviewLabel] = useState<string>("");

  const [structured, setStructured] = useState<StructuredRow[]>([]);
  const [downloadBlob, setDownloadBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState<string>("AllGames_structured.xlsx");

  const [games, setGames] = useState<GameDef[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState<string | null>(null);

  const [fileConfigs, setFileConfigs] = useState<FileConfig[]>([]);

  const [uploads, setUploads] = useState<UploadedFileRecord[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsError, setUploadsError] = useState<string | null>(null);

  const [savingFileId, setSavingFileId] = useState<string | null>(null);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);

  // -------- helpers --------

  function updateFileConfig(cfgId: string, updater: (oldCfg: FileConfig) => FileConfig) {
    setFileConfigs((prev) =>
      prev.map((cfg) => {
        if (cfg.id !== cfgId) return cfg;
        const updated = updater(cfg);
        const warning = recalcValidationBlocks(updated.blocks);
        return { ...updated, validationWarning: warning };
      })
    );
  }

  async function loadGames() {
    setGamesError(null);
    setGamesLoading(true);
    try {
      const list = await fetchGames();
      setGames(list);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading games.";
      setGamesError(msg);
    } finally {
      setGamesLoading(false);
    }
  }

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

  useEffect(() => {
    void loadGames();
    void loadUploads(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Critical: re-apply mapping once games arrive or date changes.
   * Rule:
   * - If user manually chose a game (autoMapped=false AND gameId not empty), do NOT override.
   * - Otherwise, try to map again.
   */
  useEffect(() => {
    if (games.length === 0) return;
    if (fileConfigs.length === 0) return;

    setFileConfigs((prev) =>
      prev.map((cfg) => {
        const name = fileDisplayName(cfg.source);

        const userManuallyChose = !cfg.autoMapped && !!cfg.gameId;
        if (userManuallyChose) return cfg;

        const pick = autoPickGameIdFromFileName(name, selectedDate, games);
        if (!pick.mapped) {
          // keep as-is, but mark not auto
          return { ...cfg, autoMapped: false };
        }
        return { ...cfg, gameId: pick.gameId, autoMapped: true };
      })
    );
  }, [games, selectedDate]); // intentional

  // -------- local file selection (multi-upload) --------

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
      const id = `${f.name}-${i}-${now}`;

      const pick = games.length
        ? autoPickGameIdFromFileName(f.name, selectedDate, games)
        : { gameId: "", mapped: false };

      list.push({
        id,
        source: { kind: "local", file: f },
        gameId: pick.gameId || "",
        autoMapped: !!pick.mapped,
        validationWarning: null,
        detectedDay: pick.day || "Mon",
        detectedERP: pick.erp || null,
        detectedOfficial: pick.official || null,

        blocks: [{ id: `block-1-${id}`, from: "", to: "" }],
        blockDraftFrom: "",
        blockDraftTo: "",
        enableGapFill: true,
      });
    }

    setFileConfigs(list);
    setPreviewTable([]);
    setPreviewLabel("");
    setStructured([]);
    setDownloadBlob(null);
    setError(null);

    // allow selecting same file again
    e.target.value = "";
  }

  // -------- add saved upload to build (no re-upload) --------

  function addUploadedToConfigs(u: UploadedFileRecord) {
    const now = Date.now();
    const id = `firebase-${u.id}-${now}`;

    const src: FileSource = {
      kind: "firebase",
      downloadUrl: u.downloadUrl,
      fileName: u.fileName,
      size: u.size,
      gameId: u.gameId,
      gameName: u.gameName,
    };

    // Prefer saved gameId; if blank, map from filename
    let gameId = u.gameId || "";
    let autoMapped = !!u.gameId;
    let detectedDay: keyof typeof ERP_GAME_MAP = "Mon";
    let detectedERP: string | null = null;
    let detectedOfficial: string | null = null;

    if (!gameId && games.length) {
      const pick = autoPickGameIdFromFileName(u.fileName, selectedDate, games);
      gameId = pick.gameId || "";
      autoMapped = !!pick.mapped;
      detectedDay = pick.day || "Mon";
      detectedERP = pick.erp || null;
      detectedOfficial = pick.official || null;
    } else {
      const day = getDayFromDate(selectedDate);
      const erp = detectERPCodeFromFileNameForDay(u.fileName, day);
      const official = erp ? mapERPToOfficial(day, erp) : null;
      detectedDay = day;
      detectedERP = erp || null;
      detectedOfficial = official || null;
    }

    setFileConfigs((prev) => [
      ...prev,
      {
        id,
        source: src,
        gameId,
        autoMapped,
        validationWarning: null,
        detectedDay,
        detectedERP,
        detectedOfficial,
        blocks: [{ id: `block-1-${id}`, from: "", to: "" }],
        blockDraftFrom: "",
        blockDraftTo: "",
        enableGapFill: true,
      } as FileConfig,
    ]);

    setStructured([]);
    setDownloadBlob(null);
    setError(null);
  }

  // -------- preview (local or firebase) --------

  async function handlePreviewFile(cfgId: string) {
    const cfg = fileConfigs.find((f) => f.id === cfgId);
    if (!cfg) return;

    try {
      const arrayBuffer = await getArrayBufferFromSource(cfg.source);

      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as Cell[][];

      const maxCols = rawData.reduce((max, row) => (row.length > max ? row.length : max), 0);

      const normalized: Cell[][] = rawData.map((row) => {
        const newRow: Cell[] = new Array(maxCols).fill("");
        for (let i = 0; i < row.length; i++) newRow[i] = row[i];
        return newRow;
      });

      setPreviewTable(normalized);
      setPreviewLabel(fileDisplayName(cfg.source));
    } catch (err) {
      console.error("Preview error:", err);
      setPreviewTable([]);
      setPreviewLabel("");
    }
  }

  // -------- save local file to firebase --------

  async function handleSaveFile(cfgId: string) {
    const cfg = fileConfigs.find((f) => f.id === cfgId);
    if (!cfg) return;

    if (cfg.source.kind !== "local") {
      setError("This file is already from Firebase.");
      return;
    }

    if (!selectedDate) {
      setError("Please pick a business date at the top before saving files.");
      return;
    }

    if (!cfg.gameId) {
      setError(`Auto-mapping failed. Please select a game for: ${fileDisplayName(cfg.source)}`);
      return;
    }

    const game = games.find((g) => g.id === cfg.gameId);
    const gameName = game?.name ?? "";

    try {
      setError(null);
      setSavingFileId(cfg.id);
      await saveUploadedFile(cfg.source.file, cfg.gameId, gameName, selectedDate);
      await loadUploads(selectedDate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving file to Firebase.";
      setError(msg);
    } finally {
      setSavingFileId(null);
    }
  }

  // -------- delete upload record --------

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

  // -------- build structured table --------

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStructured([]);
    setDownloadBlob(null);

    if (fileConfigs.length === 0) {
      setError("Please select at least one ERP file (upload OR Use from Firebase).");
      return;
    }

    if (games.length === 0) {
      setError("No games loaded. Please define games in the Game Master section first.");
      return;
    }

    for (const cfg of fileConfigs) {
      const name = fileDisplayName(cfg.source);
      if (!cfg.gameId) {
        setError(`Game not set for file: ${name} (auto-map failed or Game Master missing).`);
        return;
      }
      if (cfg.validationWarning) {
        setError(`Fix availability blocks for file: ${name} → ${cfg.validationWarning}`);
        return;
      }
    }

    setIsLoading(true);

    try {
      const allStructured: StructuredRow[] = [];

      for (const cfg of fileConfigs) {
        const game = games.find((g) => g.id === cfg.gameId);
        const gameNameOverride = game?.name ?? "";

        const arrayBuffer = await getArrayBufferFromSource(cfg.source);

        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as Cell[][];

        const maxCols = rawData.reduce((max, row) => (row.length > max ? row.length : max), 0);

        const normalized: Cell[][] = rawData.map((row) => {
          const newRow: Cell[] = new Array(maxCols).fill("");
          for (let i = 0; i < row.length; i++) newRow[i] = row[i];
          return newRow;
        });

        const availabilitySegments = buildAvailabilitySegments(cfg.blocks);

        const structuredRowsForFile = await buildStructuredRows(
          normalized,
          availabilitySegments,
          gameNameOverride,
          cfg.enableGapFill
        );

        allStructured.push(...structuredRowsForFile);
      }

      setStructured(allStructured);

      if (allStructured.length === 0) {
        setError("No dealer rows / gaps detected in the selected files.");
      } else {
        const ws = XLSX.utils.json_to_sheet(allStructured);
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

  const totalQty = useMemo(() => structured.reduce((sum, r) => sum + (r.Qty || 0), 0), [structured]);

  // ---------------- UI ----------------

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-900">
      <div className="w-full max-w-6xl p-6 rounded-lg bg-white shadow border border-gray-300 space-y-6">
        <h1 className="text-xl font-semibold">ERP Summary → Structured Dealer Table</h1>

        <div className="flex justify-end mt-2">
          <Link
            href="/returns"
            className="px-3 py-1.5 rounded bg-purple-700 hover:bg-purple-800 text-white text-xs font-medium shadow"
          >
            Go to Returns Page
          </Link>
        </div>

        {/* Date + Uploads */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-gray-800">Business date / upload date</h2>
              <p className="text-[11px] text-gray-600">
                Files saved to Firebase are tagged with this date. You can click “Use” to process without re-upload.
              </p>
            </div>

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

          <div className="border border-gray-200 rounded-lg p-2 bg-white">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-800">Uploaded ERP files for {selectedDate}</span>
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
                            onClick={() => addUploadedToConfigs(u)}
                            className="text-[11px] px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100 mr-2"
                          >
                            Use
                          </button>

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

                <p className="mt-2 text-[11px] text-gray-600">
                  Tip: Click <b>Use</b> to add a saved file into the build section (no re-upload).
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Game master */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <h2 className="text-sm font-medium text-gray-800">Game Master</h2>
          {gamesLoading && <p className="text-xs text-gray-600">Loading games...</p>}
          {gamesError && <p className="text-xs text-red-600">{gamesError}</p>}
          {!gamesLoading && !gamesError && <GameAdmin games={games} onRefresh={loadGames} />}
        </section>

        {/* Dealer configuration */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <h2 className="text-sm font-medium text-gray-800">Dealer Mapping Configuration</h2>
          <p className="text-[11px] text-gray-600">
            Configure how ERP dealer codes are normalized. Master dealer receives credit; aliases map to it.
          </p>
          <MasterDealerEditor />
          <DealerAliasEditor />
        </section>

        {/* Upload + build */}
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
                Auto-mapping uses filename + selected date: ERP → Official → Game Master (shortCode/name).
              </p>
            </div>

            {fileConfigs.length > 0 && (
              <div className="space-y-3">
                {fileConfigs.map((cfg, index) => {
                  const name = fileDisplayName(cfg.source);
                  const day = getDayFromDate(selectedDate);
                  const erp = detectERPCodeFromFileNameForDay(name, day);
                  const official = erp ? ERP_GAME_MAP?.[day]?.[erp] : null;

                  const canSave =
                    cfg.source.kind === "local" && !!selectedDate && !!cfg.gameId && !savingFileId;

                  return (
                    <div key={cfg.id} className="border border-gray-300 rounded-lg p-3 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-gray-800">
                          File {index + 1}: {name}
                          {cfg.autoMapped && (
                            <span className="ml-2 text-[10px] text-green-700 border border-green-300 bg-green-50 px-2 py-0.5 rounded">
                              auto-mapped
                            </span>
                          )}
                          {cfg.source.kind === "firebase" && (
                            <span className="ml-2 text-[10px] text-indigo-700 border border-indigo-300 bg-indigo-50 px-2 py-0.5 rounded">
                              from Firebase
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-gray-500">
                          <span>Size: {fileDisplaySizeKb(cfg.source)} KB</span>

                          <button
                            type="button"
                            onClick={() => void handlePreviewFile(cfg.id)}
                            className="px-2 py-0.5 rounded border border-gray-300 bg-gray-100 hover:bg-gray-200"
                          >
                            Preview ERP rows
                          </button>

                          {cfg.source.kind === "local" && (
                            <button
                              type="button"
                              onClick={() => void handleSaveFile(cfg.id)}
                              disabled={!canSave || savingFileId === cfg.id}
                              className="px-2 py-0.5 rounded border border-blue-500 bg-blue-50 text-blue-700 disabled:opacity-60"
                            >
                              {savingFileId === cfg.id ? "Saving…" : "Save to Firebase"}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setFileConfigs((prev) => prev.filter((x) => x.id !== cfg.id))}
                            className="px-2 py-0.5 rounded border border-red-300 bg-white text-red-700 hover:bg-red-50"
                          >
                            Remove from build
                          </button>
                        </div>
                      </div>

                      {/* Debug line (helps you confirm auto-map) */}
                      <p className="text-[11px] text-gray-600">
                        Day: <b>{day}</b> | ERP: <b>{erp ?? "-"}</b> | Official: <b>{official ?? "-"}</b>
                      </p>

                      {/* Game select (auto-filled) */}
                      <div>
                        <label className="block text-xs mb-1 text-gray-700">Game for this file</label>
                        <select
                          value={cfg.gameId}
                          onChange={(e) =>
                            updateFileConfig(cfg.id, (old) => ({
                              ...old,
                              gameId: e.target.value,
                              autoMapped: false, // manual override
                            }))
                          }
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                        >
                          <option value="">-- Select game --</option>
                          {games.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name} {g.shortCode ? `(${g.shortCode})` : ""} {g.board ? `- ${g.board}` : ""}
                            </option>
                          ))}
                        </select>

                        <p className="text-[11px] text-gray-500 mt-1">
                          If auto-map fails: ensure Game Master has the official code in <b>shortCode</b> (recommended)
                          or in <b>name</b>.
                        </p>
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
                          Enable master gap filling inside available blocks
                        </label>
                      </div>

                      {/* Availability blocks */}
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-800">Available stock blocks (FROM–TO)</span>
                          <span className="text-[11px] text-gray-500">
                            Add blocks while watching official site stock for this game.
                          </span>
                        </div>

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

                        {/* Add new block */}
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

        {/* Preview */}
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

        {/* Output */}
        {structured.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-800">
                <span className="font-medium">Combined structured table</span>
                <span className="ml-2 text-gray-600">
                  ({structured.length} rows, total qty: {totalQty})
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
      </div>
    </main>
  );
}

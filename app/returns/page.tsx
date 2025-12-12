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
import { GameDef, fetchGames } from "../lib/gameService";
import { GameAdmin } from "../components/GameAdmin";
import MasterDealerEditor from "../components/MasterDealerEditor";
import DealerAliasEditor from "../components/DealerAliasEditor";

import {
  UploadedFileRecord,
  saveUploadedFile,
  listUploadedFilesByDate,
  deleteUploadedFile,
} from "../lib/uploadService";

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type ReturnFileConfig = {
  id: string;
  file: File;
  gameId: string;
  draw: string; // dd/mm/yyyy
  drawDate: string; // yyyy-mm-dd
};

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
 *
 * Expected V1 formats (flexible):
 * - DealerCode | From | To
 * - DealerCode | From | Qty
 * - DealerCode | Game | Draw | From | To
 * - DealerCode | Game | Draw | From | Qty
 *
 * The parser is permissive:
 * - DealerCode is first 5/6 digit found in row
 * - "From" is first >=7 digit found
 * - "To" is second >=7 digit found (if any)
 * - Qty is last small number <=5 digits found (if any)
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
  // Optional: if V1 file contains Game/Draw as plain text cells
  // We’ll take first 2-4 letter token as game and first dd/mm/yyyy as draw if found.
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
    // skip empty-ish rows
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

export default function ReturnsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [businessDate, setBusinessDate] = useState<string>(todayKey());

  const [previewTable, setPreviewTable] = useState<Cell[][]>([]);
  const [previewLabel, setPreviewLabel] = useState<string>("");

  const [structuredReturns, setStructuredReturns] = useState<ReturnRow[]>([]);
  const [downloadBlob, setDownloadBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState<string>("Agent_Returns_structured.xlsx");

  const [games, setGames] = useState<GameDef[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState<string | null>(null);

  // MULTI FILES (like sales)
  const [fileConfigs, setFileConfigs] = useState<ReturnFileConfig[]>([]);

  // User-defined default 2-digit prefix (flexible)
  const [defaultPrefix2, setDefaultPrefix2] = useState<string>("09");

  const [uploads, setUploads] = useState<UploadedFileRecord[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsError, setUploadsError] = useState<string | null>(null);
  const [savingFileId, setSavingFileId] = useState<string | null>(null);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);

  // V1 exclusion
  const [v1File, setV1File] = useState<File | null>(null);
  const [v1Existing, setV1Existing] = useState<V1ExistingRow[]>([]);
  const [v1Error, setV1Error] = useState<string | null>(null);
  const [strictMatchGameDraw, setStrictMatchGameDraw] = useState<boolean>(false);

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
    void loadUploads(businessDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFileConfig(id: string, updater: (old: ReturnFileConfig) => ReturnFileConfig) {
    setFileConfigs((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
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
        draw: "",
        drawDate: "",
      });
    }

    setFileConfigs(list);
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

    if (!cfg.gameId) {
      setError(`Please select a game for file: ${cfg.file.name} before saving.`);
      return;
    }

    const game = games.find((g) => g.id === cfg.gameId);
    const gameName = game?.name ?? "";

    try {
      setError(null);
      setSavingFileId(cfg.id);
      await saveUploadedFile(cfg.file, cfg.gameId, gameName, businessDate);
      await loadUploads(businessDate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving return file to Firebase.";
      setError(msg);
    } finally {
      setSavingFileId(null);
    }
  }

  async function handleDeleteUpload(record: UploadedFileRecord) {
    try {
      setDeletingUploadId(record.id);
      await deleteUploadedFile(record);
      await loadUploads(businessDate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error deleting uploaded file.";
      setUploadsError(msg);
    } finally {
      setDeletingUploadId(null);
    }
  }

  async function handleV1FileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setV1File(file);
    setV1Existing([]);
    setV1Error(null);

    if (!file) return;

    try {
      const sheet = await readFirstSheet(file);
      const parsed = parseV1FromSheet(sheet);
      setV1Existing(parsed);

      if (parsed.length === 0) {
        setV1Error("V1 file loaded, but no valid V1 rows detected. Check columns (DealerCode + From + To/Qty).");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to read V1 file.";
      setV1Error(msg);
      setV1Existing([]);
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
      if (!cfg.gameId) {
        setError(`Please select the Game for return file: ${cfg.file.name}`);
        return;
      }
      if (!cfg.drawDate.trim()) {
        setError(`Please pick the Draw date for return file: ${cfg.file.name}`);
        return;
      }
    }

    // sanitize prefix: keep only 2 digits
    const prefix2 = (defaultPrefix2 || "").replace(/[^\d]/g, "").slice(0, 2);

    setIsLoading(true);

    try {
      const allRows: ReturnRow[] = [];

      for (const cfg of fileConfigs) {
        const game = games.find((g) => g.id === cfg.gameId);
        const gameNameOverride = game?.name ?? "";

        const normalized = await readFirstSheet(cfg.file);

        // IMPORTANT: pass v1Existing + strict option
        const rows = await buildReturnRows(
          normalized,
          gameNameOverride,
          cfg.draw,
          prefix2,
          v1Existing,
          { strictMatchGameDraw }
        );

        allRows.push(...rows);
      }

      setStructuredReturns(allRows);

      if (allRows.length === 0) {
        setError(
          v1Existing.length > 0
            ? "No valid return rows after applying V1 exclusion (everything was already in V1)."
            : "No valid return rows detected. Please check the Excel format."
        );
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

  const v1Status = useMemo(() => {
    if (!v1File) return "No V1 file loaded (no exclusion applied).";
    if (v1Error) return `V1 file loaded but error: ${v1Error}`;
    return `V1 loaded: ${v1Existing.length} rows (exclusion ON).`;
  }, [v1File, v1Error, v1Existing.length]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-900">
      <div className="w-full max-w-6xl p-6 rounded-lg bg-white shadow border border-gray-300 space-y-6">
        <h1 className="text-xl font-semibold">Agent Return Report → Structured Return Table</h1>

        <div className="flex justify-end mt-2">
          <Link
            href="/"
            className="px-3 py-1.5 rounded bg-purple-700 hover:bg-purple-800 text-white text-xs font-medium shadow"
          >
            Go to Sales Page
          </Link>
        </div>

        {/* Business Date + Upload History */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-gray-800">Business date / upload date</h2>
              <p className="text-[11px] text-gray-600">
                Return files saved to Firebase are tagged with this date and can be fetched or deleted later.
              </p>
            </div>
            <div>
              <input
                type="date"
                value={businessDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setBusinessDate(v);
                  void loadUploads(v);
                }}
                className="rounded border border-gray-300 px-2 py-1 text-sm bg-white"
              />
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

        {/* Game master */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <h2 className="text-sm font-medium text-gray-800">Game Master (shared with sales page)</h2>
          {gamesLoading && <p className="text-xs text-gray-600">Loading games...</p>}
          {gamesError && <p className="text-xs text-red-600">{gamesError}</p>}
          {!gamesLoading && !gamesError && <GameAdmin games={games} onRefresh={loadGames} />}
        </section>

        {/* Dealer mapping */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <h2 className="text-sm font-medium text-gray-800">Dealer Mapping Configuration</h2>
          <MasterDealerEditor />
          <DealerAliasEditor />
        </section>

        {/* V1 exclusion section */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-gray-800">V1 Exclusion (remove items already in V1)</h2>
              <p className="text-[11px] text-gray-600">
                Upload V1 table file (DealerCode + From + To/Qty). Any overlaps will be removed from output.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-[11px] text-gray-700 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={strictMatchGameDraw}
                  onChange={(e) => setStrictMatchGameDraw(e.target.checked)}
                />
                Strict match Dealer + Game + Draw
              </label>
            </div>
          </div>

          <div className="bg-white border border-gray-300 rounded-lg p-3 space-y-2">
            <input
              type="file"
              accept=".xls,.xlsx"
              onChange={handleV1FileChange}
              className="w-full text-sm"
            />
            <p className="text-[11px] text-gray-700">
              Status: <b>{v1Status}</b>
            </p>
            {v1Error && <p className="text-[11px] text-red-600">{v1Error}</p>}
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
                Select multiple return files (each file can be a different game).
              </p>
            </div>

            {/* Default prefix input */}
            <div className="bg-white border border-gray-300 rounded-lg p-3">
              <label className="block text-xs mb-1 text-gray-700">
                Default 2-digit prefix for website barcode (optional)
              </label>
              <input
                type="text"
                value={defaultPrefix2}
                onChange={(e) => setDefaultPrefix2(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                placeholder="09"
              />
              <p className="text-[11px] text-gray-600 mt-1">
                Used only when barcode is shorter than 7 digits after reading.
              </p>
            </div>

            {/* Per-file config cards */}
            {fileConfigs.length > 0 && (
              <div className="space-y-3">
                {fileConfigs.map((cfg, idx) => (
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
                          disabled={savingFileId === cfg.id || !businessDate || !cfg.gameId}
                          className="px-2 py-0.5 rounded border border-blue-500 bg-blue-50 text-blue-700 disabled:opacity-60"
                        >
                          {savingFileId === cfg.id ? "Saving…" : "Save to Firebase"}
                        </button>
                      </div>
                    </div>

                    {/* Game */}
                    <div>
                      <label className="block text-xs mb-1 text-gray-700">Game for this return file</label>
                      <select
                        value={cfg.gameId}
                        onChange={(e) =>
                          updateFileConfig(cfg.id, (old) => ({
                            ...old,
                            gameId: e.target.value,
                          }))
                        }
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                      >
                        <option value="">-- Select game --</option>
                        {games.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} {g.board ? `(${g.board})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Draw date */}
                    <div>
                      <label className="block text-xs mb-1 text-gray-700">Draw Date (dd/mm/yyyy)</label>
                      <input
                        type="date"
                        value={cfg.drawDate}
                        onChange={(e) =>
                          updateFileConfig(cfg.id, (old) => ({
                            ...old,
                            drawDate: e.target.value,
                            draw: formatDateToDDMMYYYY(e.target.value),
                          }))
                        }
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                      />
                      <p className="text-[11px] text-gray-600 mt-1">
                        Formatted Draw: <b>{cfg.draw || "Not selected"}</b>
                      </p>
                    </div>
                  </div>
                ))}
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
                          <td
                            key={cIdx}
                            className="px-3 py-1.5 border border-gray-200 whitespace-nowrap"
                          >
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
      </div>
    </main>
  );
}

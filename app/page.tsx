// app/page.tsx

"use client";

import {
  FormEvent,
  useEffect,
  useState,
  ChangeEvent,
} from "react";
import * as XLSX from "xlsx";
import {
  buildBreakingSegments,
  buildStructuredRows,
  Cell,
  StructuredRow,
  renderCell,
  toNumber,
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

// Each uploaded file has its own breaking config / validation
type FileConfig = {
  id: string;
  file: File;
  gameId: string; // Firestore Game document id

  totalFrom: string; // UI text
  totalTo: string; // UI text
  breakDraft: string; // current input for a single breaking qty
  breakSizes: number[]; // list of breaking quantities

  validationWarning: string | null;
};

// Utility: today as YYYY-MM-DD (local)
function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Business date / upload date selection
  const [selectedDate, setSelectedDate] = useState<string>(todayKey());

  // Preview of one selected file (on-demand)
  const [previewTable, setPreviewTable] = useState<Cell[][]>([]);
  const [previewLabel, setPreviewLabel] = useState<string>("");

  // Combined structured rows for all files
  const [structured, setStructured] = useState<StructuredRow[]>([]);
  const [downloadBlob, setDownloadBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState<string>("Structured.xlsx");

  // Games (from Firebase)
  const [games, setGames] = useState<GameDef[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState<string | null>(null);

  // Uploaded files + per-file config (for current local run)
  const [fileConfigs, setFileConfigs] = useState<FileConfig[]>([]);

  // Saved uploads (history) for the selected date
  const [uploads, setUploads] = useState<UploadedFileRecord[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsError, setUploadsError] = useState<string | null>(null);

  // Small state flags for per-item operations
  const [savingFileId, setSavingFileId] = useState<string | null>(null);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);

  // ------------- Helpers -------------

  function recalcValidation(
    totalFrom: string,
    totalTo: string,
    breakSizes: number[]
  ): string | null {
    const fromNum = toNumber(totalFrom as Cell);
    const toNum = toNumber(totalTo as Cell);
    const sumBreaks = breakSizes.reduce((s, v) => s + v, 0);

    if (fromNum !== null && toNum !== null && sumBreaks > 0) {
      const derivedTo = fromNum + sumBreaks - 1;
      if (derivedTo !== toNum) {
        return `FROM (${fromNum}) + Σbreaks (${sumBreaks}) - 1 = ${derivedTo}, but TO = ${toNum}.`;
      }
    }
    return null;
  }

  function updateFileConfig(
    cfgId: string,
    updater: (oldCfg: FileConfig) => FileConfig
  ) {
    setFileConfigs((prev) =>
      prev.map((cfg) => {
        if (cfg.id !== cfgId) return cfg;
        const updated = updater(cfg);
        // Always recalc validation after any change
        const warning = recalcValidation(
          updated.totalFrom,
          updated.totalTo,
          updated.breakSizes
        );
        return { ...updated, validationWarning: warning };
      })
    );
  }

  // ------------- Load games -------------

  async function loadGames() {
    setGamesError(null);
    setGamesLoading(true);
    try {
      const list = await fetchGames();
      setGames(list);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Error loading games.";
      setGamesError(errorMessage || "Error loading games.");
    } finally {
      setGamesLoading(false);
    }
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
      const msg =
        err instanceof Error ? err.message : "Error loading uploaded files.";
      setUploadsError(msg);
      setUploads([]);
    } finally {
      setUploadsLoading(false);
    }
  }

  // ------------- Initial load -------------

  useEffect(() => {
    void loadGames();
    void loadUploads(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    const list: FileConfig[] = [];
    const now = Date.now();

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      list.push({
        id: `${f.name}-${i}-${now}`,
        file: f,
        gameId: "",

        totalFrom: "",
        totalTo: "",
        breakDraft: "",
        breakSizes: [],
        validationWarning: null,
      });
    }

    setFileConfigs(list);
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
        for (let i = 0; i < row.length; i++) {
          newRow[i] = row[i];
        }
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

    if (!cfg.gameId) {
      setError(`Please select a game for file: ${cfg.file.name} before saving.`);
      return;
    }

    const game = games.find((g) => g.id === cfg.gameId);
    const gameName = game?.name ?? "";

    try {
      setError(null);
      setSavingFileId(cfg.id);
      await saveUploadedFile(cfg.file, cfg.gameId, gameName, selectedDate);
      await loadUploads(selectedDate);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error saving file to Firebase.";
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
      const msg =
        err instanceof Error ? err.message : "Error deleting uploaded file.";
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

    if (games.length === 0) {
      setError(
        "No games loaded. Please define games in the Game Master section first."
      );
      return;
    }

    // Ensure each file has a selected game
    for (const cfg of fileConfigs) {
      if (!cfg.gameId) {
        setError(`Please select a game for file: ${cfg.file.name}`);
        return;
      }
    }

    setIsLoading(true);

    try {
      const allStructured: StructuredRow[] = [];

      // Process each file sequentially
      for (const cfg of fileConfigs) {
        const file = cfg.file;
        const game = games.find((g) => g.id === cfg.gameId);
        const gameNameOverride = game?.name ?? "";

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
          for (let i = 0; i < row.length; i++) {
            newRow[i] = row[i];
          }
          return newRow;
        });

        // Build breaking / filtering segments for THIS file
        const fromNum = toNumber(cfg.totalFrom as Cell);
        const toNum = toNumber(cfg.totalTo as Cell);

        let segments: { start: number; end: number }[] = [];

        // Case 1: FROM + breaking list → multi segments
        if (fromNum !== null && cfg.breakSizes.length > 0) {
          segments = buildBreakingSegments(fromNum, cfg.breakSizes);
        }
        // Case 2: only FROM + TO → single continuous filter range
        else if (fromNum !== null && toNum !== null) {
          segments = [{ start: fromNum, end: toNum }];
        }
        // Case 3: no valid filtering config → keep full file (no segments)

        const structuredRowsForFile = await buildStructuredRows(
          normalized,
          segments,
          gameNameOverride
        );

        allStructured.push(...structuredRowsForFile);
      }

      setStructured(allStructured);

      if (allStructured.length === 0) {
        setError("No dealer rows / gaps detected in the uploaded files.");
      } else {
        const ws = XLSX.utils.json_to_sheet(allStructured);
        const newWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWb, ws, "Structured");

        const wbout = XLSX.write(newWb, {
          bookType: "xlsx",
          type: "array",
        });

        const blob = new Blob([wbout], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

        setDownloadBlob(blob);
      }

      setFileName("AllGames_structured.xlsx");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || "Error while processing the files.");
      } else {
        setError(String(err) || "Error while processing the files.");
      }
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

  // ------------- UI -------------

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-900">
      <div className="w-full max-w-6xl p-6 rounded-lg bg-white shadow border border-gray-300 space-y-6">
        <h1 className="text-xl font-semibold">
          ERP Summary → Structured Dealer Table (multi-game, per-file breaking)
        </h1>

        {/* Business Date + Upload History */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-gray-800">
                Business date / upload date
              </h2>
              <p className="text-[11px] text-gray-600">
                Files saved to Firebase are tagged with this date and can be
                fetched or deleted later.
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
              {uploadsLoading && (
                <span className="text-[11px] text-gray-500">Loading…</span>
              )}
            </div>

            {uploadsError && (
              <p className="text-[11px] text-red-600 mb-1">{uploadsError}</p>
            )}

            {uploads.length === 0 && !uploadsLoading && !uploadsError && (
              <p className="text-[11px] text-gray-500">
                No ERP files saved for this date.
              </p>
            )}

            {uploads.length > 0 && (
              <div className="max-h-40 overflow-auto">
                <table className="min-w-full text-[11px]">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">
                        File
                      </th>
                      <th className="px-2 py-1 text-left font-medium">
                        Game
                      </th>
                      <th className="px-2 py-1 text-right font-medium">
                        Size (KB)
                      </th>
                      <th className="px-2 py-1 text-center font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploads.map((u) => (
                      <tr key={u.id} className="border-t border-gray-200">
                        <td className="px-2 py-1 whitespace-nowrap">
                          {u.fileName}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {u.gameName || "-"}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {Math.round((u.size || 0) / 1024)}
                        </td>
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

        {/* Game master (CRUD) */}
        <section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
          <h2 className="text-sm font-medium text-gray-800">
            Game Master (define official game names)
          </h2>

          {gamesLoading && (
            <p className="text-xs text-gray-600">Loading games...</p>
          )}

          {gamesError && (
            <p className="text-xs text-red-600">{gamesError}</p>
          )}

          {!gamesLoading && !gamesError && (
            <GameAdmin games={games} onRefresh={loadGames} />
          )}

          {games.length === 0 && !gamesLoading && !gamesError && (
            <p className="text-[11px] text-amber-700">
              No games found in Firestore (collection{" "}
              <span className="font-mono">&quot;games&quot;</span>). Use the Game
              Master section to add your first game.
            </p>
          )}
        </section> 
        {/* Dealer Configuration */}
        {/* Dealer Configuration */}
<section className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-3">
  <h2 className="text-sm font-medium text-gray-800">
    Dealer Mapping Configuration
  </h2>

  <p className="text-[11px] text-gray-600">
    Configure how ERP dealer codes are normalized.  
    The master dealer receives credit, alias dealers are mapped to it.
  </p>

  {/* Master Dealer Code Component */}
  <MasterDealerEditor />

  {/* Alias Dealer List Component */}
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
                Select multiple files (each file = one game). Every file gets
                its own breaking config below. You can save raw files to
                Firebase for this date before or after building structured
                tables.
              </p>
            </div>

            {/* Per-file configuration blocks */}
            {fileConfigs.length > 0 && (
              <div className="space-y-3">
                {fileConfigs.map((cfg, index) => {
                  const sumBreaks = cfg.breakSizes.reduce(
                    (s, v) => s + v,
                    0
                  );
                  const fromNum = toNumber(cfg.totalFrom as Cell);
                  const derivedTo =
                    fromNum !== null && sumBreaks > 0
                      ? fromNum + sumBreaks - 1
                      : null;

                  const canSave =
                    !!selectedDate && !!cfg.gameId && !savingFileId;

                  return (
                    <div
                      key={cfg.id}
                      className="border border-gray-300 rounded-lg p-3 bg-white space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-gray-800">
                          File {index + 1}: {cfg.file.name}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-gray-500">
                          <span>
                            Size: {Math.round(cfg.file.size / 1024)} KB
                          </span>
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
                            disabled={!canSave || savingFileId === cfg.id}
                            className="px-2 py-0.5 rounded border border-blue-500 bg-blue-50 text-blue-700 disabled:opacity-60"
                          >
                            {savingFileId === cfg.id
                              ? "Saving…"
                              : "Save to Firebase"}
                          </button>
                        </div>
                      </div>

                      {/* Game select */}
                      <div>
                        <label className="block text-xs mb-1 text-gray-700">
                          Game for this file
                        </label>
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

                      {/* Breaking config for THIS file */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                        <div>
                          <label className="block text-xs mb-1 text-gray-700">
                            Total FROM barcode
                          </label>
                          <input
                            type="text"
                            value={cfg.totalFrom}
                            onChange={(e) =>
                              updateFileConfig(cfg.id, (old) => ({
                                ...old,
                                totalFrom: e.target.value,
                              }))
                            }
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                            placeholder="e.g. 648051244"
                          />
                        </div>

                        <div>
                          <label className="block text-xs mb-1 text-gray-700">
                            Total TO barcode (official)
                          </label>
                          <input
                            type="text"
                            value={cfg.totalTo}
                            onChange={(e) =>
                              updateFileConfig(cfg.id, (old) => ({
                                ...old,
                                totalTo: e.target.value,
                              }))
                            }
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                            placeholder="e.g. 648051325"
                          />
                          <p className="mt-1 text-[11px] text-gray-500">
                            Used only for validation and continuous range filter
                            when there is no breaking list.
                          </p>
                        </div>

                        <div>
                          <label className="block text-xs mb-1 text-gray-700">
                            Add breaking quantity
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={cfg.breakDraft}
                              onChange={(e) =>
                                updateFileConfig(cfg.id, (old) => ({
                                  ...old,
                                  breakDraft: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  const cleaned =
                                    cfg.breakDraft.replace(/[^\d-]/g, "");
                                  if (!cleaned) return;
                                  const n = Number(cleaned);
                                  if (!Number.isFinite(n) || n <= 0) return;
                                  updateFileConfig(cfg.id, (old) => ({
                                    ...old,
                                    breakSizes: [
                                      ...old.breakSizes,
                                      Math.trunc(n),
                                    ],
                                    breakDraft: "",
                                  }));
                                }
                              }}
                              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                              placeholder="e.g. 62"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const cleaned =
                                  cfg.breakDraft.replace(/[^\d-]/g, "");
                                if (!cleaned) return;
                                const n = Number(cleaned);
                                if (!Number.isFinite(n) || n <= 0) return;
                                updateFileConfig(cfg.id, (old) => ({
                                  ...old,
                                  breakSizes: [
                                    ...old.breakSizes,
                                    Math.trunc(n),
                                  ],
                                  breakDraft: "",
                                }));
                              }}
                              className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium"
                            >
                              Add
                            </button>
                          </div>
                          <p className="mt-1 text-[11px] text-gray-500">
                            Enter breaks in order from official site (e.g. 62, 20,
                            30, 440).
                          </p>
                        </div>
                      </div>

                      {/* Break list + derived info */}
                      {cfg.breakSizes.length > 0 && (
                        <div className="mt-2 text-[11px] text-gray-800 space-y-1">
                          <div className="flex flex-wrap gap-1">
                            {cfg.breakSizes.map((q, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 rounded-full bg-gray-200 border border-gray-400"
                              >
                                {idx + 1}. {q}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center justify-between">
                            <span>
                              Σbreaks: {sumBreaks}
                              {derivedTo !== null &&
                                fromNum !== null && (
                                  <> | FROM + Σ - 1 = {derivedTo}</>
                                )}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateFileConfig(cfg.id, (old) => ({
                                  ...old,
                                  breakSizes: [],
                                }))
                              }
                              className="text-[11px] px-2 py-0.5 rounded border border-gray-300 bg-white"
                            >
                              Clear breaking list
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Per-file validation */}
                      {cfg.validationWarning && (
                        <p className="mt-1 text-[11px] text-amber-700">
                          {cfg.validationWarning}
                        </p>
                      )}
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
            {isLoading
              ? "Processing..."
              : "Build combined structured table"}
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
                      <tr
                        key={rIdx}
                        className={
                          rIdx % 2 === 0 ? "bg-white" : "bg-gray-100"
                        }
                      >
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

        {/* Combined structured table + download */}
        {structured.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-800">
                <span className="font-medium">
                  Combined structured table (DealerCode / Game / Draw / Qty)
                </span>
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
                      <th className="px-3 py-2 text-left font-medium">
                        DealerCode
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Game
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Draw
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Qty
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {structured.map((row, idx) => (
                      <tr
                        key={idx}
                        className={
                          idx % 2 === 0 ? "bg-white" : "bg-gray-100"
                        }
                      >
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {row.DealerCode}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {row.Game}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {row.Draw}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {row.Qty}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {previewTable.length === 0 &&
          structured.length === 0 &&
          !isLoading &&
          !error && (
            <p className="text-xs text-gray-600">
              Upload one or more ERP Summary files, configure per-file breaking
              and game mapping, optionally save raw files to Firebase by date,
              then build a single combined structured Excel for your Power
              Automate flow.
            </p>
          )}
      </div>
    </main>
  );
}

// app/page.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { useAuth } from "./lib/AuthProvider";
import { signOut } from "firebase/auth";
import { auth } from "./lib/firebase";

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
  isConfirmed: boolean;
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
function recalcValidationBlocks(blocks: AvailabilityBlock[], trimDigits: number): string | null {
  if (trimDigits !== 1 && trimDigits !== 2) {
    return "Trim (ඉවත් කරන අංක ගණන) අගය 1 හෝ 2 පමණක් විය යුතුය. (Trim value must be 1 or 2)";
  }

  if (blocks.length === 0) {
    return "අවම වශයෙන් එක් පරාසයක් (Sales Range) හෝ තිබිය යුතුය. (At least one range is required)";
  }

  for (const b of blocks) {
    const hasFrom = !!b.from.trim();
    const hasTo = !!b.to.trim();

    if (!hasFrom || !hasTo) {
      return `කරුණාකර FROM සහ TO අගයන් දෙකම ඇතුළත් කරන්න. ඒවා හිස්ව තැබිය නොහැක. (FROM and TO cannot be empty)`;
    }

    if (hasFrom && hasTo) {
      const fromNum = toNumber(b.from as Cell);
      const toNum = toNumber(b.to as Cell);

      if (fromNum === null || toNum === null) {
        return `FROM සහ TO අගයන් අංක පමණක් විය යුතුය. (Must be numeric barcodes)`;
      }
      if (fromNum > toNum) {
        return `FROM අගය TO අගයට වඩා කුඩා විය යුතුය. (FROM > TO is invalid)`;
      }
    }
  }
  return null;
}

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  // ✅ ALL hooks must be declared BEFORE any early return
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<UiWarning[]>([]);

  // Sequential config modal state
  const [currentConfigIndex, setCurrentConfigIndex] = useState<number | null>(null);

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
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [isLoadingAllIntoProcessor, setIsLoadingAllIntoProcessor] = useState(false);
  const [autoOpenWebsite, setAutoOpenWebsite] = useState(true);
  const [showPostUploadActionModal, setShowPostUploadActionModal] = useState(false);
  const [showRobotInstructionsModal, setShowRobotInstructionsModal] = useState(false);
  const [showInitialWelcomeModal, setShowInitialWelcomeModal] = useState(true);
  const [showDeleteOldFilesModal, setShowDeleteOldFilesModal] = useState(false);

  // ------------- Open DLB website -------------
  function openDLBWebsite() {
    if (!autoOpenWebsite) return;
    const width = Math.floor(window.screen.availWidth / 2);
    const height = window.screen.availHeight;
    const left = window.screen.availWidth - width;

    // Try to resize current window to left half
    try {
      window.moveTo(0, 0);
      window.resizeTo(width, height);
    } catch (e) {
      console.warn("Browser prevented resizing the current window:", e);
    }

    // Open DLB website on the right half
    window.open("https://online.dlb.lk/DealerOrder/Create", "DLB_Window", `width=${width},height=${height},left=${left},top=0,resizable=yes,scrollbars=yes`);
  }

  // ------------- FileConfig update helper -------------
  function updateFileConfig(
    cfgId: string,
    updater: (oldCfg: FileConfig) => FileConfig
  ) {
    setFileConfigs((prev) =>
      prev.map((cfg) => {
        if (cfg.id !== cfgId) return cfg;
        const updated = updater(cfg);
        const warning = recalcValidationBlocks(updated.blocks, updated.trimDigits);
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

  function formatBarcodeForOutput(value: number, minLen = 7): string {
    const s = String(value);
    return s.length >= minLen ? s : s.padStart(minLen, "0");
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

  // ✅ Redirect if not logged in (hook must be unconditional)
  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?redirect=/`);
    }
  }, [loading, user, router]);

  // ✅ Load uploads when auth is ready + date changes
  useEffect(() => {
    if (loading) return;
    if (!user) return;
    void loadUploads(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, selectedDate]);

  // ✅ Re-run auto-detection when date changes (loop-safe)
  useEffect(() => {
    setFileConfigs((prev) => {
      if (prev.length === 0) return prev;
      return applyAutoDetection(selectedDate, prev);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // ✅ Early return allowed only AFTER all hooks
  if (loading) return null;
  if (!user) return null;

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

        trimDigits: 2, // default

        autoDetectedGameId: null,
        autoDetectNote: null,
        autoDetectStatus: "not_found",

        blocks: [{ id: `block-1-${i}-${now}`, from: "", to: "" }],
        blockDraftFrom: "",
        blockDraftTo: "",
        enableGapFill: true,
        validationWarning: null,
        isConfirmed: false,
      });
    }

    setFileConfigs(applyAutoDetection(selectedDate, list));
    if (list.length > 0) {
      setShowPostUploadActionModal(true);
    }
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

  // ------------- Save All Files to Firebase -------------
  async function handleSaveAll(shouldDeleteOld: boolean = false) {
    if (!selectedDate) {
      setError("Please pick a business date at the top before saving files.");
      return;
    }

    const validConfigs = fileConfigs.filter(
      (cfg) => cfg.autoDetectStatus === "ok" && !!cfg.gameId
    );

    if (validConfigs.length === 0) {
      setError("No valid files to save (check auto-detect status and game ID).");
      return;
    }

    setIsSavingAll(true);
    setError(null);

    try {
      if (shouldDeleteOld) {
        for (const u of uploads) {
          try {
            await deleteUploadedFile(u);
          } catch (e) {
            console.error("Failed to delete old file:", e);
          }
        }
      }

      for (const cfg of validConfigs) {
        setSavingFileId(cfg.id);
        await saveUploadedFile(cfg.file, cfg.gameId, cfg.gameId, selectedDate);
      }
      await loadUploads(selectedDate);
      setShowRobotInstructionsModal(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving files to Firebase.";
      setError(`Error during Save All: ${msg}`);
    } finally {
      setSavingFileId(null);
      setIsSavingAll(false);
    }
  }

  // ------------- Download All Uploads as ZIP -------------
  async function handleDownloadAllZip() {
    if (uploads.length === 0) return;
    setIsDownloadingAll(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      await Promise.all(
        uploads.map(async (u) => {
          if (!u.downloadUrl) return;
          try {
            const proxyUrl = `/api/proxy?url=${encodeURIComponent(u.downloadUrl)}`;
            const res = await fetch(proxyUrl);
            const blob = await res.blob();
            // Prefix file name to avoid duplicates if any
            zip.file(u.fileName, blob);
          } catch (err) {
            console.error(`Failed to fetch ${u.fileName}`, err);
          }
        })
      );

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = window.URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ERP_Uploads_${selectedDate}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error creating zip:", err);
      alert("Failed to create ZIP file.");
    } finally {
      setIsDownloadingAll(false);
    }
  }

  // ------------- Load All Uploads into Processor -------------
  async function handleLoadAllIntoProcessor() {
    if (uploads.length === 0) return;
    setIsLoadingAllIntoProcessor(true);
    setError(null);
    try {
      const now = Date.now();
      const list: FileConfig[] = [];
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
            gameId: u.gameId || "", 
            drawDate: selectedDate,
            trimDigits: 2,
            autoDetectedGameId: null,
            autoDetectNote: null,
            autoDetectStatus: "not_found",
            blocks: [{ id: `block-1-${index}-${now}`, from: "", to: "" }],
            blockDraftFrom: "",
            blockDraftTo: "",
            enableGapFill: true,
            validationWarning: null,
            isConfirmed: false,
          });
          index++;
        } catch (err) {
          console.error(`Failed to load ${u.fileName}`, err);
        }
      }

      const finalList = applyAutoDetection(selectedDate, list);
      setFileConfigs(finalList);
      if (finalList.length > 0) {
        setCurrentConfigIndex(0);
        openDLBWebsite();
      }
      setPreviewTable([]);
      setPreviewLabel("");
      setStructured([]);
      setDownloadBlob(null);
    } catch (err) {
      console.error("Error loading files:", err);
      alert("Failed to load files into the processor.");
    } finally {
      setIsLoadingAllIntoProcessor(false);
    }
  }

  // ------------- Load Individual Upload into Processor -------------
  async function handleLoadIndividualIntoProcessor(u: UploadedFileRecord) {
    if (!u.downloadUrl) return;
    setIsLoadingAllIntoProcessor(true);
    setError(null);
    try {
      const now = Date.now();
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(u.downloadUrl)}`;
      const res = await fetch(proxyUrl);
      const blob = await res.blob();
      
      const file = new File([blob], u.fileName, { type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

      const newConfig: FileConfig = {
        id: `${file.name}-1-${now}`,
        file: file,
        gameId: u.gameId || "", 
        drawDate: selectedDate,
        trimDigits: 2,
        autoDetectedGameId: null,
        autoDetectNote: null,
        autoDetectStatus: "not_found",
        blocks: [{ id: `block-1-1-${now}`, from: "", to: "" }],
        blockDraftFrom: "",
        blockDraftTo: "",
        enableGapFill: true,
        validationWarning: null,
        isConfirmed: false,
      };

      const newList = [...fileConfigs, newConfig];
      const updatedList = applyAutoDetection(selectedDate, newList);
      setFileConfigs(updatedList);
      
      // If this is the first config added, open the modal
      if (fileConfigs.length === 0) {
        setCurrentConfigIndex(0);
        openDLBWebsite();
      }
    } catch (err) {
      console.error(`Failed to load ${u.fileName}`, err);
      alert(`Failed to load ${u.fileName} into the processor.`);
    } finally {
      setIsLoadingAllIntoProcessor(false);
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
      if (!cfg.isConfirmed) {
        setError(`Please confirm configuration for all files before processing.`);
        return;
      }
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

        // Trim-aware segments from UI blocks
        const availabilitySegments = buildAvailabilitySegments(cfg.blocks, cfg.trimDigits);

        const msgs: string[] = [];

        // Build internal rows (with To)
        const structuredRowsForFile = await buildStructuredRows(
          normalized,
          availabilitySegments,
          cfg.gameId,
          cfg.enableGapFill,
          cfg.drawDate,
          cfg.trimDigits
        );

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
        From: formatBarcodeForOutput(r.From, 7), // ✅ keep leading zeros
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
        setDownloadBlob(
          new Blob([wbout], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          })
        );
      }

      setFileName("1.xlsx");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error while processing the files.";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  // ------------- Download -------------
  async function handleDownload() {
    if (!downloadBlob) return;
    
    // Modern Browser Save Prompt (Allows user to select location)
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: fileName || "1.xlsx",
          types: [{
            description: 'Excel File',
            accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(downloadBlob);
        await writable.close();
        alert("ෆයිල් එක ඔබ ලබාදුන් ස්ථානයේ සාර්ථකව සේව් විය. හොඳ ළමයෙක්! (File successfully saved to your chosen location!)");
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return; // User cancelled
      }
    }

    // Fallback to standard browser download prompt
    try {
      const url = window.URL.createObjectURL(downloadBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "1.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Error saving file: ${err.message}`);
    }
  }

  const totalQty = structured.reduce((sum, r) => sum + (r.Qty || 0), 0);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-900">
      <div className="w-full max-w-6xl p-6 rounded-lg bg-white shadow border border-gray-300 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">
            ERP Summary → Structured Dealer Table (multi-game, per-file ranges)
          </h1>

          <div className="flex items-center gap-2">
            {/* Existing Returns Page */}
            <Link
              href="/returns"
              className="px-3 py-1.5 rounded bg-purple-700 hover:bg-purple-800 text-white text-xs font-medium shadow"
            >
              Go to Returns Page
            </Link>

            {/* New Returns Analyzer */}
            <Link
              href="/return-analysis"
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium shadow"
            >
              Returns Analyzer
            </Link>

            {/* Logout */}
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-800 text-white text-xs font-medium shadow"
            >
              Logout
            </button>
          </div>
        </div>

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
                }}
                className="rounded border border-gray-300 px-2 py-1 text-sm bg-white"
              />
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-2 bg-white">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-800">
                Uploaded ERP files for {selectedDate} ({uploads.length} saved)
              </span>
              <div className="flex items-center gap-2">
                {uploadsLoading && <span className="text-[11px] text-gray-500">Loading…</span>}
                {uploads.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handleLoadAllIntoProcessor}
                      disabled={isLoadingAllIntoProcessor}
                      className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] rounded shadow disabled:opacity-60"
                    >
                      {isLoadingAllIntoProcessor ? "Loading..." : "Load to Processor"}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadAllZip}
                      disabled={isDownloadingAll}
                      className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-[11px] rounded shadow disabled:opacity-60"
                    >
                      {isDownloadingAll ? "Zipping..." : "Download All as ZIP"}
                    </button>
                  </>
                )}
              </div>
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
                          <button
                            type="button"
                            onClick={() => void handleLoadIndividualIntoProcessor(u)}
                            disabled={isLoadingAllIntoProcessor}
                            className="text-indigo-600 hover:underline mr-2 text-[11px]"
                          >
                            Load
                          </button>
                          <a
                            href={u.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline mr-2 text-[11px]"
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
        <form id="upload-section" onSubmit={handleSubmit} className="space-y-4">
          <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-4">
            <div className="flex flex-col items-center justify-center bg-white p-8 rounded-xl border-2 border-dashed border-gray-400 shadow-sm relative w-full">
              <label
                htmlFor="file"
                className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold py-6 px-10 rounded-xl shadow-lg hover:shadow-xl text-xl transition-all text-center mb-4 block w-1/2"
              >
                Upload ERP Summary files (.xls or .xlsx)
              </label>
              <p className="text-gray-700 font-semibold text-lg text-center mb-6">
                පළමුව සේව් කිරීම සඳහා සේල්ස් ෆයිල් (Sales file) මෙහි ඇතුළත් කරන්න
              </p>
              <input
                id="file"
                name="file"
                type="file"
                accept=".xls,.xlsx"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="flex items-center justify-center gap-2">
                <input
                  id="auto-dlb"
                  type="checkbox"
                  checked={autoOpenWebsite}
                  onChange={(e) => setAutoOpenWebsite(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="auto-dlb" className="text-sm text-gray-700">
                  Auto-open DLB Website alongside config modal
                </label>
              </div>
            </div>

            {/* Post-upload options are now a modal overlay */}

            {fileConfigs.length > 0 && (
              <div className="space-y-3">
                {fileConfigs.map((cfg, index) => {
                  const canSave =
                    !!selectedDate &&
                    cfg.autoDetectStatus === "ok" &&
                    !!cfg.gameId &&
                    savingFileId !== cfg.id;

                  return (
                    <div
                      key={cfg.id}
                      className="border border-gray-300 rounded-lg p-3 bg-white flex items-center justify-between"
                    >
                      <div>
                        <div className="text-xs font-medium text-gray-800 flex items-center gap-2">
                          File {index + 1}: {cfg.file.name}
                          {cfg.isConfirmed ? (
                            <span className="px-1.5 py-0.5 bg-green-100 text-green-800 rounded text-[10px]">Confirmed</span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded text-[10px]">Pending</span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-1">
                          Game: {cfg.gameId || "Auto"} | Date: {cfg.drawDate} | Trim: {cfg.trimDigits} | Blocks: {cfg.blocks.length}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handlePreviewFile(cfg.id)}
                          className="px-2 py-1 rounded border border-gray-300 bg-gray-100 hover:bg-gray-200 text-[11px]"
                        >
                          Preview Rows
                        </button>
                        <button
                          type="button"
                          onClick={() => setCurrentConfigIndex(index)}
                          className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs rounded border border-indigo-200"
                        >
                          Edit Config
                        </button>
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
                      <tr
                        key={rIdx}
                        className={rIdx % 2 === 0 ? "bg-white" : "bg-gray-100"}
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
                      <tr
                        key={idx}
                        className={idx % 2 === 0 ? "bg-white" : "bg-gray-100"}
                      >
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

        {/* Modal for Sequential File Configuration */}
        {currentConfigIndex !== null && fileConfigs[currentConfigIndex] && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto pt-10 pb-10">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 relative max-h-full flex flex-col">
              <div className="flex items-center justify-between mb-4 border-b pb-2 shrink-0">
                <h2 className="text-lg font-bold text-gray-800">
                  Configure File {currentConfigIndex + 1} of {fileConfigs.length}
                </h2>
                <button
                  type="button"
                  onClick={() => setCurrentConfigIndex(null)}
                  className="text-gray-500 hover:text-gray-800 text-2xl font-bold leading-none"
                >
                  &times;
                </button>
              </div>

              <div className="overflow-y-auto flex-1 pr-2 pb-4">
              {(() => {
                const cfg = fileConfigs[currentConfigIndex];
                const index = currentConfigIndex;
                const canSave =
                  !!selectedDate &&
                  cfg.autoDetectStatus === "ok" &&
                  !!cfg.gameId &&
                  savingFileId !== cfg.id;

                return (
                  <div className="space-y-4">
                      {/* Name & Actions */}
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-gray-800">
                          {cfg.file.name}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-gray-500">
                          <span>Size: {Math.round(cfg.file.size / 1024)} KB</span>
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
                            min={1}
                            max={2}
                            value={cfg.trimDigits}
                            onChange={(e) => {
                              const raw = Number(e.target.value || 2);
                              const v = Math.max(1, Math.min(2, Number.isFinite(raw) ? raw : 2));
                              updateFileConfig(cfg.id, (old) => ({
                                ...old,
                                trimDigits: Math.trunc(v),
                              }));
                            }}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                          />
                        </div>
                      </div>

                      {/* Game select */}
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
                          <p className={`mt-1 text-[11px] ${cfg.autoDetectStatus === "ok" ? "text-gray-600" : "text-red-600"}`}>
                            {cfg.autoDetectNote}
                          </p>
                        )}
                      </div>

                      {/* Gap fill toggle */}
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          id={`gap-modal-${cfg.id}`}
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
                        <label htmlFor={`gap-modal-${cfg.id}`} className="text-[11px] text-gray-800">
                          Enable master gap filling
                        </label>
                      </div>

                      {/* Availability blocks */}
                      <div className="mt-3 space-y-2 border border-gray-200 rounded p-3 bg-gray-50">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-800">
                            Available stock blocks (FROM–TO)
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
                        <div className="flex items-center gap-2 text-[11px] pt-1 border-t border-gray-200 mt-2">
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
                          <p className="mt-1 text-[11px] text-amber-700">
                            {cfg.validationWarning}
                          </p>
                        )}
                      </div>
                  </div>
                );
              })()}
              </div>
              <div className="pt-4 border-t flex items-center justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => { setFileConfigs([]); setCurrentConfigIndex(null); }}
                  className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded"
                >
                  Cancel Uploads
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cfg = fileConfigs[currentConfigIndex];
                    if (cfg.validationWarning) {
                      alert("Please fix warnings before proceeding: " + cfg.validationWarning);
                      return;
                    }
                    if (!cfg.gameId || cfg.autoDetectStatus !== "ok") {
                      alert("Game ID is missing or auto-detection failed for this file.");
                      return;
                    }

                    // Mark as confirmed
                    updateFileConfig(cfg.id, old => ({...old, isConfirmed: true}));

                    // Go to next
                    if (currentConfigIndex + 1 < fileConfigs.length) {
                      setCurrentConfigIndex(currentConfigIndex + 1);
                    } else {
                      setCurrentConfigIndex(null); // Finish
                    }
                  }}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium shadow"
                >
                  {currentConfigIndex + 1 < fileConfigs.length ? "Confirm & Next File" : "Confirm & Finish"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal for Post-Upload Action Selection */}
        {showPostUploadActionModal && (
          <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center z-[60] p-6">
            <h2 className="text-4xl font-bold text-white mb-2 text-center">
              Files loaded. What's next?
            </h2>
            <h3 className="text-3xl font-bold mb-10 text-white text-center">
              ෆයිල් එක ලෝඩ් විය. ඊළඟට කුමක් කළ යුතුද?
            </h3>
            
            <div className="flex flex-col md:flex-row items-stretch justify-center gap-10 w-full max-w-4xl">
              <button
                type="button"
                onClick={() => {
                  setShowPostUploadActionModal(false);
                  if (uploads.length > 0) {
                    setShowDeleteOldFilesModal(true);
                  } else {
                    handleSaveAll(false);
                  }
                }}
                disabled={isSavingAll}
                className="w-full md:w-1/2 flex flex-col items-center justify-center py-12 px-6 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-3xl transition-transform transform hover:scale-105 border-4 border-green-900 shadow-xl"
              >
                <span className="text-3xl font-bold mb-4">
                  {isSavingAll ? "Saving All..." : "Save All to Firebase"}
                </span>
                <span className="text-2xl font-bold">සියල්ල සේව් කරන්න</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowPostUploadActionModal(false);
                  setCurrentConfigIndex(0);
                  openDLBWebsite();
                }}
                className="w-full md:w-1/2 flex flex-col items-center justify-center py-12 px-6 bg-blue-700 hover:bg-blue-600 text-white rounded-3xl transition-transform transform hover:scale-105 border-4 border-blue-900 shadow-xl"
              >
                <span className="text-3xl font-bold mb-4">Input sales ranges</span>
                <span className="text-2xl font-bold">රොබෝට සේල්ස් රේන්ජ් දෙන්න</span>
              </button>
            </div>
            
            <button 
              onClick={() => setShowPostUploadActionModal(false)}
              className="mt-14 text-white underline text-lg font-bold p-3 hover:bg-slate-800 rounded"
            >
              Dismiss Options
            </button>
          </div>
        )}

        {/* Modal for Robot Instructions after Save All */}
        {showRobotInstructionsModal && (
          <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center z-[70] p-6">
            <div className="bg-red-700 text-white p-12 rounded-3xl border-8 border-red-900 max-w-4xl text-center shadow-2xl">
              <h2 className="text-5xl font-bold mb-6">
                Please go to the Robot computer!
              </h2>
              <h3 className="text-4xl font-bold mb-10 leading-snug">
                දැන් කරුණාකර රොබෝව ඇති පරිගණකය වෙත යන්න.<br/>
                කරුණාකර අලෝකට (Aloka) කතා කර බාධා නොකරන්න.
              </h3>
              <button 
                onClick={() => setShowRobotInstructionsModal(false)}
                className="mt-6 px-12 py-5 bg-white text-red-800 text-3xl font-bold rounded-xl hover:bg-gray-200 transition-colors shadow-lg"
              >
                හරි (OK)
              </button>
            </div>
          </div>
        )}

        {/* Modal for Initial PC Load / Welcome Screen */}
        {showInitialWelcomeModal && (
          <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center z-[80] p-6">
            <h2 className="text-4xl font-bold text-white mb-2 text-center">
              Welcome / ආයුබෝවන් 
            </h2>
            <h3 className="text-3xl font-bold mb-10 text-white text-center">
              What do you want to do today? / අද ඔබට කුමක් කිරීමට අවශ්‍යද?
            </h3>
            
            <div className="flex flex-col md:flex-row items-stretch justify-center gap-10 w-full max-w-4xl">
              <button
                type="button"
                onClick={() => {
                  setShowInitialWelcomeModal(false);
                  setTimeout(() => {
                    document.getElementById('upload-section')?.scrollIntoView({ behavior: 'smooth' });
                  }, 50);
                }}
                className="w-full md:w-1/2 flex flex-col items-center justify-center py-12 px-6 bg-blue-700 hover:bg-blue-600 text-white rounded-3xl transition-transform transform hover:scale-105 border-4 border-blue-900 shadow-xl"
              >
                <span className="text-3xl font-bold mb-4">Upload sales file</span>
                <span className="text-2xl font-bold">සේල්ස් ෆයිල් අප්ලෝඩ් කරන්න</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowInitialWelcomeModal(false);
                  openDLBWebsite();
                  if (uploads.length > 0) {
                    handleLoadAllIntoProcessor();
                  }
                }}
                className="w-full md:w-1/2 flex flex-col items-center justify-center py-12 px-6 bg-indigo-700 hover:bg-indigo-600 text-white rounded-3xl transition-transform transform hover:scale-105 border-4 border-indigo-900 shadow-xl"
              >
                <span className="text-3xl font-bold mb-4">Add sales ranges to robot</span>
                <span className="text-2xl font-bold">රොබෝට සේල්ස් රේන්ජ් ලබා දෙන්න</span>
              </button>
            </div>
            
            <button 
              onClick={() => setShowInitialWelcomeModal(false)}
              className="mt-14 text-white underline text-lg font-bold p-3 hover:bg-slate-800 rounded"
            >
              Close this window
            </button>
          </div>
        )}

        {/* Modal for Deleting Old Files Confirmation */}
        {showDeleteOldFilesModal && (
          <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center z-[75] p-6">
            <div className="bg-amber-500 text-slate-900 p-12 rounded-3xl border-8 border-amber-600 max-w-4xl text-center shadow-2xl">
              <h2 className="text-5xl font-bold mb-6">
                Remove old files?
              </h2>
              <h3 className="text-4xl font-bold mb-10 leading-snug">
                ඔබට මෙම දිනයට අදාළ පැරණි ෆයිල් මකා දැමීමට අවශ්‍යද?<br/>
                (Do you want to remove the old files for this date?)
              </h3>

              <div className="flex flex-col md:flex-row gap-6 justify-center">
                <button 
                  onClick={() => {
                    setShowDeleteOldFilesModal(false);
                    handleSaveAll(true);
                  }}
                  className="px-8 py-6 bg-red-700 text-white text-3xl font-bold rounded-2xl hover:bg-red-600 transition-colors shadow-lg"
                >
                  ඔව්, මකා සේව් කරන්න<br/>
                  <span className="text-2xl font-medium">(Yes, Remove)</span>
                </button>

                <button 
                  onClick={() => {
                    setShowDeleteOldFilesModal(false);
                    handleSaveAll(false);
                  }}
                  className="px-8 py-6 bg-blue-700 text-white text-3xl font-bold rounded-2xl hover:bg-blue-600 transition-colors shadow-lg"
                >
                  නැත, මකන්න එපා<br/>
                  <span className="text-2xl font-medium">(No, Keep them)</span>
                </button>
              </div>

              <div className="mt-12">
                <button 
                  onClick={() => setShowDeleteOldFilesModal(false)}
                  className="text-slate-800 underline text-2xl font-bold hover:text-slate-900 transition-colors"
                >
                  Cancel / අවලංගු කරන්න
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

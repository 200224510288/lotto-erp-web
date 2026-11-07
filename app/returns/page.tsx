"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState, useRef } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  FileText,
  ArrowRight,
  RefreshCw,
  BarChart3,
  Layers,
  Sparkles,
  Percent,
  FileSpreadsheet,
  Info,
  ShieldAlert,
  ShieldCheck,
  Edit3,
  Sliders,
  Cloud,
} from "lucide-react";

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
import { listUploadedFilesByDate } from "../lib/uploadService";
import { validateFileData } from "../lib/fileValidation";

// ✅ auto game select (same as Sales page)
import {
  OFFICIAL_GAMES,
  suggestGameFromFileName,
  getGameSafeReturnLimit,
  isSpecialTenPercentLottery,
} from "../lib/gameAutoSelect";

// ✅ cloud-persisted customizable return thresholds & board waivers
import {
  loadReturnThresholds,
  saveReturnThresholds,
  saveSingleLotteryThreshold,
  resetReturnThresholds,
  ReturnThresholdConfig,
  DEFAULT_RETURN_THRESHOLDS,
  DLB_LOTTERY_LIST,
  findLotteryInfo,
  getLotteryThreshold,
  isLotteryWaived,
  toggleLotteryWaiver,
} from "../lib/returnThresholdConfig";

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
 * Robustly extract return quantity from a raw Return sheet:
 * 1. Explicit TOTAL / GRAND TOTAL row
 * 2. Header row like "DRAW NO ... [total qty]"
 * 3. Fallback: sum of all agent return rows (any row with 5-6 digit dealer code and numeric qty)
 */
export function extractFileReturnQuantity(cells: Cell[][]): number {
  if (!cells || cells.length === 0) return 0;

  // 1. Search for explicit TOTAL / GRAND TOTAL row
  for (let i = cells.length - 1; i >= 0; i--) {
    const row = cells[i];
    if (!row) continue;
    const isTotalRow = row.some((c) => {
      const s = String(c ?? "").trim().toUpperCase();
      return s === "TOTAL" || s === "GRAND TOTAL" || s.startsWith("TOTAL ") || s.includes("GRAND TOTAL");
    });
    if (isTotalRow) {
      for (let j = row.length - 1; j >= 0; j--) {
        const val = Number(String(row[j] ?? "").replace(/,/g, "").trim());
        if (Number.isFinite(val) && val > 0) {
          return val;
        }
      }
    }
  }

  // 2. Search for DRAW NO header line that carries total quantity (e.g. DLB return sheet row 4)
  for (let i = 0; i < Math.min(cells.length, 10); i++) {
    const row = cells[i];
    if (!row) continue;
    const hasDrawHeader = row.some((c) => String(c ?? "").toUpperCase().includes("DRAW NO"));
    if (hasDrawHeader) {
      for (let j = row.length - 1; j >= 0; j--) {
        const val = Number(String(row[j] ?? "").replace(/,/g, "").trim());
        if (Number.isFinite(val) && val > 0) {
          return val;
        }
      }
    }
  }

  // 3. Fallback: sum of all agent return rows (any row with 5-6 digit dealer code and numeric qty)
  let sum = 0;
  for (const row of cells) {
    if (!row || row.length === 0) continue;
    if (row.some((c) => String(c ?? "").toUpperCase().includes("TOTAL"))) continue;

    const hasDealer = row.some((c) => {
      const digits = String(c ?? "").replace(/\D/g, "");
      return digits.length === 5 || digits.length === 6;
    });
    if (!hasDealer) continue;

    for (let j = row.length - 1; j >= 0; j--) {
      const s = String(row[j] ?? "").replace(/,/g, "").trim();
      const n = Number(s);
      if (Number.isFinite(n) && n > 0 && n <= 100000 && /^\d+$/.test(s)) {
        sum += n;
        break;
      }
    }
  }

  return sum;
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

  // Total return quantity detected or parsed for this file
  returnQty?: number;
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
  const [fileName, setFileName] = useState<string>("RT.xlsx");

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

  // DLB Return Analysis & 5% Statutory Limit Metrics
  const [totalSalesQty, setTotalSalesQty] = useState<number>(30000);
  const [isSalesAutoDetected, setIsSalesAutoDetected] = useState<boolean>(false);
  const [salesFilesCount, setSalesFilesCount] = useState<number>(0);
  const [isLoadingSales, setIsLoadingSales] = useState<boolean>(false);
  const [manualSalesInput, setManualSalesInput] = useState<string>("30000");
  const [isEditingSales, setIsEditingSales] = useState<boolean>(false);
  const [uploadsReturnQtys, setUploadsReturnQtys] = useState<Record<string, number>>({});
  const [salesByGame, setSalesByGame] = useState<Record<string, number>>({});
  const [totalSalesFromSalesPage, setTotalSalesFromSalesPage] = useState<number>(0);

  // Cloud-Persisted Customizable Return Thresholds (per lottery)
  const [returnThresholds, setReturnThresholds] = useState<ReturnThresholdConfig>(DEFAULT_RETURN_THRESHOLDS);
  const [selectedLotteryId, setSelectedLotteryId] = useState<string>("ada_kotipathi");
  const [inputLimitText, setInputLimitText] = useState<string>("5");
  const [isSavingThresholds, setIsSavingThresholds] = useState<boolean>(false);
  const [thresholdSaveSuccess, setThresholdSaveSuccess] = useState<boolean>(false);
  const saveThresholdTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync input text when selected lottery changes or cloud config arrives
  useEffect(() => {
    const current = getLotteryThreshold(selectedLotteryId, returnThresholds);
    setInputLimitText(String(current));
  }, [selectedLotteryId, returnThresholds.updatedAt]);

  function handleSetLotteryThresholdOptimistic(lotteryId: string, limit: number) {
    // 1. Immediately update React state synchronously (0ms) so table badges, return %, and cards update instantly!
    setReturnThresholds((prev) => {
      const nextOverrides = {
        ...(prev.lotteryThresholds || prev.overrides || {}),
        [lotteryId]: limit,
      };
      return {
        ...prev,
        lotteryThresholds: nextOverrides,
        overrides: nextOverrides,
      };
    });

    // 2. Debounced background persist to Cloud Firestore & localStorage
    if (saveThresholdTimerRef.current) {
      clearTimeout(saveThresholdTimerRef.current);
    }
    setIsSavingThresholds(true);
    setThresholdSaveSuccess(false);

    saveThresholdTimerRef.current = setTimeout(async () => {
      try {
        const res = await saveSingleLotteryThreshold(lotteryId, limit);
        setReturnThresholds(res);
        setThresholdSaveSuccess(true);
        setTimeout(() => setThresholdSaveSuccess(false), 2000);
      } catch (err) {
        console.error("Failed saving lottery threshold to cloud:", err);
      } finally {
        setIsSavingThresholds(false);
      }
    }, 450);
  }

  async function handleToggleWaiveLottery(lotteryIdOrName: string) {
    const lot = findLotteryInfo(lotteryIdOrName);
    const targetId = lot ? lot.id : lotteryIdOrName.trim().toLowerCase();

    // 1. Optimistic update to React state (0ms)
    setReturnThresholds((prev) => {
      const currentWaived = new Set(prev.waivedLotteries || []);
      if (currentWaived.has(targetId)) {
        currentWaived.delete(targetId);
      } else {
        currentWaived.add(targetId);
      }
      return {
        ...prev,
        waivedLotteries: Array.from(currentWaived),
      };
    });

    setIsSavingThresholds(true);
    setThresholdSaveSuccess(false);
    try {
      const res = await toggleLotteryWaiver(lotteryIdOrName);
      setReturnThresholds(res);
      setThresholdSaveSuccess(true);
      setTimeout(() => setThresholdSaveSuccess(false), 2000);
    } catch (err) {
      console.error("Failed toggling lottery waiver in cloud:", err);
    } finally {
      setIsSavingThresholds(false);
    }
  }

  async function handleUpdateThresholds(updates: Partial<ReturnThresholdConfig>) {
    const next = { ...returnThresholds, ...updates };
    setReturnThresholds(next);
    setIsSavingThresholds(true);
    setThresholdSaveSuccess(false);
    try {
      const saved = await saveReturnThresholds(updates);
      setReturnThresholds(saved);
      setThresholdSaveSuccess(true);
      setTimeout(() => setThresholdSaveSuccess(false), 2500);
    } catch (err) {
      console.error("Failed saving thresholds to cloud:", err);
    } finally {
      setIsSavingThresholds(false);
    }
  }

  async function handleResetThresholds() {
    setIsSavingThresholds(true);
    setThresholdSaveSuccess(false);
    try {
      const res = await resetReturnThresholds();
      setReturnThresholds(res);
      setThresholdSaveSuccess(true);
      setTimeout(() => setThresholdSaveSuccess(false), 2500);
    } catch (err) {
      console.error("Failed resetting thresholds in cloud:", err);
    } finally {
      setIsSavingThresholds(false);
    }
  }

  function updateFileConfig(id: string, updater: (old: ReturnFileConfig) => ReturnFileConfig) {
    setFileConfigs((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  }

  // Lookup matching sales quantity from http://localhost:3000/ saved files
  function getLotterySalesForReturn(
    gameId?: string | null,
    fileName?: string | null
  ): number {
    if (!salesByGame || Object.keys(salesByGame).length === 0) return 0;

    // 1. Direct gameId match (official code e.g. KPM, SFT)
    if (gameId) {
      const gUpper = gameId.trim().toUpperCase();
      if (salesByGame[gUpper] !== undefined && salesByGame[gUpper] > 0) {
        return salesByGame[gUpper];
      }
    }

    // 2. Suggest official code from return file name
    if (fileName) {
      const s = suggestGameFromFileName(fileName, businessDate);
      if (s.status === "ok") {
        const off = s.official.trim().toUpperCase();
        if (salesByGame[off] !== undefined && salesByGame[off] > 0) {
          return salesByGame[off];
        }
        if (s.erp) {
          const erp = s.erp.trim().toUpperCase();
          if (salesByGame[erp] !== undefined && salesByGame[erp] > 0) {
            return salesByGame[erp];
          }
        }
      }
    }

    // 3. Fallback: match by family keywords (Kapruka, Lagna, Super Ball, Shanida, Ada Kotipathi, etc.)
    const candidate = ((gameId || "") + " " + (fileName || "")).toUpperCase();
    for (const [key, qty] of Object.entries(salesByGame)) {
      if (qty <= 0) continue;
      const k = key.toUpperCase();
      if (candidate.includes(k) || k.includes(candidate)) {
        return qty;
      }
      if (
        (candidate.includes("KAP") && k.includes("KAP")) ||
        (candidate.includes("LAG") && k.includes("LAG")) ||
        (candidate.includes("SUPER") && k.includes("SUPER")) ||
        (candidate.includes("SHAN") && k.includes("SHAN")) ||
        (candidate.includes("ADA") && k.includes("ADA")) ||
        (candidate.includes("KOTI") && k.includes("KOTI")) ||
        (candidate.includes("SASI") && k.includes("SASI"))
      ) {
        return qty;
      }
    }

    return 0;
  }

  async function loadSalesForDate(dateKey: string) {
    if (!dateKey) return;
    setIsLoadingSales(true);
    try {
      const salesFiles = await listUploadedFilesByDate(dateKey);
      setSalesFilesCount(salesFiles.length);

      const gameSalesMap: Record<string, number> = {};
      let detectedSalesSum = 0;

      if (salesFiles.length > 0) {
        for (const sf of salesFiles) {
          if (!sf.downloadUrl) continue;
          try {
            const proxyUrl = `/api/proxy?url=${encodeURIComponent(sf.downloadUrl)}`;
            const res = await fetch(proxyUrl);
            const blob = await res.blob();
            const f = new File([blob], sf.fileName);
            const cells = await readFirstSheet(f);

            let fileSum = 0;
            for (const row of cells) {
              if (!row || row.length < 5) continue;
              const c0 = String(row[0] ?? "").trim();
              const c4 = Number(String(row[4] ?? "").replace(/,/g, "").trim());
              if (/^\d{4,6}$/.test(c0) && Number.isFinite(c4) && c4 > 0) {
                fileSum += c4;
              }
            }
            if (fileSum > 0) {
              detectedSalesSum += fileSum;

              // Store uniquely without duplicate multi-increments
              const gameKeys = new Set<string>();
              if (sf.gameId) gameKeys.add(sf.gameId.trim().toUpperCase());
              if (sf.gameName) gameKeys.add(sf.gameName.trim().toUpperCase());

              const s = suggestGameFromFileName(sf.fileName, dateKey);
              if (s.status === "ok") {
                if (s.official) gameKeys.add(s.official.trim().toUpperCase());
                if (s.erp) gameKeys.add(s.erp.trim().toUpperCase());
              }

              for (const k of gameKeys) {
                gameSalesMap[k] = (gameSalesMap[k] || 0) + fileSum;
              }
            }
          } catch (e) {
            console.warn(`Could not parse sales file ${sf.fileName}:`, e);
          }
        }

        setSalesByGame(gameSalesMap);
        setTotalSalesFromSalesPage(detectedSalesSum);

        if (detectedSalesSum > 0) {
          setTotalSalesQty(detectedSalesSum);
          setManualSalesInput(String(detectedSalesSum));
          setIsSalesAutoDetected(true);
        } else {
          setIsSalesAutoDetected(false);
        }
      } else {
        setSalesByGame({});
        setTotalSalesFromSalesPage(0);
        setIsSalesAutoDetected(false);
      }
    } catch (err) {
      console.error("Error loading sales for date:", err);
    } finally {
      setIsLoadingSales(false);
    }
  }

  async function loadUploads(dateKey: string) {
    if (!dateKey) return;
    setUploadsError(null);
    setUploadsLoading(true);
    try {
      const list = await listReturnUploadedFilesByDate(dateKey);
      setUploads(list);

      // Populate return quantities for uploaded files
      const qtys: Record<string, number> = {};
      for (const u of list) {
        if (typeof u.returnQty === "number" && u.returnQty > 0) {
          qtys[u.id] = u.returnQty;
        } else if (u.downloadUrl) {
          // Asynchronously fetch and extract qty in background
          void (async () => {
            try {
              const proxyUrl = `/api/proxy?url=${encodeURIComponent(u.downloadUrl)}`;
              const res = await fetch(proxyUrl);
              const blob = await res.blob();
              const f = new File([blob], u.fileName);
              const cells = await readFirstSheet(f);
              const q = extractFileReturnQuantity(cells);
              if (q > 0) {
                setUploadsReturnQtys((prev) => ({ ...prev, [u.id]: q }));
              }
            } catch {
              // ignore background error
            }
          })();
        }
      }
      setUploadsReturnQtys((prev) => ({ ...prev, ...qtys }));
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
    void loadSalesForDate(businessDate);

    // Load cloud-saved customizable thresholds
    void (async () => {
      try {
        const cfg = await loadReturnThresholds();
        setReturnThresholds(cfg);
      } catch (err) {
        console.warn("Could not fetch cloud thresholds:", err);
      }
    })();

    // Listen for cross-component or cross-tab threshold updates
    const handleThresholdUpdate = (e: Event) => {
      const detail = (e as CustomEvent<ReturnThresholdConfig>).detail;
      if (detail && typeof detail.defaultThreshold === "number") {
        setReturnThresholds(detail);
      }
    };
    window.addEventListener("dlb-thresholds-updated", handleThresholdUpdate);

    return () => {
      window.removeEventListener("dlb-thresholds-updated", handleThresholdUpdate);
    };
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

  // ✅ When businessDate changes: update uploads list + sales benchmark + drawDate/draw for all files + rerun auto-detect
  function handleBusinessDateChange(v: string) {
    setBusinessDate(v);
    void loadUploads(v);
    void loadSalesForDate(v);

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
      let returnQty = 0;
      try {
        const cells = await readFirstSheet(f);
        returnQty = extractFileReturnQuantity(cells);
      } catch (err) {
        console.warn("Could not pre-read sheet for return qty:", err);
      }

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
        returnQty,
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
      await saveReturnUploadedFile(cfg.file, cfg.gameId, cfg.gameId, businessDate, cfg.returnQty);

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
          returnQty: cfg.returnQty,
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

          let returnQty = u.returnQty;
          try {
            const cells = await readFirstSheet(file);
            returnQty = returnQty || extractFileReturnQuantity(cells);
          } catch (e) {
            console.warn("Could not pre-read sheet for return qty:", e);
          }

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
            returnQty,
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

      let returnQty = u.returnQty;
      try {
        const cells = await readFirstSheet(file);
        returnQty = returnQty || extractFileReturnQuantity(cells);
      } catch (e) {
        console.warn("Could not pre-read sheet for return qty:", e);
      }

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
        returnQty,
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

        const fileReturnCount = rows.reduce((s, r) => s + (r.Qty || 0), 0);
        updateFileConfig(cfg.id, (old) => ({
          ...old,
          returnQty: fileReturnCount > 0 ? fileReturnCount : old.returnQty,
        }));

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

      setFileName("RT.xlsx");
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
    const targetDownloadName = fileName || "RT.xlsx";

    if (isLocal) {
      try {
        const res = await fetch(`/api/save-local?filename=${encodeURIComponent(targetDownloadName)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-filename': targetDownloadName,
          },
          body: downloadBlob,
        });
        
        const result = await res.json();
        if (res.ok && result.success) {
          alert(result.message || `File saved successfully to C:\\DLB\\${targetDownloadName}`);
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
      a.download = targetDownloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Error saving file: ${err.message}`);
    }
  }

  const totalQty = structuredReturns.reduce((sum, r) => sum + (r.Qty || 0), 0);

  // DLB Return and Game-Aware Limit Calculations (with Board Waiver support)
  const allLimitItems = fileConfigs.length > 0
    ? fileConfigs.map((c) => {
        const game = c.gameId || "";
        const name = c.file.name;
        const qty = c.returnQty || 0;
        const waived = isLotteryWaived(game || name, returnThresholds);
        const limit = getLotteryThreshold(game || name, returnThresholds);
        const isTenPercent = isSpecialTenPercentLottery(game || name);
        const sales = getLotterySalesForReturn(game, name);
        return { name, game, qty, waived, limit, isTenPercent, sales };
      })
    : uploads.map((u) => {
        const game = u.gameName || "";
        const name = u.fileName;
        const qty = u.returnQty ?? uploadsReturnQtys[u.id] ?? 0;
        const waived = isLotteryWaived(game || name, returnThresholds);
        const limit = getLotteryThreshold(game || name, returnThresholds);
        const isTenPercent = isSpecialTenPercentLottery(game || name);
        const sales = getLotterySalesForReturn(game, name);
        return { name, game, qty, waived, limit, isTenPercent, sales };
      });

  const activeReturnItems = allLimitItems.filter((item) => !item.waived);
  const waivedReturnItems = allLimitItems.filter((item) => item.waived);
  const waivedCount = waivedReturnItems.length;

  // Total active return tickets considered for Return %
  const totalDlbReturns = activeReturnItems.reduce((sum, item) => sum + item.qty, 0);
  const allRawReturnsSum = allLimitItems.reduce((sum, item) => sum + item.qty, 0);
  const activeFilesCount = activeReturnItems.length;

  // Deduct sales of waived lotteries so Return % isn't skewed
  const waivedSalesSum = waivedReturnItems.reduce((sum, item) => sum + (item.sales || 0), 0);
  const effectiveDlbSales = Math.max(0, totalSalesQty - waivedSalesSum);

  // Average approved ceiling among active (non-waived) lotteries:
  const effectiveApprovedLimitPct = activeReturnItems.length > 0
    ? activeReturnItems.reduce((acc, item) => acc + item.limit, 0) / activeReturnItems.length
    : returnThresholds.defaultThreshold;

  const returnPercentage = effectiveDlbSales > 0 ? (totalDlbReturns / effectiveDlbSales) * 100 : 0;
  const totalAllowedReturns = Math.round(effectiveDlbSales * (effectiveApprovedLimitPct / 100));
  const isExceedingApprovedLimit = effectiveDlbSales > 0 ? totalDlbReturns > totalAllowedReturns : false;
  const excessReturnQty = Math.max(0, totalDlbReturns - totalAllowedReturns);
  const safeMarginRemaining = Math.max(0, totalAllowedReturns - totalDlbReturns);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-900">
      <div className="w-full max-w-6xl p-6 rounded-lg bg-white shadow border border-gray-300 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Agent Return Report → Structured Return Table</h1>

          <div className="flex flex-col items-end gap-2 shrink-0">
            {/* Primary Navigation Row */}
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-800 text-white text-xs font-medium shadow"
              >
                Go to Sales Page
              </Link>
            </div>

            {/* Financial & Compliance Balancing Row */}
            <div className="flex items-center gap-2">
              <Link
                href="/return-analysis"
                className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow flex items-center gap-1.5 transition-colors"
                title="Open Sinhala 5% Return Excess Notice Generator"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Return Analysis (5% Notice)</span>
              </Link>
              <Link
                href="/daily-balance"
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow"
              >
                Balance Organizer
              </Link>
              <Link
                href="/scan-balancing"
                className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow"
              >
                Scan Balancing
              </Link>
            </div>
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
                    className="px-2 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-medium hover:bg-indigo-100 disabled:opacity-60 cursor-pointer"
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
              <div className="max-h-48 overflow-auto">
                <table className="min-w-full text-[11px]">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">File</th>
                      <th className="px-2 py-1 text-left font-medium">Game</th>
                      <th className="px-2 py-1 text-center font-medium">Safe Limit</th>
                      <th className="px-2 py-1 text-right font-medium">Return Qty</th>
                      <th className="px-2 py-1 text-right font-medium">Sales Qty (from /)</th>
                      <th className="px-2 py-1 text-right font-medium">Return % (vs Sales)</th>
                      <th className="px-2 py-1 text-right font-medium">Size (KB)</th>
                      <th className="px-2 py-1 text-center font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploads.map((u) => {
                      const qty = u.returnQty ?? uploadsReturnQtys[u.id] ?? 0;
                      const isTen = isSpecialTenPercentLottery(u.gameName || u.fileName);
                      const isWaived = isLotteryWaived(u.gameName || u.fileName, returnThresholds);
                      const limit = getLotteryThreshold(u.gameName || u.fileName, returnThresholds);
                      const lotterySales = getLotterySalesForReturn(u.gameName, u.fileName);
                      const hasSales = lotterySales > 0;
                      const returnPct = hasSales ? (qty / lotterySales) * 100 : 0;
                      const isExceeded = !isWaived && hasSales && returnPct > limit;

                      return (
                        <tr key={u.id} className={`border-t border-gray-200 hover:bg-gray-50 ${isWaived ? "bg-purple-50/40" : ""}`}>
                          <td className="px-2 py-1 whitespace-nowrap font-medium text-gray-900">{u.fileName}</td>
                          <td className="px-2 py-1 whitespace-nowrap font-semibold">{u.gameName || "-"}</td>
                          <td className="px-2 py-1 text-center whitespace-nowrap">
                            {isWaived ? (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-900 border border-purple-300"
                                title="Waived by Board policy (Exempt from DLB Return %)"
                              >
                                Board Waived
                              </span>
                            ) : isTen ? (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300"
                                title={`Special ${limit.toFixed(1)}% limit (Lagna / Super Ball / Kapruka)`}
                              >
                                {limit.toFixed(1)}% Limit
                              </span>
                            ) : (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-200"
                                title={`Standard ${limit.toFixed(1)}% DLB limit (Cloud Configured)`}
                              >
                                {limit.toFixed(1)}% Limit
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right font-bold text-indigo-700 whitespace-nowrap">
                            {qty > 0 ? (
                              <span>
                                {(qty * 10).toLocaleString()}{" "}
                                <span className="text-[10px] font-normal text-gray-500">tkt</span>
                                <span className="block text-[9px] font-normal text-gray-400">
                                  ({qty.toLocaleString()} bks)
                                </span>
                              </span>
                            ) : (
                              <span className="text-gray-400 font-normal">--</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right whitespace-nowrap font-mono">
                            {hasSales ? (
                              <span>
                                <span className="font-semibold text-gray-800">
                                  {(lotterySales * 10).toLocaleString()}{" "}
                                  <span className="text-[10px] font-normal text-gray-500">tkt</span>
                                </span>
                                <span className="block text-[9px] font-normal text-gray-400">
                                  ({lotterySales.toLocaleString()} bks)
                                </span>
                              </span>
                            ) : (
                              <span className="text-gray-400 text-[10px] italic">No sales on /</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right whitespace-nowrap">
                            {hasSales ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <span className={`font-mono font-bold text-xs ${
                                  isWaived ? "text-purple-700" : isExceeded ? "text-red-600" : "text-emerald-700"
                                }`}>
                                  {returnPct.toFixed(2)}%
                                </span>
                                {isWaived ? (
                                  <span
                                    className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-100 text-purple-800 border border-purple-300"
                                    title="Exempted from DLB return percentage calculation"
                                  >
                                    ✓ Waived
                                  </span>
                                ) : (
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                      isExceeded
                                        ? "bg-red-100 text-red-800 border border-red-300"
                                        : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                    }`}
                                  >
                                    {isExceeded ? `⚠️ Over ${limit}%` : `✓ Safe (${limit}%)`}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400 font-normal">--</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right text-gray-600">{Math.round((u.size || 0) / 1024)}</td>
                          <td className="px-2 py-1 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => void handleToggleWaiveLottery(u.gameName || u.fileName)}
                              className={`mr-2 text-[11px] font-medium hover:underline cursor-pointer ${
                                isWaived ? "text-purple-700 font-bold" : "text-slate-500"
                              }`}
                              title={isWaived ? "Click to re-activate in DLB Return %" : "Click to waive/exempt from DLB Return %"}
                            >
                              {isWaived ? "Unwaive" : "Waive"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleLoadIndividualIntoProcessor(u)}
                              className="text-indigo-600 font-medium hover:underline mr-2 text-[11px] cursor-pointer"
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
                              className="text-red-600 text-[11px] px-2 py-0.5 rounded border border-red-300 bg-white disabled:opacity-60 cursor-pointer"
                            >
                              {deletingUploadId === u.id ? "Deleting…" : "Delete"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {uploads.length > 1 && (
                    <tfoot className="bg-gray-50 font-bold border-t border-gray-300">
                      <tr>
                        <td colSpan={3} className="px-2 py-1 text-gray-800">
                          Total Return Files ({uploads.length})
                          {waivedCount > 0 && (
                            <span className="ml-1.5 text-[10px] font-bold text-purple-700 bg-purple-100 px-1.5 py-0.2 rounded border border-purple-200">
                              {waivedCount} Waived
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right text-indigo-800">
                          <span className="font-bold">{(totalDlbReturns * 10).toLocaleString()} tkt</span>
                          <span className="block text-[9px] font-normal text-gray-500">
                            {totalDlbReturns.toLocaleString()} bks
                            {waivedCount > 0 && ` (${(allRawReturnsSum * 10).toLocaleString()} tkt total)`}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-right text-gray-800 font-mono">
                          {effectiveDlbSales > 0 ? (
                            <span>
                              <span className="font-bold">{(effectiveDlbSales * 10).toLocaleString()} tkt</span>
                              <span className="block text-[9px] font-normal text-gray-500">
                                {effectiveDlbSales.toLocaleString()} bks
                              </span>
                            </span>
                          ) : (
                            "--"
                          )}
                        </td>
                        <td className="px-2 py-1 text-right whitespace-nowrap font-mono">
                          {effectiveDlbSales > 0 ? (
                            <span className={returnPercentage > effectiveApprovedLimitPct ? "text-red-600" : "text-emerald-700"}>
                              {returnPercentage.toFixed(2)}%
                            </span>
                          ) : (
                            "--"
                          )}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </section>

        {/* =============================================================
            DLB RETURN ANALYSIS & POLICY COMPLIANCE
           ============================================================= */}
        <section className="rounded-xl border border-indigo-150 bg-white p-4 shadow-sm space-y-3">
          {/* Top Bar: Title, Status, Lottery Picker & Limit Input, Notice Button */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900">DLB Return Analysis &amp; Policy Compliance</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                isExceedingApprovedLimit
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              }`}>
                {isExceedingApprovedLimit ? "⚠️ Over Limit" : "✓ Within Limit"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Select Each Lottery & Change Threshold */}
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
                <span className="text-xs font-medium text-slate-600">Lottery:</span>
                <select
                  value={selectedLotteryId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    setSelectedLotteryId(newId);
                    setInputLimitText(String(getLotteryThreshold(newId, returnThresholds)));
                  }}
                  className="text-xs font-bold bg-white border border-slate-300 rounded px-2 py-0.5 text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {DLB_LOTTERY_LIST.map((lot) => {
                    const currentLimit = getLotteryThreshold(lot.id, returnThresholds);
                    return (
                      <option key={lot.id} value={lot.id}>
                        {lot.name} ({currentLimit}%)
                      </option>
                    );
                  })}
                </select>

                <span className="text-xs font-medium text-slate-600 ml-1">Limit:</span>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    min={0.1}
                    max={100}
                    step={0.5}
                    disabled={isLotteryWaived(selectedLotteryId, returnThresholds)}
                    value={inputLimitText}
                    onChange={(e) => {
                      const txt = e.target.value;
                      setInputLimitText(txt);
                      const val = parseFloat(txt);
                      if (!isNaN(val) && val > 0 && val <= 100) {
                        handleSetLotteryThresholdOptimistic(selectedLotteryId, val);
                      }
                    }}
                    onBlur={() => {
                      const val = parseFloat(inputLimitText);
                      if (isNaN(val) || val <= 0) {
                        setInputLimitText(String(getLotteryThreshold(selectedLotteryId, returnThresholds)));
                      }
                    }}
                    className={`w-14 text-center font-bold text-xs bg-white border border-slate-300 rounded px-1 py-0.5 text-slate-900 focus:outline-none focus:border-indigo-500 ${
                      isLotteryWaived(selectedLotteryId, returnThresholds) ? "opacity-50 cursor-not-allowed bg-slate-100" : ""
                    }`}
                    title="Change return limit for selected lottery (%)"
                  />
                  <span className="text-xs font-bold text-slate-500 ml-1">%</span>
                </div>

                {/* Board Waiver Toggle */}
                <button
                  type="button"
                  onClick={() => void handleToggleWaiveLottery(selectedLotteryId)}
                  className={`ml-1 px-2 py-0.5 rounded text-xs font-bold border transition-colors cursor-pointer flex items-center gap-1 ${
                    isLotteryWaived(selectedLotteryId, returnThresholds)
                      ? "bg-purple-100 text-purple-800 border-purple-300 shadow-2xs"
                      : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100"
                  }`}
                  title={
                    isLotteryWaived(selectedLotteryId, returnThresholds)
                      ? "Click to re-activate in Return % calculation"
                      : "Click to waive/exempt this lottery return from DLB Return %"
                  }
                >
                  <span>
                    {isLotteryWaived(selectedLotteryId, returnThresholds)
                      ? "✓ Waived"
                      : "Waive"}
                  </span>
                </button>

                {isSavingThresholds ? (
                  <span title="Saving to Cloud..." className="inline-flex items-center ml-1">
                    <RefreshCw className="w-3.5 h-3.5 text-amber-500 animate-spin" />
                  </span>
                ) : (
                  <span title="Saved on Cloud (Firestore)" className="inline-flex items-center ml-1">
                    <Cloud className="w-3.5 h-3.5 text-indigo-500" />
                  </span>
                )}
              </div>

              <Link
                href="/return-analysis"
                className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1 transition-colors shadow-2xs"
                title="Open Return Analysis Notice Generator"
              >
                <span>Notice</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* Key Metric Indicators Row (Clean, High Contrast, Minimal Text) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {/* 1. Total Returns */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Returns</span>
                {waivedCount > 0 && (
                  <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-1.5 py-0.2 rounded border border-purple-200">
                    {waivedCount} Waived
                  </span>
                )}
              </div>
              <div className="text-xl font-black text-slate-900 mt-0.5">
                {(totalDlbReturns * 10).toLocaleString()}
                <span className="text-xs font-normal text-slate-500 ml-1">tkt</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                {totalDlbReturns.toLocaleString()} bks
                {waivedCount > 0 && ` (${(allRawReturnsSum * 10).toLocaleString()} tkt total)`}
              </div>
            </div>

            {/* 2. Total Sales */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Sales</span>
                <button
                  type="button"
                  onClick={() => {
                    setManualSalesInput(String(effectiveDlbSales * 10));
                    setIsEditingSales((v) => !v);
                  }}
                  className="p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  title="Edit sales benchmark"
                >
                  <Edit3 className="w-3 h-3" />
                </button>
              </div>
              {isEditingSales ? (
                <div className="flex items-center gap-1 mt-0.5">
                  <input
                    type="number"
                    min={1}
                    value={manualSalesInput}
                    onChange={(e) => setManualSalesInput(e.target.value)}
                    className="w-24 text-xs font-bold border border-indigo-300 rounded px-1 py-0.5 bg-white font-mono"
                    placeholder="e.g. 114880"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const n = Number(manualSalesInput);
                      if (Number.isFinite(n) && n > 0) {
                        setTotalSalesQty(Math.round(n / 10));
                      }
                      setIsEditingSales(false);
                    }}
                    className="px-1.5 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded cursor-pointer"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <>
                  <div className="text-xl font-black text-slate-900 mt-0.5">
                    {(effectiveDlbSales * 10).toLocaleString()}
                    <span className="text-xs font-normal text-slate-500 ml-1">tkt</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {effectiveDlbSales.toLocaleString()} bks
                  </div>
                </>
              )}
            </div>

            {/* 3. Return Percentage */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Return Rate</span>
                <span className="text-[10px] font-bold text-slate-500">
                  Limit: {effectiveApprovedLimitPct.toFixed(1)}%
                </span>
              </div>
              <div className={`text-xl font-black mt-0.5 ${
                isExceedingApprovedLimit ? "text-red-600" : "text-emerald-700"
              }`}>
                {returnPercentage.toFixed(2)}%
              </div>
            </div>

            {/* 4. Margin / Status Indicator */}
            <div className={`rounded-lg p-3 border ${
              isExceedingApprovedLimit
                ? "bg-red-50/70 border-red-200 text-red-900"
                : "bg-emerald-50/70 border-emerald-200 text-emerald-900"
            }`}>
              <span className="text-[11px] font-semibold uppercase tracking-wide">
                {isExceedingApprovedLimit ? "Excess Tickets" : "Safe Buffer"}
              </span>
              <div className="text-xl font-black mt-0.5">
                {isExceedingApprovedLimit
                  ? `+${(excessReturnQty * 10).toLocaleString()}`
                  : `${(safeMarginRemaining * 10).toLocaleString()}`}
                <span className="text-xs font-normal ml-1">tkt</span>
              </div>
              <div className="text-[10px] opacity-75 font-mono mt-0.5">
                {isExceedingApprovedLimit
                  ? `+${excessReturnQty.toLocaleString()} bks`
                  : `${safeMarginRemaining.toLocaleString()} bks`}
              </div>
            </div>
          </div>

          {/* Minimal Progress Line */}
          <div className="relative w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isExceedingApprovedLimit ? "bg-red-500" : "bg-emerald-500"
              }`}
              style={{
                width: `${Math.min(100, Math.max(0, (returnPercentage / (effectiveApprovedLimitPct * 1.5 || 10)) * 100))}%`,
              }}
            />
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
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg shadow-sm">
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
                            onClick={() => void handleToggleWaiveLottery(cfg.gameId || cfg.file.name)}
                            className={`px-2 py-0.5 rounded border text-[11px] font-medium cursor-pointer ${
                              isLotteryWaived(cfg.gameId || cfg.file.name, returnThresholds)
                                ? "bg-purple-100 text-purple-800 border-purple-300 font-bold"
                                : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
                            }`}
                            title="Toggle board waiver for this lottery"
                          >
                            {isLotteryWaived(cfg.gameId || cfg.file.name, returnThresholds) ? "✓ Waived" : "Waive"}
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

                      {/* File Return Quantity & Safe Limit Badge */}
                      {(() => {
                        const isWaived = isLotteryWaived(cfg.gameId || cfg.file.name, returnThresholds);
                        const fileLimit = getLotteryThreshold(cfg.gameId || cfg.file.name, returnThresholds);
                        const isTen = isSpecialTenPercentLottery(cfg.gameId || cfg.file.name);
                        const lotterySales = getLotterySalesForReturn(cfg.gameId, cfg.file.name);
                        const hasSales = lotterySales > 0;
                        const effectiveSales = hasSales ? lotterySales : (fileConfigs.length > 0 ? totalSalesQty / fileConfigs.length : totalSalesQty);
                        const fileAllowedReturns = Math.round(effectiveSales * (fileLimit / 100));
                        const fileReturnPct = effectiveSales > 0 ? ((cfg.returnQty || 0) / effectiveSales) * 100 : 0;
                        const isFileExceeded = !isWaived && (cfg.returnQty || 0) > fileAllowedReturns;

                        return (
                          <div className={`flex flex-col gap-2 p-3 border rounded-lg ${isWaived ? "bg-purple-50/60 border-purple-200" : "bg-indigo-50/70 border-indigo-200"}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-base">🎟️</span>
                                <span className="text-xs font-semibold text-gray-700">File Return Qty:</span>
                                <span className="text-sm font-black text-indigo-700">
                                  {((cfg.returnQty || 0) * 10).toLocaleString()} tickets
                                </span>
                                <span className="text-xs text-gray-500">
                                  ({(cfg.returnQty || 0).toLocaleString()} books @ 10 tkt/bk)
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {isWaived ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-900 border border-purple-300 shadow-2xs">
                                    <span>🛡️</span>
                                    <span>Board Waived</span>
                                    <span className="text-[10px] font-normal text-purple-700">(Exempt from DLB Return %)</span>
                                  </span>
                                ) : isTen ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                                    <span>🛡️</span>
                                    <span>Safe Limit: <b>{fileLimit.toFixed(2)}%</b></span>
                                    <span className="text-[10px] font-normal text-amber-700">(Special: Lagna / Super Ball / Kapruka)</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-900 border border-blue-200 shadow-2xs">
                                    <span>🛡️</span>
                                    <span>Safe Limit: <b>{fileLimit.toFixed(2)}%</b></span>
                                    <span className="text-[10px] font-normal text-blue-700">(Standard DLB Limit)</span>
                                  </span>
                                )}

                                <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                  isWaived
                                    ? "bg-purple-100 text-purple-800 border border-purple-300"
                                    : isFileExceeded
                                    ? "bg-red-100 text-red-800 border border-red-300"
                                    : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                }`}>
                                  {isWaived
                                    ? "✓ Waived by Board"
                                    : isFileExceeded
                                    ? `⚠️ Exceeds ${fileLimit}% Limit (+${(((cfg.returnQty || 0) - fileAllowedReturns) * 10).toLocaleString()} tkt)`
                                    : `✓ Within ${fileLimit}% Limit (${((fileAllowedReturns - (cfg.returnQty || 0)) * 10).toLocaleString()} tkt buffer)`}
                                </span>
                              </div>
                            </div>

                            {/* Sales Analysis from / page */}
                            <div className="flex flex-wrap items-center justify-between text-xs pt-2 border-t border-indigo-200/60 text-gray-700">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-gray-500 font-medium">Sales Report from / page:</span>
                                {hasSales ? (
                                  <span className="font-mono font-bold text-gray-900 bg-white px-2 py-0.5 rounded border border-indigo-200">
                                    {(lotterySales * 10).toLocaleString()} tickets sold
                                    <span className="text-[10px] text-gray-500 font-normal ml-1">
                                      ({lotterySales.toLocaleString()} bks)
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-gray-400 italic text-[11px]">
                                    (No individual sales report on / for {formatDateToDDMMYYYY(businessDate)})
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-gray-500 font-medium">Return Rate:</span>
                                <b className={`font-mono text-sm ${isFileExceeded ? "text-red-600" : "text-emerald-700"}`}>
                                  {fileReturnPct.toFixed(2)}%
                                </b>
                                <span className="text-[10px] text-gray-500">
                                  {hasSales ? "of actual sales on /" : "of benchmark"}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

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

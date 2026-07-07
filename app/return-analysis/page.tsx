"use client";

import React, { useMemo, useState, useEffect } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { listUploadedFilesByDate, listUploadedFilesByDateRange, UploadedFileRecord } from "../lib/uploadService";
import { listReturnUploadedFilesByDate, listReturnUploadedFilesByDateRange, ReturnUploadedFileRecord } from "../lib/returnUploadService";

/**
 * Allowed lottery types per weekday (ERP codes are treated as lottery types)
 */
export const ERP_GAME_MAP: Record<string, Record<string, string>> = {
  Monday: { LWM: "LMO", AKM: "AMO", SFM: "SFM", SBM: "SBM", KTM: "KPM", SPM: "SRM", VM: "DMO", SM: "JMO" },
  Tuesday: { LWA: "LWT", AKA: "ATU", SFA: "SFT", SBA: "BTU", KTT: "KPT", SPA: "SRT", VA: "DTU", SA: "JST" },
  Wednesday: { LWW: "LWW", AKW: "AWD", SFW: "SFW", SBW: "SBW", KTW: "KPW", SPW: "SWD", VW: "DWD", SW: "JSW" },
  Thursday: { LWB: "LTH", AKT: "ATH", SFT: "SFH", SBT: "SBT", KTB: "KTH", SPT: "STH", VT: "DTH", ST: "JTH" },
  Friday: { LWF: "LWF", AKF: "AFR", SFF: "SFR", SBF: "SBF", KTF: "KPF", SPF: "SRF", VF: "DFI", SF: "JFR" },
  Saturday: { LWS: "LSA", AKS: "ASA", SFS: "SFS", SBS: "SBS", KTS: "KSA", SPS: "SRS", VS: "DSA", SS: "JSA" },
  Sunday: { LWI: "LWS", AKI: "ASU", SFI: "SFU", SBI: "SSU", KTI: "KPS", SPI: "SRU", VI: "DSU", SI: "JSU" },
};

type SaleRow = { agentCode: string; qty: number; agentName?: string };
type ReturnRow = { agentCode: string; qty: number };

type ResultRow = {
  rank: number;
  agentCode: string;
  agentName?: string;
  lotteryType: string;
  salesQty: number;
  returnQty: number;
  actualSales: number;
  returnPct: number;
};

type TypeResult = {
  lotteryType: string;
  top: ResultRow[];
  totals: {
    uniqueAgents: number;
    totalSalesQty: number;
    totalReturnQty: number;
    overallReturnPct: number; // totalReturn/totalSales*100
  };
};

type AgentResultRow = {
  rank: number;
  agentCode: string;
  agentName?: string;
  salesQty: number;
  returnQty: number;
  actualSales: number;
  returnPct: number;
};

function normalizeAgentCode(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 4 && digits.length <= 6) return digits.padStart(6, "0");
  if (digits.length === 0) return s;
  return digits;
}

function toNumber(v: unknown): number {
  const n = Number(String(v ?? "").toString().replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function isLikelyHeaderCell(v: unknown): boolean {
  const s = String(v ?? "").toUpperCase();
  return (
    s.includes("AGENT") ||
    s.includes("CODE") ||
    s.includes("NAME") ||
    s.includes("QTY") ||
    s.includes("FROM") ||
    s.includes("TO") ||
    s.includes("TOTAL") ||
    s.includes("SUMMARY") ||
    s.includes("LOTTERY") ||
    s.includes("BOARD")
  );
}

async function readSheet2D(file: File): Promise<(string | number | boolean | null)[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const wsName = wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as (string | number | boolean | null)[][];
}

/**
 * SALES heuristic:
 * - AgentCode usually in col 0
 * - AgentName usually in col 1
 * - Qty usually in col 4
 */
function parseSales(data2d: (string | number | boolean | null)[][]): SaleRow[] {
  const rows: SaleRow[] = [];
  for (const r of data2d) {
    if (!r || r.length === 0) continue;

    const c0 = r[0];
    const c1 = r[1];
    const c4 = r[4];

    if (isLikelyHeaderCell(c0) || isLikelyHeaderCell(c1)) continue;

    const agentCode = normalizeAgentCode(c0);
    const agentName = String(c1 ?? "").trim();
    const qty = toNumber(c4);

    if (!agentCode) continue;
    if (!qty || qty <= 0) continue;

    const upper = agentCode.toUpperCase();
    if (upper === "NAME" || upper === "TOTAL") continue;

    rows.push({ agentCode, qty, agentName: agentName || undefined });
  }
  return rows;
}

/**
 * RETURNS heuristic:
 * - AgentCode usually in col 1
 * - Qty usually in col 8
 */
function parseReturns(data2d: (string | number | boolean | null)[][]): ReturnRow[] {
  const rows: ReturnRow[] = [];
  for (const r of data2d) {
    if (!r || r.length === 0) continue;

    const c1 = r[1];
    const c8 = r[8];

    if (isLikelyHeaderCell(c1)) continue;

    const agentCode = normalizeAgentCode(c1);
    const qty = toNumber(c8);

    if (!agentCode) continue;
    if (!qty || qty <= 0) continue;

    const upper = agentCode.toUpperCase();
    if (upper === "NAME" || upper === "TOTAL") continue;

    rows.push({ agentCode, qty });
  }
  return rows;
}

function groupSum(rows: { agentCode: string; qty: number }[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.agentCode, (m.get(r.agentCode) ?? 0) + r.qty);
  return m;
}

function buildNameMap(rows: SaleRow[]) {
  const m = new Map<string, string>();
  for (const r of rows) if (r.agentName) m.set(r.agentCode, r.agentName);
  return m;
}

function getWeekdayLabel(isoDate: string): keyof typeof ERP_GAME_MAP | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  const dayIdx = dt.getDay();
  const map: Record<number, keyof typeof ERP_GAME_MAP> = {
    0: "Sunday",
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
  };
  return map[dayIdx] ?? null;
}

function allowedLotteryTypesForDay(day: keyof typeof ERP_GAME_MAP | null): string[] {
  if (!day) return [];
  return Object.keys(ERP_GAME_MAP[day]);
}

/**
 * Infer lottery type from filename by matching allowed type tokens.
 */
function inferLotteryTypeFromFilename(filename: string, allowedTypes: string[]): string | null {
  const upper = filename.toUpperCase();
  for (const t of allowedTypes) {
    const re = new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`, "i");
    if (re.test(upper)) return t;
  }
  return null;
}

/** ---------- FIX EXCEL EXPORT: sanitize + unique sheet names ---------- */
function sanitizeSheetName(name: string) {
  const cleaned = name.replace(/[\\\/\?\*\[\]]/g, " ").trim();
  const short = cleaned.slice(0, 31);
  return short.length ? short : "Sheet";
}

function makeUniqueSheetName(base: string, used: Set<string>) {
  const initial = sanitizeSheetName(base);
  if (!used.has(initial)) {
    used.add(initial);
    return initial;
  }
  let i = 2;
  while (true) {
    const suffix = `_${i}`;
    const truncated = initial.slice(0, Math.max(0, 31 - suffix.length)) + suffix;
    if (!used.has(truncated)) {
      used.add(truncated);
      return truncated;
    }
    i++;
  }
}

function formatDateYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeekRange(dateStr: string): { start: string; end: string } {
  if (!dateStr) return { start: "", end: "" };
  const parts = dateStr.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = d.getDay(); // 0 is Sunday, 1 is Monday, etc.
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: formatDateYYYYMMDD(monday),
    end: formatDateYYYYMMDD(sunday),
  };
}

function getMonthRange(dateStr: string): { start: string; end: string } {
  if (!dateStr) return { start: "", end: "" };
  const parts = dateStr.split("-").map(Number);
  const year = parts[0];
  const monthIdx = parts[1] - 1; // 0-indexed
  const firstDay = new Date(year, monthIdx, 1);
  const lastDay = new Date(year, monthIdx + 1, 0);
  return {
    start: formatDateYYYYMMDD(firstDay),
    end: formatDateYYYYMMDD(lastDay),
  };
}

function downloadAllAsExcel(
  filename: string,
  meta: { date: string; mode: string; dateRange: string },
  rows: AgentResultRow[],
  totals: {
    uniqueAgents: number;
    totalSalesQty: number;
    totalReturnQty: number;
    overallReturnPct: number;
  }
) {
  const wb = XLSX.utils.book_new();

  const headerMeta = [
    ["Report Mode", meta.mode.toUpperCase()],
    ["Base Date", meta.date],
    ["Date Range", meta.dateRange],
    ["Unique Agents", totals.uniqueAgents],
    ["Total Sales Qty", totals.totalSalesQty],
    ["Total Return Qty", totals.totalReturnQty],
    ["Overall Return %", Number(totals.overallReturnPct.toFixed(2))],
    [],
  ];

  const exportRows = rows.map((r) => ({
    Rank: r.rank,
    AgentCode: r.agentCode,
    AgentName: r.agentName ?? "",
    SalesQty: r.salesQty,
    ReturnQty: r.returnQty,
    ActualSales: r.actualSales,
    ReturnPct: Number(r.returnPct.toFixed(2)),
  }));

  const ws = XLSX.utils.aoa_to_sheet(headerMeta);
  XLSX.utils.sheet_add_json(ws, exportRows, { origin: "A9" });

  XLSX.utils.book_append_sheet(wb, ws, "Agent Returns Summary");
  XLSX.writeFile(wb, filename);
}

/** ---------- PDF EXPORT (professional report) ---------- */
function downloadAllAsPdf(
  filename: string,
  meta: { date: string; mode: string; dateRange: string },
  rows: AgentResultRow[],
  totals: {
    uniqueAgents: number;
    totalSalesQty: number;
    totalReturnQty: number;
    overallReturnPct: number;
  }
) {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

  const marginX = 14;
  let y = 18;

  // Header (simple + professional)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Lottery Sales vs Returns Report", marginX, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Report Mode: ${meta.mode.toUpperCase()}    Range: ${meta.dateRange}`, marginX, y);
  y += 8;

  // Overall summary
  doc.setDrawColor(220);
  doc.setFillColor(245, 246, 248);
  doc.roundedRect(marginX, y, 182, 18, 3, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Overall Summary", marginX + 4, y + 6);

  doc.setFont("helvetica", "normal");
  doc.text(`Total Sales Qty: ${totals.totalSalesQty}`, marginX + 4, y + 12);
  doc.text(`Total Return Qty: ${totals.totalReturnQty}`, marginX + 70, y + 12);
  doc.text(`Overall Return %: ${totals.overallReturnPct.toFixed(2)}%`, marginX + 140, y + 12);
  y += 26;

  autoTable(doc, {
    startY: y,
    head: [["Rank", "Agent Code", "Agent Name", "Sales Qty", "Return Qty", "Actual Sales", "Return %"]],
    body: rows.map((r) => [
      r.rank,
      r.agentCode,
      r.agentName ?? "",
      r.salesQty,
      r.returnQty,
      r.actualSales,
      `${r.returnPct.toFixed(2)}%`,
    ]),
    styles: { font: "helvetica", fontSize: 9, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" }, // slate-like
    alternateRowStyles: { fillColor: [245, 246, 248] },
    margin: { left: marginX, right: marginX },
  });

  doc.save(filename);
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function ReturnAnalysisPage() {
  const [selectedDate, setSelectedDate] = useState<string>(todayKey());

  // MULTI UPLOAD
  const [salesFiles, setSalesFiles] = useState<File[]>([]);
  const [returnFiles, setReturnFiles] = useState<File[]>([]);

  // Download format
  const [downloadFormat, setDownloadFormat] = useState<"excel" | "pdf">("excel");

  // Parsed/grouped results
  const [allAgentResults, setAllAgentResults] = useState<AgentResultRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // DB files states
  const [dbErpFiles, setDbErpFiles] = useState<UploadedFileRecord[]>([]);
  const [dbReturnFiles, setDbReturnFiles] = useState<ReturnUploadedFileRecord[]>([]);
  const [isLoadingDbFiles, setIsLoadingDbFiles] = useState(false);
  const [isFetchingSaved, setIsFetchingSaved] = useState(false);

  // User filter & exclusion states
  const [reportMode, setReportMode] = useState<"daily" | "weekly" | "monthly">("daily");
  const [returnThreshold, setReturnThreshold] = useState<number>(5);
  const [showOnlyExceeded, setShowOnlyExceeded] = useState<boolean>(false);
  const [excludedAgents, setExcludedAgents] = useState<Set<string>>(new Set());

  const weekday = useMemo(() => getWeekdayLabel(selectedDate), [selectedDate]);
  const allowedTypes = useMemo(() => allowedLotteryTypesForDay(weekday), [weekday]);

  function resetComputed() {
    setAllAgentResults([]);
    setExcludedAgents(new Set());
  }

  const activeDateRange = useMemo(() => {
    if (!selectedDate) return { start: "", end: "" };
    if (reportMode === "daily") {
      return { start: selectedDate, end: selectedDate };
    } else if (reportMode === "weekly") {
      return getWeekRange(selectedDate);
    } else {
      return getMonthRange(selectedDate);
    }
  }, [selectedDate, reportMode]);

  const filteredResults = useMemo(() => {
    let list = allAgentResults.filter((r) => !excludedAgents.has(r.agentCode));

    if (showOnlyExceeded) {
      list = list.filter((r) => r.returnPct >= returnThreshold);
    }

    list.sort((a, b) => b.returnPct - a.returnPct);

    return list.map((r, idx) => ({
      ...r,
      rank: idx + 1,
    }));
  }, [allAgentResults, excludedAgents, showOnlyExceeded, returnThreshold]);

  const overallTotals = useMemo(() => {
    let totalSalesQty = 0;
    let totalReturnQty = 0;

    for (const r of filteredResults) {
      totalSalesQty += r.salesQty;
      totalReturnQty += r.returnQty;
    }

    const overallReturnPct = totalSalesQty > 0 ? (totalReturnQty / totalSalesQty) * 100 : 0;

    return {
      uniqueAgents: filteredResults.length,
      totalSalesQty,
      totalReturnQty,
      overallReturnPct,
    };
  }, [filteredResults]);

  // Filter saved files so we only include days that have both ERP and Return uploads
  const { activeErpFiles, activeReturnFiles, activeDates } = useMemo(() => {
    if (reportMode === "daily") {
      return {
        activeErpFiles: dbErpFiles,
        activeReturnFiles: dbReturnFiles,
        activeDates: new Set(selectedDate ? [selectedDate] : []),
      };
    }

    const erpDates = new Set(dbErpFiles.map((f) => f.uploadDate));
    const returnDates = new Set(dbReturnFiles.map((f) => f.uploadDate));
    const intersection = new Set([...erpDates].filter((d) => returnDates.has(d)));

    return {
      activeErpFiles: dbErpFiles.filter((f) => intersection.has(f.uploadDate)),
      activeReturnFiles: dbReturnFiles.filter((f) => intersection.has(f.uploadDate)),
      activeDates: intersection,
    };
  }, [dbErpFiles, dbReturnFiles, reportMode, selectedDate]);

  // Fetch files in database for selected date range
  useEffect(() => {
    if (!activeDateRange.start || !activeDateRange.end) {
      setDbErpFiles([]);
      setDbReturnFiles([]);
      return;
    }

    let isMounted = true;
    setIsLoadingDbFiles(true);

    const erpPromise = reportMode === "daily" 
      ? listUploadedFilesByDate(selectedDate) 
      : listUploadedFilesByDateRange(activeDateRange.start, activeDateRange.end);

    const retPromise = reportMode === "daily"
      ? listReturnUploadedFilesByDate(selectedDate)
      : listReturnUploadedFilesByDateRange(activeDateRange.start, activeDateRange.end);

    Promise.all([erpPromise, retPromise])
      .then(([erpFiles, retFiles]) => {
        if (!isMounted) return;
        setDbErpFiles(erpFiles);
        setDbReturnFiles(retFiles);
        setIsLoadingDbFiles(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Error loading DB files:", err);
        setIsLoadingDbFiles(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedDate, reportMode, activeDateRange]);

  async function runAnalysisForFiles(sFiles: File[], rFiles: File[]) {
    setError(null);
    setAllAgentResults([]);

    if (!selectedDate) return setError("Please select a date first.");
    if (sFiles.length === 0) return setError("Please upload at least one Sales file.");

    setIsBusy(true);
    try {
      const allSalesRows: SaleRow[] = [];
      const allReturnRows: ReturnRow[] = [];

      for (const f of sFiles) {
        const d = await readSheet2D(f);
        allSalesRows.push(...parseSales(d));
      }

      if (!allSalesRows.length) {
        throw new Error("No valid sales records parsed from the files.");
      }

      for (const f of rFiles) {
        const d = await readSheet2D(f);
        allReturnRows.push(...parseReturns(d));
      }

      const salesSum = new Map<string, number>();
      const nameMap = new Map<string, string>();
      for (const row of allSalesRows) {
        salesSum.set(row.agentCode, (salesSum.get(row.agentCode) ?? 0) + row.qty);
        if (row.agentName) {
          nameMap.set(row.agentCode, row.agentName);
        }
      }

      const returnSum = new Map<string, number>();
      for (const row of allReturnRows) {
        returnSum.set(row.agentCode, (returnSum.get(row.agentCode) ?? 0) + row.qty);
      }

      const merged: AgentResultRow[] = [];
      for (const [agentCode, salesQty] of salesSum.entries()) {
        if (salesQty <= 0) continue;
        const returnQty = returnSum.get(agentCode) ?? 0;
        const returnPct = (returnQty / salesQty) * 100;

        merged.push({
          rank: 0,
          agentCode,
          agentName: nameMap.get(agentCode),
          salesQty,
          returnQty,
          actualSales: salesQty - returnQty,
          returnPct,
        });
      }

      merged.sort((a, b) => b.returnPct - a.returnPct);
      setAllAgentResults(merged);
      setExcludedAgents(new Set()); // Reset exclusion on fresh run
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to parse files.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRun() {
    await runAnalysisForFiles(salesFiles, returnFiles);
  }

  async function handleLoadSavedAndRun() {
    setError(null);
    resetComputed();

    if (!selectedDate) return setError("Please select a date first.");
    if (activeErpFiles.length === 0) {
      return setError(`No dates with both ERP and Return files found in the selected range.`);
    }

    setIsFetchingSaved(true);
    setIsBusy(true);

    try {
      const fetchedSales: File[] = [];
      const fetchedReturns: File[] = [];

      for (const u of activeErpFiles) {
        if (!u.downloadUrl) continue;
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(u.downloadUrl)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`Failed to fetch saved ERP file: ${u.fileName}`);
        const blob = await res.blob();
        const file = new File([blob], u.fileName, {
          type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        fetchedSales.push(file);
      }

      for (const u of activeReturnFiles) {
        if (!u.downloadUrl) continue;
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(u.downloadUrl)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`Failed to fetch saved Return file: ${u.fileName}`);
        const blob = await res.blob();
        const file = new File([blob], u.fileName, {
          type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        fetchedReturns.push(file);
      }

      setSalesFiles(fetchedSales);
      setReturnFiles(fetchedReturns);

      await runAnalysisForFiles(fetchedSales, fetchedReturns);
    } catch (err: any) {
      setError(err?.message || "Error fetching saved files.");
    } finally {
      setIsFetchingSaved(false);
      setIsBusy(false);
    }
  }

  function handleDownload() {
    if (!filteredResults.length) return;

    const dateRangeStr =
      reportMode === "daily"
        ? selectedDate
        : `${activeDateRange.start} to ${activeDateRange.end}`;

    const meta = {
      date: selectedDate,
      mode: reportMode,
      dateRange: dateRangeStr,
    };

    if (downloadFormat === "excel") {
      downloadAllAsExcel(
        `agent_return_analysis_${selectedDate || "date"}.xlsx`,
        meta,
        filteredResults,
        overallTotals
      );
    } else {
      downloadAllAsPdf(
        `agent_return_analysis_${selectedDate || "date"}.pdf`,
        meta,
        filteredResults,
        overallTotals
      );
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Lottery Sales vs Returns Analyzer</h1>
            <p className="mt-2 text-sm text-slate-600">
              Consolidated Agent Total Sales & Returns. View Daily, Weekly, or Monthly metrics, set return thresholds, and clean agent lists before exporting.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Controls */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 self-start">
            <h2 className="text-base font-semibold">Report Controls</h2>

            {/* Report Mode Selection */}
            <label className="mt-4 block text-sm font-medium text-slate-700">Report Period</label>
            <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1">
              {(["daily", "weekly", "monthly"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setReportMode(mode);
                    resetComputed();
                  }}
                  className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                    reportMode === mode
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Anchor Date Input */}
            <label className="mt-4 block text-sm font-medium text-slate-700">Anchor Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                resetComputed();
              }}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
            />

            {/* Date Details Info Box */}
            <div className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700 space-y-1">
              <div>
                <span className="font-semibold">Selected Range:</span>{" "}
                {reportMode === "daily"
                  ? selectedDate
                  : `${activeDateRange.start} to ${activeDateRange.end}`}
              </div>
              {reportMode === "daily" && weekday && (
                <div>
                  <span className="font-semibold">Day:</span> {weekday}
                </div>
              )}
            </div>

            {/* Return Threshold Controls */}
            <label className="mt-4 block text-sm font-medium text-slate-700">Return Limit %</label>
            <div className="mt-2 flex gap-3 items-center">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={returnThreshold}
                onChange={(e) => setReturnThreshold(Number(e.target.value))}
                className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-slate-400"
              />
              <span className="text-xs text-slate-500">% return threshold</span>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                id="showOnlyExceeded"
                checked={showOnlyExceeded}
                onChange={(e) => setShowOnlyExceeded(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
              />
              <label htmlFor="showOnlyExceeded" className="text-xs text-slate-700 font-medium select-none cursor-pointer">
                Show only agents exceeding limit ({returnThreshold}%)
              </label>
            </div>

            {/* Database Files Status */}
            {selectedDate && (
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-2">
                <div className="font-semibold text-slate-800">
                  Database Files ({reportMode === "daily" ? "Daily" : reportMode === "weekly" ? "Weekly" : "Monthly"})
                </div>
                {isLoadingDbFiles ? (
                  <div className="text-slate-500 animate-pulse">Checking saved files...</div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span>ERP Summary Files:</span>
                      <span className="font-bold text-slate-900">
                        {dbErpFiles.length} {reportMode !== "daily" && `(${activeErpFiles.length} active)`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Return Files:</span>
                      <span className="font-bold text-slate-900">
                        {dbReturnFiles.length} {reportMode !== "daily" && `(${activeReturnFiles.length} active)`}
                      </span>
                    </div>
                    {reportMode !== "daily" && (
                      <div className="text-[10px] text-slate-500 mt-1 border-t border-slate-100 pt-1.5">
                        * Only days with <b>both</b> Sales and Return uploads are active ({activeDates.size} days).
                      </div>
                    )}

                    {activeErpFiles.length > 0 ? (
                      <button
                        onClick={handleLoadSavedAndRun}
                        disabled={isBusy}
                        className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition shadow-sm"
                      >
                        {isFetchingSaved ? "Downloading & Analyzing..." : "Load & Run Auto Analysis"}
                      </button>
                    ) : (
                      <div className="mt-1 text-[11px] text-amber-600 font-medium">
                        No active files to analyze for this range.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="my-5 border-t border-slate-200"></div>

            {/* Manual Uploads Option */}
            <h3 className="text-sm font-semibold text-slate-800">Or Manual Upload Files</h3>

            <label className="mt-4 block text-sm font-medium text-slate-700">Sales files (.xlsx) — multiple</label>
            <input
              type="file"
              accept=".xlsx,.xls"
              multiple
              onChange={(e) => {
                setSalesFiles(Array.from(e.target.files ?? []));
                resetComputed();
              }}
              className="mt-2 block w-full text-sm"
            />
            <div className="mt-1 text-xs text-slate-500">Uploaded: {salesFiles.length}</div>

            <label className="mt-4 block text-sm font-medium text-slate-700">Return files (.xlsx) — multiple</label>
            <input
              type="file"
              accept=".xlsx,.xls"
              multiple
              onChange={(e) => {
                setReturnFiles(Array.from(e.target.files ?? []));
                resetComputed();
              }}
              className="mt-2 block w-full text-sm"
            />
            <div className="mt-1 text-xs text-slate-500">Uploaded: {returnFiles.length}</div>

            <button
              onClick={handleRun}
              disabled={isBusy}
              className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
            >
              {isBusy ? "Processing..." : "Run Analysis"}
            </button>

            {error && (
              <div className="mt-4 whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mt-5 rounded-xl bg-slate-100 px-3 py-3 text-xs text-slate-700">
              <div className="font-semibold">Logic</div>
              <div className="mt-1">Return% = (ReturnQty / SalesQty) × 100</div>
              <div className="mt-1">ActualSales = SalesQty − ReturnQty</div>
              <div className="mt-2 text-slate-600">
                Consolidated agent totals combine sales and returns across all matched files in the selected time window.
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="lg:col-span-2 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-semibold">Agent Returns Report</h2>
                <p className="mt-1 text-xs text-slate-600">
                  Range: <span className="font-semibold">{activeDateRange.start} to {activeDateRange.end}</span>{" "}
                  • Active Agents: <span className="font-semibold">{filteredResults.length}</span>
                  {excludedAgents.size > 0 && (
                    <span className="ml-2 text-slate-500">({excludedAgents.size} excluded)</span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={downloadFormat}
                  onChange={(e) => setDownloadFormat(e.target.value as "excel" | "pdf")}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-slate-400"
                  disabled={!filteredResults.length}
                >
                  <option value="excel">Excel Summary</option>
                  <option value="pdf">PDF Report</option>
                </select>

                <button
                  onClick={handleDownload}
                  disabled={!filteredResults.length}
                  className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition shadow-sm"
                >
                  Download
                </button>
              </div>
            </div>

            {excludedAgents.size > 0 && (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2 text-xs">
                <span className="text-indigo-800">
                  Some agents have been excluded from this report list.
                </span>
                <button
                  onClick={() => setExcludedAgents(new Set())}
                  className="font-bold text-indigo-700 hover:text-indigo-900 underline"
                >
                  Restore all removed agents ({excludedAgents.size})
                </button>
              </div>
            )}

            {!filteredResults.length ? (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                {allAgentResults.length > 0 
                  ? "No agents match the current filter criteria."
                  : "Upload files or load from database to see the consolidated agent report."}
              </div>
            ) : (
              <div className="mt-4 space-y-6">
                {/* Overall Summary Card */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div>
                    <div className="text-xs text-slate-500 font-medium">Total Agents</div>
                    <div className="text-lg font-bold text-slate-950 mt-0.5">{overallTotals.uniqueAgents}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 font-medium">Total Sales Qty</div>
                    <div className="text-lg font-bold text-slate-950 mt-0.5">{overallTotals.totalSalesQty.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 font-medium">Total Return Qty</div>
                    <div className="text-lg font-bold text-slate-950 mt-0.5">{overallTotals.totalReturnQty.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 font-medium">Overall Return %</div>
                    <div className="text-lg font-bold text-slate-950 mt-0.5">{overallTotals.overallReturnPct.toFixed(2)}%</div>
                  </div>
                </div>

                {/* Agents List Table */}
                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-700">
                        <tr>
                          <th className="px-3 py-2.5 text-left font-medium">Rank</th>
                          <th className="px-3 py-2.5 text-left font-medium">Agent Code</th>
                          <th className="px-3 py-2.5 text-left font-medium">Agent Name</th>
                          <th className="px-3 py-2.5 text-right font-medium">Sales Qty</th>
                          <th className="px-3 py-2.5 text-right font-medium">Return Qty</th>
                          <th className="px-3 py-2.5 text-right font-medium">Actual Sales</th>
                          <th className="px-3 py-2.5 text-right font-medium">Return %</th>
                          <th className="px-3 py-2.5 text-center font-medium">Actions</th>
                        </tr>
                      </thead>

                      <tbody>
                        {filteredResults.map((r) => {
                          const isExceeded = r.returnPct >= returnThreshold;
                          return (
                            <tr 
                              key={r.agentCode} 
                              className={`border-t border-slate-200 transition-colors ${
                                isExceeded ? "bg-rose-50/50 hover:bg-rose-50" : "hover:bg-slate-50/80"
                              }`}
                            >
                              <td className="px-3 py-2.5">{r.rank}</td>
                              <td className="px-3 py-2.5 font-mono text-xs font-semibold">{r.agentCode}</td>
                              <td className="px-3 py-2.5 text-slate-700 truncate max-w-[150px]" title={r.agentName}>{r.agentName ?? "—"}</td>
                              <td className="px-3 py-2.5 text-right">{r.salesQty.toLocaleString()}</td>
                              <td className="px-3 py-2.5 text-right">{r.returnQty.toLocaleString()}</td>
                              <td className="px-3 py-2.5 text-right">{r.actualSales.toLocaleString()}</td>
                              <td className={`px-3 py-2.5 text-right font-bold ${
                                isExceeded ? "text-rose-600" : "text-slate-900"
                              }`}>
                                {r.returnPct.toFixed(2)}%
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <button
                                  onClick={() => {
                                    setExcludedAgents((prev) => {
                                      const next = new Set(prev);
                                      next.add(r.agentCode);
                                      return next;
                                    });
                                  }}
                                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600 transition"
                                  title="Remove agent from list"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mx-auto">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="text-xs text-slate-500 space-y-1">
                  <div>* Excluded agents are fully removed from both screen results and downloaded PDF/Excel reports.</div>
                  <div>* Returns exceeding the {returnThreshold}% limit are marked in red for easy identification.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

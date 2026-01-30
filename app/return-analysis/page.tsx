"use client";

import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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

function downloadAllAsExcel(filename: string, meta: { date: string; day: string }, typeResults: TypeResult[]) {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  for (const tr of typeResults) {
    const headerMeta = [
      ["Date", meta.date],
      ["Day", meta.day],
      ["LotteryType", tr.lotteryType],
      ["UniqueAgents", tr.totals.uniqueAgents],
      ["TotalSalesQty", tr.totals.totalSalesQty],
      ["TotalReturnQty", tr.totals.totalReturnQty],
      ["OverallReturnPct", Number(tr.totals.overallReturnPct.toFixed(2))],
      [],
    ];

    const exportRows = tr.top.map((r) => ({
      Rank: r.rank,
      AgentCode: r.agentCode,
      AgentName: r.agentName ?? "",
      LotteryType: r.lotteryType,
      SalesQty: r.salesQty,
      ReturnQty: r.returnQty,
      ActualSales: r.actualSales,
      ReturnPct: Number(r.returnPct.toFixed(2)),
    }));

    const ws = XLSX.utils.aoa_to_sheet(headerMeta);
    XLSX.utils.sheet_add_json(ws, exportRows, { origin: "A9" });

    const sheetName = makeUniqueSheetName(tr.lotteryType, used);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  XLSX.writeFile(wb, filename);
}

/** ---------- PDF EXPORT (professional report) ---------- */
function downloadAllAsPdf(filename: string, meta: { date: string; day: string }, typeResults: TypeResult[]) {
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
  doc.text(`Date: ${meta.date}    Day: ${meta.day}`, marginX, y);
  y += 8;

  // Overall summary
  const overallSales = typeResults.reduce((s, t) => s + t.totals.totalSalesQty, 0);
  const overallReturns = typeResults.reduce((s, t) => s + t.totals.totalReturnQty, 0);
  const overallPct = overallSales > 0 ? (overallReturns / overallSales) * 100 : 0;

  doc.setDrawColor(220);
  doc.setFillColor(245, 246, 248);
  doc.roundedRect(marginX, y, 182, 18, 3, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Overall Summary", marginX + 4, y + 6);

  doc.setFont("helvetica", "normal");
  doc.text(`Total Sales Qty: ${overallSales}`, marginX + 4, y + 12);
  doc.text(`Total Return Qty: ${overallReturns}`, marginX + 70, y + 12);
  doc.text(`Overall Return %: ${overallPct.toFixed(2)}%`, marginX + 140, y + 12);
  y += 26;

  // Sections per lottery type
  for (const tr of typeResults) {
    if (y > 250) {
      doc.addPage();
      y = 18;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`Lottery Type: ${tr.lotteryType}`, marginX, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      `Agents: ${tr.totals.uniqueAgents}   SalesQty: ${tr.totals.totalSalesQty}   ReturnQty: ${tr.totals.totalReturnQty}   Overall Return%: ${tr.totals.overallReturnPct.toFixed(2)}%`,
      marginX,
      y
    );
    y += 4;

    autoTable(doc, {
      startY: y + 4,
      head: [["Rank", "Agent Code", "Agent Name", "Sales Qty", "Return Qty", "Actual Sales", "Return %"]],
      body: tr.top.map((r) => [
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

    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  }

  doc.save(filename);
}

export default function ReturnAnalysisPage() {
  const [selectedDate, setSelectedDate] = useState<string>("");

  // MULTI UPLOAD
  const [salesFiles, setSalesFiles] = useState<File[]>([]);
  const [returnFiles, setReturnFiles] = useState<File[]>([]);

  // Download format
  const [downloadFormat, setDownloadFormat] = useState<"excel" | "pdf">("excel");

  // Parsed/grouped results
  const [typeResults, setTypeResults] = useState<TypeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const weekday = useMemo(() => getWeekdayLabel(selectedDate), [selectedDate]);
  const allowedTypes = useMemo(() => allowedLotteryTypesForDay(weekday), [weekday]);

  function resetComputed() {
    setTypeResults([]);
  }

  async function handleRun() {
    setError(null);
    resetComputed();

    if (!selectedDate) return setError("Please select a date first.");
    if (!weekday) return setError("Invalid date.");
    if (!allowedTypes.length) return setError(`No lottery types configured for ${weekday}.`);

    if (salesFiles.length === 0) return setError("Please upload at least one Sales file.");
    // returns can be 0 files (maybe no returns today); still allowed

    // Validate + classify files by type inferred from filename
    const salesByType = new Map<string, File[]>();
    const returnByType = new Map<string, File[]>();

    const badNames: string[] = [];

    for (const f of salesFiles) {
      const t = inferLotteryTypeFromFilename(f.name, allowedTypes);
      if (!t) badNames.push(`Sales: ${f.name}`);
      else salesByType.set(t, [...(salesByType.get(t) ?? []), f]);
    }

    for (const f of returnFiles) {
      const t = inferLotteryTypeFromFilename(f.name, allowedTypes);
      if (!t) badNames.push(`Return: ${f.name}`);
      else returnByType.set(t, [...(returnByType.get(t) ?? []), f]);
    }

    if (badNames.length) {
      return setError(
        `Some files do not contain a valid lottery type for ${weekday}.\n` +
          `Allowed: ${allowedTypes.join(", ")}\n\n` +
          `Invalid:\n- ${badNames.join("\n- ")}`
      );
    }

    // Enforce: only lottery types that have SALES will be processed
    const typesToProcess = Array.from(salesByType.keys()).sort();

    setIsBusy(true);
    try {
      const finalResults: TypeResult[] = [];

      for (const lotteryType of typesToProcess) {
        const sFiles = salesByType.get(lotteryType) ?? [];
        const rFiles = returnByType.get(lotteryType) ?? [];

        const allSalesRows: SaleRow[] = [];
        const allReturnRows: ReturnRow[] = [];

        for (const f of sFiles) {
          const d = await readSheet2D(f);
          allSalesRows.push(...parseSales(d));
        }

        if (!allSalesRows.length) continue;

        for (const f of rFiles) {
          const d = await readSheet2D(f);
          allReturnRows.push(...parseReturns(d));
        }

        const salesSum = groupSum(allSalesRows);
        const returnSum = groupSum(allReturnRows);
        const nameMap = buildNameMap(allSalesRows);

        const merged: Omit<ResultRow, "rank">[] = [];
        let totalSalesQty = 0;
        let totalReturnQty = 0;

        for (const [agentCode, salesQty] of salesSum.entries()) {
          if (salesQty <= 0) continue;
          const rQty = returnSum.get(agentCode) ?? 0;
          const returnPct = (rQty / salesQty) * 100;

          totalSalesQty += salesQty;
          totalReturnQty += rQty;

          merged.push({
            agentCode,
            agentName: nameMap.get(agentCode),
            lotteryType,
            salesQty,
            returnQty: rQty,
            actualSales: salesQty - rQty,
            returnPct,
          });
        }

        merged.sort((a, b) => b.returnPct - a.returnPct);
        const top = merged.slice(0, 15).map((r, idx) => ({ rank: idx + 1, ...r }));

        const overallReturnPct = totalSalesQty > 0 ? (totalReturnQty / totalSalesQty) * 100 : 0;

        finalResults.push({
          lotteryType,
          top,
          totals: {
            uniqueAgents: salesSum.size,
            totalSalesQty,
            totalReturnQty,
            overallReturnPct,
          },
        });
      }

      finalResults.sort((a, b) => b.totals.overallReturnPct - a.totals.overallReturnPct);
      setTypeResults(finalResults);

      if (finalResults.length === 0) {
        setError("No valid results. Check that your sales files contain the expected summary layout.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to parse files.");
    } finally {
      setIsBusy(false);
    }
  }

  function handleDownload() {
    if (!typeResults.length) return;

    if (downloadFormat === "excel") {
      downloadAllAsExcel(`return_analysis_${selectedDate || "date"}.xlsx`, { date: selectedDate, day: weekday ?? "" }, typeResults);
    } else {
      downloadAllAsPdf(`return_analysis_${selectedDate || "date"}.pdf`, { date: selectedDate, day: weekday ?? "" }, typeResults);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Lottery Sales vs Returns Analyzer</h1>
          <p className="mt-2 text-sm text-slate-600">
            Select a date → upload multiple Sales + Return files → auto-detect lottery types from filenames → Top 15 per lottery type.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Download supports: Excel (multi-sheet) or PDF (professional A4 report).
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Controls */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-base font-semibold">Inputs</h2>

            <label className="mt-4 block text-sm font-medium text-slate-700">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                resetComputed();
              }}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
            />

            <div className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
              <div>
                <span className="font-semibold">Day:</span> {weekday ?? "—"}
              </div>
              <div className="mt-1">
                <span className="font-semibold">Allowed lottery types:</span>{" "}
                {weekday ? allowedTypes.join(", ") : "Select a date"}
              </div>
            </div>

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
                Lottery type is inferred from each file name. Only types allowed for the selected weekday are accepted.
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="lg:col-span-2 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Results</h2>
                <p className="mt-1 text-xs text-slate-600">
                  Date: <span className="font-semibold">{selectedDate || "—"}</span>{" "}
                  • Day: <span className="font-semibold">{weekday || "—"}</span>{" "}
                  • Types found: <span className="font-semibold">{typeResults.length}</span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={downloadFormat}
                  onChange={(e) => setDownloadFormat(e.target.value as "excel" | "pdf")}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  disabled={!typeResults.length}
                >
                  <option value="excel">Excel (All Types)</option>
                  <option value="pdf">PDF Report (All Types)</option>
                </select>

                <button
                  onClick={handleDownload}
                  disabled={!typeResults.length}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                >
                  Download
                </button>
              </div>
            </div>

            {!typeResults.length ? (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Upload files and run analysis to see Top 15 per lottery type.
              </div>
            ) : (
              <div className="mt-4 space-y-6">
                {typeResults.map((tr) => (
                  <div key={tr.lotteryType} className="rounded-2xl border border-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold">
                          Lottery Type: <span className="font-bold">{tr.lotteryType}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          Agents: <span className="font-semibold">{tr.totals.uniqueAgents}</span> •
                          SalesQty: <span className="font-semibold">{tr.totals.totalSalesQty}</span> •
                          ReturnQty: <span className="font-semibold">{tr.totals.totalReturnQty}</span> •
                          Overall Return%: <span className="font-semibold">{tr.totals.overallReturnPct.toFixed(2)}%</span>
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-slate-700">
                          <tr>
                            <th className="px-3 py-2 text-left">Rank</th>
                            <th className="px-3 py-2 text-left">Agent Code</th>
                            <th className="px-3 py-2 text-left">Agent Name</th>
                            <th className="px-3 py-2 text-right">Sales Qty</th>
                            <th className="px-3 py-2 text-right">Return Qty</th>
                            <th className="px-3 py-2 text-right">Actual Sales</th>
                            <th className="px-3 py-2 text-right">Return %</th>
                          </tr>
                        </thead>

                        <tbody>
                          {tr.top.map((r) => (
                            <tr key={`${tr.lotteryType}-${r.agentCode}-${r.rank}`} className="border-t border-slate-200">
                              <td className="px-3 py-2">{r.rank}</td>
                              <td className="px-3 py-2 font-medium">{r.agentCode}</td>
                              <td className="px-3 py-2">{r.agentName ?? "—"}</td>
                              <td className="px-3 py-2 text-right">{r.salesQty}</td>
                              <td className="px-3 py-2 text-right">{r.returnQty}</td>
                              <td className="px-3 py-2 text-right">{r.actualSales}</td>
                              <td className="px-3 py-2 text-right font-semibold">{r.returnPct.toFixed(2)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="px-4 py-3 text-xs text-slate-500">
                      Top 15 is calculated per lottery type using merged Sales/Return totals (per agent).
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 text-xs text-slate-500">
              Enforcement: Every uploaded file must include a valid lottery type token in the filename (e.g., AKF, KTF...) and must be allowed for the selected weekday.
            </div>

            <div className="mt-3 text-xs text-slate-500">
              Required packages:
              <span className="ml-2 font-mono">npm i jspdf jspdf-autotable</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

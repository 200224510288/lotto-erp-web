// app/daily-balance/page.tsx
"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import * as XLSX from "xlsx";
import {
  Upload,
  Calendar,
  Search,
  Check,
  CheckCircle2,
  Clock,
  RotateCcw,
  AlertTriangle,
  ArrowUpDown,
  Filter,
  FileSpreadsheet,
  Download,
  Maximize2,
  Minimize2,
  RefreshCw,
  Trash2,
  ExternalLink,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Layers,
} from "lucide-react";

import { auth } from "../lib/firebase";
import { useAuth } from "../lib/AuthProvider";
import BalanceSecurityGate from "../components/BalanceSecurityGate";
import DailyBalanceSummaryCards from "../components/DailyBalanceSummaryCards";
import SequentialBalanceChecker from "../components/SequentialBalanceChecker";
import BigPrizeTicketsSection from "../components/BigPrizeTicketsSection";
import { BigPrizeSummary } from "../lib/bigPrizeTicketsService";
import {
  DailyBalanceReport,
  BalanceRecordRow,
  BalancingProgressSummary,
  ExcelParseResult,
  parseDailyBalanceExcel,
  getDailyBalanceReport,
  saveDailyBalanceReport,
  updateBalanceRowCheckStatus,
  deleteDailyBalanceReport,
  calculateBalancingProgress,
  formatCurrency,
  formatDisplayDate,
} from "../lib/balanceOrganizerService";

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getYesterdayKey(currentDateStr: string): string {
  try {
    const d = new Date(currentDateStr);
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return currentDateStr;
  }
}

type SortField = "original" | "serial" | "agent" | "win" | "cash" | "balance" | "status";
type SortDirection = "asc" | "desc";
type FilterStatus = "all" | "pending" | "checked";

export default function DailyBalancePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  // Top Date Selection
  const [selectedDate, setSelectedDate] = useState<string>(todayKey());

  // Database Report State
  const [report, setReport] = useState<DailyBalanceReport | null>(null);
  const [rows, setRows] = useState<BalanceRecordRow[]>([]);
  const [isLoadingReport, setIsLoadingReport] = useState<boolean>(true);
  const [reportError, setReportError] = useState<string | null>(null);

  // Big Prize Winning Tickets Summary State
  const [bigPrizeSummary, setBigPrizeSummary] = useState<BigPrizeSummary | null>(null);

  // File Upload & Staging
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ExcelParseResult | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [isSavingReport, setIsSavingReport] = useState<boolean>(false);
  const [showReplaceModal, setShowReplaceModal] = useState<boolean>(false);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Row Checking States
  const [checkingRowId, setCheckingRowId] = useState<string | null>(null);

  // Sequential Mode State
  const [isSequentialMode, setIsSequentialMode] = useState<boolean>(false);
  const [sequentialIndex, setSequentialIndex] = useState<number>(0);

  // Search & Filter & Sort
  const [searchAgent, setSearchAgent] = useState<string>("");
  const [searchSerial, setSearchSerial] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [sortField, setSortField] = useState<SortField>("original");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Pagination State
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Reset to first page when search, filter, or sorting changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchAgent, searchSerial, statusFilter, sortField, sortDirection, pageSize]);

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auth redirect
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // Load report when selectedDate changes
  const loadReportForDate = useCallback(async (dateKey: string) => {
    if (!dateKey) return;
    setIsLoadingReport(true);
    setReportError(null);
    setStagedFile(null);
    setParseResult(null);

    try {
      const result = await getDailyBalanceReport(dateKey);
      setReport(result.report);
      setRows(result.rows);
      setSequentialIndex(0);
    } catch (err) {
      console.error("Failed to load daily balance report:", err);
      setReportError("Failed to fetch report from database. Please check connection.");
      setReport(null);
      setRows([]);
    } finally {
      setIsLoadingReport(false);
    }
  }, []);

  useEffect(() => {
    if (user && selectedDate) {
      loadReportForDate(selectedDate);
    }
  }, [selectedDate, user, loadReportForDate]);

  // Progress summary calculation
  const progressSummary: BalancingProgressSummary = useMemo(() => {
    return calculateBalancingProgress(rows);
  }, [rows]);

  // Handle file selection and parsing
  async function handleFileSelected(file: File) {
    setReportError(null);
    setIsParsing(true);

    try {
      const parsed = await parseDailyBalanceExcel(file, selectedDate);
      if (!parsed.isValid) {
        setReportError(parsed.error || "Failed to parse Excel file.");
        setParseResult(null);
        setStagedFile(null);
        setIsParsing(false);
        return;
      }

      setStagedFile(file);
      setParseResult(parsed);

      // If report already exists for this date, prompt to overwrite
      if (report) {
        setShowReplaceModal(true);
        setIsParsing(false);
        return;
      }

      // No existing report -> save to database immediately and load!
      setIsSavingReport(true);
      const reportPayload = {
        balanceDate: selectedDate,
        originalFileName: file.name,
        uploadedAt: new Date().toISOString(),
        uploadedBy: user?.email || "Authorized Officer",
        totalRows: parsed.totalRows,
        totalWin: parsed.totalWin,
        totalCashAndCheque: parsed.totalCashAndCheque,
        totalCalculatedBalance: parsed.totalCalculatedBalance,
        checkedCount: 0,
        pendingCount: parsed.totalRows,
        status: "pending" as const,
      };

      await saveDailyBalanceReport(reportPayload, parsed.rows);
      setStagedFile(null);
      setParseResult(null);
      await loadReportForDate(selectedDate);
    } catch (err) {
      console.error("Error parsing or saving file:", err);
      setReportError(err instanceof Error ? err.message : "Error reading or saving Excel file.");
      setParseResult(null);
      setStagedFile(null);
    } finally {
      setIsParsing(false);
      setIsSavingReport(false);
    }
  }

  // Save staged report to database (used by Overwrite Confirmation Modal)
  async function handleSaveReportToDb() {
    if (!parseResult || !parseResult.isValid || !stagedFile) return;

    setIsSavingReport(true);
    setReportError(null);

    try {
      const reportPayload = {
        balanceDate: selectedDate,
        originalFileName: stagedFile.name,
        uploadedAt: new Date().toISOString(),
        uploadedBy: user?.email || "Authorized Officer",
        totalRows: parseResult.totalRows,
        totalWin: parseResult.totalWin,
        totalCashAndCheque: parseResult.totalCashAndCheque,
        totalCalculatedBalance: parseResult.totalCalculatedBalance,
        checkedCount: 0,
        pendingCount: parseResult.totalRows,
        status: "pending" as const,
      };

      await saveDailyBalanceReport(reportPayload, parseResult.rows);

      // Clean up staging state and reload fresh from database
      setStagedFile(null);
      setParseResult(null);
      setShowReplaceModal(false);
      await loadReportForDate(selectedDate);
    } catch (err) {
      console.error("Error saving report to DB:", err);
      setReportError("Failed to save report to database. Please try again.");
    } finally {
      setIsSavingReport(false);
    }
  }

  // Single Row Check Toggle
  async function handleToggleRowCheck(targetRow: BalanceRecordRow) {
    if (!report) return;
    const newStatus = !targetRow.isChecked;
    const rowId = targetRow.id;
    const reportId = report.id;

    setCheckingRowId(rowId);

    // Optimistic UI update
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              isChecked: newStatus,
              checkedBy: newStatus ? user?.email || "Authorized Officer" : null,
              checkedAt: newStatus ? new Date().toISOString() : null,
            }
          : r
      )
    );

    try {
      await updateBalanceRowCheckStatus(
        reportId,
        rowId,
        newStatus,
        user?.email || "Authorized Officer"
      );
    } catch (err) {
      console.error("Failed to update row status in DB:", err);
      // Revert optimistic update
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                isChecked: targetRow.isChecked,
                checkedBy: targetRow.checkedBy,
                checkedAt: targetRow.checkedAt,
              }
            : r
        )
      );
      setReportError(`Failed to update status for row #${targetRow.serialNo}. Please retry.`);
    } finally {
      setCheckingRowId(null);
    }
  }

  // Sequential Mode Confirm & Next
  async function handleSequentialConfirmAndNext(targetRow: BalanceRecordRow) {
    if (!report) return;
    const rowId = targetRow.id;
    const reportId = report.id;

    setCheckingRowId(rowId);

    // Mark checked in state
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              isChecked: true,
              checkedBy: user?.email || "Authorized Officer",
              checkedAt: new Date().toISOString(),
            }
          : r
      )
    );

    try {
      await updateBalanceRowCheckStatus(
        reportId,
        rowId,
        true,
        user?.email || "Authorized Officer"
      );

      // Auto-advance to next unchecked record
      let nextUnchecked = -1;
      for (let i = sequentialIndex + 1; i < rows.length; i++) {
        if (!rows[i].isChecked && rows[i].id !== rowId) {
          nextUnchecked = i;
          break;
        }
      }
      if (nextUnchecked === -1) {
        for (let i = 0; i <= sequentialIndex; i++) {
          if (!rows[i].isChecked && rows[i].id !== rowId) {
            nextUnchecked = i;
            break;
          }
        }
      }

      if (nextUnchecked !== -1) {
        setSequentialIndex(nextUnchecked);
      } else if (sequentialIndex < rows.length - 1) {
        setSequentialIndex((prev) => prev + 1);
      }
    } catch (err) {
      console.error("Error in sequential confirm:", err);
      setReportError("Error updating database record.");
    } finally {
      setCheckingRowId(null);
    }
  }

  // Delete Report
  async function handleDeleteCurrentReport() {
    if (!report) return;
    setIsDeleting(true);
    try {
      await deleteDailyBalanceReport(report.id);
      setShowDeleteModal(false);
      setReport(null);
      setRows([]);
    } catch (err) {
      console.error("Failed to delete report:", err);
      setReportError("Failed to delete report from database.");
    } finally {
      setIsDeleting(false);
    }
  }

  // Export Verified Data to Excel
  function handleExportExcel() {
    if (!report || rows.length === 0) return;

    const exportRows = rows.map((r) => ({
      "Serial No": r.serialNo,
      "Agent Name": r.agentName,
      "WIN": r.win,
      "CASH & CHE.": r.cashAndCheque,
      "Balance": r.balance,
      "Status": r.isChecked ? "Checked" : "Pending",
      "Checked By": r.checkedBy || "",
      "Checked At": r.checkedAt ? formatDisplayDate(r.checkedAt) : "",
    }));

    const metaInfo = [
      ["DAILY BALANCE ORGANIZER - VERIFIED REPORT", ""],
      ["Balance Date", report.balanceDate],
      ["Original File", report.originalFileName],
      ["Total Records", report.totalRows],
      ["Total CASH & CHE.", progressSummary.totalCashAndCheque],
      ["Total WIN", progressSummary.totalWin],
      ["Total Balance", progressSummary.totalBalance],
      ["Verified Records", `${progressSummary.checkedRecords} / ${progressSummary.totalRecords}`],
      [],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(metaInfo);
    XLSX.utils.sheet_add_json(ws, exportRows, { origin: "A10" });
    XLSX.utils.book_append_sheet(wb, ws, "Daily_Balance");

    XLSX.writeFile(wb, `Balance_Report_${selectedDate}.xlsx`);
  }

  // Filtered & Sorted Rows for Table
  const filteredAndSortedRows = useMemo(() => {
    let result = [...rows];

    // Status filter
    if (statusFilter === "pending") {
      result = result.filter((r) => !r.isChecked);
    } else if (statusFilter === "checked") {
      result = result.filter((r) => r.isChecked);
    }

    // Search by Agent Name
    if (searchAgent.trim()) {
      const q = searchAgent.trim().toLowerCase();
      result = result.filter((r) => r.agentName.toLowerCase().includes(q));
    }

    // Search by Serial No
    if (searchSerial.trim()) {
      const q = searchSerial.trim().toLowerCase();
      result = result.filter((r) => r.serialNo.toLowerCase().includes(q));
    }

    // Sorting
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "serial":
          comparison = a.serialNo.localeCompare(b.serialNo, undefined, { numeric: true });
          break;
        case "agent":
          comparison = a.agentName.localeCompare(b.agentName);
          break;
        case "win":
          comparison = a.win - b.win;
          break;
        case "cash":
          comparison = a.cashAndCheque - b.cashAndCheque;
          break;
        case "balance":
          comparison = a.balance - b.balance;
          break;
        case "status":
          comparison = Number(a.isChecked) - Number(b.isChecked);
          break;
        case "original":
        default:
          comparison = a.rowIndex - b.rowIndex;
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [rows, statusFilter, searchAgent, searchSerial, sortField, sortDirection]);

  // Pagination calculations
  const totalItems = filteredAndSortedRows.length;
  const effectivePageSize = pageSize === -1 ? (totalItems || 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safeCurrentPage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, totalItems);
  const paginatedRows = useMemo(() => {
    return filteredAndSortedRows.slice(startIndex, endIndex);
  }, [filteredAndSortedRows, startIndex, endIndex]);

  // Handle Sort column click
  function handleColumnSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-700">
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-block animate-spin">⏳</span>
          <span>Authenticating LOTTOCORE session…</span>
        </div>
      </div>
    );
  }

  return (
    <BalanceSecurityGate userEmail={user.email || "Officer"}>
      <main className="min-h-screen bg-slate-100 text-slate-900 pb-16">
        <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
          {/* ===== Main Top Navigation & Title Bar ===== */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-300 shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-lg bg-emerald-100 text-emerald-800">
                  <Layers className="w-5 h-5" />
                </span>
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  Daily Balance Organizer
                </h1>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Daily Excel balance verification, Cash vs Win balancing, and individual record confirmation
              </p>
            </div>

            {/* Navigation links to other pages */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white font-medium shadow-xs transition"
              >
                Sales Page
              </Link>
              <Link
                href="/returns"
                className="px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-medium shadow-xs transition"
              >
                Returns Page
              </Link>
              <Link
                href="/return-analysis"
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-xs transition"
              >
                Returns Analyzer
              </Link>
              <Link
                href="/scan-balancing"
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-xs transition flex items-center gap-1"
              >
                <span>Win Scan Balancing</span>
              </Link>
              <Link
                href="/nlb"
                className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-medium shadow-xs transition"
              >
                NLB Sales
              </Link>
              <button
                type="button"
                onClick={() => signOut(auth)}
                className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 font-medium transition"
              >
                Logout
              </button>
            </div>
          </div>

          {/* ===== Date Selection & Actions Bar ===== */}
          <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-700" />
                <label htmlFor="balanceDateInput" className="text-sm font-bold text-slate-800">
                  Balance Date:
                </label>
              </div>

              <input
                id="balanceDateInput"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />

              {/* Quick Date Shortcuts */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedDate(todayKey())}
                  className={`px-2.5 py-1 text-xs rounded border transition ${
                    selectedDate === todayKey()
                      ? "bg-emerald-600 text-white border-emerald-600 font-semibold"
                      : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDate(getYesterdayKey(todayKey()))}
                  className={`px-2.5 py-1 text-xs rounded border transition ${
                    selectedDate === getYesterdayKey(todayKey())
                      ? "bg-emerald-600 text-white border-emerald-600 font-semibold"
                      : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
                  }`}
                >
                  Yesterday
                </button>
              </div>

              {isLoadingReport && (
                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <span className="inline-block animate-spin">⏳</span>
                  <span>Checking database…</span>
                </div>
              )}
            </div>

            {/* Right side actions if report exists */}
            {report && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Enter Sequential Mode Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSequentialMode((prev) => !prev);
                    if (!isSequentialMode) {
                      // Find first pending record
                      const firstPending = rows.findIndex((r) => !r.isChecked);
                      setSequentialIndex(firstPending !== -1 ? firstPending : 0);
                    }
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition ${
                    isSequentialMode
                      ? "bg-emerald-700 text-white hover:bg-emerald-800"
                      : "bg-emerald-600 hover:bg-emerald-700 text-white"
                  }`}
                >
                  {isSequentialMode ? (
                    <>
                      <Minimize2 className="w-3.5 h-3.5" />
                      <span>Back to Table View</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span>Sequential Checking Mode</span>
                    </>
                  )}
                </button>

                {/* Replace File Trigger */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1.5 transition"
                  title="Upload a new Excel file to replace current report"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                  <span>Replace Report</span>
                </button>

                {/* Export Verified Excel */}
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Export Excel</span>
                </button>

                {/* Delete Report */}
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(true)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 transition"
                  title="Delete report for this date"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </section>

          {/* Hidden File Input for Replace or Upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xls,.xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelected(file);
              e.target.value = "";
            }}
          />

          {/* Error Banner */}
          {reportError && (
            <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-xs text-red-800 flex items-start justify-between gap-3 shadow-xs">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                <span className="font-medium">{reportError}</span>
              </div>
              <button
                type="button"
                onClick={() => setReportError(null)}
                className="text-red-500 hover:text-red-800 font-bold"
              >
                ✕
              </button>
            </div>
          )}

          {/* ===== 1. DAILY BALANCE REPORT (CORE SECTION) ===== */}

          {/* EMPTY STATE / EXCEL UPLOAD WHEN NO REPORT EXISTS */}
          {!report && !isLoadingReport && (
            <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 md:p-12 text-center space-y-5 shadow-xs">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Upload className="h-8 w-8" />
              </div>

              <div className="max-w-md mx-auto">
                <h3 className="text-lg font-bold text-slate-900">
                  No Balance Report for {selectedDate}
                </h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Upload the daily balance Excel sheet (<b>.xls</b> or <b>.xlsx</b>).
                  The system will read headers, clean numeric figures, and preserve each row
                  for individual balancing.
                </p>
              </div>

              {/* Upload Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileSelected(file);
                }}
                className={`max-w-xl mx-auto rounded-xl border-2 border-dashed p-6 transition cursor-pointer ${
                  dragActive
                    ? "border-emerald-500 bg-emerald-50/50"
                    : "border-slate-300 bg-slate-50 hover:bg-slate-100/70"
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex flex-col items-center justify-center gap-2">
                  <FileSpreadsheet className="w-8 h-8 text-slate-400" />
                  <div className="text-xs font-semibold text-slate-700">
                    Drag and drop balance file here, or{" "}
                    <span className="text-emerald-700 underline">browse files</span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Supports .xls and .xlsx formats
                  </span>
                </div>
              </div>

              {(isParsing || isSavingReport) && (
                <div className="flex items-center justify-center gap-2 text-xs text-slate-600 pt-2 font-medium">
                  <span className="inline-block animate-spin">⏳</span>
                  <span>
                    {isSavingReport
                      ? "Saving Daily Balance Report to database…"
                      : "Analyzing Excel structure and detecting headers…"}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* SUMMARY CARDS COMPONENT (WHEN REPORT EXISTS) */}
          {report && (
            <DailyBalanceSummaryCards
              report={report}
              progress={progressSummary}
              selectedDate={selectedDate}
              bigPrizeSummary={bigPrizeSummary}
            />
          )}

          {/* SEQUENTIAL CHECKING MODE (FOCUSED VIEW) */}
          {report && isSequentialMode && (
            <SequentialBalanceChecker
              rows={rows}
              currentIndex={sequentialIndex}
              onIndexChange={(idx) => setSequentialIndex(idx)}
              onConfirmAndNext={handleSequentialConfirmAndNext}
              onToggleStatus={handleToggleRowCheck}
              onClose={() => setIsSequentialMode(false)}
              isProcessing={checkingRowId !== null}
            />
          )}

          {/* ===== MAIN TABLE SECTION (WHEN REPORT EXISTS) ===== */}
          {report && (
            <div className="rounded-xl border border-slate-300 bg-white shadow-sm overflow-hidden space-y-4 p-5">
              {/* Table Controls Bar: Filters & Search */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
                {/* Status Filter Tabs */}
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                      statusFilter === "all"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    All ({progressSummary.totalRecords})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("pending")}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 ${
                      statusFilter === "pending"
                        ? "bg-amber-100 text-amber-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <span>Pending ({progressSummary.pendingRecords})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("checked")}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 ${
                      statusFilter === "checked"
                        ? "bg-emerald-100 text-emerald-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <span>Checked ({progressSummary.checkedRecords})</span>
                  </button>
                </div>

                {/* Search Fields */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {/* Search by Agent */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
                    <input
                      type="text"
                      value={searchAgent}
                      onChange={(e) => setSearchAgent(e.target.value)}
                      placeholder="Search Agent Name…"
                      className="rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 w-44"
                    />
                    {searchAgent && (
                      <button
                        type="button"
                        onClick={() => setSearchAgent("")}
                        className="absolute right-2 top-2 text-slate-400 hover:text-slate-700"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Search by Serial */}
                  <div className="relative">
                    <input
                      type="text"
                      value={searchSerial}
                      onChange={(e) => setSearchSerial(e.target.value)}
                      placeholder="Search Serial / Account…"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 w-36"
                    />
                    {searchSerial && (
                      <button
                        type="button"
                        onClick={() => setSearchSerial("")}
                        className="absolute right-2 top-2 text-slate-400 hover:text-slate-700"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Sort reset */}
                  {sortField !== "original" && (
                    <button
                      type="button"
                      onClick={() => {
                        setSortField("original");
                        setSortDirection("asc");
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 flex items-center gap-1 transition"
                      title="Reset to original Excel row order"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Original Order</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Table Container with Height Limit and Sticky Header */}
              <div className="max-h-[540px] overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 relative">
                <table className="w-full border-collapse text-left text-xs">
                  {/* Sticky Table Header */}
                  <thead className="sticky top-0 z-10 bg-slate-100 shadow-2xs">
                    <tr className="border-b border-slate-300 bg-slate-100 font-semibold text-slate-700">
                      <th
                        onClick={() => handleColumnSort("serial")}
                        className="py-3 px-3 cursor-pointer hover:bg-slate-200 transition bg-slate-100"
                      >
                        <div className="flex items-center gap-1">
                          <span>Serial No.</span>
                          {sortField === "serial" && (
                            <ArrowUpDown className="w-3 h-3 text-slate-900" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleColumnSort("agent")}
                        className="py-3 px-3 cursor-pointer hover:bg-slate-200 transition bg-slate-100"
                      >
                        <div className="flex items-center gap-1">
                          <span>Agent Name</span>
                          {sortField === "agent" && (
                            <ArrowUpDown className="w-3 h-3 text-slate-900" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleColumnSort("win")}
                        className="py-3 px-3 text-right cursor-pointer hover:bg-slate-200 transition bg-slate-100"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>WIN</span>
                          {sortField === "win" && (
                            <ArrowUpDown className="w-3 h-3 text-slate-900" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleColumnSort("cash")}
                        className="py-3 px-3 text-right cursor-pointer hover:bg-slate-200 transition bg-slate-100"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>CASH &amp; CHE.</span>
                          {sortField === "cash" && (
                            <ArrowUpDown className="w-3 h-3 text-slate-900" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleColumnSort("balance")}
                        className="py-3 px-3 text-right cursor-pointer hover:bg-slate-200 transition bg-slate-100"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Balance</span>
                          {sortField === "balance" && (
                            <ArrowUpDown className="w-3 h-3 text-slate-900" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleColumnSort("status")}
                        className="py-3 px-3 text-center cursor-pointer hover:bg-slate-200 transition bg-slate-100"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Status</span>
                          {sortField === "status" && (
                            <ArrowUpDown className="w-3 h-3 text-slate-900" />
                          )}
                        </div>
                      </th>
                      <th className="py-3 px-3 text-center bg-slate-100">Action</th>
                    </tr>
                  </thead>

                  {/* Table Body */}
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {paginatedRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          No matching records found.
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((row) => {
                        const isChecking = checkingRowId === row.id;
                        const isPositive = row.balance >= 0;

                        return (
                          <tr
                            key={row.id}
                            className={`transition hover:bg-slate-50 ${
                              row.isChecked ? "bg-emerald-50/20" : ""
                            }`}
                          >
                            {/* Serial No */}
                            <td className="py-2.5 px-3 font-mono font-medium text-slate-800">
                              {row.serialNo}
                            </td>

                            {/* Agent Name */}
                            <td className="py-2.5 px-3 font-medium text-slate-900">
                              {row.agentName}
                            </td>

                            {/* WIN */}
                            <td className="py-2.5 px-3 text-right font-mono font-medium text-purple-900">
                              {formatCurrency(row.win)}
                            </td>

                            {/* CASH & CHE. */}
                            <td className="py-2.5 px-3 text-right font-mono font-medium text-teal-900">
                              {formatCurrency(row.cashAndCheque)}
                            </td>

                            {/* Balance */}
                            <td
                              className={`py-2.5 px-3 text-right font-mono font-bold ${
                                isPositive ? "text-emerald-800" : "text-rose-800"
                              }`}
                            >
                              {formatCurrency(row.balance)}
                            </td>

                            {/* Status Badge */}
                            <td className="py-2.5 px-3 text-center">
                              {row.isChecked ? (
                                <span
                                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300"
                                  title={`Checked by ${row.checkedBy || "Officer"} at ${formatDisplayDate(row.checkedAt)}`}
                                >
                                  <Check className="w-3 h-3 stroke-[2.5]" />
                                  <span>Checked</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                                  <Clock className="w-3 h-3" />
                                  <span>Pending</span>
                                </span>
                              )}
                            </td>

                            {/* Check / Confirmation Button */}
                            <td className="py-2.5 px-3 text-center">
                              <button
                                type="button"
                                disabled={isChecking}
                                onClick={() => handleToggleRowCheck(row)}
                                className={`px-3 py-1 rounded text-xs font-semibold shadow-xs transition inline-flex items-center gap-1.5 active:scale-95 disabled:opacity-50 ${
                                  row.isChecked
                                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                    : "bg-slate-200 hover:bg-emerald-600 hover:text-white text-slate-800"
                                }`}
                              >
                                {isChecking ? (
                                  <span className="inline-block animate-spin">⏳</span>
                                ) : row.isChecked ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                                    <span>✓ Checked</span>
                                  </>
                                ) : (
                                  <>
                                    <span>Check</span>
                                  </>
                                )}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Table Footer with Pagination Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 pt-3 border-t border-slate-200">
                <div className="flex items-center gap-2">
                  <span>
                    Showing <b className="text-slate-900">{totalItems === 0 ? 0 : startIndex + 1}</b> – <b className="text-slate-900">{endIndex}</b> of <b className="text-slate-900">{totalItems}</b> records
                    {filteredAndSortedRows.length !== rows.length && (
                      <span className="text-slate-400 ml-1">({rows.length} total)</span>
                    )}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Rows per page selector */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">Rows per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    >
                      <option value={15}>15</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={-1}>All</option>
                    </select>
                  </div>

                  {/* Navigation buttons */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={safeCurrentPage <= 1}
                      onClick={() => setCurrentPage(1)}
                      className="p-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-slate-700"
                      title="First Page"
                    >
                      <ChevronsLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={safeCurrentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="p-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-slate-700"
                      title="Previous Page"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>

                    <span className="px-2.5 py-1 text-xs font-bold text-slate-800 bg-slate-50 rounded border border-slate-200">
                      Page {safeCurrentPage} of {totalPages}
                    </span>

                    <button
                      type="button"
                      disabled={safeCurrentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="p-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-slate-700"
                      title="Next Page"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={safeCurrentPage >= totalPages}
                      onClick={() => setCurrentPage(totalPages)}
                      className="p-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-slate-700"
                      title="Last Page"
                    >
                      <ChevronsRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== 2. BIG PRIZE WINNING TICKETS RECEIVED SECTION ===== */}
          <BigPrizeTicketsSection
            selectedDate={selectedDate}
            userEmail={user.email || "Authorized Officer"}
            onSummaryChange={setBigPrizeSummary}
          />

          {/* ===== MODAL: OVERWRITE / REPLACE WARNING ===== */}
          {showReplaceModal && stagedFile && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-md rounded-xl border border-amber-400 bg-white p-6 shadow-2xl space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-full bg-amber-100 text-amber-800 shrink-0">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Warning: Report Already Exists
                    </h3>
                    <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                      A balance report for <b>{selectedDate}</b> already exists in the database
                      with <b>{rows.length} records</b> ({progressSummary.checkedRecords} verified).
                    </p>
                  </div>
                </div>

                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                  Replacing this report will overwrite all existing records and reset their checked status.
                  This action cannot be undone.
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button
                    type="button"
                    onClick={() => {
                      setShowReplaceModal(false);
                      setStagedFile(null);
                      setParseResult(null);
                    }}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSavingReport}
                    onClick={handleSaveReportToDb}
                    className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-bold text-white shadow transition disabled:opacity-50"
                  >
                    {isSavingReport ? "Overwriting…" : "Yes, Overwrite Report"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===== MODAL: DELETE CONFIRMATION ===== */}
          {showDeleteModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-sm rounded-xl border border-red-300 bg-white p-6 shadow-2xl space-y-4">
                <div className="flex items-center gap-2.5 text-red-700">
                  <Trash2 className="w-5 h-5" />
                  <h3 className="font-bold text-base">Delete Daily Balance Report?</h3>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  Are you sure you want to permanently delete the report and all records for{" "}
                  <b>{selectedDate}</b>? This cannot be undone.
                </p>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button
                    type="button"
                    onClick={() => setShowDeleteModal(false)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={handleDeleteCurrentReport}
                    className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-bold text-white shadow disabled:opacity-50"
                  >
                    {isDeleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </BalanceSecurityGate>
  );
}

// app/scan-balancing/page.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import * as XLSX from "xlsx";
import {
  Calendar,
  Users,
  Plus,
  Trash2,
  Save,
  Lock,
  Unlock,
  CheckCircle2,
  AlertCircle,
  X,
  Target,
  FileCheck2,
  Download,
  Printer,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  TableProperties,
  UserCheck,
  Sparkles,
} from "lucide-react";

import { auth } from "../lib/firebase";
import { useAuth } from "../lib/AuthProvider";
import {
  ScanBalancingMode,
  StaffEntry,
  StaffEntryPayload,
  DailyScanClaim,
  StaffMemberMaster,
  calculateStaffTotals,
  calculateDailyScanSummary,
  formatCurrency,
  getDailyScanClaim,
  saveDailyScanClaim,
  getPreviousDayWins,
  getSuggestedAgentWinsTarget,
  verifyScanAdminPassword,
  getStaffDirectory,
  buildStaffEntriesFromDirectory,
} from "../lib/scanBalancingService";
import BalanceSecurityGate from "../components/BalanceSecurityGate";
import StaffDirectoryModal from "../components/StaffDirectoryModal";
import { verifyBalancePasscode } from "../lib/balanceOrganizerService";

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function WinTicketsScanBalancingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  // Date
  const [selectedDate, setSelectedDate] = useState<string>(todayKey());

  // Mode: admin vs staff
  const [mode, setMode] = useState<ScanBalancingMode>("staff");
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(false);

  // Layout View: Focused Tab vs Overview Table
  const [layoutMode, setLayoutMode] = useState<"tabs" | "table">("tabs");
  const [activeStaffIndex, setActiveStaffIndex] = useState<number>(0);

  // Form State
  const [totalAgentClaim, setTotalAgentClaim] = useState<string>("");
  const [staffEntries, setStaffEntries] = useState<StaffEntry[]>([]);
  const [suggestedTarget, setSuggestedTarget] = useState<number | null>(null);

  // Master Staff Directory
  const [staffDirectory, setStaffDirectory] = useState<StaffMemberMaster[]>([]);
  const [isStaffDirectoryOpen, setIsStaffDirectoryOpen] = useState<boolean>(false);
  const [showAddStaffDropdown, setShowAddStaffDropdown] = useState<boolean>(false);

  // Status flags
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Admin Password Prompt Modal
  const [showPasswordPrompt, setShowPasswordPrompt] = useState<boolean>(false);
  const [passwordInput, setPasswordInput] = useState<string>("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isVerifyingPass, setIsVerifyingPass] = useState<boolean>(false);

  // Auth Guard
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // Load Directory on Mount
  useEffect(() => {
    loadDirectoryData();
  }, []);

  // Load Date Data
  useEffect(() => {
    if (user && selectedDate) {
      loadDateData(selectedDate);
    }
  }, [selectedDate, user]);

  const loadDirectoryData = async () => {
    try {
      const list = await getStaffDirectory();
      setStaffDirectory(list);
    } catch (err) {
      console.error("Failed to load staff directory:", err);
    }
  };

  const normalizeStaffEntry = (entry: Partial<StaffEntryPayload>): StaffEntry => {
    return {
      id: entry.id?.toString() ?? Date.now().toString(),
      staffName: entry.staffName || "",
      agentParcels: Array.isArray(entry.agentParcels) ? entry.agentParcels : [],
      additionalBalanceOnly: Array.isArray(entry.additionalBalanceOnly) ? entry.additionalBalanceOnly : [],
      additionalTodayWins: Array.isArray(entry.additionalTodayWins) ? entry.additionalTodayWins : [],
      previousBalance: entry.previousBalance ?? 0,
      mailAmount: entry.mailAmount ?? 0,
      returnClaims: entry.returnClaims ?? 0,
      actualClosingBalance: entry.actualClosingBalance ?? 0,
      agentDraft: "",
      additionalBalanceDraft: "",
      additionalTodayDraft: "",
    };
  };

  const loadDateData = async (dateStr: string) => {
    setLoading(true);
    setError(null);
    setIsDirty(false);
    try {
      const claim = await getDailyScanClaim(dateStr);
      if (claim && claim.staffEntries && claim.staffEntries.length > 0) {
        setTotalAgentClaim(claim.totalAgentClaim ? claim.totalAgentClaim.toString() : "");
        setStaffEntries(claim.staffEntries.map((e) => normalizeStaffEntry(e)));
      } else {
        setTotalAgentClaim("");
        setStaffEntries([]);
      }

      const suggested = await getSuggestedAgentWinsTarget(dateStr);
      setSuggestedTarget(suggested);
      setActiveStaffIndex(0);
    } catch (err) {
      console.error("Failed to load scan claim:", err);
      setError("Failed to load scan balancing data for the selected date.");
    } finally {
      setLoading(false);
    }
  };

  // Populate today's sheet with available/active staff from Directory
  const handleLoadActiveStaffFromDirectory = async (customDir?: StaffMemberMaster[]) => {
    const dir = customDir || staffDirectory;
    const activeStaff = dir.filter((s) => s.isActive);
    if (activeStaff.length === 0) {
      setError("No active staff found in Staff Directory. Please add members first.");
      return;
    }

    try {
      setLoading(true);
      const prevWinsMap = await getPreviousDayWins(selectedDate);
      const entries = buildStaffEntriesFromDirectory(dir, prevWinsMap);
      setStaffEntries(entries);
      setIsDirty(true);
      setActiveStaffIndex(0);
      setSuccess(`Loaded ${entries.length} active staff members for ${selectedDate}.`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error("Error building staff allocation:", err);
      setError("Failed to load available staff from directory.");
    } finally {
      setLoading(false);
    }
  };

  // Add a single staff member from the directory who isn't already added
  const handleAddStaffFromDirectory = (member: StaffMemberMaster) => {
    const newEntry: StaffEntry = {
      id: `${member.id}_${Date.now()}`,
      staffName: member.name,
      agentParcels: [],
      additionalBalanceOnly: [],
      additionalTodayWins: [],
      previousBalance: 0,
      mailAmount: 0,
      returnClaims: 0,
      actualClosingBalance: 0,
      agentDraft: "",
      additionalBalanceDraft: "",
      additionalTodayDraft: "",
    };

    setStaffEntries((prev) => [...prev, newEntry]);
    setIsDirty(true);
    setShowAddStaffDropdown(false);
    setActiveStaffIndex(staffEntries.length);
  };

  // Available staff from directory not currently in today's allocation
  const availableDirectoryStaff = useMemo(() => {
    const existingNames = new Set(staffEntries.map((s) => s.staffName.trim().toLowerCase()));
    return staffDirectory.filter(
      (m) => m.isActive && !existingNames.has(m.name.trim().toLowerCase())
    );
  }, [staffDirectory, staffEntries]);

  // Save Data
  const saveData = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payloadStaffEntries: StaffEntryPayload[] = staffEntries.map((entry) => ({
        id: entry.id,
        staffName: entry.staffName,
        agentParcels: (entry.agentParcels || []).filter((p) => typeof p === "number" && p > 0),
        additionalBalanceOnly: (entry.additionalBalanceOnly || []).filter((p) => typeof p === "number" && p > 0),
        additionalTodayWins: (entry.additionalTodayWins || []).filter((p) => typeof p === "number" && p > 0),
        previousBalance: entry.previousBalance || 0,
        mailAmount: entry.mailAmount || 0,
        returnClaims: entry.returnClaims || 0,
        actualClosingBalance: entry.actualClosingBalance || 0,
      }));

      const claimData: DailyScanClaim = {
        date: selectedDate,
        totalAgentClaim: parseFloat(totalAgentClaim) || 0,
        staffEntries: payloadStaffEntries,
        updatedBy: user?.email || "Staff",
      };

      await saveDailyScanClaim(claimData);
      setSuccess("Scan balancing saved successfully!");
      setIsDirty(false);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error("Failed to save scan claim:", err);
      setError("Failed to save data. Please check connection.");
    } finally {
      setSaving(false);
    }
  };

  // Mode switching (Admin requires PIN)
  const handleModeChange = (targetMode: ScanBalancingMode) => {
    if (targetMode === "admin") {
      if (isAdminUnlocked) {
        setMode("admin");
      } else {
        setShowPasswordPrompt(true);
      }
    } else {
      setMode("staff");
    }
  };

  const handleConfirmAdminPassword = async () => {
    setPasswordError(null);
    if (!passwordInput.trim()) {
      setPasswordError("Please enter PIN.");
      return;
    }

    setIsVerifyingPass(true);
    try {
      const valid =
        (await verifyScanAdminPassword(passwordInput)) ||
        (await verifyBalancePasscode(passwordInput));
      if (valid) {
        setIsAdminUnlocked(true);
        setMode("admin");
        setShowPasswordPrompt(false);
        setPasswordInput("");
      } else {
        setPasswordError("Incorrect PIN. (Default: 8899)");
      }
    } catch {
      setPasswordError("Error verifying PIN.");
    } finally {
      setIsVerifyingPass(false);
    }
  };

  // Staff entry handlers
  const removeStaffMember = (id: string) => {
    setStaffEntries((prev) => prev.filter((s) => s.id !== id));
    setIsDirty(true);
    if (activeStaffIndex >= staffEntries.length - 1) {
      setActiveStaffIndex(Math.max(0, staffEntries.length - 2));
    }
  };

  const updateStaffNumberField = (
    id: string,
    field: keyof Pick<
      StaffEntry,
      "previousBalance" | "mailAmount" | "returnClaims" | "actualClosingBalance"
    >,
    value: string
  ) => {
    const num = parseFloat(value) || 0;
    setStaffEntries((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: num } : s)));
    setIsDirty(true);
  };

  const updateDraft = (
    id: string,
    type: "agent" | "additionalBalance" | "additionalToday",
    value: string
  ) => {
    setStaffEntries((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (type === "agent") return { ...s, agentDraft: value };
        if (type === "additionalBalance") return { ...s, additionalBalanceDraft: value };
        return { ...s, additionalTodayDraft: value };
      })
    );
  };

  const addValueFromDraft = (
    id: string,
    type: "agent" | "additionalBalance" | "additionalToday"
  ) => {
    setStaffEntries((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;

        const draftField =
          type === "agent"
            ? "agentDraft"
            : type === "additionalBalance"
            ? "additionalBalanceDraft"
            : "additionalTodayDraft";

        const raw = s[draftField] ?? "";
        const amount = parseFloat(raw);

        if (!amount || amount <= 0) return { ...s, [draftField]: "" };

        const targetArrayKey =
          type === "agent"
            ? "agentParcels"
            : type === "additionalBalance"
            ? "additionalBalanceOnly"
            : "additionalTodayWins";

        setIsDirty(true);
        return {
          ...s,
          [draftField]: "",
          [targetArrayKey]: [...(s[targetArrayKey] || []), amount],
        };
      })
    );
  };

  const removeValue = (
    id: string,
    type: "agent" | "additionalBalance" | "additionalToday",
    index: number
  ) => {
    setStaffEntries((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;

        const targetArrayKey =
          type === "agent"
            ? "agentParcels"
            : type === "additionalBalance"
            ? "additionalBalanceOnly"
            : "additionalTodayWins";

        setIsDirty(true);
        return {
          ...s,
          [targetArrayKey]: s[targetArrayKey].filter((_, i) => i !== index),
        };
      })
    );
  };

  // Overall Daily Summary
  const dailySummary = useMemo(() => {
    const target = parseFloat(totalAgentClaim) || 0;
    return calculateDailyScanSummary(target, staffEntries);
  }, [totalAgentClaim, staffEntries]);

  // Balanced staff count
  const balancedCount = useMemo(() => {
    return staffEntries.filter((s) => {
      const t = calculateStaffTotals(s);
      return Math.abs(t.diff) < 0.01;
    }).length;
  }, [staffEntries]);

  // Export to Excel
  const handleExportExcel = () => {
    if (staffEntries.length === 0) return;

    const dataRows = staffEntries.map((staff, idx) => {
      const totals = calculateStaffTotals(staff);
      return {
        "#": idx + 1,
        "Staff Name": staff.staffName,
        "Previous Balance": staff.previousBalance,
        "Mail Amount": staff.mailAmount,
        "Return Claims": staff.returnClaims,
        "Actual Closing": staff.actualClosingBalance,
        "Agent Parcels Total": totals.agentSum,
        "Extra Balance": totals.extraSum,
        "Tomorrow Wins": totals.todaySum,
        "Wins For Balance": totals.winsForBalance,
        "Predicted Closing": totals.predicted,
        "Difference": totals.diff,
        "Assigned Scanned": totals.assignedScanned,
        "Status": Math.abs(totals.diff) < 0.01 ? "BALANCED" : "DIFF",
      };
    });

    const summaryMeta = [
      ["WIN TICKETS SCAN BALANCING REPORT", ""],
      ["Balance Date", selectedDate],
      ["Agent Wins Target", dailySummary.targetAmount],
      ["Total Assigned Scanned", dailySummary.totalAssignedScanned],
      ["Office Difference", dailySummary.difference],
      ["Status", dailySummary.isBalanced ? "BALANCED" : "UNBALANCED"],
      [],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(summaryMeta);
    XLSX.utils.sheet_add_json(ws, dataRows, { origin: "A8" });
    XLSX.utils.book_append_sheet(wb, ws, "Scan Balancing");
    XLSX.writeFile(wb, `Scan_Balancing_${selectedDate}.xlsx`);
  };

  // Active staff entry for Tab View
  const currentActiveStaff = staffEntries[activeStaffIndex] || staffEntries[0];

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
    <BalanceSecurityGate
      userEmail={user.email || "Officer"}
      pageTitle="WIN TICKETS SCAN BALANCING"
      pageSubtitle="Restricted Parcel & Scan Claims System"
      badgeText="SCAN SECURED"
      systemWarning="This module handles winning ticket parcel scanning, closing balance reconciliations, and staff audit reports. Enter your authorized Security PIN to proceed."
      unlockButtonText="Unlock Win Scan Balancing"
    >
      <main className="min-h-screen bg-slate-100 text-slate-900 pb-16">
        <div className="mx-auto max-w-7xl px-4 py-5 space-y-4">
          {/* ===== 1. TOP COMPACT HEADER & NAVIGATION ===== */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-5 py-3.5 rounded-xl border border-slate-300 shadow-xs">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-lg bg-blue-100 text-blue-800">
                <FileCheck2 className="w-5 h-5" />
              </span>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-slate-900 flex items-center gap-2">
                  <span>Win Tickets Scan Balancing</span>
                  {isDirty && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      Unsaved Changes
                    </span>
                  )}
                </h1>
              </div>
            </div>

            {/* Quick Actions & Navigation */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setIsStaffDirectoryOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold border border-slate-300 transition flex items-center gap-1.5"
                title="Manage all staff members in master directory"
              >
                <Users className="w-3.5 h-3.5 text-blue-600" />
                <span>Staff Directory</span>
              </button>

              <Link
                href="/daily-balance"
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition"
              >
                Balance Organizer
              </Link>
              <Link
                href="/"
                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white font-medium transition"
              >
                Sales Page
              </Link>
              <button
                type="button"
                onClick={() => signOut(auth)}
                className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium transition"
              >
                Logout
              </button>
            </div>
          </div>

          {/* ===== 2. EXECUTIVE KPI CARDS (TARGET, SCANNED, DIFF, STATUS) ===== */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Target */}
            <div className="rounded-xl border border-blue-200 bg-white p-3.5 shadow-xs space-y-1">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-blue-700">
                <span>Agent Wins Target</span>
                {suggestedTarget !== null && suggestedTarget > 0 && mode === "admin" && (
                  <button
                    type="button"
                    onClick={() => {
                      setTotalAgentClaim(suggestedTarget.toString());
                      setIsDirty(true);
                    }}
                    className="text-[10px] text-emerald-700 hover:underline flex items-center gap-0.5"
                    title="Fill from Daily Balance report"
                  >
                    <Sparkles className="w-3 h-3 text-emerald-600" />
                    <span>Sync</span>
                  </button>
                )}
              </div>
              <div className="text-xl font-bold font-mono text-blue-950 truncate">
                {formatCurrency(dailySummary.targetAmount)}
              </div>
            </div>

            {/* Total Scanned */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                Total Scanned
              </span>
              <div className="text-xl font-bold font-mono text-slate-900 truncate">
                {formatCurrency(dailySummary.totalAssignedScanned)}
              </div>
            </div>

            {/* Office Difference */}
            <div
              className={`rounded-xl border p-3.5 shadow-xs space-y-1 ${
                dailySummary.isBalanced
                  ? "border-emerald-300 bg-emerald-50/70"
                  : dailySummary.difference !== 0
                  ? "border-rose-300 bg-rose-50/70"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider">
                <span
                  className={
                    dailySummary.isBalanced
                      ? "text-emerald-800"
                      : dailySummary.difference !== 0
                      ? "text-rose-800"
                      : "text-slate-600"
                  }
                >
                  Difference
                </span>
                {dailySummary.isBalanced && (
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-200 text-emerald-900 font-bold">
                    BALANCED
                  </span>
                )}
              </div>
              <div
                className={`text-xl font-bold font-mono truncate ${
                  dailySummary.isBalanced
                    ? "text-emerald-900"
                    : dailySummary.difference !== 0
                    ? "text-rose-950"
                    : "text-slate-900"
                }`}
              >
                {formatCurrency(dailySummary.difference)}
              </div>
            </div>

            {/* Staff Balanced Progress */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                Staff Progress
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold font-mono text-slate-900">
                  {balancedCount} / {staffEntries.length}
                </span>
                <span className="text-xs text-slate-500 font-semibold">Balanced</span>
              </div>
            </div>
          </div>

          {/* ===== 3. COMPACT TOOLBAR: DATE, TARGET INPUT, VIEW SWITCH & SAVE ===== */}
          <div className="rounded-xl border border-slate-300 bg-white px-5 py-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* Date Selector */}
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-700 shrink-0" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-bold bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setSelectedDate(todayKey())}
                  className="px-2 py-1 text-xs font-semibold rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700"
                >
                  Today
                </button>
              </div>

              <div className="h-4 w-px bg-slate-300 hidden sm:block" />

              {/* Target Input */}
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-700 shrink-0" />
                <label className="text-xs font-semibold text-slate-700">Target (Rs.):</label>
                <input
                  type="number"
                  disabled={mode === "staff"}
                  value={totalAgentClaim}
                  onChange={(e) => {
                    setTotalAgentClaim(e.target.value);
                    setIsDirty(true);
                  }}
                  placeholder="0.00"
                  className="w-32 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-bold font-mono bg-white disabled:bg-slate-100 disabled:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Layout Switch: Tabs vs Table */}
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-300">
                <button
                  type="button"
                  onClick={() => setLayoutMode("tabs")}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 ${
                    layoutMode === "tabs"
                      ? "bg-white text-slate-900 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                  title="Focused worksheet for one staff member"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Worksheet</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode("table")}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 ${
                    layoutMode === "table"
                      ? "bg-white text-slate-900 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                  title="All staff overview table"
                >
                  <TableProperties className="w-3.5 h-3.5" />
                  <span>Overview Table</span>
                </button>
              </div>

              {/* Mode Toggle */}
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-300">
                <button
                  type="button"
                  onClick={() => handleModeChange("staff")}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition ${
                    mode === "staff"
                      ? "bg-blue-600 text-white shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Staff
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange("admin")}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 ${
                    mode === "admin"
                      ? "bg-blue-600 text-white shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {isAdminUnlocked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                  <span>Admin</span>
                </button>
              </div>

              {/* Excel & Print */}
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={staffEntries.length === 0}
                className="p-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-40 transition"
                title="Export Excel"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={staffEntries.length === 0}
                className="p-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-40 transition"
                title="Print Report"
              >
                <Printer className="w-4 h-4" />
              </button>

              {/* Save Button */}
              <button
                type="button"
                disabled={saving || !isDirty}
                onClick={saveData}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs transition flex items-center gap-1.5"
              >
                {saving ? (
                  <span className="inline-block animate-spin">⏳</span>
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Save</span>
              </button>
            </div>
          </div>

          {/* Feedback Messages */}
          {error && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-xs text-red-800 flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{error}</span>
              </div>
              <button type="button" onClick={() => setError(null)} className="text-red-500 font-bold">
                ✕
              </button>
            </div>
          )}
          {success && (
            <div className="rounded-xl border border-green-300 bg-green-50 px-4 py-2.5 text-xs text-green-800 flex items-center gap-2 shadow-xs">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* ===== 4. EMPTY ALLOCATION STATE (WITH LOAD ACTIVE STAFF CTA) ===== */}
          {loading ? (
            <div className="rounded-xl border border-slate-300 bg-white p-12 text-center text-xs text-slate-500">
              <span className="inline-block animate-spin mr-2">⏳</span>
              <span>Loading scan balancing worksheet…</span>
            </div>
          ) : staffEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center space-y-3">
              <Users className="w-10 h-10 text-slate-400 mx-auto" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  No Staff Allocation for {selectedDate}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Initialize today's scan sheet by loading available active staff from the directory.
                </p>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => handleLoadActiveStaffFromDirectory()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Load Available Staff from Directory</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsStaffDirectoryOpen(true)}
                  className="px-3.5 py-2 border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg transition"
                >
                  Manage Staff Directory
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* ===== STAFF NAVIGATION BAR & ALLOCATION CONTROLS ===== */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-2.5 rounded-xl border border-slate-300 shadow-xs">
                {/* Staff Carousel Pills (Tab View) */}
                <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 flex-1 min-w-0">
                  {staffEntries.map((staff, idx) => {
                    const totals = calculateStaffTotals(staff);
                    const isStaffBalanced = Math.abs(totals.diff) < 0.01;
                    const isSelected = layoutMode === "tabs" && activeStaffIndex === idx;

                    return (
                      <button
                        key={staff.id}
                        type="button"
                        onClick={() => {
                          setActiveStaffIndex(idx);
                          setLayoutMode("tabs");
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition flex items-center gap-1.5 border ${
                          isSelected
                            ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                            : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-300"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            isStaffBalanced ? "bg-emerald-400" : "bg-rose-500"
                          }`}
                        />
                        <span>{staff.staffName}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Add Staff from Directory Dropdown */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowAddStaffDropdown((prev) => !prev)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold transition flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5 text-blue-600" />
                    <span>Add Staff</span>
                  </button>

                  {showAddStaffDropdown && (
                    <div className="absolute right-0 mt-1 w-56 rounded-xl border border-slate-300 bg-white shadow-xl z-30 py-1.5 text-xs animate-in fade-in duration-100">
                      <div className="px-3 py-1 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        Available in Directory
                      </div>
                      {availableDirectoryStaff.length === 0 ? (
                        <div className="px-3 py-2 text-slate-400 italic">
                          All active staff are added.
                        </div>
                      ) : (
                        availableDirectoryStaff.map((member) => (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => handleAddStaffFromDirectory(member)}
                            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-slate-800 font-semibold flex items-center justify-between"
                          >
                            <span>{member.name}</span>
                            <span className="text-[10px] text-slate-400">
                              {member.designation || "Officer"}
                            </span>
                          </button>
                        ))
                      )}
                      <div className="border-t border-slate-100 mt-1 pt-1 px-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddStaffDropdown(false);
                            setIsStaffDirectoryOpen(true);
                          }}
                          className="text-[11px] text-blue-600 font-bold hover:underline"
                        >
                          Manage Directory…
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ========================================================
                  VIEW 1: FOCUSED SINGLE-STAFF WORKSHEET (LOW COGNITIVE LOAD)
                  ======================================================== */}
              {layoutMode === "tabs" && currentActiveStaff && (
                (() => {
                  const staff = currentActiveStaff;
                  const totals = calculateStaffTotals(staff);
                  const isStaffBalanced = Math.abs(totals.diff) < 0.01;

                  return (
                    <div className="rounded-xl border border-slate-300 bg-white shadow-xs overflow-hidden">
                      {/* Header with Navigation and Balanced Indicator */}
                      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white text-xs font-bold font-mono">
                            {activeStaffIndex + 1}
                          </span>
                          <div>
                            <h2 className="text-base font-bold text-slate-900">
                              {staff.staffName}
                            </h2>
                          </div>

                          {/* Balancing Status Badge */}
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1 ${
                              isStaffBalanced
                                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                : "bg-rose-100 text-rose-800 border-rose-300"
                            }`}
                          >
                            {isStaffBalanced ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                <span>BALANCED</span>
                              </>
                            ) : (
                              <>
                                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                                <span>DIFF: {formatCurrency(totals.diff)}</span>
                              </>
                            )}
                          </span>
                        </div>

                        {/* Next / Prev Stepper */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={activeStaffIndex === 0}
                            onClick={() => setActiveStaffIndex((prev) => Math.max(0, prev - 1))}
                            className="p-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-30 text-slate-700"
                            title="Previous staff"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <span className="text-xs font-semibold text-slate-500 px-1">
                            {activeStaffIndex + 1} of {staffEntries.length}
                          </span>
                          <button
                            type="button"
                            disabled={activeStaffIndex === staffEntries.length - 1}
                            onClick={() =>
                              setActiveStaffIndex((prev) => Math.min(staffEntries.length - 1, prev + 1))
                            }
                            className="p-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-30 text-slate-700"
                            title="Next staff"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>

                          {mode === "admin" && (
                            <button
                              type="button"
                              onClick={() => removeStaffMember(staff.id)}
                              className="ml-2 p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 transition"
                              title="Remove from today's sheet"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="p-5 space-y-5">
                        {/* Row 1: The 4 Core Balances */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                            <label className="text-[11px] font-bold text-slate-600 block mb-1">
                              Previous Balance (Rs.)
                            </label>
                            <input
                              type="number"
                              disabled={mode === "staff"}
                              value={staff.previousBalance || ""}
                              onChange={(e) =>
                                updateStaffNumberField(staff.id, "previousBalance", e.target.value)
                              }
                              placeholder="0.00"
                              className="w-full px-2.5 py-1 text-sm font-bold font-mono border border-slate-300 rounded bg-white disabled:bg-slate-100 focus:outline-none"
                            />
                          </div>

                          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                            <label className="text-[11px] font-bold text-slate-600 block mb-1">
                              Mail to Board (Rs.)
                            </label>
                            <input
                              type="number"
                              value={staff.mailAmount || ""}
                              onChange={(e) =>
                                updateStaffNumberField(staff.id, "mailAmount", e.target.value)
                              }
                              placeholder="0.00"
                              className="w-full px-2.5 py-1 text-sm font-bold font-mono border border-slate-300 rounded bg-white focus:outline-none focus:border-blue-500"
                            />
                          </div>

                          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                            <label className="text-[11px] font-bold text-slate-600 block mb-1">
                              Return Claims (Rs.)
                            </label>
                            <input
                              type="number"
                              value={staff.returnClaims || ""}
                              onChange={(e) =>
                                updateStaffNumberField(staff.id, "returnClaims", e.target.value)
                              }
                              placeholder="0.00"
                              className="w-full px-2.5 py-1 text-sm font-bold font-mono border border-slate-300 rounded bg-white focus:outline-none focus:border-blue-500"
                            />
                          </div>

                          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                            <label className="text-[11px] font-bold text-slate-600 block mb-1">
                              Actual Closing (Rs.)
                            </label>
                            <input
                              type="number"
                              value={staff.actualClosingBalance || ""}
                              onChange={(e) =>
                                updateStaffNumberField(staff.id, "actualClosingBalance", e.target.value)
                              }
                              placeholder="0.00"
                              className="w-full px-2.5 py-1 text-sm font-bold font-mono border border-slate-300 rounded bg-white focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>

                        {/* Row 2: 3 Parcel Scanning Sections */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {/* 1. Agent Parcels */}
                          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-slate-800">Agent Parcels</span>
                              <span className="font-mono font-bold text-blue-700">
                                {formatCurrency(totals.agentSum)}
                              </span>
                            </div>

                            {mode === "admin" && (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  value={staff.agentDraft ?? ""}
                                  onChange={(e) => updateDraft(staff.id, "agent", e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      addValueFromDraft(staff.id, "agent");
                                    }
                                  }}
                                  placeholder="Amount (Press Enter)"
                                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => addValueFromDraft(staff.id, "agent")}
                                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
                                >
                                  +
                                </button>
                              </div>
                            )}

                            <div className="flex flex-wrap gap-1 min-h-[32px] p-1.5 rounded bg-white border border-slate-200">
                              {(staff.agentParcels || []).length === 0 ? (
                                <span className="text-[11px] text-slate-400 italic">No parcels</span>
                              ) : (
                                staff.agentParcels.map((p, idx) => (
                                  <span
                                    key={idx}
                                    className="px-1.5 py-0.5 rounded bg-slate-100 text-[11px] font-mono font-semibold text-slate-800 flex items-center gap-1 border border-slate-200"
                                  >
                                    <span>{formatCurrency(p)}</span>
                                    {mode === "admin" && (
                                      <button
                                        type="button"
                                        onClick={() => removeValue(staff.id, "agent", idx)}
                                        className="text-red-500 hover:text-red-700 font-bold"
                                      >
                                        ×
                                      </button>
                                    )}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>

                          {/* 2. Additional (This Balance) */}
                          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-slate-800">Additional (This Balance)</span>
                              <span className="font-mono font-bold text-teal-700">
                                {formatCurrency(totals.extraSum)}
                              </span>
                            </div>

                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                value={staff.additionalBalanceDraft ?? ""}
                                onChange={(e) =>
                                  updateDraft(staff.id, "additionalBalance", e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addValueFromDraft(staff.id, "additionalBalance");
                                  }
                                }}
                                placeholder="Amount (Press Enter)"
                                className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => addValueFromDraft(staff.id, "additionalBalance")}
                                className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs font-bold"
                              >
                                +
                              </button>
                            </div>

                            <div className="flex flex-wrap gap-1 min-h-[32px] p-1.5 rounded bg-white border border-slate-200">
                              {(staff.additionalBalanceOnly || []).length === 0 ? (
                                <span className="text-[11px] text-slate-400 italic">No extra amounts</span>
                              ) : (
                                staff.additionalBalanceOnly.map((p, idx) => (
                                  <span
                                    key={idx}
                                    className="px-1.5 py-0.5 rounded bg-teal-50 text-[11px] font-mono font-semibold text-teal-900 flex items-center gap-1 border border-teal-200"
                                  >
                                    <span>{formatCurrency(p)}</span>
                                    <button
                                      type="button"
                                      onClick={() => removeValue(staff.id, "additionalBalance", idx)}
                                      className="text-red-500 hover:text-red-700 font-bold"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))
                              )}
                            </div>
                          </div>

                          {/* 3. Today's Wins (Tomorrow Balance) */}
                          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-slate-800">Tomorrow Balance Wins</span>
                              <span className="font-mono font-bold text-purple-700">
                                {formatCurrency(totals.todaySum)}
                              </span>
                            </div>

                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                value={staff.additionalTodayDraft ?? ""}
                                onChange={(e) =>
                                  updateDraft(staff.id, "additionalToday", e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addValueFromDraft(staff.id, "additionalToday");
                                  }
                                }}
                                placeholder="Amount (Press Enter)"
                                className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => addValueFromDraft(staff.id, "additionalToday")}
                                className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-bold"
                              >
                                +
                              </button>
                            </div>

                            <div className="flex flex-wrap gap-1 min-h-[32px] p-1.5 rounded bg-white border border-slate-200">
                              {(staff.additionalTodayWins || []).length === 0 ? (
                                <span className="text-[11px] text-slate-400 italic">No tomorrow wins</span>
                              ) : (
                                staff.additionalTodayWins.map((p, idx) => (
                                  <span
                                    key={idx}
                                    className="px-1.5 py-0.5 rounded bg-purple-50 text-[11px] font-mono font-semibold text-purple-900 flex items-center gap-1 border border-purple-200"
                                  >
                                    <span>{formatCurrency(p)}</span>
                                    <button
                                      type="button"
                                      onClick={() => removeValue(staff.id, "additionalToday", idx)}
                                      className="text-red-500 hover:text-red-700 font-bold"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Row 3: Mathematical Reconciliation Summary */}
                        <div className="rounded-xl bg-slate-900 text-white p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div>
                            <span className="text-slate-400 block text-[11px]">Wins for Balance</span>
                            <span className="font-mono font-bold text-sm text-blue-300">
                              {formatCurrency(totals.winsForBalance)}
                            </span>
                          </div>

                          <div>
                            <span className="text-slate-400 block text-[11px]">Predicted Closing</span>
                            <span className="font-mono font-bold text-sm text-slate-200">
                              {formatCurrency(totals.predicted)}
                            </span>
                          </div>

                          <div>
                            <span className="text-slate-400 block text-[11px]">Scanned Claim</span>
                            <span className="font-mono font-bold text-emerald-300">
                              {formatCurrency(totals.assignedScanned)}
                            </span>
                          </div>

                          <div>
                            <span className="text-slate-400 block text-[11px]">Difference</span>
                            <span
                              className={`font-mono font-bold text-sm ${
                                isStaffBalanced ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              {formatCurrency(totals.diff)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()
              )}

              {/* ========================================================
                  VIEW 2: DENSE SUMMARY TABLE (ALL STAFF AT A GLANCE)
                  ======================================================== */}
              {layoutMode === "table" && (
                <div className="rounded-xl border border-slate-300 bg-white shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold uppercase text-[11px]">
                          <th className="px-3 py-2.5">#</th>
                          <th className="px-3 py-2.5">Staff</th>
                          <th className="px-3 py-2.5 text-right">Prev Bal</th>
                          <th className="px-3 py-2.5 text-right">Mail</th>
                          <th className="px-3 py-2.5 text-right">Returns</th>
                          <th className="px-3 py-2.5 text-right">Closing</th>
                          <th className="px-3 py-2.5 text-right">Parcels</th>
                          <th className="px-3 py-2.5 text-right">Scanned</th>
                          <th className="px-3 py-2.5 text-right">Diff</th>
                          <th className="px-3 py-2.5 text-center">Status</th>
                          <th className="px-3 py-2.5 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {staffEntries.map((staff, idx) => {
                          const totals = calculateStaffTotals(staff);
                          const isStaffBalanced = Math.abs(totals.diff) < 0.01;

                          return (
                            <tr
                              key={staff.id}
                              className="hover:bg-slate-50 transition font-mono"
                            >
                              <td className="px-3 py-2 text-slate-400 font-sans">{idx + 1}</td>
                              <td className="px-3 py-2 font-bold font-sans text-slate-900">
                                {staff.staffName}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatCurrency(staff.previousBalance)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatCurrency(staff.mailAmount)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatCurrency(staff.returnClaims)}
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-slate-800">
                                {formatCurrency(staff.actualClosingBalance)}
                              </td>
                              <td className="px-3 py-2 text-right text-blue-700">
                                {formatCurrency(totals.agentSum)}
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-emerald-800">
                                {formatCurrency(totals.assignedScanned)}
                              </td>
                              <td
                                className={`px-3 py-2 text-right font-bold ${
                                  isStaffBalanced ? "text-emerald-700" : "text-rose-700"
                                }`}
                              >
                                {formatCurrency(totals.diff)}
                              </td>
                              <td className="px-3 py-2 text-center font-sans">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    isStaffBalanced
                                      ? "bg-emerald-100 text-emerald-800"
                                      : "bg-rose-100 text-rose-800"
                                  }`}
                                >
                                  {isStaffBalanced ? "OK" : "DIFF"}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center font-sans">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveStaffIndex(idx);
                                    setLayoutMode("tabs");
                                  }}
                                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px]"
                                >
                                  Open
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ===== MASTER STAFF DIRECTORY MODAL ===== */}
        <StaffDirectoryModal
          isOpen={isStaffDirectoryOpen}
          onClose={() => setIsStaffDirectoryOpen(false)}
          onDirectoryChanged={loadDirectoryData}
          onApplyActiveToToday={(activeStaff) => handleLoadActiveStaffFromDirectory(activeStaff)}
        />

        {/* ===== ADMIN PIN PROMPT MODAL ===== */}
        {showPasswordPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-100">
            <div className="w-full max-w-sm rounded-xl border border-slate-300 bg-white p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                  <Lock className="w-4 h-4 text-blue-700" />
                  <span>Admin Clearance Required</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordPrompt(false);
                    setPasswordInput("");
                    setPasswordError(null);
                  }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {passwordError && (
                <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
                  {passwordError}
                </div>
              )}

              <div className="space-y-3">
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmAdminPassword();
                  }}
                  autoFocus
                  placeholder="Enter PIN (Default: 8899)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-600 font-mono text-center tracking-widest"
                />

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordPrompt(false);
                      setPasswordInput("");
                      setPasswordError(null);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isVerifyingPass}
                    onClick={handleConfirmAdminPassword}
                    className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white shadow disabled:opacity-50"
                  >
                    {isVerifyingPass ? "Verifying…" : "Unlock Admin"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </BalanceSecurityGate>
  );
}

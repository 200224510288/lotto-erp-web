// app/scan-balancing/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import * as XLSX from "xlsx";
import {
  Calendar,
  Users,
  Plus,
  Trash2,
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
  RefreshCw,
  Check,
  AlertTriangle,
  ArrowRight,
  Minus,
  Equal,
  ShieldCheck,
  RotateCcw,
  Package,
  Layers,
  Coins,
  Send,
  User,
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

function offsetDate(dateStr: string, offsetDays: number): string {
  try {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return dateStr;
  }
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

  // Status & Autosave Flags
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Autosave options & state
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null);

  // Refs for tracking changes and avoiding overwrite race conditions
  const isInitialLoadDoneRef = useRef<boolean>(false);
  const pendingSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const staffEntriesRef = useRef<StaffEntry[]>(staffEntries);
  const totalAgentClaimRef = useRef<string>(totalAgentClaim);
  const selectedDateRef = useRef<string>(selectedDate);

  // Admin Password Prompt Modal
  const [showPasswordPrompt, setShowPasswordPrompt] = useState<boolean>(false);
  const [passwordInput, setPasswordInput] = useState<string>("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isVerifyingPass, setIsVerifyingPass] = useState<boolean>(false);

  // Keep refs synchronized
  useEffect(() => {
    staffEntriesRef.current = staffEntries;
    totalAgentClaimRef.current = totalAgentClaim;
    selectedDateRef.current = selectedDate;
  }, [staffEntries, totalAgentClaim, selectedDate]);

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

  // Prevent accidental unload if changes are unsaved
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const loadDirectoryData = async () => {
    try {
      const list = await getStaffDirectory();
      setStaffDirectory(list);
    } catch (err) {
      console.error("Failed to load staff directory:", err);
    }
  };

  const getLocalStorageKey = (date: string) => `dlb_scan_verified_${date}`;

  const saveVerifiedToLocalStorage = (date: string, entries: StaffEntry[]) => {
    if (typeof window === "undefined") return;
    try {
      const data: Record<
        string,
        {
          agent?: number[];
          reduction?: number[];
          additionalBalance?: number[];
          additionalToday?: number[];
        }
      > = {};
      entries.forEach((s) => {
        data[s.id] = {
          agent: s.verifiedAgentParcels || [],
          reduction: s.verifiedReturnedParcels || [],
          additionalBalance: s.verifiedAdditionalBalance || [],
          additionalToday: s.verifiedAdditionalToday || [],
        };
      });
      localStorage.setItem(getLocalStorageKey(date), JSON.stringify(data));
    } catch (e) {
      // Ignore storage errors
    }
  };

  const normalizeStaffEntry = (entry: Partial<StaffEntryPayload>): StaffEntry => {
    return {
      id: entry.id?.toString() ?? Date.now().toString(),
      staffName: entry.staffName || "",
      agentParcels: Array.isArray(entry.agentParcels) ? entry.agentParcels : [],
      returnedParcels: Array.isArray(entry.returnedParcels) ? entry.returnedParcels : [],
      additionalBalanceOnly: Array.isArray(entry.additionalBalanceOnly) ? entry.additionalBalanceOnly : [],
      additionalTodayWins: Array.isArray(entry.additionalTodayWins) ? entry.additionalTodayWins : [],
      verifiedAgentParcels: Array.isArray(entry.verifiedAgentParcels) ? entry.verifiedAgentParcels : [],
      verifiedReturnedParcels: Array.isArray(entry.verifiedReturnedParcels) ? entry.verifiedReturnedParcels : [],
      verifiedAdditionalBalance: Array.isArray(entry.verifiedAdditionalBalance) ? entry.verifiedAdditionalBalance : [],
      verifiedAdditionalToday: Array.isArray(entry.verifiedAdditionalToday) ? entry.verifiedAdditionalToday : [],
      previousBalance: entry.previousBalance ?? 0,
      mailAmount: entry.mailAmount ?? 0,
      returnClaims: entry.returnClaims ?? 0,
      actualClosingBalance: entry.actualClosingBalance ?? 0,
      agentDraft: "",
      reductionDraft: "",
      additionalBalanceDraft: "",
      additionalTodayDraft: "",
    };
  };

  const loadDateData = async (dateStr: string) => {
    if (pendingSaveTimeoutRef.current) {
      clearTimeout(pendingSaveTimeoutRef.current);
      pendingSaveTimeoutRef.current = null;
    }

    setLoading(true);
    setError(null);
    setIsDirty(false);
    setSaveStatus("idle");
    isInitialLoadDoneRef.current = false;

    try {
      let localCache: Record<string, any> = {};
      if (typeof window !== "undefined") {
        try {
          const raw = localStorage.getItem(getLocalStorageKey(dateStr));
          if (raw) localCache = JSON.parse(raw);
        } catch (e) {}
      }

      const claim = await getDailyScanClaim(dateStr);
      if (claim && claim.staffEntries && claim.staffEntries.length > 0) {
        setTotalAgentClaim(claim.totalAgentClaim ? claim.totalAgentClaim.toString() : "");
        const loadedEntries = claim.staffEntries.map((e) => {
          const normalized = normalizeStaffEntry(e);
          const cached = localCache[normalized.id];
          if (cached) {
            if ((!normalized.verifiedAgentParcels || normalized.verifiedAgentParcels.length === 0) && cached.agent) {
              normalized.verifiedAgentParcels = cached.agent;
            }
            if ((!normalized.verifiedReturnedParcels || normalized.verifiedReturnedParcels.length === 0) && cached.reduction) {
              normalized.verifiedReturnedParcels = cached.reduction;
            }
            if ((!normalized.verifiedAdditionalBalance || normalized.verifiedAdditionalBalance.length === 0) && cached.additionalBalance) {
              normalized.verifiedAdditionalBalance = cached.additionalBalance;
            }
            if ((!normalized.verifiedAdditionalToday || normalized.verifiedAdditionalToday.length === 0) && cached.additionalToday) {
              normalized.verifiedAdditionalToday = cached.additionalToday;
            }
          }
          return normalized;
        });
        setStaffEntries(loadedEntries);
        staffEntriesRef.current = loadedEntries;
      } else {
        setTotalAgentClaim("");
        setStaffEntries([]);
        staffEntriesRef.current = [];
      }

      const suggested = await getSuggestedAgentWinsTarget(dateStr);
      setSuggestedTarget(suggested);
      setActiveStaffIndex(0);
      setSaveStatus("saved");
      setLastSavedTime(new Date());
    } catch (err) {
      console.error("Failed to load scan claim:", err);
      setError("Failed to load scan balancing data for the selected date.");
    } finally {
      setLoading(false);
      setTimeout(() => {
        isInitialLoadDoneRef.current = true;
        setIsDirty(false);
      }, 150);
    }
  };

  // Core execution of saving data to Firestore & localStorage
  const executeSave = useCallback(
    async (
      currentDate: string,
      currentStaff: StaffEntry[],
      currentClaim: string
    ) => {
      if (!currentDate) return;
      setSaveStatus("saving");
      setError(null);

      try {
        const payloadStaffEntries: StaffEntryPayload[] = currentStaff.map((entry) => ({
          id: entry.id,
          staffName: entry.staffName,
          agentParcels: (entry.agentParcels || []).filter((p) => typeof p === "number" && p > 0),
          returnedParcels: (entry.returnedParcels || []).filter((p) => typeof p === "number" && p > 0),
          additionalBalanceOnly: (entry.additionalBalanceOnly || []).filter((p) => typeof p === "number" && p > 0),
          additionalTodayWins: (entry.additionalTodayWins || []).filter((p) => typeof p === "number" && p > 0),
          verifiedAgentParcels: entry.verifiedAgentParcels || [],
          verifiedReturnedParcels: entry.verifiedReturnedParcels || [],
          verifiedAdditionalBalance: entry.verifiedAdditionalBalance || [],
          verifiedAdditionalToday: entry.verifiedAdditionalToday || [],
          previousBalance: entry.previousBalance || 0,
          mailAmount: entry.mailAmount || 0,
          returnClaims: entry.returnClaims || 0,
          actualClosingBalance: entry.actualClosingBalance || 0,
        }));

        const claimData: DailyScanClaim = {
          date: currentDate,
          totalAgentClaim: parseFloat(currentClaim) || 0,
          staffEntries: payloadStaffEntries,
          updatedBy: user?.email || "Staff",
        };

        await saveDailyScanClaim(claimData);
        saveVerifiedToLocalStorage(currentDate, currentStaff);

        setSaveStatus("saved");
        setLastSavedTime(new Date());
        setIsDirty(false);
      } catch (err) {
        console.error("Autosave failed:", err);
        setSaveStatus("error");
        setError("Autosave failed. Check connection.");
      }
    },
    [user?.email]
  );

  // Debounced Autosave Effect
  useEffect(() => {
    if (!autoSaveEnabled) return;
    if (loading || !isInitialLoadDoneRef.current) return;
    if (!isDirty) return;

    if (pendingSaveTimeoutRef.current) {
      clearTimeout(pendingSaveTimeoutRef.current);
    }

    // Schedule debounced save after 850ms of inactivity
    pendingSaveTimeoutRef.current = setTimeout(() => {
      executeSave(selectedDateRef.current, staffEntriesRef.current, totalAgentClaimRef.current);
    }, 850);

    return () => {
      if (pendingSaveTimeoutRef.current) {
        clearTimeout(pendingSaveTimeoutRef.current);
      }
    };
  }, [staffEntries, totalAgentClaim, isDirty, autoSaveEnabled, loading, executeSave]);

  // Immediate manual trigger (by clicking on the sync status badge)
  const handleImmediateSync = () => {
    if (pendingSaveTimeoutRef.current) {
      clearTimeout(pendingSaveTimeoutRef.current);
      pendingSaveTimeoutRef.current = null;
    }
    executeSave(selectedDate, staffEntries, totalAgentClaim);
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
      staffEntriesRef.current = entries;
      setIsDirty(true);
      setActiveStaffIndex(0);
      setSuccess(`Loaded ${entries.length} staff members.`);
      setTimeout(() => setSuccess(null), 3000);
      // Immediately trigger save for freshly initialized allocation
      executeSave(selectedDate, entries, totalAgentClaim);
    } catch (err) {
      console.error("Error building staff allocation:", err);
      setError("Failed to load staff from directory.");
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
      returnedParcels: [],
      additionalBalanceOnly: [],
      additionalTodayWins: [],
      verifiedAgentParcels: [],
      verifiedReturnedParcels: [],
      verifiedAdditionalBalance: [],
      verifiedAdditionalToday: [],
      previousBalance: 0,
      mailAmount: 0,
      returnClaims: 0,
      actualClosingBalance: 0,
      agentDraft: "",
      reductionDraft: "",
      additionalBalanceDraft: "",
      additionalTodayDraft: "",
    };

    setStaffEntries((prev) => {
      const updated = [...prev, newEntry];
      staffEntriesRef.current = updated;
      return updated;
    });
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
    setStaffEntries((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      staffEntriesRef.current = updated;
      return updated;
    });
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
    setStaffEntries((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, [field]: num } : s));
      staffEntriesRef.current = updated;
      return updated;
    });
    setIsDirty(true);
  };

  const updateDraft = (
    id: string,
    type: "agent" | "reduction" | "additionalBalance" | "additionalToday",
    value: string
  ) => {
    setStaffEntries((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (type === "agent") return { ...s, agentDraft: value };
        if (type === "reduction") return { ...s, reductionDraft: value };
        if (type === "additionalBalance") return { ...s, additionalBalanceDraft: value };
        return { ...s, additionalTodayDraft: value };
      })
    );
  };

  const addValueFromDraft = (
    id: string,
    type: "agent" | "reduction" | "additionalBalance" | "additionalToday"
  ) => {
    setStaffEntries((prev) => {
      const updated = prev.map((s) => {
        if (s.id !== id) return s;

        const draftField =
          type === "agent"
            ? "agentDraft"
            : type === "reduction"
            ? "reductionDraft"
            : type === "additionalBalance"
            ? "additionalBalanceDraft"
            : "additionalTodayDraft";

        const raw = s[draftField] ?? "";
        const amount = parseFloat(raw);

        if (!amount || amount <= 0) return { ...s, [draftField]: "" };

        const targetArrayKey =
          type === "agent"
            ? "agentParcels"
            : type === "reduction"
            ? "returnedParcels"
            : type === "additionalBalance"
            ? "additionalBalanceOnly"
            : "additionalTodayWins";

        return {
          ...s,
          [draftField]: "",
          [targetArrayKey]: [...(s[targetArrayKey] || []), amount],
        };
      });
      staffEntriesRef.current = updated;
      return updated;
    });
    setIsDirty(true);
  };

  const removeValue = (
    id: string,
    type: "agent" | "reduction" | "additionalBalance" | "additionalToday",
    index: number
  ) => {
    setStaffEntries((prev) => {
      const updated = prev.map((s) => {
        if (s.id !== id) return s;

        const targetArrayKey =
          type === "agent"
            ? "agentParcels"
            : type === "reduction"
            ? "returnedParcels"
            : type === "additionalBalance"
            ? "additionalBalanceOnly"
            : "additionalTodayWins";

        const verifiedKey =
          type === "agent"
            ? "verifiedAgentParcels"
            : type === "reduction"
            ? "verifiedReturnedParcels"
            : type === "additionalBalance"
            ? "verifiedAdditionalBalance"
            : "verifiedAdditionalToday";

        const currentVerified: number[] = s[verifiedKey] || [];
        const updatedVerified = currentVerified
          .filter((i) => i !== index)
          .map((i) => (i > index ? i - 1 : i));

        return {
          ...s,
          [targetArrayKey]: (s[targetArrayKey] || []).filter((_, i) => i !== index),
          [verifiedKey]: updatedVerified,
        };
      });
      staffEntriesRef.current = updated;
      saveVerifiedToLocalStorage(selectedDate, updated);
      return updated;
    });
    setIsDirty(true);
  };

  const toggleParcelMark = (
    staffId: string,
    type: "agent" | "reduction" | "additionalBalance" | "additionalToday",
    index: number
  ) => {
    setStaffEntries((prev) => {
      const updated = prev.map((s) => {
        if (s.id !== staffId) return s;
        const verifiedKey =
          type === "agent"
            ? "verifiedAgentParcels"
            : type === "reduction"
            ? "verifiedReturnedParcels"
            : type === "additionalBalance"
            ? "verifiedAdditionalBalance"
            : "verifiedAdditionalToday";

        const currentVerified: number[] = s[verifiedKey] || [];
        const isMarked = currentVerified.includes(index);
        const newVerified = isMarked
          ? currentVerified.filter((i) => i !== index)
          : [...currentVerified, index];

        return {
          ...s,
          [verifiedKey]: newVerified,
        };
      });
      staffEntriesRef.current = updated;
      saveVerifiedToLocalStorage(selectedDate, updated);
      return updated;
    });
    setIsDirty(true);
  };

  const clearParcelMarks = (
    staffId: string,
    type: "agent" | "reduction" | "additionalBalance" | "additionalToday"
  ) => {
    setStaffEntries((prev) => {
      const updated = prev.map((s) => {
        if (s.id !== staffId) return s;
        const verifiedKey =
          type === "agent"
            ? "verifiedAgentParcels"
            : type === "reduction"
            ? "verifiedReturnedParcels"
            : type === "additionalBalance"
            ? "verifiedAdditionalBalance"
            : "verifiedAdditionalToday";

        return {
          ...s,
          [verifiedKey]: [],
        };
      });
      staffEntriesRef.current = updated;
      saveVerifiedToLocalStorage(selectedDate, updated);
      return updated;
    });
    setIsDirty(true);
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
        "Actual Closing": staff.actualClosingBalance,
        "Assigned Parcels Total": totals.agentSum,
        "Assigned Parcels Count": totals.agentCount,
        "Returned Parcels (Reduction)": totals.reductionSum,
        "Returned Parcels Count": totals.reductionCount,
        "Net Agent Parcels": totals.netAgentSum,
        "Extra Balance": totals.extraSum,
        "Wins For Balance": totals.winsForBalance,
        "Predicted Closing": totals.predicted,
        "Difference": totals.diff,
        "Assigned Scanned": totals.assignedScanned,
        Status: Math.abs(totals.diff) < 0.01 ? "BALANCED" : "DIFF",
      };
    });

    const summaryMeta = [
      ["WIN TICKETS SCAN BALANCING REPORT", ""],
      ["Balance Date", selectedDate],
      ["Agent Wins Target", dailySummary.targetAmount],
      ["Total Assigned Parcels Sum", dailySummary.totalAgentParcelsSum],
      ["Total Assigned Parcels Count", dailySummary.totalAgentParcelsCount],
      ["Total Returned Parcels Sum", dailySummary.totalReductionSum],
      ["Total Returned Parcels Count", dailySummary.totalReductionCount],
      ["Total Net Agent Parcels", dailySummary.totalNetAgentParcelsSum],
      ["Total Assigned Scanned", dailySummary.totalAssignedScanned],
      ["Office Difference", dailySummary.difference],
      ["Status", dailySummary.isBalanced ? "BALANCED" : "UNBALANCED"],
      [],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(summaryMeta);
    XLSX.utils.sheet_add_json(ws, dataRows, { origin: "A10" });
    XLSX.utils.book_append_sheet(wb, ws, "Scan Balancing");
    XLSX.writeFile(wb, `Scan_Balancing_${selectedDate}.xlsx`);
  };

  // Active staff entry for Tab View
  const currentActiveStaff = staffEntries[activeStaffIndex] || staffEntries[0];

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-slate-700">
        <div className="flex items-center gap-3 text-base font-semibold">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
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
      {/* FULL LIGHT BACKGROUND & WIDE-STRETCHED CONTAINER */}
      <main className="min-h-screen bg-[#f8fafc] text-slate-800 pb-24 font-sans">
        <div className="w-full px-4 sm:px-8 lg:px-12 xl:px-14 py-6 space-y-6">
          {/* =========================================================
              1. COMMAND HEADER WITH BIG LIGHT CONTROLS
              ========================================================= */}
          <header className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-3xl border border-slate-200/90 shadow-sm">
            {/* Title & Date Stepper */}
            <div className="flex items-center gap-5 flex-wrap">
              <div className="flex items-center gap-3.5">
                <span className="p-3.5 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 shadow-xs">
                  <FileCheck2 className="w-7 h-7" />
                </span>
                <div>
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                    Scan Balancing
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 font-medium">
                    Ticket Parcel Reconciliation & Office Audit
                  </p>
                </div>
              </div>

              {/* Big, Friendly Date Stepper */}
              <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setSelectedDate((d) => offsetDate(d, -1))}
                  className="p-2.5 rounded-xl hover:bg-white text-slate-700 hover:text-slate-900 transition shadow-2xs"
                  title="Previous Day"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-2 px-3 py-1">
                  <Calendar className="w-5 h-5 text-blue-600" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="text-base font-bold font-mono bg-transparent text-slate-900 focus:outline-none cursor-pointer"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDate((d) => offsetDate(d, 1))}
                  className="p-2.5 rounded-xl hover:bg-white text-slate-700 hover:text-slate-900 transition shadow-2xs"
                  title="Next Day"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                {selectedDate !== todayKey() && (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(todayKey())}
                    className="px-3.5 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-xl shadow-xs hover:bg-blue-700 transition"
                  >
                    Today
                  </button>
                )}
              </div>
            </div>

            {/* Smart Autosave Pill & Light Controls */}
            <div className="flex items-center gap-3 text-sm flex-wrap">
              {/* Big Autosave Indicator Pill */}
              <div
                onClick={handleImmediateSync}
                title="Autosave is active. Click to trigger instant cloud save."
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border transition-all duration-200 cursor-pointer select-none text-xs sm:text-sm font-bold shadow-xs ${
                  saveStatus === "saving"
                    ? "bg-blue-50 text-blue-700 border-blue-200 animate-pulse"
                    : saveStatus === "error"
                    ? "bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100"
                    : isDirty
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                }`}
              >
                {saveStatus === "saving" ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Autosaving…</span>
                  </>
                ) : saveStatus === "error" ? (
                  <>
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>Sync Failed (Retry)</span>
                  </>
                ) : isDirty ? (
                  <>
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-ping" />
                    <span>Saving changes…</span>
                  </>
                ) : (
                  <>
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                    <Check className="w-4 h-4 text-emerald-600 stroke-[3]" />
                    <span>Autosaved</span>
                    {lastSavedTime && (
                      <span className="text-xs text-emerald-700 font-mono hidden md:inline">
                        {lastSavedTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* Autosave Switch Option */}
              <button
                type="button"
                onClick={() => setAutoSaveEnabled((prev) => !prev)}
                className={`px-3.5 py-2.5 rounded-2xl border text-xs font-bold transition flex items-center gap-2 ${
                  autoSaveEnabled
                    ? "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                    : "bg-amber-50 border-amber-200 text-amber-800"
                }`}
                title={autoSaveEnabled ? "Autosave is ON (click to pause)" : "Autosave is OFF (click to enable)"}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${autoSaveEnabled ? "bg-emerald-500" : "bg-slate-400"}`} />
                <span className="hidden sm:inline">{autoSaveEnabled ? "Autosave ON" : "Autosave OFF"}</span>
              </button>

              {/* Staff Directory Trigger */}
              <button
                type="button"
                onClick={() => setIsStaffDirectoryOpen(true)}
                className="px-4 py-2.5 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold border border-slate-200 transition flex items-center gap-2"
                title="Manage Staff Directory"
              >
                <Users className="w-4 h-4 text-blue-600" />
                <span className="hidden sm:inline">Directory</span>
              </button>

              {/* Excel & Print Buttons */}
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={staffEntries.length === 0}
                className="p-2.5 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 disabled:opacity-30 transition shadow-2xs"
                title="Export Excel"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={staffEntries.length === 0}
                className="p-2.5 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 disabled:opacity-30 transition shadow-2xs"
                title="Print Report"
              >
                <Printer className="w-5 h-5" />
              </button>

              {/* Mode Toggle (Staff / Admin) */}
              <div className="inline-flex rounded-2xl bg-slate-100 p-1 border border-slate-200">
                <button
                  type="button"
                  onClick={() => handleModeChange("staff")}
                  className={`px-3.5 py-2 text-xs font-bold rounded-xl transition ${
                    mode === "staff" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Staff
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange("admin")}
                  className={`px-3.5 py-2 text-xs font-bold rounded-xl transition flex items-center gap-1.5 ${
                    mode === "admin" ? "bg-blue-600 text-white shadow-xs" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {isAdminUnlocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  <span>Admin</span>
                </button>
              </div>

              {/* Balance Organizer Link */}
              <Link
                href="/daily-balance"
                className="px-4 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition shadow-xs hidden lg:inline-block"
              >
                Balance Organizer
              </Link>
              <button
                type="button"
                onClick={() => signOut(auth)}
                className="p-2 rounded-2xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                title="Logout"
              >
                ✕
              </button>
            </div>
          </header>

          {/* =========================================================
              2. WIDE EXECUTIVE FINANCIAL HERO METRICS
              ========================================================= */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Target Claim */}
            <div className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50/60 via-white to-blue-50/20 p-5 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-blue-700 flex items-center gap-1.5">
                  <Target className="w-4 h-4 text-blue-600" />
                  Office Target
                </span>
                {suggestedTarget !== null && suggestedTarget > 0 && mode === "admin" && (
                  <button
                    type="button"
                    onClick={() => {
                      setTotalAgentClaim(suggestedTarget.toString());
                      setIsDirty(true);
                    }}
                    className="text-xs font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-100 px-3 py-1 rounded-xl flex items-center gap-1 transition shadow-2xs"
                    title="Auto-fill from Daily Balance report"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    Sync
                  </button>
                )}
              </div>
              <div className="mt-3">
                {mode === "admin" ? (
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-slate-400">Rs.</span>
                    <input
                      type="number"
                      value={totalAgentClaim}
                      onChange={(e) => {
                        setTotalAgentClaim(e.target.value);
                        setIsDirty(true);
                      }}
                      placeholder="0.00"
                      className="w-full h-14 text-2xl sm:text-3xl font-black font-mono text-blue-950 bg-white border-2 border-blue-200 rounded-2xl px-4 shadow-xs focus:outline-none focus:ring-4 focus:ring-blue-100"
                    />
                  </div>
                ) : (
                  <div className="text-2xl sm:text-3xl font-black font-mono text-blue-950 truncate">
                    {formatCurrency(dailySummary.targetAmount)}
                  </div>
                )}
                <div className="text-xs font-medium text-slate-500 mt-1.5">
                  Required Win Parcels
                </div>
              </div>
            </div>

            {/* Card 2: Total Scanned */}
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-indigo-600" />
                  Total Scanned
                </span>
                <span className="text-xs font-bold font-mono px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {dailySummary.totalAgentParcelsCount} parcels
                </span>
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-black font-mono text-slate-900 truncate">
                  {formatCurrency(dailySummary.totalAssignedScanned)}
                </div>
                <div className="text-xs font-medium text-slate-500 mt-1.5 flex items-center gap-2 truncate">
                  <span>Gross: {formatCurrency(dailySummary.totalAgentParcelsSum)}</span>
                  {dailySummary.totalReductionSum > 0 && (
                    <span className="text-rose-600 font-bold">
                      (-{formatCurrency(dailySummary.totalReductionSum)})
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Card 3: Difference (Hero State Card) */}
            <div
              className={`rounded-3xl border p-5 shadow-sm flex flex-col justify-between transition-all duration-200 ${
                dailySummary.isBalanced
                  ? "border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/50"
                  : dailySummary.difference !== 0
                  ? "border-rose-300 bg-gradient-to-br from-rose-50 via-white to-rose-50/50"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-extrabold uppercase tracking-wider ${
                    dailySummary.isBalanced
                      ? "text-emerald-800"
                      : dailySummary.difference !== 0
                      ? "text-rose-800"
                      : "text-slate-600"
                  }`}
                >
                  Office Balance
                </span>
                {dailySummary.isBalanced ? (
                  <span className="px-3 py-1 rounded-full text-xs bg-emerald-600 text-white font-black flex items-center gap-1 shadow-xs">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    RECONCILED
                  </span>
                ) : dailySummary.difference !== 0 ? (
                  <span className="px-3 py-1 rounded-full text-xs bg-rose-100 text-rose-800 border border-rose-200 font-black">
                    DIFF
                  </span>
                ) : null}
              </div>
              <div className="mt-3">
                <div
                  className={`text-2xl sm:text-3xl font-black font-mono truncate ${
                    dailySummary.isBalanced
                      ? "text-emerald-900"
                      : dailySummary.difference !== 0
                      ? "text-rose-950"
                      : "text-slate-900"
                  }`}
                >
                  {formatCurrency(dailySummary.difference)}
                </div>
                <div
                  className={`text-xs font-bold mt-1.5 ${
                    dailySummary.isBalanced ? "text-emerald-700" : "text-slate-500"
                  }`}
                >
                  {dailySummary.isBalanced
                    ? "✓ Target matches scanned claims"
                    : dailySummary.difference > 0
                    ? `Over by ${formatCurrency(dailySummary.difference)}`
                    : `Short by ${formatCurrency(Math.abs(dailySummary.difference))}`}
                </div>
              </div>
            </div>

            {/* Card 4: Staff Balanced Status */}
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-emerald-600" />
                  Staff Progress
                </span>
                <span className="text-xs font-bold text-slate-600">
                  {staffEntries.length > 0
                    ? `${Math.round((balancedCount / staffEntries.length) * 100)}%`
                    : "0%"}
                </span>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-black font-mono text-slate-900">
                    {balancedCount}
                  </span>
                  <span className="text-sm font-semibold text-slate-500">
                    of {staffEntries.length} balanced
                  </span>
                </div>
                {/* Visual Bar */}
                <div className="w-full h-3 bg-slate-100 rounded-full mt-3 overflow-hidden flex p-0.5 border border-slate-200/60">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                    style={{
                      width: staffEntries.length > 0 ? `${(balancedCount / staffEntries.length) * 100}%` : "0%",
                    }}
                  />
                  <div
                    className="bg-rose-400 h-full rounded-full transition-all duration-300"
                    style={{
                      width:
                        staffEntries.length > 0
                          ? `${((staffEntries.length - balancedCount) / staffEntries.length) * 100}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Feedback Alerts */}
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center justify-between shadow-xs animate-in fade-in">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                <span className="font-semibold">{error}</span>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-700 font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
          )}
          {success && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex items-center gap-3 shadow-xs animate-in fade-in">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span className="font-semibold">{success}</span>
            </div>
          )}

          {/* =========================================================
              3. STAFF SELECTION STRIP & CONTROLS
              ========================================================= */}
          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-16 text-center text-sm text-slate-500 shadow-sm">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
              <span className="font-bold text-base text-slate-800 block">Loading Worksheet…</span>
              <span className="text-xs text-slate-400">Retrieving scan claims for {selectedDate}</span>
            </div>
          ) : staffEntries.length === 0 ? (
            /* Big Empty State */
            <div className="rounded-3xl border-2 border-dashed border-slate-300 bg-white p-12 sm:p-16 text-center space-y-4 shadow-sm">
              <div className="h-16 w-16 rounded-3xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto border border-blue-100">
                <Users className="w-8 h-8" />
              </div>
              <div className="max-w-md mx-auto">
                <h3 className="text-xl font-black text-slate-900">
                  No Staff Allocation for {selectedDate}
                </h3>
                <p className="text-sm text-slate-500 mt-1.5">
                  Load all active staff members with 1 click to initialize today's sheet.
                </p>
              </div>

              <div className="pt-3 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => handleLoadActiveStaffFromDirectory()}
                  className="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-2xl shadow-md flex items-center gap-2 transition"
                >
                  <UserCheck className="w-5 h-5" />
                  <span>Load Staff Allocation</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsStaffDirectoryOpen(true)}
                  className="px-6 py-3.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-sm font-bold rounded-2xl transition"
                >
                  Manage Directory
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Big Staff Navigation Carousel */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 sm:p-4 rounded-3xl border border-slate-200 shadow-sm">
                {/* Horizontal Big Tabs */}
                <div className="flex items-center gap-2.5 overflow-x-auto py-1 flex-1 min-w-0 no-scrollbar">
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
                        className={`px-5 py-3 rounded-2xl text-sm font-bold shrink-0 transition-all flex items-center gap-2.5 border-2 select-none ${
                          isSelected
                            ? "bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20"
                            : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        <span
                          className={`h-3 w-3 rounded-full transition-colors ${
                            isStaffBalanced ? "bg-emerald-400 ring-2 ring-emerald-400/40" : "bg-rose-500 ring-2 ring-rose-500/40"
                          }`}
                        />
                        <span>{staff.staffName}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Right controls: Add staff & View switch */}
                <div className="flex items-center gap-2.5 shrink-0">
                  {/* Add Staff dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowAddStaffDropdown((prev) => !prev)}
                      className="px-4 py-3 rounded-2xl border-2 border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-sm font-bold transition flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4 text-blue-600" />
                      <span>Add Staff</span>
                    </button>

                    {showAddStaffDropdown && (
                      <div className="absolute right-0 mt-2 w-64 rounded-3xl border border-slate-200 bg-white shadow-xl z-30 py-2.5 text-sm animate-in fade-in duration-100">
                        <div className="px-4 py-1.5 border-b border-slate-100 text-xs font-black text-slate-400 uppercase tracking-wider">
                          Add from Directory
                        </div>
                        {availableDirectoryStaff.length === 0 ? (
                          <div className="px-4 py-3 text-slate-400 italic">
                            All active staff added.
                          </div>
                        ) : (
                          availableDirectoryStaff.map((member) => (
                            <button
                              key={member.id}
                              type="button"
                              onClick={() => handleAddStaffFromDirectory(member)}
                              className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-slate-800 font-semibold flex items-center justify-between"
                            >
                              <span>{member.name}</span>
                              <span className="text-xs text-slate-400">
                                {member.designation || "Officer"}
                              </span>
                            </button>
                          ))
                        )}
                        <div className="border-t border-slate-100 mt-1 pt-2 px-4">
                          <button
                            type="button"
                            onClick={() => {
                              setShowAddStaffDropdown(false);
                              setIsStaffDirectoryOpen(true);
                            }}
                            className="text-xs text-blue-600 font-bold hover:underline"
                          >
                            Manage Directory…
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Worksheet vs Table View */}
                  <div className="inline-flex rounded-2xl bg-slate-100 p-1 border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setLayoutMode("tabs")}
                      className={`p-2.5 rounded-xl transition ${
                        layoutMode === "tabs"
                          ? "bg-white text-blue-700 shadow-xs font-bold"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                      title="Worksheet"
                    >
                      <LayoutGrid className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setLayoutMode("table")}
                      className={`p-2.5 rounded-xl transition ${
                        layoutMode === "table"
                          ? "bg-white text-blue-700 shadow-xs font-bold"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                      title="Overview Table"
                    >
                      <TableProperties className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* =========================================================
                  VIEW 1: FOCUSED WORKSHEET (BIG INPUTS & NO RETURN CLAIMS)
                  ========================================================= */}
              {layoutMode === "tabs" && currentActiveStaff && (
                (() => {
                  const staff = currentActiveStaff;
                  const totals = calculateStaffTotals(staff);
                  const isStaffBalanced = Math.abs(totals.diff) < 0.01;

                  const verifiedAgentIndices = staff.verifiedAgentParcels || [];
                  const verifiedAgentCount = verifiedAgentIndices.filter(
                    (i) => i >= 0 && i < (staff.agentParcels || []).length
                  ).length;

                  const verifiedReductionIndices = staff.verifiedReturnedParcels || [];
                  const verifiedReductionCount = verifiedReductionIndices.filter(
                    (i) => i >= 0 && i < (staff.returnedParcels || []).length
                  ).length;

                  const verifiedAdditionalIndices = staff.verifiedAdditionalBalance || [];
                  const verifiedAdditionalCount = verifiedAdditionalIndices.filter(
                    (i) => i >= 0 && i < (staff.additionalBalanceOnly || []).length
                  ).length;

                  return (
                    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden space-y-0">
                      {/* Sub-header: Officer Name & Quick Stepper */}
                      <div className="px-6 py-4.5 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5 flex-wrap">
                          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-blue-100 text-blue-800 text-base font-black font-mono">
                            {activeStaffIndex + 1}
                          </span>
                          <span className="text-xl sm:text-2xl font-black text-slate-900">
                            {staff.staffName}
                          </span>

                          {/* Net Wins Badge right near the name */}
                          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-2xl bg-blue-50 border-2 border-blue-200 shadow-2xs">
                            <span className="text-xs font-black uppercase tracking-wide text-blue-700">
                              Net Wins:
                            </span>
                            <span className="text-base sm:text-lg font-black font-mono text-blue-950">
                              {formatCurrency(totals.winsForBalance)}
                            </span>
                          </div>

                          {/* Big Status Badge */}
                          <span
                            className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-black border flex items-center gap-2 ${
                              isStaffBalanced
                                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                : "bg-rose-100 text-rose-800 border-rose-300"
                            }`}
                          >
                            {isStaffBalanced ? (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 stroke-[3]" />
                                <span>BALANCED (0.00)</span>
                              </>
                            ) : (
                              <>
                                <AlertCircle className="w-4 h-4 text-rose-600 stroke-[3]" />
                                <span>DIFF: {formatCurrency(totals.diff)}</span>
                              </>
                            )}
                          </span>
                        </div>

                        {/* Navigation Stepper & Delete */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={activeStaffIndex === 0}
                            onClick={() => setActiveStaffIndex((prev) => Math.max(0, prev - 1))}
                            className="p-2.5 rounded-xl border-2 border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-20 text-slate-700 shadow-2xs"
                            title="Previous staff"
                          >
                            <ChevronLeft className="w-5 h-5" />
                          </button>
                          <span className="text-sm font-bold text-slate-600 px-3 font-mono">
                            {activeStaffIndex + 1} of {staffEntries.length}
                          </span>
                          <button
                            type="button"
                            disabled={activeStaffIndex === staffEntries.length - 1}
                            onClick={() =>
                              setActiveStaffIndex((prev) => Math.min(staffEntries.length - 1, prev + 1))
                            }
                            className="p-2.5 rounded-xl border-2 border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-20 text-slate-700 shadow-2xs"
                            title="Next staff"
                          >
                            <ChevronRight className="w-5 h-5" />
                          </button>

                          {mode === "admin" && (
                            <button
                              type="button"
                              onClick={() => removeStaffMember(staff.id)}
                              className="ml-3 p-2.5 rounded-xl text-slate-400 hover:text-red-700 hover:bg-red-50 transition"
                              title="Remove staff member"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="p-6 sm:p-7 space-y-7">
                        {/* ========================================================
                            4-CARD LEDGER FLOW (TALL, WEIGHTY INPUTS)
                            Prev Bal  −  Mail to Board  =  Actual Closing  ➔  Difference
                            ======================================================== */}
                        <div className="rounded-3xl border-2 border-slate-200/90 bg-white p-6 shadow-xs space-y-3">
                          <div className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                            <span>Balance Ledger Inputs</span>
                            <span className="text-slate-400 font-medium lowercase">
                              prev balance + net wins − mail to board = actual closing
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
                            {/* 1. Previous Balance (Input) */}
                            <div className="bg-slate-50 rounded-2xl p-4 border-2 border-slate-200 flex flex-col justify-between min-h-[120px]">
                              <span className="text-xs font-black uppercase tracking-wide text-slate-600 block truncate">
                                Previous Balance
                              </span>
                              <div className="flex items-center gap-1.5 mt-2">
                                <span className="text-sm font-bold text-slate-400">Rs.</span>
                                <input
                                  type="number"
                                  disabled={mode === "staff"}
                                  value={staff.previousBalance || ""}
                                  onChange={(e) =>
                                    updateStaffNumberField(staff.id, "previousBalance", e.target.value)
                                  }
                                  placeholder="0.00"
                                  className="w-full h-14 text-xl sm:text-2xl font-black font-mono bg-white border-2 border-slate-300 rounded-2xl px-4 text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500 shadow-xs"
                                />
                              </div>
                            </div>

                            {/* 2. Mail to Board (Input) */}
                            <div className="bg-slate-50 rounded-2xl p-4 border-2 border-slate-200 flex flex-col justify-between min-h-[120px]">
                              <span className="text-xs font-black uppercase tracking-wide text-slate-600 block truncate">
                                − Mail to Board
                              </span>
                              <div className="flex items-center gap-1.5 mt-2">
                                <span className="text-sm font-bold text-slate-400">Rs.</span>
                                <input
                                  type="number"
                                  value={staff.mailAmount || ""}
                                  onChange={(e) =>
                                    updateStaffNumberField(staff.id, "mailAmount", e.target.value)
                                  }
                                  placeholder="0.00"
                                  className="w-full h-14 text-xl sm:text-2xl font-black font-mono bg-white border-2 border-slate-300 rounded-2xl px-4 text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100 shadow-xs"
                                />
                              </div>
                            </div>

                            {/* 3. Actual Closing (Input) */}
                            <div className="bg-amber-50/80 rounded-2xl p-4 border-2 border-amber-200 flex flex-col justify-between min-h-[120px]">
                              <span className="text-xs font-black uppercase tracking-wide text-amber-900 block truncate">
                                Actual Closing
                              </span>
                              <div className="flex items-center gap-1.5 mt-2">
                                <span className="text-sm font-bold text-amber-700">Rs.</span>
                                <input
                                  type="number"
                                  value={staff.actualClosingBalance || ""}
                                  onChange={(e) =>
                                    updateStaffNumberField(staff.id, "actualClosingBalance", e.target.value)
                                  }
                                  placeholder="0.00"
                                  className="w-full h-14 text-xl sm:text-2xl font-black font-mono bg-white border-2 border-amber-300 rounded-2xl px-4 text-amber-950 focus:outline-none focus:border-amber-600 focus:ring-4 focus:ring-amber-100 shadow-xs"
                                />
                              </div>
                            </div>

                            {/* 4. Difference / Reconciled Status */}
                            <div
                              className={`rounded-2xl p-4 border-2 flex flex-col justify-between min-h-[120px] ${
                                isStaffBalanced
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                                  : "bg-rose-50 border-rose-300 text-rose-900"
                              }`}
                            >
                              <span className="text-xs font-black uppercase tracking-wide block truncate">
                                {isStaffBalanced ? "Status: Reconciled" : "Difference"}
                              </span>
                              <div className="h-14 flex items-center justify-between px-4 bg-white/95 rounded-2xl border-2 border-inherit mt-2 shadow-xs">
                                <span className="text-xl sm:text-2xl font-black font-mono truncate">
                                  {formatCurrency(totals.diff)}
                                </span>
                                {isStaffBalanced && (
                                  <Check className="w-6 h-6 text-emerald-600 stroke-[3] shrink-0" />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* ========================================================
                            3 SPACIOUS PARCEL WORKSPACES (NO TOMORROW WINS)
                            Column 1: Assigned Parcels
                            Column 2: Reductions / Returns
                            Column 3: Extra Balance
                            ======================================================== */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                          {/* Column 1: Assigned Agent Parcels */}
                          <div className="rounded-3xl border-2 border-blue-100 bg-gradient-to-b from-blue-50/40 via-white to-white p-5 space-y-4 flex flex-col justify-between shadow-xs">
                            <div className="space-y-4">
                              {/* Header */}
                              <div className="flex items-center justify-between pb-1 border-b border-blue-100/60">
                                <div className="flex items-center gap-2.5">
                                  <span className="h-3.5 w-3.5 rounded-full bg-blue-600" />
                                  <span className="text-base font-black text-slate-900">
                                    Assigned Parcels
                                  </span>
                                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800">
                                    {totals.agentCount}
                                  </span>
                                </div>
                                <span className="font-mono font-black text-blue-700 text-base">
                                  {formatCurrency(totals.agentSum)}
                                </span>
                              </div>

                              {/* Verified count bar */}
                              {totals.agentCount > 0 && (
                                <div className="flex items-center justify-between text-xs text-slate-600 font-semibold bg-white p-2.5 rounded-2xl border border-slate-200">
                                  <span className="flex items-center gap-2 text-emerald-700 font-bold">
                                    <Check className="w-4 h-4 text-emerald-600 stroke-[3]" />
                                    {verifiedAgentCount} / {totals.agentCount} verified
                                  </span>
                                  {verifiedAgentCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => clearParcelMarks(staff.id, "agent")}
                                      className="text-slate-400 hover:text-slate-700 underline text-xs font-bold"
                                    >
                                      Reset
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Input (Admin Only) with generous height */}
                              {mode === "admin" && (
                                <div className="flex items-center gap-2">
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
                                    className="w-full h-14 px-4 text-base sm:text-lg font-bold font-mono border-2 border-slate-300 rounded-2xl bg-white focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100 shadow-xs text-slate-900"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => addValueFromDraft(staff.id, "agent")}
                                    className="h-14 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-2xl font-black transition shadow-sm flex items-center justify-center shrink-0 active:scale-95"
                                  >
                                    +
                                  </button>
                                </div>
                              )}

                              {/* Big Interactive Chips Board */}
                              <div className="flex flex-wrap gap-2.5 min-h-[64px] max-h-72 overflow-y-auto p-3 rounded-2xl bg-slate-50 border border-slate-200">
                                {(staff.agentParcels || []).length === 0 ? (
                                  <div className="w-full text-center py-5 text-sm text-slate-400 italic">
                                    No parcels assigned
                                  </div>
                                ) : (
                                  staff.agentParcels.map((p, idx) => {
                                    const isMarked = (staff.verifiedAgentParcels || []).includes(idx);
                                    return (
                                      <span
                                        key={idx}
                                        onClick={() => toggleParcelMark(staff.id, "agent", idx)}
                                        className={`px-4 py-2 rounded-xl text-sm sm:text-base font-mono flex items-center gap-2 border-2 transition-all cursor-pointer select-none active:scale-95 ${
                                          isMarked
                                            ? "bg-emerald-500 text-white font-black border-emerald-600 shadow-sm ring-2 ring-emerald-300/50"
                                            : "bg-white font-bold text-slate-800 border-slate-200 hover:border-slate-300 shadow-2xs"
                                        }`}
                                      >
                                        {isMarked && <span className="text-sm font-black">✓</span>}
                                        <span>{formatCurrency(p)}</span>
                                        {mode === "admin" && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              removeValue(staff.id, "agent", idx);
                                            }}
                                            className="font-bold ml-1 text-base text-slate-400 hover:text-red-500 leading-none"
                                          >
                                            ×
                                          </button>
                                        )}
                                      </span>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Column 2: Reductions / Returns */}
                          <div className="rounded-3xl border-2 border-rose-100 bg-gradient-to-b from-rose-50/40 via-white to-white p-5 space-y-4 flex flex-col justify-between shadow-xs">
                            <div className="space-y-4">
                              {/* Header */}
                              <div className="flex items-center justify-between pb-1 border-b border-rose-100/60">
                                <div className="flex items-center gap-2.5">
                                  <span className="h-3.5 w-3.5 rounded-full bg-rose-500" />
                                  <span className="text-base font-black text-slate-900">
                                    Returns (Reductions)
                                  </span>
                                  {totals.reductionCount > 0 && (
                                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800">
                                      {totals.reductionCount}
                                    </span>
                                  )}
                                </div>
                                <span className="font-mono font-black text-rose-700 text-base">
                                  {totals.reductionSum > 0 ? `-${formatCurrency(totals.reductionSum)}` : "Rs. 0.00"}
                                </span>
                              </div>

                              {/* Return info bar */}
                              {totals.reductionCount > 0 && (
                                <div className="flex items-center justify-between text-xs text-slate-600 font-semibold bg-white p-2.5 rounded-2xl border border-slate-200">
                                  <span className="text-rose-700 font-bold">
                                    Deducted from parcel target
                                  </span>
                                  {verifiedReductionCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => clearParcelMarks(staff.id, "reduction")}
                                      className="text-slate-400 hover:text-slate-700 underline text-xs font-bold"
                                    >
                                      Reset
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Input with generous height */}
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  value={staff.reductionDraft ?? ""}
                                  onChange={(e) => updateDraft(staff.id, "reduction", e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      addValueFromDraft(staff.id, "reduction");
                                    }
                                  }}
                                  placeholder="Return amount (Press Enter)"
                                  className="w-full h-14 px-4 text-base sm:text-lg font-bold font-mono border-2 border-slate-300 rounded-2xl bg-white focus:outline-none focus:border-rose-600 focus:ring-4 focus:ring-rose-100 shadow-xs text-slate-900"
                                />
                                <button
                                  type="button"
                                  onClick={() => addValueFromDraft(staff.id, "reduction")}
                                  className="h-14 px-6 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl text-2xl font-black transition shadow-sm flex items-center justify-center shrink-0 active:scale-95"
                                >
                                  +
                                </button>
                              </div>

                              {/* Big Chips Board */}
                              <div className="flex flex-wrap gap-2.5 min-h-[64px] max-h-72 overflow-y-auto p-3 rounded-2xl bg-slate-50 border border-slate-200">
                                {(staff.returnedParcels || []).length === 0 ? (
                                  <div className="w-full text-center py-5 text-sm text-slate-400 italic">
                                    No returns
                                  </div>
                                ) : (
                                  staff.returnedParcels?.map((p, idx) => {
                                    const isMarked = (staff.verifiedReturnedParcels || []).includes(idx);
                                    return (
                                      <span
                                        key={idx}
                                        onClick={() => toggleParcelMark(staff.id, "reduction", idx)}
                                        className={`px-4 py-2 rounded-xl text-sm sm:text-base font-mono flex items-center gap-2 border-2 transition-all cursor-pointer select-none active:scale-95 ${
                                          isMarked
                                            ? "bg-emerald-500 text-white font-black border-emerald-600 shadow-sm ring-2 ring-emerald-300/50"
                                            : "bg-rose-50 font-bold text-rose-950 border-rose-200 hover:border-rose-300 shadow-2xs"
                                        }`}
                                      >
                                        {isMarked && <span className="text-sm font-black">✓</span>}
                                        <span>{formatCurrency(p)}</span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeValue(staff.id, "reduction", idx);
                                          }}
                                          className="font-bold ml-1 text-base text-rose-400 hover:text-rose-700 leading-none"
                                        >
                                          ×
                                        </button>
                                      </span>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Column 3: Extra Balance */}
                          <div className="rounded-3xl border-2 border-teal-100 bg-gradient-to-b from-teal-50/40 via-white to-white p-5 space-y-4 flex flex-col justify-between shadow-xs">
                            <div className="space-y-4">
                              {/* Header */}
                              <div className="flex items-center justify-between pb-1 border-b border-teal-100/60">
                                <div className="flex items-center gap-2.5">
                                  <span className="h-3.5 w-3.5 rounded-full bg-teal-600" />
                                  <span className="text-base font-black text-slate-900">
                                    Extra Balance
                                  </span>
                                </div>
                                <span className="font-mono font-black text-teal-700 text-base">
                                  {formatCurrency(totals.extraSum)}
                                </span>
                              </div>

                              {/* Info note */}
                              <div className="text-xs text-slate-500 font-medium bg-white p-2.5 rounded-2xl border border-slate-200">
                                Additional sums applied to this balance
                              </div>

                              {/* Input with generous height */}
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  value={staff.additionalBalanceDraft ?? ""}
                                  onChange={(e) => updateDraft(staff.id, "additionalBalance", e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      addValueFromDraft(staff.id, "additionalBalance");
                                    }
                                  }}
                                  placeholder="Extra amount (Press Enter)"
                                  className="w-full h-14 px-4 text-base sm:text-lg font-bold font-mono border-2 border-slate-300 rounded-2xl bg-white focus:outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-100 shadow-xs text-slate-900"
                                />
                                <button
                                  type="button"
                                  onClick={() => addValueFromDraft(staff.id, "additionalBalance")}
                                  className="h-14 px-6 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl text-2xl font-black transition shadow-sm flex items-center justify-center shrink-0 active:scale-95"
                                >
                                  +
                                </button>
                              </div>

                              {/* Big Chips Board */}
                              <div className="flex flex-wrap gap-2.5 min-h-[64px] max-h-72 overflow-y-auto p-3 rounded-2xl bg-slate-50 border border-slate-200">
                                {(staff.additionalBalanceOnly || []).length === 0 ? (
                                  <div className="w-full text-center py-5 text-sm text-slate-400 italic">
                                    No extra amounts
                                  </div>
                                ) : (
                                  staff.additionalBalanceOnly.map((p, idx) => {
                                    const isMarked = (staff.verifiedAdditionalBalance || []).includes(idx);
                                    return (
                                      <span
                                        key={idx}
                                        onClick={() => toggleParcelMark(staff.id, "additionalBalance", idx)}
                                        className={`px-4 py-2 rounded-xl text-sm sm:text-base font-mono flex items-center gap-2 border-2 transition-all cursor-pointer select-none active:scale-95 ${
                                          isMarked
                                            ? "bg-emerald-500 text-white font-black border-emerald-600 shadow-sm ring-2 ring-emerald-300/50"
                                            : "bg-teal-50 font-bold text-teal-950 border-teal-200 hover:border-teal-300 shadow-2xs"
                                        }`}
                                      >
                                        {isMarked && <span className="text-sm font-black">✓</span>}
                                        <span>{formatCurrency(p)}</span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeValue(staff.id, "additionalBalance", idx);
                                          }}
                                          className="font-bold ml-1 text-base text-teal-400 hover:text-teal-700 leading-none"
                                        >
                                          ×
                                        </button>
                                      </span>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()
              )}

              {/* =========================================================
                  VIEW 2: FULL LIGHT OVERVIEW TABLE (ALL STAFF)
                  ========================================================= */}
              {layoutMode === "table" && (
                <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse font-sans">
                      <thead>
                        <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-extrabold uppercase text-xs tracking-wider">
                          <th className="px-5 py-4">#</th>
                          <th className="px-5 py-4">Staff</th>
                          <th className="px-5 py-4 text-right">Prev Bal</th>
                          <th className="px-5 py-4 text-right">Mail to Board</th>
                          <th className="px-5 py-4 text-right">Actual Closing</th>
                          <th className="px-5 py-4 text-right">Assigned Parcels</th>
                          <th className="px-5 py-4 text-right">Returned Parcels</th>
                          <th className="px-5 py-4 text-right">Net Parcels</th>
                          <th className="px-5 py-4 text-right">Scanned</th>
                          <th className="px-5 py-4 text-right">Diff</th>
                          <th className="px-5 py-4 text-center">Status</th>
                          <th className="px-5 py-4 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {staffEntries.map((staff, idx) => {
                          const totals = calculateStaffTotals(staff);
                          const isStaffBalanced = Math.abs(totals.diff) < 0.01;

                          return (
                            <tr key={staff.id} className="hover:bg-slate-50/80 transition">
                              <td className="px-5 py-3.5 text-slate-400 font-sans">{idx + 1}</td>
                              <td className="px-5 py-3.5 font-bold font-sans text-slate-900 text-sm">
                                {staff.staffName}
                              </td>
                              <td className="px-5 py-3.5 text-right text-slate-600">
                                {formatCurrency(staff.previousBalance)}
                              </td>
                              <td className="px-5 py-3.5 text-right text-slate-600">
                                {formatCurrency(staff.mailAmount)}
                              </td>
                              <td className="px-5 py-3.5 text-right font-black text-slate-900">
                                {formatCurrency(staff.actualClosingBalance)}
                              </td>
                              <td className="px-5 py-3.5 text-right text-blue-700 font-bold">
                                {formatCurrency(totals.agentSum)}
                              </td>
                              <td className="px-5 py-3.5 text-right text-rose-600 font-bold">
                                {totals.reductionSum > 0 ? `-${formatCurrency(totals.reductionSum)}` : "-"}
                              </td>
                              <td className="px-5 py-3.5 text-right font-black text-slate-900">
                                {formatCurrency(totals.netAgentSum)}
                              </td>
                              <td className="px-5 py-3.5 text-right font-black text-emerald-800">
                                {formatCurrency(totals.assignedScanned)}
                              </td>
                              <td
                                className={`px-5 py-3.5 text-right font-black ${
                                  isStaffBalanced ? "text-emerald-700" : "text-rose-700"
                                }`}
                              >
                                {formatCurrency(totals.diff)}
                              </td>
                              <td className="px-5 py-3.5 text-center font-sans">
                                <span
                                  className={`px-3.5 py-1.5 rounded-full text-xs font-black ${
                                    isStaffBalanced
                                      ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                      : "bg-rose-100 text-rose-800 border border-rose-200"
                                  }`}
                                >
                                  {isStaffBalanced ? "BALANCED" : "DIFF"}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-center font-sans">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveStaffIndex(idx);
                                    setLayoutMode("tabs");
                                  }}
                                  className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl font-bold text-xs transition shadow-2xs"
                                >
                                  Worksheet
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

        {/* Master Staff Directory Modal */}
        <StaffDirectoryModal
          isOpen={isStaffDirectoryOpen}
          onClose={() => setIsStaffDirectoryOpen(false)}
          onDirectoryChanged={loadDirectoryData}
          onApplyActiveToToday={(activeStaff) => handleLoadActiveStaffFromDirectory(activeStaff)}
        />

        {/* Admin PIN Prompt Modal */}
        {showPasswordPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-100">
            <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5 text-slate-900 font-bold text-base">
                  <Lock className="w-5 h-5 text-blue-600" />
                  <span>Admin Clearance Required</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordPrompt(false);
                    setPasswordInput("");
                    setPasswordError(null);
                  }}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {passwordError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 font-medium">
                  {passwordError}
                </div>
              )}

              <div className="space-y-4">
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmAdminPassword();
                  }}
                  autoFocus
                  placeholder="Enter PIN (Default: 8899)"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-center tracking-widest shadow-2xs"
                />

                <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordPrompt(false);
                      setPasswordInput("");
                      setPasswordError(null);
                    }}
                    className="px-4 py-2 rounded-2xl border border-slate-200 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isVerifyingPass}
                    onClick={handleConfirmAdminPassword}
                    className="px-5 py-2 rounded-2xl bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm font-bold text-white shadow-xs disabled:opacity-50"
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

// app/components/BigPrizeTicketsSection.tsx
"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Trophy,
  Plus,
  Check,
  CheckCircle2,
  Clock,
  Search,
  Trash2,
  Edit2,
  Download,
  AlertTriangle,
  RefreshCw,
  CheckCheck,
  Users,
  Archive,
  X,
} from "lucide-react";
import {
  BigPrizeWinningTicket,
  BigPrizeSummary,
  ScanningStaffBalance,
  LOTTERY_OPTIONS,
  getDailyBigPrizeTickets,
  addBigPrizeWinningTicket,
  updateBigPrizeTicketScanStatus,
  updateBigPrizeWinningTicket,
  deleteBigPrizeWinningTicket,
  markAllBigPrizeTicketsScanned,
  calculateBigPrizeSummary,
  calculateStaffBalanceVerification,
  saveScanningStaffBalances,
  exportBigPrizeTicketsToExcel,
} from "../lib/bigPrizeTicketsService";
import { getStaffDirectory } from "../lib/scanBalancingService";
import { formatCurrency, formatDisplayDate } from "../lib/balanceOrganizerService";

interface BigPrizeTicketsSectionProps {
  selectedDate: string;
  userEmail: string;
  onSummaryChange?: (summary: BigPrizeSummary) => void;
}

type FilterTab = "all" | "pending" | "scanned" | "deleted";

export default function BigPrizeTicketsSection({
  selectedDate,
  userEmail,
  onSummaryChange,
}: BigPrizeTicketsSectionProps) {
  // Main data state
  const [tickets, setTickets] = useState<BigPrizeWinningTicket[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Scanning Staff Balances state
  const [staffBalances, setStaffBalances] = useState<ScanningStaffBalance[]>([]);
  const [availableStaffMembers, setAvailableStaffMembers] = useState<string[]>([]);
  const [isSavingStaff, setIsSavingStaff] = useState<boolean>(false);

  // Form input state (clean & minimal: lottery game + amount + agent/note)
  const [lotteryName, setLotteryName] = useState<string>("");
  const [claimAmount, setClaimAmount] = useState<string>("");
  const [agentOrCustomer, setAgentOrCustomer] = useState<string>("");
  const [isScannedInput, setIsScannedInput] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Filters & Search
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Loading states
  const [updatingTicketId, setUpdatingTicketId] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState<boolean>(false);

  // Edit State
  const [editingTicket, setEditingTicket] = useState<BigPrizeWinningTicket | null>(null);
  const [editLotteryName, setEditLotteryName] = useState<string>("");
  const [editAmount, setEditAmount] = useState<string>("");
  const [editAgent, setEditAgent] = useState<string>("");
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);

  // Delete State
  const [deletingTicket, setDeletingTicket] = useState<BigPrizeWinningTicket | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Deleted Archive Modal State
  const [showDeletedModal, setShowDeletedModal] = useState<boolean>(false);
  const [deletedSearchQuery, setDeletedSearchQuery] = useState<string>("");

  // Refs for keyboard navigation between fields
  const lotteryInputRef = useRef<HTMLInputElement>(null);
  const claimAmountInputRef = useRef<HTMLInputElement>(null);
  const agentNoteInputRef = useRef<HTMLInputElement>(null);

  // Load staff directory for autocomplete suggestions
  useEffect(() => {
    async function loadStaffDir() {
      try {
        const dir = await getStaffDirectory();
        if (dir && dir.length > 0) {
          setAvailableStaffMembers(dir.filter((d) => d.isActive).map((d) => d.name));
        }
      } catch (err) {
        console.error("Failed to load staff directory:", err);
      }
    }
    loadStaffDir();
  }, []);

  // Load tickets and staff balances on date change
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      if (!selectedDate) return;
      setIsLoading(true);
      setActionError(null);
      try {
        const result = await getDailyBigPrizeTickets(selectedDate);
        if (isMounted) {
          setTickets(result.tickets);
          if (result.staffBalances && result.staffBalances.length > 0) {
            setStaffBalances(result.staffBalances);
          } else {
            setStaffBalances([]);
          }
          if (onSummaryChange) {
            onSummaryChange(result.summary);
          }
        }
      } catch (err) {
        console.error("Failed to load big prize tickets:", err);
        if (isMounted) {
          setActionError("Failed to load tickets from database.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, [selectedDate, onSummaryChange]);

  // Active vs Deleted ticket partitions
  const activeTickets = useMemo(() => tickets.filter((t) => !t.isDeleted), [tickets]);
  const deletedTickets = useMemo(() => tickets.filter((t) => t.isDeleted), [tickets]);

  // Total deleted amount for audit
  const deletedTotalAmount = useMemo(() => {
    return deletedTickets.reduce((sum, t) => sum + (Number(t.claimAmount) || 0), 0);
  }, [deletedTickets]);

  // Filtered deleted tickets for the popup modal
  const filteredDeletedTickets = useMemo(() => {
    if (!deletedSearchQuery.trim()) return deletedTickets;
    const q = deletedSearchQuery.toLowerCase().trim();
    return deletedTickets.filter(
      (t) =>
        t.lotteryName.toLowerCase().includes(q) ||
        (t.agentOrCustomer && t.agentOrCustomer.toLowerCase().includes(q))
    );
  }, [deletedTickets, deletedSearchQuery]);

  // Summary metrics (calculated on active tickets only)
  const summary: BigPrizeSummary = useMemo(() => {
    return calculateBigPrizeSummary(tickets);
  }, [tickets]);

  // Staff terminal verification calculations
  const staffVerification = useMemo(() => {
    return calculateStaffBalanceVerification(staffBalances, summary.totalClaimAmount);
  }, [staffBalances, summary.totalClaimAmount]);

  // Auto clear notification
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Submit new ticket (safe from undefined fields)
  async function handleAddTicket(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setActionError(null);

    const cleanAmtNum = parseFloat(claimAmount.replace(/,/g, "").trim());
    if (isNaN(cleanAmtNum) || cleanAmtNum <= 0) {
      setActionError("Please enter a valid cash amount greater than 0.");
      return;
    }

    const cleanLottery = lotteryName.trim() || "Lottery";
    const cleanAgent = agentOrCustomer.trim();

    setIsSubmitting(true);
    try {
      const newTicket = await addBigPrizeWinningTicket({
        balanceDate: selectedDate,
        lotteryName: cleanLottery,
        claimAmount: cleanAmtNum,
        agentOrCustomer: cleanAgent,
        isScanned: isScannedInput,
        scannedAt: isScannedInput ? new Date().toISOString() : null,
        scannedBy: isScannedInput ? userEmail : null,
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        createdBy: userEmail || "Authorized Officer",
      });

      setTickets((prev) => [newTicket, ...prev]);
      setSuccessMessage(`Added Rs. ${cleanAmtNum.toLocaleString()} for ${cleanLottery}.`);

      // Reset fields
      setClaimAmount("");
      setAgentOrCustomer("");
      setIsScannedInput(false);

      lotteryInputRef.current?.focus();
    } catch (err) {
      console.error("Error adding ticket:", err);
      setActionError(err instanceof Error ? err.message : "Failed to record ticket.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Toggle scanned status
  async function handleToggleScanned(ticket: BigPrizeWinningTicket) {
    setActionError(null);
    const newStatus = !ticket.isScanned;
    const ticketId = ticket.id;

    setUpdatingTicketId(ticketId);

    // Optimistic UI update
    setTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId
          ? {
              ...t,
              isScanned: newStatus,
              scannedAt: newStatus ? new Date().toISOString() : null,
              scannedBy: newStatus ? userEmail : null,
            }
          : t
      )
    );

    try {
      await updateBigPrizeTicketScanStatus(selectedDate, ticketId, newStatus, userEmail);
    } catch (err) {
      console.error("Error updating scan status:", err);
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? ticket : t)));
      setActionError("Failed to update status in database.");
    } finally {
      setUpdatingTicketId(null);
    }
  }

  // Bulk mark all scanned
  async function handleMarkAllScanned() {
    const pendingIds = activeTickets.filter((t) => !t.isScanned).map((t) => t.id);
    if (pendingIds.length === 0) return;

    setIsMarkingAll(true);
    setActionError(null);

    const nowIso = new Date().toISOString();
    setTickets((prev) =>
      prev.map((t) =>
        !t.isDeleted && !t.isScanned
          ? {
              ...t,
              isScanned: true,
              scannedAt: nowIso,
              scannedBy: userEmail,
            }
          : t
      )
    );

    try {
      await markAllBigPrizeTicketsScanned(selectedDate, pendingIds, userEmail);
      setSuccessMessage(`Marked all ${pendingIds.length} tickets as scanned.`);
    } catch (err) {
      console.error("Error marking all scanned:", err);
      setActionError("Failed to update tickets.");
      const res = await getDailyBigPrizeTickets(selectedDate);
      setTickets(res.tickets);
    } finally {
      setIsMarkingAll(false);
    }
  }

  // Edit ticket
  async function handleSaveEdit() {
    if (!editingTicket) return;
    const cleanAmt = parseFloat(editAmount.replace(/,/g, "").trim());
    if (isNaN(cleanAmt) || cleanAmt <= 0) {
      alert("Please enter a valid amount.");
      return;
    }

    const cleanLottery = editLotteryName.trim() || "Lottery";
    const cleanAgent = editAgent.trim();

    setIsSavingEdit(true);
    try {
      await updateBigPrizeWinningTicket(selectedDate, editingTicket.id, {
        lotteryName: cleanLottery,
        claimAmount: cleanAmt,
        agentOrCustomer: cleanAgent,
      });

      setTickets((prev) =>
        prev.map((t) =>
          t.id === editingTicket.id
            ? {
                ...t,
                lotteryName: cleanLottery,
                claimAmount: cleanAmt,
                agentOrCustomer: cleanAgent,
              }
            : t
        )
      );

      setEditingTicket(null);
    } catch (err) {
      console.error("Error updating ticket:", err);
      alert("Failed to update ticket.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  // Soft delete ticket (records deleted time and user)
  async function handleDeleteTicket() {
    if (!deletingTicket) return;
    setIsDeleting(true);
    try {
      const { deletedAt, deletedBy } = await deleteBigPrizeWinningTicket(
        selectedDate,
        deletingTicket.id,
        userEmail
      );

      setTickets((prev) =>
        prev.map((t) =>
          t.id === deletingTicket.id
            ? {
                ...t,
                isDeleted: true,
                deletedAt,
                deletedBy,
              }
            : t
        )
      );

      setDeletingTicket(null);
      setSuccessMessage(
        `Ticket for ${deletingTicket.lotteryName} (${formatCurrency(
          deletingTicket.claimAmount
        )}) deleted. You can view it under the Deleted tab.`
      );
    } catch (err) {
      console.error("Error deleting ticket:", err);
      alert("Failed to delete ticket.");
    } finally {
      setIsDeleting(false);
    }
  }

  // Staff Balance handlers
  function handleAddStaffRow() {
    const defaultName = availableStaffMembers.length > 0 ? availableStaffMembers[0] : "";
    const newRow: ScanningStaffBalance = {
      id: `staff_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      staffName: defaultName,
      openingBalance: 0,
      closingBalance: 0,
    };
    setStaffBalances((prev) => [...prev, newRow]);
  }

  function handleUpdateStaffField(
    id: string,
    field: "staffName" | "openingBalance" | "closingBalance",
    val: string | number
  ) {
    setStaffBalances((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (field === "staffName") {
          return { ...s, staffName: String(val) };
        } else {
          const num = parseFloat(String(val).replace(/,/g, "")) || 0;
          return { ...s, [field]: num };
        }
      })
    );
  }

  function handleRemoveStaffRow(id: string) {
    setStaffBalances((prev) => prev.filter((s) => s.id !== id));
  }

  async function handleSaveStaffBalances() {
    setIsSavingStaff(true);
    setActionError(null);
    try {
      await saveScanningStaffBalances(selectedDate, staffBalances, userEmail);
      setSuccessMessage("Scanning staff balances saved.");
    } catch (err) {
      console.error("Error saving staff balances:", err);
      setActionError("Failed to save scanning staff balances.");
    } finally {
      setIsSavingStaff(false);
    }
  }

  // Filtered tickets based on active tab
  const filteredTickets = useMemo(() => {
    let result: BigPrizeWinningTicket[] = [];

    if (filterTab === "deleted") {
      result = [...deletedTickets];
    } else if (filterTab === "pending") {
      result = activeTickets.filter((t) => !t.isScanned);
    } else if (filterTab === "scanned") {
      result = activeTickets.filter((t) => t.isScanned);
    } else {
      result = [...activeTickets];
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (t) =>
          t.lotteryName.toLowerCase().includes(q) ||
          (t.agentOrCustomer && t.agentOrCustomer.toLowerCase().includes(q))
      );
    }

    return result;
  }, [activeTickets, deletedTickets, filterTab, searchQuery]);

  return (
    <section className="rounded-xl border border-slate-300 bg-white shadow-xs overflow-hidden">
      {/* ===== PROFESSIONAL MINIMAL HEADER ===== */}
      <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3.5 sm:px-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="p-2 rounded-lg bg-slate-200 text-slate-800">
            <Trophy className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              Big Prize Winning Tickets
            </h2>
            <span className="text-xs sm:text-sm text-slate-500 font-medium">
              Daily verification • {selectedDate}
            </span>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2.5">
          {summary.pendingCount > 0 ? (
            <span className="px-3 py-1 rounded-md text-xs sm:text-sm font-bold bg-amber-100 text-amber-900 border border-amber-300">
              {summary.pendingCount} Pending
            </span>
          ) : summary.totalCount > 0 ? (
            <span className="px-3 py-1 rounded-md text-xs sm:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              All Scanned
            </span>
          ) : null}

          {/* Deleted Archive Popup Button */}
          <button
            type="button"
            onClick={() => setShowDeletedModal(true)}
            className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-medium flex items-center gap-1.5 transition"
            title="Open Deleted Tickets Archive"
          >
            <Archive className="w-4 h-4 text-slate-500" />
            <span>Deleted Archive</span>
            {deletedTickets.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                {deletedTickets.length}
              </span>
            )}
          </button>

          {tickets.length > 0 && (
            <button
              type="button"
              onClick={() => exportBigPrizeTicketsToExcel(tickets, selectedDate, staffBalances)}
              className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-medium flex items-center gap-1.5 transition"
              title="Download Excel"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>Export</span>
            </button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-5">
        {/* Alerts */}
        {actionError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs sm:text-sm text-red-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-red-500 font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {successMessage && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs sm:text-sm text-emerald-900 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessMessage(null)}
              className="text-emerald-600 font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* ===== 3 SIMPLE CLEAN KPI STATS (NO GRADIENTS) ===== */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {/* Total Claimed */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <div className="text-xs sm:text-sm font-bold text-slate-600 uppercase tracking-wide">
              Total Claimed
            </div>
            <div className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 mt-1">
              {formatCurrency(summary.totalClaimAmount)}
            </div>
            <div className="text-xs sm:text-sm text-slate-500 mt-1">
              {summary.totalCount} ticket{summary.totalCount === 1 ? "" : "s"}
            </div>
          </div>

          {/* Scanned */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <div className="text-xs sm:text-sm font-bold text-emerald-700 uppercase tracking-wide">
              Scanned
            </div>
            <div className="text-2xl sm:text-3xl font-bold font-mono text-emerald-900 mt-1">
              {formatCurrency(summary.scannedAmount)}
            </div>
            <div className="text-xs sm:text-sm text-emerald-700 mt-1">
              {summary.scannedCount} scanned
            </div>
          </div>

          {/* Pending */}
          <div
            className={`rounded-lg border p-4 ${
              summary.pendingCount > 0
                ? "border-amber-300 bg-amber-50/40"
                : "border-slate-200 bg-slate-50/50"
            }`}
          >
            <div
              className={`text-xs sm:text-sm font-bold uppercase tracking-wide ${
                summary.pendingCount > 0 ? "text-amber-800" : "text-slate-600"
              }`}
            >
              Pending Scan
            </div>
            <div
              className={`text-2xl sm:text-3xl font-bold font-mono mt-1 ${
                summary.pendingCount > 0 ? "text-amber-950" : "text-slate-700"
              }`}
            >
              {formatCurrency(summary.pendingAmount)}
            </div>
            <div
              className={`text-xs sm:text-sm mt-1 ${
                summary.pendingCount > 0 ? "text-amber-800 font-medium" : "text-slate-500"
              }`}
            >
              {summary.pendingCount} pending
            </div>
          </div>
        </div>

        {/* ===== TYPEABLE TICKET ENTRY BOX ===== */}
        <form
          onSubmit={handleAddTicket}
          className="rounded-lg border border-slate-200 bg-slate-50/40 p-4 space-y-3"
        >
          <div className="text-sm sm:text-base font-bold text-slate-800">Add Winning Ticket</div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
            {/* 1. Lottery Game (Typeable with autocomplete list) */}
            <div>
              <label
                htmlFor="lotteryTypeableInput"
                className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1"
              >
                Lottery Game
              </label>
              <input
                id="lotteryTypeableInput"
                ref={lotteryInputRef}
                type="text"
                value={lotteryName}
                onChange={(e) => setLotteryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    claimAmountInputRef.current?.focus();
                  }
                }}
                placeholder="e.g. Mahajana Sampatha"
                list="lottery-suggestions"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm sm:text-base text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
              <datalist id="lottery-suggestions">
                {LOTTERY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
            </div>

            {/* 2. Cash Claim Amount (Required - Enter navigates to Agent/Note) */}
            <div>
              <label
                htmlFor="claimAmountInput"
                className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1"
              >
                Claim Amount (Rs.) <span className="text-red-500">*</span>
              </label>
              <input
                id="claimAmountInput"
                ref={claimAmountInputRef}
                type="number"
                step="any"
                value={claimAmount}
                onChange={(e) => setClaimAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    agentNoteInputRef.current?.focus();
                  }
                }}
                placeholder="e.g. 50000"
                required
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm sm:text-base font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            </div>

            {/* 3. Agent / Note (Optional - Enter saves ticket) */}
            <div>
              <label
                htmlFor="agentNoteInput"
                className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1"
              >
                Agent / Note
              </label>
              <input
                id="agentNoteInput"
                ref={agentNoteInputRef}
                type="text"
                value={agentOrCustomer}
                onChange={(e) => setAgentOrCustomer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTicket();
                  }
                }}
                placeholder="Optional note…"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm sm:text-base text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            </div>

            {/* 4. Action & Scanned checkbox */}
            <div className="flex items-end gap-2.5">
              <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-700 cursor-pointer h-10 px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={isScannedInput}
                  onChange={(e) => setIsScannedInput(e.target.checked)}
                  className="rounded border-slate-300 text-slate-800 w-4 h-4"
                />
                <span>Already Scanned</span>
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="h-10 px-5 rounded-md bg-slate-800 hover:bg-slate-900 active:scale-95 text-white font-semibold text-sm sm:text-base transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span>Saving…</span>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>Add</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* ===== CONTROLS BAR: FILTERS & SEARCH ===== */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-md">
            <button
              type="button"
              onClick={() => setFilterTab("all")}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded transition ${
                filterTab === "all"
                  ? "bg-white text-slate-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All ({activeTickets.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab("pending")}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded transition ${
                filterTab === "pending"
                  ? "bg-amber-100 text-amber-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Pending ({summary.pendingCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab("scanned")}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded transition ${
                filterTab === "scanned"
                  ? "bg-emerald-100 text-emerald-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Scanned ({summary.scannedCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterTab("deleted");
                setShowDeletedModal(true);
              }}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded transition flex items-center gap-1.5 ${
                filterTab === "deleted"
                  ? "bg-rose-100 text-rose-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="Click to view Deleted Archive popup"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Deleted ({deletedTickets.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="rounded-md border border-slate-300 pl-8 pr-3 py-1.5 text-xs sm:text-sm bg-white text-slate-900 w-44 sm:w-52 focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>

            {filterTab !== "deleted" && summary.pendingCount > 0 && (
              <button
                type="button"
                disabled={isMarkingAll}
                onClick={handleMarkAllScanned}
                className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
              >
                <CheckCheck className="w-4 h-4 text-slate-600" />
                <span>Mark All Scanned</span>
              </button>
            )}
          </div>
        </div>

        {/* ===== TICKETS TABLE ===== */}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              {filterTab === "deleted" ? (
                /* DELETED VIEW HEADER: NO ACTIONS, READ-ONLY AUDIT */
                <tr className="border-b border-slate-200 bg-rose-50/80 font-semibold text-rose-950 text-xs sm:text-sm">
                  <th className="py-3 px-3.5 w-12 text-center">#</th>
                  <th className="py-3 px-3.5">Lottery Game</th>
                  <th className="py-3 px-3.5">Agent / Note</th>
                  <th className="py-3 px-3.5 text-right">Claim Amount</th>
                  <th className="py-3 px-3.5">Added Time</th>
                  <th className="py-3 px-3.5">Scanned Time</th>
                  <th className="py-3 px-3.5">Deleted Time</th>
                </tr>
              ) : (
                /* ACTIVE VIEW HEADER */
                <tr className="border-b border-slate-200 bg-slate-100 font-semibold text-slate-700 text-xs sm:text-sm">
                  <th className="py-3 px-3.5 w-12 text-center">#</th>
                  <th className="py-3 px-3.5">Lottery Game</th>
                  <th className="py-3 px-3.5">Agent / Note</th>
                  <th className="py-3 px-3.5 text-right">Claim Amount</th>
                  <th className="py-3 px-3.5">Added Time</th>
                  <th className="py-3 px-3.5">Scanned Time</th>
                  <th className="py-3 px-3.5 text-center">Cashier Scan</th>
                  <th className="py-3 px-3.5 text-center w-24">Actions</th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white text-sm">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={filterTab === "deleted" ? 7 : 8}
                    className="py-8 text-center text-slate-500 text-sm sm:text-base"
                  >
                    Loading records…
                  </td>
                </tr>
              ) : filteredTickets.length === 0 ? (
                <tr>
                  <td
                    colSpan={filterTab === "deleted" ? 7 : 8}
                    className="py-8 text-center text-slate-500 text-sm sm:text-base"
                  >
                    {filterTab === "deleted"
                      ? "No deleted tickets."
                      : activeTickets.length === 0
                      ? "No tickets added yet."
                      : "No matching tickets."}
                  </td>
                </tr>
              ) : (
                filteredTickets.map((ticket, index) => {
                  const isUpdating = updatingTicketId === ticket.id;

                  if (filterTab === "deleted") {
                    /* DELETED ROW: AUDIT TRAIL WITHOUT EDIT OR DELETE OPTIONS */
                    return (
                      <tr key={ticket.id} className="bg-rose-50/20 hover:bg-rose-50/40 transition">
                        <td className="py-3 px-3.5 text-center font-mono text-slate-400 text-sm">
                          {index + 1}
                        </td>
                        <td className="py-3 px-3.5 font-semibold text-slate-900 text-sm sm:text-base">
                          {ticket.lotteryName}
                        </td>
                        <td className="py-3 px-3.5 text-slate-700 text-sm">
                          {ticket.agentOrCustomer || "-"}
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900 text-base sm:text-lg">
                          {formatCurrency(ticket.claimAmount)}
                        </td>
                        <td className="py-3 px-3.5 text-slate-600 font-mono text-xs sm:text-sm whitespace-nowrap">
                          {formatDisplayDate(ticket.createdAt)}
                        </td>
                        <td className="py-3 px-3.5 font-mono text-xs sm:text-sm whitespace-nowrap">
                          {ticket.isScanned && ticket.scannedAt ? (
                            <span className="font-semibold text-emerald-800">
                              {formatDisplayDate(ticket.scannedAt)}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-mono text-xs">-</span>
                          )}
                        </td>
                        <td className="py-3 px-3.5 font-mono text-xs sm:text-sm text-rose-800 font-semibold whitespace-nowrap">
                          {formatDisplayDate(ticket.deletedAt)}
                        </td>
                      </tr>
                    );
                  }

                  /* ACTIVE TICKET ROW */
                  return (
                    <tr
                      key={ticket.id}
                      className={`hover:bg-slate-50 transition ${
                        ticket.isScanned ? "bg-emerald-50/25" : ""
                      }`}
                    >
                      {/* # */}
                      <td className="py-3 px-3.5 text-center font-mono text-slate-400 text-sm">
                        {index + 1}
                      </td>

                      {/* Lottery */}
                      <td className="py-3 px-3.5 font-semibold text-slate-900 text-sm sm:text-base">
                        {ticket.lotteryName}
                      </td>

                      {/* Agent / Note */}
                      <td className="py-3 px-3.5 text-slate-700 text-sm">
                        {ticket.agentOrCustomer || "-"}
                      </td>

                      {/* Claim Amount */}
                      <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900 text-base sm:text-lg">
                        {formatCurrency(ticket.claimAmount)}
                      </td>

                      {/* Added Time */}
                      <td
                        className="py-3 px-3.5 text-slate-600 font-mono text-xs sm:text-sm whitespace-nowrap"
                        title={ticket.createdAt}
                      >
                        {formatDisplayDate(ticket.createdAt)}
                      </td>

                      {/* Scanned Time */}
                      <td className="py-3 px-3.5 font-mono text-xs sm:text-sm whitespace-nowrap">
                        {ticket.isScanned && ticket.scannedAt ? (
                          <span className="font-semibold text-emerald-800">
                            {formatDisplayDate(ticket.scannedAt)}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono text-xs">-</span>
                        )}
                      </td>

                      {/* Cashier Scan Action Button */}
                      <td className="py-3 px-3.5 text-center">
                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => handleToggleScanned(ticket)}
                          className={`px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition inline-flex items-center gap-1.5 active:scale-95 disabled:opacity-50 ${
                            ticket.isScanned
                              ? "bg-emerald-700 hover:bg-emerald-800 text-white shadow-2xs"
                              : "bg-slate-100 hover:bg-emerald-600 hover:text-white text-slate-700 border border-slate-300"
                          }`}
                          title={
                            ticket.isScanned
                              ? `Scanned at ${formatDisplayDate(ticket.scannedAt)}. Click to unmark.`
                              : "Click to mark as scanned by cashier"
                          }
                        >
                          {isUpdating ? (
                            <span className="inline-block animate-spin">⏳</span>
                          ) : ticket.isScanned ? (
                            <>
                              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                              <span>Scanned</span>
                            </>
                          ) : (
                            <span>Scan</span>
                          )}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTicket(ticket);
                              setEditLotteryName(ticket.lotteryName);
                              setEditAmount(ticket.claimAmount.toString());
                              setEditAgent(ticket.agentOrCustomer || "");
                            }}
                            className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingTicket(ticket)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-red-700 hover:bg-red-50 transition"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ===== SCANNING STAFF BALANCE VERIFICATION SECTION ===== */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3.5 mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2.5">
              <Users className="w-5 h-5 text-slate-700" />
              <h3 className="text-sm sm:text-base font-bold text-slate-800">
                Staff Balance Verification
              </h3>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleAddStaffRow}
                className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition"
              >
                <Plus className="w-4 h-4" />
                <span>Add Staff</span>
              </button>

              <button
                type="button"
                disabled={isSavingStaff || staffBalances.length === 0}
                onClick={handleSaveStaffBalances}
                className="px-3.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-900 text-white text-xs sm:text-sm font-semibold transition disabled:opacity-50"
              >
                {isSavingStaff ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {/* Staff Table: staff name | opening balance | closing balance */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 font-semibold text-slate-700 text-xs sm:text-sm">
                  <th className="py-2.5 px-3.5">Staff Name</th>
                  <th className="py-2.5 px-3.5">Opening (Rs.)</th>
                  <th className="py-2.5 px-3.5">Closing (Rs.)</th>
                  <th className="py-2.5 px-3.5 text-right">Net Scanned (Rs.)</th>
                  <th className="py-2.5 px-3.5 text-center">Status</th>
                  <th className="py-2.5 px-3.5 text-center w-14">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {staffBalances.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-slate-400 text-xs sm:text-sm">
                      No staff records added.
                    </td>
                  </tr>
                ) : (
                  staffBalances.map((s, idx) => {
                    const netScanned =
                      (Number(s.closingBalance) || 0) - (Number(s.openingBalance) || 0);
                    const hasClosed = (Number(s.closingBalance) || 0) > 0;

                    return (
                      <tr key={s.id || idx}>
                        {/* Staff Name */}
                        <td className="py-2.5 px-3.5">
                          <input
                            type="text"
                            value={s.staffName}
                            onChange={(e) =>
                              handleUpdateStaffField(s.id, "staffName", e.target.value)
                            }
                            placeholder="Staff name…"
                            list="staff-dir-list"
                            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>

                        {/* Opening Balance */}
                        <td className="py-2.5 px-3.5">
                          <input
                            type="number"
                            step="any"
                            value={s.openingBalance === 0 ? "" : s.openingBalance}
                            onChange={(e) =>
                              handleUpdateStaffField(s.id, "openingBalance", e.target.value)
                            }
                            placeholder="0.00"
                            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm sm:text-base font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>

                        {/* Closing Balance */}
                        <td className="py-2.5 px-3.5">
                          <input
                            type="number"
                            step="any"
                            value={s.closingBalance === 0 ? "" : s.closingBalance}
                            onChange={(e) =>
                              handleUpdateStaffField(s.id, "closingBalance", e.target.value)
                            }
                            placeholder="0.00"
                            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm sm:text-base font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>

                        {/* Scanned Amount */}
                        <td className="py-2.5 px-3.5 text-right font-mono font-bold text-slate-900 text-base sm:text-lg">
                          {formatCurrency(netScanned)}
                        </td>

                        {/* Row Status */}
                        <td className="py-2.5 px-3.5 text-center">
                          {hasClosed ? (
                            netScanned > 0 ? (
                              <span className="px-2.5 py-1 rounded-md text-xs sm:text-sm font-bold bg-emerald-100 text-emerald-800">
                                +{formatCurrency(netScanned)}
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-md text-xs sm:text-sm font-semibold bg-slate-100 text-slate-600">
                                No Change
                              </span>
                            )
                          ) : (
                            <span className="text-xs sm:text-sm text-slate-400">
                              Pending Close
                            </span>
                          )}
                        </td>

                        {/* Remove */}
                        <td className="py-2.5 px-3.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveStaffRow(s.id)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-red-700 hover:bg-red-50"
                            title="Remove staff"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <datalist id="staff-dir-list">
            {availableStaffMembers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          {/* Verification Status Bar */}
          {staffBalances.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-lg border border-slate-200 text-sm">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-slate-700 text-xs sm:text-sm">
                  Terminal Net:{" "}
                  <b className="font-mono text-slate-900 font-bold text-sm sm:text-base">
                    {formatCurrency(staffVerification.totalTerminalScanned)}
                  </b>
                </span>
                <span className="text-slate-700 text-xs sm:text-sm">
                  Claimed Total:{" "}
                  <b className="font-mono text-slate-900 font-bold text-sm sm:text-base">
                    {formatCurrency(summary.totalClaimAmount)}
                  </b>
                </span>
                <span className="text-slate-700 text-xs sm:text-sm">
                  Difference:{" "}
                  <b
                    className={`font-mono font-bold text-sm sm:text-base ${
                      staffVerification.isBalanced
                        ? "text-emerald-700"
                        : "text-amber-800"
                    }`}
                  >
                    {formatCurrency(staffVerification.difference)}
                  </b>
                </span>
              </div>

              {/* Status Badge */}
              <div>
                {staffVerification.isBalanced ? (
                  <span className="px-2.5 py-1 rounded-md text-xs sm:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5">
                    <Check className="w-4 h-4 stroke-[2.5]" />
                    <span>✓ Balanced (Matched)</span>
                  </span>
                ) : staffVerification.hasIncompleteEntries ? (
                  <span className="px-2.5 py-1 rounded-md text-xs sm:text-sm font-medium bg-slate-100 text-slate-600 border border-slate-200">
                    Pending Closing
                  </span>
                ) : staffVerification.difference < 0 ? (
                  <span className="px-2.5 py-1 rounded-md text-xs sm:text-sm font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    ⚠️ Under: {formatCurrency(Math.abs(staffVerification.difference))}
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-md text-xs sm:text-sm font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    ⚠️ Over: {formatCurrency(staffVerification.difference)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== EDIT MODAL ===== */}
      {editingTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-xl space-y-4">
            <h3 className="font-bold text-slate-900 text-base sm:text-lg">Edit Ticket Entry</h3>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Lottery Game</label>
                <input
                  type="text"
                  value={editLotteryName}
                  onChange={(e) => setEditLotteryName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 p-2 text-sm sm:text-base"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Amount (Rs.)</label>
                <input
                  type="number"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full rounded-md border border-slate-300 p-2 font-mono font-bold text-base sm:text-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Agent / Note</label>
                <input
                  type="text"
                  value={editAgent}
                  onChange={(e) => setEditAgent(e.target.value)}
                  className="w-full rounded-md border border-slate-300 p-2 text-sm sm:text-base"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t">
              <button
                type="button"
                onClick={() => setEditingTicket(null)}
                className="px-4 py-2 rounded-md border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingEdit}
                onClick={handleSaveEdit}
                className="px-4 py-2 rounded-md bg-slate-800 hover:bg-slate-900 text-white font-semibold text-sm"
              >
                {isSavingEdit ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== DELETE CONFIRMATION MODAL ===== */}
      {deletingTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-300 bg-white p-6 shadow-xl space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Delete Ticket?</h3>
            <p className="text-sm text-slate-600">
              Archive <b>{deletingTicket.lotteryName}</b> ({formatCurrency(deletingTicket.claimAmount)})?
            </p>

            <div className="flex justify-end gap-2.5 pt-3 border-t">
              <button
                type="button"
                onClick={() => setDeletingTicket(null)}
                className="px-4 py-2 rounded-md border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteTicket}
                className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold text-sm"
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== DELETED TICKETS ARCHIVE POPUP MODAL ===== */}
      {showDeletedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border border-slate-300 bg-white shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="p-1.5 rounded-md bg-rose-100 text-rose-800">
                  <Archive className="w-4 h-4" />
                </span>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">
                    Deleted Tickets
                  </h3>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-900 border border-rose-200">
                    {deletedTickets.length} Deleted
                  </span>
                  <span className="text-xs text-slate-500 font-medium ml-1">
                    • {selectedDate}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={deletedSearchQuery}
                    onChange={(e) => setDeletedSearchQuery(e.target.value)}
                    placeholder="Search…"
                    className="rounded-md border border-slate-300 pl-8 pr-2.5 py-1 text-xs sm:text-sm bg-white text-slate-900 w-40 sm:w-52 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeletedModal(false);
                    setDeletedSearchQuery("");
                  }}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Table Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-rose-50/80 font-semibold text-rose-950 text-xs sm:text-sm">
                      <th className="py-2.5 px-3.5 w-12 text-center">#</th>
                      <th className="py-2.5 px-3.5">Lottery Game</th>
                      <th className="py-2.5 px-3.5">Agent / Note</th>
                      <th className="py-2.5 px-3.5 text-right">Claim Amount</th>
                      <th className="py-2.5 px-3.5">Added Time</th>
                      <th className="py-2.5 px-3.5">Scanned Time</th>
                      <th className="py-2.5 px-3.5">Deleted Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white text-sm">
                    {filteredDeletedTickets.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="py-8 text-center text-slate-400 text-sm"
                        >
                          {deletedTickets.length === 0
                            ? "No deleted tickets."
                            : "No matching tickets."}
                        </td>
                      </tr>
                    ) : (
                      filteredDeletedTickets.map((ticket, index) => (
                        <tr
                          key={ticket.id}
                          className="bg-rose-50/20 hover:bg-rose-50/40 transition"
                        >
                          <td className="py-2.5 px-3.5 text-center font-mono text-slate-400 text-sm">
                            {index + 1}
                          </td>
                          <td className="py-2.5 px-3.5 font-semibold text-slate-900 text-sm sm:text-base">
                            {ticket.lotteryName}
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-700 text-sm">
                            {ticket.agentOrCustomer || "-"}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono font-bold text-slate-900 text-base sm:text-lg">
                            {formatCurrency(ticket.claimAmount)}
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-600 font-mono text-xs sm:text-sm whitespace-nowrap">
                            {formatDisplayDate(ticket.createdAt)}
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-xs sm:text-sm whitespace-nowrap">
                            {ticket.isScanned && ticket.scannedAt ? (
                              <span className="font-semibold text-emerald-800">
                                {formatDisplayDate(ticket.scannedAt)}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-mono text-xs">-</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-xs sm:text-sm text-rose-800 font-semibold whitespace-nowrap">
                            {formatDisplayDate(ticket.deletedAt)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-2.5 flex items-center justify-between gap-3">
              <div className="text-xs sm:text-sm text-slate-700">
                Total: <b className="font-mono text-slate-900 text-sm sm:text-base">{formatCurrency(filteredDeletedTickets.reduce((acc, cur) => acc + (Number(cur.claimAmount) || 0), 0))}</b>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowDeletedModal(false);
                  setDeletedSearchQuery("");
                }}
                className="px-4 py-1.5 rounded-md bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs sm:text-sm transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

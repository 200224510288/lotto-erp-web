// app/lib/bigPrizeTicketsService.ts
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
} from "firebase/firestore";
import * as XLSX from "xlsx";
import { db } from "./firebase";
import { formatCurrency, formatDisplayDate, roundToTwoDecimals } from "./balanceOrganizerService";

/* =============================================================
   TYPES & INTERFACES
   ============================================================= */

export interface BigPrizeWinningTicket {
  id: string; // e.g. "bpt_1700000000000_abc"
  balanceDate: string; // "YYYY-MM-DD"
  lotteryName: string; // Typeable lottery game (e.g., "Mahajana Sampatha", "Govisetha")
  claimAmount: number; // Winning cash claimed (Rs.)
  agentOrCustomer: string; // Agent name or note (defaults to "")
  isScanned: boolean; // Cashier scan status
  scannedAt: string | null; // ISO timestamp when scanned
  scannedBy: string | null; // Officer/cashier email or name
  isDeleted: boolean; // Soft delete flag
  deletedAt: string | null; // ISO timestamp when deleted
  deletedBy: string | null; // Officer email who deleted
  notes?: string;
  ticketNumber?: string;
  drawNo?: string;
  createdAt: string; // ISO timestamp (added time)
  createdBy: string;
}

export interface BigPrizeSummary {
  totalCount: number;
  totalClaimAmount: number;
  scannedCount: number;
  scannedAmount: number;
  pendingCount: number;
  pendingAmount: number;
  percentScanned: number;
}

export interface ScanningStaffBalance {
  id: string; // e.g. "staff_1"
  staffName: string;
  openingBalance: number;
  closingBalance: number;
  notes?: string;
}

export interface StaffBalanceVerificationResult {
  totalOpening: number;
  totalClosing: number;
  totalTerminalScanned: number;
  bigPrizeTotalClaimed: number;
  difference: number;
  isBalanced: boolean;
  hasIncompleteEntries: boolean;
}

export const LOTTERY_OPTIONS = [
  "Mahajana Sampatha",
  "Govisetha",
  "Ada Kotipathi",
  "Shanida",
  "Lagna Wasana",
  "Super Ball",
  "Kapruka",
  "Jayoda",
  "Development Fortune",
  "Dhana Nidhanaya",
  "Handahana",
  "Wasi",
  "NLB - Mahajana",
  "NLB - Govisetha",
  "Other / Special",
];

const COLLECTION_NAME = "daily_big_prize_tickets";

/* =============================================================
   CALCULATION HELPERS
   ============================================================= */

export function calculateBigPrizeSummary(tickets: BigPrizeWinningTicket[]): BigPrizeSummary {
  let totalClaimAmount = 0;
  let scannedCount = 0;
  let scannedAmount = 0;

  // Filter out soft-deleted tickets
  const activeTickets = tickets.filter((t) => !t.isDeleted);

  for (const t of activeTickets) {
    const amt = typeof t.claimAmount === "number" && !isNaN(t.claimAmount) ? t.claimAmount : 0;
    totalClaimAmount += amt;
    if (t.isScanned) {
      scannedCount++;
      scannedAmount += amt;
    }
  }

  totalClaimAmount = roundToTwoDecimals(totalClaimAmount);
  scannedAmount = roundToTwoDecimals(scannedAmount);

  const totalCount = activeTickets.length;
  const pendingCount = totalCount - scannedCount;
  const pendingAmount = roundToTwoDecimals(totalClaimAmount - scannedAmount);
  const percentScanned = totalCount > 0 ? Math.round((scannedCount / totalCount) * 100) : 0;

  return {
    totalCount,
    totalClaimAmount,
    scannedCount,
    scannedAmount,
    pendingCount,
    pendingAmount,
    percentScanned,
  };
}

export function calculateStaffBalanceVerification(
  staffList: ScanningStaffBalance[],
  bigPrizeTotalClaimed: number
): StaffBalanceVerificationResult {
  let totalOpening = 0;
  let totalClosing = 0;
  let hasIncomplete = false;

  for (const s of staffList) {
    const open = typeof s.openingBalance === "number" && !isNaN(s.openingBalance) ? s.openingBalance : 0;
    const close = typeof s.closingBalance === "number" && !isNaN(s.closingBalance) ? s.closingBalance : 0;
    totalOpening += open;
    totalClosing += close;
    if (close === 0 || s.closingBalance === undefined || s.closingBalance === null) {
      hasIncomplete = true;
    }
  }

  totalOpening = roundToTwoDecimals(totalOpening);
  totalClosing = roundToTwoDecimals(totalClosing);
  const totalTerminalScanned = roundToTwoDecimals(totalClosing - totalOpening);
  const difference = roundToTwoDecimals(totalTerminalScanned - bigPrizeTotalClaimed);
  const isBalanced = totalTerminalScanned > 0 && Math.abs(difference) < 0.01;

  return {
    totalOpening,
    totalClosing,
    totalTerminalScanned,
    bigPrizeTotalClaimed,
    difference,
    isBalanced,
    hasIncompleteEntries: hasIncomplete,
  };
}

/* =============================================================
   FIRESTORE CRUD OPERATIONS
   ============================================================= */

/**
 * Fetch all big prize winning tickets and scanning staff balances for a given balance date.
 */
export async function getDailyBigPrizeTickets(
  balanceDate: string
): Promise<{
  tickets: BigPrizeWinningTicket[];
  summary: BigPrizeSummary;
  staffBalances: ScanningStaffBalance[];
}> {
  if (!balanceDate) {
    return { tickets: [], summary: calculateBigPrizeSummary([]), staffBalances: [] };
  }

  try {
    const ticketsColRef = collection(db, COLLECTION_NAME, balanceDate, "tickets");
    const q = query(ticketsColRef, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    const tickets: BigPrizeWinningTicket[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      tickets.push({
        id: docSnap.id,
        balanceDate: data.balanceDate || balanceDate,
        lotteryName: String(data.lotteryName || "General"),
        claimAmount: Number(data.claimAmount || 0),
        agentOrCustomer: data.agentOrCustomer ? String(data.agentOrCustomer) : "",
        isScanned: Boolean(data.isScanned),
        scannedAt: data.scannedAt || null,
        scannedBy: data.scannedBy || null,
        isDeleted: Boolean(data.isDeleted),
        deletedAt: data.deletedAt || null,
        deletedBy: data.deletedBy || null,
        notes: data.notes ? String(data.notes) : "",
        createdAt: data.createdAt || new Date().toISOString(),
        createdBy: data.createdBy || "Authorized Officer",
      });
    });

    // Fetch scanning staff balances from parent document
    const parentDocRef = doc(db, COLLECTION_NAME, balanceDate);
    const parentSnap = await getDoc(parentDocRef);
    const parentData = parentSnap.exists() ? parentSnap.data() : {};
    const staffBalances: ScanningStaffBalance[] = Array.isArray(parentData?.staffBalances)
      ? parentData.staffBalances
      : [];

    const summary = calculateBigPrizeSummary(tickets);
    return { tickets, summary, staffBalances };
  } catch (error) {
    console.error("Error fetching daily big prize tickets:", error);
    throw error;
  }
}

/**
 * Save scanning staff balances (opening and closing balances)
 */
export async function saveScanningStaffBalances(
  balanceDate: string,
  staffBalances: ScanningStaffBalance[],
  userEmail: string
): Promise<void> {
  if (!balanceDate) throw new Error("Balance date is required.");

  try {
    const docRef = doc(db, COLLECTION_NAME, balanceDate);
    const sanitized = staffBalances.map((s, idx) => ({
      id: s.id || `staff_${idx}_${Date.now()}`,
      staffName: s.staffName.trim(),
      openingBalance: roundToTwoDecimals(Number(s.openingBalance) || 0),
      closingBalance: roundToTwoDecimals(Number(s.closingBalance) || 0),
      notes: s.notes?.trim() || "",
    }));

    await setDoc(
      docRef,
      {
        balanceDate,
        staffBalances: sanitized,
        staffBalancesUpdatedAt: new Date().toISOString(),
        staffBalancesUpdatedBy: userEmail || "Authorized Officer",
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Error saving scanning staff balances:", error);
    throw error;
  }
}

/**
 * Add a new big prize winning ticket for a given balance date.
 */
export async function addBigPrizeWinningTicket(
  ticketData: Omit<BigPrizeWinningTicket, "id" | "createdAt">
): Promise<BigPrizeWinningTicket> {
  const balanceDate = ticketData.balanceDate;
  if (!balanceDate) throw new Error("Balance date is required.");
  if (typeof ticketData.claimAmount !== "number" || ticketData.claimAmount <= 0) {
    throw new Error("A valid cash claim amount greater than 0 is required.");
  }

  try {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const ticketId = `bpt_${timestamp}_${randomSuffix}`;
    const nowIso = new Date().toISOString();

    const ticketDocRef = doc(db, COLLECTION_NAME, balanceDate, "tickets", ticketId);
    const parentDocRef = doc(db, COLLECTION_NAME, balanceDate);

    const cleanAgent = ticketData.agentOrCustomer ? String(ticketData.agentOrCustomer).trim() : "";
    const cleanNotes = ticketData.notes ? String(ticketData.notes).trim() : "";
    const cleanLottery = ticketData.lotteryName ? String(ticketData.lotteryName).trim() : "Lottery";

    const newTicket: BigPrizeWinningTicket = {
      id: ticketId,
      balanceDate,
      lotteryName: cleanLottery,
      claimAmount: roundToTwoDecimals(ticketData.claimAmount),
      agentOrCustomer: cleanAgent,
      isScanned: Boolean(ticketData.isScanned),
      scannedAt: ticketData.isScanned ? nowIso : null,
      scannedBy: ticketData.isScanned ? (ticketData.createdBy || "Authorized Officer") : null,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      notes: cleanNotes,
      createdAt: nowIso,
      createdBy: ticketData.createdBy || "Authorized Officer",
    };

    // Filter out any undefined fields so Firestore never throws unsupported field value error
    const firestorePayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(newTicket)) {
      if (v !== undefined) {
        firestorePayload[k] = v;
      }
    }

    const batch = writeBatch(db);
    batch.set(ticketDocRef, firestorePayload);
    batch.set(
      parentDocRef,
      {
        balanceDate,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    await batch.commit();
    return newTicket;
  } catch (error) {
    console.error("Error adding big prize winning ticket:", error);
    throw error;
  }
}

/**
 * Toggle or update the Cashier Scanned status of a single ticket.
 */
export async function updateBigPrizeTicketScanStatus(
  balanceDate: string,
  ticketId: string,
  isScanned: boolean,
  userEmail: string
): Promise<{ isScanned: boolean; scannedAt: string | null; scannedBy: string | null }> {
  if (!balanceDate || !ticketId) throw new Error("Balance Date and Ticket ID are required.");

  try {
    const ticketDocRef = doc(db, COLLECTION_NAME, balanceDate, "tickets", ticketId);
    const nowIso = new Date().toISOString();

    const updates = {
      isScanned,
      scannedAt: isScanned ? nowIso : null,
      scannedBy: isScanned ? userEmail || "Authorized Officer" : null,
    };

    await updateDoc(ticketDocRef, updates);

    // Update parent timestamp
    await setDoc(
      doc(db, COLLECTION_NAME, balanceDate),
      { updatedAt: nowIso },
      { merge: true }
    );

    return updates;
  } catch (error) {
    console.error("Error updating big prize ticket scan status:", error);
    throw error;
  }
}

/**
 * Update ticket details (e.g. amount, ticket number, notes)
 */
export async function updateBigPrizeWinningTicket(
  balanceDate: string,
  ticketId: string,
  updates: Partial<Omit<BigPrizeWinningTicket, "id" | "createdAt">>
): Promise<void> {
  if (!balanceDate || !ticketId) throw new Error("Balance Date and Ticket ID are required.");

  try {
    const ticketDocRef = doc(db, COLLECTION_NAME, balanceDate, "tickets", ticketId);
    const nowIso = new Date().toISOString();

    const sanitizedUpdates: Record<string, unknown> = {
      ...updates,
      updatedAt: nowIso,
    };

    if (typeof updates.claimAmount === "number") {
      sanitizedUpdates.claimAmount = roundToTwoDecimals(updates.claimAmount);
    }
    if (typeof updates.ticketNumber === "string") {
      sanitizedUpdates.ticketNumber = updates.ticketNumber.trim().toUpperCase();
    }

    await updateDoc(ticketDocRef, sanitizedUpdates);
  } catch (error) {
    console.error("Error updating big prize winning ticket:", error);
    throw error;
  }
}

/**
 * Soft delete a big prize winning ticket and record deleted time and user.
 */
export async function deleteBigPrizeWinningTicket(
  balanceDate: string,
  ticketId: string,
  userEmail?: string
): Promise<{ deletedAt: string; deletedBy: string }> {
  if (!balanceDate || !ticketId) throw new Error("Balance Date and Ticket ID are required.");

  try {
    const ticketDocRef = doc(db, COLLECTION_NAME, balanceDate, "tickets", ticketId);
    const nowIso = new Date().toISOString();
    const deletedBy = userEmail || "Authorized Officer";

    await updateDoc(ticketDocRef, {
      isDeleted: true,
      deletedAt: nowIso,
      deletedBy,
      updatedAt: nowIso,
    });

    await setDoc(
      doc(db, COLLECTION_NAME, balanceDate),
      { updatedAt: nowIso },
      { merge: true }
    );

    return { deletedAt: nowIso, deletedBy };
  } catch (error) {
    console.error("Error deleting big prize winning ticket:", error);
    throw error;
  }
}

/**
 * Mark all tickets for a given balance date as Scanned by cashier.
 */
export async function markAllBigPrizeTicketsScanned(
  balanceDate: string,
  ticketIds: string[],
  userEmail: string
): Promise<void> {
  if (!balanceDate || ticketIds.length === 0) return;

  try {
    const nowIso = new Date().toISOString();
    const batch = writeBatch(db);

    for (const id of ticketIds) {
      const ref = doc(db, COLLECTION_NAME, balanceDate, "tickets", id);
      batch.update(ref, {
        isScanned: true,
        scannedAt: nowIso,
        scannedBy: userEmail || "Authorized Officer",
      });
    }

    const parentRef = doc(db, COLLECTION_NAME, balanceDate);
    batch.set(parentRef, { updatedAt: nowIso }, { merge: true });

    await batch.commit();
  } catch (error) {
    console.error("Error marking all tickets scanned:", error);
    throw error;
  }
}

/**
 * Export big prize winning tickets to Excel spreadsheet.
 */
export function exportBigPrizeTicketsToExcel(
  tickets: BigPrizeWinningTicket[],
  balanceDate: string,
  staffBalances?: ScanningStaffBalance[]
): void {
  const summary = calculateBigPrizeSummary(tickets);

  const exportRows = tickets.map((t, index) => ({
    "#": index + 1,
    "Lottery Game": t.lotteryName,
    "Claim Amount (Rs.)": t.claimAmount,
    "Agent / Note": t.agentOrCustomer || "-",
    "Added Time": formatDisplayDate(t.createdAt),
    "Cashier Scanned": t.isDeleted ? "DELETED" : t.isScanned ? "SCANNED" : "PENDING",
    "Scanned Time": t.scannedAt ? formatDisplayDate(t.scannedAt) : "-",
    "Scanned By": t.scannedBy || "-",
    "Deleted Time": t.deletedAt ? formatDisplayDate(t.deletedAt) : "-",
    "Deleted By": t.deletedBy || "-",
  }));

  const metaInfo = [
    ["BIG PRIZE WINNING TICKETS - DAILY VERIFICATION REPORT", ""],
    ["Balance Date", balanceDate],
    ["Total Winning Tickets Claimed", summary.totalCount],
    ["Total Cash Claimed (Rs.)", summary.totalClaimAmount],
    ["Total Scanned to Cashier (Rs.)", summary.scannedAmount],
    ["Total Pending Cashier Scan (Rs.)", summary.pendingAmount],
    ["Scan Verification Rate", `${summary.percentScanned}% (${summary.scannedCount} of ${summary.totalCount} Scanned)`],
    [],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(metaInfo);
  XLSX.utils.sheet_add_json(ws, exportRows, { origin: "A10" });
  XLSX.utils.book_append_sheet(wb, ws, "Winning_Tickets");

  if (staffBalances && staffBalances.length > 0) {
    const staffRows = staffBalances.map((s, idx) => ({
      "#": idx + 1,
      "Staff Name": s.staffName,
      "Opening Balance (Rs.)": s.openingBalance,
      "Closing Balance (Rs.)": s.closingBalance,
      "Net Scanned (Rs.)": s.closingBalance - s.openingBalance,
      "Notes": s.notes || "",
    }));
    const staffWs = XLSX.utils.json_to_sheet(staffRows);
    XLSX.utils.book_append_sheet(wb, staffWs, "Staff_Balances");
  }

  XLSX.writeFile(wb, `Big_Prize_Verification_${balanceDate}.xlsx`);
}

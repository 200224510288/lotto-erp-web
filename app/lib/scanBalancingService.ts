// app/lib/scanBalancingService.ts
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "./firebase";

/* =============================================================
   TYPES & INTERFACES
   ============================================================= */

export type ScanBalancingMode = "admin" | "staff";

export interface StaffMemberMaster {
  id: string;
  name: string;
  isActive: boolean;
  order?: number;
  designation?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StaffEntry {
  id: string;
  staffName: string;

  agentParcels: number[];
  additionalBalanceOnly: number[];
  additionalTodayWins: number[];

  previousBalance: number;
  mailAmount: number;
  returnClaims: number;
  actualClosingBalance: number;

  agentDraft?: string;
  additionalBalanceDraft?: string;
  additionalTodayDraft?: string;
}

export interface StaffEntryPayload {
  id: string;
  staffName: string;
  agentParcels: number[];
  additionalBalanceOnly: number[];
  additionalTodayWins: number[];
  previousBalance: number;
  mailAmount: number;
  returnClaims: number;
  actualClosingBalance: number;
}

export interface DailyScanClaim {
  date: string; // YYYY-MM-DD
  totalAgentClaim: number;
  staffEntries: StaffEntryPayload[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface StaffCalculatedTotals {
  agentSum: number;
  extraSum: number;
  todaySum: number;
  winsForBalance: number;
  predicted: number;
  actual: number;
  diff: number;
  assignedScanned: number;
}

export interface DailyScanSummaryTotals {
  targetAmount: number;
  totalAssignedScanned: number;
  difference: number;
  isBalanced: boolean;
  totalAgentParcelsSum: number;
  totalExtraSum: number;
  totalTodayWinsSum: number;
}

/* =============================================================
   CORE MATHEMATICAL CALCULATIONS
   ============================================================= */

export function roundToTwoDecimals(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate individual staff member's scan balancing metrics:
 * - winsForBalance = agentSum + extraSum + todaySum
 * - predicted = previousBalance + winsForBalance - mailAmount - returnClaims
 * - actual = actualClosingBalance
 * - diff = actual - predicted
 * - assignedScanned = mailAmount + actualClosingBalance - previousBalance - returnClaims - extraSum - todaySum
 */
export function calculateStaffTotals(staff: StaffEntry): StaffCalculatedTotals {
  const agentSum = roundToTwoDecimals(
    (staff.agentParcels || []).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0)
  );
  const extraSum = roundToTwoDecimals(
    (staff.additionalBalanceOnly || []).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0)
  );
  const todaySum = roundToTwoDecimals(
    (staff.additionalTodayWins || []).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0)
  );

  const winsForBalance = roundToTwoDecimals(agentSum + extraSum + todaySum);

  const previousBalance = staff.previousBalance || 0;
  const mailAmount = staff.mailAmount || 0;
  const returnClaims = staff.returnClaims || 0;
  const actual = staff.actualClosingBalance || 0;

  const predicted = roundToTwoDecimals(
    previousBalance + winsForBalance - mailAmount - returnClaims
  );

  const diff = roundToTwoDecimals(actual - predicted);

  const assignedScanned = roundToTwoDecimals(
    mailAmount + actual - previousBalance - returnClaims - extraSum - todaySum
  );

  return {
    agentSum,
    extraSum,
    todaySum,
    winsForBalance,
    predicted,
    actual,
    diff,
    assignedScanned,
  };
}

/**
 * Calculate overall daily summary across all staff members:
 * - totalAssignedScanned = sum of assignedScanned of all staff
 * - difference = totalAssignedScanned - targetAmount
 * - isBalanced = Math.abs(difference) < 0.01
 */
export function calculateDailyScanSummary(
  totalAgentClaim: number,
  staffEntries: StaffEntry[]
): DailyScanSummaryTotals {
  let totalAssignedScanned = 0;
  let totalAgentParcelsSum = 0;
  let totalExtraSum = 0;
  let totalTodayWinsSum = 0;

  for (const staff of staffEntries) {
    const t = calculateStaffTotals(staff);
    totalAssignedScanned += t.assignedScanned;
    totalAgentParcelsSum += t.agentSum;
    totalExtraSum += t.extraSum;
    totalTodayWinsSum += t.todaySum;
  }

  totalAssignedScanned = roundToTwoDecimals(totalAssignedScanned);
  totalAgentParcelsSum = roundToTwoDecimals(totalAgentParcelsSum);
  totalExtraSum = roundToTwoDecimals(totalExtraSum);
  totalTodayWinsSum = roundToTwoDecimals(totalTodayWinsSum);

  const targetAmount = roundToTwoDecimals(totalAgentClaim || 0);
  const difference = roundToTwoDecimals(totalAssignedScanned - targetAmount);
  const isBalanced = Math.abs(difference) < 0.01 && targetAmount > 0;

  return {
    targetAmount,
    totalAssignedScanned,
    difference,
    isBalanced,
    totalAgentParcelsSum,
    totalExtraSum,
    totalTodayWinsSum,
  };
}

/**
 * Currency Formatter for Sri Lankan Rupees
 */
export function formatCurrency(amount: number | null | undefined): string {
  const val = typeof amount === "number" && !isNaN(amount) ? amount : 0;
  const isNeg = val < 0;
  const absVal = Math.abs(val);

  const formatted = absVal.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return isNeg ? `-Rs. ${formatted}` : `Rs. ${formatted}`;
}

/* =============================================================
   FIRESTORE DATABASE OPERATIONS
   ============================================================= */

const CLAIMS_COLLECTION = "win_tickets_scan_balancing";
const SETTINGS_COLLECTION = "system_settings";
const ADMIN_DOC_ID = "scan_balancing_security";
const DEFAULT_FALLBACK_PASSWORD = "8899";

/**
 * Fetch scan claim for a given date
 */
export async function getDailyScanClaim(dateStr: string): Promise<DailyScanClaim | null> {
  if (!dateStr) return null;

  try {
    const docRef = doc(db, CLAIMS_COLLECTION, dateStr);
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      return snap.data() as DailyScanClaim;
    }
    return null;
  } catch (error) {
    console.error("Error fetching scan balancing claim:", error);
    throw error;
  }
}

/**
 * Save scan claim for a given date
 */
export async function saveDailyScanClaim(claim: DailyScanClaim): Promise<void> {
  if (!claim.date) throw new Error("Date is required.");

  try {
    const docRef = doc(db, CLAIMS_COLLECTION, claim.date);
    await setDoc(docRef, {
      ...claim,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error saving scan balancing claim:", error);
    throw error;
  }
}

/**
 * Fetch the previous day's additional today wins (Tomorrow balance) to bring forward
 */
export async function getPreviousDayWins(dateStr: string): Promise<Record<string, number>> {
  if (!dateStr) return {};

  try {
    const current = new Date(dateStr);
    const prev = new Date(current);
    prev.setDate(prev.getDate() - 1);
    const prevStr = prev.toISOString().split("T")[0];

    const prevClaim = await getDailyScanClaim(prevStr);
    const map: Record<string, number> = {};

    if (prevClaim && Array.isArray(prevClaim.staffEntries)) {
      for (const entry of prevClaim.staffEntries) {
        const sum = (entry.additionalTodayWins || []).reduce(
          (s, v) => s + (typeof v === "number" ? v : 0),
          0
        );
        if (sum > 0 && entry.staffName) {
          map[entry.staffName] = roundToTwoDecimals(sum);
        }
      }
    }

    return map;
  } catch {
    return {};
  }
}

/**
 * Auto-suggest Today's Agent Wins Target from the Daily Balance report if one exists
 */
export async function getSuggestedAgentWinsTarget(dateStr: string): Promise<number | null> {
  if (!dateStr) return null;

  try {
    const docRef = doc(db, "daily_balance_reports", dateStr);
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data();
      if (typeof data.totalWin === "number" && data.totalWin > 0) {
        return data.totalWin;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/* =============================================================
   ADMIN PASSWORD / PIN SECURITY
   ============================================================= */

export async function verifyScanAdminPassword(enteredPass: string): Promise<boolean> {
  const p = enteredPass.trim();
  if (!p) return false;

  try {
    const ref = doc(db, SETTINGS_COLLECTION, ADMIN_DOC_ID);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await setDoc(ref, {
        adminPassword: DEFAULT_FALLBACK_PASSWORD,
        updatedAt: new Date().toISOString(),
      });
      return p === DEFAULT_FALLBACK_PASSWORD;
    }

    const data = snap.data();
    const stored = data.adminPassword ? String(data.adminPassword).trim() : DEFAULT_FALLBACK_PASSWORD;
    return p === stored;
  } catch (err) {
    console.error("Admin verify notice:", err);
    return p === DEFAULT_FALLBACK_PASSWORD;
  }
}

export async function updateScanAdminPassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  if (!newPassword || newPassword.trim().length < 4) {
    return { success: false, error: "New password must be at least 4 characters." };
  }

  const isValid = await verifyScanAdminPassword(currentPassword);
  if (!isValid) {
    return { success: false, error: "Current password is incorrect." };
  }

  try {
    const ref = doc(db, SETTINGS_COLLECTION, ADMIN_DOC_ID);
    await setDoc(
      ref,
      {
        adminPassword: newPassword.trim(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return { success: true };
  } catch {
    return { success: false, error: "Database error updating admin password." };
  }
}

/* =============================================================
   STAFF DIRECTORY (MASTER STAFF MANAGEMENT)
   ============================================================= */

const STAFF_DIRECTORY_COLLECTION = "scan_staff_directory";

/**
 * Fetch all registered staff members from the staff directory.
 * Returns an empty array if no staff members have been added yet.
 */
export async function getStaffDirectory(): Promise<StaffMemberMaster[]> {
  try {
    const colRef = collection(db, STAFF_DIRECTORY_COLLECTION);
    const snap = await getDocs(colRef);

    if (snap.empty) {
      return [];
    }

    const list: StaffMemberMaster[] = [];
    snap.forEach((d) => {
      const data = d.data() as StaffMemberMaster;
      list.push({
        id: d.id,
        name: data.name || "",
        isActive: data.isActive !== undefined ? data.isActive : true,
        order: typeof data.order === "number" ? data.order : 999,
        designation: data.designation || "Balancing Officer",
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    });

    list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
    return list;
  } catch (err) {
    console.error("Error loading staff directory:", err);
    return [];
  }
}

/**
 * Create or update a staff member in the Master Directory
 */
export async function saveStaffMember(data: {
  id?: string;
  name: string;
  isActive?: boolean;
  designation?: string;
  order?: number;
}): Promise<StaffMemberMaster> {
  const cleanName = data.name.trim();
  if (!cleanName) throw new Error("Staff name cannot be empty.");

  const id = data.id || `staff_dir_${Date.now()}`;
  const docRef = doc(db, STAFF_DIRECTORY_COLLECTION, id);

  const existingSnap = data.id ? await getDoc(docRef) : null;
  const existing = existingSnap?.exists() ? existingSnap.data() : {};

  const record: StaffMemberMaster = {
    id,
    name: cleanName,
    isActive: data.isActive !== undefined ? data.isActive : existing.isActive ?? true,
    order: data.order !== undefined ? data.order : existing.order ?? Date.now(),
    designation: data.designation || existing.designation || "Balancing Officer",
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await setDoc(docRef, record, { merge: true });
  return record;
}

/**
 * Delete a staff member from Master Directory
 */
export async function deleteStaffMember(id: string): Promise<void> {
  if (!id) return;
  const docRef = doc(db, STAFF_DIRECTORY_COLLECTION, id);
  await deleteDoc(docRef);
}

/**
 * Delete all staff members from Master Directory
 */
export async function clearAllStaffDirectory(): Promise<void> {
  try {
    const colRef = collection(db, STAFF_DIRECTORY_COLLECTION);
    const snap = await getDocs(colRef);
    for (const d of snap.docs) {
      await deleteDoc(doc(db, STAFF_DIRECTORY_COLLECTION, d.id));
    }
  } catch (err) {
    console.error("Error clearing staff directory:", err);
  }
}

/**
 * Toggle active/inactive status for a staff member
 */
export async function toggleStaffActive(id: string, isActive: boolean): Promise<void> {
  if (!id) return;
  const docRef = doc(db, STAFF_DIRECTORY_COLLECTION, id);
  await setDoc(
    docRef,
    { isActive, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

/**
 * Construct new daily staff allocation entries from available/active directory members
 */
export function buildStaffEntriesFromDirectory(
  directory: StaffMemberMaster[],
  previousWinsMap: Record<string, number> = {}
): StaffEntry[] {
  return directory
    .filter((m) => m.isActive)
    .map((m, idx) => ({
      id: `${m.id}_${Date.now()}_${idx}`,
      staffName: m.name,
      agentParcels: [],
      additionalBalanceOnly: [],
      additionalTodayWins: [],
      previousBalance: previousWinsMap[m.name] || 0,
      mailAmount: 0,
      returnClaims: 0,
      actualClosingBalance: 0,
      agentDraft: "",
      additionalBalanceDraft: "",
      additionalTodayDraft: "",
    }));
}

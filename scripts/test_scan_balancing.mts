import {
  calculateStaffTotals,
  calculateDailyScanSummary,
  StaffEntry,
} from "../app/lib/scanBalancingService";

console.log("=== Testing Staff Calculations ===");
const mockStaff: StaffEntry = {
  id: "1",
  staffName: "Kasun",
  agentParcels: [10000, 25000, 5000], // 40,000
  additionalBalanceOnly: [2000, 3000], // 5,000
  additionalTodayWins: [1500], // 1,500
  previousBalance: 8000,
  mailAmount: 20000,
  returnClaims: 1000,
  actualClosingBalance: 33500,
};

const totals = calculateStaffTotals(mockStaff);
console.assert(totals.agentSum === 40000, `Expected 40000 agentSum, got ${totals.agentSum}`);
console.assert(totals.extraSum === 5000, `Expected 5000 extraSum, got ${totals.extraSum}`);
console.assert(totals.todaySum === 1500, `Expected 1500 todaySum, got ${totals.todaySum}`);
console.assert(totals.winsForBalance === 46500, `Expected 46500 winsForBalance, got ${totals.winsForBalance}`);

// predicted = 8000 + 46500 - 20000 - 1000 = 33500
console.assert(totals.predicted === 33500, `Expected 33500 predicted, got ${totals.predicted}`);
console.assert(totals.actual === 33500, `Expected 33500 actual, got ${totals.actual}`);
console.assert(totals.diff === 0, `Expected 0 diff, got ${totals.diff}`);

// assignedScanned = 20000 + 33500 - 8000 - 1000 - 5000 - 1500 = 38000
console.assert(totals.assignedScanned === 38000, `Expected 38000 assignedScanned, got ${totals.assignedScanned}`);
console.log("✓ Staff calculations verified successfully!");

console.log("=== Testing Daily Summary ===");
const dailySummary = calculateDailyScanSummary(38000, [mockStaff]);
console.assert(dailySummary.targetAmount === 38000, "Target mismatch");
console.assert(dailySummary.totalAssignedScanned === 38000, "Assigned scanned mismatch");
console.assert(dailySummary.difference === 0, "Difference should be 0");
console.assert(dailySummary.isBalanced === true, "Should be balanced");
console.log("✓ Daily Summary verified successfully!");

console.log("=== Testing Staff Directory Allocation Builder ===");
import { buildStaffEntriesFromDirectory, StaffMemberMaster } from "../app/lib/scanBalancingService";
const mockDir: StaffMemberMaster[] = [
  { id: "s1", name: "Kumari", isActive: true },
  { id: "s2", name: "Dilrukshi", isActive: true },
  { id: "s3", name: "InactiveOfficer", isActive: false },
];
const built = buildStaffEntriesFromDirectory(mockDir, { Kumari: 5000 });
console.assert(built.length === 2, `Expected 2 active staff entries, got ${built.length}`);
console.assert(built[0].staffName === "Kumari", "Expected Kumari first");
console.assert(built[0].previousBalance === 5000, "Expected previousBalance 5000 for Kumari");
console.assert(built[1].staffName === "Dilrukshi", "Expected Dilrukshi second");
console.assert(built[1].previousBalance === 0, "Expected previousBalance 0 for Dilrukshi");
console.log("✓ Staff Directory Allocation Builder verified successfully!");


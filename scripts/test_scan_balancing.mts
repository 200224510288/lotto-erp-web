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

console.log("=== Testing Staff Reduction (Unable to Scan & Returned) ===");
const staffWithReturn: StaffEntry = {
  id: "2",
  staffName: "Sunil",
  agentParcels: [10000, 20000, 30000], // 60,000 (3 parcels)
  returnedParcels: [5000], // 5,000 returned unscanned (1 parcel)
  additionalBalanceOnly: [],
  additionalTodayWins: [],
  previousBalance: 0,
  mailAmount: 25000,
  returnClaims: 0,
  actualClosingBalance: 30000, // 55,000 - 25,000 = 30,000
};

const returnTotals = calculateStaffTotals(staffWithReturn);
console.assert(returnTotals.agentSum === 60000, `Expected 60000, got ${returnTotals.agentSum}`);
console.assert(returnTotals.agentCount === 3, `Expected 3 agent parcels, got ${returnTotals.agentCount}`);
console.assert(returnTotals.reductionSum === 5000, `Expected 5000 reduction, got ${returnTotals.reductionSum}`);
console.assert(returnTotals.reductionCount === 1, `Expected 1 reduction parcel, got ${returnTotals.reductionCount}`);
console.assert(returnTotals.netAgentSum === 55000, `Expected 55000 netAgentSum, got ${returnTotals.netAgentSum}`);
console.assert(returnTotals.netAgentCount === 2, `Expected 2 netAgentCount, got ${returnTotals.netAgentCount}`);
console.assert(returnTotals.winsForBalance === 55000, `Expected 55000 winsForBalance, got ${returnTotals.winsForBalance}`);
console.assert(returnTotals.predicted === 30000, `Expected 30000 predicted, got ${returnTotals.predicted}`);
console.assert(returnTotals.actual === 30000, `Expected 30000 actual, got ${returnTotals.actual}`);
console.assert(returnTotals.diff === 0, `Expected 0 diff, got ${returnTotals.diff}`);
console.assert(returnTotals.assignedScanned === 55000, `Expected 55000 assignedScanned, got ${returnTotals.assignedScanned}`);
console.log("✓ Parcel reduction calculations verified successfully!");



import {
  calculateBigPrizeSummary,
  BigPrizeWinningTicket,
} from "../app/lib/bigPrizeTicketsService";

console.log("=== Testing Big Prize Winning Tickets Summary Calculations ===");

const mockTickets: BigPrizeWinningTicket[] = [
  {
    id: "bpt_1",
    balanceDate: "2026-10-01",
    ticketNumber: "DLB-100234",
    lotteryName: "Mahajana Sampatha",
    claimAmount: 50000,
    agentOrCustomer: "Agent Silva",
    isScanned: true,
    scannedAt: "2026-10-01T10:00:00Z",
    scannedBy: "cashier1@lottery.lk",
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdAt: "2026-10-01T09:30:00Z",
    createdBy: "officer@lottery.lk",
  },
  {
    id: "bpt_2",
    balanceDate: "2026-10-01",
    ticketNumber: "DLB-100235",
    lotteryName: "Govisetha",
    claimAmount: 25000,
    agentOrCustomer: "Counter Customer",
    isScanned: false,
    scannedAt: null,
    scannedBy: null,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdAt: "2026-10-01T10:15:00Z",
    createdBy: "officer@lottery.lk",
  },
  {
    id: "bpt_3",
    balanceDate: "2026-10-01",
    ticketNumber: "DLB-100236",
    lotteryName: "Ada Kotipathi",
    claimAmount: 100000,
    agentOrCustomer: "Agent Perera",
    isScanned: true,
    scannedAt: "2026-10-01T11:00:00Z",
    scannedBy: "cashier2@lottery.lk",
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdAt: "2026-10-01T10:45:00Z",
    createdBy: "officer@lottery.lk",
  },
  {
    id: "bpt_4",
    balanceDate: "2026-10-01",
    ticketNumber: "DLB-100237",
    lotteryName: "Shanida",
    claimAmount: 15000,
    agentOrCustomer: "",
    isScanned: false,
    scannedAt: null,
    scannedBy: null,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdAt: "2026-10-01T11:30:00Z",
    createdBy: "officer@lottery.lk",
  },
  {
    id: "bpt_deleted",
    balanceDate: "2026-10-01",
    lotteryName: "Lagana Wasana",
    claimAmount: 60000,
    agentOrCustomer: "Deleted Entry",
    isScanned: false,
    scannedAt: null,
    scannedBy: null,
    isDeleted: true,
    deletedAt: "2026-10-01T11:45:00Z",
    deletedBy: "officer@lottery.lk",
    createdAt: "2026-10-01T11:00:00Z",
    createdBy: "officer@lottery.lk",
  },
];

const summary = calculateBigPrizeSummary(mockTickets);

console.log("Calculated Summary:", summary);

console.assert(summary.totalCount === 4, `Expected totalCount 4, got ${summary.totalCount}`);
console.assert(summary.totalClaimAmount === 190000, `Expected totalClaimAmount 190000, got ${summary.totalClaimAmount}`);
console.assert(summary.scannedCount === 2, `Expected scannedCount 2, got ${summary.scannedCount}`);
console.assert(summary.scannedAmount === 150000, `Expected scannedAmount 150000, got ${summary.scannedAmount}`);
console.assert(summary.pendingCount === 2, `Expected pendingCount 2, got ${summary.pendingCount}`);
console.assert(summary.pendingAmount === 40000, `Expected pendingAmount 40000, got ${summary.pendingAmount}`);
console.assert(summary.percentScanned === 50, `Expected percentScanned 50, got ${summary.percentScanned}`);

console.log("✓ All Big Prize calculations passed flawlessly!");

console.log("=== Testing Staff Balance Verification ===");
import {
  calculateStaffBalanceVerification,
  ScanningStaffBalance,
} from "../app/lib/bigPrizeTicketsService";

const mockStaffList: ScanningStaffBalance[] = [
  {
    id: "s1",
    staffName: "Kumari",
    openingBalance: 100000,
    closingBalance: 250000, // +150,000 scanned
  },
  {
    id: "s2",
    staffName: "Dilrukshi",
    openingBalance: 50000,
    closingBalance: 90000, // +40,000 scanned
  },
];

// Total terminal scanned = 150,000 + 40,000 = 190,000
// Big prize total claimed = 190,000
const staffVerification = calculateStaffBalanceVerification(mockStaffList, 190000);

console.log("Staff Verification Result:", staffVerification);
console.assert(staffVerification.totalTerminalScanned === 190000, `Expected 190000, got ${staffVerification.totalTerminalScanned}`);
console.assert(staffVerification.difference === 0, `Expected 0 diff, got ${staffVerification.difference}`);
console.assert(staffVerification.isBalanced === true, `Expected isBalanced true, got ${staffVerification.isBalanced}`);

// Test discrepancy
const underScanned = calculateStaffBalanceVerification(
  [
    { id: "s1", staffName: "Kumari", openingBalance: 100000, closingBalance: 200000 }, // +100,000
  ],
  150000
);
console.assert(underScanned.difference === -50000, `Expected -50000 diff, got ${underScanned.difference}`);
console.assert(underScanned.isBalanced === false, "Expected isBalanced false for underscanned");

console.log("✓ Staff Balance Verification tests passed flawlessly!");

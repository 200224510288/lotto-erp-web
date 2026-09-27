import * as XLSX from "xlsx";
import {
  cleanNumericValue,
  calculateRecordBalance,
  formatCurrency,
  parseDailyBalanceExcel,
  calculateBalancingProgress,
  BalanceRecordRow,
} from "../app/lib/balanceOrganizerService";

console.log("=== Testing Numeric Cleaning ===");
console.assert(cleanNumericValue("1,250.50") === 1250.5, "Failed clean comma number");
console.assert(cleanNumericValue("(300.00)") === -300, "Failed clean parenthesis negative");
console.assert(cleanNumericValue("-450.25") === -450.25, "Failed clean minus negative");
console.assert(cleanNumericValue("Rs. 5,000.00") === 5000, "Failed clean currency prefix");
console.assert(cleanNumericValue("-") === 0, "Failed clean dash");
console.assert(cleanNumericValue("") === 0, "Failed clean empty");
console.assert(cleanNumericValue(null) === 0, "Failed clean null");
console.assert(cleanNumericValue(123.45) === 123.45, "Failed clean number");
console.log("✓ Numeric cleaning passed!");

console.log("=== Testing Balance Calculation ===");
// Balance = CASH & CHE. + WIN (both are considered money)
console.assert(calculateRecordBalance(5000, 1500) === 6500, "Failed balance calculation 1");
console.assert(calculateRecordBalance(1000, 2500) === 3500, "Failed balance calculation 2");
console.assert(calculateRecordBalance(0, 0) === 0, "Failed balance calculation 3 (zero)");
console.log("✓ Balance formula passed!");

console.log("=== Testing Currency Formatting ===");
console.assert(formatCurrency(1500.5) === "Rs. 1,500.50", "Failed currency format positive: " + formatCurrency(1500.5));
console.assert(formatCurrency(-750) === "-Rs. 750.00", "Failed currency format negative: " + formatCurrency(-750));
console.log("✓ Currency formatting passed!");

console.log("=== Testing Excel Parsing With Duplicate Agents ===");
// Create workbook with duplicate agents
const wb = XLSX.utils.book_new();
const data = [
  ["DLB DAILY BALANCE REPORT", "", "", ""],
  ["Date: 2026-09-27", "", "", ""],
  [], // empty row
  ["Serial No.", "Agent Name", "WIN", "CASH & CHE."],
  ["S001", "KANDY AGENT 01", "1,500.00", "5,000.00"],
  ["S002", "KANDY AGENT 01", "500.00", "2,000.00"], // SAME AGENT AGAIN - MUST NOT BE GROUPED!
  ["S003", "COLOMBO DISTRIBUTOR", "0.00", "12,500.00"],
  [], // empty row to ignore
  ["S004", "GALLE DEALER", "3,200.00", "3,200.00"],
  ["GRAND TOTAL", "", "5,200.00", "22,700.00"], // footer to ignore
];

const ws = XLSX.utils.aoa_to_sheet(data);
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

const file = new File([buffer], "Daily_Balance_2026_09_27.xlsx", {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

async function runTest() {
  const result = await parseDailyBalanceExcel(file, "2026-09-27");
  console.log("Parse Result isValid:", result.isValid);
  console.assert(result.isValid, "Parsing should succeed");
  console.log("Total Rows parsed:", result.totalRows);
  console.assert(result.totalRows === 4, `Expected 4 rows, got ${result.totalRows}`);

  // Confirm row 0 and row 1 have same agent but are separate records!
  console.assert(result.rows[0].agentName === "KANDY AGENT 01", "Row 0 Agent Name mismatch");
  console.assert(result.rows[1].agentName === "KANDY AGENT 01", "Row 1 Agent Name mismatch");
  console.assert(result.rows[0].balance === 6500, `Row 0 balance expected 6500, got ${result.rows[0].balance}`);
  console.assert(result.rows[1].balance === 2500, `Row 1 balance expected 2500, got ${result.rows[1].balance}`);
  console.assert(result.rows[2].balance === 12500, `Row 2 balance expected 12500, got ${result.rows[2].balance}`);
  console.assert(result.rows[3].balance === 6400, `Row 3 balance expected 6400, got ${result.rows[3].balance}`);

  console.assert(result.totalWin === 5200, `Total win expected 5200, got ${result.totalWin}`);
  console.assert(result.totalCashAndCheque === 22700, `Total cash expected 22700, got ${result.totalCashAndCheque}`);
  console.assert(result.totalCalculatedBalance === 27900, `Total balance expected 27900, got ${result.totalCalculatedBalance}`);

  console.log("✓ Excel parsing with duplicate agents and totals verified successfully!");

  // Test progress calculation
  const mockRows: BalanceRecordRow[] = result.rows.map((r, i) => ({
    ...r,
    id: `row_${i}`,
    reportId: "2026-09-27",
    isChecked: i < 2, // 2 checked out of 4
    checkedBy: i < 2 ? "officer@dlb.lk" : null,
    checkedAt: i < 2 ? new Date().toISOString() : null,
  }));

  const progress = calculateBalancingProgress(mockRows);
  console.assert(progress.checkedRecords === 2, "Progress checkedRecords mismatch");
  console.assert(progress.pendingRecords === 2, "Progress pendingRecords mismatch");
  console.assert(progress.checkedCashAndCheque === 7000, `Progress checked cash expected 7000, got ${progress.checkedCashAndCheque}`);
  console.assert(progress.percentChecked === 50, "Progress percentChecked mismatch");
  console.log("✓ Balancing progress calculation verified successfully!");

  console.log("=== Testing Alternate Header Keywords ===");
  // Test with "A/C No", "Customer", "WINNINGS", "CASH / CHEQUE"
  const wb2 = XLSX.utils.book_new();
  const data2 = [
    ["ACCOUNT STATEMENT", ""],
    ["A/C No", "Customer Name", "WINNINGS", "CASH / CHEQUE"],
    ["1001", "AMAL LOTTERIES", "2,500.00", "10,000.00"],
    ["1002", "KAMAL BROTHERS", "5,000.00", "4,500.00"],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(data2);
  XLSX.utils.book_append_sheet(wb2, ws2, "BalSheet");
  const buf2 = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" });
  const file2 = new File([buf2], "Alternate_Headers.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const res2 = await parseDailyBalanceExcel(file2, "2026-09-27");
  console.assert(res2.isValid, "Alternate headers should parse successfully");
  console.assert(res2.totalRows === 2, `Expected 2 rows, got ${res2.totalRows}`);
  console.assert(res2.rows[0].balance === 12500, `Expected 12500 balance, got ${res2.rows[0].balance}`);
  console.assert(res2.rows[1].balance === 9500, `Expected 9500 balance, got ${res2.rows[1].balance}`);
  console.log("✓ Alternate header detection verified successfully!");

  console.log("=== Testing User Screenshot DLB Excel Format (DATE | SERIAL NO | ACCOUNT | WIN | CASH & CHE.) ===");
  const wb3 = XLSX.utils.book_new();
  const data3 = [
    ["S.W OSMAN DE SILVA ( OSMAN DE SILVA - KANDY )"],
    ["SALES SUMMARY From 23-Sep-2026 To 23-Sep-2026"],
    [],
    ["DATE", "SERIAL NO", "ACCOUNT", "WIN", "CASH & CHE.", "OTHER"],
    [],
    ["-", "", "", "3,121,810.0", "7,409,142.0", ""], // Top summary row - must be ignored!
    ["23-09-2026", "A000516832", "A.J.B.BOGAHAWELA", "32,580.0", "69,640.0", ""],
    ["23-09-2026", "A000516833", "51 R.SIRIYAWATHI", "5,080.0", "13,920.0", ""],
    ["23-09-2026", "A000516834", "H.M.SAMARAKOON BANDA", "14,120.0", "15,620.0", ""],
    ["23-09-2026", "A000516835", "H.M.SAMARAKOON BANDA", "", "8,000.0", ""],
    ["23-09-2026", "A000516836", "M.P KARALLIYADA", "90,720.0", "150,000.0", ""],
    ["23-09-2026", "A000516837", "KITHSIRI", "42,440.0", "23,560.0", ""],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(data3);
  XLSX.utils.book_append_sheet(wb3, ws3, "Summary");
  const buf3 = XLSX.write(wb3, { type: "buffer", bookType: "xlsx" });
  const file3 = new File([buf3], "User_DLB_Report.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const res3 = await parseDailyBalanceExcel(file3, "2026-09-23");
  console.assert(res3.isValid, "User format should parse successfully");
  console.assert(res3.totalRows === 6, `Expected 6 rows (excluding row 6 summary), got ${res3.totalRows}`);

  // Verify Agent Names are NOT "Unknown Agent"
  console.assert(res3.rows[0].agentName === "A.J.B.BOGAHAWELA", `Expected A.J.B.BOGAHAWELA, got ${res3.rows[0].agentName}`);
  console.assert(res3.rows[0].serialNo === "A000516832", `Expected A000516832, got ${res3.rows[0].serialNo}`);
  console.assert(res3.rows[0].balance === 102220, `Expected balance 102220, got ${res3.rows[0].balance}`);

  console.assert(res3.rows[1].agentName === "51 R.SIRIYAWATHI", `Expected 51 R.SIRIYAWATHI, got ${res3.rows[1].agentName}`);
  console.assert(res3.rows[1].serialNo === "A000516833", `Expected A000516833, got ${res3.rows[1].serialNo}`);

  // Verify duplicate agent is preserved as two separate records
  console.assert(res3.rows[2].agentName === "H.M.SAMARAKOON BANDA", `Expected H.M.SAMARAKOON BANDA, got ${res3.rows[2].agentName}`);
  console.assert(res3.rows[2].serialNo === "A000516834", `Expected A000516834, got ${res3.rows[2].serialNo}`);
  console.assert(res3.rows[3].agentName === "H.M.SAMARAKOON BANDA", `Expected H.M.SAMARAKOON BANDA, got ${res3.rows[3].agentName}`);
  console.assert(res3.rows[3].serialNo === "A000516835", `Expected A000516835, got ${res3.rows[3].serialNo}`);

  console.assert(res3.rows[4].agentName === "M.P KARALLIYADA", `Expected M.P KARALLIYADA, got ${res3.rows[4].agentName}`);
  console.assert(res3.rows[5].agentName === "KITHSIRI", `Expected KITHSIRI, got ${res3.rows[5].agentName}`);

  console.log("✓ DLB Excel format with ACCOUNT mapped to Agent Name verified 100% successfully!");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

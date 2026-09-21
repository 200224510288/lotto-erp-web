// app/scripts/test_return_preprocess.mts
import * as XLSX from "xlsx";
import {
  ALLOWED_RETURN_CODES,
  INVALID_RETURN_FILENAME_ERROR,
  validateReturnFilename,
  normalizeAgentCode,
  extractReturnDrawNumber,
  calculateReturnQuantity,
  preprocessReturnSheet,
} from "../app/lib/nlbReturnPreprocess";

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string) {
  if (condition) {
    console.log(`✓ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${desc}`);
    failed++;
  }
}

console.log("=== 1. TEST FILENAME VALIDATION ===");

const validCases = [
  "ADE.xls",
  "ADE.xlsx",
  "ade.xls",
  "DNE.xls",
  "GSE.xls",
  "HAE.xls",
  "MPE.xls",
  "MSE.xls",
  "NJE.xls",
  "SDE.xls",
  "MSE return.xls",
  "MSE_return.xls",
  "MSE RETURN.xls",
  "mse return.xls",
  "MSE_RETURN.xls",
  "MSE_RETURN.xlsx",
  "ADE return.xls",
  "GSE_return.xlsx",
  // Legacy shorthands:
  "MSM return.xls",
  "AM.xls",
  "MPM.xls",
];

for (const f of validCases) {
  const res = validateReturnFilename(f);
  assert(res.valid === true && res.code !== null, `Filename "${f}" should be valid (got code=${res.code})`);
}

const invalidCases = [
  "test.xls",
  "ABC.xls",
  "MSE old.xls",
  "MSE sales.xls",
  "MSE.txt",
  "UNKNOWN.xlsx",
];

for (const f of invalidCases) {
  const res = validateReturnFilename(f);
  assert(
    res.valid === false && res.error === INVALID_RETURN_FILENAME_ERROR,
    `Filename "${f}" should be rejected with exact error (got error="${res.error}")`
  );
}

console.log("\n=== 2. TEST AGENT CODE NORMALIZATION ===");

const agentTests = [
  { input: "040064", expected: "N040064" },
  { input: "N040064", expected: "N040064" },
  { input: "040308", expected: "N040308" },
  { input: "NO40444", expected: "N040444" },
  { input: "40064", expected: "N040064" },
  { input: "  040064  ", expected: "N040064" },
  { input: "n040064", expected: "N040064" },
];

for (const t of agentTests) {
  const res = normalizeAgentCode(t.input);
  assert(res.valid && res.normalized === t.expected, `Agent code "${t.input}" -> "${t.expected}" (got ${res.normalized})`);
}

const invalidAgentTests = ["ABC", "123", "N12", "12345678", ""];
for (const raw of invalidAgentTests) {
  const res = normalizeAgentCode(raw);
  assert(!res.valid, `Agent code "${raw}" should be invalid`);
}

console.log("\n=== 3. TEST QUANTITY CALCULATION ===");

const qRes = calculateReturnQuantity("80063170103250", "80063170103359");
assert(qRes.valid && qRes.quantity === 110, `Quantity calculation 80063170103250 -> 80063170103359 = 110 (got ${qRes.quantity})`);

const invQRes = calculateReturnQuantity("80063170103359", "80063170103250");
assert(!invQRes.valid, `TO < FROM correctly fails`);

console.log("\n=== 4. TEST KNOWN REFERENCE REPORT (SECTION 21) ===");

const knownRows = [
  { agent: "040064", from: "80063170103250", to: "80063170103359", qty: 110 },
  { agent: "N040064", from: "80063170103700", to: "80063170103749", qty: 50 },
  { agent: "N040064", from: "80063170104880", to: "80063170104999", qty: 120 },
  { agent: "N040064", from: "80063170105050", to: "80063170105129", qty: 80 },
  { agent: "N040064", from: "80063170105130", to: "80063170105169", qty: 40 },
  { agent: "N040064", from: "80063170106130", to: "80063170106139", qty: 10 },
  { agent: "040308", from: "80063170110690", to: "80063170110699", qty: 10 },
];

const remainingRows: { agent: string; from: string; to: string; qty: number }[] = [];
let baseBarcode = BigInt("80063170120000");
for (let i = 0; i < 14; i++) {
  const from = baseBarcode.toString();
  const to = (baseBarcode + BigInt(49)).toString();
  baseBarcode += BigInt(100);
  remainingRows.push({ agent: `040${400 + i}`, from, to, qty: 50 });
}
// 22nd row: qty 150
remainingRows.push({
  agent: "040500",
  from: baseBarcode.toString(),
  to: (baseBarcode + BigInt(149)).toString(),
  qty: 150,
});

const allTestRows = [...knownRows, ...remainingRows];

const rawSheetData = [
  ["NATIONAL LOTTERIES BOARD"],
  ["AGENT RETURN REPORT - MSM"],
  ["DRAW NO 6317 DRAW DATE 2026-09-21"],
  [],
  ["S/No", "Agent Code", "Agent Name", "From Barcode", "To Barcode", "Return Qty"],
  ...allTestRows.map((r, idx) => [
    idx + 1,
    r.agent,
    `AGENT ${r.agent}`,
    r.from,
    r.to,
    r.qty,
  ]),
  ["", "TOTAL", "", "", "", 1270],
];

const result = preprocessReturnSheet(rawSheetData, "MSM");

assert(result.status === "completed", `Result status is completed`);
assert(result.drawNumber === "6317", `Draw number detected as 6317 (got ${result.drawNumber})`);
assert(result.rowCount === 22, `Row count is exactly 22 (got ${result.rowCount})`);
assert(result.totalReturnQuantity === 1270, `Total return quantity is 1270 (got ${result.totalReturnQuantity})`);
assert(result.rows[0].startingBarcode === "80063170103250", `Row 1 barcode matches`);
assert(result.rows[0].quantity === 110, `Row 1 quantity matches 110`);
assert(result.rows[0].agentCode === "N040064", `Row 1 agent normalized to N040064`);

// Check multiple returns for same agent are preserved separately
const agent040064Rows = result.rows.filter(r => r.agentCode === "N040064");
assert(agent040064Rows.length === 6, `Agent N040064 has 6 separate return rows preserved (got 6)`);

console.log("\n=== 5. TEST GENERATE CLEANED EXCEL WORKBOOK ===");
import { generateReturnCleanedXlsx } from "../app/lib/nlbReturnPreprocess";
const excelBlob = generateReturnCleanedXlsx(result.rows);
const excelBuffer = Buffer.from(await excelBlob.arrayBuffer());
const testWb = XLSX.read(excelBuffer, { type: "buffer" });
const testSheet = testWb.Sheets[testWb.SheetNames[0]];
const testAoa = XLSX.utils.sheet_to_json(testSheet, { header: 1, raw: false }) as any[][];

assert(testAoa[0][0] === "Draw Number", `Header 0 is "Draw Number" (got ${testAoa[0][0]})`);
assert(testAoa[0][1] === "Agent Code", `Header 1 is "Agent Code" (got ${testAoa[0][1]})`);
assert(testAoa[0][2] === "Starting Barcode", `Header 2 is "Starting Barcode" (got ${testAoa[0][2]})`);
assert(testAoa[0][3] === "Quantity", `Header 3 is "Quantity" (got ${testAoa[0][3]})`);
assert(testAoa[0].length === 4, `Header has exactly 4 columns (got ${testAoa[0].length})`);

// Verify data rows count (1 header + 22 rows = 23 rows)
assert(testAoa.length === 23, `Excel sheet has exactly 23 rows (1 header + 22 data rows) (got ${testAoa.length})`);

// Verify row 1 barcode is exact string
assert(testAoa[1][2] === "80063170103250", `Row 1 barcode is exact string (got ${testAoa[1][2]})`);
// Verify no scientific notation
assert(!String(testAoa[1][2]).includes("E") && !String(testAoa[1][2]).includes("e"), `Barcode has no scientific notation`);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);


import { formatNlbAgentCode, applyNlbAgentMapping } from "../app/lib/nlbAgentConfig";
import { preprocessRawSheet, applyNlbAgentMapping as applyPreprocessMapping } from "../app/lib/nlbPreprocess";

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

console.log("=== 1. TEST FORMAT NLB AGENT CODE ===");
assert(formatNlbAgentCode("040064") === "N040064", "040064 -> N040064");
assert(formatNlbAgentCode("N040064") === "N040064", "N040064 -> N040064");
assert(formatNlbAgentCode("n040064") === "N040064", "n040064 -> N040064");
assert(formatNlbAgentCode("40064") === "N040064", "40064 -> N040064");
assert(formatNlbAgentCode("NO40064") === "N040064", "NO40064 -> N040064 (O typo)");

console.log("\n=== 2. TEST APPLY NLB AGENT MAPPING ===");
const testAliases = {
  "N040064": "N012345",
  "N030589": "N099999",
};

assert(applyNlbAgentMapping("040064", testAliases) === "N012345", "040064 maps to N012345");
assert(applyNlbAgentMapping("N040064", testAliases) === "N012345", "N040064 maps to N012345");
assert(applyNlbAgentMapping("n040064", testAliases) === "N012345", "n040064 maps to N012345");
assert(applyNlbAgentMapping("40064", testAliases) === "N012345", "40064 maps to N012345");
assert(applyNlbAgentMapping("N030589", testAliases) === "N099999", "N030589 maps to N099999");
assert(applyNlbAgentMapping("N077777", testAliases) === "N077777", "Unmapped code remains unchanged");
assert(applyPreprocessMapping("N040064", testAliases) === "N012345", "applyPreprocessMapping matches");

console.log("\n=== 3. TEST PREPROCESS RAW SHEET WITH ALIASES ===");
// Mock NLB raw sales sheet data
const mockSheet = [
  ["DRAW NO : 1234"],
  ["AGENT ALLOCATION"],
  ["Agent Code", "From", "To"],
  ["040064", "1000000000001", "1000000000100"],
  ["N077777", "2000000000001", "2000000000050"],
];

const result = preprocessRawSheet(mockSheet, "MSE", testAliases);
assert(result.status === "completed", "Status is completed");
assert(result.rows.length === 2, "2 rows processed");
assert(result.rows[0].agentCode === "N012345", "Row 0 mapped agentCode is N012345 (was 040064)");
assert(result.rows[1].agentCode === "N077777", "Row 1 unmapped agentCode is N077777");

console.log("\n=== 4. TEST SAVED FILE RE-PROCESSING WITH ALIASES ===");
import * as XLSX from "xlsx";

// Simulate an existing saved clean XLSX with old agent codes
const savedCleanAoa = [
  ["Draw Number", "Agent Code", "Starting Barcode", "Quantity"],
  ["1234", "N040064", "80063170103250", 100],
  ["1234", "040064", "80063170103350", 50],
  ["1234", "N077777", "80063170103400", 20],
];
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(savedCleanAoa);
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

// Parse back using our row-mapping logic
const readWb = XLSX.read(buffer, { type: "array" });
const readWs = readWb.Sheets[readWb.SheetNames[0]];
const rawRows = XLSX.utils.sheet_to_json(readWs, { header: 1 }) as any[][];

const reprocessedRows = [];
for (let i = 1; i < rawRows.length; i++) {
  const row = rawRows[i];
  const origAgent = String(row[1]);
  const mappedAgent = applyNlbAgentMapping(origAgent, testAliases);
  reprocessedRows.push({
    drawNumber: String(row[0]),
    agentCode: mappedAgent,
    startingBarcode: String(row[2]),
    quantity: Number(row[3]),
  });
}

assert(reprocessedRows.length === 3, "3 rows reprocessed");
assert(reprocessedRows[0].agentCode === "N012345", "Row 0 (N040064) reprocessed to N012345");
assert(reprocessedRows[1].agentCode === "N012345", "Row 1 (040064) reprocessed to N012345");
assert(reprocessedRows[2].agentCode === "N077777", "Row 2 (N077777) unchanged");

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

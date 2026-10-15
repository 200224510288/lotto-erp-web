import { extractReturnDrawNumber } from "../app/lib/nlbReturnPreprocess";

const tests = [
  { name: 'V1 layout with draw 4', data: [[null, 'DRAW', null, null, ':', null, '4']], expected: '4' },
  { name: 'V1 layout with draw 4 numeric', data: [[null, 'DRAW', null, null, ':', null, 4]], expected: '4' },
  { name: 'Separate cells [DRAW, :, 4]', data: [['DRAW', ':', 4]], expected: '4' },
  { name: 'Separate cells [DRAW :, 4]', data: [['DRAW :', 4]], expected: '4' },
  { name: 'Separate cells [DRAW, 4]', data: [['DRAW', 4]], expected: '4' },
  { name: 'Single cell DRAW : 4', data: [['DRAW : 4']], expected: '4' },
  { name: 'Single cell DRAW          : 4', data: [['DRAW          : 4']], expected: '4' },
  { name: 'Legacy DRAW NO 6317', data: [['DRAW NO 6317 DRAW DATE 2026-09-21']], expected: '6317' },
  { name: 'Title AYUBO RETURN - 4', data: [['AYUBO RETURN REPORT - 4']], expected: '4' },
  { name: 'Title 4 - AYUBO RETURN', data: [['4 - AYUBO RETURN REPORT']], expected: '4' },
  { name: 'DRAW DATE then DRAW 4', data: [['DRAW DATE', '2026-10-15'], ['DRAW', ':', 4]], expected: '4' },
  { name: 'Barcode fallback draw 4', data: [[], [], ['80000040103250']], expected: '4' },
  { name: 'Barcode fallback draw 6317', data: [[], [], ['80063170103250']], expected: '6317' },
];

console.log("=== TESTING DRAW NUMBER EXTRACTION ===");
for (const t of tests) {
  const actual = extractReturnDrawNumber(t.data as any);
  const ok = actual === t.expected;
  console.log((ok ? '✓ PASS' : '✗ FAIL') + ': ' + t.name + ' -> got ' + actual + ' (expected ' + t.expected + ')');
}

console.log("\n=== TESTING FULL AYUBO PREPROCESSING (DRAW 4) ===");
import { validateReturnFilename, preprocessReturnSheet } from "../app/lib/nlbReturnPreprocess";

const fnTest1 = validateReturnFilename("AYUBO return.xls");
console.log((fnTest1.valid && fnTest1.code === "AYE" ? "✓ PASS" : "✗ FAIL") + ': "AYUBO return.xls" -> ' + JSON.stringify(fnTest1));

const fnTest2 = validateReturnFilename("AYUBO.xlsx");
console.log((fnTest2.valid && fnTest2.code === "AYE" ? "✓ PASS" : "✗ FAIL") + ': "AYUBO.xlsx" -> ' + JSON.stringify(fnTest2));

const fnTest3 = validateReturnFilename("AYE return.xlsx");
console.log((fnTest3.valid && fnTest3.code === "AYE" ? "✓ PASS" : "✗ FAIL") + ': "AYE return.xlsx" -> ' + JSON.stringify(fnTest3));

const mockAyuboSheet = [
  ["NATIONAL LOTTERY BOARD"],
  ["NO 234/2 GALEE ROAD, COLOMBO 03."],
  ["DISTRIBUTOR RETURN"],
  [],
  ["TO SALES MANAGER"],
  ["CODE", null, ":", "A119"],
  ["NAME", null, ":", "S.W OSMAN DE SILVA"],
  ["DISTRICT", null, ":", "KANDY"],
  ["TICKET", null, ":", "AYUBO - THU"],
  ["DRAW", null, ":", 4],
  ["RESON", null, ":", "RAIN / AGENT(s) ABSENT"],
  [],
  ["AGENT CODE", "AGENT NAME", "FROM", "TO", "QTY"],
  ["040064", "OSMAN", "86164023100001", "86164023100010", 10],
  ["N040180", "CHANDRASIRI", "86164023100011", "86164023100030", 20],
];

const prepResult = preprocessReturnSheet(mockAyuboSheet as any, "AYE");
console.log("Preprocess result status:", prepResult.status);
console.log("Detected draw number:", prepResult.drawNumber);
console.log("Processed rows:", prepResult.rowCount);
console.log("Total quantity:", prepResult.totalReturnQuantity);
console.log("Errors:", prepResult.errors);

if (prepResult.status === "completed" && prepResult.drawNumber === "4" && prepResult.rowCount === 2) {
  console.log("✓ PASS: Full Ayubo Draw 4 report successfully preprocessed!");
} else {
  console.error("✗ FAIL: Ayubo Draw 4 preprocessing failed!");
  process.exit(1);
}


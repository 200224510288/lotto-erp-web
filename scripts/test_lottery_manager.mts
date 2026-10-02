import {
  DEFAULT_DLB_GAMES,
  compileErpGameMap,
  generateDefaultSchedule,
  saveDlbGame,
  deleteDlbGame,
  loadDlbGames,
} from "../app/lib/dlbGameConfig";
import {
  DEFAULT_NLB_LOTTERIES,
  getActiveNlbCodes,
  getNlbCodeAliases,
  saveNlbLottery,
  deleteNlbLottery,
  loadNlbLotteries,
} from "../app/lib/nlbLotteryConfig";

console.log("=== TESTING LOTTERY CONFIG SERVICES ===");

// 1. DLB schedule generator test
const schedule = generateDefaultSchedule("TEST");
if (schedule.Monday.erp !== "TESTM" || schedule.Monday.official !== "TESTMO") {
  throw new Error("generateDefaultSchedule failed for Monday");
}
if (schedule.Sunday.erp !== "TESTI" || schedule.Sunday.official !== "TESTSU") {
  throw new Error("generateDefaultSchedule failed for Sunday");
}
console.log("✓ PASS: DLB generateDefaultSchedule works correctly.");

// 2. DLB Erp Game Map compilation
const compiled = compileErpGameMap(DEFAULT_DLB_GAMES);
if (compiled.Monday["WM"] !== "WMO") {
  throw new Error("compileErpGameMap missing WM -> WMO for Monday");
}
if (compiled.Tuesday["WA"] !== "WTU") {
  throw new Error("compileErpGameMap missing WA -> WTU for Tuesday");
}
console.log("✓ PASS: DLB compileErpGameMap compiled default games correctly.");

// 3. NLB lotteries active codes test
const nlbCodes = getActiveNlbCodes(DEFAULT_NLB_LOTTERIES);
if (!nlbCodes.includes("MSE") || !nlbCodes.includes("GSE")) {
  throw new Error("getActiveNlbCodes missing default codes");
}
const nlbAliases = getNlbCodeAliases(DEFAULT_NLB_LOTTERIES);
if (nlbAliases["MSM"] !== "MSE") {
  throw new Error("getNlbCodeAliases missing MSM -> MSE");
}
console.log("✓ PASS: NLB getActiveNlbCodes and alias mapping work correctly.");

console.log("ALL LOTTERY CONFIG SERVICE TESTS PASSED! ✓");

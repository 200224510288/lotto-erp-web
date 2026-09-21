// scripts/test_live_api.mts
import * as XLSX from "xlsx";

async function run() {
  console.log("=== TESTING LIVE API ENDPOINT: /api/nlb-return-preprocess ===");

  // 1. Test invalid file name rejection
  {
    const form = new FormData();
    const blob = new Blob(["dummy"], { type: "application/vnd.ms-excel" });
    form.append("file", blob, "MSM sales.xls");

    const res = await fetch("http://localhost:3000/api/nlb-return-preprocess", {
      method: "POST",
      body: form,
    });

    const json = await res.json();
    console.log("Rejection test for MSM sales.xls -> Status:", res.status, "Error:", json.error);
    if (res.status === 400 && json.error.includes("Invalid return filename")) {
      console.log("✓ PASS: MSM sales.xls correctly rejected with 400");
    } else {
      console.error("✗ FAIL: Expected 400 rejection");
      process.exit(1);
    }
  }

  // 2. Test valid return report upload with known reference dataset
  {
    // Build binary workbook
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

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rawSheetData);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const wbBuffer = XLSX.write(wb, { bookType: "xls", type: "buffer" });

    const form = new FormData();
    const blob = new Blob([wbBuffer], { type: "application/vnd.ms-excel" });
    form.append("file", blob, "MSM return.xls");

    const res = await fetch("http://localhost:3000/api/nlb-return-preprocess", {
      method: "POST",
      body: form,
    });

    const data = await res.json();
    console.log("Success test for MSM return.xls -> Status:", res.status, "Data status:", data.status);
    console.log("Draw Number:", data.drawNumber);
    console.log("Row count:", data.rowCount);
    console.log("Total Return Quantity:", data.totalReturnQuantity);

    if (
      res.status === 200 &&
      data.status === "completed" &&
      data.drawNumber === "6317" &&
      data.rowCount === 22 &&
      data.totalReturnQuantity === 1270
    ) {
      console.log("✓ PASS: Live endpoint correctly processed MSM return.xls!");
    } else {
      console.error("✗ FAIL: Live endpoint response didn't match expected values.");
      process.exit(1);
    }
  }

  console.log("\nALL LIVE API TESTS PASSED!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

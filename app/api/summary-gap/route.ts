import * as XLSX from "xlsx";

interface GapRow {
  DealerCode: string;
  Game: string;
  Draw: string;
  Qty: number;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response("No file uploaded", { status: 400 });
    }

    // Read uploaded Summary.xlsx as array buffer
    const arrayBuffer = await file.arrayBuffer();

    // Parse workbook
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];

    // 2D array: rows -> [col0, col1, col2,...]
    const data: (string | number | boolean | null)[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
    });

    // 1) Extract game name row ("ITEM : SUPPER BALL (FRI)")
    let gameName: string | null = null;
    for (const row of data) {
      for (const cell of row) {
        if (typeof cell === "string" && cell.includes("ITEM :")) {
          gameName = cell.replace("ITEM :", "").trim();
          break;
        }
      }
      if (gameName) break;
    }

    if (!gameName) {
      return new Response("Game name (ITEM :) not found in sheet", {
        status: 400,
      });
    }

    // Derive game code: first letter of each ALLCAPS word
    const wordMatches = gameName.match(/[A-Z]+/g) || [];
    const gameCode = wordMatches.map((w) => w[0]).join("");

    // 2) Extract draw date row ("DRAW DATE 2025-12-05")
    let drawDate: string | null = null;
    const dateRegex = /\d{4}-\d{2}-\d{2}/;

    for (const row of data) {
      for (const cell of row) {
        if (typeof cell === "string" && cell.includes("DRAW DATE")) {
          const m = cell.match(dateRegex);
          if (m) {
            drawDate = m[0];
            break;
          }
        }
      }
      if (drawDate) break;
    }

    if (!drawDate) {
      return new Response("Draw date not found in sheet", {
        status: 400,
      });
    }

    // 3) Scan for "#" rows and compute gaps
    const gapRows: GapRow[] = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      // detect "#" anywhere in row start
      const hasHash = row.some(
        (cell) => typeof cell === "string" && cell.trim().startsWith("#")
      );

      if (!hasHash) continue;

      // In your file, structure around "#" row:
      // col2: "#"
      // col3: dealer code (other dealer)
      // col5: start barcode
      // col7: end barcode
      // col8: qty
      const startCell = row[5];

      if (!startCell) continue;
      const startCurrent = parseInt(String(startCell).trim(), 10);
      if (Number.isNaN(startCurrent)) continue;

      // Look upwards for last dealer row with an end barcode in col7
      let lastEnd: number | null = null;
      let lastDealer: string | null = null;

      for (let j = i - 1; j >= 0; j--) {
        const prevRow = data[j];
        if (!prevRow) continue;

        const dealerCell = prevRow[3];
        const endCell = prevRow[7];

        // parse end barcode
        if (endCell !== undefined && endCell !== null && lastEnd === null) {
          const parsedEnd = parseInt(String(endCell).trim(), 10);
          if (!Number.isNaN(parsedEnd)) {
            lastEnd = parsedEnd;
          }
        }

        // capture dealer code
        if (
          typeof dealerCell === "string" &&
          dealerCell.trim().length > 0 &&
          lastDealer === null
        ) {
          lastDealer = dealerCell.trim();
        }

        if (lastEnd !== null && lastDealer !== null) break;
      }

      if (lastEnd === null || lastDealer === null) {
        continue;
      }

      const gap = startCurrent - lastEnd - 1;
      if (gap <= 0) continue;

      // Clean dealer code
      let dealerCode = lastDealer.replace(/\s+/g, "");

      // Pad to 6 digits if it's 5-digit numeric
      if (/^\d+$/.test(dealerCode) && dealerCode.length === 5) {
        dealerCode = "0" + dealerCode;
      }

      gapRows.push({
        DealerCode: dealerCode,
        Game: gameCode,
        Draw: drawDate,
        Qty: gap,
      });
    }

    // Return JSON for now (later we can also output as .xlsx)
    return new Response(JSON.stringify(gapRows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(err);
    return new Response(
      err?.message || "Error processing Summary for gap table",
      { status: 500 }
    );
  }
}

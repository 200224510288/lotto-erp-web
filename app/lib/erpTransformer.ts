// app/lib/erpTransformer.ts

import { MASTER_DEALER_CODE, normalizeDealerCode } from "./dealerConfig";

export type Cell = string | number | null;

export type StructuredRow = {
  DealerCode: string;
  Game: string;
  Draw: string;
  Qty: number;
};

export type BreakingSegment = {
  start: number;
  end: number;
};

// ---------- Helpers ----------

export function toNumber(value: Cell): number | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[^\d-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return Math.trunc(n);
}

// for RAW PREVIEW only
export function renderCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (text.includes("$")) {
    text = text.replace(/[^\d]/g, "");
  }
  return text;
}

export function detectDealerCode(row: Cell[]): string | null {
  // normal numeric 5–6 digit
  for (const cell of row) {
    const n = toNumber(cell);
    if (n === null) continue;
    const s = String(n);
    if (s.length === 5 || s.length === 6) {
      return normalizeDealerCode(s);
    }
  }

  // fallback ??????
  for (const cell of row) {
    if (typeof cell !== "string") continue;
    const trimmed = cell.trim();
    if (trimmed.includes("?")) {
      return MASTER_DEALER_CODE;
    }
  }

  return null;
}

// Barcodes = numbers with length >= 7; smallest is FROM, 2nd smallest is TO
export function detectBarcodes(row: Cell[]): { from: number | null; to: number | null } {
  const nums: number[] = [];
  for (const cell of row) {
    const n = toNumber(cell);
    if (n === null) continue;
    const s = String(n);
    if (s.length >= 7) {
      nums.push(n);
    }
  }
  if (nums.length === 0) return { from: null, to: null };
  nums.sort((a, b) => a - b);
  const from = nums[0];
  const to = nums.length > 1 ? nums[1] : null;
  return { from, to };
}

// row has # anywhere
export function hasHashMarker(row: Cell[]): boolean {
  return row.some(
    (c) => typeof c === "string" && c.trim().includes("#")
  );
}

export function buildBreakingSegments(
  totalFrom: number | null,
  breakSizes: number[]
): BreakingSegment[] {
  if (totalFrom == null) return [];

  const segments: BreakingSegment[] = [];
  let current = totalFrom;

  for (const size of breakSizes) {
    if (!size || size <= 0) continue;
    const start = current;
    const end = current + size - 1;
    segments.push({ start, end });
    current = end + 1;
  }

  return segments;
}

// ---------- Internal types ----------

type DealerInternal = {
  rowIndex: number;
  dealerCode: string;
  fromBarcode: number;
  toBarcode: number;
  qty: number;
};

type InternalRow = {
  rowIndex: number;
  DealerCode: string;
  Game: string;
  Draw: string;
  From: number;
  To: number;
  Qty: number;
};

function splitBySegments(
  dealerCode: string,
  fromBarcode: number,
  toBarcode: number,
  gameName: string,
  drawDate: string,
  baseRowIndex: number,
  segments: BreakingSegment[]
): InternalRow[] {
  // no breaking => keep as single row (no filtering)
  if (!segments.length) {
    return [
      {
        rowIndex: baseRowIndex,
        DealerCode: dealerCode,
        Game: gameName,
        Draw: drawDate,
        From: fromBarcode,
        To: toBarcode,
        Qty: toBarcode - fromBarcode + 1,
      },
    ];
  }

  const rows: InternalRow[] = [];

  segments.forEach((seg, segIndex) => {
    const start = Math.max(fromBarcode, seg.start);
    const end = Math.min(toBarcode, seg.end);
    if (start <= end) {
      rows.push({
        rowIndex: baseRowIndex + segIndex * 0.001,
        DealerCode: dealerCode,
        Game: gameName,
        Draw: drawDate,
        From: start,
        To: end,
        Qty: end - start + 1,
      });
    }
  });

  // segments exist but no overlap => filter this dealer completely
  if (!rows.length) {
    return [];
  }

  return rows;
}

// ---------- Core transformer ----------

export function buildStructuredRows(
  data: Cell[][],
  breakingSegments: BreakingSegment[] = [],
  gameNameOverride?: string
): StructuredRow[] {
  // 1) Game name: use override if provided, else detect from "ITEM :" row
  let gameName: string | null = null;

  if (gameNameOverride && gameNameOverride.trim().length > 0) {
    gameName = gameNameOverride.trim();
  } else {
    outerGame: for (const row of data) {
      for (const cell of row) {
        if (typeof cell === "string" && cell.includes("ITEM :")) {
          gameName = cell.replace("ITEM :", "").trim();
          break outerGame;
        }
      }
    }
  }

  const gameDisplay = gameName ?? "";

  // 2) Draw date (DRAW DATE 2025-12-05)
  let drawDate: string | null = null;
  const dateRegex = /\d{4}-\d{2}-\d{2}/;
  outerDate: for (const row of data) {
    for (const cell of row) {
      if (typeof cell === "string" && cell.includes("DRAW DATE")) {
        const m = cell.match(dateRegex);
        if (m) {
          drawDate = m[0];
          break outerDate;
        }
      }
    }
  }

  const dealerRows: DealerInternal[] = [];
  const rows: InternalRow[] = [];

  // 3) Dealer rows (main ranges)
  for (let i = 0; i < data.length; i++) {
    const row = data[i];

    const dealerCode = detectDealerCode(row);
    const { from, to } = detectBarcodes(row);

    if (!dealerCode || from === null || to === null) continue;

    const qty = to - from + 1;
    if (qty <= 0) continue;

    dealerRows.push({
      rowIndex: i,
      dealerCode,
      fromBarcode: from,
      toBarcode: to,
      qty,
    });

    const splitted = splitBySegments(
      dealerCode,
      from,
      to,
      gameDisplay,
      drawDate ?? "",
      i,
      breakingSegments
    );

    rows.push(...splitted);
  }

  // 4) Gap rows (# markers)
  for (let i = 0; i < data.length; i++) {
    const row = data[i];

    if (!hasHashMarker(row)) continue;

    const { from: startCurrent } = detectBarcodes(row);
    if (startCurrent === null) continue;

    // previous dealer above this row
    const prevDealer = [...dealerRows]
      .filter((d) => d.rowIndex < i)
      .sort((a, b) => b.rowIndex - a.rowIndex)[0];

    if (!prevDealer) continue;

    const gap = startCurrent - prevDealer.toBarcode - 1;
    if (gap <= 0) continue;

    const gapFrom = prevDealer.toBarcode + 1;
    const gapTo = startCurrent - 1;

    const splittedGap = splitBySegments(
      prevDealer.dealerCode,
      gapFrom,
      gapTo,
      gameDisplay,
      drawDate ?? "",
      i - 0.1,
      breakingSegments
    );

    rows.push(...splittedGap);
  }

  // 5) Sort by row index and clean
  rows.sort((a, b) => a.rowIndex - b.rowIndex);

  return rows.map((r) => ({
    DealerCode: r.DealerCode,
    Game: r.Game,
    Draw: r.Draw,
    Qty: r.Qty,
  }));
}

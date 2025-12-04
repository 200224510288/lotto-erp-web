// lib/erpTransformer.ts
import {
  getDealerAliases,
  getMasterDealerCode,
} from "./dealerConfig";

// -------------------------------------------------------------
// Cached dealer config
// -------------------------------------------------------------
let cachedMaster: string | null = null;
let cachedAliases: Record<string, string> | null = null;

async function loadDealerConfig() {
  if (!cachedMaster) cachedMaster = await getMasterDealerCode();
  if (!cachedAliases) cachedAliases = await getDealerAliases();
}

// Normalize a dealer code using dynamic DB mapping
export async function normalizeDealerCodeDynamic(input: string): Promise<string> {
  await loadDealerConfig();
  const code = input.padStart(6, "0");
  return cachedAliases?.[code] ?? code;
}

// -------------------------------------------------------------
// Types
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------
export function toNumber(value: Cell): number | null {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^\d-]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : Math.trunc(num);
}

export function renderCell(v: Cell): string {
  if (v == null) return "";
  return String(v).replace(/[^\d]/g, "");
}

// -------------------------------------------------------------
// Detection helpers
// -------------------------------------------------------------
export async function detectDealerCode(row: Cell[]): Promise<string | null> {
  for (const cell of row) {
    const n = toNumber(cell);
    if (n != null) {
      const s = n.toString();
      if (s.length === 5 || s.length === 6) {
        return normalizeDealerCodeDynamic(s);
      }
    }
  }

  for (const cell of row) {
    if (typeof cell === "string" && cell.includes("?")) {
      await loadDealerConfig();
      return cachedMaster;
    }
  }

  return null;
}

export function detectBarcodes(row: Cell[]) {
  const nums: number[] = [];

  for (const c of row) {
    const n = toNumber(c);
    if (n != null && String(n).length >= 7) nums.push(n);
  }

  nums.sort((a, b) => a - b);

  return {
    from: nums[0] ?? null,
    to: nums[1] ?? null,
  };
}

export function hasHashMarker(row: Cell[]): boolean {
  return row.some((c) => typeof c === "string" && c.includes("#"));
}

// -------------------------------------------------------------
// Breaking logic
// -------------------------------------------------------------
export function buildBreakingSegments(
  totalFrom: number | null,
  breakSizes: number[]
): BreakingSegment[] {
  if (totalFrom == null) return [];
  const segments: BreakingSegment[] = [];
  let cur = totalFrom;

  for (const size of breakSizes) {
    if (size > 0) {
      const start = cur;
      const end = cur + size - 1;
      segments.push({ start, end });
      cur = end + 1;
    }
  }

  return segments;
}

// -------------------------------------------------------------
// Internal structures
// -------------------------------------------------------------
type InternalRow = {
  rowIndex: number;
  DealerCode: string;
  Game: string;
  Draw: string;
  Qty: number;
  From: number;
  To: number;
};

// -------------------------------------------------------------
// Splitting logic → guaranteed array
// -------------------------------------------------------------
function splitBySegments(
  dealerCode: string,
  fromBarcode: number,
  toBarcode: number,
  gameName: string,
  drawDate: string,
  baseIndex: number,
  segments: BreakingSegment[]
): InternalRow[] {

  segments = Array.isArray(segments) ? segments : [];

  if (segments.length === 0) {
    return [
      {
        rowIndex: baseIndex,
        DealerCode: dealerCode,
        Game: gameName,
        Draw: drawDate,
        From: fromBarcode,
        To: toBarcode,
        Qty: toBarcode - fromBarcode + 1,
      },
    ];
  }

  const out: InternalRow[] = [];

  segments.forEach((seg, idx) => {
    const start = Math.max(fromBarcode, seg.start);
    const end = Math.min(toBarcode, seg.end);

    if (start <= end) {
      out.push({
        rowIndex: baseIndex + idx * 0.001,
        DealerCode: dealerCode,
        Game: gameName,
        Draw: drawDate,
        From: start,
        To: end,
        Qty: end - start + 1,
      });
    }
  });

  return out;
}

// -------------------------------------------------------------
// MAIN builder (safe, no spread errors)
// -------------------------------------------------------------
export async function buildStructuredRows(
  data: Cell[][],
  breakingSegments: BreakingSegment[] = [],
  gameNameOverride?: string
): Promise<StructuredRow[]> {

  await loadDealerConfig();

  breakingSegments = Array.isArray(breakingSegments) ? breakingSegments : [];

  // Game detection
  let gameName: string = gameNameOverride?.trim() || "";

  if (!gameName) {
    for (const row of data) {
      for (const cell of row) {
        if (
          typeof cell === "string" &&
          cell.includes("ITEM :")
        ) {
          gameName = cell.replace("ITEM :", "").trim();
          break;
        }
      }
      if (gameName) break;
    }
  }

  // Draw date
  let drawDate = "";
  const dateRe = /\d{4}-\d{2}-\d{2}/;

  for (const row of data) {
    for (const cell of row) {
      if (typeof cell === "string" && cell.includes("DRAW DATE")) {
        const m = cell.match(dateRe);
        if (m) drawDate = m[0];
      }
    }
  }

  const dealerRows: { rowIndex: number; dealerCode: string; toBarcode: number }[] = [];
  const out: InternalRow[] = [];

  // MAIN dealer rows
  for (let i = 0; i < data.length; i++) {
    const row = data[i];

    const dealer = await detectDealerCode(row);
    if (!dealer) continue;

    const { from, to } = detectBarcodes(row);
    if (from == null || to == null) continue;

    dealerRows.push({ rowIndex: i, dealerCode: dealer, toBarcode: to });

    const split = splitBySegments(dealer, from, to, gameName, drawDate, i, breakingSegments);
    if (Array.isArray(split)) out.push(...split);
  }

  // GAP rows
  for (let i = 0; i < data.length; i++) {
    const row = data[i];

    if (!hasHashMarker(row)) continue;

    const { from: nextStart } = detectBarcodes(row);
    if (nextStart == null) continue;

    const prev = dealerRows
      .filter((d) => d.rowIndex < i)
      .sort((a, b) => b.rowIndex - a.rowIndex)[0];

    if (!prev) continue;

    const gapQty = nextStart - prev.toBarcode - 1;
    if (gapQty <= 0) continue;

    const gapFrom = prev.toBarcode + 1;
    const gapTo = nextStart - 1;

    const split = splitBySegments(prev.dealerCode, gapFrom, gapTo, gameName, drawDate, i - 0.1, breakingSegments);

    if (Array.isArray(split)) out.push(...split);
  }

  out.sort((a, b) => a.rowIndex - b.rowIndex);

  return out.map((r) => ({
    DealerCode: r.DealerCode,
    Game: r.Game,
    Draw: r.Draw,
    Qty: r.Qty,
  }));
}

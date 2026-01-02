// lib/erpTransformer.ts
import { getDealerAliases, getMasterDealerCode } from "./dealerConfig";

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

// INTERNAL ROW (used for validations & correctness)
export type StructuredRowInternal = {
  DealerCode: string;
  Game: string;
  Draw: string;
  From: number;
  To: number; // internal only (required for overlaps, split correctness)
  Qty: number;
};

// VIEW ROW (what you show/export) — NO "To"
export type StructuredRow = {
  DealerCode: string;
  Game: string;
  Draw: string;
  From: number;
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
// Trim helper (remove first N digits)
// -------------------------------------------------------------
export function trimBarcodeNumber(n: number, trimDigits: number): number | null {
  const t = Math.max(0, Math.trunc(trimDigits || 0));
  const s = String(Math.trunc(n));

  if (t === 0) return Math.trunc(n);
  if (s.length <= t) return null;

  const cut = s.slice(t); // remove first N digits
  const cleaned = cut.replace(/^0+/, ""); // drop leading zeros

  if (!cleaned) return 0;
  const out = Number(cleaned);

  return Number.isNaN(out) ? null : Math.trunc(out);
}

// -------------------------------------------------------------
// Detection helpers
// -------------------------------------------------------------
export async function detectDealerCode(row: Cell[]): Promise<string | null> {
  // Normal dealer codes (5 or 6 digits)
  for (const cell of row) {
    const n = toNumber(cell);
    if (n != null) {
      const s = n.toString();
      if (s.length === 5 || s.length === 6) {
        return normalizeDealerCodeDynamic(s);
      }
    }
  }

  // Special "?????" → master dealer
  for (const cell of row) {
    if (typeof cell === "string" && cell.includes("?")) {
      await loadDealerConfig();
      return cachedMaster;
    }
  }

  return null;
}

export function detectBarcodes(row: Cell[], trimDigits: number = 0) {
  const nums: number[] = [];

  for (const c of row) {
    const n = toNumber(c);

    // only barcode-like values
    if (n != null && String(n).length >= 7) {
      const trimmed = trimBarcodeNumber(n, trimDigits);
      if (trimmed != null) nums.push(trimmed);
    }
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
// Breaking logic (still available if needed elsewhere)
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
// segments here represent "allowed / available" ranges
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

  // No segments → keep full range as-is
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
// MAIN builder (with optional MASTER gap handling)
// breakingSegments here = "available stock blocks" for this file
// trimDigits applies to ERP barcode detection + gaps
// (segments should already be trimmed by UI before passing in)
// -------------------------------------------------------------
export async function buildStructuredRows(
  data: Cell[][],
  breakingSegments: BreakingSegment[] = [],
  gameNameOverride?: string,
  gapFillEnabled: boolean = true,
  drawDateOverride?: string | null,
  trimDigits: number = 0
): Promise<StructuredRowInternal[]> {
  await loadDealerConfig();
  breakingSegments = Array.isArray(breakingSegments) ? breakingSegments : [];

  // ---------------- Game detection ----------------
  let gameName: string = gameNameOverride?.trim() || "";

  if (!gameName) {
    for (const row of data) {
      for (const cell of row) {
        if (typeof cell === "string" && cell.includes("ITEM :")) {
          gameName = cell.replace("ITEM :", "").trim();
          break;
        }
      }
      if (gameName) break;
    }
  }

  // ---------------- Draw date detection ----------------
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

  const finalDrawDate =
    (drawDateOverride && drawDateOverride.trim()) ||
    (drawDate && drawDate.trim()) ||
    "";

  const dealerRows: { rowIndex: number; dealerCode: string; toBarcode: number }[] = [];
  const out: InternalRow[] = [];

  // ---------------- MAIN dealer rows ----------------
  for (let i = 0; i < data.length; i++) {
    const row = data[i];

    const dealer = await detectDealerCode(row);
    if (!dealer) continue;

    const { from, to } = detectBarcodes(row, trimDigits);
    if (from == null || to == null) continue;

    dealerRows.push({ rowIndex: i, dealerCode: dealer, toBarcode: to });

    const split = splitBySegments(
      dealer,
      from,
      to,
      gameName,
      finalDrawDate,
      i,
      breakingSegments
    );

    if (Array.isArray(split)) out.push(...split);
  }

  // ---------------- GAP rows (#) → MASTER (optional) ----------------
  const masterDealer = (cachedMaster || "030520").padStart(6, "0");

  if (gapFillEnabled) {
    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      // Only rows that contain "#"
      if (!hasHashMarker(row)) continue;

      const { from: nextStart } = detectBarcodes(row, trimDigits);
      if (nextStart == null) continue;

      // Find previous dealer line above this gap marker
      const prev = dealerRows
        .filter((d) => d.rowIndex < i)
        .sort((a, b) => b.rowIndex - a.rowIndex)[0];

      if (!prev) continue;

      const gapFrom = prev.toBarcode + 1;
      const gapTo = nextStart - 1;
      const gapQty = gapTo - gapFrom + 1;

      if (gapQty <= 0) continue;

      console.log(
        `[ERP] GAP detected → MASTER ${masterDealer} : ${gapFrom} → ${gapTo} (qty=${gapQty})`
      );

      const split = splitBySegments(
        masterDealer,
        gapFrom,
        gapTo,
        gameName,
        finalDrawDate,
        i - 0.1,
        breakingSegments
      );

      if (Array.isArray(split)) out.push(...split);
    }
  }

  // ---------------- Final sort & projection ----------------
  out.sort((a, b) => a.rowIndex - b.rowIndex);

  return out.map((r) => ({
    DealerCode: r.DealerCode,
    Game: r.Game,
    Draw: r.Draw,
    From: r.From,
    To: r.To,
    Qty: r.Qty,
  }));
}

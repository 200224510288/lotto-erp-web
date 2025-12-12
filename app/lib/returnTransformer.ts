import { getDealerAliases, getMasterDealerCode } from "./dealerConfig";

/* =============================================================
   TYPES
   ============================================================= */

export type Cell = string | number | null;

export type ReturnRow = {
  DealerCode: string; // normalized 6-digit agent code
  Game: string;
  Draw: string;
  Qty: number;
  From: string; // barcode as TEXT (final normalized 7 digits)
};

/**
 * V1 existing items (exclusion list)
 * You can provide either:
 *  - From + To  (recommended)
 *  - From + Qty (To will be derived)
 *
 * IMPORTANT: Use the SAME 7-digit barcode style (last 7 digits),
 * or pass 9-digit and we will take last 7 automatically.
 */
export type V1ExistingRow = {
  DealerCode: string; // "30539" or "030539" (any; we normalize to 6 digits)
  Game?: string;      // optional: if you want strict match
  Draw?: string;      // optional: if you want strict match
  From: string;       // 7-digit or 9-digit (we normalize to last 7)
  To?: string;        // 7-digit or 9-digit (we normalize to last 7)
  Qty?: number;       // optional if To is provided
};

/* =============================================================
   CACHED DEALER CONFIG
   ============================================================= */

let cachedMaster: string | null = null;
let cachedAliases: Record<string, string> | null = null;

async function loadDealerConfig() {
  if (!cachedMaster) cachedMaster = await getMasterDealerCode();
  if (!cachedAliases) cachedAliases = await getDealerAliases();
}

export async function normalizeDealerCodeDynamic(input: string): Promise<string> {
  await loadDealerConfig();
  const code = input.padStart(6, "0");
  return cachedAliases?.[code] ?? code;
}

/* =============================================================
   BASIC HELPERS
   ============================================================= */

/**
 * Convert any Excel cell into a DIGITS-ONLY STRING
 * - Handles numbers
 * - Handles scientific notation
 * - Never pads or trims here
 */
function toDigitsString(value: Cell): string {
  if (value == null) return "";

  if (typeof value === "number") {
    return String(Math.trunc(value));
  }

  const raw = String(value).trim();
  if (!raw) return "";

  // Scientific notation like "3.50801165E8"
  if (/e/i.test(raw)) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return String(Math.trunc(n));
  }

  return raw.replace(/[^\d]/g, "");
}

export function isEmptyRow(row: Cell[]): boolean {
  return row.every((c) => {
    if (c == null) return true;
    return String(c).trim() === "";
  });
}

function rowContainsTotal(row: Cell[]): boolean {
  return row.some((c) => typeof c === "string" && c.toUpperCase().includes("TOTAL"));
}

/* =============================================================
   BARCODE NORMALIZATION (FLEXIBLE)
   ============================================================= */

/**
 * Always returns 7-digit barcode string.
 *
 * Rule:
 *  - If barcode has >= 7 digits -> take LAST 7 digits
 *  - If barcode has < 7 digits -> prepend defaultPrefix (2 digits), then take last 7
 */
function normalizeBarcodeTo7(value: Cell, defaultPrefix2: string): string {
  const digits = toDigitsString(value);
  if (!digits) return "";

  const prefix = (defaultPrefix2 || "").replace(/[^\d]/g, "").slice(0, 2);

  if (digits.length >= 7) {
    return digits.slice(-7);
  }

  const combined = `${prefix}${digits}`;
  return combined.padStart(7, "0").slice(-7);
}

function normalizeBarcodeStringTo7(value: string): string {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.length >= 7 ? digits.slice(-7) : digits.padStart(7, "0");
}

/* =============================================================
   ROW DETECTION
   ============================================================= */

async function detectDealerCode(row: Cell[]): Promise<string | null> {
  for (const cell of row) {
    const digits = toDigitsString(cell);
    if (digits.length === 5 || digits.length === 6) {
      return normalizeDealerCodeDynamic(digits);
    }
  }
  return null;
}

function detectFromAndQty(row: Cell[]): { fromCell: Cell | null; qty: number | null } {
  let fromCell: Cell | null = null;

  // First barcode-like value (>=7 digits)
  for (const cell of row) {
    const digits = toDigitsString(cell);
    if (digits.length >= 7) {
      fromCell = cell;
      break;
    }
  }

  // Qty = last small number (<=5 digits)
  let qty: number | null = null;
  for (let i = row.length - 1; i >= 0; i--) {
    const digits = toDigitsString(row[i]);
    if (digits.length > 0 && digits.length <= 5) {
      const n = Number(digits);
      if (!Number.isNaN(n)) {
        qty = n;
        break;
      }
    }
  }

  return { fromCell, qty };
}

/* =============================================================
   PARSE SINGLE RETURN ROW
   ============================================================= */

async function parseReturnRow(
  row: Cell[],
  gameName: string,
  draw: string,
  defaultPrefix2: string
): Promise<ReturnRow | null> {
  if (isEmptyRow(row)) return null;
  if (rowContainsTotal(row)) return null;

  const dealer = await detectDealerCode(row);
  if (!dealer) return null;

  const { fromCell, qty } = detectFromAndQty(row);
  if (!fromCell || qty == null) return null;

  return {
    DealerCode: dealer,
    Game: gameName,
    Draw: draw,
    Qty: qty,
    From: normalizeBarcodeTo7(fromCell, defaultPrefix2),
  };
}

/* =============================================================
   RENDER (PREVIEW)
   ============================================================= */

export function renderCell(v: Cell): string {
  if (v == null) return "";
  return String(v);
}

/* =============================================================
   V1 EXCLUSION LOGIC (SUBTRACT RANGES)
   ============================================================= */

type NumRange = { from: number; to: number }; // inclusive

function pad7(n: number): string {
  return String(n).padStart(7, "0");
}

function overlaps(a: NumRange, b: NumRange): boolean {
  return !(b.to < a.from || b.from > a.to);
}

/**
 * Subtract exclude ranges from a base range (inclusive).
 * Returns remaining segments (possibly empty).
 */
function subtractRanges(base: NumRange, excludes: NumRange[]): NumRange[] {
  const ex = excludes
    .filter((e) => overlaps(base, e))
    .sort((a, b) => a.from - b.from);

  let remaining: NumRange[] = [base];

  for (const e of ex) {
    const next: NumRange[] = [];

    for (const r of remaining) {
      if (!overlaps(r, e)) {
        next.push(r);
        continue;
      }

      // left remainder
      if (e.from > r.from) next.push({ from: r.from, to: e.from - 1 });

      // right remainder
      if (e.to < r.to) next.push({ from: e.to + 1, to: r.to });
    }

    remaining = next;
    if (remaining.length === 0) break;
  }

  return remaining;
}

function keyFor(row: { DealerCode: string; Game?: string; Draw?: string }, strict: boolean): string {
  const dealer6 = String(row.DealerCode ?? "").replace(/[^\d]/g, "").padStart(6, "0");
  if (!strict) return dealer6;
  return `${dealer6}__${(row.Game ?? "").trim()}__${(row.Draw ?? "").trim()}`;
}

/**
 * Apply V1 exclusion to parsed ReturnRow[].
 * - Removes rows fully contained in V1
 * - Splits rows on partial overlaps
 */
function applyV1Exclusion(
  rows: ReturnRow[],
  v1: V1ExistingRow[],
  strictMatchGameDraw: boolean
): ReturnRow[] {
  if (!v1 || v1.length === 0) return rows;

  // Build exclude index
  const idx = new Map<string, NumRange[]>();

  for (const r of v1) {
    const dealer6 = String(r.DealerCode ?? "").replace(/[^\d]/g, "").padStart(6, "0");
    const from7 = normalizeBarcodeStringTo7(r.From);
    if (!from7) continue;

    const fromN = Number(from7);
    if (!Number.isFinite(fromN)) continue;

    let toN: number | null = null;

    if (r.To) {
      const to7 = normalizeBarcodeStringTo7(r.To);
      const n = Number(to7);
      if (Number.isFinite(n)) toN = n;
    } else if (typeof r.Qty === "number" && r.Qty > 0) {
      toN = fromN + (r.Qty - 1);
    }

    if (toN == null) continue;

    const norm: NumRange = fromN <= toN ? { from: fromN, to: toN } : { from: toN, to: fromN };

    const k = strictMatchGameDraw
      ? `${dealer6}__${(r.Game ?? "").trim()}__${(r.Draw ?? "").trim()}`
      : dealer6;

    const arr = idx.get(k) ?? [];
    arr.push(norm);
    idx.set(k, arr);
  }

  for (const [k, arr] of idx) {
    arr.sort((a, b) => a.from - b.from);
    idx.set(k, arr);
  }

  // Subtract for each parsed row
  const out: ReturnRow[] = [];

  for (const row of rows) {
    const k = keyFor(row, strictMatchGameDraw);
    const excludes = idx.get(k) ?? [];

    if (!row.From || !row.Qty || row.Qty <= 0) continue;

    const fromN = Number(row.From);
    const toN = fromN + (row.Qty - 1);

    const base: NumRange = { from: fromN, to: toN };
    const leftovers = subtractRanges(base, excludes);

    // If fully covered -> nothing added (this is what you asked)
    for (const seg of leftovers) {
      const qty = seg.to - seg.from + 1;
      if (qty <= 0) continue;

      out.push({
        DealerCode: row.DealerCode,
        Game: row.Game,
        Draw: row.Draw,
        Qty: qty,
        From: pad7(seg.from),
      });
    }
  }

  return out;
}

/* =============================================================
   PUBLIC API
   ============================================================= */

export async function buildReturnRows(
  data: Cell[][],
  gameName: string,
  draw: string,
  defaultPrefix2: string,
  v1Existing: V1ExistingRow[] = [],
  opts?: { strictMatchGameDraw?: boolean }
): Promise<ReturnRow[]> {
  await loadDealerConfig();

  const parsed: ReturnRow[] = [];

  for (const row of data) {
    const r = await parseReturnRow(row, gameName, draw, defaultPrefix2);
    if (r) parsed.push(r);
  }

  // IMPORTANT: Remove anything that already exists in V1
  const strict = !!opts?.strictMatchGameDraw;
  const finalRows = applyV1Exclusion(parsed, v1Existing, strict);

  return finalRows;
}

// app/return-analysis/page.tsx
"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Printer,
  Download,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Settings,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search,
  Eye,
  SlidersHorizontal,
  Calendar,
  Layers,
  Sparkles,
  Cloud,
  Check,
  CheckSquare,
  Square,
} from "lucide-react";

import { listUploadedFilesByDate, listUploadedFilesByDateRange, UploadedFileRecord } from "../lib/uploadService";
import { listReturnUploadedFilesByDate, listReturnUploadedFilesByDateRange, ReturnUploadedFileRecord } from "../lib/returnUploadService";
import { isSpecialTenPercentLottery, getGameSafeReturnLimit } from "../lib/gameAutoSelect";
import {
  loadReturnThresholds,
  saveReturnThresholds,
  ReturnThresholdConfig,
  findLotteryInfo,
} from "../lib/returnThresholdConfig";

export const ERP_GAME_MAP: Record<string, Record<string, string>> = {
  Monday: { LWM: "LMO", AKM: "AMO", SFM: "SFM", SBM: "SBM", KTM: "KPM", SPM: "SRM", VM: "DMO", SM: "JMO", WM: "WMO" },
  Tuesday: { LWA: "LWT", AKA: "ATU", SFA: "SFT", SBA: "BTU", KTT: "KPT", SPA: "SRT", VA: "DTU", SA: "JST", WA: "WTU" },
  Wednesday: { LWW: "LWW", AKW: "AWD", SFW: "SFW", SBW: "SBW", KTW: "KPW", SPW: "SWD", VW: "DWD", SW: "JSW", WW: "WWD" },
  Thursday: { LWB: "LTH", AKT: "ATH", SFT: "SFH", SBT: "SBT", KTB: "KTH", SPT: "STH", VT: "DTH", ST: "JTH", WT: "WTH" },
  Friday: { LWF: "LWF", AKF: "AFR", SFF: "SFR", SBF: "SBF", KTF: "KPF", SPF: "SRF", VF: "DFI", SF: "JFR", WF: "WFR" },
  Saturday: { LWS: "LSA", AKS: "ASA", SFS: "SFS", SBS: "SBS", KTS: "KSA", SPS: "SRS", VS: "DSA", SS: "JSA", WS: "WSA" },
  Sunday: { LWI: "LWS", AKI: "ASU", SFI: "SFU", SBI: "SSU", KTI: "KPS", SPI: "SRU", VI: "DSU", SI: "JSU", WI: "WSU" },
};

export const OFFICIAL_SINHALA_LOTTERIES = [
  "අද කෝටිපති",
  "කප්රුක",
  "ලග්න",
  "සසිරි",
  "ශනිදා",
  "සුපර් බෝල්",
  "සුපිරි ධන සම්පත",
  "ජය සම්පත",
  "වාසි",
];

export function toOfficialSinhalaLotteryName(lotteryOrGame: string): string | null {
  if (!lotteryOrGame) return null;
  const lot = findLotteryInfo(lotteryOrGame);
  if (lot) {
    switch (lot.id) {
      case "ada_kotipathi": return "අද කෝටිපති";
      case "kapruka": return "කප්රුක";
      case "lagna_wasana": return "ලග්න";
      case "sasiri": return "සසිරි";
      case "shanida": return "ශනිදා";
      case "super_ball": return "සුපර් බෝල්";
      case "supiri_dhana": return "සුපිරි ධන සම්පත";
      case "jaya_sampatha": return "ජය සම්පත";
      case "wasi": return "වාසි";
      default: return lot.sinhalaName || null;
    }
  }
  const upper = lotteryOrGame.trim().toUpperCase();
  if (/ADA|KOTIPATHI|AKS|ASA|AMO|AFR|ATH|AWD|ATU/i.test(upper)) return "අද කෝටිපති";
  if (/KAPRUKA|KTS|KSA|KPM|KPF|KTH|KPW|KPT/i.test(upper)) return "කප්රුක";
  if (/LAGNA|LWS|LSA|LMO|LWF|LTH|LWW|LWT/i.test(upper)) return "ලග්න";
  if (/SASIRI|JAYODA|JSA|SS|JMO|JST|JSW|JTH|JFR|JSU/i.test(upper)) return "සසිරි";
  if (/SHANIDA|SFS|SFM|SFT|SFH|SFR|SFU|SFA|SFW|SFF/i.test(upper)) return "ශනිදා";
  if (/SUPER|SBS|SBM|BTU|SBW|SBT|SBF|SSU|SBA|SBI/i.test(upper)) return "සුපර් බෝල්";
  if (/SUPIRI|DEVELOPMENT|SPS|SRS|SRM|SRT|SWD|STH|SRF|SRU|SPM|SPA|SPW|SPT|SPF|SPI/i.test(upper)) return "සුපිරි ධන සම්පත";
  if (/JAYA|DHANA\s*NIDHANAYA|VS|DSA|DMO|DTU|DWD|DTH|DFI|DSU|VM|VA|VW|VT|VF|VI/i.test(upper)) return "ජය සම්පත";
  if (/WASI|VASI|WS|WSA|WMO|WTU|WWD|WTH|WFR|WSU|WM|WA|WW|WT|WF|WI/i.test(upper)) return "වාසි";
  return null;
}

export function extractFileReturnQuantity(cells: (string | number | boolean | null)[][]): number {
  if (!cells || cells.length === 0) return 0;

  // 1. Search for explicit TOTAL / GRAND TOTAL row
  for (let i = cells.length - 1; i >= 0; i--) {
    const row = cells[i];
    if (!row) continue;
    const isTotalRow = row.some((c) => {
      const s = String(c ?? "").trim().toUpperCase();
      return s === "TOTAL" || s === "GRAND TOTAL" || s.startsWith("TOTAL ") || s.includes("GRAND TOTAL");
    });
    if (isTotalRow) {
      for (let j = row.length - 1; j >= 0; j--) {
        const val = Number(String(row[j] ?? "").replace(/,/g, "").trim());
        if (Number.isFinite(val) && val > 0) {
          return val;
        }
      }
    }
  }

  // 2. Search for DRAW NO header line that carries total quantity
  for (let i = 0; i < Math.min(cells.length, 10); i++) {
    const row = cells[i];
    if (!row) continue;
    const hasDrawHeader = row.some((c) => String(c ?? "").toUpperCase().includes("DRAW NO"));
    if (hasDrawHeader) {
      for (let j = row.length - 1; j >= 0; j--) {
        const val = Number(String(row[j] ?? "").replace(/,/g, "").trim());
        if (Number.isFinite(val) && val > 0) {
          return val;
        }
      }
    }
  }

  // 3. Fallback: sum of all agent return rows (any row with 5-6 digit dealer code and numeric qty)
  let sum = 0;
  for (const row of cells) {
    if (!row || row.length === 0) continue;
    if (row.some((c) => String(c ?? "").toUpperCase().includes("TOTAL"))) continue;

    const hasDealer = row.some((c) => {
      const digits = String(c ?? "").replace(/\D/g, "");
      return digits.length === 5 || digits.length === 6;
    });
    if (!hasDealer) continue;

    for (let j = row.length - 1; j >= 0; j--) {
      const s = String(row[j] ?? "").replace(/,/g, "").trim();
      const n = Number(s);
      if (Number.isFinite(n) && n > 0 && n <= 100000 && /^\d+$/.test(s)) {
        sum += n;
        break;
      }
    }
  }
  return sum;
}

type SaleRow = { agentCode: string; qty: number; agentName?: string };
type ReturnRow = { agentCode: string; qty: number };

type AgentResultRow = {
  rank: number;
  agentCode: string;
  agentName?: string;
  salesQty: number;
  returnQty: number;
  actualSales: number;
  returnPct: number;
};

function normalizeAgentCode(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 4 && digits.length <= 6) return digits.padStart(6, "0");
  if (digits.length === 0) return s;
  return digits;
}

function toNumber(v: unknown): number {
  const n = Number(String(v ?? "").toString().replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function isLikelyHeaderCell(v: unknown): boolean {
  const s = String(v ?? "").toUpperCase();
  return (
    s.includes("AGENT") ||
    s.includes("CODE") ||
    s.includes("NAME") ||
    s.includes("QTY") ||
    s.includes("FROM") ||
    s.includes("TO") ||
    s.includes("TOTAL") ||
    s.includes("SUMMARY") ||
    s.includes("LOTTERY") ||
    s.includes("BOARD")
  );
}

async function readSheet2D(file: File): Promise<(string | number | boolean | null)[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const wsName = wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as (string | number | boolean | null)[][];
}

function parseSales(data2d: (string | number | boolean | null)[][]): SaleRow[] {
  const rows: SaleRow[] = [];
  for (const r of data2d) {
    if (!r || r.length === 0) continue;
    const c0 = r[0];
    const c1 = r[1];
    const c4 = r[4];
    if (isLikelyHeaderCell(c0) || isLikelyHeaderCell(c1)) continue;
    const agentCode = normalizeAgentCode(c0);
    const agentName = String(c1 ?? "").trim();
    const qty = toNumber(c4);
    if (!agentCode) continue;
    if (!qty || qty <= 0) continue;
    const upper = agentCode.toUpperCase();
    if (upper === "NAME" || upper === "TOTAL") continue;
    rows.push({ agentCode, qty, agentName: agentName || undefined });
  }
  return rows;
}

function parseReturns(data2d: (string | number | boolean | null)[][]): ReturnRow[] {
  const rows: ReturnRow[] = [];
  for (const r of data2d) {
    if (!r || r.length === 0) continue;
    const c1 = r[1];
    const c8 = r[8];
    if (isLikelyHeaderCell(c1)) continue;
    const agentCode = normalizeAgentCode(c1);
    const qty = toNumber(c8);
    if (!agentCode) continue;
    if (!qty || qty <= 0) continue;
    const upper = agentCode.toUpperCase();
    if (upper === "NAME" || upper === "TOTAL") continue;
    rows.push({ agentCode, qty });
  }
  return rows;
}

export const DISTRICT_SINHALA_MAP: Record<string, string> = {
  KANDY: "මහනුවර",
  COLOMBO: "කොළඹ",
  GALLE: "ගාල්ල",
  KURUNEGALA: "කුරුණෑගල",
  MATARA: "මාතර",
  GAMPAHA: "ගම්පහ",
  KALUTARA: "කළුතර",
  KEGALLE: "කෑගල්ල",
  RATNAPURA: "රත්නපුර",
  BADULLA: "බදුල්ල",
  ANURADHAPURA: "අනුරාධපුර",
  POLONNARUWA: "පොළොන්නරුව",
  JAFFNA: "යාපනය",
  TRINCOMALEE: "ත්‍රිකුණාමලය",
  BATTICALOA: "මඩකලපුව",
  AMPARA: "අම්පාර",
  PUTTALAM: "පුත්තලම",
  "NUWARA ELIYA": "නුවරඑළිය",
  MONARAGALA: "මොනරාගල",
  MATALE: "මාතලේ",
  HAMBANTOTA: "හම්බන්තොට",
  VAWUNIYA: "වවුනියාව",
  MANNAR: "මන්නාරම",
  KILINOCHCHI: "කිලිනොච්චිය",
  MULLAITIVU: "මුලතිව්",
};

export function toSinhalaDistrict(dist: string): string {
  if (!dist) return "මහනුවර";
  const clean = dist.trim().toUpperCase();
  return DISTRICT_SINHALA_MAP[clean] || dist;
}

export function toSinhalaAgentName(name: string, code?: string): string {
  if (!name && code === "030409") return "එස් ඩබ් ඕ සිල්වා";
  const upper = (name || "").trim().toUpperCase();
  if (upper.includes("OSMAN DE SILVA") || upper.includes("OSMAN") || code === "030409") {
    return "එස් ඩබ් ඕ සිල්වා";
  }
  return name || "එස් ඩබ් ඕ සිල්වා";
}

export function toSinhalaReason(rawReason: string): string {
  if (!rawReason) return "";
  const upper = rawReason.trim().toUpperCase();
  if (upper.includes("RAIN") || upper.includes("ABSENT")) {
    return "අයහපත් කාලගුණය (වැසි) / අලෙවි නියෝජිතයින් නොපැමිණීම";
  }
  return rawReason;
}

/**
 * Detects which of the 9 official lotteries a return file or record corresponds to.
 */
export function detectLotteryFromMetadata(meta: {
  gameName?: string;
  gameId?: string;
  fileName?: string;
  sheetData?: (string | number | boolean | null)[][];
}): string | null {
  const direct = toOfficialSinhalaLotteryName(meta.gameId || meta.gameName || meta.fileName || "");
  if (direct) return direct;

  const candidates: string[] = [];
  if (meta.gameName) candidates.push(meta.gameName);
  if (meta.gameId) candidates.push(meta.gameId);
  if (meta.fileName) candidates.push(meta.fileName);

  if (meta.sheetData && meta.sheetData.length > 0) {
    const topRows = meta.sheetData.slice(0, 25);
    for (const r of topRows) {
      if (!r) continue;
      const joined = r.map((c) => String(c ?? "").trim()).join(" ");
      if (joined) candidates.push(joined);
    }
  }

  const combined = candidates.join(" ").toUpperCase();

  // 1. Full name / Sinhala name check (ordered deliberately)
  if (/JAYA[\s_\-]+SAMPATH/i.test(combined) || combined.includes("ජය සම්පත")) return "ජය සම්පත";
  if (/SUPIRI[\s_\-]+DHANA|DHANA[\s_\-]+SAMPATH|DEVELOPMENT[\s_\-]+FORTUNE/i.test(combined) || combined.includes("සුපිරි ධන සම්පත")) return "සුපිරි ධන සම්පත";
  if (/ADA[\s_\-]+KOTIP[AH]?THI|KOTIPATHI|KOTIPTHI/i.test(combined) || combined.includes("අද කෝටිපති")) return "අද කෝටිපති";
  if (/KOTI[\s_\-]+KAPRUKA|KAPRUKA/i.test(combined) || combined.includes("කප්රුක")) return "කප්රුක";
  if (/LAGNA[\s_\-]+WASANA|LAGNA[\s_\-]+VASANA|\bLAGNA\b/i.test(combined) || combined.includes("ලග්න")) return "ලග්න";
  if (/SHANIDA[\s_\-]+FORTUNE|\bSHANIDA\b/i.test(combined) || combined.includes("ශනිදා")) return "ශනිදා";
  if (/SUPER[\s_\-]*BALL/i.test(combined) || combined.includes("සුපර් බෝල්")) return "සුපර් බෝල්";
  if (/SASIRI|\bJAYODA\b/i.test(combined) || combined.includes("සසිරි") || combined.includes("ජයෝදා")) return "සසිරි";
  if (/DHANA[\s_\-]+NIDHANAYA|DHANA[\s_\-]+NIDANA|\bWASI\b|\bVASI\b/i.test(combined) || combined.includes("වාසි") || combined.includes("ධන නිධානය")) return "වාසි";

  // 2. Exact word / code token matching (to avoid matching substring inside English words like COLOMBO)
  const hasToken = (pattern: string) =>
    new RegExp(`(?:^|[^A-Z])(${pattern})(?:[^A-Z]|$)`, "i").test(combined);

  if (hasToken("AMO|ATU|AWD|ATH|AFR|ASA|ASU|AKM|AKA|AKW|AKT|AKF|AKS|AKI")) return "අද කෝටිපති";
  if (hasToken("KPM|KPT|KPW|KTH|KPF|KSA|KPS|KTM|KTT|KTW|KTB|KTF|KTS|KTI")) return "කප්රුක";
  if (hasToken("LMO|LWT|LWW|LTH|LWF|LSA|LWS|LWM|LWA|LWW|LWB|LWF|LWS|LWI")) return "ලග්න";
  if (hasToken("SFM|SFT|SFH|SFR|SFS|SFU|SFA|SFW|SFF")) return "ශනිදා";
  if (hasToken("SBM|BTU|SBW|SBT|SBF|SBS|SSU|SBA|SBI")) return "සුපර් බෝල්";
  if (hasToken("SRM|SRT|SWD|STH|SRF|SRS|SRU|SPM|SPA|SPW|SPT|SPF|SPS|SPI")) return "සුපිරි ධන සම්පත";
  if (hasToken("JS|JSM")) return "ජය සම්පත";
  if (hasToken("JMO|JST|JSW|JTH|JFR|JSA|JSU|SM|SA|SW|ST|SF|SS|SI")) return "සසිරි";
  if (hasToken("DMO|DTU|DWD|DTH|DFI|DSA|DSU|WMO|WTU|WWD|WTH|WFR|WSA|WSU|VM|VA|VW|VT|VF|VS|VI|WM|WA|WW|WT|WF|WS|WI")) return "වාසි";

  return null;
}

export type DetailedReturnParseResult = {
  lottery: string | null;
  distributorCode: string | null;
  distributorName: string | null;
  district: string | null;
  reason: string | null;
  totalQty: number;
  agentReturns: { agentCode: string; qty: number; agentName?: string }[];
};

export function parseReturnSheetDetailed(
  data2d: (string | number | boolean | null)[][],
  fileMeta?: { fileName?: string; gameId?: string; gameName?: string }
): DetailedReturnParseResult {
  const lottery = detectLotteryFromMetadata({
    ...fileMeta,
    sheetData: data2d,
  });

  let distributorCode: string | null = null;
  let distributorName: string | null = null;
  let district: string | null = null;
  let reason: string | null = null;
  let detectedTotal: number = 0;

  // 1. Inspect Header Rows (first 25 rows) for distributor metadata
  for (let r = 0; r < Math.min(25, data2d.length); r++) {
    const row = data2d[r];
    if (!row) continue;
    const rowStr = row.map((c) => String(c ?? "").trim()).join(" ");

    // Look for cells like ['CODE', ':', '030409']
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? "").trim().toUpperCase();
      if ((cell === "CODE" || cell === "DEALER CODE" || cell === "DISTRIBUTOR CODE") && c + 1 < row.length) {
        for (let k = c + 1; k < row.length; k++) {
          const val = String(row[k] ?? "").trim().replace(/[^\d]/g, "");
          if (val.length >= 4 && val.length <= 6) {
            distributorCode = val.padStart(6, "0");
            break;
          }
        }
      }
      if ((cell === "NAME" || cell === "DISTRIBUTOR") && c + 1 < row.length) {
        for (let k = c + 1; k < row.length; k++) {
          const val = String(row[k] ?? "").trim();
          if (val && val !== ":" && val !== "-" && val.toUpperCase() !== "FROM") {
            distributorName = val;
            break;
          }
        }
      }
      if (cell === "DISTRICT" && c + 1 < row.length) {
        for (let k = c + 1; k < row.length; k++) {
          const val = String(row[k] ?? "").trim();
          if (val && val !== ":" && val !== "-") {
            district = val;
            break;
          }
        }
      }
      if ((cell === "RESON" || cell === "REASON") && c + 1 < row.length) {
        for (let k = c + 1; k < row.length; k++) {
          const val = String(row[k] ?? "").trim();
          if (val && val !== ":" && val !== "-") {
            reason = val;
            break;
          }
        }
      }
    }

    // Pattern matching e.g. "S.W OSMAN DE SILVA(030409) KANDY"
    const nameCodeMatch = rowStr.match(/([A-Za-z\s.]+)\((\d{4,6})\)\s*([A-Za-z\s]+)?/i);
    if (nameCodeMatch) {
      if (!distributorName) distributorName = nameCodeMatch[1].trim();
      if (!distributorCode) distributorCode = nameCodeMatch[2].padStart(6, "0");
      if (nameCodeMatch[3] && !district) district = nameCodeMatch[3].trim();
    }
  }

  // 2. Identify Column Layout for Agents and Quantities
  let headerRowIdx = -1;
  let agentColIdx = 1;
  let qtyColIdx = 8;
  let nameColIdx = -1;

  for (let r = 0; r < Math.min(30, data2d.length); r++) {
    const row = data2d[r];
    if (!row) continue;
    let foundAgent = -1;
    let foundQty = -1;
    let foundName = -1;

    for (let c = 0; c < row.length; c++) {
      const txt = String(row[c] ?? "").trim().toUpperCase();
      if (txt === "AGENT CODE" || txt === "AGENTCODE" || txt === "AGENT NO" || txt === "DEALER") {
        foundAgent = c;
      }
      if (txt === "NAME" || txt === "AGENT NAME") {
        foundName = c;
      }
      if (txt === "QTY" || txt.startsWith("QTY")) {
        foundQty = c;
      }
    }

    if (foundAgent !== -1 && foundQty !== -1) {
      headerRowIdx = r;
      agentColIdx = foundAgent;
      qtyColIdx = foundQty;
      if (foundName !== -1) nameColIdx = foundName;
      break;
    }
  }

  // 3. Extract Rows
  const agentReturns: { agentCode: string; qty: number; agentName?: string }[] = [];
  let calculatedSum = 0;
  const startRow = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;

  for (let r = startRow; r < data2d.length; r++) {
    const row = data2d[r];
    if (!row || row.length === 0) continue;

    // Detect Total Row
    const isTotal = row.some((c) => String(c ?? "").trim().toUpperCase() === "TOTAL");
    if (isTotal) {
      for (let c = row.length - 1; c >= 0; c--) {
        const n = toNumber(row[c]);
        if (n > 0) {
          detectedTotal = n;
          break;
        }
      }
      continue;
    }

    const cAgent = row[agentColIdx];
    const cQty = row[qtyColIdx];
    const cName = nameColIdx !== -1 ? row[nameColIdx] : undefined;

    if (isLikelyHeaderCell(cAgent)) continue;

    const agentCode = normalizeAgentCode(cAgent);
    const qty = toNumber(cQty);

    if (!agentCode || qty <= 0) continue;
    const upper = agentCode.toUpperCase();
    if (upper === "NAME" || upper === "TOTAL" || upper === "CODE") continue;

    agentReturns.push({
      agentCode,
      qty,
      agentName: cName ? String(cName).trim() : undefined,
    });
    calculatedSum += qty;
  }

  const finalTotal = detectedTotal > 0 ? detectedTotal : calculatedSum;

  return {
    lottery,
    distributorCode,
    distributorName,
    district,
    reason,
    totalQty: finalTotal,
    agentReturns,
  };
}

function formatDateYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeekRange(dateStr: string): { start: string; end: string } {
  if (!dateStr) return { start: "", end: "" };
  const parts = dateStr.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: formatDateYYYYMMDD(monday),
    end: formatDateYYYYMMDD(sunday),
  };
}

function getMonthRange(dateStr: string): { start: string; end: string } {
  if (!dateStr) return { start: "", end: "" };
  const parts = dateStr.split("-").map(Number);
  const year = parts[0];
  const monthIdx = parts[1] - 1;
  const firstDay = new Date(year, monthIdx, 1);
  const lastDay = new Date(year, monthIdx + 1, 0);
  return {
    start: formatDateYYYYMMDD(firstDay),
    end: formatDateYYYYMMDD(lastDay),
  };
}

function getSinhalaDateParts(isoDateStr: string) {
  if (!isoDateStr) return { year: "2026", month: "....................", day: "............." };
  const parts = isoDateStr.split("-");
  if (parts.length < 3) return { year: "2026", month: "....................", day: "............." };
  const y = parts[0];
  const mNum = parseInt(parts[1], 10);
  const d = parts[2];
  const sinhalaMonths = [
    "ජනවාරි", "පෙබරවාරි", "මාර්තු", "අප්‍රේල්", "මැයි", "ජූනි",
    "ජූලි", "අගෝස්තු", "සැප්තැම්බර්", "ඔක්තෝබර්", "නොවැම්බර්", "දෙසැම්බර්"
  ];
  const month = sinhalaMonths[mNum - 1] || "....................";
  return { year: y, month, day: d };
}

function downloadAllAsExcel(
  filename: string,
  meta: { date: string; mode: string; dateRange: string },
  rows: AgentResultRow[],
  totals: {
    uniqueAgents: number;
    totalSalesQty: number;
    totalReturnQty: number;
    overallReturnPct: number;
  }
) {
  const wb = XLSX.utils.book_new();
  const headerMeta = [
    ["Report Mode", meta.mode.toUpperCase()],
    ["Base Date", meta.date],
    ["Date Range", meta.dateRange],
    ["Unique Agents", totals.uniqueAgents],
    ["Total Sales Qty", totals.totalSalesQty],
    ["Total Return Qty", totals.totalReturnQty],
    ["Overall Return %", Number(totals.overallReturnPct.toFixed(2))],
    [],
  ];
  const exportRows = rows.map((r) => ({
    Rank: r.rank,
    AgentCode: r.agentCode,
    AgentName: r.agentName ?? "",
    SalesQty: r.salesQty,
    ReturnQty: r.returnQty,
    ActualSales: r.actualSales,
    ReturnPct: Number(r.returnPct.toFixed(2)),
  }));
  const ws = XLSX.utils.aoa_to_sheet(headerMeta);
  XLSX.utils.sheet_add_json(ws, exportRows, { origin: "A9" });
  XLSX.utils.book_append_sheet(wb, ws, "Agent Returns Summary");
  XLSX.writeFile(wb, filename);
}

function downloadAllAsPdf(
  filename: string,
  meta: { date: string; mode: string; dateRange: string },
  rows: AgentResultRow[],
  totals: {
    uniqueAgents: number;
    totalSalesQty: number;
    totalReturnQty: number;
    overallReturnPct: number;
  }
) {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const marginX = 14;
  let y = 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Lottery Sales vs Returns Report", marginX, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Report Mode: ${meta.mode.toUpperCase()}    Range: ${meta.dateRange}`, marginX, y);
  y += 8;
  doc.setDrawColor(220);
  doc.setFillColor(245, 246, 248);
  doc.roundedRect(marginX, y, 182, 18, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Overall Summary", marginX + 4, y + 6);
  doc.setFont("helvetica", "normal");
  doc.text(`Total Sales Qty: ${totals.totalSalesQty}`, marginX + 4, y + 12);
  doc.text(`Total Return Qty: ${totals.totalReturnQty}`, marginX + 70, y + 12);
  doc.text(`Overall Return %: ${totals.overallReturnPct.toFixed(2)}%`, marginX + 140, y + 12);
  y += 26;
  autoTable(doc, {
    startY: y,
    head: [["Rank", "Agent Code", "Agent Name", "Sales Qty", "Return Qty", "Actual Sales", "Return %"]],
    body: rows.map((r) => [
      r.rank,
      r.agentCode,
      r.agentName ?? "",
      r.salesQty,
      r.returnQty,
      r.actualSales,
      `${r.returnPct.toFixed(2)}%`,
    ]),
    styles: { font: "helvetica", fontSize: 9, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 246, 248] },
    margin: { left: marginX, right: marginX },
  });
  doc.save(filename);
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function ReturnAnalysisPage() {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("date");
      if (q) return q;
      const cached = localStorage.getItem("dlb_selected_date");
      if (cached) return cached;
    }
    return todayKey();
  });
  const [reportMode, setReportMode] = useState<"daily" | "weekly" | "monthly">("daily");
  const [returnThreshold, setReturnThreshold] = useState<number>(5);
  const [isSavingThresholdCloud, setIsSavingThresholdCloud] = useState<boolean>(false);
  const [thresholdCloudSuccess, setThresholdCloudSuccess] = useState<boolean>(false);

  // Sync date from URL search params on mount or change
  useEffect(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("date");
      if (q && q !== selectedDate) {
        setSelectedDate(q);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && selectedDate) {
      localStorage.setItem("dlb_selected_date", selectedDate);
    }
  }, [selectedDate]);

  // Load cloud-saved threshold on mount & listen for updates
  useEffect(() => {
    let mounted = true;
    loadReturnThresholds()
      .then((cfg) => {
        if (mounted && typeof cfg.defaultThreshold === "number" && cfg.defaultThreshold > 0) {
          setReturnThreshold(cfg.defaultThreshold);
        }
      })
      .catch((err) => console.warn("Failed loading cloud thresholds in return-analysis:", err));

    const handleThresholdUpdate = (e: Event) => {
      const detail = (e as CustomEvent<ReturnThresholdConfig>).detail;
      if (detail && mounted && typeof detail.defaultThreshold === "number") {
        setReturnThreshold(detail.defaultThreshold);
      }
    };
    window.addEventListener("dlb-thresholds-updated", handleThresholdUpdate);

    return () => {
      mounted = false;
      window.removeEventListener("dlb-thresholds-updated", handleThresholdUpdate);
    };
  }, []);

  async function handleThresholdChange(val: number) {
    setReturnThreshold(val);
    if (val > 0) {
      setIsSavingThresholdCloud(true);
      setThresholdCloudSuccess(false);
      try {
        await saveReturnThresholds({ defaultThreshold: val });
        setThresholdCloudSuccess(true);
        setTimeout(() => setThresholdCloudSuccess(false), 2500);
      } catch (err) {
        console.warn("Could not save threshold to cloud:", err);
      } finally {
        setIsSavingThresholdCloud(false);
      }
    }
  }

  const [showOnlyExceeded, setShowOnlyExceeded] = useState<boolean>(false);
  const [downloadFormat, setDownloadFormat] = useState<"excel" | "pdf">("excel");

  // Multi uploads
  const [salesFiles, setSalesFiles] = useState<File[]>([]);
  const [returnFiles, setReturnFiles] = useState<File[]>([]);

  // Results & status
  const [allAgentResults, setAllAgentResults] = useState<AgentResultRow[]>([]);
  const [excludedAgents, setExcludedAgents] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  // Database files state
  const [dbErpFiles, setDbErpFiles] = useState<UploadedFileRecord[]>([]);
  const [dbReturnFiles, setDbReturnFiles] = useState<ReturnUploadedFileRecord[]>([]);
  const [isLoadingDbFiles, setIsLoadingDbFiles] = useState<boolean>(false);
  const [isFetchingSaved, setIsFetchingSaved] = useState<boolean>(false);

  // Active / Selected Agent for Letter Preview
  const [selectedAgent, setSelectedAgent] = useState<AgentResultRow | null>(null);
  const [isDownloadingLetter, setIsDownloadingLetter] = useState<boolean>(false);
  const [showLetterSettings, setShowLetterSettings] = useState<boolean>(false);

  // Customizable Letter Metadata
  const [letterAgentName, setLetterAgentName] = useState<string>("එස් ඩබ් ඕ සිල්වා");
  const [letterAgentCode, setLetterAgentCode] = useState<string>("030409");
  const [letterAddressLine1, setLetterAddressLine1] = useState<string>("අංක 204,");
  const [letterAddressLine2, setLetterAddressLine2] = useState<string>("මධ්‍යම වෙළඳපොල,");
  const [letterDistrict, setLetterDistrict] = useState<string>("මහනුවර");
  const [letterOfficerName, setLetterOfficerName] = useState<string>("රුමේෂ් බණ්ඩාර");
  const [letterReason, setLetterReason] = useState<string>("");
  const [lotteryBookQtys, setLotteryBookQtys] = useState<Record<string, string>>({
    "අද කෝටිපති": "",
    "කප්රුක": "",
    "ලග්න": "",
    "සසිරි": "",
    "ශනිදා": "",
    "සුපර් බෝල්": "",
    "සුපිරි ධන සම්පත": "",
    "ජය සම්පත": "",
    "වාසි": "",
  });

  // State for fetched returns by lottery
  const [lotteryReturnsByAgent, setLotteryReturnsByAgent] = useState<Record<string, Record<string, number>>>({});
  const [dateLotteryTotals, setDateLotteryTotals] = useState<Record<string, number>>({});
  const [isFetchingDateReturns, setIsFetchingDateReturns] = useState<boolean>(false);
  const [returnsLoadedDate, setReturnsLoadedDate] = useState<string | null>(null);
  const [letterViewTarget, setLetterViewTarget] = useState<"agent" | "office">("agent");
  const [quantityUnit, setQuantityUnit] = useState<"tickets" | "books">("tickets");

  // 2 Previews State: 1. Notice Letter (District Distributor Total) | 2. Agent Return Proof Annexure
  const [activePreviewTab, setActivePreviewTab] = useState<"notice" | "proof">("notice");
  const [proofSelectedAgents, setProofSelectedAgents] = useState<Set<string>>(new Set());
  const [printBundle, setPrintBundle] = useState<boolean>(false);
  const [annexureTitle, setAnnexureTitle] = useState<string>(
    "අනුමත 5% සීමාව ඉක්මවා ආපසු එවුම් සිදුකළ අලෙවි නියෝජිතයන්ගේ සාක්ෂි ලේඛනය"
  );

  const previewSheetRef = useRef<HTMLDivElement>(null);
  const proofSheetRef = useRef<HTMLDivElement>(null);

  const activeDateRange = useMemo(() => {
    if (!selectedDate) return { start: "", end: "" };
    if (reportMode === "daily") {
      return { start: selectedDate, end: selectedDate };
    } else if (reportMode === "weekly") {
      return getWeekRange(selectedDate);
    } else {
      return getMonthRange(selectedDate);
    }
  }, [selectedDate, reportMode]);

  const sinhalaDate = useMemo(() => getSinhalaDateParts(selectedDate), [selectedDate]);

  const filteredResults = useMemo(() => {
    let list = allAgentResults.filter((r) => !excludedAgents.has(r.agentCode));
    if (showOnlyExceeded) {
      list = list.filter((r) => r.returnPct >= returnThreshold);
    }
    list.sort((a, b) => b.returnPct - a.returnPct);
    return list.map((r, idx) => ({
      ...r,
      rank: idx + 1,
    }));
  }, [allAgentResults, excludedAgents, showOnlyExceeded, returnThreshold]);

  const overallTotals = useMemo(() => {
    let totalSalesQty = 0;
    let totalReturnQty = 0;
    for (const r of filteredResults) {
      totalSalesQty += r.salesQty;
      totalReturnQty += r.returnQty;
    }
    const overallReturnPct = totalSalesQty > 0 ? (totalReturnQty / totalSalesQty) * 100 : 0;
    return {
      uniqueAgents: filteredResults.length,
      totalSalesQty,
      totalReturnQty,
      overallReturnPct,
    };
  }, [filteredResults]);

  // Proof Annexure: compute list of checked agents and their totals
  const proofListRows = useMemo(() => {
    return allAgentResults
      .filter((r) => proofSelectedAgents.has(r.agentCode))
      .sort((a, b) => b.returnPct - a.returnPct)
      .map((r, idx) => ({
        ...r,
        rank: idx + 1,
      }));
  }, [allAgentResults, proofSelectedAgents]);

  const proofTotals = useMemo(() => {
    let sales = 0;
    let returns = 0;
    for (const r of proofListRows) {
      sales += r.salesQty;
      returns += r.returnQty;
    }
    const pct = sales > 0 ? (returns / sales) * 100 : 0;
    return {
      count: proofListRows.length,
      sales,
      returns,
      returnPct: pct,
    };
  }, [proofListRows]);

  // Auto-initialize Proof selection with all agents exceeding return threshold (> 5%)
  useEffect(() => {
    if (allAgentResults.length > 0) {
      const highReturns = new Set(
        allAgentResults
          .filter((r) => r.returnPct >= returnThreshold)
          .map((r) => r.agentCode)
      );
      setProofSelectedAgents(highReturns);
    }
  }, [allAgentResults, returnThreshold]);

  // Helper to sync letter table cells from totalsMap (strictly in returned books)
  function syncLetterQtys(totalsMap: Record<string, number>) {
    const newQtys: Record<string, string> = {};
    for (const lot of OFFICIAL_SINHALA_LOTTERIES) {
      const rawVal = totalsMap[lot];
      if (typeof rawVal === "number" && rawVal > 0) {
        newQtys[lot] = rawVal.toString();
      } else {
        newQtys[lot] = "";
      }
    }
    setLotteryBookQtys(newQtys);
  }

  // Selecting an agent row toggles proof inclusion and highlights the row, WITHOUT mutating the District Notice!
  function handleSelectAgent(agent: AgentResultRow) {
    setSelectedAgent(agent);
    handleToggleProofAgent(agent.agentCode);
  }

  function handleToggleProofAgent(agentCode: string) {
    setProofSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentCode)) {
        next.delete(agentCode);
      } else {
        next.add(agentCode);
      }
      return next;
    });
  }

  function handleSelectAllProofAgents() {
    setProofSelectedAgents(new Set(filteredResults.map((r) => r.agentCode)));
  }

  function handleSelectExceededProofAgents() {
    setProofSelectedAgents(
      new Set(allAgentResults.filter((r) => r.returnPct >= returnThreshold).map((r) => r.agentCode))
    );
  }

  function handleClearProofAgents() {
    setProofSelectedAgents(new Set());
  }

  function handleSelectOfficeTotal() {
    // legacy stub
  }

  function handleToggleUnit(_unit: "tickets" | "books") {
    // legacy stub
  }

  // Filter saved files so we only include days that have both ERP and Return uploads
  const { activeErpFiles, activeReturnFiles, activeDates } = useMemo(() => {
    if (reportMode === "daily") {
      return {
        activeErpFiles: dbErpFiles,
        activeReturnFiles: dbReturnFiles,
        activeDates: new Set(selectedDate ? [selectedDate] : []),
      };
    }
    const erpDates = new Set(dbErpFiles.map((f) => f.uploadDate));
    const returnDates = new Set(dbReturnFiles.map((f) => f.uploadDate));
    const intersection = new Set([...erpDates].filter((d) => returnDates.has(d)));
    return {
      activeErpFiles: dbErpFiles.filter((f) => intersection.has(f.uploadDate)),
      activeReturnFiles: dbReturnFiles.filter((f) => intersection.has(f.uploadDate)),
      activeDates: intersection,
    };
  }, [dbErpFiles, dbReturnFiles, reportMode, selectedDate]);

  async function processReturnFilesDetailed(
    files: File[],
    records?: ReturnUploadedFileRecord[]
  ) {
    const nextAgentMap: Record<string, Record<string, number>> = {};
    const nextTotals: Record<string, number> = {};
    let matchedDistributorCode: string | null = null;
    let matchedDistributorName: string | null = null;
    let matchedDistrict: string | null = null;
    let matchedReason: string | null = null;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rec = records?.[i];
      const d = await readSheet2D(f);
      const parsed = parseReturnSheetDetailed(d, {
        fileName: f.name,
        gameId: rec?.gameId || (f as any).gameId,
        gameName: rec?.gameName || (f as any).gameName,
      });

      const lot = toOfficialSinhalaLotteryName(
        rec?.gameId || rec?.gameName || rec?.fileName || f.name || parsed.lottery || ""
      );

      const fileReturnQty =
        typeof rec?.returnQty === "number" && rec.returnQty > 0
          ? rec.returnQty
          : parsed.totalQty > 0
          ? parsed.totalQty
          : extractFileReturnQuantity(d);

      if (lot && OFFICIAL_SINHALA_LOTTERIES.includes(lot)) {
        // Add to date totals
        nextTotals[lot] = (nextTotals[lot] || 0) + fileReturnQty;

        // If file had a distributor code in the header
        if (parsed.distributorCode) {
          matchedDistributorCode = parsed.distributorCode;
          if (!nextAgentMap[parsed.distributorCode]) {
            nextAgentMap[parsed.distributorCode] = {};
          }
          nextAgentMap[parsed.distributorCode][lot] =
            (nextAgentMap[parsed.distributorCode][lot] || 0) + fileReturnQty;
        }

        if (parsed.distributorName) matchedDistributorName = parsed.distributorName;
        if (parsed.district) matchedDistrict = parsed.district;
        if (parsed.reason) matchedReason = parsed.reason;

        // Add subagent rows
        for (const row of parsed.agentReturns) {
          if (!nextAgentMap[row.agentCode]) {
            nextAgentMap[row.agentCode] = {};
          }
          nextAgentMap[row.agentCode][lot] =
            (nextAgentMap[row.agentCode][lot] || 0) + row.qty;
        }
      }
    }

    setLotteryReturnsByAgent(nextAgentMap);
    setDateLotteryTotals(nextTotals);

    if (matchedDistributorName) {
      setLetterAgentName(toSinhalaAgentName(matchedDistributorName, matchedDistributorCode || undefined));
    }
    if (matchedDistributorCode) {
      setLetterAgentCode(matchedDistributorCode);
    }
    if (matchedDistrict) {
      setLetterDistrict(toSinhalaDistrict(matchedDistrict));
    }
    if (matchedReason) {
      setLetterReason(toSinhalaReason(matchedReason));
    }

    syncLetterQtys(nextTotals);

    return { nextAgentMap, nextTotals };
  }

  async function fetchAndProcessReturnsForDate(
    targetDate: string,
    filesToFetch: ReturnUploadedFileRecord[]
  ) {
    if (!targetDate || filesToFetch.length === 0) return;
    setIsFetchingDateReturns(true);
    try {
      // 1. Immediately populate from any known returnQty in filesToFetch (0ms)
      const immediateTotals: Record<string, number> = {};
      for (const u of filesToFetch) {
        const lot = toOfficialSinhalaLotteryName(u.gameId || u.gameName || u.fileName);
        if (lot && typeof u.returnQty === "number" && u.returnQty > 0) {
          immediateTotals[lot] = (immediateTotals[lot] || 0) + u.returnQty;
        }
      }
      if (Object.keys(immediateTotals).length > 0) {
        setDateLotteryTotals((prev) => ({ ...prev, ...immediateTotals }));
        syncLetterQtys(immediateTotals);
      }

      // 2. Fetch and parse detailed sheets in background
      const fetched: File[] = [];
      for (const u of filesToFetch) {
        if (!u.downloadUrl) continue;
        try {
          const proxyUrl = `/api/proxy?url=${encodeURIComponent(u.downloadUrl)}`;
          const res = await fetch(proxyUrl);
          if (!res.ok) continue;
          const blob = await res.blob();
          const file = new File([blob], u.fileName, {
            type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          });
          (file as any).gameId = u.gameId;
          (file as any).gameName = u.gameName;
          fetched.push(file);
        } catch (e) {
          console.warn(`Could not fetch return file ${u.fileName}:`, e);
        }
      }
      if (fetched.length > 0) {
        setReturnFiles(fetched);
        await processReturnFilesDetailed(fetched, filesToFetch);
        setReturnsLoadedDate(targetDate);
      }
    } catch (err) {
      console.error("Error fetching actual returns for date:", err);
    } finally {
      setIsFetchingDateReturns(false);
    }
  }

  useEffect(() => {
    if (!activeDateRange.start || !activeDateRange.end) {
      setDbErpFiles([]);
      setDbReturnFiles([]);
      return;
    }
    let isMounted = true;
    setIsLoadingDbFiles(true);
    const erpPromise = reportMode === "daily" 
      ? listUploadedFilesByDate(selectedDate) 
      : listUploadedFilesByDateRange(activeDateRange.start, activeDateRange.end);
    const retPromise = reportMode === "daily"
      ? listReturnUploadedFilesByDate(selectedDate)
      : listReturnUploadedFilesByDateRange(activeDateRange.start, activeDateRange.end);

    Promise.all([erpPromise, retPromise])
      .then(([erpFiles, retFiles]) => {
        if (!isMounted) return;
        setDbErpFiles(erpFiles);
        setDbReturnFiles(retFiles);
        setIsLoadingDbFiles(false);

        // If today has no files yet, automatically try 2026-11-07 on initial daily view
        if (reportMode === "daily" && erpFiles.length === 0 && retFiles.length === 0 && selectedDate === todayKey()) {
          listReturnUploadedFilesByDate("2026-11-07").then((yFiles) => {
            if (isMounted && yFiles.length > 0) {
              setSelectedDate("2026-11-07");
            }
          });
          return;
        }

        // If no files found for the selected date, clear previous calculations
        if (erpFiles.length === 0 && retFiles.length === 0) {
          setAllAgentResults([]);
          setExcludedAgents(new Set());
          setDateLotteryTotals({});
          setLotteryBookQtys({
            "අද කෝටිපති": "",
            "කප්රුක": "",
            "ලග්න": "",
            "සසිරි": "",
            "ශනිදා": "",
            "සුපර් බෝල්": "",
            "සුපිරි ධන සම්පත": "",
            "ජය සම්පත": "",
            "වාසි": "",
          });
          return;
        }

        // Automatically fetch and parse actual returns for the selected date to fill Notice letter blanks
        if (retFiles && retFiles.length > 0) {
          fetchAndProcessReturnsForDate(selectedDate, retFiles);
        }

        // Automatically execute full sales vs returns analysis when both are present
        if (erpFiles && erpFiles.length > 0 && retFiles && retFiles.length > 0) {
          handleLoadSavedAndRun(erpFiles, retFiles);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Error loading DB files:", err);
        setIsLoadingDbFiles(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedDate, reportMode, activeDateRange]);

  async function runAnalysisForFiles(sFiles: File[], rFiles: File[]) {
    setError(null);
    setAllAgentResults([]);
    if (!selectedDate) return setError("Please select a date first.");
    if (sFiles.length === 0) return setError("Please upload at least one Sales file.");

    setIsBusy(true);
    try {
      const allSalesRows: SaleRow[] = [];
      const allReturnRows: ReturnRow[] = [];

      for (const f of sFiles) {
        const d = await readSheet2D(f);
        allSalesRows.push(...parseSales(d));
      }
      if (!allSalesRows.length) {
        throw new Error("No valid sales records parsed from the files.");
      }
      for (const f of rFiles) {
        const d = await readSheet2D(f);
        allReturnRows.push(...parseReturns(d));
      }

      const salesSum = new Map<string, number>();
      const nameMap = new Map<string, string>();
      for (const row of allSalesRows) {
        salesSum.set(row.agentCode, (salesSum.get(row.agentCode) ?? 0) + row.qty);
        if (row.agentName) {
          nameMap.set(row.agentCode, row.agentName);
        }
      }

      const returnSum = new Map<string, number>();
      for (const row of allReturnRows) {
        returnSum.set(row.agentCode, (returnSum.get(row.agentCode) ?? 0) + row.qty);
      }

      const merged: AgentResultRow[] = [];
      for (const [agentCode, salesQty] of salesSum.entries()) {
        if (salesQty <= 0) continue;
        const returnQty = returnSum.get(agentCode) ?? 0;
        const returnPct = (returnQty / salesQty) * 100;
        merged.push({
          rank: 0,
          agentCode,
          agentName: nameMap.get(agentCode),
          salesQty,
          returnQty,
          actualSales: salesQty - returnQty,
          returnPct,
        });
      }

      merged.sort((a, b) => b.returnPct - a.returnPct);
      setAllAgentResults(merged);
      setExcludedAgents(new Set());
      if (rFiles.length > 0) {
        await processReturnFilesDetailed(rFiles);
      }
      if (merged.length > 0) {
        setSelectedAgent(merged[0]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to parse files.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLoadSavedAndRun(
    explicitErpFiles?: UploadedFileRecord[],
    explicitRetFiles?: ReturnUploadedFileRecord[]
  ) {
    setError(null);
    if (!selectedDate) return setError("Please select a date first.");

    const erpToUse = explicitErpFiles || activeErpFiles;
    const retToUse = explicitRetFiles || activeReturnFiles;

    if (erpToUse.length === 0 || retToUse.length === 0) {
      return;
    }

    setIsFetchingSaved(true);
    setIsBusy(true);

    try {
      // 1. Parallel download for ERP files
      const erpPromises = erpToUse
        .filter((u) => !!u.downloadUrl)
        .map(async (u) => {
          try {
            const proxyUrl = `/api/proxy?url=${encodeURIComponent(u.downloadUrl)}`;
            const res = await fetch(proxyUrl);
            if (!res.ok) return null;
            const blob = await res.blob();
            return new File([blob], u.fileName, {
              type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            });
          } catch (e) {
            console.warn(`Could not load ERP file ${u.fileName}:`, e);
            return null;
          }
        });

      // 2. Parallel download for Return files
      const retPromises = retToUse
        .filter((u) => !!u.downloadUrl)
        .map(async (u) => {
          try {
            const proxyUrl = `/api/proxy?url=${encodeURIComponent(u.downloadUrl)}`;
            const res = await fetch(proxyUrl);
            if (!res.ok) return null;
            const blob = await res.blob();
            const file = new File([blob], u.fileName, {
              type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            });
            (file as any).gameId = u.gameId;
            (file as any).gameName = u.gameName;
            return file;
          } catch (e) {
            console.warn(`Could not load Return file ${u.fileName}:`, e);
            return null;
          }
        });

      const [fetchedErpResults, fetchedRetResults] = await Promise.all([
        Promise.all(erpPromises),
        Promise.all(retPromises),
      ]);

      const fetchedSales = fetchedErpResults.filter((f): f is File => f !== null);
      const fetchedReturns = fetchedRetResults.filter((f): f is File => f !== null);

      if (fetchedSales.length === 0) {
        throw new Error("Unable to download ERP sales files from storage.");
      }

      setSalesFiles(fetchedSales);
      setReturnFiles(fetchedReturns);

      if (fetchedReturns.length > 0) {
        await processReturnFilesDetailed(fetchedReturns, retToUse);
      }
      await runAnalysisForFiles(fetchedSales, fetchedReturns);
    } catch (err: any) {
      console.error("Auto analysis failed:", err);
      setError(err?.message || "Error running sales vs returns analysis.");
    } finally {
      setIsFetchingSaved(false);
      setIsBusy(false);
    }
  }

  function handlePrintActive() {
    setPrintBundle(false);
    setTimeout(() => {
      window.print();
    }, 50);
  }

  function handlePrintBoth() {
    setPrintBundle(true);
    setTimeout(() => {
      window.print();
      setPrintBundle(false);
    }, 100);
  }

  async function handleDownloadActivePdf() {
    const el = activePreviewTab === "notice" ? previewSheetRef.current : proofSheetRef.current;
    if (!el) return;
    try {
      setIsDownloadingLetter(true);
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(el, {
        scale: 2.5,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      const filename =
        activePreviewTab === "notice"
          ? `DLB_Return_Notice_${letterAgentCode || "030409"}_${selectedDate}.pdf`
          : `DLB_Agent_Proof_Annexure_${letterAgentCode || "030409"}_${selectedDate}.pdf`;
      pdf.save(filename);
    } catch (err) {
      console.error("PDF generation failed, launching print fallback:", err);
      window.print();
    } finally {
      setIsDownloadingLetter(false);
    }
  }

  async function handleDownloadBundlePdf() {
    const elNotice = previewSheetRef.current;
    const elProof = proofSheetRef.current;
    if (!elNotice || !elProof) return handleDownloadActivePdf();
    try {
      setIsDownloadingLetter(true);
      const html2canvas = (await import("html2canvas")).default;
      const canvasNotice = await html2canvas(elNotice, {
        scale: 2.5,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const canvasProof = await html2canvas(elProof, {
        scale: 2.5,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const noticeHeight = (canvasNotice.height * pdfWidth) / canvasNotice.width;
      pdf.addImage(canvasNotice.toDataURL("image/png"), "PNG", 0, 0, pdfWidth, noticeHeight);

      pdf.addPage();
      const proofHeight = (canvasProof.height * pdfWidth) / canvasProof.width;
      pdf.addImage(canvasProof.toDataURL("image/png"), "PNG", 0, 0, pdfWidth, proofHeight);

      pdf.save(`DLB_Notice_and_Proof_Bundle_${letterAgentCode || "030409"}_${selectedDate}.pdf`);
    } catch (err) {
      console.error("Bundle PDF generation failed:", err);
      window.print();
    } finally {
      setIsDownloadingLetter(false);
    }
  }

  function handleDownloadSummary() {
    if (!filteredResults.length) return;
    const dateRangeStr =
      reportMode === "daily"
        ? selectedDate
        : `${activeDateRange.start} to ${activeDateRange.end}`;
    const meta = {
      date: selectedDate,
      mode: reportMode,
      dateRange: dateRangeStr,
    };
    if (downloadFormat === "excel") {
      downloadAllAsExcel(
        `agent_return_analysis_${selectedDate || "date"}.xlsx`,
        meta,
        filteredResults,
        overallTotals
      );
    } else {
      downloadAllAsPdf(
        `agent_return_analysis_${selectedDate || "date"}.pdf`,
        meta,
        filteredResults,
        overallTotals
      );
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-16 font-sans">
      {/* Print Styles: isolates preview documents and supports multi-page bundle printing */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          .printable-preview-doc,
          .printable-preview-doc * {
            visibility: visible !important;
          }
          .printable-preview-doc {
            display: block !important;
            position: relative !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 auto !important;
            padding: 12mm 15mm !important;
            box-shadow: none !important;
            border: none !important;
            background: white !important;
            page-break-after: always !important;
            break-after: page !important;
          }
        }
      `}</style>

      {/* Top Navbar */}
      <div className="w-full bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-2xl bg-purple-50 text-purple-700 border border-purple-200">
              <FileText className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Return Analysis & Official Notice Preview
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Live A4 document preview of return notifications & agent analysis
              </p>
            </div>
          </div>

          {/* Quick Page Links */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Link
              href="/returns"
              className="px-3 py-1.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold transition shadow-xs"
            >
              Returns Page
            </Link>
            <Link
              href="/scan-balancing"
              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition shadow-xs"
            >
              Scan Balancing
            </Link>
            <Link
              href="/daily-balance"
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition shadow-xs"
            >
              Daily Balance
            </Link>
            <Link
              href="/"
              className="px-3 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-800 text-white font-bold transition shadow-xs"
            >
              Sales Page
            </Link>
          </div>
        </div>
      </div>

      {/* Main Two-Pane Split Layout */}
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* =========================================================
              LEFT SIDE: A4 DOCUMENT PREVIEWS (1. NOTICE LETTER & 2. AGENT PROOF ANNEXURE)
              ========================================================= */}
          <div className="lg:col-span-5 xl:col-span-5 space-y-3.5 lg:sticky lg:top-4">
            {/* 2 Previews Switcher Tabs */}
            <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white border border-slate-200 shadow-2xs">
              <button
                type="button"
                onClick={() => setActivePreviewTab("notice")}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 ${
                  activePreviewTab === "notice"
                    ? "bg-purple-700 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>1. Notice Letter (District Total)</span>
              </button>

              <button
                type="button"
                onClick={() => setActivePreviewTab("proof")}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 ${
                  activePreviewTab === "proof"
                    ? "bg-rose-700 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                <CheckSquare className="w-4 h-4" />
                <span>2. Agent Proof Annexure</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                    activePreviewTab === "proof"
                      ? "bg-white text-rose-800"
                      : "bg-rose-100 text-rose-800"
                  }`}
                >
                  {proofSelectedAgents.size}
                </span>
              </button>
            </div>

            {/* Preview Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-2.5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`h-2.5 w-2.5 rounded-full animate-pulse ${activePreviewTab === "notice" ? "bg-purple-600" : "bg-rose-600"}`} />
                <span className="text-xs font-black text-slate-800 uppercase tracking-wide">
                  {activePreviewTab === "notice" ? "District Notice Preview" : "Agent Proof Annexure"}
                </span>
                <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 font-mono text-[11px] font-bold">
                  {letterAgentCode || "030409"}
                </span>
                <span className="px-2 py-0.5 rounded-lg bg-purple-50 text-purple-700 font-mono text-[11px] font-bold">
                  {selectedDate}
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Re-fetch Returns Button */}
                <button
                  type="button"
                  disabled={isFetchingDateReturns || dbReturnFiles.length === 0}
                  onClick={() => fetchAndProcessReturnsForDate(selectedDate, dbReturnFiles)}
                  className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold transition flex items-center gap-1"
                  title="Re-fetch actual returns for this date from database"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isFetchingDateReturns ? "animate-spin text-purple-600" : ""}`} />
                  <span className="text-[11px] font-semibold text-slate-600">Refresh</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowLetterSettings((prev) => !prev)}
                  className={`p-2 rounded-xl border text-xs font-bold transition flex items-center gap-1 ${
                    showLetterSettings
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                  }`}
                  title="Customize Letter Text & Fields"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Fields</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintActive}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5"
                  title={`Print ${activePreviewTab === "notice" ? "Notice Letter" : "Proof Annexure"}`}
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>

                <button
                  type="button"
                  disabled={isDownloadingLetter}
                  onClick={handleDownloadActivePdf}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5"
                  title={`Download ${activePreviewTab === "notice" ? "Notice Letter" : "Proof Annexure"} as PDF`}
                >
                  {isDownloadingLetter ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>PDF</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintBoth}
                  className="px-3 py-1.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5"
                  title="Print both Notice Letter and Proof Annexure as a multi-page bundle"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Bundle</span>
                </button>
              </div>
            </div>

            {/* Quick Letter Customizer Drawer */}
            {showLetterSettings && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 space-y-3 text-xs animate-in fade-in duration-100 shadow-xs">
                <div className="flex items-center justify-between pb-1 border-b border-blue-100">
                  <span className="font-black text-blue-900 uppercase tracking-wide">
                    {activePreviewTab === "notice" ? "Customize Notice Details" : "Customize Proof Annexure Details"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowLetterSettings(false)}
                    className="text-slate-400 hover:text-slate-700 font-bold"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block">District Distributor (නම)</label>
                    <input
                      type="text"
                      value={letterAgentName}
                      onChange={(e) => setLetterAgentName(e.target.value)}
                      className="mt-0.5 w-full bg-white rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block">Distributor Code (අංකය)</label>
                    <input
                      type="text"
                      value={letterAgentCode}
                      onChange={(e) => setLetterAgentCode(e.target.value)}
                      className="mt-0.5 w-full bg-white rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block">Address Line 1</label>
                    <input
                      type="text"
                      value={letterAddressLine1}
                      onChange={(e) => setLetterAddressLine1(e.target.value)}
                      className="mt-0.5 w-full bg-white rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block">District / City</label>
                    <input
                      type="text"
                      value={letterDistrict}
                      onChange={(e) => setLetterDistrict(e.target.value)}
                      className="mt-0.5 w-full bg-white rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block">Officer Name</label>
                    <input
                      type="text"
                      value={letterOfficerName}
                      onChange={(e) => setLetterOfficerName(e.target.value)}
                      className="mt-0.5 w-full bg-white rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
                    />
                  </div>
                  {activePreviewTab === "notice" ? (
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 block">Reason for Return (හේතුව)</label>
                      <input
                        type="text"
                        value={letterReason}
                        onChange={(e) => setLetterReason(e.target.value)}
                        placeholder="e.g. අයහපත් කාලගුණය (වැසි) / අලෙවි නියෝජිතයින් නොපැමිණීම"
                        className="mt-0.5 w-full bg-white rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 block">Annexure Title</label>
                      <input
                        type="text"
                        value={annexureTitle}
                        onChange={(e) => setAnnexureTitle(e.target.value)}
                        className="mt-0.5 w-full bg-white rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pristine A4 Document Sheets Container */}
            <div className="overflow-x-auto rounded-3xl p-1 bg-slate-200/60 shadow-inner flex flex-col items-center gap-6">
              {/* Sheet 1: Official District Distributor Return Notice Letter */}
              <div
                ref={previewSheetRef}
                id="letter-preview-document"
                className={`w-full max-w-[560px] bg-white rounded-sm shadow-2xl p-7 sm:p-9 text-slate-900 space-y-4 font-serif text-[12px] sm:text-[13px] leading-relaxed border border-slate-200 ${
                  activePreviewTab === "notice" || printBundle ? "block printable-preview-doc" : "hidden"
                }`}
                style={{ minHeight: "760px" }}
              >
                {/* 1. Top Section: Address Blocks */}
                <div className="flex justify-between items-start gap-4 pt-1">
                  {/* Top Left: Recipient */}
                  <div className="text-left space-y-0.5 leading-snug">
                    <div className="font-normal">සභාපතිතුමා,</div>
                    <div className="font-normal">සංවර්ධන ලොතරැයි මණ්ඩලය,</div>
                    <div className="font-normal">කොළඹ 02.</div>
                  </div>

                  {/* Top Right: Agent Address */}
                  <div className="text-right space-y-0.5 leading-snug">
                    <div className="font-normal">{letterAgentName},</div>
                    <div className="font-normal">{letterAddressLine1}</div>
                    <div className="font-normal">{letterAddressLine2}</div>
                    <div className="font-normal">{letterDistrict}.</div>
                  </div>
                </div>

                {/* 2. Subject Line */}
                <div className="text-center pt-3 pb-1">
                  <h2 className="font-bold text-[13px] sm:text-[14px] underline inline-block tracking-normal">
                    අනුමත ප්‍රතිශතය ඉක්මවා සිදුකරන ආපසු එවුම් (Return) සම්බන්ධව දැනුම් දීම.
                  </h2>
                </div>

                {/* 3. Intro Sentence with Dynamic Year, Month, Day */}
                <div className="text-justify leading-relaxed pt-1">
                  <span>ඉහත නම සඳහන් </span>
                  <span className="font-bold underline px-0.5">{letterDistrict}</span>
                  <span> දිස්ත්‍රික්කයේ බෙදාහැරීමේ අලෙවි නියෝජිතයෙකු වන මාගේ </span>
                  <span className="font-bold">{sinhalaDate.year}</span>
                  <span> වර්ෂයේ </span>
                  <span className="font-bold underline px-1">{sinhalaDate.month}</span>
                  <span> මස </span>
                  <span className="font-bold underline px-1">{sinhalaDate.day}</span>
                  <span> දිනට ආපසු එවුම් ප්‍රමාණය පහත පරිදි වේ.</span>
                </div>

                {/* 4. Official 9-Lottery Table */}
                <div className="pt-1">
                  <table className="w-full border-collapse border border-slate-800 text-[12px] sm:text-[12.5px]">
                    <thead>
                      <tr className="border-b border-slate-800 text-center font-bold">
                        <th className="border-r border-slate-800 py-1.5 px-3 text-left w-[60%]">
                          ලොතරැයි වර්ගය
                        </th>
                        <th className="py-1.5 px-3 text-center w-[40%]">
                          ආපසු එවුම් ප්‍රමාණය (පොත්)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {OFFICIAL_SINHALA_LOTTERIES.map((lottery, idx) => {
                        const qty = lotteryBookQtys[lottery] ?? "";
                        return (
                          <tr key={lottery} className="border-b border-slate-800">
                            <td className="border-r border-slate-800 py-1 px-3">
                              <span className="inline-block w-4 font-mono text-[11px] text-slate-600">
                                {idx + 1}
                              </span>
                              <span className="font-semibold text-slate-900">{lottery}</span>
                            </td>
                            <td className="py-0.5 px-2 text-center font-mono">
                              <input
                                type="text"
                                value={qty}
                                placeholder="—"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setLotteryBookQtys((prev) => ({
                                    ...prev,
                                    [lottery]: val,
                                  }));
                                }}
                                className="w-full text-center bg-transparent focus:bg-blue-50/50 rounded py-0.5 text-xs font-bold font-mono outline-none"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 5. Reasons Section */}
                <div className="space-y-2 pt-1 leading-relaxed">
                  <div>ඒ සඳහා පහත සඳහන් හේතුන් බලපා ඇති බව තහවුරු කරමි.</div>
                  {letterReason ? (
                    <div className="text-slate-800 font-medium px-1 py-0.5 border-b border-dotted border-slate-600 min-h-[22px]">
                      {letterReason}
                    </div>
                  ) : (
                    <>
                      <div className="border-b border-dotted border-slate-400 h-4 w-full" />
                      <div className="border-b border-dotted border-slate-400 h-4 w-full" />
                    </>
                  )}
                  <div className="pt-1">
                    ඉහත සඳහන් හේතුන් සලකා බලා මාගේ කොමිස් මුදල කපා නොහරින ලෙස ඉල්ලා සිටිමි.
                  </div>
                </div>

                {/* 6. Agent Signature & Seal Block */}
                <div className="flex justify-between items-end pt-3 text-[12px]">
                  <div className="space-y-1">
                    <div>
                      <span>අත්සන </span>
                      <span className="inline-block w-36 border-b border-dotted border-slate-600"></span>
                    </div>
                    <div>
                      <span>නම </span>
                      <span className="font-bold underline">{letterAgentName}</span>
                      <span className="font-mono text-xs"> ({letterAgentCode})</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-600 font-semibold">රබර් මුද්‍රාව</span>
                  </div>
                </div>

                {/* Heavy Divider */}
                <hr className="border-t-2 border-slate-900 my-2.5" />

                {/* 7. Field Officer Recommendation */}
                <div className="space-y-1 text-[11.5px] sm:text-[12px]">
                  <div className="font-bold text-[12.5px]">ක්ෂේත්‍ර නිලධාරී නිර්දේශය</div>
                  <div className="text-justify leading-relaxed">
                    මෙම බෙදාහැරීමේ අලෙවි නියෝජිත මහතාගේ ඉහත සඳහන් දිනට අදාලව අනුමත ප්‍රතිශතය ඉක්මවා ආපසු එවුම් ඉහළ යාම පිලිබඳ ඉදිරිපත්කර ඇති හේතුන් සාධාරණ බව තහවුරු කරමි./ නොකරමි.
                  </div>
                  <div className="text-slate-700">කලාප කළමනාකරු / අලෙවි ප්‍රවර්ධන සහකාර</div>

                  <div className="flex justify-between items-end pt-2">
                    <div className="space-y-1">
                      <div>
                        <span>අත්සන </span>
                        <span className="inline-block w-36 border-b border-dotted border-slate-600"></span>
                      </div>
                      <div>
                        <span>නම: </span>
                        <span className="font-bold">{letterOfficerName}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-600 font-semibold">රබර් මුද්‍රාව</span>
                    </div>
                  </div>
                </div>

                {/* Heavy Divider */}
                <hr className="border-t-2 border-slate-900 my-2.5" />

                {/* 8. Management Approval */}
                <div className="space-y-2 pt-0.5 text-[11.5px] sm:text-[12px]">
                  <div>කොමිස් මුදල කපා හැරීම අත්හිටුවීම අනුමත කරමි/ නොකරමි.</div>
                  <div className="border-b border-dotted border-slate-600 w-52 h-3"></div>
                  <div className="text-slate-700">
                    නියෝජ්‍ය සාමාන්‍යාධිකාරී (අලෙවි) / සහකාර සාමාන්‍යාධිකාරී (විකුණුම්)
                  </div>
                </div>
              </div>

              {/* Sheet 2: Agent Return Proof Annexure (Evidence Document) */}
              <div
                ref={proofSheetRef}
                id="proof-preview-document"
                className={`w-full max-w-[560px] bg-white rounded-sm shadow-2xl p-7 sm:p-9 text-black space-y-3.5 font-serif text-[11.5px] sm:text-[12px] leading-relaxed border border-black ${
                  activePreviewTab === "proof" || printBundle ? "block printable-preview-doc" : "hidden"
                }`}
                style={{ minHeight: "760px" }}
              >
                {/* Title */}
                <div className="text-center pb-2 border-b border-black">
                  <h2 className="font-bold text-[14px] text-black">
                    {annexureTitle}
                  </h2>
                  <div className="text-[11px] text-black font-sans mt-0.5">
                    දිනය: {selectedDate} | දිස්ත්‍රික් නියෝජිත: {letterAgentCode} ({letterAgentName})
                  </div>
                </div>

                {/* Pure Black & White Table */}
                <div className="pt-1">
                  {proofListRows.length === 0 ? (
                    <div className="p-8 text-center text-xs text-black border border-black bg-white">
                      <div className="font-bold">සාක්ෂි ලේඛනයට නියෝජිතයින් තෝරා නොමැත</div>
                      <p className="text-[11px] mt-1">
                        කරුණාකර දකුණු පස ඇති වගුවෙන් නියෝජිතයින් ඉදිරියේ ඇති checkbox ලකුණු කරන්න (Tick agents to include).
                      </p>
                    </div>
                  ) : (
                    <table className="w-full border-collapse border border-black text-[11px] sm:text-[11.5px] text-black bg-white">
                      <thead>
                        <tr className="border-b border-black bg-white text-center font-bold text-black">
                          <th className="border border-black py-1.5 px-1.5 w-[7%]">#</th>
                          <th className="border border-black py-1.5 px-2 text-left w-[18%]">නියෝජිත අංකය</th>
                          <th className="border border-black py-1.5 px-2 text-left w-[33%]">නියෝජිත නම</th>
                          <th className="border border-black py-1.5 px-2 text-right w-[14%]">විකිණුම්</th>
                          <th className="border border-black py-1.5 px-2 text-right w-[14%]">ආපසු</th>
                          <th className="border border-black py-1.5 px-2 text-right w-[14%]">ප්‍රතිශතය %</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white text-black font-mono">
                        {proofListRows.map((r) => (
                          <tr key={r.agentCode} className="border-b border-black bg-white">
                            <td className="border border-black py-1 px-1.5 text-center text-black">
                              {r.rank}
                            </td>
                            <td className="border border-black py-1 px-2 font-bold text-black">
                              {r.agentCode}
                            </td>
                            <td
                              className="border border-black py-1 px-2 font-sans font-medium text-black truncate max-w-[130px] text-left"
                              title={r.agentName}
                            >
                              {r.agentName || "—"}
                            </td>
                            <td className="border border-black py-1 px-2 text-right text-black">
                              {r.salesQty.toLocaleString()}
                            </td>
                            <td className="border border-black py-1 px-2 text-right font-bold text-black">
                              {r.returnQty.toLocaleString()}
                            </td>
                            <td className="border border-black py-1 px-2 text-right font-bold text-black">
                              {r.returnPct.toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-black font-bold bg-white text-black font-mono text-[11px]">
                          <td colSpan={3} className="border border-black py-1.5 px-2 text-right font-sans">
                            මුළු එකතුව (Total):
                          </td>
                          <td className="border border-black py-1.5 px-2 text-right font-mono">
                            {proofTotals.sales.toLocaleString()}
                          </td>
                          <td className="border border-black py-1.5 px-2 text-right font-bold font-mono">
                            {proofTotals.returns.toLocaleString()}
                          </td>
                          <td className="border border-black py-1.5 px-2 text-right font-bold font-mono">
                            {proofTotals.returnPct.toFixed(2)}%
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>

                {/* Verification Sign-off */}
                <div className="pt-3 text-[11px] sm:text-[11.5px] leading-relaxed text-black space-y-4">
                  <div className="text-justify text-black">
                    ඉහත දැක්වෙන්නේ මාගේ බෙදාහැරීමේ ප්‍රදේශයේ අදාළ දිනට ආපසු එවුම් (Return) සිදුකළ අලෙවි නියෝජිතයින්ගේ සත්‍ය තොරතුරු බවට සහතික කරමි. මෙම තොරතුරු නිල ලිපියට සාක්ෂි අනුබද්ධයක් (Proof Attachment) ලෙස ඉදිරිපත් කරමි.
                  </div>
                  <div className="flex justify-end pt-3">
                    <div className="text-center space-y-1">
                      <div className="border-b border-dotted border-black w-48 mx-auto" />
                      <div className="font-bold text-black">දිස්ත්‍රික් බෙදාහැරීමේ අලෙවි නියෝජිත</div>
                      <div className="text-[10px] text-black font-mono">({letterAgentName} - {letterAgentCode})</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* =========================================================
              RIGHT SIDE: REST COMPONENTS (CONTROLS, STATS & AGENTS TABLE)
              ========================================================= */}
          <div className="lg:col-span-7 xl:col-span-7 space-y-5">
            {/* 1. Report Period & Configuration Card */}
            <div className="rounded-3xl bg-white p-5 sm:p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-base sm:text-lg font-black text-slate-900">
                    Analysis Controls
                  </h2>
                  <p className="text-xs text-slate-500 font-medium">
                    Select anchor date; database records and returns load automatically
                  </p>
                </div>

                {/* Mode Selector */}
                <div className="inline-flex rounded-2xl bg-slate-100 p-1 border border-slate-200">
                  {(["daily", "weekly", "monthly"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setReportMode(mode);
                        setAllAgentResults([]);
                        setExcludedAgents(new Set());
                      }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-xl transition ${
                        reportMode === mode
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date Picker */}
              <div className="space-y-1.5 max-w-sm">
                <label className="text-xs font-bold text-slate-700 block flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-purple-600" />
                  Anchor Date
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setAllAgentResults([]);
                    setExcludedAgents(new Set());
                  }}
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white px-3.5 py-2 text-sm font-mono font-bold text-slate-900 focus:outline-none focus:border-purple-600 shadow-2xs"
                />
                <div className="text-[11px] text-slate-500">
                  Range: <span className="font-bold text-slate-700">{activeDateRange.start}</span> to{" "}
                  <span className="font-bold text-slate-700">{activeDateRange.end}</span>
                </div>
              </div>

              {/* Database Auto-Analysis Box */}
              <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-black text-purple-900 uppercase tracking-wide">
                    Database Files ({reportMode.toUpperCase()})
                  </span>
                  <span className="text-[11px] text-purple-700 font-semibold">
                    {activeDates.size} active matched days
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-white rounded-xl p-2.5 border border-purple-100 flex justify-between items-center">
                    <span className="text-slate-600">Sales Summary:</span>
                    <span className="font-bold text-slate-900 font-mono">
                      {isLoadingDbFiles ? "…" : `${dbErpFiles.length} files`}
                    </span>
                  </div>
                  <div className="bg-white rounded-xl p-2.5 border border-purple-100 flex justify-between items-center">
                    <span className="text-slate-600">Return Files:</span>
                    <span className="font-bold text-slate-900 font-mono">
                      {isLoadingDbFiles ? "…" : `${dbReturnFiles.length} files`}
                    </span>
                  </div>
                </div>

                {/* Auto Status & Error Messages */}
                {isLoadingDbFiles || isFetchingSaved || isFetchingDateReturns ? (
                  <div className="py-2.5 px-3 rounded-xl bg-purple-100/70 border border-purple-200 text-purple-900 text-xs font-semibold flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-purple-700" />
                    <span>
                      {isLoadingDbFiles
                        ? `Checking database files for ${selectedDate}…`
                        : isFetchingSaved
                        ? `Automatically loading & analyzing files for ${selectedDate}…`
                        : `Populating return records for ${selectedDate}…`}
                    </span>
                  </div>
                ) : !isLoadingDbFiles && dbErpFiles.length === 0 && dbReturnFiles.length === 0 ? (
                  <div className="py-3 px-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>No files found for {selectedDate}</span>
                    </div>
                    <p className="text-[11px] text-amber-700 pl-5 leading-normal">
                      No ERP sales or return files exist in the database for this date. Please select another date from the date picker above, or upload Excel files manually below.
                    </p>
                  </div>
                ) : !isLoadingDbFiles && dbErpFiles.length > 0 && dbReturnFiles.length === 0 ? (
                  <div className="py-3 px-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Found {dbErpFiles.length} sales files, but no return files were uploaded for {selectedDate}. Return analysis requires return sheets.
                    </span>
                  </div>
                ) : !isLoadingDbFiles && dbReturnFiles.length > 0 && dbErpFiles.length === 0 ? (
                  <div className="py-3 px-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>
                      Notice letter blanks updated with {dbReturnFiles.length} return files. No ERP sales summary found for {selectedDate} to calculate agent percentages.
                    </span>
                  </div>
                ) : allAgentResults.length > 0 ? (
                  <div className="py-2 px-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        Analysis loaded automatically ({allAgentResults.length} agents analyzed)
                      </span>
                    </div>
                    <span className="text-[10px] text-emerald-600 font-mono">Auto Loaded ✓</span>
                  </div>
                ) : null}
              </div>



              {/* Manual File Uploads Accordion */}
              <div className="pt-2">
                <details className="text-xs group">
                  <summary className="font-bold text-slate-700 cursor-pointer hover:text-purple-700 flex items-center justify-between">
                    <span>Or upload files manually…</span>
                    <span className="text-[10px] text-slate-400 group-open:rotate-180 transition">▼</span>
                  </summary>
                  <div className="mt-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 block">
                        Sales Files (.xlsx)
                      </label>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        multiple
                        onChange={(e) => {
                          setSalesFiles(Array.from(e.target.files ?? []));
                          setAllAgentResults([]);
                        }}
                        className="mt-1 block w-full text-xs"
                      />
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Selected: {salesFiles.length}
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 block">
                        Return Files (.xlsx)
                      </label>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        multiple
                        onChange={(e) => {
                          setReturnFiles(Array.from(e.target.files ?? []));
                          setAllAgentResults([]);
                        }}
                        className="mt-1 block w-full text-xs"
                      />
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Selected: {returnFiles.length}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => runAnalysisForFiles(salesFiles, returnFiles)}
                      disabled={isBusy || salesFiles.length === 0}
                      className="w-full py-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition"
                    >
                      {isBusy ? "Processing…" : "Analyze Uploaded Files"}
                    </button>
                  </div>
                </details>
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 font-semibold">
                  {error}
                </div>
              )}
            </div>

            {/* 2. Analysis Metrics & Summary KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 block">
                  Active Agents
                </span>
                <div className="text-xl sm:text-2xl font-black font-mono text-slate-900 mt-1">
                  {overallTotals.uniqueAgents}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 block">
                  Total Sales Qty
                </span>
                <div className="text-xl sm:text-2xl font-black font-mono text-slate-900 mt-1">
                  {overallTotals.totalSalesQty.toLocaleString()}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 block">
                  Total Return Qty
                </span>
                <div className="text-xl sm:text-2xl font-black font-mono text-rose-700 mt-1">
                  {overallTotals.totalReturnQty.toLocaleString()}
                </div>
              </div>

              <div
                className={`rounded-2xl border p-4 shadow-2xs ${
                  overallTotals.overallReturnPct >= returnThreshold
                    ? "border-rose-300 bg-rose-50/60"
                    : "border-slate-200 bg-white"
                }`}
              >
                <span
                  className={`text-[11px] font-bold uppercase tracking-wide block ${
                    overallTotals.overallReturnPct >= returnThreshold
                      ? "text-rose-800"
                      : "text-slate-500"
                  }`}
                >
                  Overall Return %
                </span>
                <div
                  className={`text-xl sm:text-2xl font-black font-mono mt-1 ${
                    overallTotals.overallReturnPct >= returnThreshold
                      ? "text-rose-900"
                      : "text-slate-900"
                  }`}
                >
                  {overallTotals.overallReturnPct.toFixed(2)}%
                </div>
              </div>
            </div>

            {/* 3. Agents Table Card with Tick List for Proof Annexure Selection */}
            <div className="rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Agent Return Breakdown & Proof Selection
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tick agents below to include in the official Proof Annexure (Attachment)
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={downloadFormat}
                    onChange={(e) => setDownloadFormat(e.target.value as "excel" | "pdf")}
                    disabled={!filteredResults.length}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold outline-none"
                  >
                    <option value="excel">Excel Summary</option>
                    <option value="pdf">PDF Summary</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleDownloadSummary}
                    disabled={!filteredResults.length}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export</span>
                  </button>
                </div>
              </div>

              {/* Sleek Quick Proof Selection Toolbar */}
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">Proof List:</span>
                  <button
                    type="button"
                    onClick={handleSelectExceededProofAgents}
                    className="px-2.5 py-1 rounded-lg font-bold bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-300 transition text-[11px] flex items-center gap-1 shadow-2xs"
                    title="Select only agents with returns exceeding threshold"
                  >
                    <span>✓ Over {returnThreshold}%</span>
                    <span className="px-1.5 py-0.2 rounded-full bg-rose-200 text-rose-900 text-[10px] font-mono">
                      {allAgentResults.filter((r) => r.returnPct >= returnThreshold).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectAllProofAgents}
                    className="px-2.5 py-1 rounded-lg font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 transition text-[11px] shadow-2xs"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={handleClearProofAgents}
                    className="px-2.5 py-1 rounded-lg font-bold bg-white hover:bg-slate-100 text-slate-500 border border-slate-300 transition text-[11px]"
                  >
                    Clear
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 font-bold text-[11px] border border-purple-200">
                    {proofSelectedAgents.size} of {filteredResults.length} in Proof
                  </span>
                  <button
                    type="button"
                    onClick={() => setActivePreviewTab("proof")}
                    className={`px-3 py-1 rounded-lg font-bold transition text-[11px] flex items-center gap-1.5 shadow-2xs ${
                      activePreviewTab === "proof"
                        ? "bg-rose-700 text-white shadow-xs"
                        : "bg-white text-rose-700 border border-rose-300 hover:bg-rose-50"
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View Proof Preview</span>
                  </button>
                </div>
              </div>

              {excludedAgents.size > 0 && (
                <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100 text-xs flex items-center justify-between text-indigo-800 font-medium">
                  <span>{excludedAgents.size} agents currently excluded from calculations.</span>
                  <button
                    type="button"
                    onClick={() => setExcludedAgents(new Set())}
                    className="font-bold underline text-indigo-700 hover:text-indigo-900"
                  >
                    Restore all
                  </button>
                </div>
              )}

              {!filteredResults.length ? (
                <div className="p-12 text-center text-xs text-slate-500 space-y-2">
                  <FileText className="w-8 h-8 text-slate-300 mx-auto" />
                  <div className="font-semibold text-slate-700">No agents to display</div>
                  <p className="text-slate-400 max-w-sm mx-auto">
                    {allAgentResults.length > 0
                      ? "No agents to display."
                      : "Database files are automatically analyzed when available. You can also upload Excel summaries manually."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                        <th className="px-2.5 py-3 text-center w-10">
                          <input
                            type="checkbox"
                            checked={
                              filteredResults.length > 0 &&
                              filteredResults.every((r) => proofSelectedAgents.has(r.agentCode))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                handleSelectAllProofAgents();
                              } else {
                                handleClearProofAgents();
                              }
                            }}
                            className="rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                            title="Toggle all filtered agents in proof"
                          />
                        </th>
                        <th className="px-3 py-3">#</th>
                        <th className="px-3 py-3">Code</th>
                        <th className="px-3 py-3">Agent Name</th>
                        <th className="px-3 py-3 text-right">Sales Qty</th>
                        <th className="px-3 py-3 text-right">Return Qty</th>
                        <th className="px-3 py-3 text-right">Return %</th>
                        <th className="px-3 py-3 text-center">In Proof Annexure</th>
                        <th className="px-2 py-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {filteredResults.map((r) => {
                        const isExceeded = r.returnPct >= returnThreshold;
                        const isTicked = proofSelectedAgents.has(r.agentCode);

                        return (
                          <tr
                            key={r.agentCode}
                            onClick={() => handleToggleProofAgent(r.agentCode)}
                            className={`cursor-pointer transition-colors ${
                              isTicked
                                ? "bg-purple-50/70 font-semibold"
                                : isExceeded
                                ? "bg-rose-50/30 hover:bg-rose-50/60"
                                : "hover:bg-slate-50"
                            }`}
                          >
                            <td
                              className="px-2.5 py-2.5 text-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={isTicked}
                                onChange={() => handleToggleProofAgent(r.agentCode)}
                                className="rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-2.5 font-sans text-slate-400">{r.rank}</td>
                            <td className="px-3 py-2.5 font-bold text-slate-900">{r.agentCode}</td>
                            <td
                              className="px-3 py-2.5 font-sans text-slate-800 font-semibold truncate max-w-[160px]"
                              title={r.agentName}
                            >
                              {r.agentName || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-right text-slate-700">
                              {r.salesQty.toLocaleString()}
                            </td>
                            <td className="px-3 py-2.5 text-right font-bold text-rose-700">
                              {r.returnQty.toLocaleString()}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right font-black ${
                                isExceeded ? "text-rose-600" : "text-slate-800"
                              }`}
                            >
                              {r.returnPct.toFixed(2)}%
                            </td>
                            <td className="px-3 py-2.5 text-center font-sans">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1 ${
                                  isTicked
                                    ? "bg-purple-100 text-purple-900 border border-purple-200"
                                    : "bg-slate-100 text-slate-400"
                                }`}
                              >
                                {isTicked ? (
                                  <>
                                    <Check className="w-3 h-3 text-purple-700" />
                                    <span>Included</span>
                                  </>
                                ) : (
                                  <span>Not in Proof</span>
                                )}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-center font-sans">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExcludedAgents((prev) => {
                                    const next = new Set(prev);
                                    next.add(r.agentCode);
                                    return next;
                                  });
                                }}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                                title="Exclude agent completely from calculations"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

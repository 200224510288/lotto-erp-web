// app/lib/nlbLotteryConfig.ts
// Configuration service for National Lotteries Board (NLB) lotteries and codes.
// Backed by Firebase Firestore with offline / localStorage fallback.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface NlbLotteryEntry {
  code: string;       // Primary 2-5 letter code, e.g. "MSE", "ADE"
  name: string;       // Full name, e.g. "Mahajana Sampatha"
  aliases: string[];  // Legacy aliases, e.g. ["MSM"]
  isActive: boolean;  // Whether currently accepted
  updatedAt?: number;
}

export const DEFAULT_NLB_LOTTERIES: NlbLotteryEntry[] = [
  {
    code: "MSE",
    name: "Mahajana Sampatha (මහජන සම්පත)",
    aliases: ["MSM"],
    isActive: true,
  },
  {
    code: "MPE",
    name: "Mega Power (මෙගා පවර්)",
    aliases: ["MPM"],
    isActive: true,
  },
  {
    code: "GSE",
    name: "Govisetha (ගොවිසෙත)",
    aliases: ["GSM"],
    isActive: true,
  },
  {
    code: "ADE",
    name: "Ada Sampatha (අද සම්පත)",
    aliases: ["AM"],
    isActive: true,
  },
  {
    code: "HAE",
    name: "Handahana (හඳහන)",
    aliases: ["HM"],
    isActive: true,
  },
  {
    code: "DNE",
    name: "Dhana Nidhanaya (ධන නිධානය)",
    aliases: ["DNM"],
    isActive: true,
  },
  {
    code: "NJE",
    name: "Neeroga / Jathika Sampatha",
    aliases: ["NJM"],
    isActive: true,
  },
  {
    code: "SDE",
    name: "Suba Dawasak / Sevana",
    aliases: ["SDM"],
    isActive: true,
  },
];

const FIRESTORE_COLLECTION = "nlb_game_config";
const FIRESTORE_DOC = "lotteries";
const LOCAL_STORAGE_KEY = "nlb_custom_lotteries";

// Runtime in-memory cache
let inMemoryLotteries: NlbLotteryEntry[] = DEFAULT_NLB_LOTTERIES;

export function getCachedNlbLotteries(): NlbLotteryEntry[] {
  return inMemoryLotteries;
}

export function getActiveNlbCodes(lotteries?: NlbLotteryEntry[]): string[] {
  const list = lotteries || inMemoryLotteries;
  return list.filter((l) => l.isActive).map((l) => l.code.toUpperCase());
}

export function getNlbCodeAliases(lotteries?: NlbLotteryEntry[]): Record<string, string> {
  const list = lotteries || inMemoryLotteries;
  const aliasMap: Record<string, string> = {};
  for (const item of list) {
    const main = item.code.toUpperCase();
    aliasMap[main] = main;
    for (const a of item.aliases || []) {
      const clean = a.trim().toUpperCase();
      if (clean) aliasMap[clean] = main;
    }
  }
  return aliasMap;
}

/**
 * Load NLB lotteries from Firestore with local fallback
 */
export async function loadNlbLotteries(): Promise<NlbLotteryEntry[]> {
  let lotteries: NlbLotteryEntry[] = DEFAULT_NLB_LOTTERIES;

  try {
    const ref = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC);
    const snap = await getDoc(ref);
    if (snap.exists() && Array.isArray(snap.data()?.lotteries)) {
      lotteries = snap.data().lotteries;
    } else {
      if (typeof window !== "undefined") {
        const local = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed) && parsed.length > 0) {
            lotteries = parsed;
          }
        }
      }
    }
  } catch (err) {
    console.warn("Firestore fetch failed for NLB lotteries, using fallback:", err);
    if (typeof window !== "undefined") {
      const local = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (local) {
        try {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) lotteries = parsed;
        } catch {
          // ignore
        }
      }
    }
  }

  inMemoryLotteries = lotteries;
  return lotteries;
}

/**
 * Persist NLB lotteries list
 */
async function persistNlbLotteries(lotteries: NlbLotteryEntry[]): Promise<void> {
  inMemoryLotteries = lotteries;

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(lotteries));
    } catch {
      // ignore
    }
  }

  try {
    const ref = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC);
    await setDoc(ref, {
      lotteries,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn("Failed saving NLB lotteries to Firestore:", err);
  }
}

/**
 * Save or update an NLB lottery entry
 */
export async function saveNlbLottery(entry: NlbLotteryEntry): Promise<NlbLotteryEntry[]> {
  const current = await loadNlbLotteries();
  const cleanCode = entry.code.trim().toUpperCase();
  const existingIdx = current.findIndex((l) => l.code.toUpperCase() === cleanCode);

  const updatedEntry: NlbLotteryEntry = {
    ...entry,
    code: cleanCode,
    name: entry.name.trim(),
    aliases: (entry.aliases || []).map((a) => a.trim().toUpperCase()).filter(Boolean),
    isActive: entry.isActive ?? true,
    updatedAt: Date.now(),
  };

  let nextList: NlbLotteryEntry[];
  if (existingIdx >= 0) {
    nextList = [...current];
    nextList[existingIdx] = updatedEntry;
  } else {
    nextList = [...current, updatedEntry];
  }

  await persistNlbLotteries(nextList);
  return nextList;
}

/**
 * Delete an NLB lottery by code
 */
export async function deleteNlbLottery(code: string): Promise<NlbLotteryEntry[]> {
  const current = await loadNlbLotteries();
  const cleanCode = code.trim().toUpperCase();
  const nextList = current.filter((l) => l.code.toUpperCase() !== cleanCode);
  await persistNlbLotteries(nextList);
  return nextList;
}

/**
 * Reset NLB lotteries back to built-in defaults
 */
export async function resetNlbLotteriesToDefaults(): Promise<NlbLotteryEntry[]> {
  await persistNlbLotteries(DEFAULT_NLB_LOTTERIES);
  return DEFAULT_NLB_LOTTERIES;
}

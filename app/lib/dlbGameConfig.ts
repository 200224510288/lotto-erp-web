// app/lib/dlbGameConfig.ts
// Central management service for DLB Lottery Games and their weekday ERP-to-Official mappings.
// Backed by Firebase Firestore with offline / localStorage fallback.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { updateActiveGameMap } from "./gameAutoSelect";

export type DlbWeekday =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export const DLB_WEEKDAYS: DlbWeekday[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export interface DlbGameDayMapping {
  erp: string;       // e.g. "WM", "LWM"
  official: string;  // e.g. "WMO", "LMO"
}

export interface DlbGame {
  id: string;        // lowercase slug, e.g. "wasi", "lagna_wasana"
  name: string;      // Display name, e.g. "Wasi", "Lagna Wasana"
  prefix: string;    // Base prefix, e.g. "W", "LW"
  days: Record<DlbWeekday, DlbGameDayMapping>;
  isDefault?: boolean;
  updatedAt?: number;
}

export const STANDARD_WEEKDAY_SUFFIXES: Record<DlbWeekday, { erp: string; official: string }> = {
  Monday: { erp: "M", official: "MO" },
  Tuesday: { erp: "A", official: "TU" },
  Wednesday: { erp: "W", official: "WD" },
  Thursday: { erp: "T", official: "TH" },
  Friday: { erp: "F", official: "FR" },
  Saturday: { erp: "S", official: "SA" },
  Sunday: { erp: "I", official: "SU" },
};

/**
 * Auto-generate 7 days of ERP and Official codes from a base prefix
 */
export function generateDefaultSchedule(prefix: string): Record<DlbWeekday, DlbGameDayMapping> {
  const p = (prefix || "").trim().toUpperCase();
  const schedule: Record<DlbWeekday, DlbGameDayMapping> = {} as Record<DlbWeekday, DlbGameDayMapping>;
  for (const day of DLB_WEEKDAYS) {
    const s = STANDARD_WEEKDAY_SUFFIXES[day];
    schedule[day] = {
      erp: p ? `${p}${s.erp}` : "",
      official: p ? `${p}${s.official}` : "",
    };
  }
  return schedule;
}

export const DEFAULT_DLB_GAMES: DlbGame[] = [
  {
    id: "lagna_wasana",
    name: "Lagna Wasana",
    prefix: "LW",
    isDefault: true,
    days: {
      Monday: { erp: "LWM", official: "LMO" },
      Tuesday: { erp: "LWA", official: "LWT" },
      Wednesday: { erp: "LWW", official: "LWW" },
      Thursday: { erp: "LWB", official: "LTH" },
      Friday: { erp: "LWF", official: "LWF" },
      Saturday: { erp: "LWS", official: "LSA" },
      Sunday: { erp: "LWI", official: "LWS" },
    },
  },
  {
    id: "ada_kotipathi",
    name: "Ada Kotipathi",
    prefix: "AK",
    isDefault: true,
    days: {
      Monday: { erp: "AKM", official: "AMO" },
      Tuesday: { erp: "AKA", official: "ATU" },
      Wednesday: { erp: "AKW", official: "AWD" },
      Thursday: { erp: "AKT", official: "ATH" },
      Friday: { erp: "AKF", official: "AFR" },
      Saturday: { erp: "AKS", official: "ASA" },
      Sunday: { erp: "AKI", official: "ASU" },
    },
  },
  {
    id: "shanida",
    name: "Shanida Fortune",
    prefix: "SF",
    isDefault: true,
    days: {
      Monday: { erp: "SFM", official: "SFM" },
      Tuesday: { erp: "SFA", official: "SFT" },
      Wednesday: { erp: "SFW", official: "SFW" },
      Thursday: { erp: "SFT", official: "SFH" },
      Friday: { erp: "SFF", official: "SFR" },
      Saturday: { erp: "SFS", official: "SFS" },
      Sunday: { erp: "SFI", official: "SFU" },
    },
  },
  {
    id: "super_ball",
    name: "Super Ball",
    prefix: "SB",
    isDefault: true,
    days: {
      Monday: { erp: "SBM", official: "SBM" },
      Tuesday: { erp: "SBA", official: "BTU" },
      Wednesday: { erp: "SBW", official: "SBW" },
      Thursday: { erp: "SBT", official: "SBT" },
      Friday: { erp: "SBF", official: "SBF" },
      Saturday: { erp: "SBS", official: "SBS" },
      Sunday: { erp: "SBI", official: "SSU" },
    },
  },
  {
    id: "kapruka",
    name: "Kapruka",
    prefix: "KT",
    isDefault: true,
    days: {
      Monday: { erp: "KTM", official: "KPM" },
      Tuesday: { erp: "KTT", official: "KPT" },
      Wednesday: { erp: "KTW", official: "KPW" },
      Thursday: { erp: "KTB", official: "KTH" },
      Friday: { erp: "KTF", official: "KPF" },
      Saturday: { erp: "KTS", official: "KSA" },
      Sunday: { erp: "KTI", official: "KPS" },
    },
  },
  {
    id: "development_fortune",
    name: "Development Fortune",
    prefix: "SP",
    isDefault: true,
    days: {
      Monday: { erp: "SPM", official: "SRM" },
      Tuesday: { erp: "SPA", official: "SRT" },
      Wednesday: { erp: "SPW", official: "SWD" },
      Thursday: { erp: "SPT", official: "STH" },
      Friday: { erp: "SPF", official: "SRF" },
      Saturday: { erp: "SPS", official: "SRS" },
      Sunday: { erp: "SPI", official: "SRU" },
    },
  },
  {
    id: "dhana_nidhanaya",
    name: "Dhana Nidhanaya",
    prefix: "V",
    isDefault: true,
    days: {
      Monday: { erp: "VM", official: "DMO" },
      Tuesday: { erp: "VA", official: "DTU" },
      Wednesday: { erp: "VW", official: "DWD" },
      Thursday: { erp: "VT", official: "DTH" },
      Friday: { erp: "VF", official: "DFI" },
      Saturday: { erp: "VS", official: "DSA" },
      Sunday: { erp: "VI", official: "DSU" },
    },
  },
  {
    id: "jayoda",
    name: "Jayoda",
    prefix: "S",
    isDefault: true,
    days: {
      Monday: { erp: "SM", official: "JMO" },
      Tuesday: { erp: "SA", official: "JST" },
      Wednesday: { erp: "SW", official: "JSW" },
      Thursday: { erp: "ST", official: "JTH" },
      Friday: { erp: "SF", official: "JFR" },
      Saturday: { erp: "SS", official: "JSA" },
      Sunday: { erp: "SI", official: "JSU" },
    },
  },
  {
    id: "wasi",
    name: "Wasi",
    prefix: "W",
    isDefault: true,
    days: {
      Monday: { erp: "WM", official: "WMO" },
      Tuesday: { erp: "WA", official: "WTU" },
      Wednesday: { erp: "WW", official: "WWD" },
      Thursday: { erp: "WT", official: "WTH" },
      Friday: { erp: "WF", official: "WFR" },
      Saturday: { erp: "WS", official: "WSA" },
      Sunday: { erp: "WI", official: "WSU" },
    },
  },
];

const FIRESTORE_COLLECTION = "dlb_lottery_config";
const FIRESTORE_DOC = "games_master";
const LOCAL_STORAGE_KEY = "dlb_custom_lottery_games";

/**
 * Compile DlbGame[] into standard ERP_GAME_MAP shape
 */
export function compileErpGameMap(
  games: DlbGame[]
): Record<DlbWeekday, Record<string, string>> {
  const map: Record<DlbWeekday, Record<string, string>> = {
    Monday: {},
    Tuesday: {},
    Wednesday: {},
    Thursday: {},
    Friday: {},
    Saturday: {},
    Sunday: {},
  };

  for (const g of games) {
    for (const day of DLB_WEEKDAYS) {
      const entry = g.days?.[day];
      if (entry?.erp && entry?.official) {
        const erpClean = entry.erp.trim().toUpperCase();
        const offClean = entry.official.trim().toUpperCase();
        if (erpClean && offClean) {
          map[day][erpClean] = offClean;
        }
      }
    }
  }

  return map;
}

/**
 * Load all DLB games: tries Firestore first, falls back to localStorage, then defaults.
 * Also synchronizes the runtime ERP_GAME_MAP in memory.
 */
export async function loadDlbGames(): Promise<DlbGame[]> {
  let games: DlbGame[] = DEFAULT_DLB_GAMES;

  try {
    const ref = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC);
    const snap = await getDoc(ref);
    if (snap.exists() && Array.isArray(snap.data()?.games)) {
      games = snap.data().games;
    } else {
      // Check localStorage fallback
      if (typeof window !== "undefined") {
        const local = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed) && parsed.length > 0) {
            games = parsed;
          }
        }
      }
    }
  } catch (err) {
    console.warn("Firestore fetch failed for DLB games, using fallback:", err);
    if (typeof window !== "undefined") {
      const local = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (local) {
        try {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) games = parsed;
        } catch {
          // ignore
        }
      }
    }
  }

  // Synchronize in-memory map
  const compiled = compileErpGameMap(games);
  updateActiveGameMap(compiled);

  return games;
}

/**
 * Persist the entire games list to Firestore and localStorage
 */
async function persistGames(games: DlbGame[]): Promise<void> {
  // Update localStorage immediately
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(games));
    } catch {
      // ignore
    }
  }

  // Update in-memory auto-detection map immediately
  const compiled = compileErpGameMap(games);
  updateActiveGameMap(compiled);

  // Sync to Firestore
  try {
    const ref = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC);
    await setDoc(ref, {
      games,
      compiledMap: compiled,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn("Failed saving DLB games to Firestore:", err);
  }
}

/**
 * Add or update a DLB game
 */
export async function saveDlbGame(game: DlbGame): Promise<DlbGame[]> {
  const current = await loadDlbGames();
  const existingIdx = current.findIndex(
    (g) => g.id === game.id || g.name.toLowerCase() === game.name.toLowerCase()
  );

  const updatedGame: DlbGame = {
    ...game,
    id: game.id || game.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    updatedAt: Date.now(),
  };

  let nextGames: DlbGame[];
  if (existingIdx >= 0) {
    nextGames = [...current];
    nextGames[existingIdx] = updatedGame;
  } else {
    nextGames = [...current, updatedGame];
  }

  await persistGames(nextGames);
  return nextGames;
}

/**
 * Delete a DLB game by ID
 */
export async function deleteDlbGame(gameId: string): Promise<DlbGame[]> {
  const current = await loadDlbGames();
  const nextGames = current.filter((g) => g.id !== gameId);
  await persistGames(nextGames);
  return nextGames;
}

/**
 * Reset DLB games back to the original built-in defaults
 */
export async function resetDlbGamesToDefaults(): Promise<DlbGame[]> {
  await persistGames(DEFAULT_DLB_GAMES);
  return DEFAULT_DLB_GAMES;
}

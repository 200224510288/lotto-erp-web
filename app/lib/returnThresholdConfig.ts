// app/lib/returnThresholdConfig.ts
// Cloud Firestore persistence & management service for DLB Return Thresholds per lottery.
// Defaults standard lotteries to 5.0% and special lotteries (Lagna, Super Ball, Kapruka) to 10.0%.
// Allows customizing thresholds by selecting each lottery, saved directly to Firebase Firestore.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { isSpecialTenPercentLottery } from "./gameAutoSelect";

export interface DlbLotteryInfo {
  id: string;          // slug e.g. "ada_kotipathi"
  name: string;        // "Ada Kotipathi"
  sinhalaName: string; // "අද කෝටිපති"
  defaultLimit: number;// 5.0 or 10.0
  aliases: string[];   // codes & aliases
}

export const DLB_LOTTERY_LIST: DlbLotteryInfo[] = [
  {
    id: "ada_kotipathi",
    name: "Ada Kotipathi",
    sinhalaName: "අද කෝටිපති",
    defaultLimit: 5.0,
    aliases: [
      "AK", "AMO", "AKM", "AKA", "AKW", "AKT", "AKF", "AKS", "AKI",
      "ATU", "AWD", "ATH", "AFR", "ASA", "ASU", "ADA KOTIPATHI", "අද කෝටිපති",
    ],
  },
  {
    id: "kapruka",
    name: "Kapruka",
    sinhalaName: "කප්රුක",
    defaultLimit: 10.0,
    aliases: [
      "KP", "KT", "KPM", "KPT", "KPW", "KTH", "KPF", "KSA", "KPS",
      "KTM", "KTT", "KTW", "KTB", "KTF", "KTS", "KTI",
      "KAPRUKA", "KAPURUKA", "KOTI KAPRUKA", "කප්රුක",
    ],
  },
  {
    id: "lagna_wasana",
    name: "Lagna Wasana",
    sinhalaName: "ලග්න වාසනාව",
    defaultLimit: 10.0,
    aliases: [
      "LW", "LWM", "LWA", "LWW", "LWB", "LWF", "LWS", "LWI",
      "LMO", "LWT", "LTH", "LSA",
      "LAGNA", "LAGANA", "LAGNA WASANA", "ලග්න",
    ],
  },
  {
    id: "sasiri",
    name: "Sasiri",
    sinhalaName: "සසිරි",
    defaultLimit: 5.0,
    aliases: [
      "SM", "SA", "SW", "ST", "SF", "SS", "SI",
      "JMO", "JST", "JSW", "JTH", "JFR", "JSA", "JSU",
      "SASIRI", "JAYODA", "සසිරි",
    ],
  },
  {
    id: "shanida",
    name: "Shanida Fortune",
    sinhalaName: "ශනිදා",
    defaultLimit: 5.0,
    aliases: [
      "SF", "SFM", "SFA", "SFW", "SFT", "SFF", "SFS", "SFI",
      "SFH", "SFR", "SFU", "SHANIDA", "ශනිදා",
    ],
  },
  {
    id: "super_ball",
    name: "Super Ball",
    sinhalaName: "සුපර් බෝල්",
    defaultLimit: 10.0,
    aliases: [
      "SB", "SBM", "SBA", "SBW", "SBT", "SBF", "SBS", "SBI",
      "BTU", "SSU", "SUPER BALL", "SUPERBALL", "සුපර් බෝල්",
    ],
  },
  {
    id: "supiri_dhana",
    name: "Supiri Dhana Sampatha",
    sinhalaName: "සුපිරි ධන සම්පත",
    defaultLimit: 5.0,
    aliases: [
      "SP", "SR", "SPM", "SPA", "SPW", "SPT", "SPF", "SPS", "SPI",
      "SRM", "SRT", "SWD", "STH", "SRF", "SRS", "SRU",
      "DEVELOPMENT FORTUNE", "SUPIRI DHANA", "සුපිරි ධන සම්පත",
    ],
  },
  {
    id: "jaya_sampatha",
    name: "Jaya Sampatha",
    sinhalaName: "ජය සම්පත",
    defaultLimit: 5.0,
    aliases: [
      "V", "VM", "VA", "VW", "VT", "VF", "VS", "VI",
      "DMO", "DTU", "DWD", "DTH", "DFI", "DSA", "DSU",
      "DHANA NIDHANAYA", "JAYA SAMPATHA", "ජය සම්පත",
    ],
  },
  {
    id: "wasi",
    name: "Wasi Fortune",
    sinhalaName: "වාසි",
    defaultLimit: 5.0,
    aliases: [
      "W", "WM", "WA", "WW", "WT", "WF", "WS", "WI",
      "WMO", "WTU", "WWD", "WTH", "WFR", "WSA", "WSU", "WASI", "වාසි",
    ],
  },
];

export interface ReturnThresholdConfig {
  defaultThreshold: number; // default: 5.0
  specialThreshold: number; // default: 10.0
  lotteryThresholds?: Record<string, number>; // per-lottery overrides by lottery id
  overrides?: Record<string, number>;
  waivedLotteries?: string[]; // IDs of lotteries waived/exempted by board
  updatedAt?: number;
  lastSavedBy?: string;
}

export const DEFAULT_RETURN_THRESHOLDS: ReturnThresholdConfig = {
  defaultThreshold: 5.0,
  specialThreshold: 10.0,
  lotteryThresholds: {},
  overrides: {},
  waivedLotteries: [],
};

export const FIRESTORE_SETTINGS_COLLECTION = "dlb_settings";
export const FIRESTORE_THRESHOLDS_DOC = "return_thresholds";
export const LOCAL_STORAGE_THRESHOLDS_KEY = "dlb_return_thresholds_cache";

/**
 * Identify lottery info from code, English name, or Sinhala name
 */
export function findLotteryInfo(gameOrName: string): DlbLotteryInfo | undefined {
  if (!gameOrName) return undefined;
  const s = gameOrName.trim().toUpperCase();
  const base = s.replace(/\.[^/.]+$/, ""); // strip extension e.g. "AKS.XLS" -> "AKS", "WS.XLS" -> "WS"

  // 1. Direct ID match
  const byId = DLB_LOTTERY_LIST.find((lot) => lot.id.toUpperCase() === s || lot.id.toUpperCase() === base);
  if (byId) return byId;

  // 2. Direct name match
  const byName = DLB_LOTTERY_LIST.find(
    (lot) =>
      lot.name.toUpperCase() === s ||
      lot.name.toUpperCase() === base ||
      lot.sinhalaName === gameOrName.trim()
  );
  if (byName) return byName;

  // 3. Alias exact match
  for (const lot of DLB_LOTTERY_LIST) {
    if (
      lot.aliases.includes(s) ||
      lot.aliases.includes(base) ||
      lot.aliases.includes(gameOrName.trim())
    ) {
      return lot;
    }
  }

  // 4. Substring alias match
  for (const lot of DLB_LOTTERY_LIST) {
    for (const a of lot.aliases) {
      if (
        (a.length >= 2 && (s === a || base === a)) ||
        (a.length >= 3 && (s.includes(a) || base.includes(a)))
      ) {
        return lot;
      }
    }
  }

  // 5. Special Sinhala prefix
  for (const lot of DLB_LOTTERY_LIST) {
    if (lot.sinhalaName && gameOrName.includes(lot.sinhalaName)) {
      return lot;
    }
  }

  return undefined;
}

/**
 * Get the active threshold for a specific lottery (from customized cloud settings or default)
 */
export function getLotteryThreshold(
  lotteryIdOrName: string,
  config?: ReturnThresholdConfig
): number {
  const lot = findLotteryInfo(lotteryIdOrName);
  const cfg = config || DEFAULT_RETURN_THRESHOLDS;
  const dict = { ...(cfg.overrides || {}), ...(cfg.lotteryThresholds || {}) };

  if (lot) {
    if (typeof dict[lot.id] === "number" && dict[lot.id] > 0) {
      return dict[lot.id];
    }
    return lot.defaultLimit;
  }

  const key = (lotteryIdOrName || "").trim().toUpperCase();
  const baseKey = key.replace(/\.[^/.]+$/, "");
  if (typeof dict[key] === "number" && dict[key] > 0) {
    return dict[key];
  }
  if (typeof dict[baseKey] === "number" && dict[baseKey] > 0) {
    return dict[baseKey];
  }

  return isSpecialTenPercentLottery(lotteryIdOrName)
    ? (cfg.specialThreshold ?? 10.0)
    : (cfg.defaultThreshold ?? 5.0);
}

/**
 * Calculate the effective safe return limit for a specific lottery given the active thresholds
 */
export function getSafeReturnLimitForGame(
  gameOrName: string,
  thresholds?: ReturnThresholdConfig
): number {
  return getLotteryThreshold(gameOrName, thresholds);
}

/**
 * Check if a lottery is waived / exempted by board policy from the DLB Return % calculation
 */
export function isLotteryWaived(
  lotteryIdOrName: string,
  config?: ReturnThresholdConfig
): boolean {
  if (!config || !lotteryIdOrName) return false;
  const list = config.waivedLotteries || [];
  if (!Array.isArray(list) || list.length === 0) return false;

  const lot = findLotteryInfo(lotteryIdOrName);
  if (lot && list.includes(lot.id)) return true;

  const key = lotteryIdOrName.trim().toUpperCase();
  const baseKey = key.replace(/\.[^/.]+$/, "");
  if (list.includes(key) || list.includes(baseKey)) return true;

  const lower = lotteryIdOrName.trim().toLowerCase();
  const baseLower = lower.replace(/\.[^/.]+$/, "");
  if (list.includes(lower) || list.includes(baseLower)) return true;

  return false;
}

/**
 * Load return thresholds from Firestore (with localStorage cache fallback)
 */
export async function loadReturnThresholds(): Promise<ReturnThresholdConfig> {
  let cached: ReturnThresholdConfig | null = null;
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_THRESHOLDS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.defaultThreshold === "number") {
          cached = {
            defaultThreshold: parsed.defaultThreshold > 0 ? parsed.defaultThreshold : 5.0,
            specialThreshold:
              typeof parsed.specialThreshold === "number" && parsed.specialThreshold > 0
                ? parsed.specialThreshold
                : 10.0,
            lotteryThresholds: parsed.lotteryThresholds || parsed.overrides || {},
            overrides: parsed.overrides || parsed.lotteryThresholds || {},
            updatedAt: parsed.updatedAt,
          };
        }
      }
    } catch {
      // ignore
    }
  }

  try {
    const ref = doc(db, FIRESTORE_SETTINGS_COLLECTION, FIRESTORE_THRESHOLDS_DOC);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const data = snap.data();
      const defaultVal =
        typeof data?.defaultThreshold === "number" && data.defaultThreshold > 0
          ? data.defaultThreshold
          : 5.0;
      const specialVal =
        typeof data?.specialThreshold === "number" && data.specialThreshold > 0
          ? data.specialThreshold
          : 10.0;
      const dict =
        data?.lotteryThresholds && typeof data.lotteryThresholds === "object"
          ? data.lotteryThresholds
          : data?.overrides && typeof data.overrides === "object"
          ? data.overrides
          : {};
      const waivedArr = Array.isArray(data?.waivedLotteries) ? data.waivedLotteries : [];

      const cloudConfig: ReturnThresholdConfig = {
        defaultThreshold: defaultVal,
        specialThreshold: specialVal,
        lotteryThresholds: dict,
        overrides: dict,
        waivedLotteries: waivedArr,
        updatedAt: data?.updatedAt || Date.now(),
        lastSavedBy: data?.lastSavedBy,
      };

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(LOCAL_STORAGE_THRESHOLDS_KEY, JSON.stringify(cloudConfig));
        } catch {
          // ignore
        }
      }

      return cloudConfig;
    } else {
      const initialConfig = cached || { ...DEFAULT_RETURN_THRESHOLDS, updatedAt: Date.now() };
      try {
        await setDoc(ref, initialConfig, { merge: true });
      } catch (e) {
        console.warn("Could not auto-initialize cloud thresholds:", e);
      }
      return initialConfig;
    }
  } catch (err) {
    console.warn("Failed to load thresholds from Cloud Firestore, using fallback:", err);
    return cached || DEFAULT_RETURN_THRESHOLDS;
  }
}

/**
 * Persist return thresholds to Cloud Firestore and localStorage
 */
export async function saveReturnThresholds(
  updates: Partial<ReturnThresholdConfig>
): Promise<ReturnThresholdConfig> {
  const current = await loadReturnThresholds();

  const nextDefault =
    typeof updates.defaultThreshold === "number" &&
    !isNaN(updates.defaultThreshold) &&
    updates.defaultThreshold > 0
      ? updates.defaultThreshold
      : current.defaultThreshold;

  const nextSpecial =
    typeof updates.specialThreshold === "number" &&
    !isNaN(updates.specialThreshold) &&
    updates.specialThreshold > 0
      ? updates.specialThreshold
      : current.specialThreshold;

  const nextLotteryThresholds = {
    ...(current.lotteryThresholds || current.overrides || {}),
    ...(updates.lotteryThresholds || updates.overrides || {}),
  };

  const nextWaived =
    updates.waivedLotteries !== undefined
      ? updates.waivedLotteries
      : current.waivedLotteries || [];

  const updatedConfig: ReturnThresholdConfig = {
    defaultThreshold: nextDefault,
    specialThreshold: nextSpecial,
    lotteryThresholds: nextLotteryThresholds,
    overrides: nextLotteryThresholds,
    waivedLotteries: nextWaived,
    updatedAt: Date.now(),
    lastSavedBy: updates.lastSavedBy || "web-user",
  };

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LOCAL_STORAGE_THRESHOLDS_KEY, JSON.stringify(updatedConfig));
      window.dispatchEvent(
        new CustomEvent("dlb-thresholds-updated", { detail: updatedConfig })
      );
    } catch {
      // ignore
    }
  }

  try {
    const ref = doc(db, FIRESTORE_SETTINGS_COLLECTION, FIRESTORE_THRESHOLDS_DOC);
    await setDoc(ref, updatedConfig, { merge: true });
  } catch (err) {
    console.error("Failed saving thresholds to Cloud Firestore:", err);
    throw err;
  }

  return updatedConfig;
}

/**
 * Save customized threshold for a single selected lottery to Cloud Firestore
 */
export async function saveSingleLotteryThreshold(
  lotteryId: string,
  limit: number
): Promise<ReturnThresholdConfig> {
  const current = await loadReturnThresholds();
  const nextLotteryThresholds = {
    ...(current.lotteryThresholds || current.overrides || {}),
    [lotteryId]: limit,
  };
  return saveReturnThresholds({
    lotteryThresholds: nextLotteryThresholds,
    overrides: nextLotteryThresholds,
  });
}

/**
 * Toggle board waiver (exclusion from Return % calculation) for a lottery
 */
export async function toggleLotteryWaiver(
  lotteryIdOrName: string,
  explicitWaived?: boolean
): Promise<ReturnThresholdConfig> {
  const current = await loadReturnThresholds();
  const lot = findLotteryInfo(lotteryIdOrName);
  const targetId = lot ? lot.id : lotteryIdOrName.trim().toLowerCase();

  const currentWaived = new Set(current.waivedLotteries || []);
  const shouldWaive =
    explicitWaived !== undefined ? explicitWaived : !currentWaived.has(targetId);

  if (shouldWaive) {
    currentWaived.add(targetId);
  } else {
    currentWaived.delete(targetId);
  }

  return saveReturnThresholds({
    waivedLotteries: Array.from(currentWaived),
  });
}

/**
 * Reset thresholds back to official defaults
 */
export async function resetReturnThresholds(): Promise<ReturnThresholdConfig> {
  return saveReturnThresholds({
    defaultThreshold: 5.0,
    specialThreshold: 10.0,
    lotteryThresholds: {},
    overrides: {},
    waivedLotteries: [],
  });
}

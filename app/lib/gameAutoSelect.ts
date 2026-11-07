// app/lib/gameAutoMap.ts

export const ERP_GAME_MAP: Record<string, Record<string, string>> = {
  Monday: {
    LWM: "LMO",
    AKM: "AMO",
    SFM: "SFM",
    SBM: "SBM",
    KTM: "KPM",
    SPM: "SRM",
    VM: "DMO",
    SM: "JMO",
    WM: "WMO",
  },
  Tuesday: {
    LWA: "LWT",
    AKA: "ATU",
    SFA: "SFT",
    SBA: "BTU",
    KTT: "KPT",
    SPA: "SRT",
    VA: "DTU",
    SA: "JST",
    WA: "WTU",
  },
  Wednesday: {
    LWW: "LWW",
    AKW: "AWD",
    SFW: "SFW",
    SBW: "SBW",
    KTW: "KPW",
    SPW: "SWD",
    VW: "DWD",
    SW: "JSW",
    WW: "WWD",
  },
  Thursday: {
    LWB: "LTH",
    AKT: "ATH",
    SFT: "SFH",
    SBT: "SBT",
    KTB: "KTH",
    SPT: "STH",
    VT: "DTH",
    ST: "JTH",
    WT: "WTH",
  },
  Friday: {
    LWF: "LWF",
    AKF: "AFR",
    SFF: "SFR",
    SBF: "SBF",
    KTF: "KPF",
    SPF: "SRF",
    VF: "DFI",
    SF: "JFR",
    WF: "WFR",
  },
  Saturday: {
    LWS: "LSA",
    AKS: "ASA",
    SFS: "SFS",
    SBS: "SBS",
    KTS: "KSA",
    SPS: "SRS",
    VS: "DSA",
    SS: "JSA",
    WS: "WSA",
  },
  Sunday: {
    LWI: "LWS",
    AKI: "ASU",
    SFI: "SFU",
    SBI: "SSU",
    KTI: "KPS",
    SPI: "SRU",
    VI: "DSU",
    SI: "JSU",
    WI: "WSU",
  },
};

export type DayName = keyof typeof ERP_GAME_MAP;

export function getDayFromDate(dateYYYYMMDD: string): DayName {
  const d = dateYYYYMMDD ? new Date(dateYYYYMMDD) : new Date();
  return d.toLocaleDateString("en-US", { weekday: "long" }) as DayName;
}

function normalizeFileName(fileName: string): string {
  // keep underscores/dashes, remove extension, uppercase
  const base = (fileName || "").replace(/\.[^/.]+$/, "");
  return base.toUpperCase();
}

function allERPCodes(): string[] {
  const set = new Set<string>();
  for (const day of Object.keys(ERP_GAME_MAP) as DayName[]) {
    for (const code of Object.keys(ERP_GAME_MAP[day])) set.add(code);
  }
  // prefer longer matches first (SFW before SW)
  return Array.from(set).sort((a, b) => b.length - a.length);
}

export function findDaysForERP(erpCode: string): DayName[] {
  const key = (erpCode || "").toUpperCase();
  const days: DayName[] = [];

  for (const day of Object.keys(ERP_GAME_MAP) as DayName[]) {
    if (ERP_GAME_MAP[day]?.[key]) days.push(day);
  }
  return days;
}

export function detectERPCodeFromFileNameAnyDay(fileName: string): string | null {
  const upper = normalizeFileName(fileName);
  const codes = allERPCodes();

  // 1) substring scan (safe because we sort by length desc)
  for (const code of codes) {
    if (upper.includes(code)) return code;
  }

  // 2) token scan (secondary)
  const re = /(?:^|[^A-Z])([A-Z]{2,3})(?=[^A-Z]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(upper)) !== null) {
    const t = m[1];
    if (findDaysForERP(t).length > 0) return t;
  }

  return null;
}

export function mapERPToOfficial(day: DayName, erpCode: string): string | null {
  const key = (erpCode || "").toUpperCase();
  return ERP_GAME_MAP?.[day]?.[key] ?? null;
}

export type SuggestResult =
  | {
      status: "ok";
      selectedDay: DayName;
      erp: string;
      detectedDay: DayName;
      official: string;
      note: string;
    }
  | {
      status: "mismatch_day";
      selectedDay: DayName;
      erp: string;
      detectedDay: DayName;
      official: string;
      note: string;
    }
  | {
      status: "ambiguous";
      selectedDay: DayName;
      erp: string;
      days: DayName[];
      note: string;
    }
  | {
      status: "not_found";
      selectedDay: DayName;
      note: string;
    };

export function suggestGameFromFileName(fileName: string, dateYYYYMMDD: string): SuggestResult {
  const selectedDay = getDayFromDate(dateYYYYMMDD);
  const erp = detectERPCodeFromFileNameAnyDay(fileName);

  if (!erp) {
    return {
      status: "not_found",
      selectedDay,
      note: `ERROR: Cannot detect ERP game code from file name "${fileName}". Rename the file to include a valid code (e.g., SFA, AKW, LWM).`,
    };
  }

  const days = findDaysForERP(erp);
  if (days.length === 0) {
    return {
      status: "not_found",
      selectedDay,
      note: `ERROR: ERP code "${erp}" is not in your mapping table.`,
    };
  }

  // If code appears in multiple days (ex: VI), require selectedDay to decide
  if (days.length > 1) {
    const officialForSelected = mapERPToOfficial(selectedDay, erp);
    if (!officialForSelected) {
      return {
        status: "ambiguous",
        selectedDay,
        erp,
        days,
        note: `ERROR: ERP code "${erp}" exists in multiple days (${days.join(
          ", "
        )}). Selected date is ${selectedDay} but mapping is not available for that day. Fix the date or rename file.`,
      };
    }
    return {
      status: "ok",
      selectedDay,
      erp,
      detectedDay: selectedDay,
      official: officialForSelected,
      note: `Auto-detected: ERP=${erp} → OFFICIAL=${officialForSelected} (using selected day ${selectedDay})`,
    };
  }

  const detectedDay = days[0];
  const official = mapERPToOfficial(detectedDay, erp);

  if (!official) {
    return {
      status: "not_found",
      selectedDay,
      note: `ERROR: Could not map ERP "${erp}" for day "${detectedDay}".`,
    };
  }

  if (detectedDay !== selectedDay) {
    return {
      status: "mismatch_day",
      selectedDay,
      erp,
      detectedDay,
      official,
      note: `ERROR: File name indicates ${detectedDay} (ERP=${erp} → ${official}) but selected business date is ${selectedDay}. Change the date or upload the correct file.`,
    };
  }

  return {
    status: "ok",
    selectedDay,
    erp,
    detectedDay,
    official,
    note: `Auto-detected: ${selectedDay} ERP=${erp} → OFFICIAL=${official}`,
  };
}

/**
 * Update the active in-memory ERP game map dynamically (e.g. from Firestore/config modal)
 */
export function updateActiveGameMap(newMap: Record<string, Record<string, string>>): void {
  for (const day of Object.keys(ERP_GAME_MAP)) {
    delete ERP_GAME_MAP[day];
  }
  for (const [day, dayObj] of Object.entries(newMap)) {
    ERP_GAME_MAP[day] = { ...dayObj };
  }
}

/**
 * Returns the sorted list of official games from the active game map
 */
export function getActiveOfficialGames(customMap?: Record<string, Record<string, string>>): { id: string; name: string }[] {
  const map = customMap || ERP_GAME_MAP;
  const set = new Set<string>();
  for (const day of Object.keys(map) as DayName[]) {
    if (map[day]) {
      for (const official of Object.values(map[day])) {
        if (official) set.add(official.toUpperCase());
      }
    }
  }
  return Array.from(set)
    .sort((a, b) => a.localeCompare(b))
    .map((x) => ({ id: x, name: x }));
}

// Build official game list for dropdown (default fallback)
export const OFFICIAL_GAMES: { id: string; name: string }[] = (() => {
  return getActiveOfficialGames();
})();

/**
 * Returns true if the lottery has a 10% safe return limit (Lagna, Super Ball, Kapruka).
 * All other lotteries have a standard 5% safe return limit.
 */
export function isSpecialTenPercentLottery(gameOrName: string): boolean {
  if (!gameOrName) return false;
  const s = gameOrName.trim().toUpperCase();

  // Sinhala names
  if (
    gameOrName.includes("ලග්න") ||
    gameOrName.includes("සුපර් බෝල්") ||
    gameOrName.includes("සුපර්බෝල්") ||
    gameOrName.includes("කප්රුක")
  ) {
    return true;
  }

  // English names
  if (
    s.includes("LAGNA") ||
    s.includes("LAGANA") ||
    s.includes("SUPER BALL") ||
    s.includes("SUPERBALL") ||
    s.includes("SUPER-BALL") ||
    s.includes("KAPRUKA") ||
    s.includes("KAPURUKA")
  ) {
    return true;
  }

  // ERP & Official codes for Lagna
  const lagnaCodes = ["LWM", "LWA", "LWW", "LWB", "LWF", "LWS", "LWI", "LMO", "LWT", "LTH", "LSA"];

  // ERP & Official codes for Super Ball
  const superBallCodes = ["SBM", "SBA", "SBW", "SBT", "SBF", "SBS", "SBI", "BTU", "SSU"];

  // ERP & Official codes for Kapruka
  const kaprukaCodes = [
    "KTM", "KTT", "KTW", "KTB", "KTF", "KTS", "KTI",
    "KPM", "KPT", "KPW", "KTH", "KPF", "KSA", "KPS",
  ];

  if (lagnaCodes.includes(s) || superBallCodes.includes(s) || kaprukaCodes.includes(s)) {
    return true;
  }

  // Prefix matching
  if (s.startsWith("LW") || s.startsWith("SB") || s.startsWith("KT") || s.startsWith("KP")) {
    return true;
  }

  return false;
}

/**
 * Returns the statutory or cloud-configured safe return percentage limit for a given lottery:
 * - Special lotteries (Lagna, Super Ball, and Kapruka): specialThreshold (default 10.0%)
 * - Standard lotteries: defaultThreshold (default 5.0%)
 */
export function getGameSafeReturnLimit(
  gameOrName: string,
  thresholds?: {
    defaultThreshold?: number;
    specialThreshold?: number;
    lotteryThresholds?: Record<string, number>;
    overrides?: Record<string, number>;
  }
): number {
  if (thresholds) {
    const dict = { ...(thresholds.overrides || {}), ...(thresholds.lotteryThresholds || {}) };
    const key = (gameOrName || "").trim().toUpperCase();
    const baseKey = key.replace(/\.[^/.]+$/, "");
    const lowerKey = (gameOrName || "").trim().toLowerCase();

    // 1. Direct key match (e.g. "KAPURUKA", "KAPURUKA_MONDAY", "KPM", "kapruka")
    if (typeof dict[key] === "number" && dict[key] > 0) return dict[key];
    if (typeof dict[baseKey] === "number" && dict[baseKey] > 0) return dict[baseKey];
    if (typeof dict[lowerKey] === "number" && dict[lowerKey] > 0) return dict[lowerKey];

    // 2. Keyword matching for official lottery families with ALL ERP daily codes & Saturday codes
    const families: Record<string, string[]> = {
      kapruka: [
        "KAPRUKA", "KAPURUKA", "KOTI KAPRUKA", "කප්රුක",
        "KP", "KT", "KPM", "KPT", "KPW", "KTH", "KPF", "KSA", "KPS",
        "KTM", "KTT", "KTW", "KTB", "KTF", "KTS", "KTI",
      ],
      lagna_wasana: [
        "LAGNA", "LAGANA", "LAGNA WASANA", "ලග්න",
        "LW", "LWM", "LWA", "LWW", "LWB", "LWF", "LWS", "LWI",
        "LMO", "LWT", "LTH", "LSA",
      ],
      super_ball: [
        "SUPER BALL", "SUPERBALL", "සුපර් බෝල්",
        "SB", "SBM", "SBA", "SBW", "SBT", "SBF", "SBS", "SBI",
        "BTU", "SSU",
      ],
      ada_kotipathi: [
        "ADA KOTIPATHI", "අද කෝටිපති",
        "AK", "AMO", "AKM", "AKA", "AKW", "AKT", "AKF", "AKS", "AKI",
        "ATU", "AWD", "ATH", "AFR", "ASA", "ASU",
      ],
      shanida: [
        "SHANIDA", "ශනිදා",
        "SF", "SFM", "SFA", "SFW", "SFT", "SFF", "SFS", "SFI",
        "SFH", "SFR", "SFU",
      ],
      sasiri: [
        "SASIRI", "JAYODA", "සසිරි",
        "SM", "SA", "SW", "ST", "SF", "SS", "SI",
        "JMO", "JST", "JSW", "JTH", "JFR", "JSA", "JSU",
      ],
      supiri_dhana: [
        "SUPIRI DHANA", "DEVELOPMENT FORTUNE", "සුපිරි ධන සම්පත",
        "SP", "SR", "SPM", "SPA", "SPW", "SPT", "SPF", "SPS", "SPI",
        "SRM", "SRT", "SWD", "STH", "SRF", "SRS", "SRU",
      ],
      jaya_sampatha: [
        "JAYA SAMPATHA", "DHANA NIDHANAYA", "ජය සම්පත",
        "V", "VM", "VA", "VW", "VT", "VF", "VS", "VI",
        "DMO", "DTU", "DWD", "DTH", "DFI", "DSA", "DSU",
      ],
      wasi: [
        "WASI", "WAASI", "වාසි",
        "W", "WM", "WA", "WW", "WT", "WF", "WS", "WI",
        "WMO", "WTU", "WWD", "WTH", "WFR", "WSA", "WSU",
      ],
    };

    for (const [lotteryId, aliases] of Object.entries(families)) {
      if (typeof dict[lotteryId] === "number" && dict[lotteryId] > 0) {
        for (const alias of aliases) {
          if (
            key === alias ||
            baseKey === alias ||
            (alias.length >= 3 && (key.includes(alias) || baseKey.includes(alias))) ||
            gameOrName.includes(alias)
          ) {
            return dict[lotteryId];
          }
        }
      }
    }

    if (isSpecialTenPercentLottery(gameOrName)) {
      return typeof thresholds.specialThreshold === "number" && thresholds.specialThreshold > 0
        ? thresholds.specialThreshold
        : 10.0;
    }
    return typeof thresholds.defaultThreshold === "number" && thresholds.defaultThreshold > 0
      ? thresholds.defaultThreshold
      : 5.0;
  }
  return isSpecialTenPercentLottery(gameOrName) ? 10.0 : 5.0;
}

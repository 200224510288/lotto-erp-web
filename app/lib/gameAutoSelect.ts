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
  },
  Thursday: {
    LWB: "LTH",
    AKT: "ATH",
    SFT: "SFH",
    SBT: "SBT",
    KTB: "KTH",
    SPT: "STH",
    VI: "DTH",
    ST: "JTH",
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

// Build official game list for dropdown (if you still want to display it)
export const OFFICIAL_GAMES: { id: string; name: string }[] = (() => {
  const set = new Set<string>();
  for (const day of Object.keys(ERP_GAME_MAP) as DayName[]) {
    for (const official of Object.values(ERP_GAME_MAP[day])) set.add(official);
  }
  return Array.from(set)
    .sort((a, b) => a.localeCompare(b))
    .map((x) => ({ id: x, name: x }));
})();

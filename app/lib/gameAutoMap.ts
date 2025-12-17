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

export function getDayFromDate(dateYYYYMMDD: string): keyof typeof ERP_GAME_MAP {
  const d = dateYYYYMMDD ? new Date(dateYYYYMMDD) : new Date();
  return d.toLocaleDateString("en-US", { weekday: "long" }) as keyof typeof ERP_GAME_MAP;
}

/**
 * Detect an ERP code from file name (case-insensitive),
 * but only if the code exists for that weekday (prevents wrong matches).
 */
export function detectERPCodeFromFileNameForDay(
  fileName: string,
  day: keyof typeof ERP_GAME_MAP
): string | null {
  const dayMap = ERP_GAME_MAP[day] || {};
  const allowed = Object.keys(dayMap);
  if (allowed.length === 0) return null;

  const upper = (fileName || "").toUpperCase();

  // 0) SAFE substring scan FIRST (prefer longer codes like SFW before SW)
  const allowedSorted = [...allowed].sort((a, b) => b.length - a.length);
  for (const code of allowedSorted) {
    if (upper.includes(code)) return code;
  }

  // 1) token match (kept as secondary)
  const re = /(?:^|[^A-Z])([A-Z]{2,3})(?=[^A-Z]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(upper)) !== null) {
    const t = m[1];
    if (dayMap[t]) return t;
  }

  return null;
}


export function mapERPToOfficial(day: keyof typeof ERP_GAME_MAP, erpCode: string): string | null {
  const key = (erpCode || "").toUpperCase();
  return ERP_GAME_MAP?.[day]?.[key] ?? null;
}

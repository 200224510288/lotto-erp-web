// app/lib/nlbPcProfileConfig.ts
// Configuration service for NLB PC Profiles — maps lottery codes to PCs.
// Persisted to localStorage with Firestore sync.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface NlbPcProfile {
  id: string;       // e.g. "pc1", "pc2"
  name: string;     // Display name, e.g. "PC 1", "Cashier A"
  codes: string[];   // Assigned lottery codes, e.g. ["MSE", "ADE", "GSE"]
}

const FIRESTORE_COLLECTION = "nlb_game_config";
const FIRESTORE_DOC = "pc_profiles";
const LOCAL_STORAGE_KEY = "nlb_pc_profiles";
const LOCAL_ACTIVE_PC_KEY = "nlb_active_pc_id";

// Default profiles with sensible initial lottery split (customizable anytime)
const DEFAULT_PROFILES: NlbPcProfile[] = [
  {
    id: "pc1",
    name: "PC 1",
    codes: ["DL", "GDL", "JB", "LMD", "MD", "MG", "MSE", "NL"],
  },
  {
    id: "pc2",
    name: "PC 2",
    codes: ["NZ", "SBD", "SW", "VZ", "ADE", "DH", "GSE", "SE", "SR"],
  },
];

let inMemoryProfiles: NlbPcProfile[] = [...DEFAULT_PROFILES];

export function getCachedPcProfiles(): NlbPcProfile[] {
  return inMemoryProfiles;
}

export function getLocalActivePcId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LOCAL_ACTIVE_PC_KEY) || null;
}

export function setLocalActivePcId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) {
    localStorage.setItem(LOCAL_ACTIVE_PC_KEY, id);
  } else {
    localStorage.removeItem(LOCAL_ACTIVE_PC_KEY);
  }
}

/**
 * Load PC profiles from Firestore with localStorage fallback
 */
export async function loadPcProfiles(): Promise<NlbPcProfile[]> {
  let profiles: NlbPcProfile[] = DEFAULT_PROFILES;

  try {
    const ref = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC);
    const snap = await getDoc(ref);
    if (snap.exists() && Array.isArray(snap.data()?.profiles)) {
      profiles = snap.data().profiles;
    } else {
      if (typeof window !== "undefined") {
        const local = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed) && parsed.length > 0) {
            profiles = parsed;
          }
        }
      }
    }
  } catch (err) {
    console.warn("Firestore fetch failed for PC profiles, using fallback:", err);
    if (typeof window !== "undefined") {
      const local = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (local) {
        try {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) profiles = parsed;
        } catch {
          // ignore
        }
      }
    }
  }

  // If profiles exist but all codes are completely empty, assign sensible defaults
  if (profiles.length > 0 && profiles.every((p) => !p.codes || p.codes.length === 0)) {
    profiles = DEFAULT_PROFILES;
  }

  inMemoryProfiles = profiles;
  return profiles;
}

/**
 * Persist PC profiles to both localStorage and Firestore
 */
async function persistPcProfiles(profiles: NlbPcProfile[]): Promise<void> {
  inMemoryProfiles = profiles;

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profiles));
    } catch {
      // ignore
    }
  }

  try {
    const ref = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC);
    await setDoc(ref, {
      profiles,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn("Failed saving PC profiles to Firestore:", err);
  }
}

/**
 * Save the full list of PC profiles
 */
export async function savePcProfiles(profiles: NlbPcProfile[]): Promise<NlbPcProfile[]> {
  // Normalize codes
  const cleaned = profiles.map((p) => ({
    ...p,
    codes: p.codes.map((c) => c.trim().toUpperCase()).filter(Boolean),
  }));
  await persistPcProfiles(cleaned);
  return cleaned;
}

/**
 * Add a new PC profile
 */
export async function addPcProfile(name: string): Promise<NlbPcProfile[]> {
  const current = await loadPcProfiles();
  const id = `pc${Date.now()}`;
  const newProfile: NlbPcProfile = { id, name: name.trim() || `PC ${current.length + 1}`, codes: [] };
  const updated = [...current, newProfile];
  await persistPcProfiles(updated);
  return updated;
}

/**
 * Remove a PC profile by id
 */
export async function removePcProfile(profileId: string): Promise<NlbPcProfile[]> {
  const current = await loadPcProfiles();
  const updated = current.filter((p) => p.id !== profileId);
  await persistPcProfiles(updated);
  return updated;
}

/**
 * Update a single PC profile's codes or name
 */
export async function updatePcProfile(
  profileId: string,
  patch: Partial<Pick<NlbPcProfile, "name" | "codes">>
): Promise<NlbPcProfile[]> {
  const current = await loadPcProfiles();
  const updated = current.map((p) => {
    if (p.id !== profileId) return p;
    return {
      ...p,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.codes !== undefined
        ? { codes: patch.codes.map((c) => c.trim().toUpperCase()).filter(Boolean) }
        : {}),
    };
  });
  await persistPcProfiles(updated);
  return updated;
}

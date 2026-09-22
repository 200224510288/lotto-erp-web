// app/lib/nlbAgentConfig.ts
// Completely separate configuration for NLB Agent Code mapping
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

const COLLECTION_NAME = "nlb_agent_config";
const MASTER_DOC_ID = "master";
const ALIASES_DOC_ID = "aliases";

// ------------------------------------------------
// Format / Normalize NLB Agent Code
// Standard NLB agent format is 'N' + 6 digits (e.g., N040064)
// Accepts "040064", "40064", "N040064", "n040064"
// ------------------------------------------------
export function formatNlbAgentCode(raw: string): string {
  if (!raw) return "";
  let s = raw.trim().toUpperCase().replace(/^NO/i, "N0");
  const nMatch = s.match(/^N(\d+)$/);
  if (nMatch) {
    return "N" + nMatch[1].padStart(6, "0");
  }
  const dMatch = s.match(/^\d+$/);
  if (dMatch) {
    return "N" + dMatch[0].padStart(6, "0");
  }
  return s;
}

// ------------------------------------------------
// Ensure master document exists
// ------------------------------------------------
async function ensureMasterDoc() {
  const ref = doc(db, COLLECTION_NAME, MASTER_DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { code: "N000000" });
  }
}

// ------------------------------------------------
// Ensure alias document exists with correct shape
// ------------------------------------------------
async function ensureAliasesDoc() {
  const ref = doc(db, COLLECTION_NAME, ALIASES_DOC_ID);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, { items: {} });
    return;
  }

  const data = snap.data();
  if (!data?.items || typeof data.items !== "object") {
    await setDoc(ref, { items: {} });
  }
}

// ------------------------------------------------
// Get NLB master agent code
// ------------------------------------------------
export async function getNlbMasterAgentCode(): Promise<string> {
  await ensureMasterDoc();
  const snap = await getDoc(doc(db, COLLECTION_NAME, MASTER_DOC_ID));
  return snap.data()?.code ?? "N000000";
}

// ------------------------------------------------
// Set NLB master agent code
// ------------------------------------------------
export async function setNlbMasterAgentCode(code: string): Promise<void> {
  await ensureMasterDoc();
  const formatted = formatNlbAgentCode(code) || code.trim();
  await updateDoc(doc(db, COLLECTION_NAME, MASTER_DOC_ID), { code: formatted });
}

// ------------------------------------------------
// Get NLB agent alias mappings
// ------------------------------------------------
export async function getNlbAgentAliases(): Promise<Record<string, string>> {
  await ensureAliasesDoc();

  const snap = await getDoc(doc(db, COLLECTION_NAME, ALIASES_DOC_ID));
  const data = snap.data();

  if (!data?.items || typeof data.items !== "object") return {};

  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.items)) {
    if (typeof k === "string" && typeof v === "string") {
      clean[k] = v;
    }
  }

  return clean;
}

// ------------------------------------------------
// Update NLB agent alias mapping
// ------------------------------------------------
export async function updateNlbAgentAliases(map: Record<string, string>): Promise<void> {
  await ensureAliasesDoc();

  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (!k || !v) continue;
    const formattedKey = formatNlbAgentCode(k);
    const formattedVal = formatNlbAgentCode(v);
    clean[formattedKey] = formattedVal;
  }

  await updateDoc(doc(db, COLLECTION_NAME, ALIASES_DOC_ID), { items: clean });
}

// ------------------------------------------------
// Apply mapping: replace alias with mapped code if found
// ------------------------------------------------
export function applyNlbAgentMapping(
  agentCode: string,
  aliases?: Record<string, string>
): string {
  if (!agentCode || !aliases) return agentCode;
  const formatted = formatNlbAgentCode(agentCode);

  // Exact match on formatted code (e.g. "N040064")
  if (aliases[formatted]) return aliases[formatted];

  // Match on raw input
  if (aliases[agentCode]) return aliases[agentCode];

  // Match without leading "N" (e.g. "040064")
  const unPrefixed = formatted.replace(/^N/, "");
  if (aliases[unPrefixed]) return aliases[unPrefixed];

  return agentCode;
}

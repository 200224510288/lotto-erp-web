// lib/dealerConfig.ts
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

// ------------------------------------------------
// Ensure master document exists
// ------------------------------------------------
async function ensureMasterDoc() {
  const ref = doc(db, "dealer_config", "master");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { code: "000000" });
  }
}

// ------------------------------------------------
// Ensure alias document exists with correct shape
// ------------------------------------------------
async function ensureAliasesDoc() {
  const ref = doc(db, "dealer_config", "aliases");
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, { items: {} });
    return;
  }

  const data = snap.data();
  if (!data.items || typeof data.items !== "object") {
    await setDoc(ref, { items: {} });
  }
}

// ------------------------------------------------
// Get master dealer code
// ------------------------------------------------
export async function getMasterDealerCode(): Promise<string> {
  await ensureMasterDoc();
  const snap = await getDoc(doc(db, "dealer_config", "master"));
  return snap.data()?.code ?? "000000";
}

// ------------------------------------------------
// Set master dealer code
// ------------------------------------------------
export async function setMasterDealerCode(code: string) {
  await ensureMasterDoc();
  await updateDoc(doc(db, "dealer_config", "master"), { code });
}

// ------------------------------------------------
// Get alias mappings
// ------------------------------------------------
export async function getDealerAliases(): Promise<Record<string, string>> {
  await ensureAliasesDoc();

  const snap = await getDoc(doc(db, "dealer_config", "aliases"));
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
// Update alias mapping
// ------------------------------------------------
export async function updateDealerAliases(map: Record<string, string>) {
  await ensureAliasesDoc();

  const clean: Record<string, string> = {};

  for (const [k, v] of Object.entries(map || {})) {
    if (!k || !v) continue;
    clean[k.padStart(6, "0")] = v.padStart(6, "0");
  }

  await updateDoc(doc(db, "dealer_config", "aliases"), { items: clean });
}

// lib/dealerConfig.ts

// The main dealer that finally receives the sales
export const MASTER_DEALER_CODE = "030520";

/**
 * All alias dealers that should be treated as MASTER_DEALER_CODE.
 * You can edit this list any time without touching other code.
 */
export const dealerAliasMap: Record<string, string> = {
  "030589": MASTER_DEALER_CODE,
  "030802": MASTER_DEALER_CODE,
  // You can add more real numeric aliases here
  // "031000": MASTER_DEALER_CODE,
};

/**
 * Normalise any raw dealer code:
 * - strip spaces
 * - keep only digits
 * - pad to 6 digits
 * - map alias → master dealer if configured
 */
export function normalizeDealerCode(raw: string): string {
  let code = raw.trim();
  if (!code) return code;

  // only digits
  code = code.replace(/[^\d]/g, "");

  // normalise to 6 digits
  code = code.padStart(6, "0");

  // alias map
  return dealerAliasMap[code] ?? code;
}

// Optional: config validation (runs once at build/server start)
(function validateDealerConfig() {
  const codeRegex = /^\d{6}$/;

  if (!codeRegex.test(MASTER_DEALER_CODE)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[dealerConfig] MASTER_DEALER_CODE is invalid: ${MASTER_DEALER_CODE}`
    );
  }

  for (const [alias, target] of Object.entries(dealerAliasMap)) {
    if (!codeRegex.test(alias) || !codeRegex.test(target)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[dealerConfig] dealerAliasMap has invalid format: ${alias} -> ${target}`
      );
    }
    if (alias === target) {
      // eslint-disable-next-line no-console
      console.warn(
        `[dealerConfig] dealerAliasMap alias and target are the same: ${alias}`
      );
    }
  }
})();

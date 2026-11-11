/**
 * IMEI rules mirrored by the database functions (issue_imei / sell_imei /
 * return_imei). The client shows green/red signals from this logic; the
 * database re-validates every transition server-side.
 */

export type ImeiStatus = "in_dealer_stock" | "with_salesman" | "sold";

export type ImeiAction = "issue" | "sell" | "return";

/** Allowed transitions per action, mirroring the Postgres functions. */
const ALLOWED: Record<ImeiAction, ImeiStatus[]> = {
  issue: ["in_dealer_stock"],
  sell: ["with_salesman"],
  return: ["with_salesman"],
};

/**
 * Extract one or more IMEI-like numeric tokens without concatenating unrelated
 * numbers from a product label, GS1 payload, serial number or QR content.
 */
export function extractImeiCandidates(raw: string): string[] {
  const value = (raw || "").trim();
  if (!value) return [];

  const labeled = [...value.matchAll(/IMEI(?:\s*[12])?\s*[:=#-]?\s*((?:\d[\s-]?){14,16})/gi)]
    .map((match) => (match[1] || "").replace(/\D/g, ""))
    .filter((digits) => digits.length >= 14 && digits.length <= 16);
  if (labeled.length) return [...new Set(labeled)];

  // A plain numeric barcode may contain spaces/hyphens inserted by scanners.
  if (/^[\d\s-]+$/.test(value)) {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 14 && digits.length <= 16 ? [digits] : [];
  }

  // For labelled/structured payloads, accept only isolated 14–16 digit tokens.
  const matches = [...value.matchAll(/(?:^|[^\d])(\d{14,16})(?!\d)/g)]
    .flatMap((match) => {
      const candidate = match[1];
      return candidate ? [candidate] : [];
    });
  return [...new Set(matches)];
}

/** Return a normalized value only when the source contains exactly one candidate. */
export function normalizeImei(raw: string): string {
  const candidates = extractImeiCandidates(raw);
  return candidates.length === 1 ? (candidates[0] ?? "") : "";
}

/** Standard Luhn check for a 15-digit IMEI. */
export function isValidImeiCheckDigit(raw: string): boolean {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length !== 15) return false;

  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * 15-digit IMEIs must pass Luhn. 14-digit legacy identifiers and 16-digit
 * IMEISV payloads are retained for exact server-side inventory lookup.
 */
export function isPlausibleImei(code: string): boolean {
  const digits = normalizeImei(code);
  if (digits.length === 15) return isValidImeiCheckDigit(digits);
  return digits.length === 14 || digits.length === 16;
}

export interface TransitionCheck {
  ok: boolean;
  reason: "unknown_imei" | "not_plausible" | "wrong_status" | "ok";
}

export function checkTransition(
  action: ImeiAction,
  currentStatus: ImeiStatus | null,
): TransitionCheck {
  if (currentStatus === null) return { ok: false, reason: "unknown_imei" };
  if (!ALLOWED[action].includes(currentStatus)) {
    return { ok: false, reason: "wrong_status" };
  }
  return { ok: true, reason: "ok" };
}

/**
 * IMEI rules mirrored by the database constraint and posting functions.
 * Standard IMEIs are exactly 15 decimal digits and pass the Luhn checksum.
 */

export type ImeiStatus = "in_dealer_stock" | "with_salesman" | "sold";
export type ImeiAction = "issue" | "sell" | "return";

const ALLOWED: Record<ImeiAction, ImeiStatus[]> = {
  issue: ["in_dealer_stock"],
  sell: ["with_salesman"],
  return: ["with_salesman"],
};

export function normalizeImei(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

/** Validate a standard 15-digit IMEI using its Luhn check digit. */
export function hasValidImeiChecksum(value: string): boolean {
  if (!/^\d{15}$/.test(value)) return false;

  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    let digit = Number(value[index]);
    // IMEI Luhn doubles the 2nd, 4th, ... digit from the left.
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Backwards-compatible name; now enforces strict 15-digit + Luhn rules. */
export function isPlausibleImei(code: string): boolean {
  return hasValidImeiChecksum(normalizeImei(code));
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
